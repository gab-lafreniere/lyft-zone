export function buildOrigin(location) {
  return `${location.pathname}${location.search || ""}`;
}

export function resolveBackTarget(location, fallback) {
  const from = location.state?.from;
  return typeof from === "string" && from.trim() ? from : fallback;
}

