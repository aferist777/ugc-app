/* ═══════════════════════════════════════════════════════════════════════════
   THE SPEECH MODEL, OFFERED WHEN THE PROGRAM FIRST STARTS (phase V30, block 1; the owner 2026-10-15, answer (с23):
   "давай вопрос при первом запуске программы").

   Captions are heard by Groq when there is a key, and on this computer when there is not (the owner's (с22)); a talking
   head's new lines are heard by themselves - and on this computer that needs the speech model, 574 MB, which is never
   downloaded by itself. So Merge - the first page the program opens - asks once, in a library where it was never asked:
   the recognition program is there, the model is not and is not being downloaded.

     Download   the app fetches it in the background (lib/whisper-local.js: Hugging Face, a pinned commit, checked by
                SHA-256, a broken download goes on from where it stopped); Admin -> This computer shows how far it is
     Not now    the lane of subtitles and Admin offer it later, as before

   Asked once: the answer is kept in localStorage, which the library mirrors (data/ui-state.json, js/storage-sync.js) - a
   new library is a new start. A question already on screen (the draft's, at the start) is answered first.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';

const LS = 'speech_model_asked_v1';

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function askModelOnce() {
  try { if (localStorage.getItem(LS)) return; } catch (e) { return; }
  let st = null;
  try { st = (await fetch('/api/speech/local').then((r) => r.json())).state; } catch (e) { return; }
  if (!st || !st.platform || !st.program || !st.program.present || !st.model || st.model.present || st.model.downloading) return;
  for (let i = 0; i < 1200 && document.querySelector('.dr-box'); i++) await _sleep(500);   // the draft's question first
  const mb = Math.round((+st.model.bytes || 574041195) / 1e6);

  const back = _el('div', 'dr-back');
  const box = _el('div', 'nm-box dr-box');
  box.setAttribute('role', 'dialog');
  box.appendChild(_el('div', 'nm-t', 'Subtitles on this computer'));
  box.appendChild(_el('div', 'dr-holds', 'Speech can be heard right here, with no key and no cost - the captions of a talking head '
    + 'are then laid by themselves even without a Groq key. Download the speech model now? ' + mb + ' MB, once.'));
  const err = _el('div', 'nm-err');
  const row = _el('div', 'nm-r');
  const yes = _el('button', 'nm-b is-ok', 'Download');
  const no = _el('button', 'nm-b', 'Not now');
  for (const b of [yes, no]) b.type = 'button';
  row.append(yes, no);
  box.append(err, row, _el('div', 'dr-note', 'From Hugging Face, checked when it arrives. Not now: the Subtitles lane and Admin -> '
    + 'This computer offer it later.'));
  document.body.append(back, box);
  yes.focus();

  let layer = null;
  const close = (answer) => {
    try { localStorage.setItem(LS, answer); } catch (e) { /* asked again next time */ }
    back.remove();
    box.remove();
    if (layer) Layers.close(layer);
  };
  yes.addEventListener('click', async () => {
    yes.disabled = no.disabled = true;
    try {
      const d = await fetch('/api/speech/local/download', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ what: 'model' }) }).then((r) => r.json());
      if (!d || !d.success) throw new Error((d && d.error) || 'the download did not start');
      close('download');
    } catch (e) {
      err.textContent = 'Not started: ' + e.message;
      yes.disabled = no.disabled = false;
    }
  });
  no.addEventListener('click', () => close('later'));
  layer = Layers.open(box, { name: 'the speech model', onEsc: () => close('later') });
}
