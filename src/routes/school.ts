import type { FastifyInstance } from 'fastify';
import { resolveAuth } from '../lib/liff-auth.js';
import { prisma } from '../lib/prisma.js';
import {
  parseStudentExcel, createStudents, getStudentsByTeacher,
  bookSessionsForStudent, deleteStudent, assertTeacherOwnsStudent, SchoolError
} from '../services/school.service.js';
import { generateStudentQr, generateBulkStudentQr } from '../services/qr.service.js';

export async function schoolRoutes(app: FastifyInstance) {

  async function requireTeacher(request: any, reply: any) {
    const auth = await resolveAuth(request.headers);
    if (!auth) {
      reply.status(401).send({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
      return null;
    }
    const participant = await prisma.participant.findUnique({
      where: { lineUserId: auth.userId },
      select: { id: true, firstName: true, lastName: true, participantType: true }
    });
    if (!participant) {
      reply.status(404).send({ ok: false, error: { code: 'NOT_REGISTERED', message: 'ครูต้องลงทะเบียนก่อน' } });
      return null;
    }
    if (participant.participantType !== 'TEACHER') {
      reply.status(403).send({ ok: false, error: { code: 'TEACHER_ONLY', message: 'ฟังก์ชันนี้ใช้ได้เฉพาะผู้ลงทะเบียนประเภทครู' } });
      return null;
    }
    return { auth, participant };
  }

  // POST /api/school/upload-preview — อัปโหลด Excel → preview
  app.post('/api/school/upload-preview', async (request, reply) => {
    const t = await requireTeacher(request, reply);
    if (!t) return;
    try {
      const file = await request.file();
      if (!file) return reply.status(400).send({ ok: false, error: { code: 'NO_FILE', message: 'กรุณาอัปโหลดไฟล์ Excel' } });
      const buffer = await file.toBuffer();
      const result = await parseStudentExcel(buffer);
      return reply.send({ ok: true, data: result });
    } catch (error) {
      return reply.status(400).send({ ok: false, error: { code: 'PARSE_ERROR', message: (error as Error).message } });
    }
  });

  // POST /api/school/students — ยืนยันสร้าง students
  app.post('/api/school/students', async (request, reply) => {
    const t = await requireTeacher(request, reply);
    if (!t) return;
    try {
      const { students } = request.body as { students: Array<{ firstName: string; lastName: string; studentCode?: string; classRoom?: string; schoolName?: string }> };
      if (!students?.length) return reply.status(400).send({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'ต้องส่งข้อมูลนักเรียน' } });
      const result = await createStudents(t.participant.id, students);
      return reply.status(201).send({ ok: true, data: result });
    } catch (error) {
      if (error instanceof SchoolError) return reply.status(400).send({ ok: false, error: { code: error.code, message: error.message } });
      throw error;
    }
  });

  // GET /api/school/students — ดูรายชื่อนักเรียน + bookings
  app.get('/api/school/students', async (request, reply) => {
    const t = await requireTeacher(request, reply);
    if (!t) return;
    const students = await getStudentsByTeacher(t.participant.id);
    return reply.send({ ok: true, data: students });
  });

  // POST /api/school/students/:id/book — จองรอบให้นักเรียน
  app.post<{ Params: { id: string } }>('/api/school/students/:id/book', async (request, reply) => {
    const t = await requireTeacher(request, reply);
    if (!t) return;
    try {
      const { sessionIds } = request.body as { sessionIds: string[] };
      const result = await bookSessionsForStudent(request.params.id, sessionIds, t.participant.id);
      return reply.status(201).send({ ok: true, data: result });
    } catch (error) {
      if (error instanceof SchoolError) {
        const status: Record<string, number> = { SESSION_FULL: 409, TIME_OVERLAP: 400, SESSION_NOT_FOUND: 404, STUDENT_NOT_FOUND: 404, FORBIDDEN: 403 };
        return reply.status(status[error.code] ?? 400).send({ ok: false, error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });

  // DELETE /api/school/students/:id — ลบนักเรียน
  app.delete<{ Params: { id: string } }>('/api/school/students/:id', async (request, reply) => {
    const t = await requireTeacher(request, reply);
    if (!t) return;
    try {
      const result = await deleteStudent(request.params.id, t.participant.id);
      return reply.send({ ok: true, ...result });
    } catch (error) {
      if (error instanceof SchoolError) {
        return reply.status(error.code === 'FORBIDDEN' ? 403 : 404).send({ ok: false, error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });

  // GET /api/school/students/:id/qr — QR ของนักเรียนคนเดียว
  app.get<{ Params: { id: string } }>('/api/school/students/:id/qr', async (request, reply) => {
    const t = await requireTeacher(request, reply);
    if (!t) return;
    try {
      await assertTeacherOwnsStudent(request.params.id, t.participant.id);
      const qr = await generateStudentQr(request.params.id);
      return reply.send({ ok: true, data: qr });
    } catch (error) {
      if (error instanceof SchoolError) {
        const status: Record<string, number> = { STUDENT_NOT_FOUND: 404, FORBIDDEN: 403 };
        return reply.status(status[error.code] ?? 400).send({ ok: false, error: { code: error.code, message: error.message } });
      }
      return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: (error as Error).message } });
    }
  });

  // GET /api/school/qr-codes — QR ทั้งหมดของนักเรียน (bulk)
  app.get('/api/school/qr-codes', async (request, reply) => {
    const t = await requireTeacher(request, reply);
    if (!t) return;
    const qrCodes = await generateBulkStudentQr(t.participant.id);
    return reply.send({ ok: true, data: qrCodes, count: qrCodes.length });
  });
}
