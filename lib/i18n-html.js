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

// Calls `fn(text)` for every piece a person reads; what it returns (a string) takes the piece's place.
function walk(html, fn) {
  const doPart = (part) => part
    .replace(/<[a-z][^>]*>/gi, (tag) => tag.replace(ATTRS, (m, sp, name, eq, val) => {
      const r = fn(decode(val));
      return typeof r === 'string' ? `${sp}${name}${eq}"${escAttr(r)}"` : m;
    }))
    .replace(/>([^<]+)</g, (m, raw) => {
      const text = decode(raw).trim();
      if (!text || !/\p{L}/u.test(text)) return m;
      const r = fn(text);
      if (typeof r !== 'string') return m;
      const lead = /^\s*/.exec(raw)[0], tail = /\s*$/.exec(raw)[0];
      return '>' + lead + escText(r) + tail + '<';
    });
  let out = '', at = 0;
  for (const m of html.matchAll(KEEP)) {
    out += doPart(html.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + doPart(html.slice(at));
}

/** Every text a person reads in a page's markup. */
function texts(html) {
  const out = [];
  walk(html, (s) => { if (s.trim()) out.push(s.trim()); });
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
  if (lang !== 'en' && typeof tr === 'function') out = walk(out, (s) => tr(s));
  return out;
}

module.exports = { walk, texts, translate, decode };
