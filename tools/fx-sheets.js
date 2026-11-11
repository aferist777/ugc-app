'use strict';

/* fx-sheets.js - the two sheets of effect tiles the agent LOOKS AT when it lays effects (phase V90, the owner 2026-11-11, (аэ6):
   "можно еще отправлять два собранных изображения (собрать из превью эффектов чтобы агент видел какие эффекты у нас уже есть)";
   docs/local-app/plan/, "Подфаза 5 — V90: подробный план", block 1).

   From the panel's tiles (public/fx-tiles/<key>.webp - tools/fx-tiles.js) of every effect the agent may lay (public/js/fx/auto.js
   AGENT_KEYS - the table's order, no Face mosaic), two JPEGs public/fx-tiles/agent-1.jpg and agent-2.jpg: six tiles a row, each with
   its KEY under it in large letters and its name smaller - the key is what the agent answers with; and agent-sheets.json saying
   which keys are on which sheet and what they were made from (lib/fx-auto.js tells the agent "sheet 1: ...").

   Run it by hand when an effect is added or its tile made again (after tools/fx-tiles.js):
       node tools/fx-sheets.js            makes both sheets
       node tools/fx-sheets.js --check    says whether every effect the agent may lay is on a sheet, made from its tile as it is now
   An effect missing from the sheets is still offered to the agent - by its words alone - and lib/fx-auto.js says so in the log. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

sharp.cache(false);

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'public', 'fx-tiles');
const INDEX = path.join(DIR, 'agent-sheets.json');
// What a sheet is - every number here is part of what agent-sheets.json records.
const SHEET = { cols: 6, tile: 240, label: 46, gap: 8, bg: '#16181d', ink: '#ffffff', faint: '#b8bcc6', quality: 86, version: 1 };

const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 16);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function main() {
  const A = await import('../public/js/fx/auto.js');
  const E = await import('../public/js/fx/effects.js');
  const keys = A.AGENT_KEYS.slice();
  const half = Math.ceil(keys.length / 2);
  const parts = [keys.slice(0, half), keys.slice(half)];
  const prints = {};
  for (const k of keys) {
    const f = path.join(DIR, k + '.webp');
    prints[k] = fs.existsSync(f) ? sha(fs.readFileSync(f)) : null;
  }
  const want = { v: SHEET.version, sheet: SHEET, sheets: parts.map((p, i) => ({ file: 'agent-' + (i + 1) + '.jpg', keys: p })), prints };

  if (process.argv.includes('--check')) {
    let had = null;
    try { had = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch (e) { had = null; }
    const bad = [];
    if (!had) bad.push('no agent-sheets.json - run node tools/fx-sheets.js');
    else {
      const on = new Set((had.sheets || []).flatMap((s) => s.keys || []));
      for (const k of keys) {
        if (!on.has(k)) bad.push(k + ': not on a sheet');
        else if (!prints[k]) bad.push(k + ': has no tile (tools/fx-tiles.js)');
        else if ((had.prints || {})[k] !== prints[k]) bad.push(k + ': its tile changed since the sheets were made');
      }
      for (const s of had.sheets || []) if (!fs.existsSync(path.join(DIR, s.file))) bad.push(s.file + ' is not there');
      if (JSON.stringify(had.sheet) !== JSON.stringify(SHEET)) bad.push('the sheets were made by another layout');
    }
    if (bad.length) { console.log('fx-sheets: ' + bad.length + ' to make again:\n  ' + bad.join('\n  ')); process.exit(1); }
    console.log('fx-sheets: ' + keys.length + ' effects on 2 sheets, all as their tiles are now');
    return;
  }

  const cellW = SHEET.tile, cellH = SHEET.tile + SHEET.label;
  for (const s of want.sheets) {
    const rows = Math.ceil(s.keys.length / SHEET.cols);
    const W = SHEET.cols * cellW + (SHEET.cols + 1) * SHEET.gap;
    const H = rows * cellH + (rows + 1) * SHEET.gap;
    const layers = [];
    let svg = '';
    s.keys.forEach((k, i) => {
      const x = SHEET.gap + (i % SHEET.cols) * (cellW + SHEET.gap);
      const y = SHEET.gap + Math.floor(i / SHEET.cols) * (cellH + SHEET.gap);
      const f = path.join(DIR, k + '.webp');
      if (fs.existsSync(f)) layers.push({ input: f, left: x, top: y });
      const name = (E.EFFECTS[k] || {}).name || k;
      svg += `<text x="${x + cellW / 2}" y="${y + SHEET.tile + 22}" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="700" fill="${SHEET.ink}" text-anchor="middle">${esc(k)}</text>`
        + `<text x="${x + cellW / 2}" y="${y + SHEET.tile + 40}" font-family="Arial, Helvetica, sans-serif" font-size="14" fill="${SHEET.faint}" text-anchor="middle">${esc(name)}</text>`;
    });
    // Tiles of a size other than the cell's are fitted to it first.
    for (const l of layers) {
      const m = await sharp(l.input).metadata();
      if (m.width !== SHEET.tile || m.height !== SHEET.tile) l.input = await sharp(l.input).resize(SHEET.tile, SHEET.tile, { fit: 'cover' }).png().toBuffer();
    }
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`), left: 0, top: 0 });
    const out = path.join(DIR, s.file);
    await sharp({ create: { width: W, height: H, channels: 3, background: SHEET.bg } }).composite(layers).jpeg({ quality: SHEET.quality }).toFile(out);
    console.log(s.file + ': ' + s.keys.length + ' effects, ' + W + 'x' + H + ', ' + Math.round(fs.statSync(out).size / 1024) + ' KB');
  }
  const missing = keys.filter((k) => !prints[k]);
  if (missing.length) console.log('no tile yet (drawn as an empty cell): ' + missing.join(', '));
  fs.writeFileSync(INDEX, JSON.stringify(want, null, 1) + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
