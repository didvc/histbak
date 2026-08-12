// Wall-clock scheduling on top of chrome.alarms.
//
// One-shot alarms re-armed after each run, rather than a repeating
// periodInMinutes. A fixed 24h period drifts off the wall clock at every DST
// transition, so "03:00 daily" slowly becomes 02:00 or 04:00. Recomputing the
// next occurrence from a local Date keeps it at 03:00 year-round.

export const ALARM = "histbak:scheduled";
export const CATCHUP_ALARM = "histbak:catchup";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const intervalOf = frequency =>
  frequency === "hourly" ? HOUR : frequency === "weekly" ? 7 * DAY : DAY;

export function parseTimeOfDay(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return { hours: 3, minutes: 0 };
  const hours = +m[1];
  const minutes = +m[2];
  if (hours > 23 || minutes > 59) return { hours: 3, minutes: 0 };
  return { hours, minutes };
}

/** Next occurrence, in local time, strictly after `from`. */
export function nextRunAt(settings, from = Date.now()) {
  const { frequency = "daily", timeOfDay = "03:00", dayOfWeek = 0 } = settings || {};
  const { hours, minutes } = parseTimeOfDay(timeOfDay);
  const next = new Date(from);

  if (frequency === "hourly") {
    next.setMinutes(minutes, 0, 0);
    if (next.getTime() <= from) next.setTime(next.getTime() + HOUR);
    return next.getTime();
  }

  next.setHours(hours, minutes, 0, 0);

  if (frequency === "weekly") {
    const target = Number(dayOfWeek) || 0;
    let delta = (target - next.getDay() + 7) % 7;
    if (delta === 0 && next.getTime() <= from) delta = 7;
    next.setDate(next.getDate() + delta);
    return next.getTime();
  }

  if (next.getTime() <= from) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export async function armSchedule(alarms, settings) {
  await alarms.clear(ALARM);
  if (!settings?.enabled) return null;
  const when = nextRunAt(settings);
  await alarms.create(ALARM, { when });
  return when;
}

/** True when the browser was closed across a scheduled slot. */
export function missedRun(settings, now = Date.now()) {
  if (!settings?.enabled || !settings?.runMissedOnStartup) return false;
  if (!settings.lastRunAt) return false; // first ever install: wait for the real slot
  return now - settings.lastRunAt >= intervalOf(settings.frequency);
}
