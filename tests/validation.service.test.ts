import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registrationSchema, updateRegistrationSchema } from '../src/services/validation.service.js';

const baseRegistration = {
  lineUserId: 'U123',
  displayName: 'Test User',
  nationalityType: 'THAI',
  firstName: 'Somchai',
  lastName: 'Jaidee',
  nickname: 'Chai',
  dateOfBirth: '2000-01-01',
  email: 'somchai@example.com',
  phoneNumber: '0812345678',
  participantType: 'GENERAL_PUBLIC',
  organization: 'KMUTT',
  pdpaConsent: true,
  mediaConsent: true
} as const;

describe('registrationSchema', () => {
  it('accepts a valid registration and defaults selectedSessionIds', () => {
    const parsed = registrationSchema.parse(baseRegistration);

    assert.deepEqual(parsed.selectedSessionIds, []);
  });

  it('requires country for non-Thai participants', () => {
    const result = registrationSchema.safeParse({
      ...baseRegistration,
      nationalityType: 'NON_THAI'
    });

    assert.equal(result.success, false);
    assert.ok(!result.success && result.error.issues.some(issue => issue.path.join('.') === 'country'));
  });

  it('requires faculty and department for students', () => {
    const result = registrationSchema.safeParse({
      ...baseRegistration,
      participantType: 'STUDENT'
    });

    assert.equal(result.success, false);
    assert.ok(!result.success && result.error.issues.some(issue => issue.path.join('.') === 'faculty'));
    assert.ok(!result.success && result.error.issues.some(issue => issue.path.join('.') === 'department'));
  });

  it('requires explicit PDPA and media consent', () => {
    const result = registrationSchema.safeParse({
      ...baseRegistration,
      pdpaConsent: false,
      mediaConsent: false
    });

    assert.equal(result.success, false);
    assert.ok(!result.success && result.error.issues.some(issue => issue.path.join('.') === 'pdpaConsent'));
    assert.ok(!result.success && result.error.issues.some(issue => issue.path.join('.') === 'mediaConsent'));
  });
});

describe('updateRegistrationSchema', () => {
  it('accepts partial profile updates without sessions', () => {
    assert.deepEqual(updateRegistrationSchema.parse({ nickname: 'Mai' }), { nickname: 'Mai' });
  });

  it('accepts an empty session array when selectedSessionIds is provided to clear sessions', () => {
    const result = updateRegistrationSchema.safeParse({ selectedSessionIds: [] });

    assert.equal(result.success, true);
  });
});
