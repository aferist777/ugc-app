'use strict';

/* A PAGE'S OWN MARKUP IN THE APP'S LANGUAGE - the five pages (public/*.html) are sent translated by the server
   (lib/i18n.js `page`), so nothing English flashes before the modules run. One walk for the server and the check
   (tools/i18n.js): the text between tags and the attributes a person reads (title, placeholder, aria-label, alt);
   <script>, <style> and comments are left as they are. A text is matched as the person reads it - entities decoded,
   the spaces round it kept. */

const ATTRS = /(\s)(title|placeholder|aria-label|alt)(\s*=\s*)"([^"]*)"/gi;
const KEEP = /<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', middot: '·', hellip: '…', mdash: '—', ndash: '–', larr: '←', rarr: '→', times: '×' };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }
  return Object.prototype.hasOwnProperty.call(NAMED, e.toLowerCase()) ? NAMED[e.toLowerCase()] : m;
});
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

// Calls `fn(text, ctx)` for every piece a person reads; what it returns (a string) takes the piece's place. `ctx` - the
// `data-tc` of the tag the text follows: the same English with another translation there (t.js tc - 'ctx::text').
const CTX = /\sdata-tc\s*=\s*"([^"]*)"/i;
function walk(html, fn) {
  const doPart = (part) => part.replace(/(<[^>]+>)([^<]*)/g, (m, tag, raw) => {
    const t2 = /^<[a-z]/i.test(tag) ? tag.replace(ATTRS, (a, sp, name, eq, val) => {
      const r = fn(decode(val), '');
      return typeof r === 'string' ? `${sp}${name}${eq}"${escAttr(r)}"` : a;
    }) : tag;
    const text = decode(raw).trim();
    if (!text || !/\p{L}/u.test(text)) return t2 + raw;
    const ctx = /^<[a-z]/i.test(tag) ? ((CTX.exec(tag) || [])[1] || '') : '';
    const r = fn(text, ctx);
    if (typeof r !== 'string') return t2 + raw;
    const lead = /^\s*/.exec(raw)[0], tail = /\s*$/.exec(raw)[0];
    return t2 + lead + escText(r) + tail;
  });
  let out = '', at = 0;
  for (const m of html.matchAll(KEEP)) {
    out += doPart(html.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + doPart(html.slice(at));
}

/** Every text a person reads in a page's markup - as its dictionary key ('ctx::text' under a `data-tc`). */
function texts(html) {
  const out = [];
  walk(html, (s, ctx) => { if (s.trim()) out.push(ctx ? ctx + '::' + s.trim() : s.trim()); });
  return out;
}

/**
 * The page in `lang`: `<html lang>` set, the dictionary's script put first in <head> (`script` - its address), and,
 * for a language other than English, each piece `tr(text)` knows replaced.
 */
function translate(html, { lang = 'en', tr = null, script = '' } = {}) {
  let out = String(html).replace(/<html\b([^>]*)>/i, (m, attrs) => {
    const rest = attrs.replace(/\s+lang\s*=\s*"[^"]*"/i, '');
    return `<html lang="${lang}"${rest}>`;
  });
  if (script) {
    // after the charset, which a page keeps first; else first in <head>
    const tag = `\n<script src="${script}"></script>`;
    out = /<meta\s+charset[^>]*>/i.test(out) ? out.replace(/<meta\s+charset[^>]*>/i, (m) => m + tag) : out.replace(/<head\b[^>]*>/i, (m) => m + tag);
  }
  if (lang !== 'en' && typeof tr === 'function') out = walk(out, (s, ctx) => tr(s, ctx));
  return out;
}

module.exports = { walk, texts, translate, decode };
