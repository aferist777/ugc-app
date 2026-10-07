/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the video chat's WORKING MESSAGE as a sub-project of its own (phase V16, the owner 2026-10-07: "чтобы чат не
   растягивать, чтобы само сообщение было как бы своим подпроектом"; docs/local-app/PLAN.md "Фаза V16").

   One message holds the whole way from the words to the clip. Its STEPS are paged at its top ("‹ step k of N ›"), the
   VARIANTS of the step shown at its bottom ("‹ variant i of M ›") - every writing of a prompt, every sheet drawn,
   every clip made - and every arrow says on hover what it pages. The variant shown is the one that goes on (the
   prompt "make the video" sends, the sheet the video follows, the clip "to timeline" lays), and the line between the
   arrows says so. A step that has just begun, or a variant that has just appeared, is shown by itself; what the
   person paged to is kept across the thread's repaints, by the message's id, for the page's life.

   It knows nothing of videos. The description hands it the steps on every read of the thread:
     { key, title, word, variants: [{ key, sig }], pick, note(v), body(v, box, progs), acts(v, box), page(v), freshen(v) }
   `sig` says when a variant's view must be drawn again - never its text, so a prompt being typed is never rebuilt
   under the typing; `freshen` keeps what changes without a redraw (a price, a countdown's words) up to date.
   ════════════════════════════════════════════════════════════════════════════ */

const _mem = new Map();     // message id -> { step, vars: { [stepKey]: variantKey }, counts: { [stepKey]: n }, n }

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
  const body = el('div', 'vc-step');
  const acts = el('div', 'vc-card-acts vc-step-acts');
  const bottom = el('div', 'vc-vars');
  const vPrev = arrow('is-prev', '‹');
  const vText = el('span', 'vc-vars-t');
  const vNext = arrow('is-next', '›');
  bottom.append(vPrev, vText, vNext);
  const progs = new Map();
  let spec = null;
  let sig = '';

  const mem = () => {
    let m = _mem.get(id);
    if (!m) { m = { step: null, vars: {}, counts: {}, n: 0 }; _mem.set(id, m); }
    return m;
  };
  const stepsOf = () => (spec ? spec.steps.filter(Boolean) : []);

  function paint(next) {
    if (next) spec = next;
    const steps = stepsOf();
    if (!steps.length) return;
    const m = mem();
    // What has just begun is where the eye goes: a new step, or a new variant of a step.
    if (m.n && steps.length > m.n) m.step = steps[steps.length - 1].key;
    for (const s of steps) {
      const c = s.variants.length;
      if (m.counts[s.key] != null && c > m.counts[s.key]) { m.step = s.key; m.vars[s.key] = s.variants[c - 1].key; }
      m.counts[s.key] = c;
    }
    m.n = steps.length;
    let si = steps.findIndex(s => s.key === m.step);
    if (si < 0) si = steps.length - 1;
    const s = steps[si];
    m.step = s.key;
    let vi = s.variants.findIndex(v => v.key === m.vars[s.key]);
    if (vi < 0) vi = s.variants.findIndex(v => v.key === s.pick);
    if (vi < 0) vi = s.variants.length - 1;
    const v = vi >= 0 ? s.variants[vi] : null;
    m.vars[s.key] = v ? v.key : null;

    // The steps, at the top - only where there are two or more.
    top.hidden = steps.length < 2;
    sText.textContent = 'step ' + (si + 1) + ' of ' + steps.length + ' · ' + s.title;
    sPrev.disabled = si === 0;
    sNext.disabled = si === steps.length - 1;
    sPrev.title = si > 0 ? '‹ The previous step of this video: ' + steps[si - 1].title : 'This is the first step of this video';
    sNext.title = si < steps.length - 1 ? 'The next step of this video: ' + steps[si + 1].title + ' ›' : 'This is the last step so far - the next appears when it begins';
    sPrev.setAttribute('aria-label', sPrev.title);
    sNext.setAttribute('aria-label', sNext.title);

    // The step: drawn again only when the step, the variant or what the variant IS has changed.
    const nsig = s.key + '|' + (v ? v.key + ':' + (v.sig || '') : '') + '|' + (s.sig || '');
    if (nsig !== sig) {
      sig = nsig;
      for (const p of progs.values()) p.detach();
      progs.clear();
      body.textContent = '';
      acts.textContent = '';
      s.body(v, body, progs);
      if (s.acts) s.acts(v, acts);
    } else if (s.freshen) s.freshen(v);
    acts.hidden = !acts.childNodes.length;

    // Its variants, at the bottom - only where there are two or more.
    const many = s.variants.length > 1;
    bottom.hidden = !many;
    if (many) {
      const w = s.word || 'variant';
      vText.textContent = w + ' ' + (vi + 1) + ' of ' + s.variants.length + (s.note && s.note(v) ? ' · ' + s.note(v) : '');
      vPrev.disabled = vi === 0;
      vNext.disabled = vi === s.variants.length - 1;
      vPrev.title = vi > 0 ? '‹ The previous ' + w + ' of this step (' + vi + ' of ' + s.variants.length + ')' : 'This is the first ' + w + ' of this step';
      vNext.title = vi < s.variants.length - 1 ? 'The next ' + w + ' of this step (' + (vi + 2) + ' of ' + s.variants.length + ') ›' : 'This is the newest ' + w + ' of this step';
      vPrev.setAttribute('aria-label', vPrev.title);
      vNext.setAttribute('aria-label', vNext.title);
    }
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
  function vary(d) {
    const m = mem();
    const s = stepsOf().find(x => x.key === m.step);
    if (!s) return;
    const t = s.variants[s.variants.findIndex(v => v.key === m.vars[s.key]) + d];
    if (!t) return;
    m.vars[s.key] = t.key;
    if (s.page) s.page(t);
    paint();
  }
  sPrev.addEventListener('click', () => step(-1));
  sNext.addEventListener('click', () => step(1));
  vPrev.addEventListener('click', () => vary(-1));
  vNext.addEventListener('click', () => vary(1));

  function destroy() {
    for (const p of progs.values()) p.detach();
    progs.clear();
  }
  // The variant shown of a step, as the person left it (null - the step's own pick, or the newest).
  const shown = (key) => mem().vars[key] || null;
  return { parts: [top, body, acts, bottom], paint, goTo, destroy, progs, shown };
}
