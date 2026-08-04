const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEMOGRAPHICS_STATUS,
  calculateCurrentAge,
  dateOnlyToUtcDate,
  deriveDemographicsStatus,
  serializeDateOnly,
  validateInitialDemographicsPayload,
} = require('../../src/domain/userProfile/userProfileDemographics');

test('initial demographics validation accepts only a complete canonical payload', () => {
  assert.deepEqual(validateInitialDemographicsPayload({ age: 29, sex: 'MALE' }), {
    ok: true,
    value: { age: 29, sex: 'MALE' },
  });
  assert.equal(validateInitialDemographicsPayload({ age: 29 }).ok, false);
  assert.equal(validateInitialDemographicsPayload({ sex: 'FEMALE' }).ok, false);
  assert.equal(validateInitialDemographicsPayload({ age: '29', sex: 'MALE' }).ok, false);
  assert.equal(validateInitialDemographicsPayload({ age: 17, sex: 'MALE' }).ok, false);
  assert.equal(validateInitialDemographicsPayload({ age: 101, sex: 'MALE' }).ok, false);
  assert.equal(validateInitialDemographicsPayload({ age: 29, sex: 'OTHER' }).ok, false);
  assert.equal(
    validateInitialDemographicsPayload({
      age: 29,
      sex: 'MALE',
      ageInputDate: '2026-08-04',
    }).ok,
    false
  );
});

test('demographics status distinguishes empty, complete, and inconsistent records', () => {
  assert.equal(deriveDemographicsStatus({}), DEMOGRAPHICS_STATUS.NOT_COLLECTED);
  assert.equal(
    deriveDemographicsStatus({ age: 29, ageInputDate: '2026-08-04', sex: 'FEMALE' }),
    DEMOGRAPHICS_STATUS.LOCKED
  );
  assert.equal(
    deriveDemographicsStatus({ age: 29, ageInputDate: null, sex: 'FEMALE' }),
    DEMOGRAPHICS_STATUS.INCONSISTENT
  );
  assert.equal(
    deriveDemographicsStatus({ age: 29, ageInputDate: 'not-a-date', sex: 'FEMALE' }),
    DEMOGRAPHICS_STATUS.INCONSISTENT
  );
  assert.equal(
    deriveDemographicsStatus(
      { age: 29, ageInputDate: '2027-08-04', sex: 'FEMALE' },
      '2026-08-04'
    ),
    DEMOGRAPHICS_STATUS.INCONSISTENT
  );
});

test('date-only helpers use stable UTC calendar values', () => {
  const date = dateOnlyToUtcDate(new Date('2026-08-04T23:59:59.000Z'));
  assert.equal(date.toISOString(), '2026-08-04T00:00:00.000Z');
  assert.equal(serializeDateOnly(date), '2026-08-04');
  assert.equal(serializeDateOnly('2026-02-30'), null);
});

test('current age changes only on completed yearly anniversaries', () => {
  const base = { storedAge: 29, ageInputDate: '2026-08-04' };
  assert.equal(calculateCurrentAge({ ...base, referenceDate: '2027-08-03' }), 29);
  assert.equal(calculateCurrentAge({ ...base, referenceDate: '2027-08-04' }), 30);
  assert.equal(calculateCurrentAge({ ...base, referenceDate: '2028-08-04' }), 31);
});

test('February 29 uses March 1 as its non-leap-year anniversary', () => {
  const base = { storedAge: 29, ageInputDate: '2028-02-29' };
  assert.equal(calculateCurrentAge({ ...base, referenceDate: '2029-02-28' }), 29);
  assert.equal(calculateCurrentAge({ ...base, referenceDate: '2029-03-01' }), 30);
  assert.equal(calculateCurrentAge({ ...base, referenceDate: '2032-02-29' }), 33);
});

test('current age rejects invalid or pre-collection inputs', () => {
  assert.equal(
    calculateCurrentAge({ storedAge: 29, ageInputDate: '2026-08-04', referenceDate: '2026-08-03' }),
    null
  );
  assert.equal(calculateCurrentAge({ storedAge: 17, ageInputDate: '2026-08-04' }), null);
});
