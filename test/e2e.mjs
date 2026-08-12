// End-to-end: loads the built extension in Chromium, seeds history, runs real
// backups, and verifies the produced files decrypt and decompress back to the
// history that went in.
import { chromium } from "playwright";
import { readFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { decrypt, isEncrypted } from "../src/lib/crypto.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = process.env.HISTBAK_EXT || path.join(ROOT, "build/chrome");

let pass = 0, fail = 0;
const eq = (a, e, label) => {
  const ok = Object.is(a, e);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "} ${label}`);
  if (!ok) console.log(`         expected: ${e}\n         actual:   ${a}`);
};
const ok_ = (c, label) => eq(Boolean(c), true, label);

function findChromium() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const base = path.join(os.homedir(), ".cache/ms-playwright");
  if (!existsSync(base)) return undefined;
  const dir = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
  const exe = dir && path.join(base, dir, "chrome-linux64", "chrome");
  return exe && existsSync(exe) ? exe : undefined;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const filesIn = dir => readdirSync(dir).filter(f => !f.endsWith(".crdownload"));

(async () => {
  if (!existsSync(EXT)) throw new Error("build/chrome missing — run `npm run build` first");

  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "histbak-e2e-"));
  const dlDir = mkdtempSync(path.join(os.tmpdir(), "histbak-dl-"));
  const exe = findChromium();

  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    ...(exe ? { executablePath: exe } : {}),
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1280, height: 900 }
  });

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 30000 });
  const id = new URL(sw.url()).host;
  console.log(`\nextension ${id}\n`);
  ok_(id, "extension loaded with an MV3 service worker");

  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir, eventsEnabled: true });

  // Spy on the requested filename: CDP saves under a GUID, so the template
  // result is only observable at the call site.
  const installSpy = () => sw.evaluate(() => {
    if (!globalThis.__dl) {
      globalThis.__dl = [];
      const orig = chrome.downloads.download.bind(chrome.downloads);
      chrome.downloads.download = (o, cb) => { globalThis.__dl.push(o.filename); return orig(o, cb); };
    }
    globalThis.__dl.length = 0;
  });
  const requested = () => sw.evaluate(() => globalThis.__dl || []);

  // Messages must originate from an extension page: a service worker does not
  // receive its own chrome.runtime.sendMessage.
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.waitForLoadState("domcontentloaded");
  const msg = m => page.evaluate(m => chrome.runtime.sendMessage(m), m);

  // --- seed history ---------------------------------------------------------
  console.log("seeding history");
  const SEED = 40;
  await sw.evaluate(async n => {
    const hosts = ["example.com", "news.example.org", "docs.example.net", "shop.example.io"];
    for (let i = 0; i < n; i++) {
      await chrome.history.addUrl({ url: `https://${hosts[i % hosts.length]}/page/${i}?utm_source=test&keep=1` });
    }
  }, SEED);
  await sleep(1200);
  const seeded = await sw.evaluate(() =>
    new Promise(r => chrome.history.search({ text: "", startTime: 0, maxResults: 1000 }, x => r(x.length))));
  ok_(seeded >= SEED, `history seeded (${seeded} entries)`);

  // --- defaults -------------------------------------------------------------
  const state = await msg({ type: "getState" });
  eq(state.settings.enabled, true, "scheduled backups on by default");
  eq(state.settings.compress, true, "compression on by default");
  eq(state.settings.encrypt, false, "encryption off by default (needs a passphrase first)");
  ok_(state.nextRunAt > Date.now(), "a next run is scheduled");
  const alarms = await sw.evaluate(() => chrome.alarms.getAll());
  ok_(alarms.find(a => a.name === "histbak:scheduled"), "chrome.alarms entry exists");

  // --- plain compressed backup ---------------------------------------------
  console.log("\nbackup: gzip, unencrypted");
  await installSpy();
  const before = filesIn(dlDir).length;
  const r1 = await msg({ type: "runNow", full: true });
  await sleep(2500);

  ok_(r1.ok, `run reported ok (${r1.items} items)`);
  eq(r1.kind, "full", "forced run is a full snapshot");
  ok_(filesIn(dlDir).length > before, "a file landed on disk");
  const name1 = (await requested())[0] || "";
  console.log(`         requested: ${name1}`);
  ok_(/^histbak\/\d{4}-\d{2}\/history-\d{8}-\d{4}-\d+items\.json\.gz$/.test(name1), "filename matches the default template");
  ok_(r1.ratio > 3, `gzip shrank it ${r1.ratio}x`);

  const gz = readFileSync(path.join(dlDir, filesIn(dlDir).sort().pop()));
  const env = JSON.parse(gunzipSync(gz).toString("utf8"));
  eq(env.format, "histbak", "envelope carries a format tag");
  eq(env.kind, "full", "envelope records the kind");
  ok_(env.items.length >= SEED, `envelope holds ${env.items.length} items`);
  ok_(env.items.every(i => i.url && !i.url.includes("utm_source")), "tracking params stripped from stored URLs");
  ok_(env.items.some(i => i.url.includes("keep=1")), "non-tracking params preserved");

  // --- incremental ----------------------------------------------------------
  console.log("\nbackup: incremental");
  await installSpy();
  const r2 = await msg({ type: "runNow" });
  await sleep(1500);
  eq(r2.skipped, "nothing-new", "second run with no new history exports nothing");
  eq((await requested()).length, 0, "and writes no file");

  await sw.evaluate(() => chrome.history.addUrl({ url: "https://fresh.example.com/after" }));
  await sleep(800);
  await installSpy();
  const r3 = await msg({ type: "runNow" });
  await sleep(2000);
  ok_(r3.ok && !r3.skipped, "a new visit triggers an incremental run");
  eq(r3.kind, "incremental", "and it is marked incremental");
  ok_(r3.items < env.items.length, `only the delta is exported (${r3.items} vs ${env.items.length})`);

  // --- encrypted ------------------------------------------------------------
  console.log("\nbackup: encrypted");
  await msg({ type: "setSettings", patch: { encrypt: true, kdfIterations: 100000 } });
  await installSpy();
  const denied = await msg({ type: "runNow", full: true });
  eq(denied.skipped, "no-passphrase", "refuses to run encrypted with no passphrase");
  eq((await requested()).length, 0, "and writes nothing rather than falling back to plaintext");

  await msg({ type: "setPassphrase", passphrase: "correct horse battery staple" });
  await installSpy();
  const r4 = await msg({ type: "runNow", full: true });
  await sleep(3000);
  ok_(r4.ok, "runs once the passphrase is set");
  const encName = (await requested())[0] || "";
  ok_(encName.endsWith(".json.gz.enc"), `extension reflects the pipeline: ${encName}`);

  const encFile = readFileSync(path.join(dlDir, filesIn(dlDir).sort().pop()));
  ok_(isEncrypted(new Uint8Array(encFile)), "file carries the HISTBAK1 header");
  ok_(!encFile.includes(Buffer.from("example.com")), "no plaintext URL survives in the ciphertext");

  const plain = await decrypt(new Uint8Array(encFile), "correct horse battery staple");
  const env2 = JSON.parse(gunzipSync(Buffer.from(plain)).toString("utf8"));
  ok_(env2.items.length >= SEED, `decrypts back to ${env2.items.length} items`);
  await (async () => {
    try { await decrypt(new Uint8Array(encFile), "wrong"); fail++; console.log("FAIL   wrong passphrase should not decrypt"); }
    catch { pass++; console.log("  ok   wrong passphrase is rejected"); }
  })();

  // --- viewer ---------------------------------------------------------------
  console.log("\nviewer");
  await page.goto(`chrome-extension://${id}/viewer.html`);
  await page.waitForSelector(".kpis", { timeout: 15000 });
  await page.waitForTimeout(700);

  const heroText = await page.locator(".stat.hero .stat-value").innerText();
  ok_(parseInt(heroText.replace(/\D/g, ""), 10) >= SEED, `hero figure shows ${heroText} pages`);
  eq(await page.locator(".stat").count(), 6, "six stat tiles");
  // The trend line needs at least two distinct days. history.addUrl always
  // stamps "now", so a freshly seeded profile has exactly one — the line chart
  // correctly shows its empty state instead of plotting a single point.
  eq(await page.locator("svg").count(), 2, "heatmap and bars rendered");
  ok_(
    (await page.locator("section.panel").filter({ hasText: "Pages per day" }).innerText())
      .includes("Not enough days"),
    "trend panel explains why it cannot plot a single-day profile"
  );
  ok_(await page.locator("rect.cell").count() > 100, "heatmap grid drawn");
  ok_(await page.locator("path.bar").count() > 0, "domain bars drawn");

  // Single-measure charts must not carry a legend box.
  eq(await page.locator(".legend").count(), 0, "no legend box on single-series charts");

  await page.locator("g.bar-row").first().hover(); // row is the hit target, not the 2px bar
  await page.waitForTimeout(200);
  ok_(await page.locator(".viz-tip.on").count() === 1, "hovering a bar shows a tooltip");

  await page.getByRole("button", { name: "Table view" }).click();
  await page.waitForSelector("table.data");
  ok_(await page.locator("table.data tbody tr").count() > 0, "table view lists rows");

  await page.getByRole("button", { name: "7 days" }).click();
  await page.waitForTimeout(900);
  ok_(await page.locator(".kpis").count() === 1, "range switch re-renders without error");

  // Nothing should have thrown into the console.
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.reload();
  await page.waitForSelector(".kpis");
  await page.waitForTimeout(500);
  eq(errors.length, 0, `no page errors${errors.length ? `: ${errors[0]}` : ""}`);

  await ctx.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("E2E ERROR:", e); process.exit(1); });
