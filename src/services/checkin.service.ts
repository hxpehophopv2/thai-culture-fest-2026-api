/**
 * Check-in Service
 * ─────────────────────────────────────────────────────────────
 *
 * Business logic สำหรับระบบ check-in วันงาน
 *
 * Flow หลัก:
 *   1. Staff เปิด LIFF → เลือกฐาน → สร้าง StaffSession
 *   2. ผู้เข้าร่วมยื่น QR → Staff แสกน
 *   3. ระบบ parse QR → ดึงข้อมูลจาก DB → เทียบฐาน/เวลา → แสดงผลลัพธ์
 *   4. Staff กด "ประทับ stamp" หรือ "override" หรือ "ไม่อนุญาต"
 *   5. ทุก event ถูกบันทึกใน scan_logs (audit trail)
 *
 * Scan Logic:
 *   Parse QR → ได้ {type, id} → query DB ดึง bookings
 *   เทียบกับ actualActivityId (ฐานที่ staff อยู่):
 *
 *   ┌─ มี booking ตรงฐาน + ถูกเวลา → "checked_in"  ✅
 *   ├─ มี booking ตรงฐาน + ผิดเวลา → "wrong_time"   ⚠️
 *   ├─ มี booking แต่ผิดฐาน       → "wrong_base"    ⚠️
 *   └─ ไม่มี booking เลย          → "no_booking"    ❌
 *
 * Time Window:
 *   ±15 นาที buffer สำหรับ clock skew
 *   เช่น รอบ 09:00-10:30 → ยอมรับตั้งแต่ 08:45-10:45
 *
 * ─────────────────────────────────────────────────────────────
 */

import { prisma } from '../lib/prisma.js';
import { parseQrData } from './qr.service.js';

// ─── Constants ───────────────────────────────────────────

/** Buffer time สำหรับ check-in (± นาที) */
const TIME_BUFFER_MINUTES = 15;

// ─── Types ───────────────────────────────────────────────

/** ผลลัพธ์การแสกน */
export type ScanResultType =
  | 'checked_in'           // ✅ ถูกฐาน ถูกเวลา
  | 'already_stamped'      // ⚠️ เข้าฐานนี้แล้ว ไม่ต้องประทับซ้ำ
  | 'wrong_base'           // ⚠️ ผิดฐาน
  | 'wrong_time'           // ⚠️ ผิดเวลา (ถูกฐาน)
  | 'no_booking'           // ❌ ไม่มีการจอง
  | 'rejected'             // ❌ staff ไม่อนุญาต
  | 'gate_checked_in'      // ✅ สแกนเข้างานสำเร็จ
  | 'gate_already'         // ⚠️ เข้างานแล้ว
  | 'not_gate_checked_in'; // ❌ ยังไม่ได้สแกนเข้างาน

export interface ScanResult {
  /** ผลลัพธ์ */
  result: ScanResultType;
  /** ID ของ scan log ที่สร้าง */
  scanLogId: string;
  /** ข้อมูลคนที่ถูกแสกน */
  person: {
    id: string;
    type: 'participant' | 'student';
    name: string;
    org: string;
  };
  /** ข้อความอธิบาย */
  message: string;
  /** ข้อมูล booking ที่ตรง (ถ้ามี) */
  matchedBooking?: {
    bookingId: string;
    activityName: string;
    startTime: string;
    endTime: string;
  };
  /** ข้อมูล booking ที่ควรไป (ถ้าผิดฐาน) */
  expectedBooking?: {
    activityName: string;
    startTime: string;
    endTime: string;
  };
  /** Stamp card — เข้าฐานไหนแล้วบ้าง */
  stamps: StampInfo[];
}

export interface StampInfo {
  activityId: string;
  activityName: string;
  /** null = ยังไม่ได้แสกน, Date = แสกนแล้ว */
  scannedAt: Date | null;
  /** มี booking หรือเปล่า */
  hasBooking: boolean;
}

// ─── DB Booking Info (แทน JWT slots) ─────────────────────

interface BookingSlot {
  bookingId: string;
  sessionId: string;
  activityId: string;
  activityName: string;
  startTime: Date;
  endTime: Date;
}

/**
 * ดึง bookings ของคนจาก DB (แทนการอ่านจาก JWT)
 */
