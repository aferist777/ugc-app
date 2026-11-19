/* ════════════════════════════════════════════════════════════════════════════
   HOME - the page the app opens on.

   No sub-header of its own: "Reset layout" is a quiet button
   in the corner under the blocks. The Overview is BLOCKS in two columns, each in the gold frame of a talking head's field, no
   numbers; a block is taken by its head and let go anywhere in either column, and where they stand is kept
   (`ugc_home_layout_v2`, mirrored into the library by js/storage-sync.js).

   The left column, top to bottom:
     New project   blank · highlights · talking head · voiceover - a filled gold icon each (js/home/icons.js) and its word;
                   a press opens the kind's QUICK-START POPUP over Home (js/home/start.js) - its press makes the project
                   and opens it in Merge; a press with a modifier follows Merge's own "+ new project" by address (/merge?new=…)
     Generate      the pictures chat, the video chat, music & sounds - their WINDOWS over Home (js/home/windows.js)
     Library       character (New Character), prop (New prop), look (New lookbook), environment (New environment) - windows
     Projects      the chips and the five changed last of a kind, a card on hover (js/home/projects.js)
     New           what came since the last visit (GET /api/home/news?since=) - "mark as seen"
   and the right one:
     Guide         the app's book (js/assistant/guide.js) - "Start here", then "Continue", and its parts; no key needed
     First steps   what a new person does first, ticked off by what is really there
     The app       the keys and their balances (GET /api/keys/health), the bot, Cloudflare
   ════════════════════════════════════════════════════════════════════════════ */

import { initNav } from '../app-nav.js';
// New Character opens HERE - the Library's window, the same module and the same bench
// (`lib_chmake_v1`, one for every page); its rows in Alerts still lead to the Library (chmake.js `_where`).
import * as CM from '../library/chmake.js';
import { showError, showToast } from '../notice.js';
// A block being read says "Loading"; one that could not be read says so, with Try again, and
// the reason is a popup - what it showed before stays.
import { emptyEl, loadingEl, failedEl } from '../ui-state.js';
import { $, el, api, ls, lsSet, when, frame, tiles } from './util.js';
import { ICONS } from './icons.js';
import { icon } from '../icons.js';
import { figures } from '../num.js';
import { t, tn, lang } from '../i18n/t.js';
import * as WIN from './windows.js';
import { projectsBlock } from './projects.js';
import { openStart } from './start.js';
import { openGuide, contents as guideContents, placeKept, chaptersRead } from '../assistant/guide.js';

initNav();

// Saved here: the window has closed; a popup says so, with the way to the character on the Library's shelf. The blocks are
// read again - "Make your first character" is done.
CM.init({
  onSaved: (id, name) => {
    showToast({
      mark: '✓', title: t('Saved · {name}', { name: name || t('the character') }), where: t('Library · Characters - its voices are chosen there'),
      ms: 9000, act: { label: t('Open in Library'), run: () => { location.href = '/library?shelf=characters&sel=' + encodeURIComponent(id || ''); } },
    });
    for (const k of Object.keys(made)) made[k].paint().catch(() => { /* the block says so itself */ });
  },
});
// "+ new character" and "Make your first character": the window, without leaving Home (the link stays a link to the
// Library's window for a press with a modifier).
function _newCharacter(e) {
  if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  try { CM.open(); } catch (err) { showError(t('New Character did not open: {why}', { why: (err && err.message) || t('no reason was given') })); }
}

// ── the blocks ───────────────────────────────────────────────────────────────
// Each is a frame (js/home/util.js) with a head and a body the block paints; `paint` reads what it shows, `every` paints it
// again on its own beat while the page is looked at.
const BLOCKS = {};
const _none = async () => {};

