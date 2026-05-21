import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/lib/env.js';
import { parseQrData } from '../src/services/qr.service.js';

const participantId = '72dc3552-7fef-434c-947c-9d95a807053a';
const studentId = '1b0b7a5c-5f10-4f7d-a79b-f09f30ae4567';

function signedQr(type: 'p' | 's', id: string): string {
  const payload = `R:${type}:${id}`;
  const hmac = createHmac('sha256', env.JWT_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 8);
  return `${payload}:${hmac}`;
}

describe('parseQrData', () => {
  it('parses a signed participant QR payload', () => {
    assert.deepEqual(parseQrData(signedQr('p', participantId)), {
      type: 'participant',
      id: participantId
    });
  });

  it('parses a signed student QR payload', () => {
    assert.deepEqual(parseQrData(signedQr('s', studentId)), {
      type: 'student',
      id: studentId
    });
  });

  it('rejects invalid format, type, id, and signature', () => {
    assert.throws(() => parseQrData('bad'), /Invalid QR format/);
    assert.throws(() => parseQrData(`R:x:${participantId}:abcd1234`), /Invalid QR type/);
    assert.throws(() => parseQrData('R:p:not-a-uuid:abcd1234'), /Invalid QR ID/);
    assert.throws(() => parseQrData(`R:p:${participantId}:deadbeef`), /Invalid QR signature/);
  });
});
