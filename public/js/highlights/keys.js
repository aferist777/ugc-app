/* keys.js - A HIGHLIGHTS PROJECT'S TIMELINE KEYS (V91 cleanup block 6, the owner's (чк16): the rule was written in thirteen
   places of the page and the server). The page imports it, the server require()s it, as kinds.js.

   A highlights project <id> has its own timeline `hl_<id>` - its HOME, one line in the picker - and one per fragment n,
   `hl_<id>_<n>` (lib/highlights-store.js). A fragment talks in its home's conversation, keeps its home's links. */

export const KEY_RE = /^hl_([a-z0-9]+)(?:_(\d+))?$/;
export const homeKey = (id) => 'hl_' + id;
export const fragKey = (id, n) => 'hl_' + id + '_' + n;
/** 'hl_<id>' or 'hl_<id>_<n>' -> { id, n } (n 0 for the home); anything else -> null. */
export function parseKey(key) {
  const m = KEY_RE.exec(String(key || ''));
  return m ? { id: m[1], n: m[2] ? Number(m[2]) : 0 } : null;
}
/** Any key of a highlights project. */
export const isHl = (key) => /^hl_/.test(String(key || ''));
/** The project's own timeline - not a fragment's. */
export const isHome = (key) => /^hl_[a-z0-9]+$/.test(String(key || ''));
/** A fragment's key -> its home's; any other key as it is. */
export const homeOf = (key) => String(key || '').replace(/^(hl_[a-z0-9]+)_\d+$/, '$1');
