import { prisma } from '../lib/prisma.js';
import { generateUniqueShortCode } from '../lib/shortCode.js';
import type { RegistrationInput, UpdateRegistrationInput } from './validation.service.js';

// ─── Types ───────────────────────────────────────────────

interface SessionTimeRange {
  id: string;
  startTime: Date;
  endTime: Date;
  capacity: number;
  bookedCount: number;
  activityName: string;
}

// ─── Time Overlap Check ─────────────────────────────────

function hasTimeOverlap(sessions: SessionTimeRange[]): { hasOverlap: boolean; conflictA?: string; conflictB?: string } {
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i];
      const b = sessions[j];
      // Overlap: A starts before B ends AND B starts before A ends
      if (a.startTime < b.endTime && b.startTime < a.endTime) {
        return {
          hasOverlap: true,
          conflictA: `${a.activityName} (${formatTime(a.startTime)}-${formatTime(a.endTime)})`,
          conflictB: `${b.activityName} (${formatTime(b.startTime)}-${formatTime(b.endTime)})`
        };
      }
    }
  }
  return { hasOverlap: false };
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

// ─── Register ───────────────────────────────────────────

export async function registerParticipant(input: RegistrationInput) {
  const { selectedSessionIds, ...participantData } = input;

  // 1. Check if already registered
  const existing = await prisma.participant.findUnique({
    where: { lineUserId: input.lineUserId }
  });

  if (existing) {
    throw new RegistrationError(
      'ALREADY_REGISTERED',
      'คุณได้ลงทะเบียนแล้ว กรุณาใช้ฟังก์ชันแก้ไขแทน / You have already registered. Please use the update function instead.'
    );
  }

  // 2. Validate sessions (only if any selected)
  let sessions: Array<any> = [];
  if (selectedSessionIds.length > 0) {
    // Fetch selected sessions with activity info
    sessions = await prisma.session.findMany({
      where: { id: { in: selectedSessionIds } },
      include: { activity: { select: { id: true, name: true, nameTh: true } } }
    });

    if (sessions.length !== selectedSessionIds.length) {
      const foundIds = sessions.map((s: any) => s.id);
      const missingIds = selectedSessionIds.filter(id => !foundIds.includes(id));
      throw new RegistrationError(
        'SESSION_NOT_FOUND',
        `ไม่พบรอบกิจกรรมบางรอบ / Some sessions were not found: ${missingIds.join(', ')}`
      );
    }

    // 2.5 ป้องกันจองฐานเดียวกันซ้ำ (1 คน = 1 รอบต่อ 1 ฐาน)
    const activityIds = sessions.map((s: any) => s.activity.id);
    const duplicateActivity = sessions.find((s: any, i: number) =>
      activityIds.indexOf(s.activity.id) !== i
    );
    if (duplicateActivity) {
      throw new RegistrationError(
        'DUPLICATE_ACTIVITY',
        `ไม่สามารถจองฐาน "${duplicateActivity.activity.nameTh}" มากกว่า 1 รอบ / Cannot book "${duplicateActivity.activity.name}" more than once`
      );
    }

    // 3. Check time overlap
    const sessionRanges: SessionTimeRange[] = sessions.map((s: any) => ({
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      capacity: s.capacity,
      bookedCount: s.bookedCount,
      activityName: s.activity.nameTh
    }));

    const overlap = hasTimeOverlap(sessionRanges);
    if (overlap.hasOverlap) {
      throw new RegistrationError(
        'TIME_OVERLAP',
        `เวลาทับซ้อน: ${overlap.conflictA} กับ ${overlap.conflictB} / Time conflict between selected sessions`
      );
    }
  }

  // 4. Atomic transaction: create participant + bookings + increment counters
  const result = await prisma.$transaction(async (tx) => {
    // 4a. Lock sessions and verify capacity (only if sessions selected)
    if (selectedSessionIds.length > 0) {
      for (const sessionId of selectedSessionIds) {
        const locked = await tx.$queryRaw<Array<{ id: string; capacity: number; booked_count: number }>>`
          SELECT id, capacity, booked_count
          FROM sessions
          WHERE id = ${sessionId}::uuid
          FOR UPDATE
        `;

        if (!locked || locked.length === 0) {
          throw new RegistrationError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);
        }

        const sess = locked[0];
        if (sess.booked_count >= sess.capacity) {
          const sessionInfo = sessions.find((s: any) => s.id === sessionId);
          throw new RegistrationError(
            'SESSION_FULL',
            `รอบ ${sessionInfo?.activity.nameTh} (${formatTime(sessionInfo!.startTime)}-${formatTime(sessionInfo!.endTime)}) เต็มแล้ว / This session is full`
          );
        }
      }
    }

    // 4b. Generate short code for manual check-in
    const shortCode = await generateUniqueShortCode();

    // 4c. Create participant
    const participant = await tx.participant.create({
      data: {
        lineUserId: participantData.lineUserId,
        displayName: participantData.displayName ?? null,
        nationalityType: participantData.nationalityType,
        firstName: participantData.firstName,
        lastName: participantData.lastName,
        nickname: participantData.nickname,
        dateOfBirth: new Date(participantData.dateOfBirth),
        email: participantData.email,
        phoneNumber: participantData.phoneNumber,
        country: participantData.country ?? null,
        participantType: participantData.participantType,
        organization: participantData.organization,
        faculty: participantData.faculty ?? null,
        facultyOther: participantData.facultyOther ?? null,
        department: participantData.department ?? null,
        departmentOther: participantData.departmentOther ?? null,
        pdpaConsent: participantData.pdpaConsent,
        mediaConsent: participantData.mediaConsent,
        shortCode
      }
    });

    // 4c. Create bookings + increment booked_count (only if sessions selected)
    if (selectedSessionIds.length > 0) {
      for (const sessionId of selectedSessionIds) {
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

  // 5. Return full registration with bookings
  return getParticipantWithBookings(result.id);
}

// ─── Update Registration ─────────────────────────────────

export async function updateRegistration(lineUserId: string, input: UpdateRegistrationInput) {
  const { selectedSessionIds, ...updateData } = input;

  // 1. Find existing participant
  const existing = await prisma.participant.findUnique({
    where: { lineUserId },
    include: { bookings: true }
  });

  if (!existing) {
    throw new RegistrationError('NOT_FOUND', 'ไม่พบข้อมูลลงทะเบียน / Registration not found');
  }

  // 2. If sessions are being updated
  if (selectedSessionIds && selectedSessionIds.length > 0) {
    // Fetch new sessions
    const newSessions = await prisma.session.findMany({
      where: { id: { in: selectedSessionIds } },
      include: { activity: { select: { id: true, name: true, nameTh: true } } }
    });

    if (newSessions.length !== selectedSessionIds.length) {
      throw new RegistrationError('SESSION_NOT_FOUND', 'ไม่พบรอบกิจกรรมบางรอบ');
    }

    // ป้องกันจองฐานเดียวกันซ้ำ (1 คน = 1 รอบต่อ 1 ฐาน)
    const activityIds = newSessions.map(s => s.activity.id);
    const duplicateActivity = newSessions.find((s, i) =>
      activityIds.indexOf(s.activity.id) !== i
    );
    if (duplicateActivity) {
      throw new RegistrationError(
        'DUPLICATE_ACTIVITY',
        `ไม่สามารถจองฐาน "${duplicateActivity.activity.nameTh}" มากกว่า 1 รอบ / Cannot book "${duplicateActivity.activity.name}" more than once`
      );
    }

    // Check time overlap
    const sessionRanges: SessionTimeRange[] = newSessions.map(s => ({
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      capacity: s.capacity,
      bookedCount: s.bookedCount,
      activityName: s.activity.nameTh
    }));

    const overlap = hasTimeOverlap(sessionRanges);
    if (overlap.hasOverlap) {
      throw new RegistrationError(
        'TIME_OVERLAP',
        `เวลาทับซ้อน: ${overlap.conflictA} กับ ${overlap.conflictB}`
      );
    }

    // Atomic transaction: update participant + replace bookings
    await prisma.$transaction(async (tx) => {
      // Update participant data
      const cleanData = Object.fromEntries(
        Object.entries(updateData).filter(([, v]) => v !== undefined)
      );

      if (cleanData.dateOfBirth) {
        cleanData.dateOfBirth = new Date(cleanData.dateOfBirth as string) as any;
      }

      if (Object.keys(cleanData).length > 0) {
        await tx.participant.update({
          where: { id: existing.id },
          data: cleanData
        });
      }

      // Decrement old bookings
      const oldBookingSessionIds = existing.bookings
        .filter(b => b.status === 'CONFIRMED')
        .map(b => b.sessionId);

      for (const oldSessionId of oldBookingSessionIds) {
        // Lock and decrement
        await tx.$queryRaw`
          SELECT id FROM sessions WHERE id = ${oldSessionId}::uuid FOR UPDATE
        `;
        await tx.session.update({
          where: { id: oldSessionId },
          data: { bookedCount: { decrement: 1 } }
        });
      }

      // Delete old bookings
      await tx.booking.deleteMany({
        where: { participantId: existing.id }
      });

      // Lock new sessions and verify capacity
      for (const sessionId of selectedSessionIds) {
        const locked = await tx.$queryRaw<Array<{ id: string; capacity: number; booked_count: number }>>`
          SELECT id, capacity, booked_count
          FROM sessions
          WHERE id = ${sessionId}::uuid
          FOR UPDATE
        `;

        if (!locked || locked.length === 0) {
          throw new RegistrationError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);
        }

        // Capacity check: if participant was already in this session, the count was decremented above
        const sess = locked[0];
        if (sess.booked_count >= sess.capacity) {
          const sessionInfo = newSessions.find(s => s.id === sessionId);
          throw new RegistrationError(
            'SESSION_FULL',
            `รอบ ${sessionInfo?.activity.nameTh} เต็มแล้ว / Session is full`
          );
        }

        // Create new booking + increment
        await tx.booking.create({
          data: { participantId: existing.id, sessionId }
        });

        await tx.session.update({
          where: { id: sessionId },
          data: { bookedCount: { increment: 1 } }
        });
      }
    });
  } else {
    // Only update participant data, no session changes
    const cleanData = Object.fromEntries(
      Object.entries(updateData).filter(([, v]) => v !== undefined)
    );

    if (cleanData.dateOfBirth) {
      cleanData.dateOfBirth = new Date(cleanData.dateOfBirth as string) as any;
    }

    if (Object.keys(cleanData).length > 0) {
      await prisma.participant.update({
        where: { id: existing.id },
        data: cleanData
      });
    }
  }

  return getParticipantWithBookings(existing.id);
}

// ─── Get Participant + Bookings ──────────────────────────

export async function getParticipantByLineUserId(lineUserId: string) {
  const participant = await prisma.participant.findUnique({
    where: { lineUserId }
  });

  if (!participant) return null;

  return getParticipantWithBookings(participant.id);
}

async function getParticipantWithBookings(participantId: string) {
  return prisma.participant.findUnique({
    where: { id: participantId },
    include: {
      bookings: {
        where: { status: 'CONFIRMED' },
        include: {
          session: {
            include: {
              activity: {
                select: { id: true, name: true, nameTh: true, zone: true }
              }
            }
          }
        },
        orderBy: { session: { startTime: 'asc' } }
      }
    }
  });
}

// ─── Cancel Booking ──────────────────────────────────────

export async function cancelBooking(bookingId: string, lineUserId: string) {
  // Verify ownership
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { participant: { select: { lineUserId: true } } }
  });

  if (!booking) {
    throw new RegistrationError('NOT_FOUND', 'ไม่พบการจอง / Booking not found');
  }

  if (booking.participant?.lineUserId !== lineUserId) {
    throw new RegistrationError('FORBIDDEN', 'ไม่มีสิทธิ์ยกเลิกการจองนี้ / Not authorized');
  }

  if (booking.status === 'CANCELLED') {
    throw new RegistrationError('ALREADY_CANCELLED', 'การจองนี้ถูกยกเลิกไปแล้ว / Already cancelled');
  }

  // Atomic: cancel booking + decrement count
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM sessions WHERE id = ${booking.sessionId}::uuid FOR UPDATE
    `;

    await tx.booking.update({
      where: { id: bookingId },
      data: { status: 'CANCELLED' }
    });

    await tx.session.update({
      where: { id: booking.sessionId },
      data: { bookedCount: { decrement: 1 } }
    });
  });

  return { success: true, message: 'ยกเลิกการจองเรียบร้อย / Booking cancelled' };
}

// ─── Custom Error ────────────────────────────────────────

export class RegistrationError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'RegistrationError';
  }
}
