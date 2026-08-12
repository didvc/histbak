import { el, mount, send, dateTime, num } from "../ui/dom.js";
import { previewTemplate, extensionFor, TOKENS, DEFAULT_TEMPLATE } from "../lib/naming.js";
import { passphraseWarning } from "../lib/crypto.js";
import { nextRunAt } from "../lib/schedule.js";

const app = document.getElementById("app");
let s = null;
let hasPassphrase = false;
let dirty = false;
let status = "";

const load = async () => {
  const state = await send({ type: "getState" });
  s = { ...state.settings };
  hasPassphrase = state.hasPassphrase;
  render();
};

function set(patch, { rerender = true } = {}) {
  Object.assign(s, patch);
  dirty = true;
  status = "";
  if (rerender) render();
}

async function save() {
  const { lastResult, lastRunAt, lastCursor, lastFullBackupAt, ...patch } = s;
  await send({ type: "setSettings", patch });
  dirty = false;
  status = "Saved.";
  render();
}

// --- field builders ---------------------------------------------------------

const check = (key, label, hint) =>
  el("label", { class: "check" },
    el("input", { type: "checkbox", checked: !!s[key], onchange: e => set({ [key]: e.target.checked }) }),
    el("span", { class: "grow" },
      el("span", { class: "label" }, label),
      hint ? el("div", { class: "hint" }, hint) : null
    )
  );

const field = (label, hint, control) =>
  el("div", { class: "field" },
    el("span", { class: "label" }, label),
    control,
    hint ? el("span", { class: "hint" }, hint) : null
  );

// --- sections ---------------------------------------------------------------

function scheduleSection() {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return el("section", { class: "card" },
    el("header", {}, el("h2", {}, "Schedule"),
      el("p", { class: "muted" },
        s.enabled
          ? `Next run ${dateTime(nextRunAt(s))}.`
          : "Automatic backups are off. You can still run one from the toolbar popup.")),

    check("enabled", "Back up automatically"),

    el("div", { class: "grid2" },
      field("Frequency", null,
        el("select", { value: s.frequency, onchange: e => set({ frequency: e.target.value }) },
          el("option", { value: "hourly" }, "Every hour"),
          el("option", { value: "daily" }, "Every day"),
          el("option", { value: "weekly" }, "Every week"))),

      field("Time", s.frequency === "hourly" ? "Only the minutes are used." : "Your local time.",
        el("input", { type: "time", value: s.timeOfDay, onchange: e => set({ timeOfDay: e.target.value || "03:00" }) })),

      s.frequency === "weekly"
        ? field("Day", null,
            el("select", { value: String(s.dayOfWeek), onchange: e => set({ dayOfWeek: +e.target.value }) },
              ...days.map((d, i) => el("option", { value: String(i) }, d))))
        : null
    ),

    check("runMissedOnStartup", "Run missed backups on startup",
      "If the browser was closed at the scheduled time, back up shortly after the next launch.")
  );
}

function contentSection() {
  return el("section", { class: "card" },
    el("header", {}, el("h2", {}, "What gets backed up")),

    check("incremental", "Incremental",
      "Each run exports only visits since the last one. Much smaller files."),

    s.incremental
      ? field("Full snapshot every", "A chain of deltas with one damaged link is not a backup, so a complete copy lands on this interval. 0 disables it.",
          el("div", { class: "row" },
            el("input", {
              type: "number", min: "0", max: "365", value: String(s.fullBackupEveryDays),
              style: { width: "90px" },
              onchange: e => set({ fullBackupEveryDays: Math.max(0, +e.target.value || 0) })
            }),
            el("span", { class: "muted" }, "days")))
      : null,

    field("Maximum items per run", "A ceiling so one run cannot exhaust memory on a very large history.",
      el("input", {
        type: "number", min: "1000", step: "1000", value: String(s.maxItemsPerRun),
        style: { width: "140px" },
        onchange: e => set({ maxItemsPerRun: Math.max(1000, +e.target.value || 100000) })
      }))
  );
}

function privacySection() {
  return el("section", { class: "card" },
    el("header", {}, el("h2", {}, "Privacy"),
      el("p", { class: "muted" }, "Applied before anything is written, and to the viewer as well.")),

    check("stripTracking", "Remove tracking parameters",
      "Drops utm_*, fbclid, gclid and similar. These identify campaigns and referrers, and lose nothing useful."),
    check("stripQuery", "Remove all query strings",
      "Stronger. Also removes search terms, which are often the most sensitive part of a URL."),
    check("stripFragment", "Remove #fragments"),
    check("dropTitles", "Do not store page titles",
      "Titles frequently reveal more than the URL does."),

    field("Never back up URLs matching", "One glob per line. * matches anything. Lines starting with # are ignored.",
      el("textarea", {
        spellcheck: false,
        value: (s.excludePatterns || []).join("\n"),
        onchange: e => set({ excludePatterns: e.target.value.split("\n").map(x => x.trim()).filter(Boolean) }, { rerender: false })
      }))
  );
}

