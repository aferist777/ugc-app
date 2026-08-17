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
let _nameTimer = 0;
let _resume = false;   // finishing an existing draft rather than saving a new character
// How the last thing this panel was told about ended. The caller already says so when it
// reports - status(msg, 'err') on a failure, 'ok' on a good one - so the retry button can
// read the outcome off that instead of being told a second time.
let _lastKind = '';
// Whether the sheet already exists before this form is even filled in - an untouched preset
// brings one with it. Then there is nothing to generate, and the button must not offer to.
let _ready = false;

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
  const { cancel, go, retry, del, name, gender } = _els;
  const busy = _state === 'saving' || _state === 'sheet';
  const exists = _state === 'sheet' || _state === 'saved';   // the record has been created
  cancel.hidden = exists;
  cancel.disabled = busy;

  // `saved` is "the sheet has stopped", which covers both endings - so the button is offered
  // for both, and says which one happened. After a failure it is the way forward and looks
  // like it; after a good one it is a second thought and stays quiet.
  retry.hidden = _state !== 'saved';
  const failed = _lastKind === 'err';
  retry.classList.toggle('is-retry', failed);
  retry.textContent = failed ? 'Try again' : 'Regenerate';
  retry.title = failed ? 'The sheet did not generate — submit it again' : 'Submit the 4K sheet again';
  // A draft can be deleted right up to the moment it stops being one.
  if (del) { del.hidden = !_resume || exists; del.disabled = busy; }
  // Shut while the sheet is being made - that is the point of having a `sheet` state at all.
  go.disabled = busy || (_state === 'form' && !name.value.trim());
  // The button says what pressing it does NOW, not what the stage is called. From the form it
  // starts a 4K generation; once that has stopped, the only thing left is to keep the character.
  // With the sheet already in hand there is no generation to offer: the form is down to a name
  // and a gender, and the button that ends it should say what it does - Save.
  go.textContent = _state === 'saved' ? 'Save'
    : _state === 'sheet' ? 'Generating…'
    : _state === 'saving' ? 'Saving…'
    : _ready ? 'Save' : 'Generate 4K reference';
  // Editable in `form`, and again once the record exists: the sheet takes minutes, and a name is
  // exactly what you reconsider while waiting. Locked only while the record is being made, when
  // there is nothing yet to write a change to.
  name.disabled = _state === 'saving';
  gender.disabled = _state === 'saving';
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
  name.addEventListener('input', () => {
    _syncFoot();
    // Once the character is real, a change here is a change to it. Debounced, because this fires
    // on every keystroke and each one would otherwise be a write.
    if (_state === 'sheet' || _state === 'saved') {
      clearTimeout(_nameTimer);
      _nameTimer = setTimeout(() => {
        const n = name.value.trim();
        if (n && _hooks.onRename) _hooks.onRename(n);
      }, 600);
    }
  });
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
  gender.addEventListener('change', () => {
    if ((_state === 'sheet' || _state === 'saved') && _hooks.onRegender) _hooks.onRegender(gender.value);
  });
  genRow.appendChild(genLab); genRow.appendChild(gender);
  idn.appendChild(genRow);
  wrap.appendChild(idn);

  // ── voice ──
  // Chosen in view mode, not here. Attaching needs a character id anyway, so the form could only
  // ever have offered it after the save - and view mode is where the character is actually looked
  // at, with its reference and its voices in one place. A pointer, not a second copy of the UI.
  const voice = _sec('Voice');
  const vnote = document.createElement('div');
  vnote.className = 'cv2-save-note';
  vnote.textContent = 'Chosen after saving, under the reference in view mode - where the character '
    + 'and its voices are looked at together.';
  voice.appendChild(vnote);
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

  // The sheet's own gear used to sit here, and before that in the Portrait column's header.
  // It is gone: which model draws the sheet is now one row of the sheet ladder, in the
  // settings panel behind the gear in the nav. Two places to set the same thing is two
  // places to set it differently, and this one only existed while the save form was open.

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
  // Only when a draft is being finished. A fresh save has no record to delete, and Cancel is
  // already the way out of one.
  const del = document.createElement('button');
  del.type = 'button'; del.id = 'cv2-save-del'; del.className = 'cv2-save-btn is-del';
  del.textContent = 'Delete';
  del.title = 'Delete this draft and its files';
  del.hidden = true;
  del.addEventListener('click', () => { if (_hooks.onDelete) _hooks.onDelete(); });
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
  foot.appendChild(del); foot.appendChild(cancel);
  foot.appendChild(retry); foot.appendChild(go);
  wrap.appendChild(foot);

  host.appendChild(wrap);
  _els = { name, gender, cancel, go, retry, del, stat: sstat };
  _syncFoot();

  return {
    // Opened afresh each time, so whatever the create column had is what it starts from.
    open: ({ name: n, gender: g, ready } = {}) => {
      _state = 'form';
      _resume = false;
      _ready = !!ready;
      _lastKind = '';          // a fresh save carries none of the last one's outcome
      name.value = n || '';
      if (g && GENDERS.includes(g)) gender.value = g;
      sstat.textContent = '';
      sstat.className = 'cv2-save-stat';
      _syncFoot();
    },
    // Whether this is an existing draft being finished. It decides the Delete button, and the
    // caller passes the draft's id into the save so the record is overwritten, not duplicated.
    setResume: (on) => { _resume = !!on; _syncFoot(); },
    resuming: () => _resume,
    state: () => _state,
    setState: (s) => { _state = s; _syncFoot(); },
    // Re-assert the footer from the panel's own state. A job's control lock restores exactly
    // what it disabled, which would otherwise hand Done back the moment a job ends - including
    // the moment a save ends and the sheet is only just starting.
    sync: _syncFoot,
    status: (text, kind) => {
      sstat.textContent = text || '';
      sstat.className = 'cv2-save-stat' + (kind ? ' ' + kind : '');
      // Only a verdict changes the footer. Progress ticks arrive with no kind at all and must
      // not wipe the memory of how the previous run ended.
      if (kind === 'err' || kind === 'ok') { _lastKind = kind; _syncFoot(); }
    },
    name: () => name.value.trim(),
    gender: () => gender.value,

  };
}
