import { unlinkRichMenuFromUser } from '../src/services/richmenu.service.js';

const userId = process.argv[2];
if (!userId) {
  console.error('Please provide a LINE User ID. Example: npx tsx tools/unlink-menu.ts U1234567890abcdef1234567890abcdef');
  process.exit(1);
}

unlinkRichMenuFromUser(userId).then(() => {
  console.log('Unlinked successfully! ' + userId + ' should now see the default menu.');
}).catch(console.error);