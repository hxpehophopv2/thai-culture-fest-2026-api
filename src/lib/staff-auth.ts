/**
 * Staff & Admin Authentication Helpers
 * ─────────────────────────────────────────────────────────────
 *
 * ระบบ ROOTED ใช้ whitelist-based role system:
 * - Staff  = เจ้าหน้าที่ประจำฐาน → แสกน QR, ดู stamp card
 * - Admin  = ผู้ดูแลระบบ → ดู dashboard, export CSV
 *
 * วิธีกำหนด: ใส่ LINE userId ใน .env
 *   STAFF_LINE_USER_IDS=Uabc123,Udef456
 *   ADMIN_LINE_USER_IDS=Uxyz789
 *
 * ทำไมไม่ใช้ role column ใน DB?
 * → งาน event ครั้งเดียว มี staff แค่ ~10 คน
 *   ใช้ env var ง่ายกว่า ไม่ต้อง migrate schema
 *   ถ้าจะ scale ค่อย refactor เป็น DB-based roles
 *
 * Note: Admin จะได้สิทธิ์ Staff ด้วยเสมอ (Admin ⊇ Staff)
 */

import { env } from './env.js';

// ─── Parse whitelist จาก env (ทำครั้งเดียวตอน import) ─────

/** Set ของ LINE userId ที่เป็น Staff */
const staffIds = new Set(
  env.STAFF_LINE_USER_IDS
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0)
);

/** Set ของ LINE userId ที่เป็น Admin */
const adminIds = new Set(
  env.ADMIN_LINE_USER_IDS
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0)
);

// ─── Public Functions ──────────────────────────────────────

/**
 * เช็คว่า LINE userId นี้เป็น Staff หรือไม่
 *
 * Admin ก็นับเป็น Staff ด้วย (superset)
 * ใช้ตรวจก่อนเข้า check-in routes ทั้งหมด
 */
export function isStaff(lineUserId: string): boolean {
  return staffIds.has(lineUserId) || adminIds.has(lineUserId);
}

/**
 * เช็คว่า LINE userId นี้เป็น Admin หรือไม่
 *
 * ใช้ตรวจก่อนเข้า admin routes (dashboard, export)
 * Admin มีสิทธิ์มากกว่า Staff: ดู report, export CSV
 */
export function isAdmin(lineUserId: string): boolean {
  return adminIds.has(lineUserId);
}

/**
 * ดึง role ของ LINE userId
 * ใช้ส่งกลับ client เพื่อแสดง UI ตาม role
 */
export function getUserRole(lineUserId: string): 'admin' | 'staff' | 'user' {
  if (adminIds.has(lineUserId)) return 'admin';
  if (staffIds.has(lineUserId)) return 'staff';
  return 'user';
}
