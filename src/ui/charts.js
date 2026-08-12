// Inline-SVG charts. No library.
//
// Colour roles come from CSS custom properties defined in viewer.css, so the
// palette lives in one place. Marks follow fixed specs: bars capped at 24px with
// a 4px rounded data-end and a square baseline, 2px lines, markers r>=4 wearing a
// 2px surface ring, hairline recessive gridlines, and a 2px surface gap between
// touching marks.
//
// Every chart here plots a single measure, so none carries a legend: the heading
// above it already names what is plotted, and a one-swatch legend box would just
// restate it. Identity instead comes from the axis labels and the tooltip.

import { el, num } from "./dom.js";

const SVG = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, String(v));
  }
  return node;
}

// --- tooltip ----------------------------------------------------------------
// One node reused by every chart. Positioned in page coordinates so it can
// escape a chart's overflow box.

let tip;
function tooltip() {
  if (!tip) {
    tip = el("div", { class: "viz-tip", role: "status", "aria-live": "polite" });
    document.body.append(tip);
  }
  return tip;
}

function showTip(evt, lines) {
  const t = tooltip();
  t.replaceChildren(
    ...lines.filter(Boolean).map((line, i) =>
      el("div", { class: i === 0 ? "viz-tip-title" : "viz-tip-row" }, line)
    )
  );
  t.classList.add("on");
  const pad = 12;
  const rect = t.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
  t.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}

const hideTip = () => tip?.classList.remove("on");

function hoverable(node, lines) {
  node.addEventListener("pointermove", e => showTip(e, lines()));
  node.addEventListener("pointerleave", hideTip);
  // Keyboard users get the same information without a pointer.
  node.setAttribute("tabindex", "0");
  node.addEventListener("focus", e => {
    const r = node.getBoundingClientRect();
    showTip({ clientX: r.left + r.width / 2, clientY: r.top }, lines());
  });
  node.addEventListener("blur", hideTip);
  return node;
}

// --- stat tiles -------------------------------------------------------------

export function statTile({ label, value, sub, hero = false }) {
  return el("div", { class: `stat${hero ? " hero" : ""}` },
    el("div", { class: "stat-label" }, label),
    el("div", { class: "stat-value" }, value),
    sub ? el("div", { class: "stat-sub" }, sub) : null
  );
}

// --- horizontal bars --------------------------------------------------------
// Ranked magnitude. Horizontal because the category labels are domains, and a
// vertical column chart would force them to 45 degrees or truncation.

export function barsH(data, { max = null, valueLabel = v => num(v), width = 640 } = {}) {
  if (!data.length) return emptyState("No data in this range.");

  const rowH = 28;
  const barH = Math.min(24, rowH - 8);
  const labelW = Math.min(190, Math.max(...data.map(d => d.label.length)) * 6.6 + 12);
  const valueW = 62;
  const plotW = Math.max(80, width - labelW - valueW - 16);
  const height = data.length * rowH;
  const peak = max ?? Math.max(...data.map(d => d.value), 1);

  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "xMinYMin meet",
    role: "img",
    "aria-label": `Bar chart, ${data.length} rows`
  });

  data.forEach((d, i) => {
    const y = i * rowH;
    const w = Math.max(2, (d.value / peak) * plotW);

    const g = svgEl("g", { class: "bar-row" });

    const label = svgEl("text", {
      x: labelW - 10, y: y + rowH / 2, "text-anchor": "end",
      "dominant-baseline": "central", class: "viz-label"
    });
    label.textContent = d.label;
    g.append(label);

    // Rounded only on the data end; the baseline end stays square.
    const r = 4;
    const x0 = labelW;
    const path = svgEl("path", {
      d: `M${x0},${y + (rowH - barH) / 2}
          h${Math.max(0, w - r)} a${r},${r} 0 0 1 ${r},${r}
          v${barH - 2 * r} a${r},${r} 0 0 1 ${-r},${r}
          h${-Math.max(0, w - r)} z`,
      class: "bar"
    });
    g.append(path);

    const val = svgEl("text", {
      x: labelW + w + 8, y: y + rowH / 2,
      "dominant-baseline": "central", class: "viz-value"
    });
    val.textContent = valueLabel(d.value);
    g.append(val);

    // The hit target spans the whole row, not just the drawn bar: a 2px bar is
    // impossible to hover.
    const hit = svgEl("rect", { x: 0, y, width, height: rowH, fill: "transparent" });
    g.append(hit);
    hoverable(g, () => [d.label, `${valueLabel(d.value)}${d.sub ? ` · ${d.sub}` : ""}`]);

    svg.append(g);
  });

  return svg;
}

// --- line over time ---------------------------------------------------------

