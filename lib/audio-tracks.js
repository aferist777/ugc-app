'use strict';

/* audio-tracks.js - the sound tracks of a video file. A film downloaded as an .mkv often carries several - a dub, the original, a commentary -, and a highlights project
   hears and cuts ONE of them: the popup offers the choice when there is one, the first (or the one marked default) chosen.

   tracksOf(abs) -> [{ k (0, 1, ... - its place among the AUDIO streams: ffmpeg's 0:a:k), lang, title, codec, channels, def }]
   label(t)      -> "Russian · rus · 5.1" - what the popup shows
   firstOf(list) -> the k a choice not made takes: the default-marked one, else the first */

const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const I18N = require('./i18n');

function _stderr(abs) {
  return new Promise((resolve) => {
    let out = '';
    let p;
    try { p = spawn(ffmpegPath, ['-hide_banner', '-i', String(abs)], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); }
    catch (e) { resolve(''); return; }
    p.stderr.on('data', (c) => { out += c.toString(); if (out.length > 200000) { try { p.kill(); } catch (e) { /* gone */ } } });
    p.on('error', () => resolve(out));
    p.on('close', () => resolve(out));
  });
}

/** The file's sound tracks, in their order. [] when it has none or cannot be read. */
async function tracksOf(abs) {
  const text = await _stderr(abs);
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*Stream #\d+:\d+(?:\[[^\]]*\])?(?:\(([a-z]{2,3})\))?:\s*Audio:\s*([^,\s]+)[^\n]*?(mono|stereo|[0-9.]+(?:\([a-z]+\))?)?(?:,|$)/i.exec(lines[i]);
    if (!m) continue;
    const ch = /,\s*(mono|stereo|\d\.\d(?:\([a-z]+\))?|\d+ channels)\s*,/i.exec(lines[i]);
    let title = '';
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
      if (/^\s*Stream #/.test(lines[j])) break;
      const t = /^\s*title\s*:\s*(.+)$/i.exec(lines[j]);
      if (t) { title = t[1].trim(); break; }
    }
    out.push({ k: out.length, lang: (m[1] || '').toLowerCase(), title: title.slice(0, 60), codec: m[2], channels: ch ? ch[1].replace(/\(.*\)$/, '') : '',
      def: /\(default\)/.test(lines[i]) });
  }
  return out;
}

const label = (t) => [t.title, t.lang, t.channels].filter(Boolean).join(' · ') || I18N.t('track {n}', { n: t.k + 1 });
/** The track a choice not made takes: the one marked default, else the first. */
const firstOf = (list) => { const d = (list || []).find((t) => t.def); return d ? d.k : 0; };

module.exports = { tracksOf, label, firstOf };
