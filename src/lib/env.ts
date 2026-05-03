import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  LIFF_ID: z.string().optional(),
  LINE_CHANNEL_ID: z.string().optional(),
  LINE_CHANNEL_SECRET: z.string().optional(),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional()
});

export const env = envSchema.parse(process.env);
