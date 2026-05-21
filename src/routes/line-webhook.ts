import type { FastifyInstance } from 'fastify';
import { env } from '../lib/env.js';
import crypto from 'crypto';

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


const POSTBACK_REPLIES: Record<string, string> = {
  'action=travel': TRAVEL_MESSAGE,
  'action=contact': CONTACT_MESSAGE,
};

// ─── LINE Signature Verification ─────────────────────────────

function verifySignature(body: string, signature: string, logger?: any): boolean {
  const channelSecret = env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    if (logger) logger.error('[Webhook] LINE_CHANNEL_SECRET is not set');
    return false;
  }

  const hash = crypto
    .createHmac('sha256', channelSecret)
    .update(body)
    .digest('base64');

  const match = hash === signature;
  if (!match && logger) {
    logger.error({
      msg: '[Webhook] Signature verification failed',
      secretLength: channelSecret.length,
      secretPrefix: channelSecret.slice(0, 4) + '...' + channelSecret.slice(-4),
      receivedSignature: signature,
      calculatedHash: hash,
      rawBodyLength: body.length,
      rawBodyPreview: body.slice(0, 200)
    });
  }

  return match;
}

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

export async function lineWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, body);
    }
  );

  app.post('/api/line/webhook', async (request, reply) => {
    const signature = request.headers['x-line-signature'] as string;
    const rawBody = request.body as string;

    // Verify signature
    if (env.LINE_CHANNEL_SECRET && signature) {
      const channelSecret = env.LINE_CHANNEL_SECRET;
      const hash = crypto
        .createHmac('sha256', channelSecret)
        .update(rawBody)
        .digest('base64');
      
      if (hash !== signature) {
        const debugInfo = {
          receivedSignature: signature,
          calculatedHash: hash,
          bodyLength: rawBody?.length,
          bodyType: typeof rawBody,
          bodyPreview: rawBody?.slice?.(0, 200),
          secretLength: channelSecret?.length,
          secretFirstFour: channelSecret?.slice?.(0, 4)
        };
        app.log.error({ msg: '[Webhook] Signature verification failed', ...debugInfo });
        return reply.status(403).send({ 
          ok: false, 
          error: 'Invalid signature',
          debug: debugInfo
        });
      }
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return reply.status(400).send({ ok: false, error: 'Invalid JSON' });
    }

    const events = body.events || [];

    for (const event of events) {
      if (event.type === 'postback') {
        const postbackData = event.postback?.data;
        const replyToken = event.replyToken;
        const replyText = POSTBACK_REPLIES[postbackData];

        if (replyText && replyToken) {
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
