/**
 * LINE Rich Menu Service
 * ─────────────────────────────────────────────────────────────
 *
 * จัดการ Rich Menu ผ่าน LINE Messaging API
 *
 * Rich Menu 2 ชุด:
 *   1. "ยังไม่ลงทะเบียน" (default) — ปุ่มใหญ่ลงทะเบียน + 3 ปุ่มเล็ก
 *   2. "ลงทะเบียนแล้ว" — 2×2 grid เท่ากัน 4 ช่อง
 *
 * Flow:
 *   1. Admin เรียก POST /api/admin/richmenu/setup → สร้าง + อัปโหลดรูป + ตั้ง default
 *   2. User ลงทะเบียนสำเร็จ → สลับไปใช้เมนู "ลงทะเบียนแล้ว"
 *   3. Admin เรียก POST /api/admin/richmenu/sync-users → Sync เมนูให้ users ที่ลงทะเบียนแล้วทั้งหมด
 */

import fs from 'fs';
import path from 'path';
import { env } from '../lib/env.js';

// ─── Types ───────────────────────────────────────────────

interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: {
    type: string;
    uri?: string;
    text?: string;
    label?: string;
  };
}

interface RichMenuObject {
  size: { width: number; height: number };
  selected: boolean;
  name: string;
  chatBarText: string;
  areas: RichMenuArea[];
}

interface CreateRichMenuResponse {
  richMenuId: string;
}

// ─── Constants ───────────────────────────────────────────

const LINE_API_BASE = 'https://api.line.me';
const LINE_DATA_API_BASE = 'https://api-data.line.me';

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

// LIFF URL สำหรับ actions ที่เปิดใน LIFF
function getLiffUrl(): string {
  return `https://liff.line.me/${env.LIFF_ID || ''}`;
}

// ─── Rich Menu Definitions ──────────────────────────────

/**
 * เมนู "ยังไม่ลงทะเบียน"
 *
 * Layout (2500×1686):
 * ┌─────────────────────────────────┐
 * │                                 │
 * │     ลงทะเบียนเข้างาน (ปุ่มใหญ่)    │  y: 0, h: 1060
 * │                                 │
 * ├──────────┬──────────┬───────────┤
 * │ Details  │ Car Park │  Contact  │  y: 1060, h: 626
 * └──────────┴──────────┴───────────┘
 *   w: 833    w: 834     w: 833
 */
function buildBeforeLoginMenu(): RichMenuObject {
  const liffUrl = getLiffUrl();

  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'ROOTED 2026 - Before Registration',
    chatBarText: 'Menu',
    areas: [
      // ลงทะเบียนเข้างาน (ปุ่มใหญ่ด้านบน)
      {
        bounds: { x: 0, y: 0, width: 2500, height: 843 },
        action: {
          type: 'uri',
          uri: liffUrl,
          label: 'ลงทะเบียนเข้างาน'
        }
      },
      // การเดินทาง (ล่างซ้าย)
      {
        bounds: { x: 0, y: 843, width: 1250, height: 843 },
        action: {
          type: 'message',
          text: TRAVEL_MESSAGE,
          label: 'การเดินทาง'
        }
      },
      // ติดต่อเรา (ล่างขวา)
      {
        bounds: { x: 1250, y: 843, width: 1250, height: 843 },
        action: {
          type: 'message',
          text: CONTACT_MESSAGE,
          label: 'ติดต่อสอบถาม'
        }
      }
    ]
  };
}

/**
 * เมนู "ลงทะเบียนแล้ว"
 *
 * Layout (2500×1686):
 * ┌────────────────┬────────────────┐
 * │                │                │
 * │   QR Code เรา   │ Reserve Details│  y: 0, h: 843
 * │                │                │
 * ├────────────────┼────────────────┤
 * │                │                │
 * │   Car Park     │   Contact      │  y: 843, h: 843
 * │                │                │
 * └────────────────┴────────────────┘
 *   w: 1250          w: 1250
 */
