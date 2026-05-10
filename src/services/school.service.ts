/**
 * School Service (Case 2 — ครู + นักเรียน)
 * ─────────────────────────────────────────────────────────────
 *
 * จัดการ flow ที่ครูลงทะเบียนให้นักเรียนทั้งห้อง:
 *
 *   1. ครูลงทะเบียนตัวเองก่อน (เป็น Participant ปกติ)
 *   2. ครูอัปโหลด Excel รายชื่อนักเรียน → ระบบ parse + สร้าง Student records
 *   3. ครูเลือกรอบให้นักเรียนแต่ละคน → ระบบสร้าง Bookings
 *   4. ครูกดสร้าง QR → ระบบ generate QR per student
 *   5. ครูพิมพ์ QR Card → แจกให้เด็กห้อยคอวันงาน
 *
 * ─────────────────────────────────────────────────────────────
 */

import { prisma } from '../lib/prisma.js';
import ExcelJS from 'exceljs';
import type { Readable } from 'stream';

// ─── Types ───────────────────────────────────────────────

/** ข้อมูลนักเรียนจาก Excel */
export interface StudentInput {
  firstName: string;
  lastName: string;
  studentCode?: string;
  classRoom?: string;
  schoolName?: string;
}

/** ผลลัพธ์การ parse Excel */
export interface ExcelParseResult {
  /** นักเรียนที่ parse สำเร็จ */
  valid: Array<StudentInput & { rowNumber: number }>;
  /** แถวที่มีปัญหา */
  errors: Array<{ rowNumber: number; message: string }>;
  /** จำนวนแถวทั้งหมด */
  totalRows: number;
}

/** ข้อมูลการจองรอบให้นักเรียน */
export interface StudentBookingInput {
  studentId: string;
  sessionIds: string[];
}

// ─── Parse Excel ─────────────────────────────────────────

/**
 * Parse ไฟล์ Excel (.xlsx) ที่ครูอัปโหลดรายชื่อนักเรียน
 *
 * Format ที่รองรับ:
 *   Column A: ชื่อ (firstName) — required
 *   Column B: นามสกุล (lastName) — required
 *   Column C: เลขประจำตัว (studentCode) — optional
 *   Column D: ห้อง (classRoom) — optional
 *   Column E: โรงเรียน (schoolName) — optional
 *
 * แถวแรก = header (ข้ามไป)
 * แถวที่ว่าง = ข้ามไป
 *
 * @param fileBuffer - Buffer ของไฟล์ Excel
 * @returns ผลลัพธ์: valid students + errors
 */
export async function parseStudentExcel(
  fileBuffer: Buffer | Readable
): Promise<ExcelParseResult> {
  const workbook = new ExcelJS.Workbook();

  if (Buffer.isBuffer(fileBuffer)) {
    await workbook.xlsx.load(fileBuffer as unknown as ArrayBuffer);
  } else {
    await workbook.xlsx.read(fileBuffer);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { valid: [], errors: [{ rowNumber: 0, message: 'ไม่พบ worksheet ในไฟล์' }], totalRows: 0 };
  }

  const valid: ExcelParseResult['valid'] = [];
  const errors: ExcelParseResult['errors'] = [];
  let totalRows = 0;

  worksheet.eachRow((row, rowNumber) => {
    // ข้ามแถวแรก (header)
    if (rowNumber === 1) return;
    totalRows++;

    const firstName = String(row.getCell(1).value ?? '').trim();
    const lastName = String(row.getCell(2).value ?? '').trim();
    const studentCode = String(row.getCell(3).value ?? '').trim() || undefined;
    const classRoom = String(row.getCell(4).value ?? '').trim() || undefined;
    const schoolName = String(row.getCell(5).value ?? '').trim() || undefined;

    // Validate
    if (!firstName) {
      errors.push({ rowNumber, message: 'ชื่อว่างเปล่า' });
      return;
    }
    if (!lastName) {
      errors.push({ rowNumber, message: 'นามสกุลว่างเปล่า' });
      return;
    }

    valid.push({ rowNumber, firstName, lastName, studentCode, classRoom, schoolName });
  });

  return { valid, errors, totalRows };
}

// ─── Create Students ─────────────────────────────────────

/**
 * สร้าง Student records จากข้อมูลที่ parse แล้ว
 *
 * ใช้ createMany เพื่อ insert ทีเดียว (เร็วกว่า loop)
 *
 * @param teacherId - UUID ของ participant ที่เป็นครู
 * @param students - Array ของ student data
 * @returns จำนวนที่สร้างสำเร็จ + student records
 */
export async function createStudents(
  teacherId: string,
  students: StudentInput[]
) {
  // ตรวจว่า teacher มีจริง
  const teacher = await prisma.participant.findUnique({
    where: { id: teacherId },
    select: { id: true, firstName: true, lastName: true }
  });

  if (!teacher) {
    throw new SchoolError('TEACHER_NOT_FOUND', 'ไม่พบข้อมูลครู / Teacher not found');
  }

  // สร้าง students ทีละคน (เพราะต้อง return IDs)
  const created = [];
  for (const s of students) {
    const student = await prisma.student.create({
      data: {
        teacherId,
        firstName: s.firstName,
        lastName: s.lastName,
        studentCode: s.studentCode ?? null,
        classRoom: s.classRoom ?? null,
        schoolName: s.schoolName ?? null
      }
    });
    created.push(student);
  }

  return {
    count: created.length,
    students: created,
    message: `สร้างข้อมูลนักเรียน ${created.length} คนสำเร็จ`
  };
}

