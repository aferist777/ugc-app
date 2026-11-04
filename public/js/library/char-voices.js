// LIBRARY - a character's voices and gender, in its right column (phase H7, the owner 2026-10-01: "в
// правый столбец персонажа"). What the Character page's view mode did, moved here with it.
//
// THE GENDER is two words and one press: female | male, written onto the character at once. It is
// what the casting and the voice search go by.
//
// THE VOICES: the main one - the voice every read uses - first and in gold, then the others saved for
// the character, each with our demo. A grey star makes a voice the main one; the cross that shows on
// hover UNBINDS it - not a delete: the voice stays on the Voices shelf with its demo, and only its
// ElevenLabs slot is given back (routes/char-store.js). Under them, the search of the ElevenLabs
// library (the same proxy the Voices shelf uses, so the key never reaches the page): gender, language
// and accent, the results under the saved ones, and "Save" on a result adds it to the account and makes
// it this character's main voice.
//
// Voices are quick and are not journalled (the Alerts rule); one thing at a time, with a countdown row
// in the column while it runs.

import { startInlineProgress } from '../progress.js';

const PAGE = 20;
const GENDERS = ['female', 'male'];

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const _pretty = (s) => String(s || '').replace(/_/g, ' ');

async function _json(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.success === false) throw new Error((d && d.error) || ('HTTP ' + r.status));
  return d;
}
const _send = (url, method, body) => _json(url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});

// ── One sound at a time, across the whole column ─────────────────────────────
let _audio = null, _playing = null;
export function stop() {
  if (_audio) { try { _audio.pause(); } catch (e) { /* going anyway */ } }
  if (_playing) { _playing.textContent = '▶'; _playing.classList.remove('is-playing'); }
  _audio = null; _playing = null;
}
function _play(src, btn) {
  const again = _playing === btn;
  stop();
  if (again || !src) return;
  const a = new Audio(src);
  _audio = a; _playing = btn;
  btn.textContent = '❚❚';
  btn.classList.add('is-playing');
  const done = () => { if (_audio === a) stop(); };
  a.addEventListener('ended', done);
  a.play().catch(done);
}
function _playBtn(src, title) {
  const b = _el('button', 'lib-vplay u-btn is-s is-icon', '▶');
  b.type = 'button';
  b.disabled = !src;
  b.title = src ? title : 'There is nothing to play for this voice';
  b.addEventListener('click', () => _play(src, b));
  return b;
}

/**
 * Paints the gender and the voices of one character into the column body.
 * @param body    the column's body (appended to)
 * @param it      the shelf's item - its meta.gender is kept up to date
 * @param voices  /api/library/info's voices: [{ voiceId, name, tags, demo, main }]
 * @param hooks   { changed(it), alive() } - the tile repaints; whether this column is still the one shown
 */
