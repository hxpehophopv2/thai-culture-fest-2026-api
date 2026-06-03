/**
 * Admin Service — เครื่องมือแก้ปัญหาหน้างาน
 * ─────────────────────────────────────────────────────────────
 *
 * ให้ admin/staff สามารถจัดการทุกอย่างผ่าน API:
 *   - จัดการผู้เข้าร่วม (แก้ข้อมูล, walk-in)
 *   - จัดการ booking (สร้าง, force, ย้ายรอบ, ยกเลิก)
 *   - จัดการ check-in (force stamp, ลบ stamp)
 *   - จัดการ QR (ออกใหม่)
 *   - จัดการ session (ปรับ capacity, สถานะ real-time)
 *
 * ─────────────────────────────────────────────────────────────
 */

import { prisma } from '../lib/prisma.js';
import { generateParticipantQr, generateStudentQr } from './qr.service.js';

// ─── Custom Error ────────────────────────────────────────

export class AdminError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AdminError';
  }
}

// ─── กลุ่ม 1: จัดการผู้เข้าร่วม ─────────────────────────

/**
 * ดูรายละเอียดผู้เข้าร่วม + bookings + scan history
 */
export async function getParticipantDetail(participantId: string) {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    include: {
      bookings: {
        include: {
          session: {
            include: {
              activity: { select: { id: true, name: true, nameTh: true, zone: true } }
            }
          }
        },
        orderBy: { session: { startTime: 'asc' } }
      },
      scanLogs: {
        include: {
          actualActivity: { select: { id: true, nameTh: true } }
        },
        orderBy: { scannedAt: 'desc' }
      }
    }
  });

  if (!participant) {
    throw new AdminError('NOT_FOUND', 'ไม่พบผู้เข้าร่วม / Participant not found');
  }

  return participant;
}

/**
 * แก้ไขข้อมูลผู้เข้าร่วม (ชื่อผิด, เบอร์ผิด, อีเมลผิด ฯลฯ)
 */
export async function updateParticipant(
  participantId: string,
  data: {
    firstName?: string;
    lastName?: string;
    nickname?: string;
    email?: string;
    phoneNumber?: string;
    organization?: string;
    country?: string;
  }
) {
  const existing = await prisma.participant.findUnique({
    where: { id: participantId }
  });

  if (!existing) {
    throw new AdminError('NOT_FOUND', 'ไม่พบผู้เข้าร่วม / Participant not found');
  }

  // กรอง field ที่ส่งมาจริง (ไม่ undefined)
  const cleanData = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined)
  );

  if (Object.keys(cleanData).length === 0) {
    throw new AdminError('NO_DATA', 'ไม่มีข้อมูลที่จะแก้ไข / No data to update');
  }

  return prisma.participant.update({
    where: { id: participantId },
    data: cleanData
  });
}

/**
 * ลงทะเบียน walk-in — คนมาหน้างานแต่ไม่ได้ลงทะเบียนล่วงหน้า
 *
 * สร้าง participant โดยไม่ต้องมี LINE userId
 * ใช้ staffId + timestamp เป็น lineUserId แทน (placeholder)
 */