// ── New project ──
// The kinds of project of Merge's own "+ new project" menu (js/merge-v3/projects.js `?new=`): blank, highlights, talking
// head, voiceover - in this order. A voiceover is THE voiceover draft, on its setup.
// Each opens its QUICK-START POPUP over Home (js/home/start.js): what the project starts with, then Merge.
BLOCKS.start = () => {
  const f = frame('start', t('New project'));
  f.what.textContent = t('· a quick start, then Merge');
  f.body.appendChild(tiles([
    { icon: ICONS.blank, label: t('Blank'), href: '/merge?new=blank', title: t('An empty project - your own clips on the timeline'), run: () => openStart('blank') },
    { icon: ICONS.highlights, label: t('Highlights'), href: '/merge?new=highlights', title: t('A long video cut into vertical shorts'), run: () => openStart('highlights') },
    { icon: ICONS.talking, label: t('Talking head'), href: '/merge?new=talking', title: t('A character reads a script - frames and clips by its lines'), run: () => openStart('talking') },
    { icon: ICONS.voiceover, label: t('Voiceover'), href: '/merge?new=voiceover', title: t('A script read in a voice, B-roll over it'), run: () => openStart('voiceover') },
  ]));
  return { el: f.st, paint: _none };
};

// ── Generate ──
// The chats and the sound window, as windows over Home (js/home/windows.js) - the Library's own; what they make lies in
// IMAGES → Generated, VIDEO → Generated → <model>, Music and SFX → My sounds → Generated, and their Alerts rows lead there.
BLOCKS.generate = () => {
  const f = frame('generate', t('Generate'));
  f.what.textContent = t('· made into the Library');
  f.body.appendChild(tiles([
    { icon: ICONS.pictures, label: t('Pictures'), href: '/library?shelf=media&kind=images&open=pictures', title: t('The pictures chat'), run: () => WIN.openChat('pictures') },
    { icon: ICONS.video, label: t('Video'), href: '/library?shelf=media&kind=video&open=videos', title: t('The video chat'), run: () => WIN.openChat('videos') },
    { icon: ICONS.audio, label: t('Music & sounds'), href: '/library?shelf=media&kind=music&open=audio', title: t('Music and sounds - Suno and ElevenLabs'), run: () => WIN.openSound() },
  ]));
  return { el: f.st, paint: _none };
};

// ── Library ──
// What the Library keeps and makes: a character (New Character), a prop (New prop), a look (New
// lookbook), an environment (New environment) - each its window over Home.
BLOCKS.library = () => {
  const f = frame('library', t('Library'));
  f.what.textContent = t('· characters, props, looks, places');
  const lib = el('a', null, t('Library →'));
  lib.href = '/library';
  f.right.appendChild(lib);
  f.body.appendChild(tiles([
    { icon: ICONS.character, label: t('Character'), href: '/library?shelf=characters&make=1', title: t('New Character - a portrait, then a 4K sheet'), run: _newCharacter },
    { icon: ICONS.prop, label: t('Prop'), href: '/library?shelf=media&kind=props&make=1', title: t('New prop - a product for the frames'), run: () => WIN.openProp() },
    { icon: ICONS.look, label: t('Look'), href: '/library?shelf=media&kind=lookbooks&make=1', title: t('New lookbook - what a character wears'), run: () => WIN.openGen('lookbook') },
    { icon: ICONS.environment, label: t('Environment'), href: '/library?shelf=media&kind=environments&make=1', title: t('New environment - a place to stand in'), run: () => WIN.openGen('environment') },
  ]));
  return { el: f.st, paint: _none };
};

// ── Projects ──
BLOCKS.projects = projectsBlock;

