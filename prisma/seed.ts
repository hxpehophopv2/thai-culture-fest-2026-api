import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding ROOTED 2026 data...');

  // ─── Event ──────────────────────────────────────────
  const event = await prisma.event.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'KMUTT ROOTED 2026',
      startsAt: new Date('2026-05-17T09:00:00+07:00'),
      endsAt: new Date('2026-05-17T16:00:00+07:00')
    }
  });

  console.log(`✅ Event: ${event.name}`);

  // ─── Activities + Sessions ──────────────────────────
  // Data from Confluence spec: Registration Activity Session System

  const activitiesData = [
    {
      name: 'Gate Check-in',
      nameTh: 'ลงทะเบียนเข้างาน',
      zone: 'GATE',
      sortOrder: 0,
      sessions: [] // Gate ไม่มี session — ใช้แค่ booth code
    },
    {
      name: 'Fresh Flower Garland Weaving',
      nameTh: 'ร้อยมาลัยดอกไม้สด',
      zone: 'LAB',
      sortOrder: 1,
      sessions: [
        { start: '09:00', end: '10:30', capacity: 8 },
        { start: '10:30', end: '12:00', capacity: 8 },
        { start: '13:00', end: '14:30', capacity: 8 },
        { start: '14:30', end: '16:00', capacity: 8 }
      ]
    },
    {
      name: 'Thai Hanging Ornament "Puang Mahot"',
      nameTh: 'ประดิษฐ์เครื่องแขวนไทย \'พวงมโหตร\'',
      zone: 'LAB',
      sortOrder: 2,
      sessions: [
        { start: '09:00', end: '10:00', capacity: 8 },
        { start: '10:00', end: '11:00', capacity: 8 },
        { start: '11:00', end: '12:00', capacity: 8 },
        { start: '13:00', end: '14:00', capacity: 8 },
        { start: '14:00', end: '15:00', capacity: 8 },
        { start: '15:00', end: '16:00', capacity: 8 }
      ]
    },
    {
      name: 'Bamboo Fan Weaving',
      nameTh: 'สานพัดไม้ไผ่',
      zone: 'LAB',
      sortOrder: 3,
      sessions: [
        { start: '09:00', end: '10:00', capacity: 8 },
        { start: '10:00', end: '11:00', capacity: 8 },
        { start: '11:00', end: '12:00', capacity: 8 },
        { start: '13:00', end: '14:00', capacity: 8 },
        { start: '14:00', end: '15:00', capacity: 8 },
        { start: '15:00', end: '16:00', capacity: 8 }
      ]
    },
    {
      name: 'Thai Accessory Crafting',
      nameTh: 'ประดิษฐ์เครื่องประดับไทย',
      zone: 'LAB',
      sortOrder: 4,
      sessions: [
        { start: '09:00', end: '12:00', capacity: 10 },
        { start: '13:00', end: '16:00', capacity: 10 }
      ]
    },
    {
      name: 'Khon Mask Painting',
      nameTh: 'การเขียนสี - เขียนหน้าหัวโขน',
      zone: 'LAB',
      sortOrder: 5,
      sessions: [
        { start: '10:00', end: '12:00', capacity: 10 },
        { start: '13:00', end: '15:00', capacity: 10 }
      ]
    },
    {
      name: 'Panel Discussion & Khon Performance',
      nameTh: 'กิจกรรมเสวนา "เด็กวิทย์หัวใจศิลป์" และรับชมการแสดงโขน นาฏศิลป์',
      zone: 'STAGE',
      sortOrder: 6,
      sessions: [
        { start: '13:00', end: '15:30', capacity: 140 }
      ]
    }
  ];

  const EVENT_DATE = '2026-05-17';

  for (const actData of activitiesData) {
    // Upsert activity
    const activity = await prisma.activity.upsert({
      where: {
        id: `00000000-0000-0000-0000-00000000000${actData.sortOrder}`
      },
      update: {
        name: actData.name,
        nameTh: actData.nameTh,
        zone: actData.zone,
        sortOrder: actData.sortOrder,
        isActive: true
      },
      create: {
        id: `00000000-0000-0000-0000-00000000000${actData.sortOrder}`,
        eventId: event.id,
        name: actData.name,
        nameTh: actData.nameTh,
        zone: actData.zone,
        sortOrder: actData.sortOrder
      }
    });

    console.log(`  📌 Activity: ${actData.nameTh} (${actData.sessions.length} sessions)`);

    // Create sessions for this activity
    for (const sess of actData.sessions) {
      const startTime = new Date(`${EVENT_DATE}T${sess.start}:00+07:00`);
      const endTime = new Date(`${EVENT_DATE}T${sess.end}:00+07:00`);

      const existing = await prisma.session.findFirst({
        where: { activityId: activity.id, startTime }
      });

      if (!existing) {
        await prisma.session.create({
          data: {
            activityId: activity.id,
            startTime,
            endTime,
            capacity: sess.capacity
          }
        });
      }
    }
  }

  // Summary
  const actCount = await prisma.activity.count();
  const sessCount = await prisma.session.count();
  console.log(`\n🎉 Seed complete: ${actCount} activities, ${sessCount} sessions`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('❌ Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
