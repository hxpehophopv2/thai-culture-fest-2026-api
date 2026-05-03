import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;

    return {
      ok: true,
      service: 'rooted-registration-api',
      checkedAt: new Date().toISOString()
    };
  });
}
