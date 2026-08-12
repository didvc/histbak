import { el, mount, send, num, dateTime } from "../ui/dom.js";
import { statTile, barsH, lineChart, heatmap, heatmapLegend } from "../ui/charts.js";
import { summarise } from "../lib/insights.js";
import { readBackup, readFileBytes, mergeBackups, NEEDS_PASSPHRASE } from "../lib/restore.js";

const app = document.getElementById("app");

const RANGES = [
  { id: "7", label: "7 days", days: 7 },
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
  { id: "365", label: "1 year", days: 365 },
  { id: "all", label: "All", days: null }
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

let rangeId = "30";
// null = live browser history; otherwise a set of opened backup files.
let source = null;
let items = [];
let stats = null;
let loading = true;
let showTable = false;
let error = null;
let search = "";

async function load() {
  loading = true;
  render();
  const range = RANGES.find(r => r.id === rangeId);
  const startTime = range.days ? Date.now() - range.days * 86400000 : 0;

  if (source) {
    // An opened backup is a fixed snapshot; the range filter still applies.
    items = source.items.filter(i => (i.lastVisitTime ?? 0) >= startTime);
  } else {
    const res = await send({ type: "queryHistory", startTime, endTime: Date.now(), maxItems: 50000 });
    items = res.items;
  }
  stats = summarise(items);
  loading = false;
  render();
}

async function openBackups(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const envelopes = [];
  let passphrase = null;

  for (const file of files) {
    const bytes = await readFileBytes(file);
    try {
      const { envelope } = await readBackup(bytes, passphrase);
      envelopes.push(envelope);
    } catch (e) {
      if (e.code !== NEEDS_PASSPHRASE) throw new Error(`${file.name}: ${e.message}`);
      // Ask once and reuse it: a set of backups almost always shares a passphrase.
      passphrase = window.prompt(`"${file.name}" is encrypted. Passphrase:`) || null;
      if (!passphrase) throw new Error("Cancelled.");
      const { envelope } = await readBackup(bytes, passphrase);
      envelopes.push(envelope);
    }
  }

  source = {
    names: files.map(f => f.name),
    items: mergeBackups(envelopes),
    kinds: [...new Set(envelopes.map(e => e.kind))]
  };
  rangeId = "all";
  await load();
}

function filters() {
  return el("div", { class: "filters" },
    el("div", { class: "seg", role: "group", "aria-label": "Time range" },
      ...RANGES.map(r =>
        el("button", {
          "aria-pressed": String(r.id === rangeId),
          onclick: () => { rangeId = r.id; load(); }
        }, r.label))),
    el("button", {
      "aria-pressed": String(showTable),
      onclick: () => { showTable = !showTable; render(); }
    }, showTable ? "Hide table" : "Table view"),

    el("label", { class: "btn openfile" }, "Open backup…",
      el("input", {
        type: "file", multiple: true, accept: ".json,.gz,.enc,application/json,application/octet-stream",
        onchange: e => {
          const files = e.target.files;
          e.target.value = "";
          openBackups(files).catch(err => {
            error = err.message;
            render();
          });
        }
      })),

    source
      ? el("button", { onclick: () => { source = null; error = null; rangeId = "30"; load(); } }, "Back to live history")
      : null
  );
}

function kpis() {
  const hour = stats.busiestHour;
  const day = stats.busiestDay;
  return el("div", { class: "kpis" },
    statTile({
      hero: true,
      label: "Pages in range",
      value: num(stats.pages),
      sub: stats.oldest ? `${dateTime(stats.oldest)} → ${dateTime(stats.newest)}` : null
    }),
    statTile({ label: "Distinct sites", value: num(stats.domains) }),
    statTile({ label: "Recorded visits", value: num(stats.lifetimeVisits), sub: "lifetime, all time" }),
    statTile({
      label: "Busiest hour",
      value: `${String(hour.index).padStart(2, "0")}:00`,
      sub: `${num(hour.value)} pages`
    }),
    statTile({ label: "Busiest day", value: DAYS[day.index].slice(0, 3), sub: `${num(day.value)} pages` }),
    statTile({ label: "Typical day", value: num(stats.perDay), sub: "pages per day" })
  );
}

function panel(title, subtitle, ...body) {
  return el("section", { class: "panel card" },
    el("header", {},
      el("div", {}, el("h2", {}, title), subtitle ? el("p", { class: "muted" }, subtitle) : null)),
    ...body
  );
}

function trendPanel() {
  return panel("Pages per day", "Each page counted once, on the day it was last opened.",
    el("div", { class: "chart-wrap" },
      lineChart(stats.days.map(d => ({ ...d })), {
        width: 660,
        xLabel: p => p.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      })));
}

function heatPanel() {
  const head = el("div", { class: "row" }, heatmapLegend());
  return panel("When you browse", "Weekday against hour of day, by last visit.",
    el("div", { class: "chart-wrap" }, heatmap(stats.grid, { width: 640 })),
    head
  );
}

function domainsPanel() {
  const top = stats.topDomains.slice(0, 12);
  return panel("Top sites", `${num(stats.domains)} distinct sites in this range.`,
    el("div", { class: "chart-wrap" },
      barsH(top.map(d => ({ ...d, sub: `${num(d.visits)} recorded visits` })), { width: 620 })));
}

function tablePanel() {
  const q = search.trim().toLowerCase();
  const rows = (q
    ? items.filter(i => (i.url + " " + (i.title || "")).toLowerCase().includes(q))
    : items
  ).slice(0, 300);

  return panel("History", "The same data as the charts, as text. Searchable, and readable by a screen reader.",
    el("div", { class: "searchbar" },
      el("input", {
        type: "text", placeholder: "Filter by URL or title", value: search,
        oninput: e => { search = e.target.value; renderTableOnly(); }
      })),
    el("div", { id: "tablebody" }, tableBody(rows, q))
  );
}

function tableBody(rows, q) {
  if (!rows.length) return el("p", { class: "muted" }, q ? "Nothing matches." : "No history in range.");
  return el("div", {},
    el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        el("th", {}, "Page"), el("th", {}, "Site"),
        el("th", { class: "n" }, "Visits"), el("th", {}, "Last opened"))),
      el("tbody", {}, ...rows.map(i =>
        el("tr", {},
          el("td", { class: "url", title: i.title || i.url }, i.title || i.url),
          el("td", { class: "muted" }, hostLabel(i.url)),
          el("td", { class: "n" }, num(i.visitCount || 0)),
          el("td", { class: "muted" }, dateTime(i.lastVisitTime)))))),
    rows.length >= 300 ? el("p", { class: "faint", style: { fontSize: "12px" } }, "Showing the first 300 rows. Narrow the filter to see more.") : null
  );
}

