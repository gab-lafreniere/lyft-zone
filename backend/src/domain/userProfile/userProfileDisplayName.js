const MAX_DISPLAY_NAME_LENGTH = 80;

function validateDisplayName(value, { required = true } = {}) {
  if (value == null) {
    return required
      ? {
        ok: false,
        issue: {
          path: 'displayName',
          message: 'Display name is required.',
        },
      }
      : { ok: true, value: null };
  }

  if (typeof value !== 'string') {
    return {
      ok: false,
      issue: {
        path: 'displayName',
        message: 'Display name must be text.',
      },
    };
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return {
      ok: false,
      issue: {
        path: 'displayName',
        message: 'Display name is required.',
      },
    };
  }

  if (normalized.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      ok: false,
      issue: {
        path: 'displayName',
        message: `Display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`,
      },
    };
  }

  return { ok: true, value: normalized };
}

module.exports = {
  MAX_DISPLAY_NAME_LENGTH,
  validateDisplayName,
};

