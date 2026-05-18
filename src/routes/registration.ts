import type { FastifyInstance } from 'fastify';
import { resolveAuth } from '../lib/liff-auth.js';
import { prisma } from '../lib/prisma.js';
import { generateParticipantQr } from '../services/qr.service.js';
import { registrationSchema, updateRegistrationSchema } from '../services/validation.service.js';
import {
  registerParticipant,
  updateRegistration,
  getParticipantByLineUserId,
  RegistrationError
} from '../services/registration.service.js';

export async function registrationRoutes(app: FastifyInstance) {

  // ─── Helper: resolve auth (dev mode or LINE token) ────
  async function requireAuth(request: any, reply: any) {
    const auth = await resolveAuth(request.headers);
    if (!auth) {
      reply.status(401).send({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization token' }
      });
      return null;
    }
    return auth;
  }

  /**
   * POST /api/registration
   * ลงทะเบียนใหม่ — ข้อมูลส่วนตัว + เลือกรอบกิจกรรม
   */
  app.post('/api/registration', async (request, reply) => {
    try {
      const auth = await requireAuth(request, reply);
      if (!auth) return;

      const body = request.body as Record<string, unknown>;
      const parseResult = registrationSchema.safeParse({
        ...body,
        lineUserId: auth.userId,
        displayName: auth.displayName
      });

      if (!parseResult.success) {
        return reply.status(400).send({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลไม่ถูกต้อง / Validation failed',
            details: parseResult.error.issues.map(issue => ({
              field: issue.path.join('.'),
              message: issue.message
            }))
          }
        });
      }

      const result = await registerParticipant(parseResult.data);

      return reply.status(201).send({
        ok: true,
        message: 'ลงทะเบียนสำเร็จ / Registration successful',
        data: result
      });

    } catch (error) {
      if (error instanceof RegistrationError) {
        const statusMap: Record<string, number> = {
          'ALREADY_REGISTERED': 409,
          'SESSION_NOT_FOUND': 404,
          'TIME_OVERLAP': 400,
          'SESSION_FULL': 409,
          'DUPLICATE_ACTIVITY': 409
        };
        return reply.status(statusMap[error.code] ?? 400).send({
          ok: false,
          error: { code: error.code, message: error.message }
        });
      }
      throw error;
    }
  });

  /**
   * GET /api/registration/me
   * ดึงข้อมูลลงทะเบียนของตัวเอง + bookings
   */
  app.get('/api/registration/me', async (request, reply) => {
    const auth = await requireAuth(request, reply);
    if (!auth) return;

    const participant = await getParticipantByLineUserId(auth.userId);

    if (!participant) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'ยังไม่ได้ลงทะเบียน / Not registered yet' }
      });
    }

    return reply.send({ ok: true, data: participant });
  });

  /**
   * PUT /api/registration/me
   * แก้ไขข้อมูลลงทะเบียน (ข้อมูลส่วนตัว และ/หรือ sessions)
   */
  app.put('/api/registration/me', async (request, reply) => {
    try {
      const auth = await requireAuth(request, reply);
      if (!auth) return;

      const body = request.body as Record<string, unknown>;
      const parseResult = updateRegistrationSchema.safeParse(body);

      if (!parseResult.success) {
        return reply.status(400).send({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลไม่ถูกต้อง / Validation failed',
            details: parseResult.error.issues.map(issue => ({
              field: issue.path.join('.'),
              message: issue.message
            }))
          }
        });
      }

      const result = await updateRegistration(auth.userId, parseResult.data);

      return reply.send({
        ok: true,
        message: 'อัปเดตข้อมูลสำเร็จ / Registration updated',
        data: result
      });

    } catch (error) {
      if (error instanceof RegistrationError) {
        const statusMap: Record<string, number> = {
          'NOT_FOUND': 404,
          'SESSION_NOT_FOUND': 404,
          'TIME_OVERLAP': 400,
          'SESSION_FULL': 409,
          'DUPLICATE_ACTIVITY': 409
        };
        return reply.status(statusMap[error.code] ?? 400).send({
          ok: false,
          error: { code: error.code, message: error.message }
        });
      }
      throw error;
    }
  });

  /**
   * GET /api/registration/check/:lineUserId
   * เช็คว่า user ลงทะเบียนแล้วหรือยัง (ไม่ต้อง auth)
   */
  app.get<{ Params: { lineUserId: string } }>(
    '/api/registration/check/:lineUserId',
    async (request, reply) => {
      const { lineUserId } = request.params;
      const participant = await getParticipantByLineUserId(lineUserId);

      return reply.send({
        ok: true,
        data: {
          isRegistered: !!participant
        }
      });
    }
  );

  /**
   * GET /api/registration/me/qr
   * QR Code ของตัวเอง
   */
  app.get('/api/registration/me/qr', async (request, reply) => {
    const auth = await requireAuth(request, reply);
    if (!auth) return;

    const participant = await prisma.participant.findUnique({ where: { lineUserId: auth.userId } });
    if (!participant) return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'ยังไม่ได้ลงทะเบียน' } });

    const qr = await generateParticipantQr(participant.id);
    return reply.send({ ok: true, data: { ...qr, shortCode: participant.shortCode } });
  });
}
