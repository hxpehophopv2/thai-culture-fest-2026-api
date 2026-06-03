/**
 * Admin Student Import Service (V2) — Excel Template with Activity Bookings
 * ─────────────────────────────────────────────────────────────
 *
 * ⚠️ ไฟล์นี้ยังไม่ได้ deploy — เตรียมโค้ดไว้ local เท่านั้น
 *
 * Parse Excel Template V2 ที่มีทั้งข้อมูลนักเรียน + การจองกิจกรรม
 * → สร้าง Student + Book Session ในขั้นตอนเดียว
 *
 * Columns:
 *   A: ชื่อ *       B: นามสกุล *     C: เลขประจำตัว
 *   D: ห้อง         E: โรงเรียน
 *   F: ร้อยมาลัย    G: พวงมโหตร      H: สานพัด
 *   I: นาฏศิลป์     J: หัวโขน        K: เสวนา
 */

import { prisma } from '../lib/prisma.js';
import { generateUniqueShortCode } from '../lib/shortCode.js';
import { generateStudentQr } from './qr.service.js';
import ExcelJS from 'exceljs';
import type { Readable } from 'stream';

// ─── Types ───────────────────────────────────────────────

/** คอลัมน์กิจกรรมใน Excel: colIndex → ชื่อที่ใช้ค้นหา activity ใน DB */
const ACTIVITY_COLUMNS = [
  { colIndex: 7,  namePattern: 'ร้อยมาลัย' },
  { colIndex: 8,  namePattern: 'พวงมโหตร' },
  { colIndex: 9,  namePattern: 'สานพัด' },
  { colIndex: 10, namePattern: 'นาฏศิลป์' },
  { colIndex: 11, namePattern: 'เสวนา' },
];

export interface StudentImportRow {
  rowNumber: number;
  firstName: string;
  lastName: string;
  studentCode?: string;
  classRoom?: string;
  schoolName?: string;
  dateOfBirth?: Date;
  /** เวลาที่เลือกจาก dropdown แต่ละ column (null = ไม่เข้าร่วม) */
  activitySelections: Array<{
    activityName: string;
    selectedTime: string | null;
  }>;
}

/**
 * ฟังก์ชันช่วยแปลงข้อมูลวันที่จาก Excel ให้เป็น Date object ที่ถูกต้อง
 */
export function parseExcelDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    let year = value.getFullYear();
    if (year > 2400) {
      value.setFullYear(year - 543);
    }
    return value;
  }
  const str = String(value).trim();
  if (!str) return null;

  // รูปแบบ YYYY-MM-DD
  let match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    let year = parseInt(match[1]);
    if (year > 2400) year -= 543;
    const month = parseInt(match[2]) - 1;
    const day = parseInt(match[3]);
    return new Date(Date.UTC(year, month, day));
  }

  // รูปแบบ DD/MM/YYYY
  match = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    let year = parseInt(match[3]);
    if (year > 2400) year -= 543;
    const month = parseInt(match[2]) - 1;
    const day = parseInt(match[1]);
    return new Date(Date.UTC(year, month, day));
  }

  const parsed = Date.parse(str);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    let year = d.getFullYear();
    if (year > 2400) {
      d.setFullYear(year - 543);
    }
    return d;
  }

  return null;
}

export interface ImportPreviewResult {
  valid: StudentImportRow[];
  errors: Array<{ rowNumber: number; message: string }>;
  totalRows: number;
  /** สรุปจำนวนจองต่อกิจกรรม */
  bookingSummary: Array<{ activity: string; count: number }>;
}

export interface ImportResult {
  studentsCreated: number;
  bookingsCreated: number;
  qrCodesGenerated: number;
  errors: Array<{ rowNumber: number; student: string; message: string }>;
  students: Array<{
    id: string;
    name: string;
    shortCode: string;
    bookings: string[];
    qrDataUrl?: string;
  }>;
}

// ─── Error Class ─────────────────────────────────────────

export class ImportError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ImportError';
  }
}

// ─── Parse Excel V2 ──────────────────────────────────────

/**
 * Parse Excel template v2 (preview only — ไม่บันทึกลง DB)
 *
 * @param fileBuffer - Buffer ของไฟล์ Excel
 * @returns preview result
 */
