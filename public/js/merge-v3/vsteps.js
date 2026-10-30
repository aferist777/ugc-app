/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the video chat's WORKING MESSAGE as a sub-project of its own (phase V16, the owner 2026-10-07: "чтобы чат не
   растягивать, чтобы само сообщение было как бы своим подпроектом"; docs/local-app/PLAN.md "Фаза V16").

   One message holds the whole way from the words to the clip. Its STEPS are paged at its top ("‹ step k of N ›"); each step
   has its VARIANTS - every writing of a prompt, every sheet drawn - and every arrow says on hover what it pages. The variant
   shown is the one that goes on (the prompt "make the video" sends, the sheet the video follows). A step that has just
   begun, or a variant that has just appeared, is shown by itself; what the person paged to is kept across the thread's
   repaints, by the message's id, for the page's life.

   (phase V60.2, the owner 2026-10-29, (вч6а)-(вч10а)) Two steps at most - the video is not a step any more: it stands at the
   head of the message (vidchat.js). The bar of variants at the bottom went: a step puts a small "‹ 2 of 3 ›" where it wants
   it (`pager`) - into the folded line of its prompt, under its sheet. A step may have more than one set of variants (the
   storyboard's step: its prompt's writings and its sheets).

   (phase V60.3, the owner 2026-10-30, (вс2а), (вс4а)) The message is two columns: the steps' line and the step shown stand
   in the left one, under what was asked, the presses under both columns (vidchat.js puts the parts there). The steps' line
   goes into the title line of the step's field when the step takes it (`nav.head()`), else it stands over the step.

   It knows nothing of videos. The description hands it the steps on every read of the thread - { steps, start }:
     { key, title, word, variants: [{ key, sig }], pick, page(v), note(v),
       more: [{ key, word, variants, pick, page(v), note(v) }],      - its other sets of variants
       sig, body(v, box, progs, nav), acts(v, box, nav), freshen(v, nav) }
   `nav.shown(setKey)` - the variant shown of a set (the step's own key is its first set); `nav.pager(setKey)` - the small
   pager of a set, or null when it has one variant; `nav.head()` - the steps' line, for the body to put into its title line;
   `nav.many()` - whether there are two steps. A variant's `sig` says when its view must be drawn again - never its
   text, so a prompt being typed is never rebuilt under the typing; a step's own `sig` (a value, or a function asked at
   every paint) the same for what it shows of another step; `freshen` keeps what changes without a redraw (a price, a
   countdown's words) up to date. `start`: the step a message opens on before the person pages anywhere (else its newest).
   ════════════════════════════════════════════════════════════════════════════ */

const _mem = new Map();     // message id -> { step, vars: { [setKey]: variantKey }, counts: { [setKey]: n }, n }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function arrow(cls, text) {
  const b = el('button', 'vc-nav ' + cls, text);
  b.type = 'button';
  return b;
}

// The sets of a step: its own first, then `more`.
const _sets = (s) => [{ key: s.key, word: s.word, variants: s.variants || [], pick: s.pick, page: s.page, note: s.note }]
  .concat((s.more || []).filter(Boolean).map(x => Object.assign({ variants: [] }, x)));

/**
 * The frame of one working message: its parts to put into the message (`parts`), `paint(spec)` on every read, `goTo`
 * a step by its key, `destroy()` when the message is drawn anew. `progs` are the countdowns of the step shown.
 */
