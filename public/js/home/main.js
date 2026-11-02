/* ════════════════════════════════════════════════════════════════════════════
   HOME - the page the app opens on (the owner 2026-10-22; the approved mockup is docs/local-app/mockups/home.html).

   Its own sub-header: the tabs on the left (Overview; the knowledge base comes later), what belongs to the open tab on the
   right ("reset layout"). The Overview is BLOCKS in two columns, each in the gold frame of a talking head's field, no
   numbers; a block is taken by its head and let go anywhere in either column, and where they stand is kept
   (`ugc_home_layout_v2`, mirrored into the library by js/storage-sync.js).

   (phase V70, P13, the owner 2026-11-01, (хп25)-(хп30), (хп42), (хп43)) The left column, top to bottom:
     New project   blank · highlights · talking head · voiceover - a filled gold icon each (js/home/icons.js) and its word;
                   a press is Merge's own "+ new project" by address (/merge?new=…; phase V63's popups come in P14)
     Generate      the pictures chat, the video chat, music & sounds - their WINDOWS over Home (js/home/windows.js)
     Library       character (New Character), prop (New prop), look (New lookbook), environment (New environment) - windows
     Projects      (what Continue was) the chips and the five changed last of a kind, a card on hover (js/home/projects.js)
     New           what came since the last visit (GET /api/home/news?since=) - "mark as seen" - where it stood ((хп42))
   and the right one: First steps and The app, as they were. "Now" went ((хп30)).
     The app       the keys and their balances (GET /api/keys/health), the bot, Cloudflare
   ════════════════════════════════════════════════════════════════════════════ */

import { initNav } from '../app-nav.js';
// (phase V60.1, the owner's (пк4а)) New Character opens HERE - the Library's window, the same module and the same bench
// (`lib_chmake_v1`, one for every page); its rows in Alerts still lead to the Library ((пк5б), chmake.js `_where`).
import * as CM from '../library/chmake.js';
import { showError, showToast } from '../notice.js';
import { $, el, api, ls, lsSet, when, frame, tiles } from './util.js';
import { ICONS } from './icons.js';
import * as WIN from './windows.js';
import { projectsBlock } from './projects.js';

initNav();

// Saved here: the window has closed; a popup says so, with the way to the character on the Library's shelf. The blocks are
// read again - "Make your first character" is done.
CM.init({
  onSaved: (id, name) => {
    showToast({
      mark: '✓', title: 'Saved · ' + (name || 'the character'), where: 'Library · Characters - its voices are chosen there',
      ms: 9000, act: { label: 'open in Library', run: () => { location.href = '/library?shelf=characters&sel=' + encodeURIComponent(id || ''); } },
    });
    for (const k of Object.keys(made)) made[k].paint().catch(() => { /* the block says so itself */ });
  },
});
// "+ new character" and "Make your first character": the window, without leaving Home (the link stays a link to the
// Library's window for a press with a modifier).
function _newCharacter(e) {
  if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  try { CM.open(); } catch (err) { showError('New Character did not open: ' + ((err && err.message) || 'no reason was given')); }
}

// ── the blocks ───────────────────────────────────────────────────────────────
// Each is a frame (js/home/util.js) with a head and a body the block paints; `paint` reads what it shows, `every` paints it
// again on its own beat while the page is looked at.
const BLOCKS = {};
const _none = async () => {};

// ── New project (phase V70) ──
// The kinds of project of Merge's own "+ new project" menu (js/merge-v3/projects.js `?new=`): blank, highlights, talking
// head, voiceover - in the owner's order (2026-11-01). A voiceover (phase V62) is THE voiceover draft, on its setup.
// (phase V63, P14 - the quick-start popups - will open over Home instead.)
BLOCKS.start = () => {
  const f = frame('start', 'New project');
  f.what.textContent = '· opens in Merge';
  f.body.appendChild(tiles([
    { icon: ICONS.blank, label: 'blank', href: '/merge?new=blank', title: 'An empty project - your own clips on the timeline' },
    { icon: ICONS.highlights, label: 'highlights', href: '/merge?new=highlights', title: 'A long video cut into vertical shorts' },
    { icon: ICONS.talking, label: 'talking head', href: '/merge?new=talking', title: 'A character reads a script - frames and clips by its lines' },
    { icon: ICONS.voiceover, label: 'voiceover', href: '/merge?new=voiceover', title: 'A script read in a voice, B-roll over it' },
  ]));
  return { el: f.st, paint: _none };
};

