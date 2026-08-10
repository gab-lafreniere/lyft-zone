const test = require('node:test');
const assert = require('node:assert/strict');

const {
  upsertUserProfile,
} = require('../../services/usersService');

function createPrisma(existingProfile = null) {
  let profile = existingProfile;
  const tx = {
    userProfile: {
      findUnique: async () => profile,
      update: async ({ data }) => {
        profile = { ...profile, ...data };
        return profile;
      },
      upsert: async ({ update, create }) => {
        profile = profile ? { ...profile, ...update } : { id: 'profile_123', ...create };
        return profile;
      },
    },
  };

  return {
    user: { findUnique: async () => ({ id: 'user_123' }) },
    userProfile: tx.userProfile,
    $transaction: async (operation) => operation(tx),
    getProfile: () => profile,
  };
}

test('displayName is independently editable and normalized', async () => {
  const prisma = createPrisma(null);
  const result = await upsertUserProfile(
    'user_123',
    { displayName: '  Jordan   Lee ' },
    { prisma }
  );

  assert.equal(result.displayName, 'Jordan Lee');
  assert.equal(prisma.getProfile().age, undefined);
  assert.equal(prisma.getProfile().sex, undefined);
});

test('displayName can change while locked demographics remain unchanged', async () => {
  const prisma = createPrisma({
    id: 'profile_123',
    userId: 'user_123',
    displayName: 'Jordan',
    age: 30,
    ageInputDate: new Date('2026-08-07T00:00:00.000Z'),
    sex: 'FEMALE',
  });

  const result = await upsertUserProfile(
    'user_123',
    { displayName: 'J. Lee', age: 30, sex: 'FEMALE' },
    { prisma, now: new Date('2026-08-07T12:00:00.000Z') }
  );

  assert.equal(result.displayName, 'J. Lee');
  assert.equal(result.age, 30);
  assert.equal(result.sex, 'FEMALE');
});

test('displayName updates do not unlock demographic changes', async () => {
  const prisma = createPrisma({
    id: 'profile_123',
    userId: 'user_123',
    displayName: 'Jordan',
    age: 30,
    ageInputDate: new Date('2026-08-07T00:00:00.000Z'),
    sex: 'FEMALE',
  });

  await assert.rejects(
    upsertUserProfile(
      'user_123',
      { displayName: 'J. Lee', age: 31, sex: 'FEMALE' },
      { prisma, now: new Date('2026-08-07T12:00:00.000Z') }
    ),
    (error) => error.code === 'PROFILE_DEMOGRAPHICS_LOCKED'
  );
});

