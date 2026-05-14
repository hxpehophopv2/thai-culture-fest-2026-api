import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;

    return {
      ok: true,
      service: 'thai-culture-fest-2026-api',
      details: 'API is healthy',
      checkedAt: new Date().toISOString()
    };
  });
}