// ── Generate (phase V70, (хп27)) ──
// The chats and the sound window, as windows over Home (js/home/windows.js) - the Library's own; what they make lies in
// IMAGES → Generated, VIDEO → Generated → <model>, Music and SFX → My sounds → Generated, and their Alerts rows lead there.
BLOCKS.generate = () => {
  const f = frame('generate', 'Generate');
  f.what.textContent = '· made into the Library';
  f.body.appendChild(tiles([
    { icon: ICONS.pictures, label: 'pictures', href: '/library?shelf=media&kind=images&open=pictures', title: 'The pictures chat', run: () => WIN.openChat('pictures') },
    { icon: ICONS.video, label: 'video', href: '/library?shelf=media&kind=video&open=videos', title: 'The video chat', run: () => WIN.openChat('videos') },
    { icon: ICONS.audio, label: 'music & sounds', href: '/library?shelf=media&kind=music&open=audio', title: 'Music and sounds - Suno and ElevenLabs', run: () => WIN.openSound() },
  ]));
  return { el: f.st, paint: _none };
};

// ── Library (phase V70, (хп27)) ──
// What the Library keeps and makes: a character (New Character - here since phase V60.1), a prop (New prop), a look (New
// lookbook), an environment (New environment) - each its window over Home.
BLOCKS.library = () => {
  const f = frame('library', 'Library');
  f.what.textContent = '· characters, props, looks, places';
  const lib = el('a', null, 'Library →');
  lib.href = '/library';
  f.right.appendChild(lib);
  f.body.appendChild(tiles([
    { icon: ICONS.character, label: 'character', href: '/library?shelf=characters&make=1', title: 'New Character - a portrait, then a 4K sheet', run: _newCharacter },
    { icon: ICONS.prop, label: 'prop', href: '/library?shelf=media&kind=props&make=1', title: 'New prop - a product for the frames', run: () => WIN.openProp() },
    { icon: ICONS.look, label: 'look', href: '/library?shelf=media&kind=lookbooks&make=1', title: 'New lookbook - what a character wears', run: () => WIN.openGen('lookbook') },
    { icon: ICONS.environment, label: 'environment', href: '/library?shelf=media&kind=environments&make=1', title: 'New environment - a place to stand in', run: () => WIN.openGen('environment') },
  ]));
  return { el: f.st, paint: _none };
};

// ── Projects (phase V70: what Continue was) ──
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
  const f = frame('new', 'New since you were here');
  const seen = el('button', null, 'mark as seen');
  seen.type = 'button';
  seen.addEventListener('click', () => { visit.prev = new Date().toISOString(); lsSet(VISIT, visit); paint(); });
  f.right.appendChild(seen);
  const rows = el('div', 'hm-rows');
  f.body.appendChild(rows);
  const row = (ico, title, sub, go, href, bad) => {
    const r = el('div', 'hm-row' + (bad ? ' is-bad' : ''));
    r.appendChild(el('span', 'hm-ico', ico));
    const tx = el('div', 'hm-tx');
    tx.appendChild(el('b', null, title));
    if (sub) tx.appendChild(el('span', null, sub));
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
    f.what.textContent = '· ' + (when(visit.prev) || 'the last visit');
    let d;
    try { d = await api('/api/home/news?since=' + encodeURIComponent(visit.prev)); }
    catch (e) { rows.replaceChildren(el('div', 'hm-err', 'Could not read what is new: ' + e.message)); return; }
    const out = [];
    const s = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
    if (d.refs && d.refs.n) {
      out.push(row('✈', s(d.refs.n, 'post') + ' from Telegram',
        Object.entries(d.refs.where).map(([k, n]) => k + (n > 1 ? ' (' + n + ')' : '')).join(', '), 'look →', '/library?shelf=media'));
    }
    if (d.renders && d.renders.n) {
      const reveal = window.ugcWindow && window.ugcWindow.reveal;
      out.push(row('✓', s(d.renders.n, 'render') + ' finished',
        Object.entries(d.renders.projects).map(([k, n]) => k + (n > 1 ? ' (' + n + ')' : '')).join(', ') + (d.renders.mb ? ' · ' + d.renders.mb + ' MB' : ''),
        reveal ? 'show in folder' : 'Renders →', reveal ? () => reveal(d.renders.folder) : '/library?shelf=renders'));
    }
    const m = d.made || {};
    const madeBits = [m.pictures && s(m.pictures, 'picture'), m.clips && s(m.clips, 'clip'), m.music && s(m.music, 'track')].filter(Boolean);
    if (madeBits.length) out.push(row('◆', madeBits.join(', ') + ' made', 'IMAGES · Generated, B-rolls, Music', 'Library →', '/library?shelf=media'));
    if (d.failed && d.failed.n) {
      out.push(row('!', s(d.failed.n, 'generation') + ' failed', d.failed.last ? (d.failed.last.title + (d.failed.last.error ? ' · ' + d.failed.last.error : '')).slice(0, 140) : '',
        'Alerts →', () => { const b = $('.sv3-alerts'); if (b) b.click(); }, true));
    }
    rows.replaceChildren(...(out.length ? out : [el('div', 'hm-empty', 'Nothing new since then.')]));
  };
  return { el: f.st, paint, every: 30000 };
};