export async function walkinRegistration(
  staffId: string,
  data: {
    firstName: string;
    lastName: string;
    nickname: string;
    email?: string;
    phoneNumber: string;
    organization?: string;
    participantType?: string;
    selectedSessionIds?: string[];
  }
) {
  const { selectedSessionIds = [], ...participantData } = data;

  // สร้าง placeholder lineUserId สำหรับ walk-in
  const walkinLineId = `walkin_${staffId}_${Date.now()}`;

  const result = await prisma.$transaction(async (tx) => {
    // สร้าง participant
    const participant = await tx.participant.create({
      data: {
        lineUserId: walkinLineId,
        displayName: `Walk-in: ${data.firstName}`,
        nationalityType: 'THAI',
        firstName: participantData.firstName,
        lastName: participantData.lastName,
        nickname: participantData.nickname,
        dateOfBirth: new Date('2000-01-01'), // placeholder
        email: participantData.email ?? '',
        phoneNumber: participantData.phoneNumber,
        country: null,
        participantType: (participantData.participantType as any) ?? 'GENERAL_PUBLIC',
        organization: participantData.organization ?? 'Walk-in',
        pdpaConsent: true,
        mediaConsent: true
      }
    });

    // ถ้ามี sessions ที่เลือก → สร้าง bookings
    if (selectedSessionIds.length > 0) {
      for (const sessionId of selectedSessionIds) {
        // เช็ค capacity (ไม่ lock เพราะ admin สามารถ override ได้)
        await tx.booking.create({
          data: {
            participantId: participant.id,
            sessionId
          }
        });

        await tx.session.update({
          where: { id: sessionId },
          data: { bookedCount: { increment: 1 } }
        });
      }
    }

    return participant;
  });

  // สร้าง QR ให้
  const qr = await generateParticipantQr(result.id);

  return {
    participant: result,
    qr
  };
}

// ─── กลุ่ม 2: จัดการ Booking ─────────────────────────────

/**
 * สร้าง booking ปกติ (เช็ค capacity)
 */
export async function adminCreateBooking(participantId: string, sessionId: string) {
  return prisma.$transaction(async (tx) => {
    // เช็คว่ามีคนนี้จริง
    const participant = await tx.participant.findUnique({
      where: { id: participantId }
    });
    if (!participant) {
      throw new AdminError('PARTICIPANT_NOT_FOUND', 'ไม่พบผู้เข้าร่วม');
    }

    // เช็ค session
    const session = await tx.session.findUnique({
      where: { id: sessionId },
      include: { activity: { select: { id: true, nameTh: true } } }
    });
    if (!session) {
      throw new AdminError('SESSION_NOT_FOUND', 'ไม่พบรอบกิจกรรม');
    }

    // เช็คว่าจองซ้ำไหม
    const existing = await tx.booking.findFirst({
      where: { participantId, sessionId, status: 'CONFIRMED' }
    });
    if (existing) {
      throw new AdminError('ALREADY_BOOKED', 'จองรอบนี้ไปแล้ว');
    }

    // เช็คว่าจอง activity นี้ไปแล้วหรือยัง (ฐานซ้ำ)
    const existingActivityBooking = await tx.booking.findFirst({
      where: {
        participantId,
        status: 'CONFIRMED',
        session: { activityId: session.activityId }
      }
    });
    if (existingActivityBooking) {
      throw new AdminError('DUPLICATE_ACTIVITY', `จองฐาน "${session.activity.nameTh}" ไปแล้ว`);
    }

    // เช็ค capacity
    if (session.bookedCount >= session.capacity) {
      throw new AdminError('SESSION_FULL', `รอบนี้เต็มแล้ว (${session.bookedCount}/${session.capacity}) — ใช้ force booking แทน`);
    }

    const booking = await tx.booking.create({
      data: { participantId, sessionId }
    });

    await tx.session.update({
      where: { id: sessionId },
      data: { bookedCount: { increment: 1 } }
    });

    return { booking, activity: session.activity.nameTh, message: 'สร้าง booking สำเร็จ' };
  });
}

/**
 * Force booking — จองให้แม้เต็มแล้ว (override capacity)
 */