export function paint(body, it, voices, hooks) {
  const id = String(it.id);
  const alive = () => !hooks || typeof hooks.alive !== 'function' || hooks.alive();
  let saved = Array.isArray(voices) ? voices : [];
  let busy = false;
  let page = 1, total = 0, searched = false;

  // ── gender ──
  const gRow = _el('div', 'lib-cv-gender');
  gRow.appendChild(_el('span', 'lib-cv-l', 'gender'));
  const gBtns = GENDERS.map(g => {
    const b = _el('button', 'lib-cv-g', g);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (String((it.meta || {}).gender || '') === g) return;
      run('Setting the gender…', async () => {
        await _send('/api/char-store/' + encodeURIComponent(id), 'PATCH', { gender: g });
        it.meta = { ...(it.meta || {}), gender: g };
        paintGender();
        if (!searched) fGender.value = g;
        say('Gender set to ' + g, 'ok');
        if (hooks && hooks.changed) hooks.changed(it);
      });
    });
    gRow.appendChild(b);
    return b;
  });
  const paintGender = () => {
    const cur = String((it.meta || {}).gender || '');
    gBtns.forEach((b, i) => {
      const on = GENDERS[i] === cur;
      b.classList.toggle('is-on', on);
      b.title = on ? 'This character is ' + cur : 'Make this character ' + GENDERS[i];
    });
  };
  paintGender();
  body.appendChild(gRow);

  // ── voices ──
  const part = _el('div', 'lib-info-part lib-cv');
  const sec = _el('div', 'lib-info-sec');
  const list = _el('div', 'lib-cv-list');
  const stat = _el('div', 'lib-cv-stat');
  const statText = _el('span', 'lib-cv-stat-t');
  stat.appendChild(statText);
  part.appendChild(sec);
  part.appendChild(list);

  const say = (text, kind) => {
    statText.textContent = text || '';
    statText.className = 'lib-cv-stat-t' + (kind ? ' ' + kind : '');
  };

  const paintSaved = () => {
    sec.textContent = saved.length > 1 ? 'Voices · ' + saved.length : 'Voice';
    list.textContent = '';
    if (!saved.length) { list.appendChild(_el('div', 'lib-info-note', 'No voice yet - find one below.')); return; }
    for (const v of saved) {
      const row = _el('div', 'lib-info-voice lib-cv-row' + (v.main ? ' is-main' : ''));
      row.title = v.main ? 'The voice every read uses' : 'One of the voices saved for this character';
      row.appendChild(_playBtn(v.demo, 'Play our demo'));
      const txt = _el('div', 'lib-vtxt');
      txt.appendChild(_el('div', 'lib-vname', v.name || 'Not on the Voices shelf'));
      txt.appendChild(_el('div', 'lib-vsub', (v.tags || []).map(_pretty).join(' · ') || v.voiceId));
      row.appendChild(txt);
      if (v.main) row.appendChild(_el('span', 'lib-info-main', 'main'));
      else {
        const star = _el('button', 'lib-cv-star u-btn is-s is-icon is-quiet', '★');
        star.type = 'button';
        star.title = 'Make this the voice every read uses';
        star.addEventListener('click', () => run('Setting the main voice…', async () => {
          await _send('/api/char-store/' + encodeURIComponent(id), 'PATCH', { voice: v.voiceId });
          await reread();
          say('“' + (v.name || v.voiceId) + '” is the main voice now', 'ok');
        }));
        row.appendChild(star);
      }
      const x = _el('button', 'lib-cv-x', '✕');
      x.type = 'button';
      x.title = 'Unbind this voice: it stays on the Voices shelf with its demo, its ElevenLabs slot is freed';
      x.addEventListener('click', () => {
        if (!confirm('Unbind “' + (v.name || v.voiceId) + '” from ' + (it.name || 'this character') + '?\n\n'
          + 'It stays on the Voices shelf with its demo; its ElevenLabs slot is given back.')) return;
        run('Unbinding the voice…', async () => {
          const d = await _json('/api/char-store/' + encodeURIComponent(id) + '/voice/' + encodeURIComponent(v.voiceId), { method: 'DELETE' });
          await reread();
          const slot = d.slot || {};
          say('“' + (v.name || v.voiceId) + '” is on the Voices shelf. '
            + (slot.released ? 'Its ElevenLabs slot is free.' : 'Slot ' + (slot.reason || 'kept') + '.'), 'ok');
        });
      });
      row.appendChild(x);
      list.appendChild(row);
    }
  };

  // What the server holds now - the voices as the column reads them, and the count for the tile.
  const reread = async () => {
    const d = await _json('/api/library/info/characters/' + encodeURIComponent(id));
    saved = d.voices || [];
    if (!alive()) return;
    paintSaved();
    it.meta = { ...(it.meta || {}), voices: saved.length };
    if (hooks && hooks.changed) hooks.changed(it);
  };

  // ── the search ──
  const find = _el('div', 'lib-cv-find');
  find.appendChild(_el('div', 'lib-info-sec', 'Find a voice'));
  const bar = _el('div', 'lib-cv-bar');
  const sel = (cls) => { const s = _el('select', 'lib-cv-sel' + (cls ? ' ' + cls : '')); return s; };
  const fill = (s, values, anyLabel, def) => {
    s.textContent = '';
    const any = _el('option', null, anyLabel); any.value = ''; s.appendChild(any);
    for (const v of values || []) { const o = _el('option', null, v); o.value = v; s.appendChild(o); }
    if (def && (values || []).includes(def)) s.value = def;
  };
  const fGender = sel();
  for (const g of ['female', 'male', 'neutral']) { const o = _el('option', null, g); o.value = g; fGender.appendChild(o); }
  fGender.value = String((it.meta || {}).gender || '') === 'male' ? 'male' : 'female';
  const fLang = sel(), fAccent = sel('is-wide');
  fill(fLang, [], 'any language');
  fill(fAccent, [], 'any accent');
  _json('/api/scen3/voices/filters').then(d => {
    fill(fLang, d.languages, 'any language', 'en');
    fill(fAccent, d.accents, 'any accent');
  }).catch(() => { /* the lists stay "any" */ });
  const go = _el('button', 'u-btn is-s lib-cv-go', 'Search');
  go.type = 'button';
  go.title = 'Search the ElevenLabs voice library';
  bar.appendChild(fGender); bar.appendChild(fLang); bar.appendChild(fAccent); bar.appendChild(go);
  find.appendChild(bar);
  const results = _el('div', 'lib-cv-results');
  find.appendChild(results);

  const search = () => run('Searching the voice library…', async () => {
    // The library counts pages from zero; the pager here from one.
    const q = new URLSearchParams({ page_size: String(PAGE), page: String(page - 1) });
    if (fGender.value) q.set('gender', fGender.value);
    if (fLang.value) q.set('language', fLang.value);
    if (fAccent.value) q.set('accent', fAccent.value);
    const d = await _json('/api/scen3/voices/library?' + q);
    if (!alive()) return;
    searched = true;
    total = d.total || (d.voices || []).length;
    paintResults(d.voices || []);
    say((d.voices || []).length ? ((d.voices || []).length + ' of ' + total + ' - listen, then Save') : 'Nothing matched that.',
      (d.voices || []).length ? '' : 'err');
  });
  go.addEventListener('click', () => { page = 1; search(); });
  for (const s of [fGender, fLang, fAccent]) s.addEventListener('change', () => { page = 1; if (searched) search(); });

  const paintResults = (found) => {
    results.textContent = '';
    for (const v of found) {
      const row = _el('div', 'lib-info-voice lib-cv-row');
      row.appendChild(_playBtn(v.preview_url, 'Play the library sample'));
      const txt = _el('div', 'lib-vtxt');
      txt.appendChild(_el('div', 'lib-vname', v.name || v.voice_id));
      txt.appendChild(_el('div', 'lib-vsub', [v.gender, v.age, v.accent, v.descriptive].filter(Boolean).map(_pretty).join(' · ')));
      row.appendChild(txt);
      const take = _el('button', 'u-btn is-s lib-cv-take', 'Save');
      take.type = 'button';
      take.title = 'Add it to the account and make it this character’s main voice';
      take.addEventListener('click', () => run('Saving the voice…', async () => {
        const t = await _send('/api/scen3/voices/take', 'POST', { ownerId: v.public_owner_id, voiceId: v.voice_id, name: v.name });
        const all = await _json('/api/char-store/list');
        const rec = (all.chars || []).find(c => String(c.id) === id);
        if (!rec) throw new Error('this character is gone');
        const had = (rec.voices || []).some(x => x && x.voiceId === t.voiceId);
        const kept = (rec.voices || []).filter(x => x && x.voiceId !== t.voiceId);
        const entry = { voiceId: t.voiceId, name: t.name || v.name, gender: v.gender || '', age: v.age || '',
          accent: v.accent || '', descriptive: v.descriptive || '', sample: t.sample || '', dur: t.dur || 0 };
        await _send('/api/char-store/' + encodeURIComponent(id), 'PATCH', { voice: t.voiceId, voices: kept.concat([entry]) });
        await reread();
        say(had ? 'Already this character’s - it is the main voice now.'
          : t.reused ? 'Already on the Voices shelf, so its demo was kept. Bound to this character.'
          : t.sampleError ? 'Saved. Its demo failed to record, which is cosmetic.'
          : 'Saved - the main voice now.', 'ok');
      }));
      row.appendChild(take);
      results.appendChild(row);
    }
    const pages = Math.max(1, Math.ceil(total / PAGE));
    if (pages > 1) {
      const pager = _el('div', 'lib-cv-pager');
      const step = (label, to, on) => {
        const b = _el('button', 'u-btn is-s', label);
        b.type = 'button';
        b.disabled = !on;
        b.addEventListener('click', () => { page = to; search(); });
        pager.appendChild(b);
      };
      step('‹', page - 1, page > 1);
      pager.appendChild(_el('span', 'lib-cv-at', page + ' / ' + pages));
      step('›', page + 1, page < pages);
      results.appendChild(pager);
    }
  };

  // One thing at a time, everything in the column locked while it runs, a countdown row over the status.
  async function run(label, fn) {
    if (busy) { say('Already working - one at a time', 'err'); return; }
    busy = true;
    const touched = [];
    for (const b of [gRow, part, find].flatMap(n => [...n.querySelectorAll('button, select')])) {
      if (!b.disabled && !b.classList.contains('lib-vplay')) { b.disabled = true; touched.push(b); }
    }
    say('');
    const pr = startInlineProgress(stat, { label });
    try { await fn(); pr.finish(); }
    catch (e) { pr.detach(); say(e.message, 'err'); }
    finally { touched.forEach(b => { b.disabled = false; }); busy = false; }
  }

  paintSaved();
  part.appendChild(stat);
  part.appendChild(find);
  body.appendChild(part);
}
