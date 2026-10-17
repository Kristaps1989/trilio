// Public holidays for LV, LT and EE, computed per year so no table goes
// stale. Rule 6: delivery dates count working days only and respect these.
// Dates are handled as UTC calendar days (y, m, d); no time zones involved.

export type Country = "LV" | "LT" | "EE";

export type CalendarDay = { y: number; m: number; d: number };

export function key(day: CalendarDay): string {
  return `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
}

export function toDay(date: Date): CalendarDay {
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

export function toDate(day: CalendarDay): Date {
  return new Date(Date.UTC(day.y, day.m - 1, day.d));
}

export function addDays(day: CalendarDay, n: number): CalendarDay {
  return toDay(new Date(Date.UTC(day.y, day.m - 1, day.d + n)));
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: CalendarDay): number {
  return toDate(day).getUTCDay();
}

/** Western Easter Sunday (Anonymous Gregorian algorithm). */
export function easterSunday(y: number): CalendarDay {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { y, m: month, d: day };
}

function nthSunday(y: number, m: number, n: number): CalendarDay {
  let day: CalendarDay = { y, m, d: 1 };
  while (weekday(day) !== 0) day = addDays(day, 1);
  return addDays(day, 7 * (n - 1));
}

/** The next Monday when a date falls on a weekend (Latvian rule for 4 May and 18 November). */
function observedOnMonday(day: CalendarDay): CalendarDay {
  const wd = weekday(day);
  if (wd === 6) return addDays(day, 2);
  if (wd === 0) return addDays(day, 1);
  return day;
}

export function holidays(country: Country, y: number): CalendarDay[] {
  const easter = easterSunday(y);
  const goodFriday = addDays(easter, -2);
  const easterMonday = addDays(easter, 1);
  const fixed = (m: number, d: number): CalendarDay => ({ y, m, d });

  switch (country) {
    case "LV": {
      const list = [
        fixed(1, 1),
        goodFriday,
        easter,
        easterMonday,
        fixed(5, 1),
        nthSunday(y, 5, 2), // Mother's day
        fixed(6, 23),
        fixed(6, 24),
        fixed(12, 24),
        fixed(12, 25),
        fixed(12, 26),
        fixed(12, 31),
      ];
      for (const d of [fixed(5, 4), fixed(11, 18)]) {
        list.push(d);
        const observed = observedOnMonday(d);
        if (key(observed) !== key(d)) list.push(observed);
      }
      return list;
    }
    case "LT":
      return [
        fixed(1, 1),
        fixed(2, 16),
        fixed(3, 11),
        easter,
        easterMonday,
        fixed(5, 1),
        nthSunday(y, 5, 1), // Mother's day
        nthSunday(y, 6, 1), // Father's day
        fixed(6, 24),
        fixed(7, 6),
        fixed(8, 15),
        fixed(11, 1),
        fixed(11, 2),
        fixed(12, 24),
        fixed(12, 25),
        fixed(12, 26),
      ];
    case "EE":
      return [
        fixed(1, 1),
        fixed(2, 24),
        goodFriday,
        easter,
        fixed(5, 1),
        addDays(easter, 49), // Pentecost
        fixed(6, 23),
        fixed(6, 24),
        fixed(8, 20),
        fixed(12, 24),
        fixed(12, 25),
        fixed(12, 26),
      ];
  }
}

const cache = new Map<string, Set<string>>();

export function isHoliday(country: Country, day: CalendarDay): boolean {
  const k = `${country}:${day.y}`;
  let set = cache.get(k);
  if (!set) {
    set = new Set(holidays(country, day.y).map(key));
    cache.set(k, set);
  }
  return set.has(key(day));
}

export function isWorkingDay(country: Country, day: CalendarDay): boolean {
  const wd = weekday(day);
  return wd !== 0 && wd !== 6 && !isHoliday(country, day);
}
