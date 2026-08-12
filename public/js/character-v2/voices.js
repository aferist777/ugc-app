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
let _searched = false;  // whether a search has been run, so a filter change has something to redo
let _page = 1;          // the library page on screen
let _total = 0;         // how many the current filters match, for the pager
const PAGE = 20;

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
    const what = sample ? 'our own demo' : 'the library sample';
    play.title = 'Play ' + what;
    play.addEventListener('click', () => {
      const box = _els.list;
      box.querySelectorAll('audio').forEach(a => { if (a !== audio) { a.pause(); a.currentTime = 0; } });
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    });
    // The button follows the AUDIO, not the click. A row also stops playing when another row's
    // play pauses it, when the sample runs out, and when play() is refused - drive the label from
    // the click and every one of those leaves a pause sign standing over silence. `play` fires the
    // moment `paused` flips, so the mark still lands instantly even though preload is off.
    const mark = () => {
      const on = !audio.paused;
      play.textContent = on ? '❚❚' : '▶';
      play.title = (on ? 'Pause ' : 'Play ') + what;
      play.classList.toggle('is-playing', on);
    };
    for (const ev of ['play', 'pause', 'ended']) audio.addEventListener(ev, mark);
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

// `note` is off once a library list is on screen: the line is there to say the character has no
// voice YET, and with a dozen candidates underneath it that is already obvious - it would just be
// a row of text between the head and the results.
function _paint(note = true) {
  const box = _els.list;
  box.textContent = '';

  for (const v of _saved) {
    box.appendChild(_row({
      name: v.name || v.voiceId, voiceId: v.voiceId, sample: v.sample, saved: true,
      sub: [v.gender, v.age, v.accent, v.descriptive].filter(Boolean).join(' · ') || 'saved',
    }));
  }
  if (!_saved.length && note) {
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
  // Language and accent. Their values come from the same proxy the list does, so the options are
  // the ones the API actually accepts rather than a list written out here that could drift.
  // Blank means "any", which the route drops from the query - an empty accent= would otherwise
  // be a filter matching nothing rather than no filter at all.
  const lang = document.createElement('select');
  lang.id = 'cv2-vc-lang'; lang.className = 'cv2-vc-sel';
  const accent = document.createElement('select');
  accent.id = 'cv2-vc-accent'; accent.className = 'cv2-vc-sel is-wide';
  const fill = (sel, values, anyLabel, def) => {
    sel.textContent = '';
    const any = document.createElement('option');
    any.value = ''; any.textContent = anyLabel;
    sel.appendChild(any);
    for (const v of values || []) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    }
    if (def && (values || []).includes(def)) sel.value = def;
  };
  fill(lang, [], 'any language');
  fill(accent, [], 'any accent');
  fetch('/api/scen3/voices/filters').then(r => r.json()).then(d => {
    if (!d || !d.success) return;
    // English by default, which is what the search used before there was a control for it.
    fill(lang, d.languages, 'any language', 'en');
    fill(accent, d.accents, 'any accent');
  }).catch(() => {});

  const find = document.createElement('button');
  find.type = 'button'; find.id = 'cv2-vc-find'; find.className = 'cv2-vc-btn';
  find.textContent = 'Search library';
  const params = () => ({ gender: gender.value, language: lang.value, accent: accent.value,
                          page: String(_page), page_size: String(PAGE) });
  find.addEventListener('click', () => { _page = 1; if (_hooks.onFind) _hooks.onFind(params()); });
  // Changing a filter re-runs the search at once. A filter that needs a second click to take
  // effect is a filter you have to remember you changed - but only once a search has been run,
  // or picking a language would fire a search nobody asked for.
  for (const sel of [gender, lang, accent]) {
    sel.addEventListener('change', () => {
      _page = 1;                       // a different filter is a different question
      if (_searched && _hooks.onFind) _hooks.onFind(params());
    });
  }
  head.appendChild(t); head.appendChild(gender); head.appendChild(lang);
  head.appendChild(accent); head.appendChild(find);
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
      _searched = false;
      _page = 1; _total = 0;
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
    results: (list2, total) => {
      _searched = true;
      if (typeof total === 'number') _total = total;
      _paint(!(list2 || []).length);
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
      // At the very bottom, and only when there is more than one page to be on.
      const pages = Math.max(1, Math.ceil(_total / PAGE));
      if (pages > 1) {
        const pager = document.createElement('div');
        pager.className = 'cv2-vc-pager';
        const step = (label, to, on) => {
          const b2 = document.createElement('button');
          b2.type = 'button'; b2.className = 'cv2-vc-page'; b2.textContent = label;
          b2.disabled = !on;
          b2.addEventListener('click', () => { _page = to; if (_hooks.onFind) _hooks.onFind(params()); });
          pager.appendChild(b2);
        };
        step('‹', _page - 1, _page > 1);
        const at = document.createElement('span');
        at.className = 'cv2-vc-page-at';
        at.textContent = _page + ' / ' + pages;
        pager.appendChild(at);
        step('›', _page + 1, _page < pages);
        _els.list.appendChild(pager);
      }
    },
  };
}
