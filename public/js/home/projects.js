/* ════════════════════════════════════════════════════════════════════════════
   THE BLOCK "PROJECTS" - shaped like Merge's open project list. Merge's draft comes first in "all" and "blank" while
   something lies on it.

   The chips - all · blank · talking head · voiceover · highlights, the one chosen remembered (`ugc_home_proj_kind_v1`) - over
   the five projects of that kind changed last (GET /api/home/projects, routes/home.js - one read answers every chip), a row
   each: a small picture (the kind's icon while there is none), the name, the kind and when it was changed. The pointer resting
   on a row shows a card beside it - the project's frame larger, in its own shape (9:16 / 16:9), its length, its fragments or
   clips, when it was changed and made; a press opens the project in Merge (/merge?p=).
   ════════════════════════════════════════════════════════════════════════════ */

import { ICONS } from './icons.js';
import { el, api, ls, lsSet, when, frame } from './util.js';
// "Loading" until the list comes, "did not load" + Try again when it does not (the reason a
// popup), the empty list in the shared part.
import { emptyEl, loadingEl, failedEl } from '../ui-state.js';
import { showError } from '../notice.js';
import { t, tn, lang } from '../i18n/t.js';

const CHIPS = [['all', t('All')], ['blank', t('Blank')], ['talking', t('Talking head')], ['voiceover', t('Voiceover')], ['highlights', t('Highlights')]];
const WORD = { draft: t('draft · not saved'), blank: t('blank'), talking: t('talking head'), voiceover: t('voiceover'), highlights: t('highlights') };
const ICON_OF = { draft: 'blank', blank: 'blank', talking: 'talking', voiceover: 'voiceover', highlights: 'highlights' };
const CHIP_KEY = 'ugc_home_proj_kind_v1';

const _bg = (u) => 'url("' + String(u).replace(/"/g, '%22') + '")';
const _len = (s) => {
  const t = Math.round(+s || 0);
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
};
const _day = (iso) => { const at = Date.parse(iso); return at ? new Date(at).toLocaleDateString(lang() === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };

// What the card says of its length and of what it holds - by its kind.
function _facts(p) {
  const out = [];
  if (p.kind === 'highlights') {
    out.push(p.dur > 0 ? t('video {len}', { len: _len(p.dur) }) : t('no video yet'));
    out.push(p.fragsAll ? tn(p.fragsAll, '{k} of {n} fragment made', '{k} of {n} fragments made', { k: p.frags }) : t('no fragments yet'));
    return out;
  }
  out.push(p.dur > 0 ? _len(p.dur) : t('nothing on the timeline yet'));
  if (p.kind === 'talking') out.push(tn(+p.frags || 0, '{n} fragment', '{n} fragments'));
  if (p.clips) out.push(tn(p.clips, '{n} clip', '{n} clips'));
  return out;
}

// ── the card on hover ────────────────────────────────────────────────────────
let _peek = null;
let _peekT = 0;
function _hidePeek() {
  clearTimeout(_peekT);
  if (_peek) _peek.hidden = true;
}
function _showPeek(row, p) {
  clearTimeout(_peekT);
  _peekT = setTimeout(() => {
    if (!row.isConnected || !row.matches(':hover')) return;
    if (!_peek) {
      _peek = el('div', 'hm-peek');
      _peek.hidden = true;
      document.body.appendChild(_peek);
    }
    const pic = el('div', 'hm-peek-pic' + (p.format === '16:9' ? ' is-wide' : ''));
    if (p.thumb) pic.style.backgroundImage = _bg(p.thumb);
    else { pic.classList.add('is-none'); pic.innerHTML = ICONS[ICON_OF[p.kind]] || ''; }
    const ttl = el('div', 'hm-peek-t', p.title);
    const k = el('div', 'hm-peek-k', WORD[p.kind] || p.kind);
    const f = el('div', 'hm-peek-d', _facts(p).join(' · '));
    const d = el('div', 'hm-peek-d', [t('changed {when}', { when: when(p.updatedAt) || '-' }), p.createdAt ? t('made {day}', { day: _day(p.createdAt) }) : ''].filter(Boolean).join(' · '));
    _peek.replaceChildren(pic, ttl, k, f, d);
    _peek.hidden = false;
    // Beside the row - on its right while there is room, else on its left; its top with the row's, kept on the screen.
    const r = row.getBoundingClientRect();
    const w = _peek.offsetWidth, h = _peek.offsetHeight;
    let x = r.right + 10;
    if (x + w > window.innerWidth - 8) x = Math.max(8, r.left - w - 10);
    const y = Math.max(8, Math.min(window.innerHeight - h - 8, r.top - 6));
    _peek.style.left = Math.round(x) + 'px';
    _peek.style.top = Math.round(y) + 'px';
  }, 180);
}
window.addEventListener('scroll', _hidePeek, true);
document.addEventListener('mousedown', _hidePeek, true);

export function projectsBlock() {
  const f = frame('projects', t('Projects'));
  f.what.textContent = t('· the ones you changed last');
  const all = el('a', null, t('all projects →'));
  all.href = '/merge';
  all.title = t('Merge - every project in its list');
  f.right.appendChild(all);
  const chips = el('div', 'hm-chips');
  const rows = el('div', 'hm-plist');
  f.body.append(chips, rows);

  let data = null;
  let chip = ls(CHIP_KEY, 'all');
  if (!CHIPS.some(c => c[0] === chip)) chip = 'all';

  const paintChips = () => {
    chips.replaceChildren(...CHIPS.map(([k, label]) => {
      const b = el('button', 'hm-chip u-chip' + (k === chip ? ' is-on' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (k === chip) return;
        chip = k;
        lsSet(CHIP_KEY, k);
        paintChips();
        paintRows();
      });
      return b;
    }));
  };
  const row = (p) => {
    const a = el('a', 'hm-prow');
    a.href = '/merge?p=' + encodeURIComponent(p.key);
    const th = el('span', 'hm-pthumb');
    if (p.thumb) th.style.backgroundImage = _bg(p.thumb);
    else th.innerHTML = ICONS[ICON_OF[p.kind]] || '';
    const tx = el('span', 'hm-ptx');
    tx.append(el('b', null, p.title), el('span', null, [WORD[p.kind] || p.kind, when(p.updatedAt)].filter(Boolean).join(' · ')));
    a.append(th, tx);
    a.addEventListener('mouseenter', () => _showPeek(a, p));
    a.addEventListener('mouseleave', _hidePeek);
    return a;
  };
  const paintRows = () => {
    _hidePeek();
    if (!data) return;
    const list = (data.kinds && data.kinds[chip]) || [];
    if (!list.length) {
      const word = (CHIPS.find(c => c[0] === chip) || ['', ''])[1];
      rows.replaceChildren(emptyEl(chip === 'all' ? t('No projects yet - start one in New project.') : t('No {kind} projects yet.', { kind: word })));
      return;
    }
    rows.replaceChildren(...list.map(row));
  };
  const paint = async () => {
    try { data = await api('/api/home/projects'); }
    catch (e) {
      showError(t('Could not read the projects'), { detail: e.message, key: 'home-projects' });
      paintChips();
      if (!data) rows.replaceChildren(failedEl('Projects', () => paint()));
      return;
    }
    paintChips();
    paintRows();
  };
  // The kinds at once, "Loading" under them until the list comes.
  paintChips();
  rows.appendChild(loadingEl('Loading'));
  return { el: f.st, paint };
}
