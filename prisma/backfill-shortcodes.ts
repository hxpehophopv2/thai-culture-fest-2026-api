/**
 * Backfill short codes for existing participants and students
 * ที่ยังไม่มี shortCode (NULL)
 * 
 * Usage: npx tsx prisma/backfill-shortcodes.ts
 */

import { PrismaClient } from '@prisma/client';

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length = 5): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}

async function main() {
  const prisma = new PrismaClient();

  try {
    // Collect all existing short codes
    const existingCodes = new Set<string>();
    
    const allP = await prisma.participant.findMany({ select: { shortCode: true } });
    const allS = await prisma.student.findMany({ select: { shortCode: true } });
    
    allP.forEach(p => { if (p.shortCode) existingCodes.add(p.shortCode); });
    allS.forEach(s => { if (s.shortCode) existingCodes.add(s.shortCode); });

    function generateUnique(): string {
      for (let i = 0; i < 100; i++) {
        const code = randomCode();
        if (!existingCodes.has(code)) {
          existingCodes.add(code);
          return code;
        }
      }
      // fallback 6 chars
      const code = randomCode(6);
      existingCodes.add(code);
      return code;
    }

    // Backfill participants
    const participantsToFill = await prisma.participant.findMany({
      where: { shortCode: null },
      select: { id: true, firstName: true, lastName: true }
    });

    console.log(`Found ${participantsToFill.length} participants without shortCode`);

    for (const p of participantsToFill) {
      const code = generateUnique();
      await prisma.participant.update({
        where: { id: p.id },
        data: { shortCode: code }
      });
      console.log(`  ${p.firstName} ${p.lastName} → ${code}`);
    }

    // Backfill students
    const studentsToFill = await prisma.student.findMany({
      where: { shortCode: null },
      select: { id: true, firstName: true, lastName: true }
    });

    console.log(`Found ${studentsToFill.length} students without shortCode`);

    for (const s of studentsToFill) {
      const code = generateUnique();
      await prisma.student.update({
        where: { id: s.id },
        data: { shortCode: code }
      });
      console.log(`  ${s.firstName} ${s.lastName} → ${code}`);
    }

    console.log('\n✅ Backfill complete!');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
