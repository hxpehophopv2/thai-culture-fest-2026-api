import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const richMenuId = process.env.RICH_MENU_REGISTERED_ID;

if (!token) {
  console.error('Error: LINE_CHANNEL_ACCESS_TOKEN is missing in .env');
  process.exit(1);
}

if (!richMenuId) {
  console.error('Error: RICH_MENU_REGISTERED_ID is missing in .env');
  process.exit(1);
}

const imagePath = path.join(__dirname, '../public/richmenu/menu-after-login.jpg');

if (!fs.existsSync(imagePath)) {
  console.error(`Error: Image not found at ${imagePath}`);
  process.exit(1);
}

async function uploadImage() {
  console.log(`Uploading ${imagePath} to Rich Menu: ${richMenuId}...`);
  const imageBuffer = fs.readFileSync(imagePath);

  const res = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'image/jpeg'
    },
    body: imageBuffer
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error(`Failed to upload rich menu image: ${res.status} ${errorBody}`);
    process.exit(1);
  }

  console.log('Successfully uploaded new After Login menu image to LINE!');
}

uploadImage().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
