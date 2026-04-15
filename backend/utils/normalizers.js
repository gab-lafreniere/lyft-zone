function normalizeNullableNumber(value) {
    if (value == null || value === "") return null;
  
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  
  function normalizeNullableInteger(value) {
    if (value == null || value === "") return null;
  
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
  
    return Math.trunc(parsed);
  }
  
  function normalizeNullableString(value) {
    if (value == null) return null;
    const str = String(value).trim();
    return str === "" ? null : str;
  }
  
  module.exports = {
    normalizeNullableNumber,
    normalizeNullableInteger,
    normalizeNullableString,
  };