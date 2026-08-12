// Filename templating for backup files.
//
// Users pick a pattern like:
//   histbak/{YYYY}-{MM}/history-{YYYY}{MM}{DD}-{HH}{mm}{count}{ext}
//
// Everything is resolved against local time, because a person choosing
// "daily at 6am" means their 6am, and a file dated in UTC looks wrong to them.

export const TOKENS = {
  YYYY: d => String(d.getFullYear()),
  YY: d => String(d.getFullYear()).slice(-2),
  MM: d => pad(d.getMonth() + 1),
  DD: d => pad(d.getDate()),
  HH: d => pad(d.getHours()),
  mm: d => pad(d.getMinutes()),
  ss: d => pad(d.getSeconds()),
  MON: d => d.toLocaleString(undefined, { month: "short" }),
  DAY: d => d.toLocaleString(undefined, { weekday: "short" }),
  // Unambiguous when someone shares a file across timezones.
  TZ: d => {
    const off = -d.getTimezoneOffset();
    const sign = off < 0 ? "-" : "+";
    return `UTC${sign}${pad(Math.floor(Math.abs(off) / 60))}${pad(Math.abs(off) % 60)}`;
  }
};

const pad = n => String(n).padStart(2, "0");

export const DEFAULT_TEMPLATE = "histbak/{YYYY}-{MM}/history-{YYYY}{MM}{DD}-{HH}{mm}-{count}items{ext}";

// Windows forbids these outright; the rest are just painful in shells and URLs.
const ILLEGAL = /[<>:"\\|?*\u0000-\u001f]/g;
// Reserved device names on Windows; a file called "con.json" is unopenable there.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitiseSegment(segment) {
  let s = segment.replace(ILLEGAL, "-").replace(/\s+/g, " ").trim();
  s = s.replace(/^\.+/, "").replace(/[. ]+$/, ""); // no leading dots, no trailing dot/space
  if (RESERVED.test(s.split(".")[0])) s = `_${s}`;
  return s;
}

/**
 * Render a template to a download-safe relative path.
 *
 * chrome.downloads rejects absolute paths and any path escaping the download
 * directory, so `..` segments are dropped rather than sanitised into something
 * that still resolves upward.
 */
export function renderTemplate(template, { date = new Date(), count = 0, ext = ".json.gz" } = {}) {
  const raw = String(template || DEFAULT_TEMPLATE);

  const substituted = raw.replace(/\{(\w+)\}/g, (match, token) => {
    if (token === "count") return String(count);
    if (token === "ext") return ""; // appended after sanitising, never mangled
    const fn = TOKENS[token];
    return fn ? fn(date) : match; // unknown tokens survive verbatim, visibly wrong
  });

  const segments = substituted
    .split("/")
    .map(s => s.trim())
    .filter(s => s && s !== "." && s !== "..")
    .map(sanitiseSegment)
    .filter(Boolean);

  if (segments.length === 0) segments.push("histbak");

  // Guard against a template that renders to only an extension.
  const last = segments[segments.length - 1];
  if (!last) segments[segments.length - 1] = "history";

  return segments.join("/") + ext;
}

export function extensionFor({ compress, encrypt }) {
  if (encrypt) return compress ? ".json.gz.enc" : ".json.enc";
  return compress ? ".json.gz" : ".json";
}

// Shown live in the options page so the pattern is not a guessing game.
export function previewTemplate(template, opts) {
  try {
    return renderTemplate(template, opts);
  } catch (e) {
    return `invalid template: ${e.message}`;
  }
}