export function stepCard(id) {
  const top = el('div', 'vc-steps');
  const sPrev = arrow('is-prev', '‹');
  const sText = el('span', 'vc-steps-t');
  const sNext = arrow('is-next', '›');
  top.append(sPrev, sText, sNext);
  // Where the steps' line stands when the step shown does not take it into its title line.
  const slot = el('div', 'vc-steps-slot');
  slot.appendChild(top);
  let adopted = false;
  const body = el('div', 'vc-step');
  const acts = el('div', 'vc-card-acts vc-step-acts');
  const progs = new Map();
  let spec = null;
  let sig = '';
  // The variant shown of each set of the step shown, as painted last.
  let now = {};

  const mem = () => {
    let m = _mem.get(id);
    if (!m) { m = { step: null, vars: {}, counts: {}, n: 0 }; _mem.set(id, m); }
    return m;
  };
  const stepsOf = () => (spec ? spec.steps.filter(Boolean) : []);

  // The small pager of a set of the step shown: "‹ 2 of 3 ›", each arrow saying what it pages - null for one variant.
  function pager(setKey) {
    const s = stepsOf().find(x => x.key === mem().step);
    const set = s ? _sets(s).find(x => x.key === (setKey || s.key)) : null;
    if (!set || set.variants.length < 2) return null;
    const i = set.variants.findIndex(v => v.key === mem().vars[set.key]);
    const n = set.variants.length;
    const w = set.word || 'variant';
    const box = el('span', 'vm-pg');
    const p = arrow('is-prev', '‹');
    const t = el('span', 'vm-pg-t', (i + 1) + ' of ' + n);
    const x = arrow('is-next', '›');
    p.disabled = i <= 0;
    x.disabled = i >= n - 1;
    const v = set.variants[i];
    const said = set.note && v ? set.note(v) : '';
    t.title = w + ' ' + (i + 1) + ' of ' + n + (said ? ' · ' + said : '');
    p.title = i > 0 ? '‹ The previous ' + w + ' (' + i + ' of ' + n + ')' : 'This is the first ' + w;
    x.title = i < n - 1 ? 'The next ' + w + ' (' + (i + 2) + ' of ' + n + ') ›' : 'This is the newest ' + w;
    p.setAttribute('aria-label', p.title);
    x.setAttribute('aria-label', x.title);
    p.addEventListener('click', (e) => { e.stopPropagation(); vary(set.key, -1); });
    x.addEventListener('click', (e) => { e.stopPropagation(); vary(set.key, 1); });
    box.append(p, t, x);
    return box;
  }
  const nav = {
    pager, shown: (k) => now[k] || null,
    head: () => { adopted = true; return top; },
    many: () => stepsOf().length > 1,
  };

  function paint(next) {
    if (next) spec = next;
    const steps = stepsOf();
    if (!steps.length) return;
    const m = mem();
    if (m.step == null && spec.start) m.step = spec.start;
    // What has just begun is where the eye goes: a new step, or a new variant of a step.
    if (m.n && steps.length > m.n) m.step = steps[steps.length - 1].key;
    for (const s of steps) {
      for (const set of _sets(s)) {
        const c = set.variants.length;
        if (m.counts[set.key] != null && c > m.counts[set.key]) { m.step = s.key; m.vars[set.key] = set.variants[c - 1].key; }
        m.counts[set.key] = c;
      }
    }
    m.n = steps.length;
    let si = steps.findIndex(s => s.key === m.step);
    if (si < 0) si = steps.length - 1;
    const s = steps[si];
    m.step = s.key;
    now = {};
    const sigs = [];
    for (const set of _sets(s)) {
      let vi = set.variants.findIndex(v => v.key === m.vars[set.key]);
      if (vi < 0) vi = set.variants.findIndex(v => v.key === set.pick);
      if (vi < 0) vi = set.variants.length - 1;
      const v = vi >= 0 ? set.variants[vi] : null;
      m.vars[set.key] = v ? v.key : null;
      now[set.key] = v;
      sigs.push(set.key + ':' + (v ? v.key + ':' + (v.sig || '') : ''));
    }
    const v = now[s.key];

    // The steps, at the top - only where there are two.
    top.hidden = steps.length < 2;
    sText.textContent = 'step ' + (si + 1) + ' of ' + steps.length + ' · ' + s.title;
    sPrev.disabled = si === 0;
    sNext.disabled = si === steps.length - 1;
    sPrev.title = si > 0 ? '‹ The previous step of this video: ' + steps[si - 1].title : 'This is the first step of this video';
    sNext.title = si < steps.length - 1 ? 'The next step of this video: ' + steps[si + 1].title + ' ›' : 'This is the last step so far - the next appears when it begins';
    sPrev.setAttribute('aria-label', sPrev.title);
    sNext.setAttribute('aria-label', sNext.title);

    // The step: drawn again only when the step, a variant shown or what a variant IS has changed.
    const nsig = s.key + '|' + sigs.join(',') + '|' + ((typeof s.sig === 'function' ? s.sig() : s.sig) || '');
    if (nsig !== sig) {
      sig = nsig;
      for (const p of progs.values()) p.detach();
      progs.clear();
      adopted = false;
      body.textContent = '';
      acts.textContent = '';
      s.body(v, body, progs, nav);
      if (s.acts) s.acts(v, acts, nav);
      if (!adopted) slot.appendChild(top);
    } else if (s.freshen) s.freshen(v, nav);
    acts.hidden = !acts.childNodes.length;
    slot.hidden = top.parentNode !== slot || top.hidden;
  }

  function goTo(key) {
    const m = mem();
    if (!stepsOf().some(s => s.key === key)) return;
    m.step = key;
    paint();
  }
  function step(d) {
    const steps = stepsOf();
    const m = mem();
    const t = steps[steps.findIndex(s => s.key === m.step) + d];
    if (!t) return;
    m.step = t.key;
    paint();
  }
  function vary(setKey, d) {
    const m = mem();
    const s = stepsOf().find(x => x.key === m.step);
    const set = s ? _sets(s).find(x => x.key === setKey) : null;
    if (!set) return;
    const t = set.variants[set.variants.findIndex(v => v.key === m.vars[set.key]) + d];
    if (!t) return;
    m.vars[set.key] = t.key;
    if (set.page) set.page(t);
    paint();
  }
  sPrev.addEventListener('click', () => step(-1));
  sNext.addEventListener('click', () => step(1));

  function destroy() {
    for (const p of progs.values()) p.detach();
    progs.clear();
  }
  // The variant shown of a set, as the person left it (null - the set's own pick, or the newest).
  const shown = (key) => mem().vars[key] || null;
  return { parts: [slot, body, acts], paint, goTo, destroy, progs, shown };
}