async function getPersonBookings(
  type: 'participant' | 'student',
  personId: string
): Promise<BookingSlot[]> {
  const where = type === 'participant'
    ? { participantId: personId, status: 'CONFIRMED' as const }
    : { studentId: personId, status: 'CONFIRMED' as const };

  const bookings = await prisma.booking.findMany({
    where,
    include: {
      session: {
        include: {
          activity: { select: { id: true, nameTh: true } }
        }
      }
    },
    orderBy: { session: { startTime: 'asc' } }
  });

  return bookings.map(b => ({
    bookingId: b.id,
    sessionId: b.session.id,
    activityId: b.session.activity.id,
    activityName: b.session.activity.nameTh,
    startTime: b.session.startTime,
    endTime: b.session.endTime
  }));
}

/**
 * ดึงข้อมูลคนจาก DB
 */
async function getPersonInfo(type: 'participant' | 'student', personId: string) {
  if (type === 'participant') {
    const p = await prisma.participant.findUnique({
      where: { id: personId },
      select: { id: true, firstName: true, lastName: true, organization: true }
    });
    if (!p) return null;
    return { id: p.id, name: `${p.firstName} ${p.lastName}`, org: p.organization };
  } else {
    const s = await prisma.student.findUnique({
      where: { id: personId },
      select: { id: true, firstName: true, lastName: true, schoolName: true }
    });
    if (!s) return null;
    return { id: s.id, name: `${s.firstName} ${s.lastName}`, org: s.schoolName ?? '' };
  }
}

// ─── Staff Session Management ────────────────────────────

/**
 * เปิด Staff Session — staff เลือกฐานที่จะประจำ
 *
 * ถ้ามี session เดิมที่ยังเปิดอยู่ → ปิดอัตโนมัติก่อน
 * (ป้องกัน staff ลืมปิด → เปิดใหม่)
 *
 * @param staffId - LINE userId ของ staff
 * @param activityId - UUID ของ activity/ฐานที่จะประจำ
 */
export async function startStaffSession(staffId: string, activityId: string) {
  // ตรวจว่า activity มีจริง
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { id: true, name: true, nameTh: true, zone: true }
  });

  if (!activity) {
    throw new CheckinError('ACTIVITY_NOT_FOUND', 'ไม่พบฐานกิจกรรม / Activity not found');
  }

  // ปิด session เดิมที่ยังเปิดอยู่ (ถ้ามี)
  await prisma.staffSession.updateMany({
    where: { staffId, endedAt: null },
    data: { endedAt: new Date() }
  });

  // สร้าง session ใหม่
  const session = await prisma.staffSession.create({
    data: { staffId, activityId },
    include: { activity: { select: { name: true, nameTh: true, zone: true } } }
  });

  return {
    sessionId: session.id,
    activity: session.activity,
    startedAt: session.startedAt,
    message: `เริ่มแสกนที่ฐาน "${session.activity.nameTh}" / Started scanning at "${session.activity.name}"`
  };
}

/**
 * ปิด Staff Session — staff เลิกประจำฐาน
 */
export async function endStaffSession(sessionId: string, staffId: string) {
  const session = await prisma.staffSession.findUnique({
    where: { id: sessionId }
  });

  if (!session) {
    throw new CheckinError('SESSION_NOT_FOUND', 'ไม่พบ session / Session not found');
  }

  if (session.staffId !== staffId) {
    throw new CheckinError('FORBIDDEN', 'ไม่ใช่ session ของคุณ / Not your session');
  }

  if (session.endedAt) {
    throw new CheckinError('ALREADY_ENDED', 'Session ปิดไปแล้ว / Already ended');
  }

  await prisma.staffSession.update({
    where: { id: sessionId },
    data: { endedAt: new Date() }
  });

  return { success: true, message: 'ปิด session เรียบร้อย / Session ended' };
}

/**
 * ดึง active staff session ปัจจุบัน
 */
export async function getActiveStaffSession(staffId: string) {
  return prisma.staffSession.findFirst({
    where: { staffId, endedAt: null },
    include: { activity: { select: { id: true, name: true, nameTh: true, zone: true } } },
    orderBy: { startedAt: 'desc' }
  });
}

// ─── Scan QR Code ────────────────────────────────────────

