/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the result window: a render, playable, named, kept, sent.

   One window for every finished render, wherever it came from: straight after Render on
   either editor, or from the queue's "open" on a ready entry.

   LEFT: the video, and under it the file name as it will be saved and sent - one editable
   field - with the "also send to Partner" tick beneath it.
   RIGHT: the name taken apart. Seven fields, one per part of the Meta naming pattern, each
   with its description beside it; they are filled from the project on open (the Scenarios
   project behind the render knows the vertical, the ingredient, the character, the gender,
   and its own title often carries the trigger and the hook id), and joined with `_` into the
   name on the left as they are edited. Editing the full name feeds the parts back when it
   still has seven of them.

   TWO BUTTONS. Save & download names the file in finals/ (renaming it if the name changed),
   keeps it on the Library's renders shelf, downloads it, and - when ticked - sends it to
   Partner. Cancel on a FRESH render deletes the file, as it always did; Cancel on a
   render opened from the queue just closes, because that file was kept on purpose.

   THE NAME IS THE PERSON'S. The pattern is a recommendation for creatives that go to Meta -
   the same string becomes the ad name there - so the hint under the field says whether the
   name follows it, and never stops a save that does not.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';

const SEND_KEY = 'mv3-send-partner';
const TRIGGERS = ['AUTH', 'FEAR', 'FOMO', 'SECRET', 'PROOF', 'DESIRE'];