function buildAfterLoginMenu(): RichMenuObject {
  const liffUrl = getLiffUrl();

  return {
    size: { width: 2500, height: 1686 },
    selected: true,
    name: 'ROOTED 2026 - After Registration',
    chatBarText: 'Menu',
    areas: [
      // โปรไฟล์ของฉัน (บนซ้าย)
      {
        bounds: { x: 0, y: 0, width: 1400, height: 843 },
        action: {
          type: 'uri',
          uri: `${liffUrl}/profile`,
          label: 'โปรไฟล์ของฉัน'
        }
      },
      // จองกิจกรรม / รายละเอียดกิจกรรม (บนขวา)
      {
        bounds: { x: 1400, y: 0, width: 1100, height: 843 },
        action: {
          type: 'uri',
          uri: `${liffUrl}/activities`,
          label: 'จองกิจกรรม'
        }
      },
      // การเดินทาง (ล่างซ้าย)
      {
        bounds: { x: 0, y: 843, width: 1250, height: 843 },
        action: {
          type: 'message',
          text: TRAVEL_MESSAGE,
          label: 'การเดินทาง'
        }
      },
      // ติดต่อเรา (ล่างขวา)
      {
        bounds: { x: 1250, y: 843, width: 1250, height: 843 },
        action: {
          type: 'message',
          text: CONTACT_MESSAGE,
          label: 'ติดต่อสอบถาม'
        }
      }
    ]
  };
}

// ─── LINE API Helpers ────────────────────────────────────

function getAccessToken(): string {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured. Please set it in .env');
  }
  return token;
}

/**
 * สร้าง Rich Menu ผ่าน LINE API
 * @returns richMenuId
 */
async function createRichMenu(menu: RichMenuObject): Promise<string> {
  const token = getAccessToken();

  const res = await fetch(`${LINE_API_BASE}/v2/bot/richmenu`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(menu)
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to create rich menu: ${res.status} ${errorBody}`);
  }

  const data = (await res.json()) as CreateRichMenuResponse;
  return data.richMenuId;
}

/**
 * อัปโหลดรูป Rich Menu
 * @param richMenuId - ID ของ Rich Menu ที่สร้างแล้ว
 * @param imagePath - path ไปยังไฟล์รูป (PNG/JPEG, max 1MB)
 */
async function uploadRichMenuImage(richMenuId: string, imagePath: string): Promise<void> {
  const token = getAccessToken();
  const imageBuffer = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

  const res = await fetch(`${LINE_DATA_API_BASE}/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': contentType
    },
    body: imageBuffer
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to upload rich menu image: ${res.status} ${errorBody}`);
  }
}

/**
 * ตั้งเป็น default Rich Menu สำหรับ users ทั้งหมด
 */
async function setDefaultRichMenu(richMenuId: string): Promise<void> {
  const token = getAccessToken();

  const res = await fetch(`${LINE_API_BASE}/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Length': '0'
    }
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to set default rich menu: ${res.status} ${errorBody}`);
  }
}

/**
 * ดึงรายการ Rich Menu ทั้งหมด
 */
async function listRichMenus(): Promise<any[]> {
  const token = getAccessToken();

  const res = await fetch(`${LINE_API_BASE}/v2/bot/richmenu/list`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to list rich menus: ${res.status} ${errorBody}`);
  }

  const data = await res.json() as { richmenus: any[] };
  return data.richmenus || [];
}

/**
 * ลบ Rich Menu
 */
async function deleteRichMenu(richMenuId: string): Promise<void> {
  const token = getAccessToken();

  const res = await fetch(`${LINE_API_BASE}/v2/bot/richmenu/${richMenuId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to delete rich menu: ${res.status} ${errorBody}`);
  }
}

/**
 * ดึง default Rich Menu ID ปัจจุบัน
 */
