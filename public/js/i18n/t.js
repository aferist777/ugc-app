/* t.js - THE INTERFACE'S WORDS IN THE LANGUAGE THE APP RUNS IN. One rule for the pages and the server: the pages import
   it, the server require()s it (lib/i18n.js), so a word means the same on the screen and in an answer.

   The English text IS the key: the code reads as it always did, English shows exactly what is written, and a text with
   no translation shows in English (tools/i18n.js lists it, and the smoke check fails on it).

     t(text, vars)              'Saved {n} files to {folder}' -> the language's line, {name}s filled from `vars`
     tc(ctx, text, vars)        the same English with another translation in another place - the key is 'ctx::text'
     tn(n, one, other, vars)    a count: English one / other; the dictionary keeps the `other` text's forms as an array
                                in Intl.PluralRules' order for the language (Russian: one, few, many); {n} is filled
     lang()                     'en' | 'ru'

   The language is chosen in Admin -> This computer and taken at the start: the server reads it from the library's
   settings once (lib/i18n.js), and a page gets it with its dictionary from the classic script the server puts first in
   every page's <head> (GET /api/i18n/dict.js sets globalThis.UGC_I18N), so it is there before any module runs. Changing
   it restarts the app. */

export const LANGS = ['en', 'ru'];

let LANG = 'en';
let DICT = {};
let RULES = null;

/** The language and its dictionary - the server's at its start; a page takes the global the dict script left. */
export function setLang(lang, dict) {
  LANG = LANGS.includes(lang) ? lang : 'en';
  DICT = (LANG !== 'en' && dict && typeof dict === 'object') ? dict : {};
  RULES = null;
}

{
  const g = typeof globalThis !== 'undefined' ? globalThis.UGC_I18N : null;
  if (g && typeof g === 'object') setLang(g.lang, g.dict);
}

export const lang = () => LANG;

function fill(s, vars) {
  if (!vars) return s;
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : m));
}

export function t(text, vars) {
  const r = DICT[text];
  return fill(typeof r === 'string' ? r : text, vars);
}

export function tc(ctx, text, vars) {
  const r = DICT[ctx + '::' + text];
  return fill(typeof r === 'string' ? r : text, vars);
}

// Which of the dictionary's forms a count takes: Intl.PluralRules' categories in their order (one, two, few, many),
// 'other' last - for Russian 'other' is a fraction, said as 'few' ("1,5 файла").
const ORDER = { ru: ['one', 'few', 'many'] };
const OTHER = { ru: 'few' };

export function tn(n, one, other, vars) {
  const v = Object.assign({ n }, vars || {});
  const forms = DICT[other];
  if (!Array.isArray(forms) || !forms.length) return fill(+n === 1 ? one : other, v);
  if (!RULES) { try { RULES = new Intl.PluralRules(LANG); } catch { RULES = { select: () => 'other' } } }
  let cat = RULES.select(Math.abs(+n) || 0);
  const order = ORDER[LANG] || ['one', 'other'];
  if (!order.includes(cat)) cat = OTHER[LANG] || order[order.length - 1];
  const i = Math.min(order.indexOf(cat), forms.length - 1);
  return fill(forms[i], v);
}
