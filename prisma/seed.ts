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
      description: null,
      sortOrder: 0,
      sessions: [] // Gate ไม่มี session — ใช้แค่ booth code
    },
    {
      name: 'Hand Garland Workshop',
      nameTh: 'ร้อยมาลัยดอกไม้สด',
      zone: 'LAB',
      description: 'Discover the elegance of traditional Thai flower garlands through a fun and creative hands-on experience. Learn basic garland-making techniques, explore the cultural meaning behind Thai floral crafts, and create your own beautiful handmade garland to take home.',
      sortOrder: 1,
      sessions: [
        { start: '09:00', end: '10:30', capacity: 8 },
        { start: '10:30', end: '12:00', capacity: 8 },
        { start: '13:00', end: '14:30', capacity: 8 },
        { start: '14:30', end: '16:00', capacity: 8 }
      ]
    },
    {
      name: 'Phuang Mahot Workshop',
      nameTh: 'ประดิษฐ์เครื่องแขวนไทย \'พวงมโหตร\'',
      zone: 'LAB',
      description: 'Discover the beauty of "Phuang Mahot", a traditional Thai hanging decoration commonly seen at temple fairs, religious ceremonies, and auspicious events. Participants will learn about its cultural significance and experience creating colorful paper decorations inspired by traditional Thai craftsmanship.',
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
      name: 'Thai Bamboo Hand Fans Workshop',
      nameTh: 'สานพัดไม้ไผ่',
      zone: 'LAB',
      description: 'Create your own traditional Thai bamboo hand fan and discover the charm of Thai handmade craftsmanship. Explore beautiful Thai-inspired patterns, learn simple crafting techniques, and enjoy decorating a lightweight eco-friendly souvenir that is both stylish and practical.',
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
      name: 'Thai Dance Ornament Crafting Workshop',
      nameTh: 'ประดิษฐ์เครื่องประดับนาฏศิลป์ไทย',
      zone: 'LAB',
      description: 'Learn how to craft ornaments inspired by Thai classical dance. Create handmade pieces that reflect the elegance, delicacy, and cultural identity of Thai performing arts.',
      sortOrder: 4,
      sessions: [
        { start: '09:00', end: '12:00', capacity: 10 },
        { start: '13:00', end: '16:00', capacity: 10 }
      ]
    },
    {
      name: 'Khon Mask Painting Workshop',
      nameTh: 'การเขียนสี - เขียนหน้าหัวโขน',
      zone: 'LAB',
      description: 'Experience creative Thai art through Khon mask painting. Learn about the patterns, colors, and unique characteristics of Khon characters in traditional Thai masked dance drama.',
      sortOrder: 5,
      sessions: [
        { start: '10:00', end: '12:00', capacity: 10 },
        { start: '13:00', end: '15:00', capacity: 10 }
      ]
    },
    {
      name: 'ROOTED Talks & Performance',
      nameTh: 'กิจกรรมเสวนา "เด็กวิทย์หัวใจศิลป์" และรับชมการแสดงนาฏศิลป์',
      zone: 'STAGE',
      description: 'Opening Ceremony, Creative Thai Dance Performance "Roots of Thailand", Discussion: Science Hearts Thai Arts, Khon Performance: Battle Scene, and Suthaphirom Dance.',
      sortOrder: 6,
      sessions: [
        { start: '14:00', end: '15:30', capacity: 50 }
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
        description: actData.description,
        sortOrder: actData.sortOrder,
        isActive: true
      },
      create: {
        id: `00000000-0000-0000-0000-00000000000${actData.sortOrder}`,
        eventId: event.id,
        name: actData.name,
        nameTh: actData.nameTh,
        zone: actData.zone,
        description: actData.description,
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
