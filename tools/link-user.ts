import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath });

import { linkRegisteredMenuToUser } from '../src/services/richmenu.service.js';

const userId = process.argv[2];

if (!userId) {
  console.error('Please provide a LINE User ID. Example: npx tsx tools/link-user.ts U1234567890abcdef1234567890abcdef');
  process.exit(1);
}

async function run() {
  console.log(`Manually linking registered rich menu to user ID: ${userId}...`);
  await linkRegisteredMenuToUser(userId);
  console.log('Done!');
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
