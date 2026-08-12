import test from "node:test";
import assert from "node:assert/strict";

import { encrypt } from "../src/lib/crypto.js";
import { gzip, encodeJson } from "../src/lib/compress.js";
import { readBackup, mergeBackups, NEEDS_PASSPHRASE } from "../src/lib/restore.js";

const FAST = { iterations: 1000 };
const envelope = {
  format: "histbak",
  version: 1,
  kind: "full",
  createdAt: 1786000000000,
  items: [
    { url: "https://a.example/1", title: "One", lastVisitTime: 1786000000000, visitCount: 2 },
    { url: "https://b.example/2", title: "Two", lastVisitTime: 1786000100000, visitCount: 5 }
  ]
};

test("reads a plain .json backup", async () => {
  const { envelope: out, encrypted, compressed } = await readBackup(encodeJson(envelope));
  assert.equal(encrypted, false);
  assert.equal(compressed, false);
  assert.deepEqual(out.items, envelope.items);
});

test("reads a gzipped backup", async () => {
  const { envelope: out, compressed } = await readBackup(await gzip(encodeJson(envelope)));
  assert.equal(compressed, true);
  assert.equal(out.items.length, 2);
});

test("reads an encrypted, gzipped backup — the real pipeline", async () => {
  const bytes = await encrypt(await gzip(encodeJson(envelope)), "pw", FAST);
  const { envelope: out, encrypted, compressed } = await readBackup(bytes, "pw");
  assert.equal(encrypted, true);
  assert.equal(compressed, true);
  assert.deepEqual(out.items, envelope.items);
});

test("signals that a passphrase is needed rather than failing opaquely", async () => {
  const bytes = await encrypt(await gzip(encodeJson(envelope)), "pw", FAST);
  await assert.rejects(() => readBackup(bytes), e => e.code === NEEDS_PASSPHRASE);
});

test("wrong passphrase surfaces a decryption error", async () => {
  const bytes = await encrypt(await gzip(encodeJson(envelope)), "pw", FAST);
  await assert.rejects(() => readBackup(bytes, "nope"), /decryption failed/);
});

test("sniffs layers rather than trusting the extension", async () => {
  // Encrypted bytes handed over with no hint that they are encrypted.
  const bytes = await encrypt(encodeJson(envelope), "pw", FAST); // no gzip layer
  const { envelope: out, encrypted, compressed } = await readBackup(bytes, "pw");
  assert.equal(encrypted, true);
  assert.equal(compressed, false);
  assert.equal(out.items.length, 2);
});

test("accepts a bare array of items", async () => {
  const { envelope: out } = await readBackup(encodeJson(envelope.items));
  assert.equal(out.items.length, 2);
  assert.equal(out.kind, "unknown");
});

test("rejects files that are not backups", async () => {
  await assert.rejects(() => readBackup(encodeJson({ hello: "world" })), /no items array/);
  await assert.rejects(() => readBackup(encodeJson({ format: "other", items: [] })), /Unrecognised format/);
  await assert.rejects(() => readBackup(new TextEncoder().encode("not json")), /valid JSON/);
});

test("merging keeps the newest record per URL", () => {
  const older = { items: [{ url: "https://a.example/1", lastVisitTime: 100, visitCount: 1 }] };
  const newer = { items: [{ url: "https://a.example/1", lastVisitTime: 900, visitCount: 9 }] };
  const extra = { items: [{ url: "https://c.example/3", lastVisitTime: 500 }] };

  const merged = mergeBackups([older, newer, extra]);
  assert.equal(merged.length, 2, "duplicate URLs collapse");
  assert.equal(merged.find(i => i.url.includes("a.example")).visitCount, 9, "newest record wins");
  assert.deepEqual(merged.map(i => i.lastVisitTime), [900, 500], "sorted newest first");
});

test("merging a full snapshot with later increments reconstructs the whole set", () => {
  const full = { kind: "full", items: [
    { url: "https://x/1", lastVisitTime: 10 },
    { url: "https://x/2", lastVisitTime: 20 }
  ] };
  const inc1 = { kind: "incremental", items: [{ url: "https://x/3", lastVisitTime: 30 }] };
  const inc2 = { kind: "incremental", items: [{ url: "https://x/2", lastVisitTime: 40 }] };

  const merged = mergeBackups([full, inc1, inc2]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].url, "https://x/2");
  assert.equal(merged[0].lastVisitTime, 40, "the increment supersedes the snapshot");
});
