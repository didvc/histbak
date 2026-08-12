// Reading the browser history store.
//
// chrome.history.search caps results (100 by default, and it will not return an
// unbounded set even with a large maxResults). Asking for "everything since T"
// in one call therefore silently truncates, which in a backup tool means
// quietly losing history. So the range is walked in windows, narrowing when a
// window comes back full, and the walk is bounded so a pathological history
// cannot spin forever.

const api = () => globalThis.chrome ?? globalThis.browser;

const PAGE = 5000; // per-call ceiling we ask for
const MIN_WINDOW_MS = 60 * 1000; // stop narrowing at one minute

const search = query =>
  new Promise((resolve, reject) => {
    try {
      const r = api().history.search(query, items => {
        const err = api().runtime?.lastError;
        err ? reject(new Error(err.message)) : resolve(items || []);
      });
      if (r?.then) r.then(resolve, reject); // Firefox returns a promise
    } catch (e) {
      reject(e);
    }
  });

/**
 * Collect history items with lastVisitTime in [startTime, endTime).
 *
 * Deduplicated by URL, keeping the entry with the newest lastVisitTime, because
 * overlapping windows will return the same URL more than once.
 */
export async function collectHistory({
  startTime = 0,
  endTime = Date.now(),
  maxItems = Infinity,
  onProgress = null
} = {}) {
  const byUrl = new Map();
  const queue = [[startTime, endTime]];
  let calls = 0;
  let truncated = false;

  while (queue.length) {
    if (byUrl.size >= maxItems) {
      truncated = true;
      break;
    }
    const [from, to] = queue.pop();
    if (to <= from) continue;

    calls++;
    const items = await search({ text: "", startTime: from, endTime: to, maxResults: PAGE });

    for (const item of items) {
      const prev = byUrl.get(item.url);
      if (!prev || (item.lastVisitTime ?? 0) > (prev.lastVisitTime ?? 0)) byUrl.set(item.url, item);
    }

    // A full page means the window probably hid entries. Split and revisit.
    if (items.length >= PAGE && to - from > MIN_WINDOW_MS) {
      const mid = from + Math.floor((to - from) / 2);
      queue.push([mid, to], [from, mid]);
    } else if (items.length >= PAGE) {
      // Cannot narrow further: more than PAGE items inside one minute.
      truncated = true;
    }

    if (onProgress) onProgress({ found: byUrl.size, calls, pending: queue.length });
  }

  const items = [...byUrl.values()].sort((a, b) => (b.lastVisitTime ?? 0) - (a.lastVisitTime ?? 0));
  const capped = items.length > maxItems ? items.slice(0, maxItems) : items;

  return {
    items: capped,
    stats: {
      calls,
      unique: items.length,
      returned: capped.length,
      truncated: truncated || capped.length < items.length,
      newest: capped[0]?.lastVisitTime ?? 0,
      oldest: capped[capped.length - 1]?.lastVisitTime ?? 0
    }
  };
}

/** Total item count, used by the viewer's summary without holding everything. */
export async function estimateSize() {
  const { stats } = await collectHistory({ maxItems: Infinity });
  return stats.unique;
}
