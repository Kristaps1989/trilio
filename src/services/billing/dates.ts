// Billing dates use calendar arithmetic, never a fixed number of seconds:
// 31 Jan + 1 month = 28/29 Feb, 29 Feb + 1 year = 28 Feb.

export type Interval = "month" | "year";

export function addInterval(from: Date, interval: Interval, count = 1): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const d = from.getUTCDate();
  const targetY = interval === "year" ? y + count : y;
  const targetM = interval === "month" ? m + count : m;
  // Clamp the day to the target month's length.
  const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetY,
      targetM,
      Math.min(d, lastDay),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
    ),
  );
}

/** Retry schedule after a failed renewal: 1, 3 and 5 days later; then the subscription expires. */
export const RETRY_DAYS = [1, 3, 5] as const;
export const MAX_FAILED_ATTEMPTS = RETRY_DAYS.length;

export function nextRetryAt(failedAttempts: number, from: Date): Date | null {
  const days = RETRY_DAYS[failedAttempts - 1];
  if (days === undefined) return null;
  return new Date(from.getTime() + days * 86_400_000);
}