export async function adminForceBooking(
  participantId: string,
  sessionId: string,
  staffId: string,
  reason?: string
) {
  return prisma.$transaction(async (tx) => {
    const participant = await tx.participant.findUnique({
      where: { id: participantId }
    });
    if (!participant) {
      throw new AdminError('PARTICIPANT_NOT_FOUND', 'ไม่พบผู้เข้าร่วม');
    }

    const session = await tx.session.findUnique({
      where: { id: sessionId },
      include: { activity: { select: { id: true, nameTh: true } } }
    });
    if (!session) {
      throw new AdminError('SESSION_NOT_FOUND', 'ไม่พบรอบกิจกรรม');
    }

    // เช็คว่าจองซ้ำไหม
    const existing = await tx.booking.findFirst({
      where: { participantId, sessionId, status: 'CONFIRMED' }
    });
    if (existing) {
      throw new AdminError('ALREADY_BOOKED', 'จองรอบนี้ไปแล้ว');
    }

    // ⚡ Force: สร้าง booking แม้เต็ม (ไม่เช็ค capacity)
    const booking = await tx.booking.create({
      data: { participantId, sessionId }
    });

    await tx.session.update({
      where: { id: sessionId },
      data: { bookedCount: { increment: 1 } }
    });

    return {
      booking,
      activity: session.activity.nameTh,
      wasOverCapacity: session.bookedCount >= session.capacity,
      capacityBefore: `${session.bookedCount}/${session.capacity}`,
      capacityAfter: `${session.bookedCount + 1}/${session.capacity}`,
      forcedBy: staffId,
      reason: reason ?? null,
      message: `Force booking สำเร็จ — ${session.activity.nameTh}`
    };
  });
}

/**
 * ย้ายรอบ — เปลี่ยน session ของ booking
 */
export async function adminMoveBooking(bookingId: string, newSessionId: string) {
  return prisma.$transaction(async (tx) => {
    // ดึง booking เดิม
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        session: {
          include: { activity: { select: { nameTh: true } } }
        }
      }
    });

    if (!booking) {
      throw new AdminError('BOOKING_NOT_FOUND', 'ไม่พบ booking');
    }

    if (booking.status === 'CANCELLED') {
      throw new AdminError('ALREADY_CANCELLED', 'Booking นี้ถูกยกเลิกแล้ว');
    }

    // ดึง session ใหม่
    const newSession = await tx.session.findUnique({
      where: { id: newSessionId },
      include: { activity: { select: { nameTh: true } } }
    });

    if (!newSession) {
      throw new AdminError('SESSION_NOT_FOUND', 'ไม่พบรอบกิจกรรมใหม่');
    }

    // Decrement old session
    await tx.session.update({
      where: { id: booking.sessionId },
      data: { bookedCount: { decrement: 1 } }
    });

    // Update booking → new session
    await tx.booking.update({
      where: { id: bookingId },
      data: { sessionId: newSessionId }
    });

    // Increment new session
    await tx.session.update({
      where: { id: newSessionId },
      data: { bookedCount: { increment: 1 } }
    });

    return {
      bookingId,
      from: booking.session.activity.nameTh,
      to: newSession.activity.nameTh,
      message: `ย้ายจาก "${booking.session.activity.nameTh}" ไป "${newSession.activity.nameTh}" สำเร็จ`
    };
  });
}

/**
 * ยกเลิก booking (admin)
 */
export async function adminCancelBooking(bookingId: string) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        session: { include: { activity: { select: { nameTh: true } } } }
      }
    });

    if (!booking) {
      throw new AdminError('BOOKING_NOT_FOUND', 'ไม่พบ booking');
    }

    if (booking.status === 'CANCELLED') {
      throw new AdminError('ALREADY_CANCELLED', 'Booking นี้ถูกยกเลิกไปแล้ว');
    }

    await tx.booking.update({
      where: { id: bookingId },
      data: { status: 'CANCELLED' }
    });

    await tx.session.update({
      where: { id: booking.sessionId },
      data: { bookedCount: { decrement: 1 } }
    });

    return {
      bookingId,
      activity: booking.session.activity.nameTh,
      message: `ยกเลิก booking "${booking.session.activity.nameTh}" สำเร็จ`
    };
  });
}

// ─── กลุ่ม 3: จัดการ Check-in / Stamp ────────────────────

