// Renders the REAL viewer page against synthetic history and screenshots it.
//
// Only the message layer is stubbed: viewer.js, charts.js and insights.js all
// run unmodified. history.addUrl always stamps "now", so a test profile can
// never contain the multi-day, multi-hour spread the charts are designed for —
// this is how the layout gets eyeballed at realistic density.
import { chromium } from "playwright";
import { readdirSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "build/chrome");
const OUT = path.join(ROOT, "docs/screenshots");

function findChromium() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const base = path.join(os.homedir(), ".cache/ms-playwright");
  if (!existsSync(base)) return undefined;
  const dir = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
  const exe = dir && path.join(base, dir, "chrome-linux64", "chrome");
  return exe && existsSync(exe) ? exe : undefined;
}

// A plausible browsing shape: work hours heavier than nights, weekdays heavier
// than weekends, and a long tail of domains rather than a uniform spread.
function synthesise(days = 90) {
  const domains = [
    ["github.com", 0.17], ["news.ycombinator.com", 0.11], ["stackoverflow.com", 0.10],
    ["developer.mozilla.org", 0.08], ["youtube.com", 0.07], ["reddit.com", 0.06],
    ["wikipedia.org", 0.05], ["docs.python.org", 0.04], ["arxiv.org", 0.03],
    ["mail.example.com", 0.03], ["figma.com", 0.02], ["npmjs.com", 0.02]
  ];
  const hourWeight = h =>
    h < 6 ? 0.15 : h < 9 ? 0.6 : h < 12 ? 1.0 : h < 14 ? 0.7 : h < 18 ? 1.0 : h < 22 ? 0.75 : 0.3;

  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const items = [];
  const now = new Date();
  for (let d = days; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const perDay = Math.round((weekend ? 12 : 34) * (0.6 + rnd()));
    for (let i = 0; i < perDay; i++) {
      let hour = Math.floor(rnd() * 24);
      if (rnd() > hourWeight(hour)) hour = 9 + Math.floor(rnd() * 9);
      const ts = new Date(date);
      ts.setHours(hour, Math.floor(rnd() * 60), 0, 0);

      const total = domains.reduce((a, [, w]) => a + w, 0);
      let roll = rnd() * total, pick = domains[0][0];
      for (const [host, share] of domains) {
        if ((roll -= share) <= 0) { pick = host; break; }
      }
      items.push({
        url: `https://${pick}/path/${Math.floor(rnd() * 900)}`,
        title: `${pick.split(".")[0]} — page ${Math.floor(rnd() * 900)}`,
        lastVisitTime: ts.getTime(),
        visitCount: 1 + Math.floor(rnd() * 9)
      });
    }
  }
  return items;
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const exe = findChromium();
  const ctx = await chromium.launchPersistentContext(
    path.join(os.tmpdir(), `histbak-preview-${Date.now()}`),
    {
      headless: true,
      ...(exe ? { executablePath: exe } : {}),
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
      viewport: { width: 1180, height: 1000 },
      deviceScaleFactor: 2
    }
  );

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 30000 });
  const id = new URL(sw.url()).host;

  const items = synthesise(90);
  console.log(`synthetic history: ${items.length} pages over 90 days`);

  const page = await ctx.newPage();
  await page.addInitScript(data => {
    // Intercept only queryHistory; everything else falls through untouched.
    const real = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg?.type === "queryHistory") {
        const from = msg.startTime ?? 0;
        const items = data.filter(i => i.lastVisitTime >= from);
        const res = { items, stats: { kept: items.length } };
        if (cb) { cb(res); return; }
        return Promise.resolve(res);
      }
      return real(msg, cb);
    };
  }, items);

  await page.goto(`chrome-extension://${id}/viewer.html`);
  await page.waitForSelector(".kpis");
  await page.waitForTimeout(900);

  await page.screenshot({ path: path.join(OUT, "viewer.png"), fullPage: true });
  console.log("wrote docs/screenshots/viewer.png");

  // Tooltip visible, so the hover layer is captured too.
  await page.locator("rect.cell").nth(100).hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "viewer-hover.png"), clip: { x: 0, y: 150, width: 1180, height: 560 } });
  console.log("wrote docs/screenshots/viewer-hover.png");

  await page.getByRole("button", { name: "Table view" }).click();
  await page.waitForSelector("table.data");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "viewer-table.png"), fullPage: true });
  console.log("wrote docs/screenshots/viewer-table.png");

  // Options page, with encryption switched on so the passphrase UI is visible.
  const opts = await ctx.newPage();
  await opts.goto(`chrome-extension://${id}/options.html`);
  await opts.waitForSelector(".savebar");
  await opts.evaluate(() => chrome.runtime.sendMessage({ type: "setSettings", patch: { encrypt: true } }));
  await opts.reload();
  await opts.waitForSelector(".savebar");
  await opts.waitForTimeout(500);
  await opts.screenshot({ path: path.join(OUT, "options.png"), fullPage: true });
  console.log("wrote docs/screenshots/options.png");

  // Popup, after a real backup so it has a result to show. The viewer's data is
  // stubbed at the message layer, but a backup reads the real history store, so
  // that has to be seeded for the popup to show a representative outcome.
  await sw.evaluate(async () => {
    const hosts = ["github.com", "news.ycombinator.com", "stackoverflow.com", "developer.mozilla.org"];
    for (let i = 0; i < 48; i++) {
      await chrome.history.addUrl({ url: `https://${hosts[i % hosts.length]}/page/${i}` });
    }
  });
  await opts.waitForTimeout(1200);
  await opts.evaluate(() => chrome.runtime.sendMessage({ type: "setSettings", patch: { encrypt: false } }));
  await opts.evaluate(() => chrome.runtime.sendMessage({ type: "runNow", full: true }));
  await opts.waitForTimeout(2500);
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 320, height: 420 });
  await pop.goto(`chrome-extension://${id}/popup.html`);
  await pop.waitForSelector(".actions");
  await pop.waitForTimeout(400);
  await pop.screenshot({ path: path.join(OUT, "popup.png") });
  console.log("wrote docs/screenshots/popup.png");

  await ctx.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