function protectionSection() {
  const warning = s.encrypt ? null : "Backups are written unencrypted. Anyone with the file can read every URL.";
  return el("section", { class: "card" },
    el("header", {}, el("h2", {}, "Compression and encryption")),

    check("compress", "Compress with gzip", "History JSON typically shrinks around 10×."),
    check("encrypt", "Encrypt with a passphrase", "AES-256-GCM, key derived with PBKDF2-SHA-256."),

    warning ? el("div", { class: "notice warn" }, warning) : null,

    s.encrypt ? passphraseBlock() : null,

    s.encrypt
      ? field("Key derivation rounds", "Higher is slower to open and slower to attack. 600,000 is the current OWASP floor.",
          el("input", {
            type: "number", min: "100000", step: "50000", value: String(s.kdfIterations),
            style: { width: "140px" },
            onchange: e => set({ kdfIterations: Math.max(100000, +e.target.value || 600000) })
          }))
      : null
  );
}

function passphraseBlock() {
  let value = "";
  let confirmValue = "";
  const warn = el("div", { class: "hint" }, "");

  const update = () => {
    const w = passphraseWarning(value);
    warn.textContent = value && confirmValue && value !== confirmValue
      ? "The two entries do not match."
      : (w || (value ? "Looks reasonable." : ""));
  };

  const apply = async () => {
    if (!value || value !== confirmValue) return update();
    await send({ type: "setPassphrase", passphrase: value });
    hasPassphrase = true;
    status = "Passphrase set for this session.";
    render();
  };

  return el("div", { class: "stack" },
    el("div", { class: "notice" },
      hasPassphrase
        ? "A passphrase is set for this browser session."
        : "No passphrase this session. Scheduled runs will be skipped rather than written unencrypted."),

    el("div", { class: "grid2" },
      el("input", { type: "password", placeholder: "Passphrase", autocomplete: "new-password",
        oninput: e => { value = e.target.value; update(); } }),
      el("input", { type: "password", placeholder: "Confirm", autocomplete: "new-password",
        oninput: e => { confirmValue = e.target.value; update(); },
        onkeydown: e => { if (e.key === "Enter") apply(); } })
    ),
    warn,
    el("div", { class: "row" },
      el("button", { onclick: apply }, hasPassphrase ? "Replace passphrase" : "Set passphrase"),
      hasPassphrase
        ? el("button", { onclick: async () => { await send({ type: "clearPassphrase" }); hasPassphrase = false; render(); } }, "Forget")
        : null
    ),
    el("div", { class: "notice warn" },
      "The passphrase is held in memory for this browser session only and is never written to disk. " +
      "There is no recovery: lose it and the backups it produced cannot be opened.")
  );
}

function outputSection() {
  const ext = extensionFor({ compress: s.compress, encrypt: s.encrypt });
  const preview = previewTemplate(s.filenameTemplate, { date: new Date(), count: 1234, ext });

  const insert = token => {
    s.filenameTemplate = (s.filenameTemplate || "") + `{${token}}`;
    set({ filenameTemplate: s.filenameTemplate });
  };

  return el("section", { class: "card" },
    el("header", {}, el("h2", {}, "File naming"),
      el("p", { class: "muted" }, "Relative to your browser's download folder. Slashes create subfolders.")),

    el("input", {
      type: "text", value: s.filenameTemplate, spellcheck: false,
      oninput: e => set({ filenameTemplate: e.target.value }, { rerender: false }),
      onchange: () => render()
    }),

    el("div", { class: "preview" }, preview),

    el("div", { class: "tokens" },
      ...[...Object.keys(TOKENS), "count"].map(t => el("button", { onclick: () => insert(t) }, `{${t}}`)),
      el("button", { onclick: () => set({ filenameTemplate: DEFAULT_TEMPLATE }) }, "reset")
    ),

    field("Keep the last", "Older backups this extension created are deleted. 0 keeps everything.",
      el("div", { class: "row" },
        el("input", {
          type: "number", min: "0", value: String(s.keepLastN), style: { width: "90px" },
          onchange: e => set({ keepLastN: Math.max(0, +e.target.value || 0) })
        }),
        el("span", { class: "muted" }, "files")))
  );
}

function lastRunSection() {
  const r = s.lastResult;
  if (!r) return null;
  return el("section", { class: "card" },
    el("header", {}, el("h2", {}, "Last run")),
    el("dl", { class: "kv" },
      el("dt", {}, "When"), el("dd", {}, dateTime(r.at)),
      el("dt", {}, "Outcome"), el("dd", {}, r.ok === false ? (r.error || r.message) : (r.skipped || `${num(r.items)} items`)),
      r.filename ? el("dt", {}, "File") : null,
      r.filename ? el("dd", { class: "mono truncate" }, r.filename) : null
    )
  );
}

function render() {
  mount(app,
    el("header", { class: "page" },
      el("h1", {}, "histbak"),
      el("p", { class: "muted" }, "Backups stay on this machine. Nothing is uploaded anywhere.")),

    scheduleSection(),
    contentSection(),
    protectionSection(),
    privacySection(),
    outputSection(),
    lastRunSection(),

    el("div", { class: "savebar" },
      el("button", { class: "primary", disabled: !dirty, onclick: save }, "Save"),
      el("button", { onclick: () => send({ type: "runNow" }).then(load) }, "Back up now"),
      el("span", { class: "status" }, dirty ? "Unsaved changes" : status)
    )
  );
}

load().catch(e => mount(app, el("div", { class: "notice danger" }, e.message)));