/**
 * Force check-in — ประทับ stamp โดยไม่ต้องแสกน QR
 *
 * ใช้เมื่อ:
 *   - QR หาย/เสีย
 *   - มือถือไม่มีแบต
 *   - walk-in ที่ไม่มี QR
 */
export async function adminForceCheckin(
  participantId: string,
  activityId: string,
  staffId: string,
  note?: string
) {
  // ตรวจว่ามีคนนี้จริง
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    select: { id: true, firstName: true, lastName: true }
  });

  if (!participant) {
    throw new AdminError('PARTICIPANT_NOT_FOUND', 'ไม่พบผู้เข้าร่วม');
  }

  // ตรวจว่ามีฐานนี้จริง
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { id: true, nameTh: true }
  });

  if (!activity) {
    throw new AdminError('ACTIVITY_NOT_FOUND', 'ไม่พบฐานกิจกรรม');
  }

  // ตรวจว่าเข้าฐานนี้แล้วหรือยัง
  const alreadyCheckedIn = await prisma.scanLog.findFirst({
    where: {
      participantId,
      actualActivityId: activityId,
      result: 'checked_in'
    }
  });

  if (alreadyCheckedIn) {
    throw new AdminError('ALREADY_CHECKED_IN', `เข้าฐาน "${activity.nameTh}" ไปแล้ว`);
  }

  // Wrap ใน transaction เพื่อป้องกัน orphan staff session
  const scanLog = await prisma.$transaction(async (tx) => {
    // หา active staff session ของ staff คนนี้ (ถ้ามี)
    let staffSessionId: string;
    const activeSession = await tx.staffSession.findFirst({
      where: { staffId, endedAt: null }
    });

    if (activeSession) {
      staffSessionId = activeSession.id;
    } else {
      // สร้าง staff session ชั่วคราวสำหรับ force checkin
      const tempSession = await tx.staffSession.create({
        data: { staffId, activityId }
      });
      staffSessionId = tempSession.id;
    }

    // สร้าง scan log
    return tx.scanLog.create({
      data: {
        participantId,
        actualActivityId: activityId,
        result: 'checked_in',
        isOverride: true,
        staffSessionId,
        staffId,
        note: note ?? 'Admin force check-in'
      }
    });
  });

  return {
    scanLogId: scanLog.id,
    participant: `${participant.firstName} ${participant.lastName}`,
    activity: activity.nameTh,
    message: `Force check-in สำเร็จ — ${participant.firstName} เข้าฐาน "${activity.nameTh}"`
  };
}

/**
 * ลบ stamp — ยกเลิก check-in ที่ผิดพลาด
 *
 * เปลี่ยน result จาก checked_in → rejected พร้อมใส่หมายเหตุ
 * (ไม่ลบ record จริง เพราะเก็บ audit trail)
 */
export async function adminDeleteCheckin(scanLogId: string, staffId: string, reason?: string) {
  const scanLog = await prisma.scanLog.findUnique({
    where: { id: scanLogId },
    include: { actualActivity: { select: { nameTh: true } } }
  });

  if (!scanLog) {
    throw new AdminError('NOT_FOUND', 'ไม่พบ scan log');
  }

  if (scanLog.result !== 'checked_in') {
    throw new AdminError('NOT_CHECKED_IN', 'Scan log นี้ไม่ใช่ checked_in — ไม่ต้องลบ');
  }

  await prisma.scanLog.update({
    where: { id: scanLogId },
    data: {
      result: 'rejected',
      note: `[Admin ลบ stamp: ${reason ?? 'ไม่ระบุเหตุผล'}] by ${staffId}`,
      isOverride: true
    }
  });

  return {
    scanLogId,
    activity: scanLog.actualActivity.nameTh,
    message: `ลบ stamp "${scanLog.actualActivity.nameTh}" สำเร็จ`
  };
}

/**
 * ดู scan history ทั้งหมดของคน (participant หรือ student)
 */