/**
 * ประมวลผลการแสกน QR Code
 *
 * ขั้นตอน:
 *   1. Parse QR data → ได้ {type, id} + verify HMAC
 *   2. ดึงข้อมูลคนจาก DB
 *   3. ดึง StaffSession → รู้ว่า staff อยู่ฐานไหน (actualActivity)
 *   4. ดึง bookings ของคนจาก DB
 *   5. หา booking ที่ตรงกับ actualActivity
 *   6. ถ้ามี → เช็คเวลา → return ผลลัพธ์
 *   7. ถ้าไม่มี → return wrong_base หรือ no_booking
 *   8. สร้าง ScanLog (audit trail)
 *   9. ดึง stamp card
 *
 * @param qrData - QR data string ที่ staff แสกนได้ (e.g. "R:p:{uuid}:{hmac}")
 * @param staffSessionId - UUID ของ active staff session
 */
export async function processScan(qrData: string, staffSessionId: string): Promise<ScanResult> {
  // 1. Parse & verify QR data
  let parsed: { type: 'participant' | 'student'; id: string };
  try {
    parsed = parseQrData(qrData);
  } catch (error) {
    throw new CheckinError('INVALID_QR', (error as Error).message);
  }

  // 2. ดึงข้อมูลคนจาก DB
  const personInfo = await getPersonInfo(parsed.type, parsed.id);
  if (!personInfo) {
    throw new CheckinError('PERSON_NOT_FOUND', 'ไม่พบข้อมูลผู้เข้าร่วมในระบบ');
  }

  // 3. ดึง staff session → ฐานที่ staff อยู่
  const staffSession = await prisma.staffSession.findUnique({
    where: { id: staffSessionId },
    include: { activity: { select: { id: true, name: true, nameTh: true, zone: true } } }
  });

  if (!staffSession || staffSession.endedAt) {
    throw new CheckinError('SESSION_ENDED', 'Staff session ปิดแล้ว กรุณาเปิดใหม่');
  }

  const actualActivityId = staffSession.activityId;
  const isGateZone = staffSession.activity.zone === 'GATE';
  const now = new Date();

  // ─── Gate Check-in Flow ─────────────────────────────
  if (isGateZone) {
    // Staff อยู่ที่ประตู → ทำ gate check-in
    const personModel = parsed.type === 'participant' ? 'participant' : 'student';

    // เช็คว่าเข้างานแล้วหรือยัง
    const existing = parsed.type === 'participant'
      ? await prisma.participant.findUnique({ where: { id: parsed.id }, select: { gateCheckedInAt: true } })
      : await prisma.student.findUnique({ where: { id: parsed.id }, select: { gateCheckedInAt: true } });

    if (existing?.gateCheckedInAt) {
      // เข้างานแล้ว
      const scanLog = await prisma.scanLog.create({
        data: {
          participantId: parsed.type === 'participant' ? parsed.id : undefined,
          studentId: parsed.type === 'student' ? parsed.id : undefined,
          actualActivityId,
          result: 'gate_already',
          staffSessionId,
          staffId: staffSession.staffId
        }
      });

      const stamps = await getStamps(parsed.type, parsed.id);

      return {
        result: 'gate_already',
        scanLogId: scanLog.id,
        person: { id: parsed.id, type: parsed.type, name: personInfo.name, org: personInfo.org },
        message: `⚠️ เข้างานแล้วเมื่อ ${formatTime(existing.gateCheckedInAt)} — ไม่ต้องสแกนซ้ำ`,
        stamps
      };
    }

    // อัปเดต gateCheckedInAt
    if (parsed.type === 'participant') {
      await prisma.participant.update({ where: { id: parsed.id }, data: { gateCheckedInAt: now } });
    } else {
      await prisma.student.update({ where: { id: parsed.id }, data: { gateCheckedInAt: now } });
    }

    const scanLog = await prisma.scanLog.create({
      data: {
        participantId: parsed.type === 'participant' ? parsed.id : undefined,
        studentId: parsed.type === 'student' ? parsed.id : undefined,
        actualActivityId,
        result: 'gate_checked_in',
        staffSessionId,
        staffId: staffSession.staffId
      }
    });

    const stamps = await getStamps(parsed.type, parsed.id);

    return {
      result: 'gate_checked_in',
      scanLogId: scanLog.id,
      person: { id: parsed.id, type: parsed.type, name: personInfo.name, org: personInfo.org },
      message: `✅ ลงทะเบียนเข้างานสำเร็จ — ยินดีต้อนรับ ${personInfo.name}`,
      stamps
    };
  }

  // ─── ฐานกิจกรรม: ต้องเช็ค gate ก่อน ─────────────────
  const gateCheck = parsed.type === 'participant'
    ? await prisma.participant.findUnique({ where: { id: parsed.id }, select: { gateCheckedInAt: true } })
    : await prisma.student.findUnique({ where: { id: parsed.id }, select: { gateCheckedInAt: true } });

  if (!gateCheck?.gateCheckedInAt) {
    // ❌ ยังไม่ได้สแกนเข้างาน → Block
    const scanLog = await prisma.scanLog.create({
      data: {
        participantId: parsed.type === 'participant' ? parsed.id : undefined,
        studentId: parsed.type === 'student' ? parsed.id : undefined,
        actualActivityId,
        result: 'not_gate_checked_in',
        staffSessionId,
        staffId: staffSession.staffId
      }
    });

    const stamps = await getStamps(parsed.type, parsed.id);

    return {
      result: 'not_gate_checked_in',
      scanLogId: scanLog.id,
      person: { id: parsed.id, type: parsed.type, name: personInfo.name, org: personInfo.org },
      message: '❌ ยังไม่ได้สแกนเข้างาน — ต้องไปสแกนที่ประตูก่อน',
      stamps
    };
  }

  // 4. ตรวจว่าคนนี้เคย checked_in ที่ฐานนี้แล้วหรือยัง
  const alreadyCheckedIn = await prisma.scanLog.findFirst({
    where: {
      ...(parsed.type === 'participant'
        ? { participantId: parsed.id }
        : { studentId: parsed.id }),
      actualActivityId,
      result: 'checked_in'
    }
  });

  // 5. ดึง bookings ของคนจาก DB
  const slots = await getPersonBookings(parsed.type, parsed.id);

  // 6. หา booking ที่ตรงกับฐานปัจจุบัน
  const matchedSlot = slots.find(s => s.activityId === actualActivityId);

  // 7. Determine result
  let result: ScanResultType;
  let message: string;
  let matchedBooking: ScanResult['matchedBooking'] = undefined;
  let expectedBooking: ScanResult['expectedBooking'] = undefined;
  let bookingId: string | undefined;

  if (alreadyCheckedIn) {
    // ⚠️ เข้าฐานนี้แล้ว — ไม่ต้องประทับซ้ำ
    result = 'already_stamped';
    message = `⚠️ เข้าฐาน "${staffSession.activity.nameTh}" แล้วเมื่อ ${formatTime(alreadyCheckedIn.scannedAt)} — ไม่ต้องประทับซ้ำ`;

    if (matchedSlot) {
      bookingId = matchedSlot.bookingId;
      matchedBooking = {
        bookingId: matchedSlot.bookingId,
        activityName: matchedSlot.activityName,
        startTime: matchedSlot.startTime.toISOString(),
        endTime: matchedSlot.endTime.toISOString()
      };
    }
  } else if (matchedSlot) {
    // มี booking ตรงฐานนี้ → เช็คเวลา
    const isOnTime = isWithinTimeWindow(matchedSlot.startTime, matchedSlot.endTime, now);

    bookingId = matchedSlot.bookingId;
    matchedBooking = {
      bookingId: matchedSlot.bookingId,
      activityName: matchedSlot.activityName,
      startTime: matchedSlot.startTime.toISOString(),
      endTime: matchedSlot.endTime.toISOString()
    };

    if (isOnTime) {
      result = 'checked_in';
      message = `✅ ถูกฐาน ถูกเวลา — ${matchedSlot.activityName}`;
    } else {
      result = 'wrong_time';
      message = `⚠️ ถูกฐาน แต่ผิดเวลา — ควรเข้าเวลา ${formatTime(matchedSlot.startTime)}-${formatTime(matchedSlot.endTime)}`;
    }
  } else if (slots.length > 0) {
    // มี booking แต่ไม่ตรงฐานนี้
    result = 'wrong_base';
    const nearestSlot = findNearestSlot(slots, now);
    if (nearestSlot) {
      expectedBooking = {
        activityName: nearestSlot.activityName,
        startTime: nearestSlot.startTime.toISOString(),
        endTime: nearestSlot.endTime.toISOString()
      };
    }
    message = `⚠️ ผิดฐาน — ลงทะเบียนไว้ที่ "${nearestSlot?.activityName ?? 'ไม่ทราบ'}" ไม่ใช่ "${staffSession.activity.nameTh}"`;
  } else {
    // ไม่มี booking เลย
    result = 'no_booking';
    message = '❌ ไม่มีการจองกิจกรรมใดๆ';
  }

  // 8. สร้าง ScanLog (ทุก result รวม already_stamped → เก็บ audit trail)
  const scanLog = await prisma.scanLog.create({
    data: {
      participantId: parsed.type === 'participant' ? parsed.id : undefined,
      studentId: parsed.type === 'student' ? parsed.id : undefined,
      bookingId: bookingId ?? undefined,
      actualActivityId,
      expectedActivityId: matchedSlot?.activityId ?? (slots.length > 0 ? slots[0].activityId : undefined),
      expectedSessionStart: matchedSlot
        ? matchedSlot.startTime
        : undefined,
      result,
      staffSessionId,
      staffId: staffSession.staffId
    }
  });

  // 9. Stamp card
  const stamps = await getStamps(parsed.type, parsed.id);

  return {
    result,
    scanLogId: scanLog.id,
    person: {
      id: parsed.id,
      type: parsed.type,
      name: personInfo.name,
      org: personInfo.org
    },
    message,
    matchedBooking,
    expectedBooking,
    stamps
  };
}

