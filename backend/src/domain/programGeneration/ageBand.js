const {
  MAX_AGE,
  MIN_AGE,
} = require('../userProfile/userProfileDemographics');

function formatAgeBand(age) {
  if (!Number.isSafeInteger(age) || age < MIN_AGE || age > MAX_AGE) {
    return null;
  }

  if (age < 20) {
    return 'under 20';
  }

  const decade = Math.floor(age / 10) * 10;
  const range = age % 10 <= 4 ? 'early' : 'late';
  return `in their ${range} ${decade}s`;
}

module.exports = {
  formatAgeBand,
};
