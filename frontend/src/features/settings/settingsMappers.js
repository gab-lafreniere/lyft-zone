export function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

export function createTrainingProfileDraft(settingsData) {
  return deepClone(settingsData?.trainingProfile?.profile || {});
}

export function toTrainingProfilePayload(trainingProfileDraft) {
  return deepClone(trainingProfileDraft);
}

export function areTrainingProfilesEqual(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

export function mapApiErrorDetails(details) {
  const fieldErrors = {};
  const formErrors = [];

  if (!Array.isArray(details)) {
    return { fieldErrors, formErrors };
  }

  details.forEach((detail) => {
    const path = String(detail?.path || "").trim();
    const message = String(detail?.message || "Invalid value").trim();

    if (!message) {
      return;
    }

    if (path) {
      if (!fieldErrors[path]) {
        fieldErrors[path] = message;
      }
      return;
    }

    formErrors.push(message);
  });

  return { fieldErrors, formErrors };
}

export function findFieldError(fieldErrors, paths = []) {
  for (const path of paths) {
    if (!path) {
      continue;
    }

    if (fieldErrors[path]) {
      return fieldErrors[path];
    }
  }

  for (const path of paths) {
    if (!path) {
      continue;
    }

    const matchingPath = Object.keys(fieldErrors).find(
      (candidate) =>
        candidate === path ||
        candidate.startsWith(`${path}.`) ||
        candidate.startsWith(`${path}[`)
    );

    if (matchingPath) {
      return fieldErrors[matchingPath];
    }
  }

  return "";
}

export function formatReadonlyValue(value, fallback = "Not available yet") {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "string") {
    return value.trim() || fallback;
  }

  if (typeof value === "boolean") {
    return value ? "On" : "Off";
  }

  return String(value);
}

export function toTextList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "";
  }

  return value.join("\n");
}

export function fromTextList(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}