// ─── Override ────────────────────────────────────────────

/**
 * Staff กดอนุมัติพิเศษ (override)
 *
 * ใช้เมื่อผลแสกนเป็น wrong_base หรือ wrong_time
 * staff ตัดสินใจอนุญาตให้เข้าฐานแม้ไม่ตรงตามที่จอง
 *
 * @param scanLogId - UUID ของ scan log ที่จะ override
 * @param staffId - LINE userId ของ staff (ตรวจสอบสิทธิ์)
 * @param note - หมายเหตุจาก staff (optional)
 */
export async function overrideScan(scanLogId: string, staffId: string, note?: string) {
  const scanLog = await prisma.scanLog.findUnique({
    where: { id: scanLogId }
  });

  if (!scanLog) {
    throw new CheckinError('NOT_FOUND', 'ไม่พบ scan log / Scan log not found');
  }

  if (scanLog.staffId !== staffId) {
    throw new CheckinError('FORBIDDEN', 'ไม่ใช่ scan ของคุณ / Not your scan');
  }

  if (scanLog.result === 'checked_in') {
    throw new CheckinError('ALREADY_CHECKED_IN', 'แสกนเรียบร้อยแล้ว / Already checked in');
  }

  await prisma.scanLog.update({
    where: { id: scanLogId },
    data: {
      result: 'checked_in',
      isOverride: true,
      note: note ?? null
    }
  });

  return { success: true, message: 'อนุมัติพิเศษเรียบร้อย / Override approved' };
}

