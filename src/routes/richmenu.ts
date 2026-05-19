/**
 * Rich Menu Admin Routes
 * ─────────────────────────────────────────────────────────────
 *
 * API endpoints สำหรับ admin จัดการ Rich Menu
 * ใช้ Basic Auth เหมือน admin routes อื่นๆ
 */

import type { FastifyInstance } from 'fastify';
import {
  setupRichMenus,
  getRichMenuStatus,
  deleteAllRichMenus,
  syncRegisteredUsers
} from '../services/richmenu.service.js';
import { env } from '../lib/env.js';

export async function richMenuRoutes(app: FastifyInstance) {

  // ─── Basic Auth Check ──────────────────────────────────
  function requireAdminAuth(request: any, reply: any): boolean {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      reply.status(401).send({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Admin authentication required' }
      });
      return false;
    }

    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    const [username, password] = decoded.split(':');

    if (username !== env.ADMIN_USERNAME || password !== env.ADMIN_PASSWORD) {
      reply.status(403).send({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Invalid admin credentials' }
      });
      return false;
    }

    return true;
  }

  /**
   * POST /api/admin/richmenu/setup
   *
   * สร้าง Rich Menu 2 ชุด + อัปโหลดรูป + ตั้ง default
   * ⚠️ ใช้ครั้งเดียว หรือเมื่อต้องการสร้างใหม่
   *
   * ต้องมีรูปเมนูใน public/richmenu/:
   *   - menu-before-login.png (or .jpg)
   *   - menu-after-login.png (or .jpg)
   */
  app.post('/api/admin/richmenu/setup', async (request, reply) => {
    if (!requireAdminAuth(request, reply)) return;

    try {
      const result = await setupRichMenus();

      return reply.send({
        ok: true,
        message: 'Rich Menu setup complete! Save the IDs to .env',
        data: {
          defaultMenuId: result.defaultMenuId,
          registeredMenuId: result.registeredMenuId,
          imagesUploaded: result.imagesUploaded,
          envConfig: {
            RICH_MENU_DEFAULT_ID: result.defaultMenuId,
            RICH_MENU_REGISTERED_ID: result.registeredMenuId
          }
        }
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: {
          code: 'RICHMENU_SETUP_FAILED',
          message: error.message
        }
      });
    }
  });

  /**
   * GET /api/admin/richmenu/status
   *
   * ดูสถานะ Rich Menu ปัจจุบัน
   */
  app.get('/api/admin/richmenu/status', async (request, reply) => {
    if (!requireAdminAuth(request, reply)) return;

    try {
      const status = await getRichMenuStatus();

      return reply.send({
        ok: true,
        data: status
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: {
          code: 'RICHMENU_STATUS_FAILED',
          message: error.message
        }
      });
    }
  });

  /**
   * POST /api/admin/richmenu/sync-users
   *
   * Sync Rich Menu "ลงทะเบียนแล้ว" ให้ users ที่ลงทะเบียนแล้วทั้งหมด
   * ใช้กรณีที่ setup Rich Menu ใหม่แล้วต้องการ sync users เดิม
   */
  app.post('/api/admin/richmenu/sync-users', async (request, reply) => {
    if (!requireAdminAuth(request, reply)) return;

    try {
      const result = await syncRegisteredUsers();

      return reply.send({
        ok: true,
        message: `Synced ${result.linked}/${result.total} users`,
        data: result
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: {
          code: 'RICHMENU_SYNC_FAILED',
          message: error.message
        }
      });
    }
  });

  /**
   * DELETE /api/admin/richmenu/all
   *
   * ลบ Rich Menu ทั้งหมด (cleanup)
   * ⚠️ ระวัง! จะลบเมนูทั้งหมดใน LINE OA
   */
  app.delete('/api/admin/richmenu/all', async (request, reply) => {
    if (!requireAdminAuth(request, reply)) return;

    try {
      const result = await deleteAllRichMenus();

      return reply.send({
        ok: true,
        message: `Deleted ${result.deleted} rich menus`,
        data: result
      });
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: {
          code: 'RICHMENU_DELETE_FAILED',
          message: error.message
        }
      });
    }
  });
}
