import { collectHistory } from "./history.js";
import { applyPrivacy } from "./privacy.js";
import { gzip, encodeJson } from "./compress.js";
import { encrypt } from "./crypto.js";
import { renderTemplate, extensionFor } from "./naming.js";
import { getSettings, setSettings, getSessionPassphrase } from "./settings.js";

const api = () => globalThis.chrome ?? globalThis.browser;

export const FORMAT_VERSION = 1;

/**
 * One backup run: collect -> filter -> wrap -> compress -> encrypt -> download.
 *
 * Returns a result record rather than throwing for expected refusals (such as
 * encryption being on with no passphrase this session), so the UI can explain
 * what happened. Unexpected failures still throw.
 */
export async function runBackup({ reason = "manual", force = false } = {}) {
  const s = getSettings();
  const startedAt = Date.now();

  // Encryption on with no passphrase must never silently downgrade to plaintext.
  let passphrase = null;
  if (s.encrypt) {
    passphrase = await getSessionPassphrase();
    if (!passphrase) {
      return finish({
        ok: false,
        skipped: "no-passphrase",
        message:
          "Encryption is on but no passphrase has been entered this session. " +
          "Nothing was written, because writing it unencrypted would defeat the setting."
      });
    }
  }

  // Incremental unless a periodic full snapshot is due. A long chain of deltas
  // with one damaged link is not a backup, so a full copy lands regularly.
  const fullDue =
    !s.incremental ||
    force ||
    !s.lastFullBackupAt ||
    (s.fullBackupEveryDays > 0 &&
      Date.now() - s.lastFullBackupAt > s.fullBackupEveryDays * 86400000);

  // +1ms: history.search treats startTime as inclusive, so reusing the cursor
  // verbatim re-exports the boundary item on every run. That both duplicates it
  // and makes "nothing new" unreachable, so a file would be written on every
  // scheduled run forever even with no browsing at all.
  const startTime = fullDue ? 0 : s.lastCursor ? s.lastCursor + 1 : 0;

  const { items: raw, stats: histStats } = await collectHistory({
    startTime,
    endTime: Date.now(),
    maxItems: s.maxItemsPerRun
  });

  if (raw.length === 0) {
    return finish({
      ok: true,
      skipped: "nothing-new",
      message: "No new history since the last run.",
      histStats
    });
  }

  const { items, stats: privStats } = applyPrivacy(raw, s);

  if (items.length === 0) {
    return finish({
      ok: true,
      skipped: "all-filtered",
      message: `All ${raw.length} entries were removed by the privacy filters.`,
      histStats,
      privStats
    });
  }

  const envelope = {
    format: "histbak",
    version: FORMAT_VERSION,
    kind: fullDue ? "full" : "incremental",
    createdAt: startedAt,
    range: { from: startTime, to: Date.now() },
    counts: { collected: raw.length, kept: items.length },
    filters: {
      stripTracking: s.stripTracking,
      stripQuery: s.stripQuery,
      stripFragment: s.stripFragment,
      dropTitles: s.dropTitles,
      excluded: privStats.excluded
    },
    items
  };

  let bytes = encodeJson(envelope);
  const rawBytes = bytes.length;
  if (s.compress) bytes = await gzip(bytes);
  const compressedBytes = bytes.length;
  if (s.encrypt) bytes = await encrypt(bytes, passphrase, { iterations: s.kdfIterations });

  const filename = renderTemplate(s.filenameTemplate, {
    date: new Date(startedAt),
    count: items.length,
    ext: extensionFor({ compress: s.compress, encrypt: s.encrypt })
  });

  const downloadId = await download(bytes, filename);

  await setSettings({
    lastRunAt: startedAt,
    lastCursor: Math.max(s.lastCursor || 0, histStats.newest || 0),
    ...(fullDue ? { lastFullBackupAt: startedAt } : {})
  });

  return finish({
    ok: true,
    kind: envelope.kind,
    filename,
    downloadId,
    items: items.length,
    rawBytes,
    compressedBytes,
    finalBytes: bytes.length,
    ratio: rawBytes ? +(rawBytes / bytes.length).toFixed(1) : 1,
    truncated: histStats.truncated,
    histStats,
    privStats
  });

  async function finish(result) {
    const record = { ...result, reason, at: startedAt, tookMs: Date.now() - startedAt };
    await setSettings({ lastResult: record, lastRunAt: startedAt });
    return record;
  }
}

async function download(bytes, filename) {
  const url = await toDownloadUrl(bytes);
  try {
    return await new Promise((resolve, reject) => {
      const r = api().downloads.download(
        { url, filename, conflictAction: "uniquify", saveAs: false },
        id => {
          const err = api().runtime?.lastError;
          err ? reject(new Error(err.message)) : resolve(id);
        }
      );
      if (r?.then) r.then(resolve, reject);
    });
  } finally {
    // A blob URL held open pins the whole backup in memory.
    if (url.startsWith("blob:")) URL.revokeObjectURL?.(url);
  }
}

// Chrome's MV3 service worker has no URL.createObjectURL. A data: URL avoids
// needing an offscreen document at the cost of base64 overhead, which is paid
// on already-compressed bytes and never reaches disk.
async function toDownloadUrl(bytes) {
  if (typeof URL !== "undefined" && URL.createObjectURL) {
    return URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  }
  const b64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes]));
  });
  return `data:application/octet-stream;base64,${b64}`;
}

/** Delete old backups beyond keepLastN, matching only files this extension wrote. */
export async function pruneOldBackups() {
  const s = getSettings();
  if (!s.keepLastN || s.keepLastN <= 0) return { pruned: 0 };

  const found = await new Promise(resolve => {
    const r = api().downloads.search(
      { query: ["histbak"], orderBy: ["-startTime"], limit: 0, state: "complete", exists: true },
      resolve
    );
    if (r?.then) r.then(resolve);
  });

  const ours = (found || []).filter(d => /\.json(\.gz)?(\.enc)?$/.test(d.filename || ""));
  const stale = ours.slice(s.keepLastN);
  for (const d of stale) {
    await new Promise(res => {
      const r = api().downloads.removeFile(d.id, () => {
        void api().runtime?.lastError; // already gone from disk is fine
        res();
      });
      if (r?.then) r.then(res, res);
    });
  }
  return { pruned: stale.length };
}