// ── New since you were here ──
// The last visit: kept as { prev, cur }; a visit more than half an hour after the last one moves `cur` into `prev`.
const VISIT = 'ugc_home_visit_v1';
const visit = (() => {
  const v = ls(VISIT, null) || {};
  const now = new Date().toISOString();
  if (!v.cur) { v.prev = now; v.cur = now; }
  else if (Date.now() - (Date.parse(v.cur) || 0) > 30 * 60000) { v.prev = v.cur; v.cur = now; }
  else v.cur = now;
  lsSet(VISIT, v);
  return v;
})();
BLOCKS.new = () => {
  const f = frame('new', t('New since you were here'));
  const seen = el('button', null, t('mark as seen'));
  seen.type = 'button';
  seen.addEventListener('click', () => { visit.prev = new Date().toISOString(); lsSet(VISIT, visit); paint(); });
  f.right.appendChild(seen);
  const rows = el('div', 'hm-rows');
  rows.appendChild(loadingEl(t('Loading')));
  f.body.appendChild(rows);
  let shown = false;           // painted once - a later failed read leaves what it shows
  const row = (ico, title, sub, go, href, bad) => {
    const r = el('div', 'hm-row' + (bad ? ' is-bad' : ''));
    // the kind of news as one of the interface's icons; figures in mono
    const mark = el('span', 'hm-ico');
    mark.innerHTML = icon(ico, 14);
    r.appendChild(mark);
    const tx = el('div', 'hm-tx');
    tx.appendChild(el('b')).appendChild(figures(title));
    if (sub) tx.appendChild(el('span')).appendChild(figures(sub));
    r.appendChild(tx);
    if (go) {
      const a = el('a', 'hm-go', go);
      if (typeof href === 'function') { a.href = '#'; a.addEventListener('click', (e) => { e.preventDefault(); href(); }); }
      else a.href = href || '#';
      r.appendChild(a);
    }
    return r;
  };
  const paint = async () => {
    f.what.textContent = '· ' + (when(visit.prev) || t('the last visit'));
    let d;
    try { d = await api('/api/home/news?since=' + encodeURIComponent(visit.prev)); }
    catch (e) {
      showError(t('Could not read what is new'), { detail: e.message, key: 'home-new' });
      if (!shown) rows.replaceChildren(failedEl(t('What is new'), () => paint()));
      return;
    }
    const out = [];
    if (d.refs && d.refs.n) {
      out.push(row('download', tn(d.refs.n, '{n} post from Telegram', '{n} posts from Telegram'),
        Object.entries(d.refs.where).map(([k, n]) => k + (n > 1 ? ' (' + n + ')' : '')).join(', '), t('look →'), '/library?shelf=media'));
    }
    if (d.renders && d.renders.n) {
      const reveal = window.ugcWindow && window.ugcWindow.reveal;
      out.push(row('film', tn(d.renders.n, '{n} render finished', '{n} renders finished'),
        Object.entries(d.renders.projects).map(([k, n]) => k + (n > 1 ? ' (' + n + ')' : '')).join(', ') + (d.renders.mb ? ' · ' + d.renders.mb + ' MB' : ''),
        reveal ? t('show in folder') : t('Renders →'), reveal ? () => reveal(d.renders.folder) : '/library?shelf=renders'));
    }
    const m = d.made || {};
    const madeBits = [m.pictures && tn(m.pictures, '{n} picture', '{n} pictures'), m.clips && tn(m.clips, '{n} clip', '{n} clips'),
      m.music && tn(m.music, '{n} track', '{n} tracks')].filter(Boolean);
    if (madeBits.length) out.push(row('image', t('{what} made', { what: madeBits.join(', ') }), t('IMAGES · Generated, B-rolls, Music'), t('Library →'), '/library?shelf=media'));
    if (d.failed && d.failed.n) {
      out.push(row('circle-alert', tn(d.failed.n, '{n} generation failed', '{n} generations failed'), d.failed.last ? (d.failed.last.title + (d.failed.last.error ? ' · ' + d.failed.last.error : '')).slice(0, 140) : '',
        t('Alerts →'), () => { const b = $('.sv3-alerts'); if (b) b.click(); }, true));
    }
    rows.replaceChildren(...(out.length ? out : [emptyEl(t('Nothing new since then.'), { icon: 'circle-check' })]));
    shown = true;
  };
  return { el: f.st, paint, every: 30000 };
};

