import type { FastifyInstance } from 'fastify';
import { resolveAuth } from '../lib/liff-auth.js';
import { cancelBooking, RegistrationError } from '../services/registration.service.js';
import { prisma } from '../lib/prisma.js';

export async function bookingRoutes(app: FastifyInstance) {

  async function requireAuth(request: any, reply: any) {
    const auth = await resolveAuth(request.headers);
    if (!auth) {
      reply.status(401).send({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } });
      return null;
    }
    return auth;
  }

  /**
   * GET /api/bookings/me
   * ดึง bookings ของตัวเอง พร้อมข้อมูล session + activity
   */
  app.get('/api/bookings/me', async (request, reply) => {
    const auth = await requireAuth(request, reply);
    if (!auth) return;

    const participant = await prisma.participant.findUnique({
      where: { lineUserId: auth.userId }
    });

    if (!participant) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'ยังไม่ได้ลงทะเบียน / Not registered yet' }
      });
    }

    const bookings = await prisma.booking.findMany({
      where: { participantId: participant.id, status: 'CONFIRMED' },
      include: {
        session: {
          include: {
            activity: { select: { id: true, name: true, nameTh: true, zone: true } }
          }
        }
      },
      orderBy: { session: { startTime: 'asc' } }
    });

    return reply.send({
      ok: true,
      data: bookings.map(b => ({
        id: b.id,
        status: b.status,
        createdAt: b.createdAt,
        session: {
          id: b.session.id,
          startTime: b.session.startTime,
          endTime: b.session.endTime,
          activity: b.session.activity
        }
      }))
    });
  });

  /**
   * DELETE /api/bookings/:id
   * ยกเลิกการจอง (decrement bookedCount)
   */
  app.delete<{ Params: { id: string } }>('/api/bookings/:id', async (request, reply) => {
    try {
      const auth = await requireAuth(request, reply);
      if (!auth) return;

      const result = await cancelBooking(request.params.id, auth.userId);
      return reply.send({ ok: true, ...result });
    } catch (error) {
      if (error instanceof RegistrationError) {
        const statusMap: Record<string, number> = { NOT_FOUND: 404, FORBIDDEN: 403, ALREADY_CANCELLED: 400 };
        return reply.status(statusMap[error.code] ?? 400).send({
          ok: false,
          error: { code: error.code, message: error.message }
        });
      }
      throw error;
    }
  });
}
