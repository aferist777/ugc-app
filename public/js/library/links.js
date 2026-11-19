// ════════════════════════════════════════════════════════════════════════════
// CLIPS BY A LINK - what the three places that take one share: the Library's Media
// shelf (main.js), Merge's Library panel (merge-v3/library.js) and the video chat's picker (merge-v3/chat-shell.js).
//
// The server downloads (lib/link-queue.js: one link at a time, the best there is, no login) and files the clip as a
// file brought in there would be; a page only asks for it and follows:
//
//   addLinks(urls, { kind, from, project }) -> [job]       POST /api/links
//   follow(ids, onTick) -> Promise<[job]>                    every second until none waits or runs
//   stopLink(id)                                             POST /api/links/:id/stop
//   linksIn(dataTransfer) -> [url]                           links let go over a page (dragged from a browser)
//   openLinkWindow({ where, prefill, onAdd })                the Library's small window: links, one per line
// ════════════════════════════════════════════════════════════════════════════
import * as Layers from '../layers.js';
// The app's words as T.t: a drag's types are this module's own `t`.
import * as T from '../i18n/t.js';

const URL_RE = /^https?:\/\/\S+$/i;

async function _json(url, init) {
  const r = await fetch(url, init);
  let d = null;
  try { d = await r.json(); } catch (e) { d = null; }
  if (!r.ok || !d || d.success === false) throw new Error((d && d.error) || T.t('the server answered {n}', { n: r.status }));
  return d;
}

/** The links in a text: one per line (or separated by spaces), only what looks like one. */
export function parseLinks(text) {
  return [...new Set(String(text || '').split(/\s+/).map(s => s.trim()).filter(s => URL_RE.test(s)))];
}

export async function addLinks(urls, { kind = '', from = 'media', project = '' } = {}) {
  const d = await _json('/api/links', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, kind, from, project }),
  });
  return d.jobs || [];
}

export function stopLink(id) {
  return _json('/api/links/' + encodeURIComponent(id) + '/stop', { method: 'POST' }).catch(() => null);
}

export const isLive = (j) => j && (j.state === 'waiting' || j.state === 'running');

/** Every second until none of `ids` waits or runs; `onTick(jobs)` after each read. Resolves with the jobs as they ended. */
export async function follow(ids, onTick) {
  const q = '/api/links?ids=' + encodeURIComponent(ids.join(','));
  let jobs = [];
  for (;;) {
    try { jobs = (await _json(q)).jobs || jobs; } catch (e) { /* the next read tries again */ }
    if (typeof onTick === 'function') { try { onTick(jobs); } catch (e) { /* a page gone */ } }
    if (jobs.length && !jobs.some(isLive)) return jobs;
    await new Promise(r => setTimeout(r, 1000));
  }
}

/** yt-dlp's step, short enough for a status line or a place: "40% of 23MB · 0:12 left". */
export function shortStep(step) {
  const s = String(step || '');
  const m = /(\d+)% of ([\d.]+\w+)(?: at [^\s·]+)?(?: · ([\d:]+) left)?/.exec(s);
  if (m) {
    return m[3] && m[3] !== '00:00' ? T.t('{p}% of {size} · {time} left', { p: m[1], size: m[2], time: m[3] })
      : T.t('{p}% of {size}', { p: m[1], size: m[2] });
  }
  return s.replace(/^Downloading · /, '');
}

/** The links of a drop: a browser's address dragged out as text/uri-list, or plain text holding them. */
export function linksIn(dt) {
  if (!dt) return [];
  let text = '';
  try { text = dt.getData('text/uri-list') || dt.getData('text/plain') || ''; } catch (e) { text = ''; }
  return parseLinks(text.split(/\r?\n/).filter(l => !l.startsWith('#')).join('\n'));
}

/** Whether a drag carries text that may be a link (and no files - those are an upload's). */
export function dragHasLink(dt) {
  if (!dt || !dt.types) return false;
  const t = [...dt.types];
  return !t.includes('Files') && (t.includes('text/uri-list') || t.includes('text/plain'));
}

let _win = null;

function _close() {
  if (!_win) return;
  const w = _win;
  _win = null;
  w.ov.remove();
  Layers.close(w.layer);
}

/** The Library's small window: links, one per line, where they land, and "Add". `onAdd(urls)` takes them. */
export function openLinkWindow({ where, prefill, onAdd }) {
  if (_win) { if (prefill) _win.ta.value = [_win.ta.value.trim(), prefill].filter(Boolean).join('\n'); return; }
  const ov = document.createElement('div');
  ov.className = 'mk-ov';
  ov.innerHTML = `
    <div class="mk-panel lk-panel u-win is-float" role="dialog" aria-modal="true">
      <div class="mk-panel-head u-win-head"><span class="mk-panel-t u-win-title">${T.t('Add by a link')}</span><span class="sp"></span>
        <button class="u-btn is-icon is-quiet u-x" type="button" data-x="close" title="${T.t('Close (Esc)')}"></button></div>
      <div class="mk-panel-body">
        <textarea class="lk-ta u-area" rows="5" placeholder="${T.t('One link per line - YouTube, TikTok, Instagram and the other sites yt-dlp reads')}"></textarea>
        <p class="mk-pnote u-status is-line"></p>
      </div>
      <div class="lk-row u-win-foot"><span class="lk-said u-status"></span><span class="sp"></span>
        <button class="u-btn is-main" type="button" data-go="add">${T.t('Add')}</button></div>
    </div>`;
  document.body.appendChild(ov);
  const ta = ov.querySelector('.lk-ta');
  const said = ov.querySelector('.lk-said');
  // The one frame: the note ONE line - its first sentence shown, the whole under the pointer; the
  // last row is the frame's foot (the status line left, "Add" right).
  const note = ov.querySelector('.mk-pnote');
  note.textContent = T.t('Each lands in {place} as a file brought in would, at the best quality there is - one at a time, the progress in the shelf\'s status line.', { place: where || T.t('Uploads') });
  note.title = note.textContent + ' ' + T.t('Without a login: a video a site shows only to signed-in people cannot be fetched - add it as a file then.');
  if (prefill) ta.value = prefill;
  const go = () => {
    const urls = parseLinks(ta.value);
    if (!urls.length) { said.textContent = T.t('No link in it yet.'); return; }
    _close();
    onAdd(urls);
  };
  ov.querySelector('[data-go="add"]').addEventListener('click', go);
  ov.querySelector('[data-x="close"]').addEventListener('click', _close);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) _close(); });
  // Ctrl+Enter adds; Enter is a new line - several links go one per line.
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } });
  const layer = Layers.open(ov, { name: 'add by a link', onEsc: _close });
  _win = { ov, ta, layer };
  setTimeout(() => ta.focus(), 0);
}