// ── Guide ──
// The app's book, here from the very first start - it needs no key. The lead row says "Start here" and opens Getting
// started until the book has been opened, then "Continue" and opens it where it was left; under it the book's parts, a press
// opening the book's window over Home at that chapter.
const FIRST_CHAPTER = '01-getting-started';
BLOCKS.guide = () => {
  const f = frame('guide', t('Guide'));
  f.what.textContent = t('· how everything here works · no key needed');
  const lead = el('div', 'hm-row hm-gd-lead');
  const list = el('div', 'hm-gd-list');
  list.appendChild(loadingEl(t('Loading')));
  f.body.append(lead, list);
  let shown = false;
  const paint = async () => {
    let toc;
    try { toc = await guideContents(); }
    catch (e) {
      showError(t('Could not read the guide'), { detail: e.message, key: 'home-guide' });
      if (!shown) { lead.hidden = true; list.replaceChildren(failedEl(t('The guide'), () => paint())); }
      return;
    }
    const at = placeKept();
    const ch = at.chapter && toc.find((c) => c.id === at.chapter);
    const sec = ch && at.section && ch.sections.find((s) => s.id === at.section);
    const first = toc.find((c) => c.id === FIRST_CHAPTER) || toc[0];
    const mark = el('span', 'hm-ico');
    mark.innerHTML = icon('book-open', 14);
    const tx = el('div', 'hm-tx');
    const go = el('button', 'hm-btn u-btn is-s ' + (ch ? 'is-quiet' : 'is-gen'), ch ? t('continue') : t('read'));
    go.type = 'button';
    if (ch) {
      tx.append(el('b', null, t('Continue')), el('span', null, ch.title + (sec ? ' › ' + sec.title : '')));
      go.addEventListener('click', () => openGuide(at));
    } else {
      tx.append(el('b', null, t('Start here · {chapter}', { chapter: first ? first.title : t('Getting started') })), el('span', null, t('the keys, Home, your first project')));
      go.addEventListener('click', () => openGuide({ chapter: first ? first.id : FIRST_CHAPTER }));
    }
    lead.hidden = false;
    lead.replaceChildren(mark, tx, go);
    list.replaceChildren(...toc.map((c) => {
      const b = el('button', 'hm-gd-ch' + (ch && c.id === ch.id ? ' is-cur' : ''));
      b.type = 'button';
      b.title = c.title;
      const num = /^(\d\d)-/.exec(c.id);
      b.append(el('span', 'hm-gd-n', num ? String(+num[1]) : '·'), el('span', 'hm-gd-t', c.title));
      b.addEventListener('click', () => openGuide({ chapter: c.id }));
      return b;
    }));
    shown = true;
  };
  return { el: f.st, paint };
};

