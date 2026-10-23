/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN -> AI SETTINGS: the agents' ladder (phase V25, the owner 2026-10-13: "кнопку в admin между api keys и
   import/export с названием ai settings и поместить лесенку туда с пояснением что это такое").

   One ladder for every agent of the app - the chats' writers and everything that reads a picture (lib/agents.js):
   a number, the aggregator, the model, a way to move or remove the step; at most five; saved as it is changed, there
   is no Save button. An aggregator with no key on API keys, or whose key was refused at the last check, cannot be
   chosen (the owner's answer 11), and a step already standing on one is marked as stepped over.

   GET /api/ai-settings when the pane shows, PUT /api/ai-settings { agents } on every change - the order written whole.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const body = document.getElementById('ai-body');
  if (!body) return;
  let st = null;          // { ladder, max, providers: [{ id, label, off, unproven, models: [{ id, label }] }] }
  let msg = '';
  let msgErr = false;
  let busy = false;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const prov = (id) => ((st && st.providers) || []).find(p => p.id === id) || null;
  // The verdict in a word or two for a menu entry; the whole sentence is the step's own line.
  const offWord = (off) => (!off ? '' : /^no key/.test(off) ? 'no key' : 'key refused');

  // ── What this is ─────────────────────────────────────────────────────────
  function explain() {
    const box = el('div', 'ai-say');
    const p = (html) => { const e = el('p'); e.innerHTML = html; box.appendChild(e); };
    p('<b>Agents</b> read what you write and the pictures attached to it, look at the pictures, and answer: a prompt '
      + 'shaped for the model you chose, a description, a plan, a script. Mostly short calls - words and a few pictures '
      + 'in, a short answer back within a minute; some are long work (below).');
    p('<b>Where they work:</b> the pictures chat (the prompt for the picture model); the video chat (the clip\'s '
      + 'prompt, Kling\'s first frame, putting a prompt or a script\'s lines into English); the frames chat of a talking head '
      + '(the frame\'s prompt, ideas); New Character (reading a photo, framing the 4K sheet); New look, New lookbook '
      + 'and New environment (what to make); the talking head (the mood markup of the script, the plan of the first '
      + 'frames, the animation prompts, how a place moves); the 3D Studio (describing a place); highlights (finding the '
      + 'moments of a long video); the scenario generator (the hooks, the script, cleaning it to the narrator, rewriting a '
      + 'paragraph), a source\'s topics and a narrator\'s reading - these are LONG work: each step may take five minutes, '
      + 'and the generator, the topics, the narrator and highlights think at effort medium (the rest at low).');
    p('<b>The ladder:</b> the first step is asked. If it answers nothing, refuses or runs out of time, the next one '
      + 'is asked, and so on down. A step whose aggregator has no key on API keys, or whose key was refused at the '
      + 'last check, is stepped over - and such an aggregator cannot be chosen until its key works. Every model here '
      + 'can see pictures. Long work is PAID ONCE: a step that runs out of time, drops the connection or stops at its '
      + 'length may have been paid for, so the next one is not asked by itself - the work stops and says so, and is '
      + 'asked again only when you press again. A refusal is not paid for: the next step is asked.');
    p('<b>Cost:</b> a Gemini Flash answer is a fraction of a cent. Claude, asked directly with its key on API keys, '
      + 'thinks briefly here and costs more: about 3-6 cents for a message with two pictures on Opus 5.5, about half that '
      + 'on Sonnet 5.5, a fraction of a cent on Haiku 5.5. A script, its topics or the moments of an hour of video read '
      + 'by Claude Sonnet 5.5 cost a few cents to about a dime, by Gemini Flash a cent or two.');
    return box;
  }

  // ── One step ─────────────────────────────────────────────────────────────
  function rung(step, i, n) {
    const p = prov(step.provider);
    const off = p ? p.off : 'not an aggregator of this ladder';
    const row = el('div', 'ai-rung' + (off ? ' is-off' : ''));
    row.appendChild(el('span', 'ai-no', String(i + 1)));
    // A pairing another step already holds cannot be chosen here: the server keeps one of two equal steps, and the
    // step being changed would vanish.
    const used = new Set(st.ladder.filter((_, k) => k !== i).map(s => s.provider + '|' + s.model));

    const ps = el('select', 'ai-sel ai-prov');
    ps.title = 'The aggregator this step asks';
    for (const q of st.providers) {
      const o = el('option', null, q.label + (q.off ? ' - ' + offWord(q.off) : '') + (q.unproven ? ' (not tried yet)' : ''));
      o.value = q.id;
      // An aggregator that cannot be asked cannot be chosen, nor one whose every model is on the other steps; the one
      // this step already stands on stays shown.
      o.disabled = q.id !== step.provider && (!!q.off || q.models.every(m => used.has(q.id + '|' + m.id)));
      o.selected = q.id === step.provider;
      ps.appendChild(o);
    }
    ps.addEventListener('change', () => {
      const q = prov(ps.value);
      if (!q) return;
      const m = q.models.find(x => !used.has(q.id + '|' + x.id)) || q.models[0];
      const next = st.ladder.slice();
      next[i] = { provider: q.id, model: m.id };
      save(next);
    });
    row.appendChild(ps);

    const ms = el('select', 'ai-sel ai-model');
    ms.title = 'The model - every one of them sees pictures';
    for (const m of ((p && p.models) || [{ id: step.model, label: step.model }])) {
      const o = el('option', null, m.label + (used.has(step.provider + '|' + m.id) ? ' - on another step' : ''));
      o.value = m.id;
      o.disabled = used.has(step.provider + '|' + m.id);
      o.selected = m.id === step.model;
      ms.appendChild(o);
    }
    ms.addEventListener('change', () => {
      if (ms.value === step.model) return;
      const next = st.ladder.slice();
      next[i] = { provider: step.provider, model: ms.value };
      save(next);
    });
    row.appendChild(ms);

    row.appendChild(el('span', 'ai-off', off ? 'stepped over: ' + off : ''));

    const move = (to, sym, title) => {
      const b = el('button', 'lib-btn ai-mini', sym);
      b.type = 'button';
      b.title = title;
      b.disabled = to < 0 || to >= n;
      b.addEventListener('click', () => {
        const next = st.ladder.slice();
        next.splice(to, 0, next.splice(i, 1)[0]);
        save(next);
      });
      return b;
    };
    row.appendChild(move(i - 1, '▲', 'Ask this one earlier'));
    row.appendChild(move(i + 1, '▼', 'Ask this one later'));
    const del = el('button', 'lib-btn ai-mini', '−');
    del.type = 'button';
    del.title = n < 2 ? 'The ladder needs one step at least' : 'Remove this step';
    del.disabled = n < 2;
    del.addEventListener('click', () => save(st.ladder.filter((_, k) => k !== i)));
    row.appendChild(del);
    return row;
  }

  // A new step is the first pairing nobody has chosen yet, on an aggregator that can be asked - a row that opens empty
  // saves nothing and looks broken.
  function nextFree() {
    const used = new Set(st.ladder.map(s => s.provider + '|' + s.model));
    for (const q of st.providers) {
      if (q.off) continue;
      const m = q.models.find(x => !used.has(q.id + '|' + x.id));
      if (m) return { provider: q.id, model: m.id };
    }
    return null;
  }

  function paint() {
    body.textContent = '';
    if (!st) { body.appendChild(el('div', 'dio-status', msg || 'reading…')); return; }
    body.appendChild(explain());
    body.appendChild(el('div', 'dio-sec', 'Agents'));
    const list = el('div', 'ai-ladder');
    st.ladder.forEach((s, i) => list.appendChild(rung(s, i, st.ladder.length)));
    body.appendChild(list);
    const free = nextFree();
    const full = st.ladder.length >= st.max;
    const add = el('button', 'lib-btn ai-add', '+ add a step');
    add.type = 'button';
    add.disabled = full || !free || busy;
    add.title = full ? 'Five is the cap - more steps buy waiting, not reliability'
      : !free ? 'Every model an aggregator with a working key offers is on the ladder already' : 'A step asked when the ones above it fail';
    add.addEventListener('click', () => { const f = nextFree(); if (f) save(st.ladder.concat(f)); });
    const foot = el('div', 'dio-actions');
    foot.append(add, el('span', 'adm-count', st.ladder.length + ' of ' + st.max));
    body.appendChild(foot);
    body.appendChild(el('div', 'dio-status' + (msgErr ? ' err' : ''), msg));
    body.querySelectorAll('select, .ai-mini').forEach(c => { if (busy) c.disabled = true; });
  }

  function take(d) {
    if (d && d.success) { st = { ladder: d.ladder, max: d.max, providers: d.providers }; return true; }
    msg = (d && d.error) || 'the server did not answer'; msgErr = true;
    return false;
  }

  function save(list) {
    busy = true; msg = 'saving…'; msgErr = false;
    paint();
    fetch('/api/ai-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agents: list }) })
      .then(r => r.json())
      .then(d => { if (take(d)) msg = 'Saved. The next agent asks this ladder.'; })
      .catch(() => { msg = 'Not saved - the server did not answer.'; msgErr = true; })
      .finally(() => { busy = false; paint(); });
  }

  function load() {
    fetch('/api/ai-settings').then(r => r.json())
      .then(d => { if (take(d)) { msg = ''; msgErr = false; } paint(); })
      .catch(() => { msg = 'Could not read the settings.'; msgErr = true; paint(); });
  }

  document.addEventListener('adm-pane', (e) => { if (e.detail === 'ai') { paint(); load(); } });
})();