export async function parseStudentExcelV2(
  fileBuffer: Buffer | Readable
): Promise<ImportPreviewResult> {
  const workbook = new ExcelJS.Workbook();

  if (Buffer.isBuffer(fileBuffer)) {
    await workbook.xlsx.load(fileBuffer as unknown as ArrayBuffer);
  } else {
    await workbook.xlsx.read(fileBuffer);
  }

  const ws = workbook.worksheets[0];
  if (!ws) {
    return {
      valid: [], totalRows: 0,
      errors: [{ rowNumber: 0, message: 'ไม่พบ worksheet ในไฟล์' }],
      bookingSummary: []
    };
  }

  const valid: StudentImportRow[] = [];
  const errors: ImportPreviewResult['errors'] = [];
  let totalRows = 0;

  ws.eachRow((row, rowNumber) => {
    // ข้าม header 2 แถว
    if (rowNumber <= 2) return;
    totalRows++;

    const firstName = String(row.getCell(1).value ?? '').trim();
    const lastName = String(row.getCell(2).value ?? '').trim();

    // ข้ามแถวว่าง
    if (!firstName && !lastName) {
      totalRows--;
      return;
    }

    if (!firstName) {
      errors.push({ rowNumber, message: 'ชื่อว่างเปล่า' });
      return;
    }
    if (!lastName) {
      errors.push({ rowNumber, message: 'นามสกุลว่างเปล่า' });
      return;
    }

    const studentCode = String(row.getCell(3).value ?? '').trim() || undefined;
    const classRoom = String(row.getCell(4).value ?? '').trim() || undefined;
    const schoolName = String(row.getCell(5).value ?? '').trim() || undefined;
    const dateOfBirth = parseExcelDate(row.getCell(6).value) || undefined;

    // Parse activity selections (Column F–K)
    const activitySelections = ACTIVITY_COLUMNS.map(ac => {
      const rawValue = String(row.getCell(ac.colIndex).value ?? '').trim();
      let selectedTime: string | null = null;

      if (rawValue && rawValue !== 'ไม่เข้าร่วม') {
        if (/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(rawValue)) {
          selectedTime = rawValue;
        } else {
          errors.push({
            rowNumber,
            message: `รอบเวลาไม่ถูกต้อง "${ac.namePattern}": "${rawValue}" (ต้องเป็น HH:MM-HH:MM)`
          });
        }
      }

      return { activityName: ac.namePattern, selectedTime };
    });

    valid.push({
      rowNumber, firstName, lastName,
      studentCode, classRoom, schoolName, dateOfBirth,
      activitySelections
    });
  });

  // สร้างสรุปจำนวนจอง
  const bookingSummary = ACTIVITY_COLUMNS.map(ac => ({
    activity: ac.namePattern,
    count: valid.filter(v =>
      v.activitySelections.find(a => a.activityName === ac.namePattern)?.selectedTime
    ).length
  }));

  return { valid, errors, totalRows, bookingSummary };
}

// ─── Resolve Session from Time String ────────────────────

/**
 * จับคู่ activity + session จากชื่อและเวลา
 * Cache ผลลัพธ์เพื่อไม่ต้อง query DB ซ้ำ
 */
const sessionCache = new Map<string, { sessionId: string; activityId: string; capacity: number; bookedCount: number } | null>();

async function resolveSession(activityNamePattern: string, timeStr: string) {
  const cacheKey = `${activityNamePattern}:${timeStr}`;
  if (sessionCache.has(cacheKey)) return sessionCache.get(cacheKey)!;

  // หา activity จากชื่อ
  const activity = await prisma.activity.findFirst({
    where: { isActive: true, nameTh: { contains: activityNamePattern } },
    include: {
      sessions: {
        where: { isVisible: true },
        orderBy: { startTime: 'asc' }
      }
    }
  });

  if (!activity) {
    sessionCache.set(cacheKey, null);
    return null;
  }

  // Parse time "HH:MM-HH:MM"
  const [startStr, endStr] = timeStr.split('-');
  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM] = endStr.split(':').map(Number);

  for (const s of activity.sessions) {
    const sStart = new Date(s.startTime);
    const sEnd = new Date(s.endTime);
    const sStartH = (sStart.getUTCHours() + 7) % 24;
    const sStartM = sStart.getUTCMinutes();
    const sEndH = (sEnd.getUTCHours() + 7) % 24;
    const sEndM = sEnd.getUTCMinutes();

    if (sStartH === startH && sStartM === startM && sEndH === endH && sEndM === endM) {
      const result = {
        sessionId: s.id,
        activityId: activity.id,
        capacity: s.capacity,
        bookedCount: s.bookedCount
      };
      sessionCache.set(cacheKey, result);
      return result;
    }
  }

  sessionCache.set(cacheKey, null);
  return null;
}