// ─── Reject ──────────────────────────────────────────────

/**
 * Staff กดไม่อนุญาต (reject)
 */
export async function rejectScan(scanLogId: string, staffId: string, note?: string) {
  const scanLog = await prisma.scanLog.findUnique({
    where: { id: scanLogId }
  });

  if (!scanLog) {
    throw new CheckinError('NOT_FOUND', 'ไม่พบ scan log');
  }

  if (scanLog.staffId !== staffId) {
    throw new CheckinError('FORBIDDEN', 'ไม่ใช่ scan ของคุณ / Not your scan');
  }

  await prisma.scanLog.update({
    where: { id: scanLogId },
    data: { result: 'rejected', note: note ?? null }
  });

  return { success: true, message: 'ปฏิเสธเรียบร้อย / Rejected' };
}

// ─── Stamp Card ──────────────────────────────────────────

/**
 * ดึง stamp card ของคน — เข้าฐานไหนแล้วบ้าง
 *
 * แสดงรายการกิจกรรมทั้งหมด:
 *   ✅ เข้าแล้ว (มี scan_log result=checked_in)
 *   🔄 มี booking แต่ยังไม่ได้เข้า
 *   ⬜ ไม่ได้จอง
 */
async function getStamps(type: 'participant' | 'student', personId: string): Promise<StampInfo[]> {
  // ดึงกิจกรรมทั้งหมดที่เปิดอยู่
  const activities = await prisma.activity.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, nameTh: true }
  });

  // ดึง bookings ของคนนี้
  const bookingFilter = type === 'participant'
    ? { participantId: personId }
    : { studentId: personId };

  const bookings = await prisma.booking.findMany({
    where: { ...bookingFilter, status: 'CONFIRMED' },
    include: { session: { select: { activityId: true } } }
  });

  const bookedActivityIds = new Set(bookings.map(b => b.session.activityId));

  // ดึง scan logs ที่ checked_in
  const scanFilter = type === 'participant'
    ? { participantId: personId }
    : { studentId: personId };

  const scans = await prisma.scanLog.findMany({
    where: {
      ...scanFilter,
      result: 'checked_in'
    },
    select: { actualActivityId: true, scannedAt: true }
  });

  const scanMap = new Map(scans.map(s => [s.actualActivityId, s.scannedAt]));

  return activities.map(act => ({
    activityId: act.id,
    activityName: act.nameTh,
    scannedAt: scanMap.get(act.id) ?? null,
    hasBooking: bookedActivityIds.has(act.id)
  }));
}