function renderTableOnly() {
  const host = document.getElementById("tablebody");
  if (!host) return render();
  const q = search.trim().toLowerCase();
  const rows = (q ? items.filter(i => (i.url + " " + (i.title || "")).toLowerCase().includes(q)) : items).slice(0, 300);
  mount(host, tableBody(rows, q));
}

const hostLabel = url => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
};

function render() {
  if (loading) {
    mount(app,
      el("header", { class: "page" }, el("div", {}, el("h1", {}, "histbak"))),
      filters(),
      el("p", { class: "muted" }, "Reading history…"));
    return;
  }

  mount(app,
    el("header", { class: "page" },
      el("div", {},
        el("h1", {}, "histbak"),
        el("p", { class: "sub muted" }, "Everything here is computed locally from your own history.")),
      filters()),

    error ? el("div", { class: "notice danger" }, error) : null,

    source
      ? el("div", { class: "notice" },
          `Showing ${source.names.length} opened backup file${source.names.length === 1 ? "" : "s"}: `,
          el("span", { class: "mono" }, source.names.join(", ")),
          ". This is a snapshot, not your live history.")
      : null,

    kpis(),

    el("div", { class: "panels two" }, heatPanel(), domainsPanel()),
    el("div", { class: "panels" }, trendPanel()),

    showTable ? tablePanel() : null,

    el("p", { class: "faint", style: { fontSize: "12px" } },
      "The browser records one timestamp per page, its most recent visit, so time-based charts count pages by last visit rather than every visit. " +
      "The lifetime visit counter is exact.")
  );
}

load().catch(e => mount(app, el("div", { class: "notice danger" }, e.message)));
