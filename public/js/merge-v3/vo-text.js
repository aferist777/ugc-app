/* ════════════════════════════════════════════════════════════════════════════
   MERGE — a VOICEOVER FROM ONE'S OWN TEXT (phase V62, the owner 2026-10-30: (во1) "текст можно вставить самостоятельно,
   типа попап для добавления своего текста, и текст встает в озвучку"; (во16) "весь текст может быть одной строкой. это
   быстрый режим"; (во27) "в поле вставки текста не давать пользователю вставить текст длиннее 5000 символов и показывать
   сколько символов уже вставлено"; (во28) 4 500 - the rest is the mood's tags').

   The "+ your text" button of the voiceover draft's script column (js/merge-v3/vo-script.js) opens it: a name and the text, in
   any language - it is read in the language it is written in, never translated. The whole text is ONE line of the draft
   (POST /scen3/projects/:id/script); it never goes onto the scenarios shelf. The field takes no more than VO_MAX characters
   (a paste is cut there, and the counter says so), and `use` puts it into the draft and closes the window.

   Its frame and buttons are the scenario window's (css/dialog.css .mv3-x.is-scen).

   (phase V63, P14, the owner's (хп32), (хп58): "По абзацам: каждый Enter — новая строка") A TALKING HEAD'S OWN TEXT too - Home's
   quick start (`o.talking`): every paragraph is a line - its own frame and clip -, the count of lines said under the field; in
   another language it is made English when the project is made (routes/scen3.js, V29). Where the text goes is the caller's
   `put(body)` - the voiceover draft in Merge, the popup on Home.
   ════════════════════════════════════════════════════════════════════════════ */

import * as API from './scen-api.js';
import * as Layers from '../layers.js';
import { showError } from '../notice.js';

const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const _n = (v) => v.toLocaleString('en-US').replace(/,/g, ' ');

/** (phase V63) A talking head's text cut into its lines: every paragraph - every Enter - a line. */
export const paragraphs = (t) => String(t || '').split(/\r?\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);

/**
 * @param put(body)  where the text goes - { text, name } (a voiceover: one line) or { lines, name } (a talking head) -, answering
 *                   what `done` is given; a refusal is a popup in the corner (V73 block 4), and the window stays
 * @param done(r)    what `put` answered (in Merge: the voiceover draft as it is now, with its one line)
 * @param o          (phase V63) { talking, text, name } - a talking head's text; what the field and the name start with
 */
export function openOwnText(put, done, o = {}) {
  const talking = !!o.talking;
  const ov = _el('div', 'mv3-x-ov');
  // (phase V73 block 4) the one window frame (css/app-shell.css .u-win): its head of 40 px, the 28 px ✕, the foot of 52 px
  const box = _el('div', 'mv3-x is-scen is-votext u-win is-float');
  ov.appendChild(box);

  const head = _el('div', 'mv3-x-head u-win-head');
  head.appendChild(_el('h3', 'u-win-title', talking ? 'Talking head from your text' : 'Voiceover from your text'));
  const close = _el('button', 'mv3-x-close u-btn is-icon is-quiet u-x', '');
  close.type = 'button';
  close.title = 'Close (Esc)';
  head.appendChild(close);
  box.appendChild(head);

  const body = _el('div', 'mv3-x-body');
  box.appendChild(body);
  const row = _el('div', 'mv3-x-row');
  row.appendChild(_el('label', null, 'Name'));
  const name = _el('input', 'mv3-sc-inp u-in');
  name.type = 'text';
  name.placeholder = 'what this ' + (talking ? 'talking head' : 'voiceover') + ' is called - the first words when empty';
  name.value = String(o.name || '');
  row.appendChild(name);
  body.appendChild(row);

  body.appendChild(_el('div', 'mv3-x-hdr', 'The text'));
  const text = _el('textarea', 'mv3-sc-lines is-votext u-area is-dark');
  text.spellcheck = false;
  text.maxLength = API.VO_MAX;
  text.placeholder = talking
    ? 'Paste or type the text. Every paragraph is a line of the talking head - its own frame and clip: Enter starts the next.'
    : 'Paste or type the whole text, in any language. It is read in one take, in the language it is written in.';
  text.value = String(o.text || '').slice(0, API.VO_MAX);
  body.appendChild(text);
  const count = _el('p', 'mv3-x-note mv3-vo-count');
  body.appendChild(count);
  body.appendChild(_el('p', 'mv3-x-note', talking
    ? 'Every paragraph is one line - a fragment with its own frame and clip, read by itself. Written in another language, it is '
      + 'made English when the project is made.'
    : 'The whole text is one line of the project. ' + _n(API.VO_MAX) + ' characters at most: ElevenLabs reads 5 000 at a time, '
      + 'and the rest is left for the mood\'s tags.'));

  // the foot: the window's one status line (u-status) at the left, use at the right
  const foot = _el('div', 'mv3-x-foot u-win-foot');
  const note = _el('span', 'u-status');
  const go = _el('button', 'mv3-c-btn mv3-x-use u-btn is-main', 'use');
  go.type = 'button';
  go.title = talking ? 'Take this text - a line a paragraph' : 'Make this text the voiceover\'s script - one line';
  foot.append(note, go);
  box.appendChild(foot);

  // The counter: how many are in, of how many - and, for a talking head, how many lines they make. A paste longer than the field
  // is cut by the field itself (maxLength) - and said here, so nothing goes missing unseen.
  let cut = false;
  const gate = () => {
    const n = text.value.length;
    const lines = talking ? paragraphs(text.value).length : 0;
    count.textContent = (talking ? lines + (lines === 1 ? ' line · ' : ' lines · ') : '') + _n(n) + ' / ' + _n(API.VO_MAX)
      + (cut ? ' - the paste was longer and was cut at the limit' : '');
    count.classList.toggle('is-full', n >= API.VO_MAX);
    go.disabled = !text.value.trim();
  };
  text.addEventListener('paste', (e) => {
    const got = (e.clipboardData && e.clipboardData.getData('text')) || '';
    const room = API.VO_MAX - text.value.length + (text.selectionEnd - text.selectionStart);
    cut = got.length > room;
  });
  text.addEventListener('input', () => { if (text.value.length < API.VO_MAX) cut = false; gate(); });

  const layer = Layers.open(ov, { name: talking ? 'talking head text' : 'voiceover text', onEsc: () => _close(ov, layer) });
  close.addEventListener('click', () => _close(ov, layer));
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) _close(ov, layer); });
  document.body.appendChild(ov);
  gate();
  text.focus();

  go.addEventListener('click', async () => {
    if (!text.value.trim()) return;
    go.disabled = true;
    note.textContent = 'saving…';
    try {
      const r = await put(talking
        ? { lines: paragraphs(text.value), name: name.value.trim() }
        : { text: text.value, name: name.value.trim() });
      _close(ov, layer);
      done(r);
    } catch (e) {
      // (phase V73 block 4) a refusal is a popup in the corner (js/notice.js); the window stays, its line goes quiet
      note.textContent = '';
      showError(e.message || 'The text could not be taken');
      go.disabled = false;
    }
  });
}

function _close(ov, layer) {
  Layers.close(layer);
  try { ov.remove(); } catch (e) { /* already gone */ }
}
