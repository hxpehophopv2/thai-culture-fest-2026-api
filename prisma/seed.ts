import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const event = await prisma.event.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'ROOTED 2026',
      startsAt: new Date('2026-05-17T09:00:00+07:00'),
      endsAt: new Date('2026-05-17T16:00:00+07:00')
    }
  });

  const activities = [
    { baseNumber: 1, name: 'Base 1 - Chemistry' },
    { baseNumber: 2, name: 'Base 2 - Astronomy' },
    { baseNumber: 3, name: 'Base 3 - Robotics' },
    { baseNumber: 4, name: 'Base 4 - Biology' },
    { baseNumber: 5, name: 'Base 5 - Engineering' }
  ];

  for (const activity of activities) {
    const saved = await prisma.activity.upsert({
      where: {
        eventId_baseNumber: {
          eventId: event.id,
          baseNumber: activity.baseNumber
        }
      },
      update: { name: activity.name, isActive: true },
      create: {
        eventId: event.id,
        baseNumber: activity.baseNumber,
        name: activity.name
      }
    });

    for (const hour of [9, 10, 11, 13, 14]) {
      const startTime = new Date(`2026-05-17T${String(hour).padStart(2, '0')}:00:00+07:00`);
      const endTime = new Date(startTime.getTime() + 45 * 60 * 1000);

      const existing = await prisma.slot.findFirst({
        where: { activityId: saved.id, startTime }
      });

      if (!existing) {
        await prisma.slot.create({
          data: {
            activityId: saved.id,
            startTime,
            endTime,
            capacity: 25
          }
        });
      }
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
