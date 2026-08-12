// Aggregations for the viewer.
//
// An accuracy note that shapes every label in the UI: chrome.history.search
// returns one record per URL carrying `lastVisitTime` and a lifetime
// `visitCount`. It does not return the timestamp of every visit. So a
// time-bucketed chart built from this data counts PAGES BY THEIR LAST VISIT,
// not visits. Calling that "visits per hour" would be quietly wrong — a page
// opened 200 times contributes exactly one point, at its most recent open.
//
// Per-visit timestamps exist behind history.getVisits(url), one call per URL.
// That is accurate and slow; it is offered as an opt-in below rather than made
// the default. Labels in the viewer say "pages" wherever this approximation is
// in play, and "recorded visits" only for the lifetime counter, which is exact.

import { hostOf } from "./privacy.js";

export function summarise(items) {
  const byDay = new Map();
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const domains = new Map();

  let lifetimeVisits = 0;
  let newest = 0;
  let oldest = Infinity;

  for (const item of items) {
    const ts = item.lastVisitTime;
    lifetimeVisits += item.visitCount || 0;

    if (ts) {
      const d = new Date(ts);
      grid[d.getDay()][d.getHours()]++;
      const key = dayKey(d);
      byDay.set(key, (byDay.get(key) || 0) + 1);
      if (ts > newest) newest = ts;
      if (ts < oldest) oldest = ts;
    }

    const host = hostOf(item.url);
    if (host) {
      const rec = domains.get(host) || { pages: 0, visits: 0 };
      rec.pages++;
      rec.visits += item.visitCount || 0;
      domains.set(host, rec);
    }
  }

  const topDomains = [...domains.entries()]
    .map(([host, rec]) => ({ label: host, value: rec.pages, visits: rec.visits }))
    .sort((a, b) => b.value - a.value);

  const days = fillDayGaps(byDay);

  return {
    pages: items.length,
    lifetimeVisits,
    domains: domains.size,
    newest,
    oldest: Number.isFinite(oldest) ? oldest : 0,
    grid,
    days,
    topDomains,
    busiestHour: peakOf(grid, "hour"),
    busiestDay: peakOf(grid, "day"),
    perDay: days.length ? Math.round(items.length / days.length) : 0
  };
}

const dayKey = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// A day with no history is a real zero, not a missing point. Without this the
// line chart would join across gaps and imply activity that did not happen.
function fillDayGaps(byDay) {
  const keys = [...byDay.keys()].sort();
  if (!keys.length) return [];

  const out = [];
  const cursor = new Date(`${keys[0]}T00:00:00`);
  const end = new Date(`${keys[keys.length - 1]}T00:00:00`);
  let guard = 0;

  while (cursor <= end && guard++ < 4000) {
    const key = dayKey(cursor);
    out.push({ key, date: new Date(cursor), value: byDay.get(key) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function peakOf(grid, mode) {
  if (mode === "hour") {
    const totals = new Array(24).fill(0);
    for (const row of grid) row.forEach((v, h) => (totals[h] += v));
    const best = totals.indexOf(Math.max(...totals));
    return { index: best, value: totals[best] };
  }
  const totals = grid.map(row => row.reduce((a, b) => a + b, 0));
  const best = totals.indexOf(Math.max(...totals));
  return { index: best, value: totals[best] };
}

/**
 * Exact per-visit timestamps, at the cost of one API call per URL.
 * Only worth it on a narrow range; the viewer gates it behind a button and a
 * URL cap so it cannot be triggered accidentally on a decade of history.
 */
export async function preciseVisits(items, { startTime, endTime, maxUrls = 3000, onProgress } = {}) {
  const api = globalThis.chrome ?? globalThis.browser;
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const byDay = new Map();
  const subject = items.slice(0, maxUrls);
  let total = 0;

  for (let i = 0; i < subject.length; i++) {
    const visits = await new Promise(resolve => {
      const r = api.history.getVisits({ url: subject[i].url }, v => resolve(v || []));
      if (r?.then) r.then(resolve, () => resolve([]));
    });
    for (const v of visits) {
      const ts = v.visitTime;
      if (!ts || ts < startTime || ts > endTime) continue;
      const d = new Date(ts);
      grid[d.getDay()][d.getHours()]++;
      const key = dayKey(d);
      byDay.set(key, (byDay.get(key) || 0) + 1);
      total++;
    }
    if (onProgress && i % 100 === 0) onProgress({ done: i, of: subject.length });
  }

  return {
    grid,
    days: fillDayGaps(byDay),
    total,
    truncated: items.length > subject.length,
    examined: subject.length
  };
}
