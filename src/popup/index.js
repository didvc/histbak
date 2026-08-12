import { el, mount, send, bytes, num, relativeTime, dateTime } from "../ui/dom.js";

const api = globalThis.chrome ?? globalThis.browser;
const app = document.getElementById("app");

let state = null;
let busy = false;

async function refresh() {
  state = await send({ type: "getState" });
  render();
}

function render() {
  const s = state.settings;
  const last = s.lastResult;

  app.setAttribute("aria-busy", String(busy));
  mount(
    app,
    el("header", { class: "brand" },
      el("h1", {}, "histbak"),
      el("span", { class: `pill ${s.enabled ? "ok" : ""}` }, s.enabled ? "scheduled" : "paused")
    ),

    lastRunNotice(last),

    el("dl", { class: "kv" },
      el("dt", {}, "Last backup"), el("dd", { title: dateTime(s.lastRunAt) }, relativeTime(s.lastRunAt)),
      el("dt", {}, "Next run"), el("dd", { title: state.nextRunAt ? dateTime(state.nextRunAt) : "" },
        s.enabled ? relativeTime(state.nextRunAt) : "paused"),
      el("dt", {}, "Schedule"), el("dd", {}, scheduleLabel(s)),
      el("dt", {}, "Protection"), el("dd", {}, protectionLabel(s))
    ),

    s.encrypt && !state.hasPassphrase ? passphrasePrompt() : null,

    el("div", { class: "actions" },
      el("button", {
        class: "primary",
        disabled: busy,
        onclick: () => run({ full: false })
      }, busy ? "Backing up…" : "Back up now"),
      el("button", { disabled: busy, onclick: () => run({ full: true }), title: "Ignore the incremental cursor and export everything" }, "Full")
    ),

    el("footer", { class: "links" },
      el("a", { onclick: openViewer }, "Viewer"),
      el("a", { onclick: () => api.runtime.openOptionsPage() }, "Settings")
    )
  );
}

function scheduleLabel(s) {
  if (!s.enabled) return "off";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (s.frequency === "hourly") return `hourly at :${s.timeOfDay.split(":")[1]}`;
  if (s.frequency === "weekly") return `${days[s.dayOfWeek] || "Sun"} ${s.timeOfDay}`;
  return `daily ${s.timeOfDay}`;
}

function protectionLabel(s) {
  const parts = [];
  parts.push(s.compress ? "gzip" : "raw");
  parts.push(s.encrypt ? "encrypted" : "unencrypted");
  return parts.join(" · ");
}

function lastRunNotice(last) {
  if (!last) return el("p", { class: "muted", style: { margin: 0, fontSize: "13px" } }, "No backup has run yet.");

  if (last.ok === false && last.skipped === "no-passphrase") {
    return el("div", { class: "notice warn" }, "Last run was skipped: encryption is on but no passphrase was entered.");
  }
  if (last.ok === false) {
    return el("div", { class: "notice danger" }, `Last run failed: ${last.error || last.message || "unknown error"}`);
  }
  if (last.skipped) {
    return el("div", { class: "notice" }, last.message || "Nothing to back up.");
  }
  return el("div", { class: "notice" },
    el("div", { class: "truncate mono", title: last.filename }, last.filename),
    el("div", { class: "faint", style: { fontSize: "12px", marginTop: "2px" } },
      `${num(last.items)} items · ${bytes(last.finalBytes)}`,
      last.ratio > 1 ? ` · ${last.ratio}× smaller` : "",
      last.kind === "full" ? " · full" : " · incremental"
    )
  );
}

function passphrasePrompt() {
  let value = "";
  const input = el("input", {
    type: "password",
    placeholder: "Passphrase for this session",
    autocomplete: "current-password",
    oninput: e => (value = e.target.value),
    onkeydown: e => { if (e.key === "Enter") unlock(); }
  });
  const unlock = async () => {
    if (!value) return;
    await send({ type: "setPassphrase", passphrase: value });
    await refresh();
  };
  return el("div", { class: "stack" },
    el("div", { class: "notice warn" }, "Encryption is on. Backups cannot run until the passphrase is entered."),
    el("div", { class: "pass" }, input, el("button", { onclick: unlock }, "Unlock"))
  );
}

async function run(opts) {
  busy = true;
  render();
  try {
    await send({ type: "runNow", ...opts });
  } catch (e) {
    state.settings.lastResult = { ok: false, error: e.message };
  } finally {
    busy = false;
    await refresh();
  }
}

function openViewer() {
  api.tabs.create({ url: api.runtime.getURL("viewer.html") });
  window.close();
}

refresh().catch(e => {
  mount(app, el("div", { class: "notice danger" }, `Could not reach the extension background: ${e.message}`));
});
