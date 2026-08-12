// Tiny DOM helpers. Everything is built with createElement rather than
// innerHTML: this extension renders page titles and URLs from the user's own
// history, and one crafted <img onerror> in a title would otherwise execute
// inside an extension page with history and downloads permissions.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k in node && k !== "list") node[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clear = node => {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
};

export const mount = (node, ...children) => {
  clear(node).append(...children.flat(Infinity).filter(Boolean));
  return node;
};

const api = () => globalThis.chrome ?? globalThis.browser;

export function send(message) {
  return new Promise((resolve, reject) => {
    const r = api().runtime.sendMessage(message, response => {
      const err = api().runtime?.lastError;
      if (err) return reject(new Error(err.message));
      if (response?.error) return reject(new Error(response.error));
      resolve(response);
    });
    if (r?.then) r.then(res => (res?.error ? reject(new Error(res.error)) : resolve(res)), reject);
  });
}

// --- formatting -------------------------------------------------------------

export function bytes(n) {
  if (!Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export const num = n => (Number.isFinite(n) ? n.toLocaleString() : "—");

export function relativeTime(ts) {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const units = [
    ["year", 31536e6], ["month", 2592e6], ["week", 6048e5],
    ["day", 864e5], ["hour", 36e5], ["minute", 6e4]
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      const v = Math.round(diff / ms);
      return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-v, unit);
    }
  }
  return "just now";
}

export const dateTime = ts =>
  ts ? new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
