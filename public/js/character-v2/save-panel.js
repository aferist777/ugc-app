// CHARACTER v2 — the save stage's form, in the model column.
//
// Reached from "Save model" at the bottom of that column. While it is up the page is committed
// to finishing one thing, so the two left columns are shut and inert and Cancel is the way out.
// That is the point of a stage rather than a mode.
//
// It has four states and the footer says which one it is in:
//
//   form    the fields are editable       [Cancel] [Save character]
//   saving  the record is being made      everything locked
//   sheet   the record exists, its 4K sheet is still generating
//                                         [Done] but disabled
//   saved   the sheet has stopped, well or badly
//                                         [Regenerate sheet] [Done]
//
// Cancel disappears once the record exists, because by then there is nothing to cancel - the
// character is real. Done is shut for the whole of `sheet`: the sheet is the character's one
// canonical asset, the thing Scenarios reads, and leaving while it is being made is exactly how
// you end up with a character that has none. What can still go wrong is the sheet, so that is
// what gets the retry - offered only once it has stopped running.

const GENDERS = ['female', 'male'];

let _hooks = {};
let _state = 'form';
let _els = {};

function _sec(title) {
  const s = document.createElement('div');
  s.className = 'cv2-save-sec';
  const t = document.createElement('div');
  t.className = 'cv2-save-sec-t';
  t.textContent = title;
  s.appendChild(t);
  return s;
}

function _syncFoot() {
  const { cancel, go, retry, name, gender, vfind, vnote } = _els;
  if (vfind) {
    // Attaching needs a character id, so the search waits for the record. It also waits for the
    // sheet, so two jobs cannot be in flight over the same character at once.
    vfind.disabled = _state !== 'saved';
    vnote.textContent = _state === 'saved'
      ? 'Taking a voice adds it to your ElevenLabs account and attaches it here.'
      : 'Save first, then pick a voice from the library.';
  }
  const busy = _state === 'saving' || _state === 'sheet';
  const exists = _state === 'sheet' || _state === 'saved';   // the record has been created
  cancel.hidden = exists;
  cancel.disabled = busy;
  retry.hidden = _state !== 'saved';
  // Shut while the sheet is being made - that is the point of having a `sheet` state at all.
  go.disabled = busy || (_state === 'form' && !name.value.trim());
  go.textContent = exists ? 'Done' : (_state === 'saving' ? 'Saving...' : 'Save character');
  name.disabled = _state !== 'form';
  gender.disabled = _state !== 'form';
}

