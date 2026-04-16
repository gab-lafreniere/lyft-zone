function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getDuplicateWorkoutName(sourceName, existingNames = []) {
  const trimmedName = String(sourceName || "").trim();
  const baseName = trimmedName.replace(/-\d+$/, "") || "Workout";
  const suffixPattern = new RegExp(`^${escapeRegExp(baseName)}-(\\d+)$`);
  const highestSuffix = existingNames.reduce((highest, name) => {
    const match = String(name || "").trim().match(suffixPattern);

    if (!match) {
      return highest;
    }

    return Math.max(highest, Number(match[1]) || 0);
  }, 0);

  return `${baseName}-${highestSuffix + 1}`;
}
