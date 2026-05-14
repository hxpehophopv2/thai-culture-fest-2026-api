import type { FastifyInstance } from 'fastify';
import { resolveAuth } from '../lib/liff-auth.js';
import { isAdmin } from '../lib/staff-auth.js';
import { prisma } from '../lib/prisma.js';
import {
  getParticipantDetail, updateParticipant, walkinRegistration,
  adminCreateBooking, adminForceBooking, adminMoveBooking, adminCancelBooking,
  adminForceCheckin, adminDeleteCheckin, getCheckinHistory,
  regenerateQr, updateSession, getLiveActivityStatus,
  getDashboardStats, exportParticipantsCsv, exportScanLogsCsv,
  generateBoothCode, listBoothCodes, deleteBoothCode,
  AdminError
} from '../services/admin.service.js';
import { env } from '../lib/env.js';
import { createHmac, timingSafeEqual } from 'crypto';

// ─── Admin Session Token ─────────────────────────────
// เวลา login สำเร็จ จะ return token = HMAC(username + timestamp, JWT_SECRET)
// Dashboard ส่ง token กลับมาทุก request ใน header X-Admin-Token

function generateAdminToken(): string {
  const payload = `admin:${Date.now()}`;
  const hmac = createHmac('sha256', env.JWT_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64')}.${hmac}`;
}

function verifyAdminToken(token: string): boolean {
  try {
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return false;
    const payload = Buffer.from(payloadB64, 'base64').toString();
    // Check timestamp (valid for 12 hours)
    const ts = parseInt(payload.split(':')[1]);
    if (Date.now() - ts > 12 * 60 * 60 * 1000) return false;
    // Verify HMAC
    const expected = createHmac('sha256', env.JWT_SECRET).update(payload).digest('hex');
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

export async function adminRoutes(app: FastifyInstance) {

  // ─── Login Endpoint (no auth required) ─────────────────

  app.post('/api/admin/login', async (request, reply) => {
    const { username, password } = request.body as { username?: string; password?: string };
    if (!username || !password) {
      return reply.status(400).send({ ok: false, error: { code: 'MISSING_FIELDS', message: 'Username and password required' } });
    }
    // Timing-safe compare to prevent timing attacks
    const userMatch = username.length === env.ADMIN_USERNAME.length &&
      timingSafeEqual(Buffer.from(username), Buffer.from(env.ADMIN_USERNAME));
    const passMatch = password.length === env.ADMIN_PASSWORD.length &&
      timingSafeEqual(Buffer.from(password), Buffer.from(env.ADMIN_PASSWORD));

    if (!userMatch || !passMatch) {
      return reply.status(401).send({ ok: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } });
    }

    const token = generateAdminToken();
    return reply.send({ ok: true, data: { token } });
  });

  // ─── Auth Helper ───────────────────────────────────────
  // รองรับ 2 แบบ:
  // 1. LIFF token (admin user) → resolveAuth + isAdmin check
  // 2. Admin dashboard token → X-Admin-Token header

  async function requireAdminAuth(request: any, reply: any) {
    // Try admin dashboard token first
    const adminToken = request.headers['x-admin-token'];
    if (adminToken && typeof adminToken === 'string' && verifyAdminToken(adminToken)) {
      return { userId: 'admin-dashboard', displayName: 'Admin Dashboard' };
    }

    // Fall back to LIFF / dev auth
    const auth = await resolveAuth(request.headers);
    if (!auth) { reply.status(401).send({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } }); return null; }
    if (!isAdmin(auth.userId)) { reply.status(403).send({ ok: false, error: { code: 'FORBIDDEN', message: 'Admin only' } }); return null; }
    return auth;
  }

  function handleError(error: unknown, reply: any) {
    if (error instanceof AdminError) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404, PARTICIPANT_NOT_FOUND: 404, SESSION_NOT_FOUND: 404,
        BOOKING_NOT_FOUND: 404, ACTIVITY_NOT_FOUND: 404,
        ALREADY_BOOKED: 409, DUPLICATE_ACTIVITY: 409, SESSION_FULL: 409, ALREADY_CHECKED_IN: 409,
        ALREADY_CANCELLED: 400, NOT_CHECKED_IN: 400, NO_DATA: 400
      };
      return reply.status(statusMap[error.code] ?? 400).send({ ok: false, error: { code: error.code, message: error.message } });
    }
    throw error;
  }

  // ─── Dashboard ─────────────────────────────────────────

  app.get('/api/admin/dashboard', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    const data = await getDashboardStats();
    return reply.send({ ok: true, data });
  });

  // ─── กลุ่ม 1: จัดการผู้เข้าร่วม ────────────────────────

  app.get('/api/admin/participants', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    const { page = '1', limit = '50', search } = request.query as any;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = search ? {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' as const } },
        { lastName: { contains: search, mode: 'insensitive' as const } },
        { email: { contains: search, mode: 'insensitive' as const } }
      ]
    } : {};
    const [participants, total] = await Promise.all([
      prisma.participant.findMany({
        where, skip, take: parseInt(limit),
        include: { bookings: { where: { status: 'CONFIRMED' }, include: { session: { include: { activity: { select: { nameTh: true } } } } } } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.participant.count({ where })
    ]);
    return reply.send({ ok: true, data: participants, pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) } });
  });

  app.get<{ Params: { id: string } }>('/api/admin/participants/:id', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    try { return reply.send({ ok: true, data: await getParticipantDetail(request.params.id) }); }
    catch (e) { return handleError(e, reply); }
  });

  app.patch<{ Params: { id: string } }>('/api/admin/participants/:id', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    try { return reply.send({ ok: true, data: await updateParticipant(request.params.id, request.body as any), message: 'แก้ไขข้อมูลสำเร็จ' }); }
    catch (e) { return handleError(e, reply); }
  });

  app.post('/api/admin/participants/walkin', async (request, reply) => {
    const auth = await requireAdminAuth(request, reply);
    if (!auth) return;
    try { return reply.status(201).send({ ok: true, data: await walkinRegistration(auth.userId, request.body as any), message: 'ลงทะเบียน walk-in สำเร็จ' }); }
    catch (e) { return handleError(e, reply); }
  });

  // ─── กลุ่ม 2: จัดการ Booking ────────────────────────────

  app.post('/api/admin/bookings', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    try {
      const { participantId, sessionId } = request.body as any;
      return reply.status(201).send({ ok: true, data: await adminCreateBooking(participantId, sessionId) });
    } catch (e) { return handleError(e, reply); }
  });

  app.post('/api/admin/bookings/force', async (request, reply) => {
    const auth = await requireAdminAuth(request, reply);
    if (!auth) return;
    try {
      const { participantId, sessionId, reason } = request.body as any;
      return reply.status(201).send({ ok: true, data: await adminForceBooking(participantId, sessionId, auth.userId, reason) });
    } catch (e) { return handleError(e, reply); }
  });

  app.patch<{ Params: { id: string } }>('/api/admin/bookings/:id/move', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    try {
      const { newSessionId } = request.body as any;
      return reply.send({ ok: true, data: await adminMoveBooking(request.params.id, newSessionId) });
    } catch (e) { return handleError(e, reply); }
  });

  app.delete<{ Params: { id: string } }>('/api/admin/bookings/:id', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    try { return reply.send({ ok: true, data: await adminCancelBooking(request.params.id) }); }
    catch (e) { return handleError(e, reply); }
  });

  // ─── กลุ่ม 3: จัดการ Check-in / Stamp ──────────────────

  app.post('/api/admin/checkin/force', async (request, reply) => {
    const auth = await requireAdminAuth(request, reply);
    if (!auth) return;
    try {
      const { participantId, activityId, note } = request.body as any;
      return reply.status(201).send({ ok: true, data: await adminForceCheckin(participantId, activityId, auth.userId, note) });
    } catch (e) { return handleError(e, reply); }
  });

  app.delete<{ Params: { scanLogId: string } }>('/api/admin/checkin/:scanLogId', async (request, reply) => {
    const auth = await requireAdminAuth(request, reply);
    if (!auth) return;
    try {
      const { reason } = (request.body as any) ?? {};
      return reply.send({ ok: true, data: await adminDeleteCheckin(request.params.scanLogId, auth.userId, reason) });
    } catch (e) { return handleError(e, reply); }
  });

  app.get<{ Params: { type: string; id: string } }>('/api/admin/checkin/history/:type/:id', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    const { type, id } = request.params;
    if (type !== 'participant' && type !== 'student') {
      return reply.status(400).send({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'type must be "participant" or "student"' } });
    }
    return reply.send({ ok: true, data: await getCheckinHistory(type, id) });
  });

  // ─── กลุ่ม 4: QR Code ──────────────────────────────────

  app.post<{ Params: { type: string; id: string } }>('/api/admin/qr/regenerate/:type/:id', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    const { type, id } = request.params;
    if (type !== 'participant' && type !== 'student') {
      return reply.status(400).send({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'type must be "participant" or "student"' } });
    }
    try { return reply.send({ ok: true, data: await regenerateQr(type, id) }); }
    catch (e) { return handleError(e, reply); }
  });

  // ─── กลุ่ม 5: Session / Capacity / Live ────────────────

  app.patch<{ Params: { id: string } }>('/api/admin/sessions/:id', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    try { return reply.send({ ok: true, data: await updateSession(request.params.id, request.body as any) }); }
    catch (e) { return handleError(e, reply); }
  });

  app.get('/api/admin/activities/live', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    return reply.send({ ok: true, data: await getLiveActivityStatus() });
  });

  // ─── CSV Export ────────────────────────────────────────

  app.get('/api/admin/export/participants', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="rooted_participants.csv"');
    return reply.send(await exportParticipantsCsv());
  });

  app.get('/api/admin/export/scanlogs', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="rooted_scanlogs.csv"');
    return reply.send(await exportScanLogsCsv());
  });

  // ─── Booth Code Management ───────────────────────────

  app.get('/api/admin/booth-codes', async (request, reply) => {
    if (!await requireAdminAuth(request, reply)) return;
    const data = await listBoothCodes();
    return reply.send({ ok: true, data });
  });

  app.post<{ Params: { activityId: string } }>(
    '/api/admin/booth-codes/:activityId',
    async (request, reply) => {
      if (!await requireAdminAuth(request, reply)) return;
      try {
        const data = await generateBoothCode(request.params.activityId);
        return reply.status(201).send({ ok: true, data });
      } catch (error) {
        if (error instanceof AdminError) return reply.status(404).send({ ok: false, error: { code: error.code, message: error.message } });
        throw error;
      }
    }
  );

  app.delete<{ Params: { activityId: string } }>(
    '/api/admin/booth-codes/:activityId',
    async (request, reply) => {
      if (!await requireAdminAuth(request, reply)) return;
      try {
        const data = await deleteBoothCode(request.params.activityId);
        return reply.send({ ok: true, ...data });
      } catch (error) {
        if (error instanceof AdminError) return reply.status(404).send({ ok: false, error: { code: error.code, message: error.message } });
        throw error;
      }
    }
  );
}
