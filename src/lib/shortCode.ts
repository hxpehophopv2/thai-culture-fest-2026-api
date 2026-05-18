import { prisma } from './prisma.js';

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * สุ่มรหัส 5 ตัวอักษร */
function randomCode(length = 5): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}

export async function generateUniqueShortCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();

    // เช็คว่าไม่ซ้ำทั้ง participants และ students
    const [existingP, existingS] = await Promise.all([
      prisma.participant.findUnique({ where: { shortCode: code }, select: { id: true } }),
      prisma.student.findUnique({ where: { shortCode: code }, select: { id: true } })
    ]);

    if (!existingP && !existingS) {
      return code;
    }
  }

  // Fallback: ถ้า 10 ครั้งยังซ้ำ → เพิ่มเป็น 6 ตัว
  const fallback = randomCode(6);
  return fallback;
}
