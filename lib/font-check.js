'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CAPTIONS — did the render draw them in the fonts it was asked for?
//
// libass does not fail when a font is missing: it draws the caption in Arial and says so only in the
// log - `fontselect: (Montserrat Black, 400, 0) -> ArialMT, 0, ArialMT` - and a font without some letter
// borrows that letter from Arial in the middle of a word: `Glyph 0x41F not found, selecting one more
// font for (Anton, 400, 0)`. Both lines are at ffmpeg's default level. The render routes feed every
// chunk of stderr through here and add what was found to the render's warnings, so a caption that came
// out in the wrong font is said, not discovered.
// ════════════════════════════════════════════════════════════════════════════

const I18N = require('./i18n');

const _key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');

function watcher() {
  let buf = '';
  const swapped = new Map();       // asked -> got
  const short = new Set();         // fonts that lacked a letter
  // A font that lacks a letter makes libass look for ANOTHER font for it, and that search logs a
  // fontselect line of its own: the line after a "Glyph ... not found" for the same font is that
  // borrowing, not the font being swapped.
  let borrowing = '';
  const line = (l) => {
    let m = /fontselect: \((.+?), (\d+), (\d+)\) -> ([^,]+),/.exec(l);
    if (m) {
      const asked = m[1].trim(), got = m[4].trim(), triple = asked + '|' + m[2] + '|' + m[3];
      if (borrowing === triple) { borrowing = ''; return; }
      // "Montserrat Black" is drawn by Montserrat-Black, "Liberation Sans" by LiberationSans-Bold.
      if (!_key(got).startsWith(_key(asked))) swapped.set(asked, got);
      return;
    }
    m = /Glyph 0x[0-9A-Fa-f]+ not found, selecting one more font for \((.+?), (\d+), (\d+)\)/.exec(l);
    if (m) { short.add(m[1].trim()); borrowing = m[1].trim() + '|' + m[2] + '|' + m[3]; }
  };
  return {
    feed(chunk) {
      buf += String(chunk || '');
      const parts = buf.split(/\r?\n|\r/);
      buf = parts.pop();
      for (const l of parts) line(l);
      if (buf.length > 4096) { line(buf); buf = ''; }
    },
    warnings() {
      if (buf) { line(buf); buf = ''; }
      const out = [];
      // Said to the person with the render's warnings, in the interface's language.
      for (const [asked, got] of swapped) out.push(I18N.t('captions: the font "{asked}" was not found and {got} was used instead', { asked, got }));
      for (const f of short) if (!swapped.has(f)) out.push(I18N.t('captions: "{font}" lacks some letters of the text - they were drawn in another font', { font: f }));
      return out;
    },
  };
}

module.exports = { watcher };