async function getDefaultRichMenuId(): Promise<string | null> {
  const token = getAccessToken();

  const res = await fetch(`${LINE_API_BASE}/v2/bot/user/all/richmenu`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json() as { richMenuId: string };
  return data.richMenuId || null;
}

// ─── Public Functions ────────────────────────────────────

/**
 * ผูก Rich Menu "ลงทะเบียนแล้ว" กับ user
 *
 * เรียกหลังจาก user ลงทะเบียนสำเร็จ
 * ใช้ fire-and-forget — ถ้า LINE API ล่ม ไม่ block registration
 */
export async function linkRegisteredMenuToUser(lineUserId: string): Promise<void> {
  const registeredMenuId = env.RICH_MENU_REGISTERED_ID;
  if (!registeredMenuId) {
    console.warn('[RichMenu] RICH_MENU_REGISTERED_ID not set, skipping menu link');
    return;
  }

  try {
    const token = getAccessToken();

    const res = await fetch(`${LINE_API_BASE}/v2/bot/user/${lineUserId}/richmenu/${registeredMenuId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Length': '0'
      }
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`[RichMenu] Failed to link menu to user ${lineUserId}: ${res.status} ${errorBody}`);
    } else {
      console.log(`[RichMenu] Linked registered menu to user ${lineUserId}`);
    }
  } catch (error) {
    console.error(`[RichMenu] Error linking menu to user ${lineUserId}:`, error);
  }
}

/**
 * ถอด Rich Menu ออกจาก user (กลับไปใช้ default)
 */
export async function unlinkRichMenuFromUser(lineUserId: string): Promise<void> {
  try {
    const token = getAccessToken();

    const res = await fetch(`${LINE_API_BASE}/v2/bot/user/${lineUserId}/richmenu`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`[RichMenu] Failed to unlink menu from user ${lineUserId}: ${res.status} ${errorBody}`);
    }
  } catch (error) {
    console.error(`[RichMenu] Error unlinking menu from user ${lineUserId}:`, error);
  }
}

/**
 * Setup Rich Menu ทั้งระบบ
 *
 * 1. สร้าง "ยังไม่ลงทะเบียน" menu
 * 2. สร้าง "ลงทะเบียนแล้ว" menu
 * 3. อัปโหลดรูป (ถ้ามี)
 * 4. ตั้ง "ยังไม่ลงทะเบียน" เป็น default
 *
 * @returns { defaultMenuId, registeredMenuId }
 */
export async function setupRichMenus(): Promise<{
  defaultMenuId: string;
  registeredMenuId: string;
  imagesUploaded: { default: boolean; registered: boolean };
}> {
  console.log('[RichMenu] Starting setup...');

  // 1. สร้างเมนู "ยังไม่ลงทะเบียน"
  const beforeLoginMenu = buildBeforeLoginMenu();
  const defaultMenuId = await createRichMenu(beforeLoginMenu);
  console.log(`[RichMenu] Created default menu: ${defaultMenuId}`);

  // 2. สร้างเมนู "ลงทะเบียนแล้ว"
  const afterLoginMenu = buildAfterLoginMenu();
  const registeredMenuId = await createRichMenu(afterLoginMenu);
  console.log(`[RichMenu] Created registered menu: ${registeredMenuId}`);

  // 3. อัปโหลดรูป (ถ้ามี)
  const imagesUploaded = { default: false, registered: false };
  const imageDir = path.join(process.cwd(), 'public', 'richmenu');

  const defaultImagePath = path.join(imageDir, 'menu-before-login.png');
  if (fs.existsSync(defaultImagePath)) {
    await uploadRichMenuImage(defaultMenuId, defaultImagePath);
    imagesUploaded.default = true;
    console.log('[RichMenu] Uploaded default menu image');
  } else {
    // ลองหา .jpg
    const jpgPath = defaultImagePath.replace('.png', '.jpg');
    if (fs.existsSync(jpgPath)) {
      await uploadRichMenuImage(defaultMenuId, jpgPath);
      imagesUploaded.default = true;
      console.log('[RichMenu] Uploaded default menu image (jpg)');
    } else {
      console.warn('[RichMenu] No image found for default menu at:', defaultImagePath);
    }
  }

  const registeredImagePath = path.join(imageDir, 'menu-after-login.png');
  if (fs.existsSync(registeredImagePath)) {
    await uploadRichMenuImage(registeredMenuId, registeredImagePath);
    imagesUploaded.registered = true;
    console.log('[RichMenu] Uploaded registered menu image');
  } else {
    const jpgPath = registeredImagePath.replace('.png', '.jpg');
    if (fs.existsSync(jpgPath)) {
      await uploadRichMenuImage(registeredMenuId, jpgPath);
      imagesUploaded.registered = true;
      console.log('[RichMenu] Uploaded registered menu image (jpg)');
    } else {
      console.warn('[RichMenu] No image found for registered menu at:', registeredImagePath);
    }
  }

  // 4. ตั้ง default
  await setDefaultRichMenu(defaultMenuId);
  console.log('[RichMenu] Set default menu');

  console.log('[RichMenu] Setup complete!');
  console.log(`[RichMenu] ⚠️  Save these IDs to .env:`);
  console.log(`  RICH_MENU_DEFAULT_ID=${defaultMenuId}`);
  console.log(`  RICH_MENU_REGISTERED_ID=${registeredMenuId}`);

  return { defaultMenuId, registeredMenuId, imagesUploaded };
}

/**
 * ดูสถานะ Rich Menu ปัจจุบัน
 */
export async function getRichMenuStatus(): Promise<{
  defaultMenuId: string | null;
  configuredDefaultId: string | undefined;
  configuredRegisteredId: string | undefined;
  totalMenus: number;
  menus: any[];
}> {
  const menus = await listRichMenus();
  const defaultMenuId = await getDefaultRichMenuId();

  return {
    defaultMenuId,
    configuredDefaultId: env.RICH_MENU_DEFAULT_ID,
    configuredRegisteredId: env.RICH_MENU_REGISTERED_ID,
    totalMenus: menus.length,
    menus: menus.map(m => ({
      richMenuId: m.richMenuId,
      name: m.name,
      chatBarText: m.chatBarText,
      areas: m.areas?.length || 0
    }))
  };
}

/**
 * ลบ Rich Menu ทั้งหมด (cleanup)
 */
export async function deleteAllRichMenus(): Promise<{ deleted: number }> {
  const menus = await listRichMenus();
  let deleted = 0;

  for (const menu of menus) {
    try {
      await deleteRichMenu(menu.richMenuId);
      deleted++;
      console.log(`[RichMenu] Deleted: ${menu.richMenuId} (${menu.name})`);
    } catch (error) {
      console.error(`[RichMenu] Failed to delete ${menu.richMenuId}:`, error);
    }
  }

  return { deleted };
}

/**
 * Sync Rich Menu สำหรับ users ที่ลงทะเบียนแล้วทั้งหมด
 * ใช้ bulk link API
 */
export async function syncRegisteredUsers(): Promise<{
  total: number;
  linked: number;
  errors: number;
}> {
  const registeredMenuId = env.RICH_MENU_REGISTERED_ID;
  if (!registeredMenuId) {
    throw new Error('RICH_MENU_REGISTERED_ID not set in .env');
  }

  // ดึง LINE user IDs ของผู้ลงทะเบียนทั้งหมด
  const { prisma } = await import('../lib/prisma.js');
  const participants = await prisma.participant.findMany({
    select: { lineUserId: true }
  });

  const total = participants.length;
  if (total === 0) {
    return { total: 0, linked: 0, errors: 0 };
  }

  // ใช้ bulk link API (max 500 users per request)
  const token = getAccessToken();
  let linked = 0;
  let errors = 0;
  const batchSize = 500;

  for (let i = 0; i < participants.length; i += batchSize) {
    const batch = participants.slice(i, i + batchSize);
    const userIds = batch.map(p => p.lineUserId);

    try {
      const res = await fetch(`${LINE_API_BASE}/v2/bot/richmenu/bulk/link`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          richMenuId: registeredMenuId,
          userIds
        })
      });

      if (res.ok) {
        linked += userIds.length;
        console.log(`[RichMenu] Bulk linked ${userIds.length} users (batch ${Math.floor(i / batchSize) + 1})`);
      } else {
        const errorBody = await res.text();
        console.error(`[RichMenu] Bulk link failed: ${res.status} ${errorBody}`);
        errors += userIds.length;
      }
    } catch (error) {
      console.error('[RichMenu] Bulk link error:', error);
      errors += userIds.length;
    }
  }

  return { total, linked, errors };
}
