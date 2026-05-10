import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment configuration — validated with Zod at startup.
 *
 * ถ้าตัวแปรสำคัญหายไป server จะ crash ทันทีแทนที่จะ error ตอน runtime
 *
 * STAFF_LINE_USER_IDS / ADMIN_LINE_USER_IDS:
 *   - ใส่เป็น comma-separated LINE userId เช่น "Uabc123,Udef456"
 *   - ใช้ระบุว่าใครเป็น staff/admin โดยไม่ต้องเพิ่ม role column ใน DB
 *   - เหมาะกับงาน event ครั้งเดียว — ถ้าต้องการ role system ที่ยืดหยุ่น
 *     ควรเพิ่ม role field ใน Participant model แทน
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),

  // ─── LINE / LIFF ──────────────────────────────────────
  LIFF_ID: z.string().optional(),
  LINE_CHANNEL_ID: z.string().optional(),
  LINE_CHANNEL_SECRET: z.string().optional(),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),

  // ─── Role whitelist (comma-separated LINE userIds) ────
  // ใครที่ LINE userId อยู่ในลิสต์นี้ จะมี role เพิ่มเติม
  STAFF_LINE_USER_IDS: z.string().default(''),
  ADMIN_LINE_USER_IDS: z.string().default(''),

  // ─── Admin Dashboard Credentials ──────────────────
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().default('admin')
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    if (data.JWT_SECRET.includes('change') || data.JWT_SECRET.includes('dev-')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be a production-grade random secret'
      });
    }

    if (data.ADMIN_USERNAME === 'admin' || data.ADMIN_PASSWORD === 'admin') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_PASSWORD'],
        message: 'Default admin credentials are not allowed in production'
      });
    }

    if (!data.LINE_CHANNEL_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LINE_CHANNEL_ID'],
        message: 'LINE_CHANNEL_ID is required in production'
      });
    }
  }
});

export const env = envSchema.parse(process.env);
