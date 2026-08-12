// CHARACTER v2 — the voices, in the room the smaller image left.
//
// One column, not two modes behind a switch: the character's own voices sit at the top and a
// search drops its results underneath them. Taking a result moves it up into the saved set, which
// is the whole journey, so splitting it across tabs would only hide half of it at a time.
//
// The star is the state AND the control. Gold is the character's voice - `char.voice`, the one id
// every read uses - and grey are the others in `char.voices`. Taking a voice makes it gold,
// because the newest one is the one you just chose on purpose; clicking a grey star makes that
// one gold instead. char-store already treats the starred entry and that field as the same fact,
// so this rides on the existing model rather than inventing a parallel one.

let _hooks = {};
let _els = {};
let _saved = [];        // char.voices
let _star = '';         // char.voice - the gold one

function _row({ name, sub, voiceId, sample, previewUrl, saved }) {
  const row = document.createElement('div');
  row.className = 'cv2-voice' + (saved ? ' is-saved' : '');

  // Play leads the row: listening comes before deciding, and it is the button pressed most.
  // The star sits after the name, where the decision belongs.
  const src0 = sample || previewUrl;
  if (src0) {
    const audio = document.createElement('audio');
    audio.src = src0; audio.preload = 'none';
    const play = document.createElement('button');
    play.type = 'button'; play.className = 'cv2-voice-play'; play.textContent = '▶';
    play.title = sample ? 'Play our own demo' : 'Play the library sample';
    play.addEventListener('click', () => {
      const box = _els.list;
      box.querySelectorAll('audio').forEach(a => { if (a !== audio) { a.pause(); a.currentTime = 0; } });
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    });
    row.appendChild(play); row.appendChild(audio);
  }

  const txt = document.createElement('div');
  txt.className = 'cv2-voice-txt';
  const nm = document.createElement('div');
  nm.className = 'cv2-voice-name';
  nm.textContent = name;
  const sb = document.createElement('div');
  sb.className = 'cv2-voice-sub';
  sb.textContent = sub;
  txt.appendChild(nm); txt.appendChild(sb);
  row.appendChild(txt);

  // Gold when this is the character's voice, grey when it is merely one of theirs, absent for a
  // library result nobody has saved yet. A saved row plays OUR demo when it has one - the v3 read
  // with tags performed, which is how the voice actually gets used - else the library sample.
  if (saved) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'cv2-star' + (voiceId === _star ? ' is-gold' : '');
    star.textContent = '★';
    star.title = voiceId === _star ? 'This is the character\'s voice' : 'Make this the character\'s voice';
    if (voiceId !== _star) star.addEventListener('click', () => { if (_hooks.onStar) _hooks.onStar(voiceId); });
    row.appendChild(star);
  }
  return row;
}

function _paint() {
  const box = _els.list;
  box.textContent = '';

  for (const v of _saved) {
    box.appendChild(_row({
      name: v.name || v.voiceId, voiceId: v.voiceId, sample: v.sample, saved: true,
      sub: [v.gender, v.age, v.accent, v.descriptive].filter(Boolean).join(' · ') || 'saved',
    }));
  }
  if (!_saved.length) {
    const e = document.createElement('div');
    e.className = 'cv2-voice-none';
    e.textContent = 'No voice yet. Search the library below.';
    box.appendChild(e);
  }
}

export function build(host, hooks) {
  _hooks = hooks || {};
  host.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'cv2-voices';

  const head = document.createElement('div');
  head.className = 'cv2-voices-head';
  const t = document.createElement('span');
  t.className = 'cv2-voices-t';
  t.textContent = 'Voice';
  const gender = document.createElement('select');
  gender.id = 'cv2-vc-gender'; gender.className = 'cv2-vc-sel';
  for (const g of ['male', 'female', 'neutral']) {
    const o = document.createElement('option');
    o.value = g; o.textContent = g;
    gender.appendChild(o);
  }
  const find = document.createElement('button');
  find.type = 'button'; find.id = 'cv2-vc-find'; find.className = 'cv2-vc-btn';
  find.textContent = 'Search library';
  find.addEventListener('click', () => { if (_hooks.onFind) _hooks.onFind(gender.value); });
  head.appendChild(t); head.appendChild(gender); head.appendChild(find);
  wrap.appendChild(head);

  const stat = document.createElement('div');
  stat.className = 'cv2-vc-stat'; stat.id = 'cv2-vc-stat';
  wrap.appendChild(stat);

  const list = document.createElement('div');
  list.className = 'cv2-voice-list'; list.id = 'cv2-vc-list';
  wrap.appendChild(list);

  host.appendChild(wrap);
  _els = { gender, find, stat, list };

  return {
    // Called whenever the selected character changes: the voices are theirs, not the page's.
    show: (rec) => {
      _saved = Array.isArray(rec && rec.voices) ? rec.voices.slice() : [];
      _star = String((rec && rec.voice) || '');
      if (rec && rec.gender) gender.value = rec.gender === 'male' ? 'male' : 'female';
      stat.textContent = '';
      stat.className = 'cv2-vc-stat';
      find.disabled = !rec;
      _paint();
    },
    status: (text, kind) => {
      stat.textContent = text || '';
      stat.className = 'cv2-vc-stat' + (kind ? ' ' + kind : '');
    },
    // Results go UNDER the saved ones, in the same column, so taking one is visibly a promotion
    // rather than a jump to another screen.
    results: (list2) => {
      _paint();
      if (!(list2 || []).length) return;
      const sep = document.createElement('div');
      sep.className = 'cv2-voice-sep';
      sep.textContent = 'From the library';
      _els.list.appendChild(sep);
      for (const v of list2) {
        const row = _row({
          name: v.name || v.voice_id, voiceId: v.voice_id, previewUrl: v.preview_url, saved: false,
          sub: [v.gender, v.age, v.accent, v.descriptive].filter(Boolean).join(' · '),
        });
        const take = document.createElement('button');
        take.type = 'button'; take.className = 'cv2-voice-take';
        take.textContent = 'Save';
        take.title = 'Add it to the account and make it this character\'s voice';
        take.addEventListener('click', () => { if (_hooks.onTake) _hooks.onTake(v); });
        row.appendChild(take);
        _els.list.appendChild(row);
      }
    },
  };
}
