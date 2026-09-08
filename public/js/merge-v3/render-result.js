/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the result window: a render, playable, named, kept, sent.

   One window for every finished render, wherever it came from: straight after Render on
   either editor, or from the queue's "open" on a ready entry. The video on the left; on the
   right the name it will be saved and sent under, a Draft button that fills the name from
   the project, the naming guide, and the "also send to Partner" tick.

   TWO BUTTONS. Save & download names the file in finals/ (renaming it if the name changed),
   keeps it on the Library's renders shelf, downloads it, and - when ticked - sends it to
   Partner. Cancel on a FRESH render deletes the file, as it always did; Cancel on a
   render opened from the queue just closes, because that file was kept on purpose.

   THE NAME IS THE PERSON'S. The guide is a recommendation for creatives that go to Meta -
   the same string becomes the ad name there - so the hint under the field says whether the
   name follows the pattern, and never stops a save that does not.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';

const SEND_KEY = 'mv3-send-partner';
const TRIGGERS = ['AUTH', 'FEAR', 'FOMO', 'SECRET', 'PROOF', 'DESIRE'];

// The guide, as the Partner side wrote it.
const GUIDE = [
  ['p', 'Use this exact pattern — the same string becomes the Meta Ad name, so stats pull back into the app automatically. Underscore _ is the separator, so never use _ or a space inside a field (use camelCase or a hyphen).'],
  ['p', 'No offer in the name — a creative gets reused across offers, so the offer lives at the campaign level, not here.'],
  ['code', 'vertical_Ingredient_angleScenario_trigger_hookid_character_gender'],
  ['ex', 'MaleEnh_RedHoney_ScientistSecret_AUTH_H03_DrFauci_M'],
  ['li', '1. vertical — the niche: MaleEnh · WeightLoss · Prostate'],
  ['li', '2. Ingredient — the trick/ingredient, e.g. RedHoney, Honey, Beetroot'],
  ['li', '3. angleScenario — the angle, e.g. ScientistSecret, GirlfriendsStoryTime, BreakingNews'],
  ['li', '4. trigger — one of: AUTH · FEAR · FOMO · SECRET · PROOF · DESIRE'],
  ['li', '5. hookid — hook-library id, e.g. H03 (library not built yet — the auto-draft puts Hxx for you to fill)'],
  ['li', '6. character — narrator, e.g. DrFauci'],
  ['li', '7. gender — M / F'],
];

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// "red honey" -> "RedHoney"; anything that is not a letter or digit goes, so a part can
// never carry the separator inside it.
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
  if (parts.length !== 7) return { ok: false, text: `recommendation: 7 parts joined by _ (this has ${parts.length}) - vertical_Ingredient_angleScenario_trigger_hookid_character_gender` };
  if (parts.some(p => !p)) return { ok: false, text: 'recommendation: no empty part between the underscores' };
  if (!TRIGGERS.includes(parts[3])) return { ok: false, text: `recommendation: part 4 is the trigger - one of ${TRIGGERS.join(' · ')}` };
  if (!/^H(\d{2,}|xx)$/i.test(parts[4])) return { ok: false, text: 'recommendation: part 5 is the hook id - H03, or Hxx until the library exists' };
  if (!/^[MF]$/.test(parts[6])) return { ok: false, text: 'recommendation: part 7 is the gender - M or F' };
  return { ok: true, text: 'follows the pattern' + (/^Hxx$/i.test(parts[4]) ? ' · fill in the hook id when the library exists' : '') };
}

