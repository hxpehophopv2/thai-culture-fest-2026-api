import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { healthRoutes } from './routes/health.js';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug'
    }
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true
  });

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024
    }
  });

  await app.register(healthRoutes);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}

const app = await buildServer();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
