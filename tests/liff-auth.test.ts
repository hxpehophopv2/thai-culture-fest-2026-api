import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractBearerToken, tryDevAuth } from '../src/lib/liff-auth.js';

describe('extractBearerToken', () => {
  it('extracts token from a valid Bearer header', () => {
    assert.equal(extractBearerToken('Bearer abc123'), 'abc123');
  });

  it('returns null for missing or malformed headers', () => {
    assert.equal(extractBearerToken(), null);
    assert.equal(extractBearerToken(''), null);
    assert.equal(extractBearerToken('Basic abc123'), null);
    assert.equal(extractBearerToken('Bearer'), null);
  });
});

describe('tryDevAuth', () => {
  it('accepts X-Dev-User-Id in development mode', () => {
    const auth = tryDevAuth({ 'x-dev-user-id': 'Udev123' });

    assert.deepEqual(auth, {
      userId: 'Udev123',
      displayName: '[DEV] Udev123'
    });
  });

  it('ignores array dev headers', () => {
    assert.equal(tryDevAuth({ 'x-dev-user-id': ['Udev123'] }), null);
  });
});