// A first draft of the name from what the project already knows: the Scenarios project
// behind an sv3_ key carries the vertical, the product, the cast character and the gender.
// The parts nobody has recorded yet come as placeholders in capitals, to be replaced.
async function draftName(key) {
  let vertical = '', product = '', character = '', gender = '';
  const m = /^sv3_(\d+)/.exec(String(key || ''));
  if (m) {
    try {
      const d = await fetch('/api/scen3/projects/' + encodeURIComponent(m[1])).then(r => r.json());
      const p = (d && d.project) || {};
      vertical = p.vertical || ''; product = p.product || '';
      character = (p.casting && p.casting.characterName) || '';
      gender = p.gender || '';
    } catch (e) { /* placeholders then */ }
  }
  const g = /^f/i.test(gender) ? 'F' : /^m/i.test(gender) ? 'M' : 'M';
  return [camel(vertical) || 'Vertical', camel(product) || 'Ingredient', 'AngleScenario', 'TRIGGER', 'Hxx', camel(character) || 'Character', g].join('_');
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
  const state = { url: o.url, name: '', queueId: o.queueId || null, sent: o.sent || null, fresh: !!o.fresh, saved: !o.fresh };

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
  const left = el('div', 'mv3-rr-video');
  const v = document.createElement('video');
  v.src = o.url; v.controls = true; v.autoplay = !!o.fresh; v.playsInline = true; v.preload = 'metadata';
  left.appendChild(v);
  body.appendChild(left);

  const side = el('div', 'mv3-rr-side');
  side.appendChild(el('div', 'mv3-rr-l', 'File name'));
  const nameRow = el('div', 'mv3-rr-namerow');
  const name = document.createElement('input');
  name.type = 'text'; name.className = 'mv3-rr-name'; name.maxLength = 160; name.spellcheck = false; name.autocomplete = 'off';
  name.dataset.audit = 'Render name';
  // The file's own name, without the stamp the renderer prefixed - or the project's title.
  const current = decodeURIComponent(String(o.url || '').split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
  name.value = o.fresh ? (o.title || Store.title() || current) : current;
  const draft = el('button', 'mv3-c-btn', 'Draft'); draft.type = 'button';
  draft.title = 'Fill the name from the project: vertical, ingredient, character, gender - the rest as placeholders';
  nameRow.appendChild(name); nameRow.appendChild(draft);
  side.appendChild(nameRow);
  const hint = el('div', 'mv3-rr-hint');
  side.appendChild(hint);
  const paintHint = () => { const c = check(name.value); hint.textContent = c.text; hint.className = 'mv3-rr-hint' + (c.ok ? ' ok' : ''); };
  name.addEventListener('input', paintHint);
  paintHint();
  draft.addEventListener('click', async () => { draft.disabled = true; try { name.value = await draftName(o.key || Store.key()); paintHint(); name.focus(); name.select(); } finally { draft.disabled = false; } });

  const tick = el('label', 'mv3-rr-check');
  const cb = document.createElement('input'); cb.type = 'checkbox';
  let remembered = '1';
  try { remembered = localStorage.getItem(SEND_KEY) || '1'; } catch (e) {}
  cb.checked = remembered !== '0';
  cb.addEventListener('change', () => { try { localStorage.setItem(SEND_KEY, cb.checked ? '1' : '0'); } catch (e) {} });
  tick.appendChild(cb); tick.appendChild(document.createTextNode(' also send to Partner'));
  side.appendChild(tick);

  const sentLine = el('div', 'mv3-rr-sent');
  side.appendChild(sentLine);
  const paintSent = () => {
    sentLine.textContent = '';
    if (!state.sent) { sentLine.hidden = true; return; }
    sentLine.hidden = false;
    sentLine.appendChild(document.createTextNode('sent to Partner → creative #' + state.sent.creativeId + ' '));
    if (state.sent.url) { const a = el('a', null, 'open'); a.href = state.sent.url; a.target = '_blank'; a.rel = 'noopener'; sentLine.appendChild(a); }
  };
  paintSent();

  const guide = el('div', 'mv3-rr-guide');
  guide.appendChild(el('div', 'mv3-rr-l', 'Naming — recommended for Meta'));
  for (const [kind, text] of GUIDE) {
    if (kind === 'code' || kind === 'ex') { const c = el('code', 'mv3-rr-pat' + (kind === 'ex' ? ' is-ex' : ''), (kind === 'ex' ? 'e.g. ' : '') + text); guide.appendChild(c); }
    else guide.appendChild(el(kind === 'li' ? 'div' : 'p', kind === 'li' ? 'mv3-rr-li' : null, text));
  }
  side.appendChild(guide);
  body.appendChild(side);
  box.appendChild(body);

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
  // From the queue the name is the thing to do; after a render, the video is.
  if (!o.fresh) { name.focus(); name.select(); }
}