/**
 * ดึง stamp card โดย public (ใช้จาก route)
 */
export async function getParticipantStamps(type: 'participant' | 'student', personId: string) {
  return getStamps(type, personId);
}

// ─── Manual Search ───────────────────────────────────────

/**
 * ค้นหาผู้เข้าร่วมจากชื่อ — ใช้เมื่อ QR มีปัญหา
 *
 * ค้นทั้ง participants + students
 * ใช้ ILIKE (case-insensitive) search
 *
 * @param query - ชื่อหรือนามสกุลที่จะค้น
 * @returns รายชื่อที่ตรง (จำกัด 20 คน)
 */
export async function searchPerson(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    throw new CheckinError('QUERY_TOO_SHORT', 'กรุณาพิมพ์อย่างน้อย 2 ตัวอักษร');
  }

  // ค้น participants
  const participants = await prisma.participant.findMany({
    where: {
      OR: [
        { firstName: { contains: trimmed, mode: 'insensitive' } },
        { lastName: { contains: trimmed, mode: 'insensitive' } },
        { nickname: { contains: trimmed, mode: 'insensitive' } }
      ]
    },
    select: {
      id: true, firstName: true, lastName: true, nickname: true,
      organization: true, participantType: true
    },
    take: 10
  });

  // ค้น students
  const students = await prisma.student.findMany({
    where: {
      OR: [
        { firstName: { contains: trimmed, mode: 'insensitive' } },
        { lastName: { contains: trimmed, mode: 'insensitive' } }
      ]
    },
    select: {
      id: true, firstName: true, lastName: true,
      classRoom: true, schoolName: true
    },
    take: 10
  });

  return {
    participants: participants.map(p => ({
      id: p.id,
      type: 'participant' as const,
      name: `${p.firstName} ${p.lastName}`,
      nickname: p.nickname,
      org: p.organization,
      participantType: p.participantType
    })),
    students: students.map(s => ({
      id: s.id,
      type: 'student' as const,
      name: `${s.firstName} ${s.lastName}`,
      classRoom: s.classRoom,
      schoolName: s.schoolName
    }))
  };
}

// ─── Helpers ─────────────────────────────────────────────

/**
 * เช็คว่าเวลาปัจจุบันอยู่ใน time window ของ session หรือไม่
 * โดยมี buffer ±15 นาที
 */
function isWithinTimeWindow(start: Date, end: Date, now: Date): boolean {
  const bufferMs = TIME_BUFFER_MINUTES * 60 * 1000;
  return now.getTime() >= start.getTime() - bufferMs
      && now.getTime() <= end.getTime() + bufferMs;
}

/**
 * หา slot ที่ใกล้เวลาปัจจุบันที่สุด
 */
function findNearestSlot(slots: BookingSlot[], now: Date) {
  if (slots.length === 0) return null;

  return slots.reduce((nearest, slot) => {
    const slotTime = slot.startTime.getTime();
    const nearestTime = nearest.startTime.getTime();
    const nowTime = now.getTime();

    return Math.abs(slotTime - nowTime) < Math.abs(nearestTime - nowTime)
      ? slot
      : nearest;
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok'
  });
}

// ─── Custom Error ────────────────────────────────────────

export class CheckinError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'CheckinError';
  }
}
