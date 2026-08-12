import { loadSettings, getSettings, setSettings, scheduleChanged, setSessionPassphrase, getSessionPassphrase, clearSessionPassphrase } from "../lib/settings.js";
import { runBackup, pruneOldBackups } from "../lib/backup.js";
import { collectHistory } from "../lib/history.js";
import { applyPrivacy } from "../lib/privacy.js";
import { ALARM, CATCHUP_ALARM, armSchedule, missedRun, nextRunAt } from "../lib/schedule.js";

const api = globalThis.chrome ?? globalThis.browser;

// The MV3 worker is torn down constantly, so every entry point re-initialises.
let ready = null;
const init = () => (ready ??= loadSettings());

async function reschedule() {
  const when = await armSchedule(api.alarms, getSettings());
  return when;
}

api.runtime.onInstalled.addListener(async () => {
  await init();
  await reschedule();
});

api.runtime.onStartup.addListener(async () => {
  await init();
  await reschedule();
  // Give the browser a moment to settle before touching the history store.
  if (missedRun(getSettings())) api.alarms.create(CATCHUP_ALARM, { delayInMinutes: 2 });
});

api.alarms.onAlarm.addListener(async alarm => {
  await init();
  if (alarm.name !== ALARM && alarm.name !== CATCHUP_ALARM) return;
  try {
    await runBackup({ reason: alarm.name === CATCHUP_ALARM ? "catchup" : "scheduled" });
    await pruneOldBackups();
  } catch (e) {
    await setSettings({
      lastResult: { ok: false, error: String(e?.message || e), at: Date.now(), reason: alarm.name }
    });
  } finally {
    if (alarm.name === ALARM) await reschedule();
  }
});

api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes.settings) return;
  const { oldValue, newValue } = changes.settings;
  await init();
  if (scheduleChanged(oldValue, newValue)) await reschedule();
});

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg).then(sendResponse, e => sendResponse({ error: String(e?.message || e) }));
  return true; // async
});

async function handle(msg) {
  await init();
  switch (msg?.type) {
    case "getState": {
      const s = getSettings();
      return {
        settings: s,
        nextRunAt: s.enabled ? nextRunAt(s) : null,
        hasPassphrase: Boolean(await getSessionPassphrase())
      };
    }
    case "setSettings":
      return { settings: await setSettings(msg.patch) };

    case "setPassphrase":
      await setSessionPassphrase(msg.passphrase);
      return { ok: true };

    case "clearPassphrase":
      await clearSessionPassphrase();
      return { ok: true };

    case "runNow":
      return runBackup({ reason: "manual", force: Boolean(msg.full) });

    case "prune":
      return pruneOldBackups();

    // Powers the viewer. Filtering happens here so the viewer never holds a
    // copy of entries the user has excluded from backups.
    case "queryHistory": {
      const { items } = await collectHistory({
        startTime: msg.startTime ?? 0,
        endTime: msg.endTime ?? Date.now(),
        maxItems: msg.maxItems ?? 50000
      });
      const filtered = applyPrivacy(items, getSettings());
      return { items: filtered.items, stats: filtered.stats };
    }

    default:
      throw new Error(`unknown message: ${msg?.type}`);
  }
}
