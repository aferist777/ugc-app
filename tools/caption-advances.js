'use strict';

/* caption-advances.js - writes public/js/captions/advances.js: how wide every letter of every caption
   font is, read from the font files themselves (phase K2).

   Run it by hand when a font in public/fonts/captions/ is added, removed or replaced:
       node tools/caption-advances.js            writes the table
       node tools/caption-advances.js --check    says whether the table still matches the files (exit 1 if not)

   Why from the files: a page is cut to a width (0.78 of the frame), and the old per-font average of a
   capital and a lowercase letter was a Latin estimate - it read Cyrillic 11-20% narrow against what
   libass draws. The sum of the letters' own advances matches libass within ~2% (it does no kerning).

   What is read: the font's units per em, the 'hmtx' advance of the glyph each character maps to through
   the Windows Unicode 'cmap' (format 4), and the line height libass scales the .ass Fontsize to -
   (OS/2 winAscent + winDescent) / unitsPerEm, which must equal fonts.js `line`. An advance is written in
   thousandths of an em; a character the font has no glyph for is written 0 (it is drawn, and measured,
   in PT Sans). */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'public', 'fonts', 'captions');
const OUT = path.join(ROOT, 'public', 'js', 'captions', 'advances.js');

// The characters measured: printable ASCII, the Russian and Ukrainian alphabets, and what Russian text
// and the heard words bring with them. Anything else is measured by its base letter or an average
// (measure.js).
const CHARS = (() => {
  let s = '';
  for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c);
  for (let c = 0x410; c <= 0x44f; c++) s += String.fromCharCode(c);
  s += 'ЁёІіЇїЄєҐґ';
  s += '«»…—–№₽“”„‘’€£°•·×‰¿¡';
  return s;
})();

function parse(file) {
  const b = fs.readFileSync(file);
  const n = b.readUInt16BE(4);
  const T = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    T[b.toString('latin1', o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) };
  }
  for (const t of ['head', 'hhea', 'hmtx', 'cmap', 'OS/2']) if (!T[t]) throw new Error(path.basename(file) + ': no ' + t + ' table');
  const upem = b.readUInt16BE(T.head.off + 18);
  const nh = b.readUInt16BE(T.hhea.off + 34);
  const os2 = T['OS/2'].off;
  const line = (b.readUInt16BE(os2 + 74) + b.readUInt16BE(os2 + 76)) / upem;
  const adv = (g) => b.readUInt16BE(T.hmtx.off + 4 * Math.min(g, nh - 1));
  // cmap: the Windows Unicode BMP subtable, format 4
  const cm = T.cmap.off;
  let sub = null;
  for (let i = 0, nt = b.readUInt16BE(cm + 2); i < nt; i++) {
    const p = b.readUInt16BE(cm + 4 + i * 8), e = b.readUInt16BE(cm + 6 + i * 8), o = b.readUInt32BE(cm + 8 + i * 8);
    if (p === 3 && e === 1 && b.readUInt16BE(cm + o) === 4) sub = cm + o;
  }
  if (sub == null) throw new Error(path.basename(file) + ': no Unicode cmap (3,1,4)');
  const segX2 = b.readUInt16BE(sub + 6);
  const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ros = deltas + segX2;
  const gid = (cp) => {
    for (let i = 0; i < segX2 / 2; i++) {
      if (cp > b.readUInt16BE(ends + 2 * i)) continue;
      const s = b.readUInt16BE(starts + 2 * i);
      if (cp < s) return 0;
      const d = b.readInt16BE(deltas + 2 * i), ro = b.readUInt16BE(ros + 2 * i);
      if (!ro) return (cp + d) & 0xffff;
      const g = b.readUInt16BE(ros + 2 * i + ro + 2 * (cp - s));
      return g ? (g + d) & 0xffff : 0;
    }
    return 0;
  };
  const per = [...CHARS].map((ch) => {
    const g = gid(ch.codePointAt(0));
    return g ? Math.round(adv(g) / upem * 1000) : 0;
  });
  return { line, per };
}

async function main() {
  const { FONTS } = await import('../public/js/captions/fonts.js');
  const files = [...new Set(FONTS.flatMap((f) => Object.values(f.files)))];
  const table = {};
  for (const f of FONTS) {
    for (const file of Object.values(f.files)) {
      const r = parse(path.join(DIR, file));
      if (Math.abs(r.line - f.line) > 0.0015) throw new Error(file + ': line ' + r.line.toFixed(3) + ', fonts.js says ' + f.line);
      table[file] = r.per.join(',');
    }
  }
  const on = fs.readdirSync(DIR).filter((x) => /\.ttf$/i.test(x));
  const stray = on.filter((x) => !files.includes(x));
  if (stray.length) console.warn('Not in fonts.js, not measured: ' + stray.join(', '));

  const text = '/* ═══════════════════════════════════════════════════════════════════════════\n'
    + '   CAPTIONS — how wide each letter is, in thousandths of an em, read from the font files (phase K2).\n\n'
    + '   MADE BY tools/caption-advances.js - not edited by hand. Run it again when a font changes; the K2 stand\n'
    + '   checks the table against the files. 0 is a character the font has no glyph for (drawn in PT Sans).\n'
    + '   ═══════════════════════════════════════════════════════════════════════════ */\n\n'
    + 'export const CHARS = ' + JSON.stringify(CHARS) + ';\n\n'
    + 'export const ADVANCES = {\n'
    + Object.keys(table).map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(table[k]) + ',').join('\n')
    + '\n};\n';

  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now.replace(/\r/g, '') === text) { console.log('advances.js matches the ' + files.length + ' font files.'); return; }
    console.error('advances.js does not match the font files - run node tools/caption-advances.js');
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(OUT, text);
  console.log('Wrote ' + path.relative(ROOT, OUT) + ': ' + files.length + ' files x ' + [...CHARS].length + ' characters, ' + text.length + ' bytes.');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
