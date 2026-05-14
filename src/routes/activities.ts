import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function activityRoutes(app: FastifyInstance) {
  /**
   * GET /api/activities
   * ดึงรายการกิจกรรมทั้งหมด + sessions พร้อมจำนวนที่นั่งคงเหลือ
   * Grouped by zone (LAB / STAGE)
   */
  app.get('/api/activities', async (_request, reply) => {
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
        }
      },
      orderBy: { sortOrder: 'asc' }
    });

    // Transform: add remainingSeats to each session
    const result = activities.map((activity) => ({
      id: activity.id,
      name: activity.name,
      nameTh: activity.nameTh,
      zone: activity.zone,
      description: activity.description,
      sortOrder: activity.sortOrder,
      sessions: activity.sessions.map((session) => ({
        id: session.id,
        startTime: session.startTime,
        endTime: session.endTime,
        capacity: session.capacity,
        bookedCount: session.bookedCount,
        remainingSeats: session.capacity - session.bookedCount,
        isFull: session.bookedCount >= session.capacity
      }))
    }));

    return reply.send({
      ok: true,
      data: result
    });
  });

  /**
   * GET /api/activities/:id/sessions
   * ดึง sessions ของกิจกรรมใดกิจกรรมหนึ่ง
   */
  app.get<{ Params: { id: string } }>('/api/activities/:id/sessions', async (request, reply) => {
    const { id } = request.params;

    const activity = await prisma.activity.findUnique({
      where: { id },
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
        }
      }
    });

    if (!activity) {
      return reply.status(404).send({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Activity not found' }
      });
    }

    return reply.send({
      ok: true,
      data: {
        id: activity.id,
        name: activity.name,
        nameTh: activity.nameTh,
        zone: activity.zone,
        sessions: activity.sessions.map((session) => ({
          id: session.id,
          startTime: session.startTime,
          endTime: session.endTime,
          capacity: session.capacity,
          bookedCount: session.bookedCount,
          remainingSeats: session.capacity - session.bookedCount,
          isFull: session.bookedCount >= session.capacity
        }))
      }
    });
  });
}
