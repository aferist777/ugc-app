// THE DRAFT'S QUESTION (phase V20, the owner 2026-10-08).
//
// The draft is the project Merge opens when no project is (routes/mergev3.js): work and generate first, name it later.
// It is asked about when it is left with something in it - at the window's close (the shell asks the page:
// window.__ugcDraftAsk, desktop/main.js), at a switch away from it in Merge, and at the start after an app that
// closed without asking. One window, in the middle, on the layer stack (js/layers.js):
//
//   Save        names it - the day first, as a new project is named; the categories and the folder follow
//   Don't save  lets it go - its timeline and chats go, what it made stays in the Library, in Uncategorized
//   Cancel      leaves it a draft (Later, at the start)
//
//   draftNow()            -> the draft: { key, title, content: { clips, made, filed, any } } or null
//   askDraft(dr, { later }) -> Promise<{ result: 'saved' | 'discarded' | 'cancel' | 'later', title? }>
//   installCloseAsk()     the window's close asks here (window.__ugcDraftAsk): 'none' - close; 'asking' - the
//                         question is on screen, and the page closes the window again itself once it is answered

import * as Layers from './layers.js';

export async function draftNow() {
  try {
    const d = await fetch('/api/mv3/draft').then(r => r.json());
    return d && d.success ? d.draft : null;
  } catch (e) { return null; }
}

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// What it holds, in a line: "1 clip on the timeline · 1 picture or clip made · 1 file in the Library" - not what was said:
// the drafts' conversation goes on whatever becomes of it (phase V21).
function _holds(c) {
  const n = (k, one, many) => (k ? k + ' ' + (k === 1 ? one : many) : '');
  return [n(c.clips, 'clip on the timeline', 'clips on the timeline'),
    n(c.made, 'picture or clip made', 'pictures and clips made'), n(c.filed, 'file in the Library', 'files in the Library')]
    .filter(Boolean).join(' · ');
}

let _open = null;

export function askDraft(dr, o) {
  if (_open) return _open;
  const opts = o || {};
  _open = new Promise((resolve) => {
    const back = _el('div', 'dr-back');
    const box = _el('div', 'nm-box dr-box');
    box.setAttribute('role', 'dialog');
    box.appendChild(_el('div', 'nm-t', opts.later ? 'A draft was left unsaved' : 'This project is a draft'));
    const c = (dr && dr.content) || {};
    box.appendChild(_el('div', 'dr-holds', 'It is not saved' + (_holds(c) ? ': ' + _holds(c) + '.' : '.')));
    const inp = _el('input', 'nm-in');
    inp.type = 'text';
    inp.maxLength = 120;
    inp.spellcheck = false;
    inp.placeholder = 'Name';
    inp.value = new Date().toISOString().slice(0, 10) + ' - ';
    const err = _el('div', 'nm-err');
    const row = _el('div', 'nm-r');
    const save = _el('button', 'nm-b is-ok', 'Save');
    const drop = _el('button', 'nm-b', 'Don\'t save');
    const stay = _el('button', 'nm-b', opts.later ? 'Later' : 'Cancel');
    for (const b of [save, drop, stay]) b.type = 'button';
    row.append(save, drop, stay);
    box.append(inp, err, row, _el('div', 'dr-note', 'Don\'t save: its timeline and chats go - what it made stays in the Library, in Uncategorized.'));
    document.body.append(back, box);
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);

    let busy = false;
    let layer = null;
    const close = (r) => {
      back.remove();
      box.remove();
      if (layer) Layers.close(layer);
      _open = null;
      resolve(r);
    };
    const work = async (fn) => {
      if (busy) return;
      busy = true;
      save.disabled = drop.disabled = stay.disabled = true;
      err.textContent = '';
      try { await fn(); }
      catch (e) { err.textContent = (e && e.message) || String(e); inp.focus(); }
      finally { busy = false; save.disabled = drop.disabled = stay.disabled = false; }
    };
    const doSave = () => work(async () => {
      const title = inp.value.trim();
      if (!title || /^\d{4}-\d{2}-\d{2} -$/.test(title)) throw new Error('Give it a name.');
      const d = await fetch('/api/mv3/timeline/' + encodeURIComponent(dr.key) + '/title', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
      }).then(r => r.json());
      if (!d || !d.success) throw new Error((d && d.error) || 'it was not saved');
      close({ result: 'saved', title: d.title });
    });
    const doDrop = () => work(async () => {
      const d = await fetch('/api/mv3/timeline/' + encodeURIComponent(dr.key) + '/discard', { method: 'POST' }).then(r => r.json());
      if (!d || !d.success) throw new Error((d && d.error) || 'it was not let go of');
      close({ result: 'discarded' });
    });
    const doStay = () => { if (!busy) close({ result: opts.later ? 'later' : 'cancel' }); };
    save.addEventListener('click', doSave);
    drop.addEventListener('click', doDrop);
    stay.addEventListener('click', doStay);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
    layer = Layers.open(box, { name: 'the draft', onEsc: doStay });
  });
  return _open;
}

// The window's close (desktop/main.js asks before it closes): nothing to ask - 'none'; something in the draft - the
// question goes on screen, 'asking', and once it is answered with Save or Don't save the page closes the window again
// itself (the second time there is nothing left to ask). Cancel leaves the window open.
export function installCloseAsk() {
  window.__ugcDraftAsk = async () => {
    if (_open) return 'asking';
    const dr = await draftNow();
    if (!dr || !dr.content || !dr.content.any) return 'none';
    askDraft(dr).then((r) => {
      if ((r.result === 'saved' || r.result === 'discarded') && window.ugcWindow) window.ugcWindow.close();
    });
    return 'asking';
  };
}
