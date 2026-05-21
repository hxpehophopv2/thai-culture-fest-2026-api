import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath });

import { syncRegisteredUsers } from '../src/services/richmenu.service.js';

async function run() {
  console.log('Syncing all registered users to the new RICH_MENU_REGISTERED_ID...');
  const result = await syncRegisteredUsers();
  console.log('Sync Complete:');
  console.log(`  Total Registered Users: ${result.total}`);
  console.log(`  Successfully Linked: ${result.linked}`);
  console.log(`  Errors: ${result.errors}`);
}

run().catch(err => {
  console.error('Failed to sync rich menus:', err);
  process.exit(1);
});
