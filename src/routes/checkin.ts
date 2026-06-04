/**
 * Check-in Routes
 * ─────────────────────────────────────────────────────────────
 *
 * API endpoints สำหรับเจ้าหน้าที่ (Staff) ใช้วันงาน:
 *
 *   POST /api/staff/login             → login ด้วยรหัสฐาน
 *   GET  /api/staff/session/active    → ดู session ปัจจุบัน
 *   POST /api/checkin/scan            → แสกน QR Code
 *   POST /api/checkin/:id/override    → อนุมัติพิเศษ
 *   POST /api/checkin/:id/reject      → ปฏิเสธ
 *   GET  /api/checkin/stamps/:type/:id → ดู stamp card
 *   GET  /api/checkin/search          → ค้นหาจากชื่อ
 *
 * Auth: ใช้ X-Staff-Session header (staffSessionId)
 *
 * ─────────────────────────────────────────────────────────────
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import {
  startStaffSession,
  processScan,
  overrideScan,
  rejectScan,
  getParticipantStamps,
  searchPerson,
  CheckinError
} from '../services/checkin.service.js';

export async function checkinRoutes(app: FastifyInstance) {

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ─── Helper: ตรวจ staff session จาก header ─────────────

  async function requireStaffSession(request: any, reply: any) {
    const sessionId = request.headers['x-staff-session'] as string;
    if (!sessionId) {
      reply.status(401).send({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing X-Staff-Session header' }
      });
      return null;
    }

    if (!UUID_REGEX.test(sessionId)) {
      reply.status(401).send({
        ok: false,
        error: { code: 'SESSION_EXPIRED', message: 'Staff session รูปแบบไม่ถูกต้อง กรุณา login ใหม่' }
      });
      return null;
    }

    const session = await prisma.staffSession.findUnique({
      where: { id: sessionId },
      include: { activity: { select: { id: true, name: true, nameTh: true } } }
    });

    if (!session || session.endedAt) {
      reply.status(401).send({
        ok: false,
        error: { code: 'SESSION_EXPIRED', message: 'Staff session หมดอายุ กรุณา login ใหม่' }
      });
      return null;
    }

    return session;
  }

  // ─── POST /api/staff/login ─────────────────────────────
  // Login ด้วยรหัสฐาน → auto-create StaffSession
  //
  // Body: { boothCode: string }
  // Response: { staffSessionId, activity }

  app.post('/api/staff/login', async (request, reply) => {
    try {
      const { boothCode } = request.body as { boothCode?: string };

      if (!boothCode) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'กรุณากรอกรหัสฐาน' }
        });
      }

      // ค้นหา activity จาก booth code
      const activity = await prisma.activity.findUnique({
        where: { boothCode: boothCode.trim().toUpperCase() },
        select: { id: true, name: true, nameTh: true, zone: true }
      });

      if (!activity) {
        return reply.status(401).send({
          ok: false,
          error: { code: 'INVALID_CODE', message: 'รหัสฐานไม่ถูกต้อง' }
        });
      }

      // สร้าง StaffSession (ใช้ boothCode เป็น staffId)
      const result = await startStaffSession(`booth:${boothCode}`, activity.id);

      return reply.status(201).send({ ok: true, data: result });

    } catch (error) {
      if (error instanceof CheckinError) {
        return reply.status(400).send({
          ok: false,
          error: { code: error.code, message: error.message }
        });
      }
      app.log.error(error);
      return reply.status(400).send({
        ok: false,
        error: { code: 'UNEXPECTED_ERROR', message: (error as Error).message || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ' }
      });
    }
  });

  // ─── GET /api/staff/session/active ─────────────────────
  // ดึง session ปัจจุบันจาก header

  app.get('/api/staff/session/active', async (request, reply) => {
    const session = await requireStaffSession(request, reply);
    if (!session) return;

    return reply.send({ ok: true, data: session });
  });

  // ─── POST /api/checkin/scan ────────────────────────────
  // แสกน QR Code → ได้ผลลัพธ์
  //
  // Body: { qrData: string }
  // Header: X-Staff-Session

  app.post('/api/checkin/scan', async (request, reply) => {
    const session = await requireStaffSession(request, reply);
    if (!session) return;

    try {
      const { qrData } = request.body as { qrData?: string };

      if (!qrData) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'qrData is required' }
        });
      }

      const result = await processScan(qrData, session.id);
      return reply.send({ ok: true, data: result });

    } catch (error) {
      if (error instanceof CheckinError) {
        return reply.status(400).send({
          ok: false,
          error: { code: error.code, message: error.message }
        });
      }
      app.log.error(error);
      return reply.status(400).send({
        ok: false,
        error: { code: 'UNEXPECTED_ERROR', message: (error as Error).message || 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์การสแกน' }
      });
    }
  });

  // ─── POST /api/checkin/:id/override ────────────────────
  // อนุมัติพิเศษ

  app.post<{ Params: { id: string } }>(
    '/api/checkin/:id/override',
    async (request, reply) => {
      const session = await requireStaffSession(request, reply);
      if (!session) return;

      const { id } = request.params;
      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'รหัสอ้างอิงการสแกนไม่ถูกต้อง' }
        });
      }

      try {
        const { note } = (request.body as { note?: string }) ?? {};
        const result = await overrideScan(id, session.staffId, note);
        return reply.send({ ok: true, ...result });
      } catch (error) {
        if (error instanceof CheckinError) {
          return reply.status(400).send({
            ok: false,
            error: { code: error.code, message: error.message }
          });
        }
        app.log.error(error);
        return reply.status(400).send({
          ok: false,
          error: { code: 'UNEXPECTED_ERROR', message: (error as Error).message || 'เกิดข้อผิดพลาดในการอนุมัติพิเศษ' }
        });
      }
    }
  );

  // ─── POST /api/checkin/:id/reject ──────────────────────

  app.post<{ Params: { id: string } }>(
    '/api/checkin/:id/reject',
    async (request, reply) => {
      const session = await requireStaffSession(request, reply);
      if (!session) return;

      const { id } = request.params;
      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'รหัสอ้างอิงการสแกนไม่ถูกต้อง' }
        });
      }

      try {
        const { note } = (request.body as { note?: string }) ?? {};
        const result = await rejectScan(id, session.staffId, note);
        return reply.send({ ok: true, ...result });
      } catch (error) {
        if (error instanceof CheckinError) {
          return reply.status(400).send({
            ok: false,
            error: { code: error.code, message: error.message }
          });
        }
        app.log.error(error);
        return reply.status(400).send({
          ok: false,
          error: { code: 'UNEXPECTED_ERROR', message: (error as Error).message || 'เกิดข้อผิดพลาดในการปฏิเสธเช็คอิน' }
        });
      }
    }
  );

  // ─── GET /api/checkin/stamps/:type/:id ─────────────────

  app.get<{ Params: { type: string; id: string } }>(
    '/api/checkin/stamps/:type/:id',
    async (request, reply) => {
      const session = await requireStaffSession(request, reply);
      if (!session) return;

      const { type, id } = request.params;
      if (type !== 'participant' && type !== 'student') {
        return reply.status(400).send({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'type must be "participant" or "student"' }
        });
      }

      if (!UUID_REGEX.test(id)) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'รหัสผู้ใช้ไม่ถูกต้อง' }
        });
      }

      try {
        const stamps = await getParticipantStamps(type, id);
        return reply.send({ ok: true, data: stamps });
      } catch (error) {
        app.log.error(error);
        return reply.status(400).send({
          ok: false,
          error: { code: 'UNEXPECTED_ERROR', message: (error as Error).message || 'เกิดข้อผิดพลาดในการดึงข้อมูลแสตมป์' }
        });
      }
    }
  );

  // ─── GET /api/checkin/search ───────────────────────────

  app.get('/api/checkin/search', async (request, reply) => {
    const session = await requireStaffSession(request, reply);
    if (!session) return;

    try {
      const { q } = request.query as { q?: string };
      if (!q) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'q query parameter is required' }
        });
      }

      const results = await searchPerson(q);
      return reply.send({ ok: true, data: results });
    } catch (error) {
      if (error instanceof CheckinError) {
        return reply.status(400).send({
          ok: false,
          error: { code: error.code, message: error.message }
        });
      }
      app.log.error(error);
      return reply.status(400).send({
        ok: false,
        error: { code: 'UNEXPECTED_ERROR', message: (error as Error).message || 'เกิดข้อผิดพลาดในการค้นหาผู้เข้าร่วม' }
      });
    }
  });

  // ─── GET /api/checkin/bookings ─────────────────────────
  // ดึงรายชื่อผู้ลงทะเบียนล่วงหน้าสำหรับกิจกรรมของสตาฟที่ล็อกอินอยู่
  app.get('/api/checkin/bookings', async (request, reply) => {
    const session = await requireStaffSession(request, reply);
    if (!session) return;

    try {
      const bookings = await prisma.booking.findMany({
        where: {
          session: {
            activityId: session.activityId
          },
          status: 'CONFIRMED'
        },
        include: {
          participant: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              nickname: true,
              organization: true,
              shortCode: true
            }
          },
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              schoolName: true,
              classRoom: true,
              shortCode: true
            }
          },
          session: {
            select: {
              id: true,
              startTime: true,
              endTime: true
            }
          }
        },
        orderBy: [
          { session: { startTime: 'asc' } },
          { createdAt: 'asc' }
        ]
      });

      // ดึง scan_logs ที่ checked_in ของกิจกรรมนี้ในวันงานมาด้วย เพื่อหาว่าใครเช็คอินแล้วบ้าง
      const checkedInLogs = await prisma.scanLog.findMany({
        where: {
          actualActivityId: session.activityId,
          result: 'checked_in'
        },
        select: {
          participantId: true,
          studentId: true,
          scannedAt: true
        }
      });

      const checkedInParticipants = new Set(checkedInLogs.map(log => log.participantId).filter(Boolean));
      const checkedInStudents = new Set(checkedInLogs.map(log => log.studentId).filter(Boolean));

      const list = bookings.map(b => {
        const isParticipant = !!b.participant;
        const person = isParticipant ? b.participant : b.student;
        const isAttended = isParticipant 
          ? checkedInParticipants.has(b.participantId)
          : checkedInStudents.has(b.studentId);

        return {
          bookingId: b.id,
          sessionId: b.session.id,
          startTime: b.session.startTime,
          endTime: b.session.endTime,
          person: person ? {
            id: person.id,
            name: `${person.firstName} ${person.lastName}`,
            nickname: isParticipant ? (person as any).nickname || '' : '',
            org: isParticipant ? (person as any).organization : (person as any).schoolName || '',
            classRoom: !isParticipant ? (person as any).classRoom || '' : '',
            shortCode: person.shortCode
          } : null,
          isAttended
        };
      });

      return reply.send({ ok: true, data: list });
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({
        ok: false,
        error: { code: 'UNEXPECTED_ERROR', message: 'เกิดข้อผิดพลาดในการดึงรายชื่อผู้ลงทะเบียน' }
      });
    }
  });
}
