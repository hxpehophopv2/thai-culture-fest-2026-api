import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath });

import { setupRichMenus, deleteAllRichMenus } from '../src/services/richmenu.service.js';

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!token) {
  console.error('Error: LINE_CHANNEL_ACCESS_TOKEN is missing in .env');
  process.exit(1);
}

async function run() {
  console.log('Cleaning up all old rich menus from LINE...');
  const { deleted } = await deleteAllRichMenus();
  console.log(`Deleted ${deleted} old rich menus.`);

  console.log('Running setupRichMenus to create new ones and upload images...');
  const result = await setupRichMenus();
  console.log('New Rich Menus created:');
  console.log(`  Default ID: ${result.defaultMenuId}`);
  console.log(`  Registered ID: ${result.registeredMenuId}`);

  // Read .env file content
  let envContent = fs.readFileSync(envPath, 'utf8');

  // Replace old IDs with new ones
  if (envContent.includes('RICH_MENU_DEFAULT_ID=')) {
    envContent = envContent.replace(/RICH_MENU_DEFAULT_ID=.*/g, `RICH_MENU_DEFAULT_ID=${result.defaultMenuId}`);
  } else {
    envContent += `\nRICH_MENU_DEFAULT_ID=${result.defaultMenuId}`;
  }

  if (envContent.includes('RICH_MENU_REGISTERED_ID=')) {
    envContent = envContent.replace(/RICH_MENU_REGISTERED_ID=.*/g, `RICH_MENU_REGISTERED_ID=${result.registeredMenuId}`);
  } else {
    envContent += `\nRICH_MENU_REGISTERED_ID=${result.registeredMenuId}`;
  }

  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('Updated .env with the new Rich Menu IDs successfully!');
}

run().catch(err => {
  console.error('Failed to recreate rich menus:', err);
  process.exit(1);
});
