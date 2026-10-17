export interface ThreadSummaryItem {
  id: string;
  title: string;
  updatedAt: number;
}

/**
 * Filter a list of threads by search query against their title (case-insensitive).
 * An empty or whitespace-only query returns the full list.
 */
export function filterThreads<T extends { title: string }>(list: T[], query: string): T[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return list;
  return list.filter((t) => t.title.toLowerCase().includes(trimmed));
}

/**
 * Sort threads in descending order by updatedAt (most recent first).
 * Does not mutate the original list.
 */
export function sortThreads<T extends { updatedAt?: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/**
 * Formats a timestamp into a human-readable relative time string.
 * Boundaries:
 * - < 1 minute (or future/non-positive): "just now"
 * - < 1 hour: "<m>m ago"
 * - < 24 hours: "<h>h ago"
 * - >= 24 hours: "<d>d ago"
 */
export function formatRelativeTime(updatedAt: number, nowMs: number = Date.now()): string {
  if (!updatedAt || updatedAt <= 0) return "just now";
  const diffMs = nowMs - updatedAt;
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
