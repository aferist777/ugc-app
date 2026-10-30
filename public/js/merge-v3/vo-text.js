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
   ════════════════════════════════════════════════════════════════════════════ */

import * as API from './scen-api.js';
import * as Layers from '../layers.js';

const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const _n = (v) => v.toLocaleString('en-US').replace(/,/g, ' ');

/**
 * @param projectId  the voiceover draft the text goes into
 * @param done(project)  the draft as it is now, with its one line; a refusal is said in the window, which stays
 */
export function openOwnText(projectId, done) {
  const ov = _el('div', 'mv3-x-ov');
  const box = _el('div', 'mv3-x is-scen is-votext');
  ov.appendChild(box);

  const head = _el('div', 'mv3-x-head');
  head.appendChild(_el('h3', null, 'Voiceover from your text'));
  const close = _el('button', 'mv3-x-close', '✕');
  close.type = 'button';
  head.appendChild(close);
  box.appendChild(head);

  const body = _el('div', 'mv3-x-body');
  box.appendChild(body);
  const row = _el('div', 'mv3-x-row');
  row.appendChild(_el('label', null, 'Name'));
  const name = _el('input', 'mv3-sc-inp');
  name.type = 'text';
  name.placeholder = 'what this voiceover is called - the first words when empty';
  row.appendChild(name);
  body.appendChild(row);

  body.appendChild(_el('div', 'mv3-x-hdr', 'The text'));
  const text = _el('textarea', 'mv3-sc-lines is-votext');
  text.spellcheck = false;
  text.maxLength = API.VO_MAX;
  text.placeholder = 'Paste or type the whole text, in any language. It is read in one take, in the language it is written in.';
  body.appendChild(text);
  const count = _el('p', 'mv3-x-note mv3-vo-count');
  body.appendChild(count);
  body.appendChild(_el('p', 'mv3-x-note',
    'The whole text is one line of the project. ' + _n(API.VO_MAX) + ' characters at most: ElevenLabs reads 5 000 at a time, '
    + 'and the rest is left for the mood\'s tags.'));

  const foot = _el('div', 'mv3-x-foot');
  const note = _el('span', 'mv3-x-note');
  const go = _el('button', 'mv3-c-btn mv3-x-use', 'use');
  go.type = 'button';
  go.title = 'Make this text the voiceover\'s script - one line';
  foot.append(note, go);
  box.appendChild(foot);

  // The counter: how many are in, of how many. A paste longer than the field is cut by the field itself (maxLength) - and
  // said here, so nothing goes missing unseen.
  let cut = false;
  const gate = () => {
    const n = text.value.length;
    count.textContent = _n(n) + ' / ' + _n(API.VO_MAX) + (cut ? ' - the paste was longer and was cut at the limit' : '');
    count.classList.toggle('is-full', n >= API.VO_MAX);
    go.disabled = !text.value.trim();
  };
  text.addEventListener('paste', (e) => {
    const got = (e.clipboardData && e.clipboardData.getData('text')) || '';
    const room = API.VO_MAX - text.value.length + (text.selectionEnd - text.selectionStart);
    cut = got.length > room;
  });
  text.addEventListener('input', () => { if (text.value.length < API.VO_MAX) cut = false; gate(); });

  const layer = Layers.open(ov, { name: 'voiceover text', onEsc: () => _close(ov, layer) });
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
      const project = await API.voiceoverScript(projectId, { text: text.value, name: name.value.trim() });
      _close(ov, layer);
      done(project);
    } catch (e) {
      note.textContent = e.message;
      go.disabled = false;
    }
  });
}

function _close(ov, layer) {
  Layers.close(layer);
  try { ov.remove(); } catch (e) { /* already gone */ }
}