// ── First steps ──
// (the owner's (H6) and 2026-10-22: "будем показывать пока пользователь сам не закроет этот блок") Seven things a new
// person does first, each ticked off by what is really there - never by a press here; the frame is dashed while any is
// left, solid when none is, and the block stays until "hide" puts it away for good (back from Admin -> This computer).
const STEPS_HIDDEN = 'ugc_home_steps_hidden_v1';
const STEPS = [
  { id: 'kie', title: 'Add the kie.ai key', sub: 'pictures, video, music - the main aggregator', go: 'add', href: '/admin#keys' },
  { id: 'eleven', title: 'Add the ElevenLabs key', sub: 'the voices of the talking heads', go: 'add', href: '/admin#keys' },
  { id: 'cf', title: 'Add the Cloudflare key', sub: 'hosts the references the models fetch · R2 needs a card once', go: 'add', href: '/admin#keys' },
  { id: 'bot', title: 'Connect your Telegram bot', sub: 'send links and media from the phone into REFERENCES', go: 'connect', href: '/admin#keys' },
  { id: 'char', title: 'Make your first character', sub: 'a portrait, then a 4K sheet - Library · Characters', go: 'start', href: '/library?shelf=characters&make=1' },
  { id: 'head', title: 'Make a talking head', sub: 'a scenario → mood & voice → frames chat → video', go: 'start', href: '/merge?new=talking' },
  { id: 'speech', title: 'Download the speech model', sub: 'captions heard on this computer, free · 574 MB', go: 'download', href: '/admin#local' },
];
BLOCKS.steps = () => {
  const f = frame('steps', 'First steps');
  const hide = el('button', null, 'hide');
  hide.type = 'button';
  hide.title = 'Put the first steps away for good - they come back from Admin -> This computer';
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
  f.body.append(prog, list);
  const paint = async () => {
    const [health, tg, cf, counts, heads, speech] = await Promise.all([
      api('/api/keys/health').catch(() => null), api('/api/telegram').catch(() => null), api('/api/cloudflare').catch(() => null),
      api('/api/library/counts').catch(() => null), api('/api/library/shelf/media?filter=heads').catch(() => null),
      api('/api/speech/local').catch(() => null),
    ]);
    const prov = (id) => ((health && health.providers) || []).find((p) => p.id === id) || {};
    const sp = speech && speech.state;
    const done = {
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
    f.what.textContent = '· ' + n + ' of ' + STEPS.length + ' done';
    fill.style.width = Math.round((n / STEPS.length) * 100) + '%';
    count.textContent = n + ' / ' + STEPS.length;
    list.replaceChildren(...STEPS.map((s) => {
      const li = el('li', done[s.id] ? 'is-done' : '');
      li.appendChild(el('span', 'hm-ck', done[s.id] ? '✓' : ''));
      const tx = el('div', 'hm-step-tx');
      tx.appendChild(el('div', 'hm-step-t', s.title));
      tx.appendChild(el('div', 'hm-step-d', s.sub));
      li.appendChild(tx);
      if (!done[s.id]) {
        const a = el('a', 'hm-btn is-gold', s.go);
        a.href = s.href;
        // (phase V60.1) The first character is made here, in New Character's window.
        if (s.id === 'char') a.addEventListener('click', _newCharacter);
        li.appendChild(a);
      }
      return li;
    }));
  };
  return { el: f.st, paint, every: 60000 };
};

// ── The app ──
const ROLE = { 'kie.ai': 'pictures · video · music', elevenlabs: 'voices', openrouter: 'agents', replicate: 'pictures · sources',
  groq: 'captions', anthropic: 'Claude' };
const ORDER = ['kie.ai', 'elevenlabs', 'openrouter', 'replicate', 'groq', 'anthropic'];
const BILLING = { replicate: 'https://replicate.com/account/billing', groq: 'https://console.groq.com/settings/usage',
  anthropic: 'https://console.anthropic.com/settings/billing' };
// What a key's check said, as its balance where there is one: kie.ai "22,975 cr", ElevenLabs "940 of 100,000 chars" (used of
// the month's), OpenRouter "active, 7.4 of 10 left".
function balanceOf(p) {
  const d = String(p.detail || '');
  let m = /^([\d,]+) cr$/.exec(d);
  if (m) return { text: m[1] + ' credits' };
  m = /^([\d,]+) of ([\d,]+) chars$/.exec(d);
  if (m) {
    const used = +m[1].replace(/,/g, ''), cap = +m[2].replace(/,/g, '');
    const left = Math.max(0, cap - used);
    return { text: left.toLocaleString('en-US') + ' of ' + cap.toLocaleString('en-US') + ' chars left', low: cap > 0 && left / cap < 0.1 };
  }
  m = /^active, (.+) left$/.exec(d);
  if (m) return { text: m[1] + ' left' };
  return null;
}
BLOCKS.app = () => {
  const f = frame('app', 'The app');
  f.what.textContent = '· keys, balances, the bot, Cloudflare';
  const adm = el('a', null, 'Admin →');
  adm.href = '/admin';
  f.right.appendChild(adm);
  const box = el('div');
  box.style.display = 'contents';
  f.body.appendChild(box);
  const td = (cls, ...kids) => { const c = el('td', cls); for (const k of kids) c.append(k); return c; };
  const dot = (st) => el('span', 'hm-dot ' + (st === 'ok' ? 'ok' : st === 'down' ? 'down' : st === 'unset' ? '' : 'no'));
  const link = (text, href) => { const a = el('a', null, text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; };
  const paint = async () => {
    const [health, tg, cf] = await Promise.all([
      api('/api/keys/health').catch(() => null), api('/api/telegram').catch(() => null), api('/api/cloudflare').catch(() => null),
    ]);
    const parts = [];
    // keys and balances
    parts.push(el('div', 'hm-subh', 'Keys and balances'));
    const t1 = el('table', 'hm-tbl');
    const provs = new Map(((health && health.providers) || []).map((p) => [p.id, p]));
    for (const id of ORDER) {
      const p = provs.get(id);
      if (!p) continue;
      const tr = el('tr');
      const k = td('k', dot(p.state), p.label || id);
      let v;
      if (p.state === 'unset') v = td('hm-muted', 'no key - ', Object.assign(el('a', null, 'add it in Admin'), { href: '/admin' }));
      else if (p.state !== 'ok') v = td('', el('span', null, 'not working · ' + (p.detail || 'no answer')));
      else {
        const b = balanceOf(p);
        if (b) { const s = el('span', null, b.text); if (b.low) s.style.color = 'var(--warn, oklch(.72 .15 75))'; v = td('', s); }
        else v = td('hm-muted', 'active' + (BILLING[id] ? ' · no balance in its API - ' : ''), ...(BILLING[id] ? [link('billing ↗', BILLING[id])] : []));
      }
      tr.append(k, v, td('r', ROLE[id] || ''));
      t1.appendChild(tr);
    }
    if (!t1.children.length) t1.appendChild(Object.assign(el('tr'), { innerHTML: '<td class="hm-muted">The keys could not be checked.</td>' }));
    parts.push(t1);
    // the bot
    parts.push(el('div', 'hm-subh', 'Telegram bot'));
    const t2 = el('table', 'hm-tbl');
    const tr2 = el('tr');
    if (!tg || !tg.bot) {
      tr2.append(td('k', dot('unset'), 'not set'), td('hm-muted', 'send links and media from the phone into REFERENCES - ', Object.assign(el('a', null, 'connect it in Admin'), { href: '/admin' })), td('r', ''));
    } else {
      const paired = tg.chat && tg.chat.name;
      tr2.append(td('k', dot(tg.error || tg.conflict ? 'down' : paired ? 'ok' : 'down'), '@' + tg.bot.username),
        td('', paired ? 'listens to ' + tg.chat.name + ' only' + (tg.mode === 'receiver' ? ' · through your Cloudflare' : ' · while the app is open')
          : 'not connected yet - send it the code shown in Admin'),
        td('r', tg.queue && tg.queue.waiting ? tg.queue.waiting + ' in the queue' : ''));
    }
    t2.appendChild(tr2);
    parts.push(t2);
    // Cloudflare
    parts.push(el('div', 'hm-subh', 'Cloudflare'));
    const t3 = el('table', 'hm-tbl');
    const tr3 = el('tr');
    if (!cf || !cf.tokenSet) {
      tr3.append(td('k', dot('unset'), 'not set'), td('hm-muted', 'hosts the references the models fetch - ', Object.assign(el('a', null, 'add the key in Admin'), { href: '/admin' })), td('r', ''));
    } else {
      const c = cf.check || {};
      const acc = c.account || cf.account, bkt = c.bucket || cf.bucket;
      const failed = (c.steps || []).find((s) => !s.ok);
      const v = td('');
      if (cf.inUse && acc && bkt) v.append('bucket ', el('b', null, bkt), ' — ', link('open it ↗', 'https://dash.cloudflare.com/' + encodeURIComponent(acc) + '/r2/default/buckets/' + encodeURIComponent(bkt)));
      else if (failed) v.append('not working · ' + failed.id + ' · ' + String(failed.words || '').slice(0, 90));
      else v.append(cf.checking ? 'checking…' : 'not checked yet - see Admin');
      tr3.append(td('k', dot(cf.inUse ? 'ok' : failed ? 'down' : 'unset'), 'key · R2'), v, td('r', cf.inUse ? 'R2 works' : ''));
    }
    t3.appendChild(tr3);
    if (tg && tg.receiver && tg.receiver.script) {
      const r = el('tr');
      r.append(td('k', dot('ok'), 'receiver'), td('', tg.receiver.script + ' on workers.dev - keeps messages while the app is closed'), td('r', ''));
      t3.appendChild(r);
    }
    parts.push(t3);
    box.replaceChildren(...parts);
  };
  return { el: f.st, paint, every: 60000 };
};

// ── the layout: two columns, a block anywhere, kept ──────────────────────────
// (phase V70) A new key: the places kept under the first one (`ugc_home_layout_v1` - Continue, Now) do not fit these blocks;
// it is wiped once, the library's mirror with it (js/storage-sync.js).
const LAYOUT = 'ugc_home_layout_v2';
try { localStorage.removeItem('ugc_home_layout_v1'); } catch (e) { /* a private window */ }
const FIRST = [['start', 'generate', 'library', 'projects', 'new'], ['steps', 'app']];
const cols = [...document.querySelectorAll('#hm-cols .hm-col')];
const made = {};
for (const id of Object.keys(BLOCKS)) {
  if (id === 'steps' && ls(STEPS_HIDDEN, false) === true) continue;   // put away for good (Admin brings it back)
  made[id] = BLOCKS[id]();
}

function place(order) {
  const seen = new Set();
  order.forEach((ids, i) => ids.forEach((id) => { if (made[id] && !seen.has(id)) { cols[i].appendChild(made[id].el); seen.add(id); } }));
  // A block the kept order does not know (one added since, or brought back) goes where it stands at first: before the
  // first block that follows it there.
  FIRST.forEach((ids, i) => ids.forEach((id, at) => {
    if (!made[id] || seen.has(id)) return;
    const next = ids.slice(at + 1).map((x) => made[x] && made[x].el).find((x) => x && x.parentNode === cols[i]);
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
for (const id of Object.keys(made)) {
  const b = made[id];
  b.paint().catch(() => { /* the block says so itself */ });
  if (b.every) setInterval(() => { if (!document.hidden) b.paint().catch(() => {}); }, b.every);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  for (const id of Object.keys(made)) made[id].paint().catch(() => {});
});
// A post the bot brought while this page is open (js/alerts-bell.js): what is new, at once.
window.addEventListener('ugc-references', () => { made.new.paint().catch(() => {}); });
// Something a window made landed (js/home/windows.js): what is new, at once.
WIN.setOnMade(() => { made.new.paint().catch(() => {}); });
