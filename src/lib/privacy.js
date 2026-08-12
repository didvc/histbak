// Privacy filters applied before anything is written to disk.
//
// The point of the extension is to keep a copy of your history. The point of
// this module is to let you keep less than all of it, because a plaintext-ish
// archive of every URL you have ever opened is a liability even when encrypted.

// Query parameters that are pure tracking. Removing them loses nothing and
// strips campaign/click identifiers that often encode who referred you.
const TRACKING_PARAMS = [
  /^utm_/i, /^ga_/i, /^_ga$/i, /^fbclid$/i, /^gclid$/i, /^dclid$/i, /^gbraid$/i, /^wbraid$/i,
  /^msclkid$/i, /^mc_[ce]id$/i, /^igshid$/i, /^ttclid$/i, /^twclid$/i, /^yclid$/i,
  /^ref$/i, /^referrer$/i, /^s_kwcid$/i, /^vero_id$/i, /^oly_enc_id$/i, /^_openstat$/i,
  /^spm$/i, /^scm$/i, /^share_(source|medium|token)$/i
];

// Schemes that never belong in a backup: local pages, extension internals, and
// anything carrying inline data.
const SKIP_SCHEMES = new Set([
  "chrome:", "chrome-extension:", "moz-extension:", "about:", "edge:", "brave:",
  "view-source:", "data:", "blob:", "javascript:", "file:"
]);

export const DEFAULT_EXCLUDES = [
  "*://*.bank*.*/*",
  "*://mail.google.com/*",
  "*://*.onion/*"
];

/** Glob with `*` only, anchored. Deliberately not regex: these come from a text box. */
export function globToRegExp(glob) {
  const escaped = String(glob).trim().replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
}

export function compileExcludes(patterns) {
  return (patterns || [])
    .map(p => String(p).trim())
    .filter(p => p && !p.startsWith("#"))
    .map(p => {
      try {
        return globToRegExp(p);
      } catch {
        return null; // a malformed pattern must not disable every other one
      }
    })
    .filter(Boolean);
}

function stripUrl(rawUrl, { stripQuery, stripTracking, stripFragment }) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl; // keep unparseable entries verbatim rather than dropping data
  }
  if (stripFragment) u.hash = "";
  if (stripQuery) {
    u.search = "";
  } else if (stripTracking) {
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.some(re => re.test(key))) u.searchParams.delete(key);
    }
  }
  return u.toString();
}

export function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Filter and rewrite history items.
 * Returns the kept items plus a tally, so the UI can say what was dropped
 * instead of silently shrinking the backup.
 */
export function applyPrivacy(items, settings = {}) {
  const {
    excludePatterns = DEFAULT_EXCLUDES,
    stripQuery = false,
    stripTracking = true,
    stripFragment = false,
    excludeIncognitoOnly = true, // informational: the API never returns incognito
    dropTitles = false
  } = settings;

  const excludes = compileExcludes(excludePatterns);
  const stats = { input: items.length, excluded: 0, skippedScheme: 0, kept: 0 };
  const kept = [];

  for (const item of items) {
    const url = item?.url;
    if (!url) continue;

    let scheme = "";
    try {
      scheme = new URL(url).protocol;
    } catch {
      /* keep going; unparseable URLs fall through to the exclude check */
    }
    if (SKIP_SCHEMES.has(scheme)) {
      stats.skippedScheme++;
      continue;
    }
    if (excludes.some(re => re.test(url))) {
      stats.excluded++;
      continue;
    }

    const out = {
      url: stripUrl(url, { stripQuery, stripTracking, stripFragment }),
      lastVisitTime: item.lastVisitTime,
      visitCount: item.visitCount,
      typedCount: item.typedCount
    };
    if (!dropTitles && item.title) out.title = item.title;
    kept.push(out);
  }

  stats.kept = kept.length;
  void excludeIncognitoOnly;
  return { items: kept, stats };
}
