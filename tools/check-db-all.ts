import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath });

import { prisma } from '../src/lib/prisma.js';

async function run() {
  const events = await prisma.event.findMany();
  const activities = await prisma.activity.findMany();
  const sessions = await prisma.session.findMany();
  const participants = await prisma.participant.findMany();
  const bookings = await prisma.booking.findMany();
  
  console.log(`Events: ${events.length}`);
  console.log(`Activities: ${activities.length}`);
  console.log(`Sessions: ${sessions.length}`);
  console.log(`Participants: ${participants.length}`);
  console.log(`Bookings: ${bookings.length}`);
  
  if (events.length > 0) {
    console.log('Sample Event:', JSON.stringify(events[0], null, 2));
  }
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
