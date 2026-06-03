/**
 * Admin Student Import Routes — Excel V2
 * ─────────────────────────────────────────────────────────────
 *
 * ⚠️ ไฟล์นี้ยังไม่ได้ deploy — เตรียมโค้ดไว้ local เท่านั้น
 *
 * Endpoints:
 *   POST /api/admin/import/preview     → อัปโหลด Excel → preview ข้อมูล
 *   POST /api/admin/import/confirm     → ยืนยัน import → สร้าง students + bookings
 *   GET  /api/admin/import/template    → ดาวน์โหลด template Excel V2
 *   GET  /api/admin/students           → ดูรายชื่อ students ทั้งหมด (+ bookings + QR)
 *
 * วิธี Register:
 *   ใน index.ts เพิ่ม:
 *     import { adminImportRoutes } from './routes/admin-import.js';
 *     app.register(adminImportRoutes);
 */

import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import {
  parseStudentExcelV2,
  importStudentsWithBookings,
  resolveTeacher,
  ImportError
} from '../services/admin-import.service.js';
import { generateBulkStudentQr } from '../services/qr.service.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

export async function adminImportRoutes(app: FastifyInstance) {

  // ─── Auth (reuse admin token verification) ──────────
  function verifyAdminToken(token: string): boolean {
    try {
      const [payloadB64, sig] = token.split('.');
      if (!payloadB64 || !sig) return false;
      const payload = Buffer.from(payloadB64, 'base64').toString();
      const ts = parseInt(payload.split(':')[1]);
      if (Date.now() - ts > 12 * 60 * 60 * 1000) return false;
      const expected = createHmac('sha256', env.JWT_SECRET).update(payload).digest('hex');
      return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch { return false; }
  }

  async function requireAdmin(request: any, reply: any) {
    const adminToken = request.headers['x-admin-token'];
    if (adminToken && typeof adminToken === 'string' && verifyAdminToken(adminToken)) {
      return true;
    }
    reply.status(401).send({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: 'Admin token required' }
    });
    return false;
  }

  // ═══════════════════════════════════════════════════════
  // POST /api/admin/import/preview
  // อัปโหลด Excel → parse → return preview (ไม่บันทึก DB)
  // ═══════════════════════════════════════════════════════
  app.post('/api/admin/import/preview', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;

    try {
      const file = await request.file();
      if (!file) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'NO_FILE', message: 'กรุณาอัปโหลดไฟล์ Excel (.xlsx)' }
        });
      }

      // ตรวจ file type
      const ext = path.extname(file.filename).toLowerCase();
      if (ext !== '.xlsx') {
        return reply.status(400).send({
          ok: false,
          error: { code: 'INVALID_FILE', message: 'รองรับเฉพาะไฟล์ .xlsx เท่านั้น' }
        });
      }

      const buffer = await file.toBuffer();
      const result = await parseStudentExcelV2(buffer);

      return reply.send({
        ok: true,
        data: {
          ...result,
          message: result.valid.length > 0
            ? `พบข้อมูลนักเรียน ${result.valid.length} คน พร้อม import`
            : 'ไม่พบข้อมูลนักเรียนในไฟล์'
        }
      });

    } catch (error) {
      return reply.status(400).send({
        ok: false,
        error: { code: 'PARSE_ERROR', message: (error as Error).message }
      });
    }
  });

  // ═══════════════════════════════════════════════════════
  // POST /api/admin/import/confirm
  // ยืนยัน import → สร้าง students + bookings
  //
  // Body:
  //   teacherId: string (UUID หรือ LINE User ID ของครู)
  //   students: StudentImportRow[] (จาก preview)
  //   generateQr: boolean (default: true)
  // ═══════════════════════════════════════════════════════
  app.post('/api/admin/import/confirm', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;

    try {
      const { teacherId, students, generateQr = true } = request.body as {
        teacherId: string;
        students: any[];
        generateQr?: boolean;
      };

      if (!teacherId) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'MISSING_TEACHER', message: 'ต้องระบุ teacherId' }
        });
      }

      if (!students?.length) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'NO_STUDENTS', message: 'ไม่มีข้อมูลนักเรียน' }
        });
      }

      // Resolve teacher (UUID or LINE User ID)
      const teacher = await resolveTeacher(teacherId);

      // Import!
      const result = await importStudentsWithBookings(
        teacher.id,
        students,
        generateQr
      );

      return reply.status(201).send({
        ok: true,
        data: {
          ...result,
          teacher: `${teacher.firstName} ${teacher.lastName}`,
          message: `สร้างนักเรียน ${result.studentsCreated} คน, จองกิจกรรม ${result.bookingsCreated} รายการ`
        }
      });

    } catch (error) {
      if (error instanceof ImportError) {
        return reply.status(400).send({
          ok: false,
          error: { code: error.code, message: error.message }
        });
      }
      throw error;
    }
  });

  // ═══════════════════════════════════════════════════════
  // GET /api/admin/import/template
  // ดาวน์โหลด template Excel V2
  // ═══════════════════════════════════════════════════════
  app.get('/api/admin/import/template', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;

    // Template อยู่ที่ root project directory
    const templatePath = path.resolve(process.cwd(), '..', 'student_import_template_v2.xlsx');

    if (!fs.existsSync(templatePath)) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'ไม่พบไฟล์ template — ให้ run gen-template-v2.ts ก่อน' }
      });
    }

    const buffer = fs.readFileSync(templatePath);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="student_import_template_v2.xlsx"');
    return reply.send(buffer);
  });

  // ═══════════════════════════════════════════════════════
  // GET /api/admin/students
  // ดูรายชื่อ students ทั้งหมด + bookings + teacher info
  // ═══════════════════════════════════════════════════════
  app.get('/api/admin/students', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;

    const { page = '1', limit = '50', teacherId, search } = request.query as any;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: any = {};
    if (teacherId) where.teacherId = teacherId;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { studentCode: { contains: search, mode: 'insensitive' } },
        { shortCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        skip,
        take: parseInt(limit),
        include: {
          teacher: { select: { id: true, firstName: true, lastName: true, organization: true } },
          bookings: {
            where: { status: 'CONFIRMED' },
            include: {
              session: {
                include: {
                  activity: { select: { id: true, nameTh: true, zone: true } }
                }
              }
            },
            orderBy: { session: { startTime: 'asc' } }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.student.count({ where })
    ]);

    return reply.send({
      ok: true,
      data: students,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  });

  // ═══════════════════════════════════════════════════════
  // GET /api/admin/students/:teacherId/qr-codes
  // ดาวน์โหลด QR ทั้งหมดของนักเรียนครูคนหนึ่ง
  // ═══════════════════════════════════════════════════════
  app.get<{ Params: { teacherId: string } }>(
    '/api/admin/students/:teacherId/qr-codes',
    async (request, reply) => {
      if (!await requireAdmin(request, reply)) return;

      try {
        const qrCodes = await generateBulkStudentQr(request.params.teacherId);
        return reply.send({ ok: true, data: qrCodes, count: qrCodes.length });
      } catch (error) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'QR_ERROR', message: (error as Error).message }
        });
      }
    }
  );

  // ═══════════════════════════════════════════════════════
  // GET /api/admin/teachers
  // ดูรายชื่อครู (participants ที่ participantType=TEACHER)
  // สำหรับ dropdown เลือกครูก่อน import
  // ═══════════════════════════════════════════════════════
  app.get('/api/admin/teachers', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;

    const teachers = await prisma.participant.findMany({
      where: { participantType: 'TEACHER' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        organization: true,
        lineUserId: true,
        _count: { select: { students: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return reply.send({
      ok: true,
      data: teachers.map(t => ({
        ...t,
        studentCount: t._count.students,
        _count: undefined
      }))
    });
  });
}
