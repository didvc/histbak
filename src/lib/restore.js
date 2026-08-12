// Reading a backup file back in.
//
// The write pipeline is json -> gzip -> encrypt; this unwinds it by sniffing
// each layer rather than trusting the filename, because files get renamed and a
// wrong extension should not decide whether decryption is attempted.

import { decrypt, isEncrypted } from "./crypto.js";
import { gunzip, isGzip, decodeJson } from "./compress.js";

export const NEEDS_PASSPHRASE = "needs-passphrase";

/**
 * @param {Uint8Array} bytes raw file contents
 * @param {string|null} passphrase supplied only when the file is encrypted
 * @returns {Promise<{envelope: object, encrypted: boolean, compressed: boolean}>}
 * Throws an Error with code NEEDS_PASSPHRASE when the file is encrypted and no
 * passphrase was given, so the caller can prompt rather than guess.
 */
export async function readBackup(bytes, passphrase = null) {
  let data = bytes;
  const encrypted = isEncrypted(data);

  if (encrypted) {
    if (!passphrase) {
      const err = new Error("This backup is encrypted. Enter its passphrase to open it.");
      err.code = NEEDS_PASSPHRASE;
      throw err;
    }
    data = await decrypt(data, passphrase);
  }

  const compressed = isGzip(data);
  if (compressed) data = await gunzip(data);

  let envelope;
  try {
    envelope = decodeJson(data);
  } catch {
    throw new Error("The file did not contain valid JSON once unwrapped.");
  }

  return { envelope: normalise(envelope), encrypted, compressed };
}

/**
 * Accept both our own envelope and a bare array of history items, so a file
 * that has been unwrapped by hand still opens.
 */
function normalise(parsed) {
  if (Array.isArray(parsed)) {
    return { format: "histbak", version: 0, kind: "unknown", items: parsed, counts: { kept: parsed.length } };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
    throw new Error("Not a histbak backup: no items array found.");
  }
  if (parsed.format && parsed.format !== "histbak") {
    throw new Error(`Unrecognised format: ${String(parsed.format).slice(0, 40)}`);
  }
  return parsed;
}

export const readFileBytes = file =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read the file"));
    reader.readAsArrayBuffer(file);
  });

/** Merge several backups into one item list, newest record of each URL winning. */
export function mergeBackups(envelopes) {
  const byUrl = new Map();
  for (const env of envelopes) {
    for (const item of env.items || []) {
      const prev = byUrl.get(item.url);
      if (!prev || (item.lastVisitTime ?? 0) > (prev.lastVisitTime ?? 0)) byUrl.set(item.url, item);
    }
  }
  return [...byUrl.values()].sort((a, b) => (b.lastVisitTime ?? 0) - (a.lastVisitTime ?? 0));
}