// ─── Import (Create Students + Book Sessions) ────────────

/**
 * Import นักเรียนจาก parsed data → สร้าง Student + จอง Session
 *
 * @param teacherId - UUID ของ participant ที่เป็นครู
 * @param rows - ข้อมูลที่ parse แล้วจาก parseStudentExcelV2
 * @param generateQr - สร้าง QR code ให้เลยไหม (default: true)
 * @returns ผลลัพธ์การ import
 */
export async function importStudentsWithBookings(
  teacherId: string,
  rows: StudentImportRow[],
  generateQr = true
): Promise<ImportResult> {
  // ตรวจว่า teacher มีจริง
  const teacher = await prisma.participant.findUnique({
    where: { id: teacherId },
    select: { id: true, firstName: true, lastName: true, participantType: true }
  });

  if (!teacher) {
    throw new ImportError('TEACHER_NOT_FOUND', 'ไม่พบข้อมูลครู');
  }

  // Clear session cache
  sessionCache.clear();

  let studentsCreated = 0;
  let bookingsCreated = 0;
  let qrCodesGenerated = 0;
  const errors: ImportResult['errors'] = [];
  const students: ImportResult['students'] = [];

  for (const row of rows) {
    try {
      // สร้าง student
      const shortCode = await generateUniqueShortCode();
      const student = await prisma.student.create({
        data: {
          teacherId,
          firstName: row.firstName,
          lastName: row.lastName,
          studentCode: row.studentCode ?? null,
          classRoom: row.classRoom ?? null,
          schoolName: row.schoolName ?? null,
          dateOfBirth: row.dateOfBirth ?? null,
          shortCode
        }
      });
      studentsCreated++;

      const bookingNames: string[] = [];

      // จอง sessions
      for (const sel of row.activitySelections) {
        if (!sel.selectedTime) continue;

        const resolved = await resolveSession(sel.activityName, sel.selectedTime);
        if (!resolved) {
          errors.push({
            rowNumber: row.rowNumber,
            student: `${row.firstName} ${row.lastName}`,
            message: `ไม่พบรอบ ${sel.activityName} ${sel.selectedTime}`
          });
          continue;
        }

        // ตรวจ capacity
        if (resolved.bookedCount >= resolved.capacity) {
          errors.push({
            rowNumber: row.rowNumber,
            student: `${row.firstName} ${row.lastName}`,
            message: `${sel.activityName} ${sel.selectedTime} เต็มแล้ว (${resolved.bookedCount}/${resolved.capacity})`
          });
          continue;
        }

        // Atomic: สร้าง booking + increment booked_count
        await prisma.$transaction(async (tx) => {
          await tx.booking.create({
            data: { studentId: student.id, sessionId: resolved.sessionId }
          });
          await tx.session.update({
            where: { id: resolved.sessionId },
            data: { bookedCount: { increment: 1 } }
          });
        });

        // อัพเดท cache
        resolved.bookedCount++;
        bookingsCreated++;
        bookingNames.push(`${sel.activityName} ${sel.selectedTime}`);
      }

      // สร้าง QR (optional)
      let qrDataUrl: string | undefined;
      if (generateQr) {
        try {
          const qr = await generateStudentQr(student.id);
          qrDataUrl = qr.dataUrl;
          qrCodesGenerated++;
        } catch {
          // ถ้าสร้าง QR ไม่ได้ ไม่ block import
        }
      }

      students.push({
        id: student.id,
        name: `${row.firstName} ${row.lastName}`,
        shortCode,
        bookings: bookingNames,
        qrDataUrl
      });

    } catch (err: any) {
      errors.push({
        rowNumber: row.rowNumber,
        student: `${row.firstName} ${row.lastName}`,
        message: err.message
      });
    }
  }

  return { studentsCreated, bookingsCreated, qrCodesGenerated, errors, students };
}

// ─── Get Teacher by LINE User ID or Participant ID ───────

export async function resolveTeacher(identifier: string) {
  // ถ้าเป็น UUID → ค้นจาก id
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

  const teacher = isUuid
    ? await prisma.participant.findUnique({ where: { id: identifier }, select: { id: true, firstName: true, lastName: true, participantType: true } })
    : await prisma.participant.findUnique({ where: { lineUserId: identifier }, select: { id: true, firstName: true, lastName: true, participantType: true } });

  if (!teacher) {
    throw new ImportError('TEACHER_NOT_FOUND', 'ไม่พบข้อมูลครู');
  }

  return teacher;
}