export async function getCheckinHistory(type: 'participant' | 'student', personId: string) {
  const where = type === 'participant'
    ? { participantId: personId }
    : { studentId: personId };

  const logs = await prisma.scanLog.findMany({
    where,
    include: {
      actualActivity: { select: { id: true, nameTh: true, zone: true } },
      staffSession: { select: { staffId: true } }
    },
    orderBy: { scannedAt: 'desc' }
  });

  return logs.map(l => ({
    id: l.id,
    scannedAt: l.scannedAt,
    activity: l.actualActivity.nameTh,
    zone: l.actualActivity.zone,
    result: l.result,
    isOverride: l.isOverride,
    staffId: l.staffId,
    note: l.note
  }));
}

// ─── กลุ่ม 4: จัดการ QR Code ─────────────────────────────

/**
 * ออก QR ใหม่ — สำหรับคนที่ QR หาย/เสีย
 *
 * สร้าง JWT token ใหม่ (token เดิมยังใช้ได้เพราะ data เดียวกัน)
 */
export async function regenerateQr(type: 'participant' | 'student', personId: string) {
  if (type === 'participant') {
    const participant = await prisma.participant.findUnique({
      where: { id: personId },
      select: { id: true, firstName: true, lastName: true }
    });
    if (!participant) {
      throw new AdminError('NOT_FOUND', 'ไม่พบผู้เข้าร่วม');
    }

    const qr = await generateParticipantQr(personId);
    return {
      type,
      ...qr,
      message: `ออก QR ใหม่สำเร็จ — ${participant.firstName} ${participant.lastName}`
    };
  } else {
    const student = await prisma.student.findUnique({
      where: { id: personId },
      select: { id: true, firstName: true, lastName: true }
    });
    if (!student) {
      throw new AdminError('NOT_FOUND', 'ไม่พบนักเรียน');
    }

    const qr = await generateStudentQr(personId);
    return {
      type,
      ...qr,
      message: `ออก QR ใหม่สำเร็จ — ${student.firstName} ${student.lastName}`
    };
  }
}

// ─── กลุ่ม 5: จัดการ Session / Capacity ──────────────────

/**
 * ปรับ capacity / เปิด-ปิด session
 */
export async function updateSession(
  sessionId: string,
  data: {
    capacity?: number;
    isVisible?: boolean;
  }
) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { activity: { select: { nameTh: true } } }
  });

  if (!session) {
    throw new AdminError('SESSION_NOT_FOUND', 'ไม่พบ session');
  }

  const updateData: any = {};
  if (data.capacity !== undefined) updateData.capacity = data.capacity;
  if (data.isVisible !== undefined) updateData.isVisible = data.isVisible;

  if (Object.keys(updateData).length === 0) {
    throw new AdminError('NO_DATA', 'ไม่มีข้อมูลที่จะแก้ไข');
  }

  const updated = await prisma.session.update({
    where: { id: sessionId },
    data: updateData,
    include: { activity: { select: { nameTh: true } } }
  });

  return {
    sessionId: updated.id,
    activity: updated.activity.nameTh,
    capacity: updated.capacity,
    bookedCount: updated.bookedCount,
    remainingSeats: updated.capacity - updated.bookedCount,
    isVisible: updated.isVisible,
    message: `อัปเดต session "${updated.activity.nameTh}" สำเร็จ`
  };
}

/**
 * สถานะ real-time — แต่ละฐานมีคนเข้าแล้วกี่คน / เหลือกี่ที่ / staff ใครอยู่
 */
