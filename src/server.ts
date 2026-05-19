import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { healthRoutes } from './routes/health.js';
import { activityRoutes } from './routes/activities.js';
import { registrationRoutes } from './routes/registration.js';
import { bookingRoutes } from './routes/bookings.js';
import { checkinRoutes } from './routes/checkin.js';
import { schoolRoutes } from './routes/school.js';
import { adminRoutes } from './routes/admin.js';
import { richMenuRoutes } from './routes/richmenu.js';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug'
    }
  });

  const allowedOrigins = env.CORS_ORIGIN
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // Dev mode: auto-allow ngrok and localhost
      if (env.NODE_ENV === 'development' && (
        origin.endsWith('.ngrok-free.app') ||
        origin.startsWith('http://localhost:')
      )) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true
  });

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024
    }
  });

  // Redirect old staff paths to new staff-login in Vue SPA
  app.get('/staff', async (request, reply) => {
    return reply.redirect('/staff-login');
  });
  app.get('/staff/', async (request, reply) => {
    return reply.redirect('/staff-login');
  });
  app.get('/staff/*', async (request, reply) => {
    return reply.redirect('/staff-login');
  });

  // ─── Static files (Admin Dashboard) ────────────────
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'public'),
    prefix: '/'
  });

  // ─── Routes ─────────────────────────────────────────
  await app.register(healthRoutes);
  await app.register(activityRoutes);
  await app.register(registrationRoutes);
  await app.register(bookingRoutes);
  await app.register(checkinRoutes);
  await app.register(schoolRoutes);
  await app.register(adminRoutes);
  await app.register(richMenuRoutes);

  // ─── Global error handler ──────────────────────────
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    app.log.error(error);
    reply.status(error.statusCode ?? 500).send({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message
      }
    });
  });

  // ─── Vue SPA Catch-All ─────────────────────────────
  // Serve public/app/index.html for any non-API, non-static route
  // This lets Vue Router handle client-side routing
  // Note: fastifyStatic already serves /admin/, /staff/, /app/ etc.
  //       from public/ before this handler is reached.
  app.setNotFoundHandler(async (_request, reply) => {
    const url = _request.url;
    // Only block API and health routes from the SPA catch-all
    if (url.startsWith('/api/') || url.startsWith('/health')) {
      return reply.status(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
    }
    // Serve Vue SPA for all other paths
    return reply.sendFile('app/index.html');
  });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}

const app = await buildServer();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error: unknown) {
  app.log.error(error);
  process.exit(1);
}