// ─── Get Teacher's Students ──────────────────────────────

/**
 * ดึงรายชื่อนักเรียนทั้งหมดของครูคนหนึ่ง
 * พร้อม bookings ที่จองไว้
 */
export async function getStudentsByTeacher(teacherId: string) {
  return prisma.student.findMany({
    where: { teacherId },
    include: {
      bookings: {
        where: { status: 'CONFIRMED' },
        include: {
          session: {
            include: {
              activity: { select: { id: true, name: true, nameTh: true, zone: true } }
            }
          }
        },
        orderBy: { session: { startTime: 'asc' } }
      }
    },
    orderBy: [{ classRoom: 'asc' }, { lastName: 'asc' }]
  });
}

// ─── Book Sessions for Students ──────────────────────────

/**
 * จองรอบกิจกรรมให้นักเรียน (single student)
 *
 * เหมือน registration.service.ts แต่ใช้ studentId แทน participantId:
 *   1. ตรวจ sessions มีจริง
 *   2. ตรวจ time overlap
 *   3. ตรวจ capacity
 *   4. Atomic transaction: สร้าง bookings + increment bookedCount
 *
 * @param studentId - UUID ของ student
 * @param sessionIds - Array ของ session UUIDs ที่จะจอง
 */
export async function bookSessionsForStudent(
  studentId: string,
  sessionIds: string[],
  teacherId: string
) {
  if (sessionIds.length === 0) {
    throw new SchoolError('NO_SESSIONS', 'ต้องเลือกอย่างน้อย 1 รอบ');
  }

  // ตรวจว่า student มีจริง
  const student = await prisma.student.findUnique({
    where: { id: studentId }
  });

  if (!student) {
    throw new SchoolError('STUDENT_NOT_FOUND', 'ไม่พบข้อมูลนักเรียน');
  }

  if (student.teacherId !== teacherId) {
    throw new SchoolError('FORBIDDEN', 'ไม่มีสิทธิ์จัดการนักเรียนคนนี้');
  }

  // ดึง sessions
  const sessions = await prisma.session.findMany({
    where: { id: { in: sessionIds } },
    include: { activity: { select: { name: true, nameTh: true } } }
  });

  if (sessions.length !== sessionIds.length) {
    throw new SchoolError('SESSION_NOT_FOUND', 'ไม่พบรอบกิจกรรมบางรอบ');
  }

  // ตรวจ time overlap
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i], b = sessions[j];
      if (a.startTime < b.endTime && b.startTime < a.endTime) {
        throw new SchoolError(
          'TIME_OVERLAP',
          `เวลาทับซ้อน: ${a.activity.nameTh} กับ ${b.activity.nameTh}`
        );
      }
    }
  }

  // Atomic transaction
  await prisma.$transaction(async (tx) => {
    for (const sessionId of sessionIds) {
      // Lock + check capacity
      const locked = await tx.$queryRaw<Array<{ id: string; capacity: number; booked_count: number }>>`
        SELECT id, capacity, booked_count
        FROM sessions WHERE id = ${sessionId}::uuid FOR UPDATE
      `;

      if (!locked || locked.length === 0) {
        throw new SchoolError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);
      }

      if (locked[0].booked_count >= locked[0].capacity) {
        const sess = sessions.find(s => s.id === sessionId);
        throw new SchoolError('SESSION_FULL', `รอบ ${sess?.activity.nameTh} เต็มแล้ว`);
      }

      // Create booking + increment
      await tx.booking.create({
        data: { studentId, sessionId }
      });

      await tx.session.update({
        where: { id: sessionId },
        data: { bookedCount: { increment: 1 } }
      });
    }
  });

  return {
    studentId,
    sessionCount: sessionIds.length,
    message: `จองรอบกิจกรรมให้ ${student.firstName} ${student.lastName} สำเร็จ ${sessionIds.length} รอบ`
  };
}

// ─── Delete Student ──────────────────────────────────────

/**
 * ลบนักเรียน — cascade ลบ bookings ด้วย
 * (bookedCount จะถูก decrement ด้วย trigger ฝั่ง API)
 */
export async function deleteStudent(studentId: string, teacherId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { bookings: { where: { status: 'CONFIRMED' } } }
  });

  if (!student) {
    throw new SchoolError('NOT_FOUND', 'ไม่พบข้อมูลนักเรียน');
  }

  if (student.teacherId !== teacherId) {
    throw new SchoolError('FORBIDDEN', 'ไม่มีสิทธิ์ลบนักเรียนคนนี้');
  }

  // Decrement bookedCount สำหรับ bookings ที่จะถูกลบ
  await prisma.$transaction(async (tx) => {
    for (const booking of student.bookings) {
      await tx.session.update({
        where: { id: booking.sessionId },
        data: { bookedCount: { decrement: 1 } }
      });
    }

    await tx.student.delete({ where: { id: studentId } });
  });

  return { success: true, message: `ลบ ${student.firstName} ${student.lastName} เรียบร้อย` };
}

export async function assertTeacherOwnsStudent(studentId: string, teacherId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, teacherId: true }
  });

  if (!student) {
    throw new SchoolError('STUDENT_NOT_FOUND', 'ไม่พบข้อมูลนักเรียน');
  }

  if (student.teacherId !== teacherId) {
    throw new SchoolError('FORBIDDEN', 'ไม่มีสิทธิ์จัดการนักเรียนคนนี้');
  }

  return student;
}

// ─── Custom Error ────────────────────────────────────────

export class SchoolError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'SchoolError';
  }
}
