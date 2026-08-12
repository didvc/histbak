import { DEFAULT_EXCLUDES } from "./privacy.js";
import { DEFAULT_TEMPLATE } from "./naming.js";

export const DEFAULTS = {
  // schedule
  enabled: true,
  frequency: "daily", // hourly | daily | weekly
  timeOfDay: "03:00", // local wall-clock
  dayOfWeek: 0, // Sunday, for weekly
  runMissedOnStartup: true,

  // what goes in
  incremental: true, // only visits since the last successful run
  fullBackupEveryDays: 30, // periodic full snapshot so a chain of deltas is not the only copy
  maxItemsPerRun: 100000,

  // pipeline
  compress: true,
  encrypt: false, // opt-in: it needs a passphrase, and a forgotten one means a dead archive
  kdfIterations: 600000,

  // output
  filenameTemplate: DEFAULT_TEMPLATE,
  keepLastN: 30, // 0 disables pruning

  // privacy
  excludePatterns: DEFAULT_EXCLUDES,
  stripTracking: true,
  stripQuery: false,
  stripFragment: false,
  dropTitles: false,

  // bookkeeping, not user-facing
  lastRunAt: 0,
  lastFullBackupAt: 0,
  lastCursor: 0, // newest lastVisitTime included in the previous run
  lastResult: null
};

const KEY = "settings";
let cache = null;

const api = () => globalThis.chrome ?? globalThis.browser;

export async function loadSettings() {
  const stored = await api().storage.local.get(KEY);
  cache = { ...DEFAULTS, ...(stored?.[KEY] || {}) };
  return cache;
}

export function getSettings() {
  if (!cache) throw new Error("settings not loaded");
  return cache;
}

export function get(key) {
  return getSettings()[key];
}

export async function setSettings(patch) {
  cache = { ...(cache || DEFAULTS), ...patch };
  await api().storage.local.set({ [KEY]: cache });
  return cache;
}

/** True when a change should cause the schedule alarm to be rebuilt. */
export function scheduleChanged(oldValue = {}, newValue = {}) {
  return ["enabled", "frequency", "timeOfDay", "dayOfWeek"].some(k => oldValue[k] !== newValue[k]);
}

// The passphrase lives in session storage, never on disk. It is lost when the
// browser closes, which is the point: a passphrase sitting in storage.local
// alongside the ciphertext would make the encryption decorative. Scheduled runs
// therefore need the passphrase to have been entered this session; when it has
// not been, the run is skipped and reported rather than written in the clear.
export async function setSessionPassphrase(pass) {
  const s = api().storage.session;
  if (!s) throw new Error("session storage unavailable");
  await s.set({ passphrase: pass });
}

export async function getSessionPassphrase() {
  const s = api().storage.session;
  if (!s) return null;
  return (await s.get("passphrase"))?.passphrase ?? null;
}

export async function clearSessionPassphrase() {
  await api().storage.session?.remove("passphrase");
}