export async function getLiveActivityStatus() {
  const activities = await prisma.activity.findMany({
    where: { isActive: true },
    include: {
      sessions: {
        where: { isVisible: true },
        orderBy: { startTime: 'asc' },
        select: {
          id: true,
          startTime: true,
          endTime: true,
          capacity: true,
          bookedCount: true
        }
      },
      staffSessions: {
        where: { endedAt: null }, // เฉพาะ staff ที่กำลังประจำอยู่
        select: { staffId: true, startedAt: true }
      },
      scanLogs: {
        where: { result: 'checked_in' },
        select: { id: true }
      }
    },
    orderBy: { sortOrder: 'asc' }
  });

  return activities.map(act => {
    const totalCapacity = act.sessions.reduce((sum, s) => sum + s.capacity, 0);
    const totalBooked = act.sessions.reduce((sum, s) => sum + s.bookedCount, 0);

    return {
      id: act.id,
      name: act.name,
      nameTh: act.nameTh,
      zone: act.zone,
      // สถิติรวม
      totalCapacity,
      totalBooked,
      totalRemaining: totalCapacity - totalBooked,
      totalCheckedIn: act.scanLogs.length,
      // แต่ละรอบ
      sessions: act.sessions.map(s => ({
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        capacity: s.capacity,
        booked: s.bookedCount,
        remaining: s.capacity - s.bookedCount,
        isFull: s.bookedCount >= s.capacity
      })),
      // Staff ที่กำลังประจำอยู่
      activeStaff: act.staffSessions.map(ss => ({
        staffId: ss.staffId,
        since: ss.startedAt
      }))
    };
  });
}

// ─── Dashboard + CSV Export ──────────────────────────────

/** ดึงข้อมูลสรุปสำหรับ Dashboard — ทั้ง event-level และ activity-level */
export async function getDashboardStats() {
  const [participantCount, studentCount, bookingCount, confirmedBookings,
         sessionStats, scanLogCount, checkedInCount,
         walkinCount,
         uniqueParticipantAttendees, uniqueStudentAttendees,
         studentPartCount, teacherPartCount, staffPartCount, publicPartCount, guestPartCount] = await Promise.all([
    prisma.participant.count(),
    prisma.student.count(),
    prisma.booking.count(),
    prisma.booking.count({ where: { status: 'CONFIRMED' } }),
    prisma.session.aggregate({ _sum: { capacity: true, bookedCount: true } }),
    prisma.scanLog.count(),
    prisma.scanLog.count({ where: { result: 'checked_in' } }),
    // Walk-in count (lineUserId starts with 'walkin_')
    prisma.participant.count({ where: { lineUserId: { startsWith: 'walkin_' } } }),
    // Unique people who actually attended (checked_in at least once)
    prisma.scanLog.findMany({
      where: { result: 'checked_in', participantId: { not: null } },
      select: { participantId: true },
      distinct: ['participantId']
    }),
    prisma.scanLog.findMany({
      where: { result: 'checked_in', studentId: { not: null } },
      select: { studentId: true },
      distinct: ['studentId']
    }),
    prisma.participant.count({ where: { participantType: 'STUDENT' } }),
    prisma.participant.count({ where: { participantType: 'TEACHER' } }),
    prisma.participant.count({ where: { participantType: 'STAFF' } }),
    prisma.participant.count({ where: { participantType: 'GENERAL_PUBLIC' } }),
    prisma.participant.count({ where: { participantType: 'GUEST' } })
  ]);

  const totalRegistered = participantCount + studentCount;
  const uniqueAttendees = uniqueParticipantAttendees.length + uniqueStudentAttendees.length;
  const attendanceRate = totalRegistered > 0 ? Math.round((uniqueAttendees / totalRegistered) * 100) : 0;

  return {
    // ─── Event Overview (ภาพรวมงาน) ───
    event: {
      totalRegistered,
      participants: participantCount,
      students: studentCount,
      walkins: walkinCount,
      uniqueAttendees,           // คนที่มาจริง (เคย check-in อย่างน้อย 1 ฐาน)
      notYetArrived: totalRegistered - uniqueAttendees,
      attendanceRate             // % คนมาจริง vs ลงทะเบียน
    },
    // ─── Breakdown by type (สรุปแต่ละประเภท) ───
    types: {
      studentTotal: studentCount + studentPartCount,
      staffTotal: staffPartCount,
      teacherTotal: teacherPartCount,
      publicTotal: publicPartCount,
      guestTotal: guestPartCount
    },
    // ─── Activity Bookings ───
    bookings: {
      total: bookingCount,
      confirmed: confirmedBookings,
      cancelled: bookingCount - confirmedBookings
    },
    // ─── Session Capacity (ที่นั่งฐานกิจกรรม) ───
    capacity: {
      totalSeats: sessionStats._sum.capacity ?? 0,
      totalBooked: sessionStats._sum.bookedCount ?? 0,
      remainingSeats: (sessionStats._sum.capacity ?? 0) - (sessionStats._sum.bookedCount ?? 0)
    },
    // ─── Check-in Activity ───
    checkin: {
      totalScans: scanLogCount,
      checkedIn: checkedInCount   // จำนวนครั้งที่ check-in สำเร็จ (stamp count)
    }
  };
}