// ── First steps ──
// Eight things a new person does first, each ticked off by what is really there - never by a press here: the first is
// reading Getting started (the book remembers the chapters opened); the frame is dashed while any is left, solid when
// none is, and the block stays until "hide" puts it away for good (back from Admin -> This computer).
const STEPS_HIDDEN = 'ugc_home_steps_hidden_v1';
const STEPS = [
  { id: 'guide', title: t('Read Getting started'), sub: t('the guide\'s first chapter - the keys, Home, your first project'), go: t('read'), href: '#', run: () => openGuide({ chapter: FIRST_CHAPTER }) },
  { id: 'kie', title: t('Add the kie.ai key'), sub: t('pictures, video, music - the main aggregator'), go: t('add'), href: '/admin#keys' },
  { id: 'eleven', title: t('Add the ElevenLabs key'), sub: t('the voices of the talking heads'), go: t('add'), href: '/admin#keys' },
  { id: 'cf', title: t('Add the Cloudflare key'), sub: t('hosts the references the models fetch · R2 needs a card once'), go: t('add'), href: '/admin#keys' },
  { id: 'bot', title: t('Connect your Telegram bot'), sub: t('send links and media from the phone into REFERENCES'), go: t('connect'), href: '/admin#keys' },
  { id: 'char', title: t('Make your first character'), sub: t('a portrait, then a 4K sheet - Library · Characters'), go: t('start'), href: '/library?shelf=characters&make=1' },
  { id: 'head', title: t('Make a talking head'), sub: t('a scenario → mood & voice → frames chat → video'), go: t('start'), href: '/merge?new=talking' },
  { id: 'speech', title: t('Download the speech model'), sub: t('captions heard on this computer, free · 574 MB'), go: t('download'), href: '/admin#local' },
];
BLOCKS.steps = () => {
  const f = frame('steps', t('First steps'));
  const hide = el('button', null, t('hide'));
  hide.type = 'button';
  hide.title = t('Put the first steps away for good - they come back from Admin -> This computer');
  hide.addEventListener('click', () => {
    lsSet(STEPS_HIDDEN, true);
    f.st.remove();
    keep();
  });
  f.right.appendChild(hide);
  const prog = el('div', 'hm-progress');
  const bar = el('div', 'hm-bar');
  const fill = el('i');
  bar.appendChild(fill);
  const count = el('span');
  prog.append(bar, count);
  const list = el('ol', 'hm-steps');
  const wait = loadingEl(t('Loading'));
  prog.hidden = true;
  f.body.append(prog, list, wait);
  let shown = false;
  const paint = async () => {
    // A read that fails does not tick its step off in silence ("0 of 7 done"): the steps
    // are not drawn from half an answer - what was shown stays, the first time the body says it did not load.
    let bad = null;
    const read = (u) => api(u).catch((e) => { bad = bad || e; return null; });
    const [health, tg, cf, counts, heads, speech] = await Promise.all([
      read('/api/keys/health'), read('/api/telegram'), read('/api/cloudflare'),
      read('/api/library/counts'), read('/api/library/shelf/media?filter=heads'), read('/api/speech/local'),
    ]);
    if (bad) {
      showError(t('Could not read the first steps'), { detail: bad.message, key: 'home-steps' });
      if (!shown) { prog.hidden = true; list.replaceChildren(); wait.replaceWith(failedEl(t('First steps'), () => paint())); }
      return;
    }
    f.body.querySelectorAll(':scope > .u-loading, :scope > .u-failed').forEach(x => x.remove());
    prog.hidden = false;
    shown = true;
    const prov = (id) => ((health && health.providers) || []).find((p) => p.id === id) || {};
    const sp = speech && speech.state;
    const done = {
      guide: chaptersRead().includes(FIRST_CHAPTER),
      kie: prov('kie.ai').state === 'ok',
      eleven: prov('elevenlabs').state === 'ok',
      cf: !!(cf && cf.inUse),
      bot: !!(tg && tg.chat && tg.chat.name),
      char: !!(counts && counts.counts && counts.counts.characters > 0),
      head: !!(heads && heads.items && heads.items.length),
      // A computer the recognition is not built for has nothing to download: the step is not its.
      speech: !!(sp && (sp.platform === false || (sp.model && sp.model.present))),
    };
    const n = STEPS.filter((s) => done[s.id]).length;
    f.st.classList.toggle('is-todo', n < STEPS.length);
    f.what.replaceChildren(figures('· ' + t('{n} of {all} done', { n, all: STEPS.length })));
    fill.style.width = Math.round((n / STEPS.length) * 100) + '%';
    count.replaceChildren(figures(n + ' / ' + STEPS.length));
    // Gold only at the first step not done - its ring and its button; the others' buttons are quiet, a
    // step done is ticked in the one green.
    const next = STEPS.find((s) => !done[s.id]);
    list.replaceChildren(...STEPS.map((s) => {
      const li = el('li', done[s.id] ? 'is-done' : s === next ? 'is-next' : '');
      const ck = el('span', 'hm-ck');
      if (done[s.id]) ck.innerHTML = icon('check', 12);
      li.appendChild(ck);
      const tx = el('div', 'hm-step-tx');
      tx.appendChild(el('div', 'hm-step-t', s.title));
      tx.appendChild(el('div', 'hm-step-d', s.sub));
      li.appendChild(tx);
      if (!done[s.id]) {
        const a = el('a', 'hm-btn u-btn is-s ' + (s === next ? 'is-gen' : 'is-quiet'), s.go);
        a.href = s.href;
        // The first character is made here, in New Character's window; the guide opens over Home.
        if (s.id === 'char') a.addEventListener('click', _newCharacter);
        if (s.run) a.addEventListener('click', (e) => { e.preventDefault(); s.run(); });
        li.appendChild(a);
      }
      return li;
    }));
  };
  return { el: f.st, paint, every: 60000 };
};

// ── The app ──
const ROLE = { 'kie.ai': t('pictures · video · music'), elevenlabs: t('voices'), openrouter: t('agents'), replicate: t('pictures · sources'),
  groq: t('captions'), anthropic: 'Claude' };
