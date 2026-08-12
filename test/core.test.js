import test from "node:test";
import assert from "node:assert/strict";

import {
  encrypt, decrypt, isEncrypted, parseHeader, passphraseWarning,
  HEADER_BYTES, DEFAULT_ITERATIONS
} from "../src/lib/crypto.js";
import { gzip, gunzip, isGzip, encodeJson, decodeJson } from "../src/lib/compress.js";
import { renderTemplate, extensionFor, DEFAULT_TEMPLATE } from "../src/lib/naming.js";

// Keep the KDF cheap in tests; the iteration count is a stored parameter, so
// exercising the format at 1k proves the same code path as 600k.
const FAST = { iterations: 1000 };
const sample = [
  { url: "https://example.com/a?q=1", title: "A", lastVisitTime: 1735689600000, visitCount: 3 },
  { url: "https://news.example.org/x", title: "X", lastVisitTime: 1735693200000, visitCount: 1 }
];

test("compress: round-trips and actually shrinks repetitive history", async () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ ...sample[0], url: `https://example.com/p/${i}` }));
  const raw = encodeJson(many);
  const gz = await gzip(raw);
  assert.ok(isGzip(gz), "output carries gzip magic");
  assert.ok(gz.length < raw.length / 4, `expected >4x shrink, got ${(raw.length / gz.length).toFixed(1)}x`);
  assert.deepEqual(decodeJson(await gunzip(gz)), many);
});

test("crypto: round-trips", async () => {
  const pt = encodeJson(sample);
  const ct = await encrypt(pt, "correct horse battery staple", FAST);
  assert.ok(isEncrypted(ct));
  assert.deepEqual(decodeJson(await decrypt(ct, "correct horse battery staple")), sample);
});

test("crypto: wrong passphrase fails, and does not half-decrypt", async () => {
  const ct = await encrypt(encodeJson(sample), "right", FAST);
  await assert.rejects(() => decrypt(ct, "wrong"), /decryption failed/);
  await assert.rejects(() => decrypt(ct, ""), /passphrase required/);
});

test("crypto: ciphertext differs across runs (fresh salt and IV)", async () => {
  const pt = encodeJson(sample);
  const a = await encrypt(pt, "same", FAST);
  const b = await encrypt(pt, "same", FAST);
  assert.notDeepEqual(a.slice(14, 30), b.slice(14, 30), "salt must be random per file");
  assert.notDeepEqual(a.slice(30, 42), b.slice(30, 42), "IV must be random per file");
  assert.notDeepEqual(a.slice(HEADER_BYTES), b.slice(HEADER_BYTES));
});

test("crypto: tampering with the ciphertext is detected", async () => {
  const ct = await encrypt(encodeJson(sample), "pw", FAST);
  ct[ct.length - 5] ^= 0xff;
  await assert.rejects(() => decrypt(ct, "pw"), /decryption failed/);
});

test("crypto: header is authenticated, so downgrading iterations is detected", async () => {
  const ct = await encrypt(encodeJson(sample), "pw", FAST);
  const view = new DataView(ct.buffer, ct.byteOffset, ct.byteLength);
  assert.equal(view.getUint32(10, false), 1000);
  view.setUint32(10, 1, false); // pretend it was derived with 1 iteration
  await assert.rejects(() => decrypt(ct, "pw"), /decryption failed/);
});

test("crypto: rejects foreign or truncated files", () => {
  assert.equal(isEncrypted(new Uint8Array(10)), false);
  assert.equal(isEncrypted(encodeJson(sample)), false);
  assert.throws(() => parseHeader(new Uint8Array([1, 2, 3])), /not a histbak/);
});

test("crypto: header records the real iteration count", async () => {
  const ct = await encrypt(new Uint8Array([1]), "pw", { iterations: 12345 });
  assert.equal(parseHeader(ct).iterations, 12345);
  assert.equal(DEFAULT_ITERATIONS, 600000);
});

test("pipeline: json -> gzip -> encrypt -> decrypt -> gunzip -> json", async () => {
  const packed = await encrypt(await gzip(encodeJson(sample)), "pw", FAST);
  assert.deepEqual(decodeJson(await gunzip(await decrypt(packed, "pw"))), sample);
});

test("naming: renders tokens in local time", () => {
  const d = new Date(2026, 7, 9, 6, 5, 3); // 2026-08-09 06:05:03 local
  const out = renderTemplate("h/{YYYY}-{MM}-{DD}_{HH}{mm}{ss}-{count}{ext}", { date: d, count: 42 });
  assert.equal(out, "h/2026-08-09_060503-42.json.gz");
});

test("naming: refuses to escape the download directory", () => {
  const out = renderTemplate("../../etc/{YYYY}/pwn", { date: new Date(2026, 0, 1) });
  assert.ok(!out.includes(".."), out);
  assert.ok(!out.startsWith("/"), out);
  assert.equal(out, "etc/2026/pwn.json.gz");
});

test("naming: strips characters that break Windows or shells", () => {
  const out = renderTemplate('bad<>:"|?*name', { date: new Date() });
  assert.ok(!/[<>:"|?*]/.test(out), out);
});

test("naming: dodges Windows reserved device names", () => {
  assert.ok(renderTemplate("con", { date: new Date() }).startsWith("_con"));
  assert.ok(renderTemplate("a/nul", { date: new Date() }).includes("_nul"));
});

test("naming: empty or degenerate templates still produce a file", () => {
  assert.equal(renderTemplate("", { date: new Date() }), "histbak/…".slice(0, 0) + renderTemplate(DEFAULT_TEMPLATE, { date: new Date() }));
  assert.equal(renderTemplate("///", { date: new Date() }), "histbak.json.gz");
});

test("naming: unknown tokens stay visible rather than vanishing", () => {
  assert.ok(renderTemplate("x-{nope}", { date: new Date() }).includes("{nope}"));
});

test("naming: extension matches the pipeline actually used", () => {
  assert.equal(extensionFor({ compress: true, encrypt: true }), ".json.gz.enc");
  assert.equal(extensionFor({ compress: true, encrypt: false }), ".json.gz");
  assert.equal(extensionFor({ compress: false, encrypt: true }), ".json.enc");
  assert.equal(extensionFor({ compress: false, encrypt: false }), ".json");
});

test("passphrase warnings fire on the obvious cases", () => {
  assert.match(passphraseWarning(""), /unencrypted/);
  assert.match(passphraseWarning("abc"), /short/i);
  assert.match(passphraseWarning("12345678901234"), /digits/i);
  assert.equal(passphraseWarning("correct horse battery staple"), null);
});