// The pattern, part by part, in the words of the Partner side.
const PARTS = [
  { id: 'vertical',   label: 'vertical',      desc: 'the niche: MaleEnh · WeightLoss · Prostate', ph: 'MaleEnh' },
  { id: 'ingredient', label: 'Ingredient',    desc: 'the trick/ingredient, e.g. RedHoney, Honey, Beetroot', ph: 'RedHoney' },
  { id: 'angle',      label: 'angleScenario', desc: 'the angle, e.g. ScientistSecret, GirlfriendsStoryTime, BreakingNews', ph: 'ScientistSecret' },
  { id: 'trigger',    label: 'trigger',       desc: 'one of: AUTH · FEAR · FOMO · SECRET · PROOF · DESIRE', select: TRIGGERS },
  { id: 'hook',       label: 'hookid',        desc: 'hook-library id, e.g. H03 (library not built yet — Hxx until then)', ph: 'H03' },
  { id: 'character',  label: 'character',     desc: 'narrator, e.g. DrFauci', ph: 'DrFauci' },
  { id: 'gender',     label: 'gender',        desc: 'M / F', select: ['M', 'F'] },
];
const INTRO = [
  'Use this exact pattern — the same string becomes the Meta Ad name, so stats pull back into the app automatically. Underscore _ is the separator, so never use _ or a space inside a field (use camelCase or a hyphen).',
  'No offer in the name — a creative gets reused across offers, so the offer lives at the campaign level, not here.',
];
const PATTERN = 'vertical_Ingredient_angleScenario_trigger_hookid_character_gender';
const EXAMPLE = 'MaleEnh_RedHoney_ScientistSecret_AUTH_H03_DrFauci_M';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// "red honey" -> "RedHoney"; anything that is not a letter or digit goes, so a part can never
// carry the separator inside it.
function camel(s) {
  const words = String(s || '').replace(/[^A-Za-z0-9Ѐ-ӿ]+/g, ' ').trim().split(' ').filter(Boolean);
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

// What the name says against the pattern. Never a refusal - a reading.
function check(name) {
  const n = String(name || '').trim();
  if (!n) return { ok: false, text: 'a name is needed' };
  if (/\s/.test(n)) return { ok: false, text: 'recommendation: no spaces - join words as camelCase or with a hyphen' };
  const parts = n.split('_');
  if (parts.length !== 7) return { ok: false, text: `recommendation: 7 parts joined by _ (this has ${parts.length})` };
  if (parts.some(p => !p)) return { ok: false, text: 'recommendation: no empty part between the underscores' };
  if (!TRIGGERS.includes(parts[3])) return { ok: false, text: `recommendation: part 4 is the trigger - one of ${TRIGGERS.join(' · ')}` };
  if (!/^H(\d{2,}|xx)$/i.test(parts[4])) return { ok: false, text: 'recommendation: part 5 is the hook id - H03, or Hxx until the library exists' };
  if (!/^[MF]$/.test(parts[6])) return { ok: false, text: 'recommendation: part 7 is the gender - M or F' };
  return { ok: true, text: 'follows the pattern' + (/^Hxx$/i.test(parts[4]) ? ' · fill in the hook id when the library exists' : '') };
}

// What the project already knows about the name. The Scenarios project behind an sv3_ key has
// the vertical, the product (the ingredient), the cast character and the gender; its title,
// written by hand in this house style ("… - Secret Ingredient - AUTH - H01 - Nancy - F"),
// often carries the angle, the trigger and the hook id as well. Anything unknown stays a
// placeholder in capitals, to be replaced.
async function partsFromProject(key, title) {
  const out = { vertical: '', ingredient: '', angle: '', trigger: '', hook: '', character: '', gender: '' };
  const m = /^sv3_(\d+)/.exec(String(key || ''));
  let p = {};
  if (m) {
    try { const d = await fetch('/api/scen3/projects/' + encodeURIComponent(m[1])).then(r => r.json()); p = (d && d.project) || {}; }
    catch (e) { p = {}; }
  }
  out.vertical = camel(p.vertical);
  out.ingredient = camel(p.product);
  out.character = camel(p.casting && p.casting.characterName);
  out.gender = /^f/i.test(p.gender || '') ? 'F' : /^m/i.test(p.gender || '') ? 'M' : '';

  const tokens = String(p.name || title || '').split(/\s+[-—–]\s+/).map(t => t.trim()).filter(Boolean);
  const ti = tokens.findIndex(t => TRIGGERS.includes(t.toUpperCase()));
  if (ti >= 0) {
    out.trigger = tokens[ti].toUpperCase();
    if (ti > 0 && !/^\d/.test(tokens[ti - 1])) out.angle = camel(tokens[ti - 1]);
  }
  const hk = tokens.find(t => /^H\d{2,}$/i.test(t));
  if (hk) out.hook = hk.toUpperCase();
  const last = tokens[tokens.length - 1];
  if (/^[MF]$/i.test(last || '')) {
    out.gender = out.gender || last.toUpperCase();
    if (!out.character && tokens.length >= 2) out.character = camel(tokens[tokens.length - 2]);
  }
  return out;
}

// ── the window ──────────────────────────────────────────────────────────────
let _ov = null;
function close() { if (_ov) { _ov.remove(); _ov = null; } document.removeEventListener('keydown', _key); }
function _key(e) { if (e.key === 'Escape') close(); }

/**
 * @param {object} o  { url, title, key, queueId?, sent?, fresh }
 *   fresh   true straight after a render: Cancel deletes the file. From the queue: false.
 */
export async function showResult(o) {
  close();
  const state = { url: o.url, queueId: o.queueId || null, sent: o.sent || null, fresh: !!o.fresh, saved: !o.fresh };

  // A fresh render is filed into the queue first, so it can be found again after this
  // window closes. Not fatal if that fails - the file is still on disk.
  if (o.fresh && !state.queueId) {
    try {
      const d = await fetch('/api/mv3/render/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: o.url, key: o.key || Store.key(), title: o.title || Store.title(), kind: Store.isBlank() ? 'blank' : 'talking', dur: Store.duration() }),
      }).then(r => r.json());
      if (d && d.success) state.queueId = d.queueId;
    } catch (e) {}
  }

  const ov = el('div', 'mv3-x-ov');
  const box = el('div', 'mv3-x is-result is-wide');
  box.dataset.auditScope = 'Render result';
  const head = el('div', 'mv3-x-head');
  head.appendChild(el('h3', null, o.fresh ? 'Render finished' : (o.title || 'Render')));
  const x = el('button', 'mv3-x-close', '✕'); x.type = 'button'; x.title = 'Close (Esc)';
  head.appendChild(x);
  box.appendChild(head);

  const body = el('div', 'mv3-rr');

  // ── left: the video, the name, the tick ──
  const left = el('div', 'mv3-rr-left');
  const vwrap = el('div', 'mv3-rr-video');
  const v = document.createElement('video');
  v.src = o.url; v.controls = true; v.autoplay = !!o.fresh; v.playsInline = true; v.preload = 'metadata';
  vwrap.appendChild(v);
  left.appendChild(vwrap);
  left.appendChild(el('div', 'mv3-rr-l', 'File name'));
  const name = document.createElement('input');
  name.type = 'text'; name.className = 'mv3-rr-name'; name.maxLength = 160; name.spellcheck = false; name.autocomplete = 'off';
  name.dataset.audit = 'Render name';
  left.appendChild(name);
  const hint = el('div', 'mv3-rr-hint');
  left.appendChild(hint);
  const tick = el('label', 'mv3-rr-check');
  const cb = document.createElement('input'); cb.type = 'checkbox';
  let remembered = '1';
  try { remembered = localStorage.getItem(SEND_KEY) || '1'; } catch (e) {}
  cb.checked = remembered !== '0';
  cb.addEventListener('change', () => { try { localStorage.setItem(SEND_KEY, cb.checked ? '1' : '0'); } catch (e) {} });
  tick.appendChild(cb); tick.appendChild(document.createTextNode(' also send to Partner'));
  left.appendChild(tick);
  const sentLine = el('div', 'mv3-rr-sent');
  left.appendChild(sentLine);
  body.appendChild(left);

  // ── right: the name taken apart ──
  const side = el('div', 'mv3-rr-side');
  side.appendChild(el('div', 'mv3-rr-l', 'Naming — recommended for Meta'));
  for (const t of INTRO) side.appendChild(el('p', 'mv3-rr-intro', t));
  side.appendChild(el('code', 'mv3-rr-pat', PATTERN));
  side.appendChild(el('code', 'mv3-rr-pat is-ex', 'e.g. ' + EXAMPLE));
  const fields = {};
  PARTS.forEach((p, i) => {
    const row = el('div', 'mv3-rr-row');
    row.appendChild(el('label', 'mv3-rr-rl', (i + 1) + '. ' + p.label));
    let f;
    if (p.select) {
      f = document.createElement('select');
      f.className = 'mv3-rr-rf';
      const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '—'; f.appendChild(o0);
      for (const v of p.select) { const oo = document.createElement('option'); oo.value = v; oo.textContent = v; f.appendChild(oo); }
    } else {
      f = document.createElement('input');
      f.type = 'text'; f.className = 'mv3-rr-rf'; f.placeholder = p.ph || ''; f.spellcheck = false; f.autocomplete = 'off'; f.maxLength = 60;
    }
    f.dataset.audit = 'Name part: ' + p.label;
    row.appendChild(f);
    row.appendChild(el('div', 'mv3-rr-rd', p.desc));
    side.appendChild(row);
    fields[p.id] = f;
  });
  const refill = el('button', 'mv3-c-btn mv3-rr-refill', 'Fill from the project again'); refill.type = 'button';
  side.appendChild(refill);
  body.appendChild(side);
  box.appendChild(body);

  // ── keeping the two sides in step ──
  const paintHint = () => { const c = check(name.value); hint.textContent = c.text; hint.className = 'mv3-rr-hint' + (c.ok ? ' ok' : ''); };
  // A part is a word with no separator in it: underscores go as they are typed; on leaving
  // the field the words are joined camelCase, the way the pattern asks.
  const compose = () => {
    name.value = PARTS.map(p => {
      const f = fields[p.id];
      const raw = String(f.value || '').replace(/_/g, '');
      return raw || (p.select ? (p.id === 'trigger' ? 'TRIGGER' : 'M') : (p.id === 'hook' ? 'Hxx' : p.label.charAt(0).toUpperCase() + p.label.slice(1)));
    }).join('_');
    paintHint();
  };
  const decompose = () => {
    const parts = name.value.trim().split('_');
    if (parts.length !== 7) return;
    PARTS.forEach((p, i) => { const f = fields[p.id]; if (p.select) { f.value = p.select.includes(parts[i].toUpperCase()) ? parts[i].toUpperCase() : ''; } else f.value = parts[i]; });
  };
  for (const p of PARTS) {
    const f = fields[p.id];
    f.addEventListener('input', compose);
    f.addEventListener('change', compose);
    if (!p.select) f.addEventListener('blur', () => { const c = camel(f.value); if (c && c !== f.value) { f.value = p.id === 'hook' ? c.toUpperCase() : c; compose(); } });
  }
  name.addEventListener('input', () => { decompose(); paintHint(); });

  const fill = async () => {
    const got = await partsFromProject(o.key || Store.key(), o.title || Store.title());
    for (const p of PARTS) fields[p.id].value = got[p.id] || '';
    compose();
  };
  refill.addEventListener('click', async () => { refill.disabled = true; try { await fill(); } finally { refill.disabled = false; } });

  const paintSent = () => {
    sentLine.textContent = '';
    if (!state.sent) { sentLine.hidden = true; return; }
    sentLine.hidden = false;
    sentLine.appendChild(document.createTextNode('sent to Partner → creative #' + state.sent.creativeId + ' '));
    if (state.sent.url) { const a = el('a', null, 'open'); a.href = state.sent.url; a.target = '_blank'; a.rel = 'noopener'; sentLine.appendChild(a); }
  };
  paintSent();

  // ── the foot ──
  const foot = el('div', 'mv3-x-foot');
  const note = el('span', 'mv3-x-prog', '');
  const cancel = el('button', 'mv3-c-btn' + (o.fresh ? ' danger' : ''), o.fresh ? 'Cancel' : 'Close'); cancel.type = 'button';
  if (o.fresh) cancel.title = 'Delete this render';
  const again = el('button', 'mv3-c-btn', 'Send again'); again.type = 'button'; again.hidden = true;
  const save = el('button', 'mv3-c-btn mv3-x-go', 'Save & download'); save.type = 'button';
  foot.appendChild(note); foot.appendChild(cancel); foot.appendChild(again); foot.appendChild(save);
  box.appendChild(foot);

  const release = () => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} };
  const download = (url) => {
    const a = document.createElement('a');
    a.href = url; a.download = decodeURIComponent(String(url).split('/').pop());
    document.body.appendChild(a); a.click(); a.remove();
  };
  const say = (text, cls) => { note.textContent = text; note.className = 'mv3-x-prog' + (cls ? ' ' + cls : ''); };

  cancel.addEventListener('click', async () => {
    if (!state.fresh || state.saved) { close(); return; }
    cancel.disabled = true; save.disabled = true;
    release();     // Windows will not unlink a file a <video> still holds
    try {
      await fetch('/api/mv3/render/discard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: state.url, queueId: state.queueId }) });
    } catch (e) {}
    close();
  });

  save.addEventListener('click', async () => {
    const want = name.value.trim();
    if (!want) { say('a name is needed', 'is-bad'); name.focus(); return; }
    save.disabled = true; cancel.disabled = true; again.hidden = true;
    say('saving…');
    release();     // the file may be renamed underneath the player
    try {
      const d = await fetch('/api/mv3/render/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: state.url, name: want, send: cb.checked, queueId: state.queueId, key: o.key || Store.key() }),
      }).then(r => r.json());
      if (!d || !d.success) throw new Error((d && d.error) || 'could not save');
      state.url = d.url; state.saved = true; state.fresh = false;
      if (d.sent) state.sent = d.sent;
      v.src = state.url;
      download(state.url);
      paintSent();
      const bits = ['saved as ' + decodeURIComponent(String(d.url).split('/').pop()), 'on the Library renders shelf'];
      if (d.sent) bits.push('sent to Partner');
      if (d.sendError) { bits.push('Partner: ' + d.sendError); again.hidden = false; }
      say(bits.join(' · '), d.sendError ? 'is-bad' : 'is-good');
      cancel.textContent = 'Close'; cancel.classList.remove('danger'); cancel.title = '';
    } catch (e) {
      say(e.message, 'is-bad');
    } finally {
      save.disabled = false; cancel.disabled = false;
    }
  });

  again.addEventListener('click', async () => {
    again.disabled = true; say('sending…');
    try {
      const d = await fetch('/api/mv3/render/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: state.url, name: name.value.trim(), queueId: state.queueId, key: o.key || Store.key() }),
      }).then(r => r.json());
      if (!d || !d.success) throw new Error((d && d.error) || 'not sent');
      state.sent = d.sent; paintSent(); again.hidden = true;
      say('sent to Partner', 'is-good');
    } catch (e) { say(e.message, 'is-bad'); }
    finally { again.disabled = false; }
  });

  x.addEventListener('click', () => { if (state.fresh && !state.saved) cancel.click(); else close(); });
  ov.addEventListener('mousedown', (e) => { if (e.target === ov && !(state.fresh && !state.saved)) close(); });
  ov.appendChild(box);
  document.body.appendChild(ov);
  _ov = ov;
  document.addEventListener('keydown', _key);

  // The name on open: a file already named keeps its name and shows it taken apart; a fresh
  // render gets the parts from the project and the name they compose.
  const current = decodeURIComponent(String(o.url || '').split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
  if (!o.fresh && current.split('_').length === 7) { name.value = current; decompose(); paintHint(); }
  else if (!o.fresh) { name.value = current; paintHint(); await fill().then(() => { name.value = current; paintHint(); }); }
  else await fill();
}
