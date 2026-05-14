/**
 * QR Code Service — Lean ID
 * ─────────────────────────────────────────────────────────────
 *
 * สร้างและ decode QR Code สำหรับระบบ check-in วันงาน
 *
 * หลักการ:
 *   QR Code = "R:{type}:{uuid}:{hmac8}"
 *   → สั้น สะอาด แสกนไว (~50 chars vs JWT 500-800 chars)
 *   → staff แสกน → parse + verify HMAC → query DB ดึงข้อมูล
 *
 * ทำไมเปลี่ยนจาก JWT?
 *   - QR เล็ก สะอาด → แสกนเร็ว ทุกกล้อง ทุกสภาพแสง
 *   - ข้อมูล real-time จาก DB → ไม่มี stale data
 *   - ไม่มี token expire → QR ใบเดียวใช้ได้ตลอด
 *   - ขนาดคงที่ → ไม่ว่าจองกี่ฐาน QR ก็เท่ากัน
 *
 * Format:
 *   R:p:72dc3552-7fef-434c-947c-9d95a807053a:a1b2c3d4
 *   │ │ │                                      │
 *   │ │ │                                      └── HMAC-SHA256 first 8 hex
 *   │ │ └── person UUID
 *   │ └── type: p=participant, s=student
 *   └── prefix
 *
 * ─────────────────────────────────────────────────────────────
 */

import { createHmac } from 'crypto';
import QRCode from 'qrcode';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';

// ─── Types ───────────────────────────────────────────────

/** ข้อมูลที่ parse ได้จาก QR data string */
export interface QrParsedData {
  /** "participant" หรือ "student" */
  type: 'participant' | 'student';
  /** UUID ของ participant หรือ student */
  id: string;
}

/** ผลลัพธ์จากการสร้าง QR */
export interface QrResult {
  /** QR data string (เนื้อหาของ QR Code) */
  qrData: string;
  /** QR Code เป็น Data URL (image/png;base64,...) */
  dataUrl: string;
  /** ข้อมูลคน */
  person: {
    id: string;
    type: 'participant' | 'student';
    name: string;
  };
}

// ─── HMAC Helpers ────────────────────────────────────────

/**
 * สร้าง HMAC signature สั้น (8 hex chars) สำหรับ QR data
 *
 * ป้องกันคนเดา UUID มาสร้าง QR ปลอม
 * ใช้ JWT_SECRET เดียวกับระบบ → ต้องรู้ secret ถึงจะปลอม QR ได้
 */
function createShortHmac(data: string): string {
  return createHmac('sha256', env.JWT_SECRET)
    .update(data)
    .digest('hex')
    .slice(0, 8);
}

/**
 * สร้าง QR data string จาก type + id
 */
function buildQrData(type: 'p' | 's', id: string): string {
  const prefix = `R:${type}:${id}`;
  const hmac = createShortHmac(prefix);
  return `${prefix}:${hmac}`;
}

// ─── Parse & Verify QR Data ──────────────────────────────

/**
 * Parse และ verify QR data string ที่ staff แสกนได้
 *
 * ตรวจสอบ:
 *   - format ถูกต้อง (R:{type}:{uuid}:{hmac})
 *   - HMAC ตรง (ป้องกัน QR ปลอม)
 *
 * @param raw - string ที่ได้จากการแสกน QR
 * @returns { type, id }
 * @throws Error ถ้า format ผิดหรือ HMAC ไม่ตรง
 */
export function parseQrData(raw: string): QrParsedData {
  const parts = raw.split(':');

  // ต้องมี 4 ส่วน: R, type, uuid, hmac
  if (parts.length !== 4 || parts[0] !== 'R') {
    throw new Error('Invalid QR format');
  }

  const [, typeCode, id, hmac] = parts;

  // ตรวจ type
  if (typeCode !== 'p' && typeCode !== 's') {
    throw new Error('Invalid QR type');
  }

  // ตรวจ UUID format (basic check)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid QR ID');
  }

  // ตรวจ HMAC
  const expectedHmac = createShortHmac(`R:${typeCode}:${id}`);
  if (hmac !== expectedHmac) {
    throw new Error('Invalid QR signature');
  }

  return {
    type: typeCode === 'p' ? 'participant' : 'student',
    id
  };
}

// ─── Generate QR for Participant ─────────────────────────

/**
 * สร้าง QR Code สำหรับผู้ลงทะเบียน (Case 1 — บุคคลทั่วไป)
 *
 * @param participantId - UUID ของ participant
 * @returns QR result (qrData + data URL + person info)
 * @throws Error ถ้าไม่พบ participant
 */
export async function generateParticipantQr(participantId: string): Promise<QrResult> {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    select: { id: true, firstName: true, lastName: true }
  });

  if (!participant) {
    throw new Error('Participant not found');
  }

  const qrData = buildQrData('p', participant.id);

  const dataUrl = await QRCode.toDataURL(qrData, {
    errorCorrectionLevel: 'H',   // High error correction (QR เล็กจึงทำได้)
    margin: 2,
    width: 300,
    color: { dark: '#000000', light: '#ffffff' }
  });

  return {
    qrData,
    dataUrl,
    person: {
      id: participant.id,
      type: 'participant',
      name: `${participant.firstName} ${participant.lastName}`
    }
  };
}

// ─── Generate QR for Student ─────────────────────────────

/**
 * สร้าง QR Code สำหรับนักเรียน (Case 2 — โรงเรียน)
 *
 * @param studentId - UUID ของ student
 * @returns QR result
 */
export async function generateStudentQr(studentId: string): Promise<QrResult> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, firstName: true, lastName: true }
  });

  if (!student) {
    throw new Error('Student not found');
  }

  const qrData = buildQrData('s', student.id);

  const dataUrl = await QRCode.toDataURL(qrData, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 300,
    color: { dark: '#000000', light: '#ffffff' }
  });

  return {
    qrData,
    dataUrl,
    person: {
      id: student.id,
      type: 'student',
      name: `${student.firstName} ${student.lastName}`
    }
  };
}

// ─── Bulk QR Generation ──────────────────────────────────

/**
 * สร้าง QR Code ให้นักเรียนทั้งหมดของครูคนหนึ่ง
 *
 * @param teacherId - UUID ของ participant ที่เป็นครู
 * @returns Array ของ QR results
 */
export async function generateBulkStudentQr(teacherId: string): Promise<Array<QrResult & { studentId: string; studentName: string }>> {
  const students = await prisma.student.findMany({
    where: { teacherId },
    orderBy: [{ classRoom: 'asc' }, { lastName: 'asc' }]
  });

  const results = [];
  for (const student of students) {
    const qr = await generateStudentQr(student.id);
    results.push({
      ...qr,
      studentId: student.id,
      studentName: `${student.firstName} ${student.lastName}`
    });
  }

  return results;
}
