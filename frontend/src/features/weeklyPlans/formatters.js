export function formatRelativeCreatedLabel(createdAt) {
  const createdDate = new Date(createdAt);
  const now = new Date();

  if (Number.isNaN(createdDate.getTime())) {
    return "Created recently";
  }

  const diffMs = Math.max(0, now.getTime() - createdDate.getTime());
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(1, Math.floor(diffMs / dayMs));

  if (days <= 7) {
    return `Created ${days} day${days === 1 ? "" : "s"} ago`;
  }

  if (days <= 30) {
    const weeks = Math.max(1, Math.floor(days / 7));
    return `Created ${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }

  if (days <= 365) {
    const months = Math.max(1, Math.floor(days / 30));
    return `Created ${months} month${months === 1 ? "" : "s"} ago`;
  }

  const years = Math.max(1, Math.floor(days / 365));
  return `Created ${years} year${years === 1 ? "" : "s"} ago`;
}