export function lineChart(points, { width = 640, height = 180, valueLabel = num, xLabel = String } = {}) {
  if (points.length < 2) return emptyState("Not enough days in this range to plot a trend.");

  const pad = { top: 12, right: 14, bottom: 22, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const peak = Math.max(...points.map(p => p.value), 1);
  const ticks = niceTicks(peak, 3);
  const top = ticks[ticks.length - 1];

  const x = i => pad.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = v => pad.top + plotH - (v / top) * plotH;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "xMinYMin meet",
    role: "img", "aria-label": "Visits per day"
  });

  for (const t of ticks) {
    svg.append(svgEl("line", { x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t), class: "grid" }));
    const label = svgEl("text", { x: pad.left - 8, y: y(t), "text-anchor": "end", "dominant-baseline": "central", class: "viz-tick" });
    label.textContent = num(t);
    svg.append(label);
  }

  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  svg.append(svgEl("path", { d: `${d} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`, class: "area" }));
  svg.append(svgEl("path", { d, class: "line" }));

  // Endpoint marker plus its value: the one direct label this chart gets.
  const last = points[points.length - 1];
  svg.append(svgEl("circle", { cx: x(points.length - 1), cy: y(last.value), r: 4.5, class: "dot" }));

  // First and last x labels only; a tick under every day is unreadable.
  for (const [i, anchor] of [[0, "start"], [points.length - 1, "end"]]) {
    const t = svgEl("text", { x: x(i), y: height - 5, "text-anchor": anchor, class: "viz-tick" });
    t.textContent = xLabel(points[i]);
    svg.append(t);
  }

  // Crosshair: one transparent band per point, so hovering anywhere works.
  const band = plotW / Math.max(1, points.length - 1);
  const cross = svgEl("line", { class: "crosshair", y1: pad.top, y2: pad.top + plotH, x1: 0, x2: 0, opacity: 0 });
  svg.append(cross);
  points.forEach((p, i) => {
    const hit = svgEl("rect", {
      x: x(i) - band / 2, y: pad.top, width: band, height: plotH, fill: "transparent"
    });
    hit.addEventListener("pointerenter", () => {
      cross.setAttribute("x1", x(i));
      cross.setAttribute("x2", x(i));
      cross.setAttribute("opacity", "1");
    });
    hit.addEventListener("pointerleave", () => cross.setAttribute("opacity", "0"));
    hoverable(hit, () => [xLabel(p), `${valueLabel(p.value)} visits`]);
    svg.append(hit);
  });

  return svg;
}

// --- weekday x hour heatmap -------------------------------------------------
// Continuous magnitude on a grid, so a sequential one-hue ramp: light means
// near-zero and is allowed to recede into the surface.

const RAMP = ["#eef4fd", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function heatmap(grid, { width = 640 } = {}) {
  const peak = Math.max(...grid.flat(), 0);
  if (peak === 0) return emptyState("No visits in this range.");

  const labelW = 34;
  const gap = 2; // surface gap: the separator is the surface, never a stroke
  const cell = Math.floor((width - labelW - 23 * gap) / 24);
  const size = Math.max(10, cell);
  const height = 7 * (size + gap) + 18;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "xMinYMin meet",
    role: "img", "aria-label": "Activity by weekday and hour"
  });

  grid.forEach((row, day) => {
    const y = day * (size + gap);
    const label = svgEl("text", { x: labelW - 8, y: y + size / 2, "text-anchor": "end", "dominant-baseline": "central", class: "viz-label" });
    label.textContent = DAYS[day];
    svg.append(label);

    row.forEach((value, hour) => {
      const x = labelW + hour * (size + gap);
      const step = value === 0 ? 0 : 1 + Math.floor((value / peak) * (RAMP.length - 2));
      const rect = svgEl("rect", {
        x, y, width: size, height: size, rx: 2,
        fill: value === 0 ? "var(--viz-empty)" : RAMP[Math.min(step, RAMP.length - 1)],
        class: "cell"
      });
      hoverable(rect, () => [
        `${DAYS[day]} ${String(hour).padStart(2, "0")}:00`,
        `${num(value)} visit${value === 1 ? "" : "s"}`
      ]);
      svg.append(rect);
    });
  });

  // Hour ticks every six hours; 24 labels would collide at any sane width.
  for (const hour of [0, 6, 12, 18]) {
    const t = svgEl("text", {
      x: labelW + hour * (size + gap), y: height - 4, class: "viz-tick"
    });
    t.textContent = `${String(hour).padStart(2, "0")}h`;
    svg.append(t);
  }

  return svg;
}

export function heatmapLegend() {
  const wrap = el("div", { class: "ramp" }, el("span", { class: "faint" }, "less"));
  for (const c of RAMP.slice(1)) {
    wrap.append(el("span", { class: "ramp-step", style: { background: c } }));
  }
  wrap.append(el("span", { class: "faint" }, "more"));
  return wrap;
}

// --- helpers ----------------------------------------------------------------

function emptyState(message) {
  return el("p", { class: "muted", style: { margin: "8px 0", fontSize: "13px" } }, message);
}

function niceTicks(peak, count) {
  const rough = peak / count;
  const mag = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rough) ?? mag * 10;
  const out = [];
  for (let v = step; v <= peak + step * 0.001; v += step) out.push(Math.round(v));
  if (!out.length) out.push(Math.max(1, Math.ceil(peak)));
  return out;
}
