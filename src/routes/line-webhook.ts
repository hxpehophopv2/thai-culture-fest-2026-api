/**
 * LINE Webhook Route
 * ─────────────────────────────────────────────────────────────
 *
 * รับ webhook events จาก LINE Messaging API
 * ปัจจุบันจัดการ postback events จากปุ่ม Rich Menu (การเดินทาง / ติดต่อสอบถาม)
 * โดยให้ OA เป็นคนตอบกลับ (reply) แทนที่จะเป็น user ส่งข้อความเอง
 *
 * ⚠️ ต้อง register ด้วย app.register() (ไม่ใช้ fastify-plugin)
 *    เพื่อให้ custom content-type parser ถูก scope ภายใน plugin นี้เท่านั้น
 *    ไม่ไปแทรก parser ของ routes อื่น
 */

import type { FastifyInstance } from 'fastify';
import { env } from '../lib/env.js';
import crypto from 'crypto';

// ─── Constants (ข้อความเดิมที่เคยใช้ใน message action) ────────

const TRAVEL_MESSAGE = `📍 การเดินทางมายังงาน
KMUTT ROOTED: Thai Sustainable Culture Fest 2026

สถานที่จัดงาน: พื้นที่สนับสนุนด้านการเรียนรู้
(Science Learning Space)

📌 Google Maps
https://share.google/OTYgs8btfYYqHKY8H

🚗 รถยนต์ส่วนตัว / รถตู้โรงเรียน 
สามารถนำรถยนต์มาเองได้ และจอดรถฟรีที่อาคาร S2`;

const CONTACT_MESSAGE = `📞 ติดต่อสอบถาม
KMUTT ROOTED: Thai Sustainable Culture Fest 2026

หากต้องการสอบถามข้อมูลเพิ่มเติมเกี่ยวกับ:
• การลงทะเบียน
• กิจกรรมภายในงาน
• การเดินทาง
• การสมัคร Workshop

สามารถติดต่อทีมงานได้ที่

โทรศัพท์: 093-9262583 (พั้นซ์)
โทรศัพท์: 061-3960779 (เฟิร์น)`;

// ─── Postback action → reply text mapping ────────────────────

const POSTBACK_REPLIES: Record<string, string> = {
  'action=travel': TRAVEL_MESSAGE,
  'action=contact': CONTACT_MESSAGE,
};

// ─── LINE Signature Verification ─────────────────────────────

function verifySignature(body: string, signature: string): boolean {
  const channelSecret = env.LINE_CHANNEL_SECRET;
  if (!channelSecret) return false;

  const hash = crypto
    .createHmac('SHA256', channelSecret)
    .update(body)
    .digest('base64');

  return hash === signature;
}

// ─── Reply Helper ────────────────────────────────────────────

async function replyMessage(replyToken: string, text: string): Promise<void> {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.error('[Webhook] LINE_CHANNEL_ACCESS_TOKEN not set');
    return;
  }

  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error(`[Webhook] Reply failed: ${res.status} ${errorBody}`);
  }
}

// ─── Plugin (encapsulated — custom parser stays in this scope) ──

export async function lineWebhookRoutes(app: FastifyInstance) {
  // Override JSON parser for this scope only — LINE requires raw body for signature
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, body);
    }
  );

  /**
   * POST /api/line/webhook
   *
   * LINE Messaging API Webhook endpoint
   * Handles postback events from Rich Menu buttons
   */
  app.post('/api/line/webhook', async (request, reply) => {
    const signature = request.headers['x-line-signature'] as string;
    const rawBody = request.body as string;

    // Verify signature
    if (env.LINE_CHANNEL_SECRET && signature) {
      if (!verifySignature(rawBody, signature)) {
        return reply.status(403).send({ ok: false, error: 'Invalid signature' });
      }
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return reply.status(400).send({ ok: false, error: 'Invalid JSON' });
    }

    const events = body.events || [];

    // Process events
    for (const event of events) {
      if (event.type === 'postback') {
        const postbackData = event.postback?.data;
        const replyToken = event.replyToken;
        const replyText = POSTBACK_REPLIES[postbackData];

        if (replyText && replyToken) {
          // Fire and forget — don't block the 200 response
          replyMessage(replyToken, replyText).catch(err => {
            console.error('[Webhook] Reply error:', err);
          });
        } else {
          console.log(`[Webhook] Unknown postback: ${postbackData}`);
        }
      }
    }

    // LINE expects 200 OK
    return reply.status(200).send({});
  });
}
