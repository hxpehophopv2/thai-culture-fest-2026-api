/**
 * LINE LIFF Authentication Module
 * ─────────────────────────────────────────────────────────────
 *
 * ใช้ยืนยันตัวตนผู้ใช้ผ่าน LINE LIFF access token
 *
 * Flow ปกติ (Production):
 *   1. Frontend ได้ token จาก LIFF SDK: liff.getAccessToken()
 *   2. Frontend ส่งมาเป็น: Authorization: Bearer <token>
 *   3. Backend เรียก LINE API verify token
 *   4. ได้ userId, displayName กลับมา
 *
 * Flow Development (Dev Mode):
 *   ตอนพัฒนา ไม่มี LINE token จริง → ใช้ header "X-Dev-User-Id" แทน
 *   เปิดได้เฉพาะ NODE_ENV=development เท่านั้น
 *   ตัวอย่าง:
 *     curl -H "X-Dev-User-Id: test-user-001" http://localhost:4000/api/registration/me
 *
 *   ⚠️ SECURITY: ห้ามเปิดใน production! เช็คจาก NODE_ENV เท่านั้น
 */

import { env } from './env.js';

// ─── Types ───────────────────────────────────────────────

interface LiffVerifyResponse {
  scope: string;
  client_id: string;
  expires_in: number;
}

interface LiffProfileResponse {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

/** ผลลัพธ์ที่ได้จากการ verify token */
export interface AuthResult {
  userId: string;
  displayName: string;
}

// ─── Dev Mode Bypass ─────────────────────────────────────

/**
 * ตรวจสอบว่าอยู่ใน dev mode และมี dev header หรือไม่
 *
 * ถ้ามี header "X-Dev-User-Id" + NODE_ENV=development
 * → return userId จาก header โดยไม่ต้องผ่าน LINE API
 *
 * ใช้สำหรับทดสอบด้วย Postman/curl โดยไม่ต้องมี LINE token จริง
 */
export function tryDevAuth(headers: Record<string, string | string[] | undefined>): AuthResult | null {
  if (env.NODE_ENV !== 'development') return null;

  const devUserId = headers['x-dev-user-id'];
  if (!devUserId || typeof devUserId !== 'string') return null;

  return {
    userId: devUserId,
    displayName: `[DEV] ${devUserId}`
  };
}

// ─── LIFF Token Verification ─────────────────────────────

/**
 * Verify a LINE LIFF access token and return the user's profile.
 *
 * ขั้นตอน:
 *   1. เรียก LINE API /oauth2/v2.1/verify → ตรวจว่า token ยัง valid อยู่
 *   2. เช็คว่า token เป็นของ LINE channel เรา (ป้องกัน token ของ app อื่น)
 *   3. เรียก LINE API /v2/profile → ได้ userId, displayName
 *
 * @param accessToken - LINE LIFF access token ที่ได้จาก liff.getAccessToken()
 * @throws Error ถ้า token ไม่ valid หรือหมดอายุ
 */
export async function verifyLiffToken(accessToken: string): Promise<AuthResult> {
  // Step 1: Verify the token is valid
  const verifyUrl = new URL('https://api.line.me/oauth2/v2.1/verify');
  verifyUrl.searchParams.set('access_token', accessToken);
  const verifyRes = await fetch(verifyUrl);

  if (!verifyRes.ok) {
    throw new Error('Invalid or expired LINE access token');
  }

  const verifyData = (await verifyRes.json()) as LiffVerifyResponse;

  // Step 2: Check that the token belongs to our LINE channel
  if (env.LINE_CHANNEL_ID && verifyData.client_id !== env.LINE_CHANNEL_ID) {
    throw new Error('Token does not belong to this LINE channel');
  }

  // Step 3: Get user profile
  const profileRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!profileRes.ok) {
    throw new Error('Failed to get LINE profile');
  }

  const profile = (await profileRes.json()) as LiffProfileResponse;

  return {
    userId: profile.userId,
    displayName: profile.displayName
  };
}

// ─── Helper Functions ────────────────────────────────────

/**
 * ดึง Bearer token จาก Authorization header
 *
 * @example
 *   extractBearerToken("Bearer abc123") → "abc123"
 *   extractBearerToken("") → null
 *   extractBearerToken(undefined) → null
 */
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * ดึง auth info จาก request — ลอง dev mode ก่อน แล้วค่อยลอง LINE token
 *
 * ใช้แทนการเรียก extractBearerToken + verifyLiffToken แยกในทุก route
 * ลดโค้ดซ้ำซ้อน
 *
 * @example
 *   const auth = await resolveAuth(request.headers);
 *   if (!auth) return reply.status(401).send({ ... });
 */
export async function resolveAuth(
  headers: Record<string, string | string[] | undefined>
): Promise<AuthResult | null> {
  // 1. ลอง dev mode ก่อน (ถ้า NODE_ENV=development)
  const devAuth = tryDevAuth(headers);
  if (devAuth) return devAuth;

  // 2. ลอง LINE LIFF token
  const authorization = headers['authorization'] ?? headers['Authorization'];
  const token = extractBearerToken(typeof authorization === 'string' ? authorization : undefined);
  if (!token) return null;

  try {
    return await verifyLiffToken(token);
  } catch {
    return null;
  }
}
