'use strict';

/* THE SERVER'S LANGUAGE - the words of its answers, the Alerts journal's stages, the bot's replies - and the pages'.

   Taken ONCE, at the start (`boot`, server.js): which language is lib/lang-choice.js's answer, the words are the
   pages' own rule, public/js/i18n/t.js, with the dictionaries of public/js/i18n/. A language chosen in Admin is saved
   for the next start (`choose`) - the app restarts to take it - so a running server never changes its words.

   What it gives the pages:
     dictScript()   the classic script every page loads first (GET /api/i18n/dict.js): globalThis.UGC_I18N =
                    { lang, dict } - the dictionary of the running language, nothing for English
     page(file)     a page's markup in the running language, with that script first in <head> (lib/i18n-html.js) */

const fs = require('fs');
const T =require('../public/js/i18n/t.js');
const HTML = require('./i18n-html');
const CHOICE = require('./lang-choice');

const DICTS = {
  ru: () => require('../public/js/i18n/ru.js').default,
};

const SCRIPT = '/api/i18n/dict.js';

let _lang = 'en';
let _dict = {};
let _script = '';
const _pages = new Map();   // file -> { mtimeMs, html }

/** At the start: the language to run in, saved for a new library. Returns it. */
function boot({ root, isNew = false, system = '' } = {}) {
  const pick = CHOICE.running({ root, isNew, system: system || process.env.UGC_SYSTEM_LANG || _systemLocale() });
  _lang = pick.lang;
  _dict = _lang !== 'en' && DICTS[_lang] ? DICTS[_lang]() : {};
  T.setLang(_lang, _dict);
  _script = '';
  _pages.clear();
  if (pick.save) {
    try { require('./settings-io').updateSettings((s) => { s.lang = pick.save; }); } catch (e) { console.warn('[lang] not saved: ' + e.message); }
  }
  return _lang;
}

function _systemLocale() {
  try { return Intl.DateTimeFormat().resolvedOptions().locale || ''; } catch (e) { return ''; }
}

const lang = () => _lang;

/** What Admin shows: the running language, the one saved for the next start, whether the switch is open. */
function state(root) {
  return { lang: _lang, chosen: CHOICE.saved(root) || _lang, langs: CHOICE.LANGS, open: CHOICE.open(), forced: !!CHOICE.forced() };
}

/** Saves the language for the next start. False when the switch is closed. */
function choose(lang) {
  const l = CHOICE.norm(lang);
  if (!l || !CHOICE.open() || CHOICE.forced()) return false;
  require('./settings-io').updateSettings((s) => { s.lang = l; });
  return true;
}

function dictScript() {
  if (!_script) _script = 'globalThis.UGC_I18N = ' + JSON.stringify({ lang: _lang, dict: _dict }) + ';\n';
  return _script;
}

/** A page's markup in the running language - read again when the file changed. */
function page(file) {
  const st = fs.statSync(file);
  const had = _pages.get(file);
  if (had && had.mtimeMs === st.mtimeMs) return had.html;
  const tr = (s, ctx) => { const r = _dict[ctx ? ctx + '::' + s : s]; return typeof r === 'string' ? r : null; };
  const html = HTML.translate(fs.readFileSync(file, 'utf8'), { lang: _lang, tr, script: SCRIPT });
  _pages.set(file, { mtimeMs: st.mtimeMs, html });
  return html;
}

module.exports = { boot, lang, state, choose, dictScript, page, SCRIPT, t: T.t, tc: T.tc, tn: T.tn };