const ORDER = ['kie.ai', 'elevenlabs', 'openrouter', 'replicate', 'groq', 'anthropic'];
const BILLING = { replicate: 'https://replicate.com/account/billing', groq: 'https://console.groq.com/settings/usage',
  anthropic: 'https://console.anthropic.com/settings/billing' };
// What a key's check said, as its balance where there is one: kie.ai "1,250 cr", ElevenLabs "940 of 100,000 chars" (used of
// the month's), OpenRouter "active, 7.4 of 10 left".
function balanceOf(p) {
  const d = String(p.detail || '');
  let m = /^([\d,]+) cr$/.exec(d);
  if (m) return { text: t('{n} credits', { n: m[1] }) };
  m = /^([\d,]+) of ([\d,]+) chars$/.exec(d);
  if (m) {
    const used = +m[1].replace(/,/g, ''), cap = +m[2].replace(/,/g, '');
    const left = Math.max(0, cap - used);
    const loc = lang() === 'ru' ? 'ru-RU' : 'en-US';
    return { text: t('{left} of {cap} chars left', { left: left.toLocaleString(loc), cap: cap.toLocaleString(loc) }), low: cap > 0 && left / cap < 0.1 };
  }
  m = /^active, (.+) left$/.exec(d);
  if (m) return { text: t('{what} left', { what: m[1] }) };
  return null;
}
BLOCKS.app = () => {
  const f = frame('app', t('The app'));
  f.what.textContent = t('· keys, balances, the bot, Cloudflare');
  const adm = el('a', null, t('Admin →'));
  adm.href = '/admin';
  f.right.appendChild(adm);
  const box = el('div');
  box.style.display = 'contents';
  box.appendChild(loadingEl(t('Loading')));
  f.body.appendChild(box);
  let shown = false;
  const td = (cls, ...kids) => { const c = el('td', cls); for (const k of kids) c.append(k); return c; };
  // A state is a dot AND its word, in a column of its own - not a colour alone; one green for "works".
  const dot = (st, word) => {
    const c = el('td', 's');
    const s = el('span', 'hm-state');
    s.append(el('span', 'hm-dot ' + (st === 'ok' ? 'ok' : st === 'down' ? 'down' : st === 'unset' ? '' : 'no')), word);
    c.appendChild(s);
    return c;
  };
  const WORD = { ok: t('works'), down: t('not working'), unset: t('no key') };
  const link = (text, href) => { const a = el('a', null, text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; };
  const paint = async () => {
    // A failed read is said - never "not set - connect it in Admin" for a bot or a key that
    // could only not be read; what was shown stays, the first time each part that failed says it did not load.
    const bad = {};
    const read = (k, u) => api(u).catch((e) => { bad[k] = e; return null; });
    const [health, tg, cf] = await Promise.all([read('keys', '/api/keys/health'), read('bot', '/api/telegram'), read('cf', '/api/cloudflare')]);
    const failed = Object.keys(bad);
    if (failed.length) {
      showError(t('Could not read {what}', { what: failed.map(k => ({ keys: t('the keys'), bot: t('the bot'), cf: 'Cloudflare' })[k]).join(', ') }),
        { detail: bad[failed[0]].message, key: 'home-app' });
      if (shown) return;
    }
    const parts = [];
    // keys and balances
    parts.push(el('div', 'hm-subh', t('Keys and balances')));
    const t1 = el('table', 'hm-tbl');
    const provs = new Map(((health && health.providers) || []).map((p) => [p.id, p]));
    for (const id of ORDER) {
      const p = provs.get(id);
      if (!p) continue;
      const tr = el('tr');
      const k = td('k', p.label || id);
      let v;
      if (p.state === 'unset') v = td('hm-muted', Object.assign(el('a', null, t('add it in Admin')), { href: '/admin' }));
      else if (p.state !== 'ok') v = td('', el('span', null, p.detail || t('no answer')));
      else {
        const b = balanceOf(p);
        if (b) { const s = el('span'); s.appendChild(figures(b.text)); if (b.low) s.style.color = 'var(--warn)'; v = td('', s); }
        else v = td('hm-muted', BILLING[id] ? t('no balance in its API - ') : '', ...(BILLING[id] ? [link(t('billing ↗'), BILLING[id])] : []));
      }
      tr.append(k, dot(p.state, WORD[p.state] || t('refused')), v, td('r', ROLE[id] || ''));
      t1.appendChild(tr);
    }
    if (bad.keys) parts.push(failedEl(t('The keys'), () => paint(), { line: true }));
    else {
      if (!t1.children.length) { const row = el('tr'); row.appendChild(el('td', 'hm-muted', t('The keys could not be checked.'))); t1.appendChild(row); }
      parts.push(t1);
    }
    // the bot
    parts.push(el('div', 'hm-subh', t('Telegram bot')));
    const t2 = el('table', 'hm-tbl');
    const tr2 = el('tr');
    if (bad.bot) tr2.appendChild(Object.assign(td('', failedEl(t('The bot'), () => paint(), { line: true })), { colSpan: 4 }));
    else if (!tg || !tg.bot) {
      tr2.append(td('k', t('bot')), dot('unset', t('not set')), td('hm-muted', t('send links and media from the phone into REFERENCES - '), Object.assign(el('a', null, t('connect it in Admin')), { href: '/admin' })), td('r', ''));
    } else {
      const paired = tg.chat && tg.chat.name;
      const down = tg.error || tg.conflict;
      tr2.append(td('k', '@' + tg.bot.username), dot(down ? 'down' : paired ? 'ok' : 'down', down ? t('not working') : paired ? t('works') : t('not connected')),
        td('', paired ? t('listens to {name} only', { name: tg.chat.name }) + ' · ' + (tg.mode === 'receiver' ? t('through your Cloudflare') : t('while the app is open'))
          : t('send it the code shown in Admin')),
        td('r', figures(tg.queue && tg.queue.waiting ? t('{n} in the queue', { n: tg.queue.waiting }) : '')));
    }
    t2.appendChild(tr2);
    parts.push(t2);
    // Cloudflare
    parts.push(el('div', 'hm-subh', 'Cloudflare'));
    const t3 = el('table', 'hm-tbl');
    const tr3 = el('tr');
    if (bad.cf) tr3.appendChild(Object.assign(td('', failedEl(t('Cloudflare'), () => paint(), { line: true })), { colSpan: 4 }));
    else if (!cf || !cf.tokenSet) {
      tr3.append(td('k', t('key · R2')), dot('unset', t('not set')), td('hm-muted', t('hosts the references the models fetch - '), Object.assign(el('a', null, t('add the key in Admin')), { href: '/admin' })), td('r', ''));
    } else {
      const c = cf.check || {};
      const acc = c.account || cf.account, bkt = c.bucket || cf.bucket;
      const failed = (c.steps || []).find((s) => !s.ok);
      const v = td('');
      if (cf.inUse && acc && bkt) v.append(t('bucket') + ' ', el('b', null, bkt), ' - ', link(t('open it ↗'), 'https://dash.cloudflare.com/' + encodeURIComponent(acc) + '/r2/default/buckets/' + encodeURIComponent(bkt)));
      else if (failed) v.append(failed.id + ' · ' + String(failed.words || '').slice(0, 90));
      else v.append(cf.checking ? '' : t('see Admin'));
      tr3.append(td('k', t('key · R2')), dot(cf.inUse ? 'ok' : failed ? 'down' : 'unset', cf.inUse ? t('works') : failed ? t('not working') : cf.checking ? t('checking') : t('not checked')),
        v, td('r', cf.inUse ? t('R2 works') : ''));
    }
    t3.appendChild(tr3);
    if (tg && tg.receiver && tg.receiver.script) {
      const r = el('tr');
      r.append(td('k', t('receiver')), dot('ok', t('works')), td('', t('{script} on workers.dev - keeps messages while the app is closed', { script: tg.receiver.script })), td('r', ''));
      t3.appendChild(r);
    }
    parts.push(t3);
    box.replaceChildren(...parts);
    if (!failed.length) shown = true;
  };
  return { el: f.st, paint, every: 60000 };
};

// ── the layout: two columns, a block anywhere, kept ──────────────────────────
const LAYOUT = 'ugc_home_layout_v2';
const FIRST = [['start', 'generate', 'library', 'projects', 'new'], ['guide', 'steps', 'app']];
const cols = [...document.querySelectorAll('#hm-cols .hm-col')];
const made = {};
for (const id of Object.keys(BLOCKS)) {
  if (id === 'steps' && ls(STEPS_HIDDEN, false) === true) continue;   // put away for good (Admin brings it back)
  made[id] = BLOCKS[id]();
}

function place(order) {
  const seen = new Set();
  order.forEach((ids, i) => ids.forEach((id) => { if (made[id] && !seen.has(id)) { cols[i].appendChild(made[id].el); seen.add(id); } }));
  // A block the kept order does not know (one added since, or brought back) goes where it stands at first: on top of its
  // column when it is first there, else before the first block that follows it there.
  FIRST.forEach((ids, i) => ids.forEach((id, at) => {
    if (!made[id] || seen.has(id)) return;
    const next = at === 0 ? cols[i].firstElementChild
      : ids.slice(at + 1).map((x) => made[x] && made[x].el).find((x) => x && x.parentNode === cols[i]);
    cols[i].insertBefore(made[id].el, next || null);
    seen.add(id);
  }));
}
const saved = ls(LAYOUT, null);
place(Array.isArray(saved) && saved.length === 2 ? saved : FIRST);
const keep = () => lsSet(LAYOUT, cols.map((c) => [...c.children].map((b) => b.dataset.block).filter(Boolean)));

const line = el('div', 'hm-drop');
let dragged = null;
for (const id of Object.keys(made)) {
  const b = made[id].el;
  b.querySelector('.hm-head').addEventListener('mousedown', (e) => { if (!e.target.closest('a,button')) b.draggable = true; });
  b.addEventListener('dragstart', (e) => { dragged = b; b.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-home-block', id); });
  b.addEventListener('dragend', () => { b.classList.remove('is-dragging'); b.draggable = false; line.remove(); dragged = null; });
  document.addEventListener('mouseup', () => { if (!dragged) b.draggable = false; });
}
for (const col of cols) {
  col.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    const after = [...col.querySelectorAll('.hm-st:not(.is-dragging)')].find((x) => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (after) col.insertBefore(line, after); else col.appendChild(line);
  });
  col.addEventListener('drop', (e) => { if (!dragged) return; e.preventDefault(); if (line.parentNode) line.replaceWith(dragged); keep(); });
}
$('#hm-reset').addEventListener('click', () => { place(FIRST); keep(); });

// ── painting, and painting again ──────────────────────────────────────────────
// Each block paints at once; the ones about work in flight again on their own beat, while the page is looked at.
// A block that throws while it draws is said - a popup, once per block - not lost.
const _drawn = (id) => (e) => showError(t('A block of Home could not be drawn'), { detail: id + ': ' + ((e && e.message) || e), key: 'home-paint-' + id });
const _paint = (id) => { const b = made[id]; return b ? b.paint().catch(_drawn(id)) : null; };
const _first = [];
for (const id of Object.keys(made)) {
  const b = made[id];
  _first.push(_paint(id));
  if (b.every) setInterval(() => { if (!document.hidden) _paint(id); }, b.every);
}
// The blocks drawn (or 4 s gone) and the page idle: the windows' code and sheets read beforehand (js/home/windows.js).
Promise.race([Promise.allSettled(_first), new Promise((res) => setTimeout(res, 4000))]).then(() => {
  if (window.requestIdleCallback) requestIdleCallback(() => WIN.preload(), { timeout: 2000 });
  else setTimeout(() => WIN.preload(), 300);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  for (const id of Object.keys(made)) _paint(id);
});
// A post the bot brought while this page is open (js/alerts-bell.js): what is new, at once.
window.addEventListener('ugc-references', () => _paint('new'));
// Something a window made landed (js/home/windows.js): what is new, at once.
WIN.setOnMade(() => _paint('new'));
// The guide's window closed: where it was left, and whether Getting started has been read.
window.addEventListener('ugc:guide', (e) => { if (!(e.detail && e.detail.open)) { _paint('guide'); _paint('steps'); } });
