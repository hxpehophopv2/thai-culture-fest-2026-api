/**
 * ลบข้อมูลทดสอบทั้งหมด (participants, students, bookings, scan_logs)
 * แต่เก็บ activities + sessions + event ไว้
 * 
 * Usage:
 *   npx tsx prisma/reset-data.ts
 * 
 * สำหรับ Azure production:
 *   $env:DATABASE_URL = "postgresql://rootedadmin:R00ted2026!SecureDB@rooted2026-db.postgres.database.azure.com:5432/rooted_registration?sslmode=require"
 *   npx tsx prisma/reset-data.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetData() {
  console.log('🗑️  กำลังลบข้อมูลทดสอบ...\n');

  // ต้องลบตามลำดับ (FK constraints)
  const scanLogs = await prisma.scanLog.deleteMany({});
  console.log(`  ✅ scan_logs: ลบ ${scanLogs.count} records`);

  const staffSessions = await prisma.staffSession.deleteMany({});
  console.log(`  ✅ staff_sessions: ลบ ${staffSessions.count} records`);

  const bookings = await prisma.booking.deleteMany({});
  console.log(`  ✅ bookings: ลบ ${bookings.count} records`);

  const students = await prisma.student.deleteMany({});
  console.log(`  ✅ students: ลบ ${students.count} records`);

  const participants = await prisma.participant.deleteMany({});
  console.log(`  ✅ participants: ลบ ${participants.count} records`);

  // Reset bookedCount ของทุก session กลับเป็น 0
  const sessions = await prisma.session.updateMany({
    data: { bookedCount: 0 }
  });
  console.log(`  ✅ sessions: reset bookedCount = 0 (${sessions.count} sessions)`);

  console.log('\n🎉 เคลียร์ข้อมูลเสร็จ! กิจกรรม + รอบเวลา ยังอยู่ครบ');
  console.log('   พร้อมใช้งานวันจริงแล้ว 🌿\n');
}

resetData()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