/** สร้าง CSV สำหรับรายชื่อผู้ลงทะเบียน */
export async function exportParticipantsCsv() {
  const participants = await prisma.participant.findMany({
    include: { bookings: { where: { status: 'CONFIRMED' }, include: { session: { include: { activity: { select: { nameTh: true } } } } } } },
    orderBy: { createdAt: 'asc' }
  });

  const header = 'ลำดับ,ชื่อ,นามสกุล,ชื่อเล่น,อีเมล,เบอร์โทร,ประเภท,หน่วยงาน,สัญชาติ,กิจกรรมที่จอง,วันที่ลงทะเบียน\n';
  const rows = participants.map((p, i) => {
    const activities = p.bookings.map(b => b.session.activity.nameTh).join(' | ');
    return `${i + 1},"${p.firstName}","${p.lastName}","${p.nickname}","${p.email}","${p.phoneNumber}","${p.participantType}","${p.organization}","${p.nationalityType}","${activities}","${p.createdAt.toISOString()}"`;
  }).join('\n');

  return '\uFEFF' + header + rows;
}

/** สร้าง CSV สำหรับ scan logs */
export async function exportScanLogsCsv() {
  const logs = await prisma.scanLog.findMany({
    include: {
      participant: { select: { firstName: true, lastName: true } },
      student: { select: { firstName: true, lastName: true } },
      actualActivity: { select: { nameTh: true } },
      staffSession: { select: { staffId: true } }
    },
    orderBy: { scannedAt: 'asc' }
  });

  const header = 'เวลา,ชื่อผู้เข้าร่วม,ประเภท,ฐาน,ผลลัพธ์,Override,Staff,หมายเหตุ\n';
  const rows = logs.map(l => {
    const name = l.participant ? `${l.participant.firstName} ${l.participant.lastName}` : l.student ? `${l.student.firstName} ${l.student.lastName}` : 'Unknown';
    const type = l.participantId ? 'Participant' : 'Student';
    return `"${l.scannedAt.toISOString()}","${name}","${type}","${l.actualActivity.nameTh}","${l.result}","${l.isOverride}","${l.staffId}","${l.note ?? ''}"`;
  }).join('\n');

  return '\uFEFF' + header + rows;
}

