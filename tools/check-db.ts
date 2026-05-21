import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath });

import { prisma } from '../src/lib/prisma.js';

async function run() {
  const participants = await prisma.participant.findMany();
  console.log(`Total participants in DB: ${participants.length}`);
  console.log(JSON.stringify(participants, null, 2));
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