export function build(host, hooks) {
  _hooks = hooks || {};
  host.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'cv2-save';

  // ── who it is ──
  const idn = _sec('Identity');
  const nameRow = document.createElement('div');
  nameRow.className = 'cv2-save-row';
  const nameLab = document.createElement('span');
  nameLab.className = 'cv2-save-lab';
  nameLab.textContent = 'Name';
  const name = document.createElement('input');
  name.type = 'text'; name.id = 'cv2-save-name'; name.className = 'cv2-save-in';
  name.placeholder = 'Required';
  name.addEventListener('input', _syncFoot);
  nameRow.appendChild(nameLab); nameRow.appendChild(name);
  idn.appendChild(nameRow);

  const genRow = document.createElement('div');
  genRow.className = 'cv2-save-row';
  const genLab = document.createElement('span');
  genLab.className = 'cv2-save-lab';
  genLab.textContent = 'Gender';
  const gender = document.createElement('select');
  gender.id = 'cv2-save-gender'; gender.className = 'cv2-save-in';
  for (const g of GENDERS) {
    const o = document.createElement('option');
    o.value = g; o.textContent = g;
    gender.appendChild(o);
  }
  // Changing who they are re-points the voice search, since that is the first thing anyone
  // would filter by anyway.
  gender.addEventListener('change', () => {
    if (_els.vgender) _els.vgender.value = gender.value === 'male' ? 'male' : 'female';
  });
  genRow.appendChild(genLab); genRow.appendChild(gender);
  idn.appendChild(genRow);
  wrap.appendChild(idn);

  // ── voice ──
  // Searched in the ElevenLabs public library through the proxy the Scenarios voice studio
  // already uses, so the key never reaches the browser and there is one search in the project
  // rather than two. Taking a voice ADDS it to the account - ElevenLabs refuses to speak with a
  // library id that is not there - and the account-side id is what lands on the character.
  //
  // Only actionable once the record exists, because attaching writes through
  // PATCH /char-store/:id and that needs an id. Saving first is also the order asked for.
  const voice = _sec('Voice');
  const vnote = document.createElement('div');
  vnote.className = 'cv2-save-note';
  vnote.textContent = 'Save first, then pick a voice from the library.';
  voice.appendChild(vnote);

  const vrow = document.createElement('div');
  vrow.className = 'cv2-save-row';
  const vgender = document.createElement('select');
  vgender.id = 'cv2-voice-gender'; vgender.className = 'cv2-save-in';
  for (const g of ['male', 'female', 'neutral']) {
    const o = document.createElement('option');
    o.value = g; o.textContent = g;
    vgender.appendChild(o);
  }
  const vfind = document.createElement('button');
  vfind.type = 'button'; vfind.id = 'cv2-voice-find'; vfind.className = 'cv2-save-btn';
  vfind.textContent = 'Find voices';
  vfind.addEventListener('click', () => { if (_hooks.onFindVoices) _hooks.onFindVoices(vgender.value); });
  vrow.appendChild(vgender); vrow.appendChild(vfind);
  voice.appendChild(vrow);

  const vstat = document.createElement('div');
  vstat.className = 'cv2-save-stat'; vstat.id = 'cv2-voice-stat';
  voice.appendChild(vstat);
  const vlist = document.createElement('div');
  vlist.className = 'cv2-voice-list'; vlist.id = 'cv2-voice-list';
  voice.appendChild(vlist);
  wrap.appendChild(voice);

  // ── the sheet ──
  const sheet = _sec('Reference sheet');
  const snote = document.createElement('div');
  snote.className = 'cv2-save-note';
  snote.textContent = 'A 4K sheet is generated from the image on the left: a large portrait plus '
    + 'three full-body views in a neutral bodysuit. It runs in the background, so saving does not '
    + 'wait for it, and it is what Scenarios reads later.';
  sheet.appendChild(snote);
  const sstat = document.createElement('div');
  sstat.className = 'cv2-save-stat';
  sstat.id = 'cv2-save-stat';
  sheet.appendChild(sstat);
  wrap.appendChild(sheet);

  // ── footer: Cancel to the LEFT of Save character, as asked ──
  const foot = document.createElement('div');
  foot.className = 'cv2-save-foot';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.id = 'cv2-save-cancel'; cancel.className = 'cv2-save-btn';
  cancel.textContent = 'Cancel';
  cancel.title = 'Back to building, and nothing is saved';
  cancel.addEventListener('click', () => { if (_hooks.onCancel) _hooks.onCancel(); });
  const retry = document.createElement('button');
  retry.type = 'button'; retry.id = 'cv2-save-retry'; retry.className = 'cv2-save-btn';
  retry.textContent = 'Regenerate sheet';
  retry.title = 'Submit the 4K sheet again';
  retry.hidden = true;
  retry.addEventListener('click', () => { if (_hooks.onRetrySheet) _hooks.onRetrySheet(); });
  const go = document.createElement('button');
  go.type = 'button'; go.id = 'cv2-save-go'; go.className = 'cv2-save-btn is-go';
  go.textContent = 'Save character';
  go.addEventListener('click', () => {
    if (_state === 'sheet') return;              // disabled anyway; belt as well as braces
    if (_state === 'saved') return _hooks.onDone && _hooks.onDone();
    if (_state !== 'form') return;
    const n = name.value.trim();
    if (!n) return;
    if (_hooks.onSave) _hooks.onSave({ name: n, gender: gender.value });
  });
  foot.appendChild(cancel); foot.appendChild(retry); foot.appendChild(go);
  wrap.appendChild(foot);

  host.appendChild(wrap);
  _els = { name, gender, cancel, go, retry, stat: sstat,
           vgender, vfind, vstat, vlist, vnote };
  _syncFoot();

  return {
    // Opened afresh each time, so whatever the create column had is what it starts from.
    open: ({ name: n, gender: g } = {}) => {
      _state = 'form';
      name.value = n || '';
      if (g && GENDERS.includes(g)) gender.value = g;
      sstat.textContent = '';
      sstat.className = 'cv2-save-stat';
      // The voice search starts from the character's own gender - the commonest first filter,
      // and one the form already knows the answer to.
      vgender.value = gender.value === 'male' ? 'male' : 'female';
      vstat.textContent = '';
      vstat.className = 'cv2-save-stat';
      vlist.textContent = '';
      _syncFoot();
    },
    state: () => _state,
    setState: (s) => { _state = s; _syncFoot(); },
    // Re-assert the footer from the panel's own state. A job's control lock restores exactly
    // what it disabled, which would otherwise hand Done back the moment a job ends - including
    // the moment a save ends and the sheet is only just starting.
    sync: _syncFoot,
    status: (text, kind) => {
      sstat.textContent = text || '';
      sstat.className = 'cv2-save-stat' + (kind ? ' ' + kind : '');
    },
    name: () => name.value.trim(),
    gender: () => gender.value,

    // ── the voice section ──
    voiceGender: (g) => { if (g && [...vgender.options].some(o => o.value === g)) vgender.value = g; },
    voiceStatus: (text, kind) => {
      vstat.textContent = text || '';
      vstat.className = 'cv2-save-stat' + (kind ? ' ' + kind : '');
    },
    // Cards straight from the library proxy. The preview is the owner's own sample, played from
    // ElevenLabs rather than copied here - nothing is downloaded until a voice is actually taken.
    voices: (list) => {
      vlist.textContent = '';
      for (const v of list || []) {
        const row = document.createElement('div');
        row.className = 'cv2-voice';

        const txt = document.createElement('div');
        txt.className = 'cv2-voice-txt';
        const nm = document.createElement('div');
        nm.className = 'cv2-voice-name';
        nm.textContent = v.name || v.voice_id;
        const sub = document.createElement('div');
        sub.className = 'cv2-voice-sub';
        sub.textContent = [v.gender, v.age, v.accent, v.descriptive].filter(Boolean).join(' · ');
        txt.appendChild(nm); txt.appendChild(sub);
        row.appendChild(txt);

        if (v.preview_url) {
          const audio = document.createElement('audio');
          audio.src = v.preview_url;
          audio.preload = 'none';
          const play = document.createElement('button');
          play.type = 'button'; play.className = 'cv2-voice-play'; play.textContent = '▶';
          play.title = 'Play the library sample';
          play.addEventListener('click', () => {
            // One at a time, or a click on the fifth row plays over the first four.
            vlist.querySelectorAll('audio').forEach(a => { if (a !== audio) { a.pause(); a.currentTime = 0; } });
            if (audio.paused) audio.play().catch(() => {}); else audio.pause();
          });
          row.appendChild(play); row.appendChild(audio);
        }

        const take = document.createElement('button');
        take.type = 'button'; take.className = 'cv2-voice-take';
        take.textContent = 'Use';
        take.title = 'Add this voice to the account and attach it to this character';
        take.addEventListener('click', () => { if (_hooks.onTakeVoice) _hooks.onTakeVoice(v); });
        row.appendChild(take);

        vlist.appendChild(row);
      }
    },
    // The one that stuck. Shown instead of the list, because the question is answered.
    voiceChosen: (name) => {
      vlist.textContent = '';
      const row = document.createElement('div');
      row.className = 'cv2-voice is-chosen';
      const txt = document.createElement('div');
      txt.className = 'cv2-voice-txt';
      const nm = document.createElement('div');
      nm.className = 'cv2-voice-name';
      nm.textContent = name;
      const sub = document.createElement('div');
      sub.className = 'cv2-voice-sub';
      sub.textContent = 'attached to this character';
      txt.appendChild(nm); txt.appendChild(sub);
      row.appendChild(txt);
      vlist.appendChild(row);
    },
  };
}