/** สร้าง CSV สำหรับข้อมูลดิบทั้งหมด (ทั้งผู้เข้าร่วม LIFF และนักเรียนนำเข้า) */
export async function exportRawRegistrationsCsv() {
  const [participants, students] = await Promise.all([
    prisma.participant.findMany({
      include: {
        bookings: {
          where: { status: 'CONFIRMED' },
          include: { session: { include: { activity: { select: { nameTh: true } } } } }
        },
        scanLogs: {
          where: { result: 'checked_in' },
          include: { actualActivity: { select: { nameTh: true } } }
        }
      },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.student.findMany({
      include: {
        teacher: { select: { firstName: true, lastName: true } },
        bookings: {
          where: { status: 'CONFIRMED' },
          include: { session: { include: { activity: { select: { nameTh: true } } } } }
        },
        scanLogs: {
          where: { result: 'checked_in' },
          include: { actualActivity: { select: { nameTh: true } } }
        }
      },
      orderBy: { createdAt: 'asc' }
    })
  ]);

  const header = 'ID,Source,First Name,Last Name,Nickname,Date of Birth,Student Code,Class,Email,Phone,Type,Organization/School/Teacher,Short Code,Gate Checked-in,Bookings,Stamps,Created At\n';

  const pRows = participants.map(p => {
    const bookings = p.bookings.map(b => b.session.activity.nameTh).join(' | ');
    const stamps = p.scanLogs.map(l => l.actualActivity.nameTh).join(' | ');
    const gateCheckedIn = p.gateCheckedInAt ? p.gateCheckedInAt.toISOString() : 'No';
    const dob = p.dateOfBirth ? p.dateOfBirth.toISOString().split('T')[0] : '';
    return `"${p.id}","LIFF","${p.firstName}","${p.lastName}","${p.nickname}","${dob}","","","${p.email}","${p.phoneNumber}","${p.participantType}","${p.organization}","${p.shortCode || ''}","${gateCheckedIn}","${bookings}","${stamps}","${p.createdAt.toISOString()}"`;
  });

  const sRows = students.map(s => {
    const bookings = s.bookings.map(b => b.session.activity.nameTh).join(' | ');
    const stamps = s.scanLogs.map(l => l.actualActivity.nameTh).join(' | ');
    const teacherName = s.teacher ? `${s.teacher.firstName} ${s.teacher.lastName}` : '';
    const gateCheckedIn = s.gateCheckedInAt ? s.gateCheckedInAt.toISOString() : 'No';
    const dob = s.dateOfBirth ? s.dateOfBirth.toISOString().split('T')[0] : '';
    return `"${s.id}","Imported","${s.firstName}","${s.lastName}","","${dob}","${s.studentCode || ''}","${s.classRoom || ''}","","","STUDENT_IMPORTED","${s.schoolName || ''} (Teacher: ${teacherName})","${s.shortCode || ''}","${gateCheckedIn}","${bookings}","${stamps}","${s.createdAt.toISOString()}"`;
  });

  const allRows = [...pRows, ...sRows].join('\n');
  return '\uFEFF' + header + allRows;
}

// ─── Booth Code Management ──────────────────────────────

/**
 * สร้างรหัสฐานให้ activity
 * Format: XXX-XXXX (uppercase letters + digits)
 */
export async function generateBoothCode(activityId: string) {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { id: true, nameTh: true, name: true, boothCode: true }
  });
  if (!activity) throw new AdminError('NOT_FOUND', 'ไม่พบกิจกรรม');

  // Generate random code: 3 chars - 4 chars
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1 to avoid confusion
  const gen = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const code = `${gen(3)}-${gen(4)}`;

  await prisma.activity.update({
    where: { id: activityId },
    data: { boothCode: code }
  });

  return { activityId, name: activity.nameTh, boothCode: code };
}

/**
 * ดึงรายการรหัสฐานทั้งหมด
 */
export async function listBoothCodes() {
  const activities = await prisma.activity.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, nameTh: true, zone: true, boothCode: true }
  });
  return activities;
}

/**
 * ลบรหัสฐาน (set null)
 */
export async function deleteBoothCode(activityId: string) {
  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) throw new AdminError('NOT_FOUND', 'ไม่พบกิจกรรม');

  await prisma.activity.update({
    where: { id: activityId },
    data: { boothCode: null }
  });

  return { success: true, message: `ลบรหัสฐาน "${activity.nameTh}" แล้ว` };
}
