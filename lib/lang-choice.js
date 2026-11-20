'use strict';

/* WHICH LANGUAGE THE APP RUNS IN - one answer for the desktop shell (before its window, desktop/main.js) and the
   server (at its start, lib/i18n.js). Nothing here needs lib/config.js: the shell asks before the library is settled.

   The choice is the library's - `lang` in data/settings.json, 'en' | 'ru' -, so it moves with the library's folder.
     UGC_LANG=en|ru      a stand's or the guide's camera: that language, nothing written
     the saved choice    what Admin -> This computer wrote
     a NEW library       the language of Windows (Russian Windows - Russian, anything else English), written once
     anything else       English - a library made before the choice existed stays as it was until switched

   The switch is open. UGC_LANG_OPEN=0 closes it - for a copy that must stay English: the app runs in English, whatever
   the settings say, and writes nothing. */

const fs = require('fs');
const path = require('path');

const LANGS = ['en', 'ru'];

const norm = (x) => {
  const s = String(x || '').trim().toLowerCase().slice(0, 2);
  return LANGS.includes(s) ? s : '';
};

const open = () => process.env.UGC_LANG_OPEN !== '0';
const forced = () => norm(process.env.UGC_LANG);

/** The language saved in the library's settings, '' when none. */
function saved(root) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(root, 'data', 'settings.json'), 'utf8'));
    return norm(s && s.lang);
  } catch (e) {
    return '';
  }
}

/** A system locale ('ru-RU', 'en-US', 'uk') as the app's language. */
const ofSystem = (locale) => (norm(locale) === 'ru' ? 'ru' : 'en');

/**
 * The language to run in: { lang, save } - `save` is what to write into the settings now ('' - nothing).
 * `isNew` - the library is being made by this start; `system` - the system's locale.
 */
function running({ root, isNew = false, system = '' } = {}) {
  const f = forced();
  if (f) return { lang: f, save: '' };
  if (!open()) return { lang: 'en', save: '' };
  const s = saved(root);
  if (s) return { lang: s, save: '' };
  if (isNew) {
    const l = ofSystem(system);
    return { lang: l, save: l };
  }
  return { lang: 'en', save: '' };
}

/** For the shell before its window: the language it knows for sure, '' - leave Chromium on the system's own. */
function known(root) {
  const f = forced();
  if (f) return f;
  if (!open()) return '';
  return saved(root);
}

module.exports = { LANGS, norm, open, forced, saved, ofSystem, running, known };
