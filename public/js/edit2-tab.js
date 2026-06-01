/* ═══════════════════════════════════════════════════════════════════════════
   edit2-tab.js — Edit v2 bootstrap + main view (window.EDIT2Tab).

   Main view = a responsive grid of project cards (one per session). Clicking a
   card (or its Open button) opens the workspace popup (edit2-popup.js). The ★
   button toggles "show in Merge". Visual identity matches the app's Windows-95
   chrome (beveled faces, #c0c0c0/#d4d0c8, purple/blue accents); UI in English.

   Ф1 = cards + popup shell, read-only. Generation, settings, delete, and the
   closed/open filter arrive in later phases.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const EDIT2Tab = {};
  let _inited = false;

  const STAGE_LABEL = { draft: 'Draft', voicing: 'Voicing', voiced: 'Voiced', producing: 'Producing', done: 'Done' };
  const STAGE_COLOR = { draft: '#7a766e', voicing: '#2e86c1', voiced: '#7a5cae', producing: '#c8801a', done: '#1a8a1a' };

  function _injectStyles() {
    if (document.getElementById('edit2-styles')) return;
    const css = `
#edit2-root, #edit2-modal { --e2-face:#c0c0c0; --e2-panel:#d4d0c8; --e2-light:#fff; --e2-shadow:#808080;
  --e2-ink:#333; --e2-muted:#444; --e2-accent:#2e86c1; --e2-accent-d:#1c5e85; --e2-purple:#7a5cae; --e2-focus:#0a4fb5; }

#edit2-root { padding:10px; font-family:inherit; color:var(--e2-ink); }
#edit2-bar { display:flex; align-items:baseline; gap:8px; margin-bottom:10px; }
#edit2-bar h2 { font-size:13px; margin:0; font-weight:bold; }
#edit2-bar .e2-count { font-size:11px; color:var(--e2-muted); }
#edit2-reopen { display:flex; align-items:center; gap:8px; margin:0 0 12px; padding:6px 8px; background:var(--e2-panel);
  border:2px solid; border-color:var(--e2-light) var(--e2-shadow) var(--e2-shadow) var(--e2-light); }
#edit2-reopen label { font-size:11px; color:var(--e2-ink); font-weight:bold; }
#edit2-reopen select { font-size:11px; padding:2px 4px; max-width:380px; }
.e2-close { color:#aa0000; font-weight:bold; }

#edit2-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:10px; }
.e2-empty { font-size:12px; color:var(--e2-muted); padding:28px 10px; text-align:center; }

/* shared retro button */
.e2-btn { font-size:10px; padding:2px 9px; cursor:pointer; color:var(--e2-ink); background:var(--e2-face);
  border:2px solid; border-color:var(--e2-light) var(--e2-shadow) var(--e2-shadow) var(--e2-light); }
.e2-btn:active { border-color:var(--e2-shadow) var(--e2-light) var(--e2-light) var(--e2-shadow); }
.e2-btn:disabled { color:#999; cursor:default; }
.e2-btn.primary { background:var(--e2-accent); color:#fff; font-weight:bold;
  border-color:#7fc0ec var(--e2-accent-d) var(--e2-accent-d) #7fc0ec; }
.e2-btn:focus-visible, .e2-card:focus-visible { outline:2px solid var(--e2-focus); outline-offset:2px; }

/* card */
.e2-card { background:var(--e2-panel); display:flex; flex-direction:column; cursor:pointer;
  border:2px solid; border-color:var(--e2-light) var(--e2-shadow) var(--e2-shadow) var(--e2-light);
  outline:2px solid transparent; outline-offset:-2px; transition:outline-color .15s ease-out; }
.e2-card:hover { outline-color:var(--e2-accent); }
.e2-card-thumb { width:100%; aspect-ratio:9/16; max-height:210px; object-fit:cover; background:#111; display:block; }
.e2-card-thumb.empty { display:flex; align-items:center; justify-content:center; color:#666; font-size:22px; }
.e2-card-body { padding:6px 7px 4px; display:flex; flex-direction:column; gap:4px; }
.e2-chip-row { display:flex; gap:4px; align-items:center; }
.e2-chip { font-size:9px; padding:1px 6px; border-radius:2px; font-weight:bold; color:#fff; }
.e2-chip-closed { background:#7a766e; }
.e2-card.closed { opacity:.62; transition:opacity .15s ease-out; }
.e2-card.closed:hover { opacity:1; }
.e2-card-title { font-size:11px; font-weight:bold; line-height:1.25; overflow:hidden;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.e2-card-sub { font-size:10px; color:var(--e2-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.e2-prog { display:flex; flex-direction:column; gap:2px; margin-top:3px; }
.e2-prog-row { display:flex; align-items:center; gap:5px; font-size:9px; color:var(--e2-muted); }
.e2-prog-row .lbl { width:48px; flex:0 0 48px; }
.e2-prog-row .num { width:34px; flex:0 0 34px; text-align:right; font-variant-numeric:tabular-nums; }
.e2-bar { flex:1; height:5px; background:#aca89f; border:1px solid var(--e2-shadow); overflow:hidden; }
.e2-bar > i { display:block; height:100%; background:var(--e2-accent); width:0; transition:width .2s ease-out; }
.e2-bar.full > i { background:#1a8a1a; }
.e2-card-actions { display:flex; align-items:center; gap:4px; padding:5px 7px;
  border-top:1px solid var(--e2-shadow); background:var(--e2-face); }
.e2-star { font-size:12px; line-height:1; padding:2px 7px; }
.e2-star.on { color:#cc8800; }
.e2-card-actions .grow { flex:1; }

/* modal */
#edit2-modal { position:fixed; inset:0; z-index:10070; display:flex; align-items:center; justify-content:center;
  background:rgba(0,0,0,.55); animation:e2-fade .15s ease-out; }
.e2-modal-box { background:var(--e2-face); width:min(96vw, 1100px); max-height:92vh; display:flex; flex-direction:column;
  border:2px solid; border-color:var(--e2-light) #404040 #404040 var(--e2-light); box-shadow:0 8px 40px rgba(0,0,0,.5);
  animation:e2-rise .15s ease-out; }
.e2-modal-head { display:flex; align-items:center; gap:8px; padding:7px 10px; background:var(--e2-purple); color:#fff; }
.e2-modal-head b { font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.e2-modal-x { margin-left:auto; background:rgba(255,255,255,.18); color:#fff; border:1px solid rgba(255,255,255,.4);
  border-radius:2px; cursor:pointer; padding:2px 9px; font-size:12px; }
.e2-modal-x:hover { background:rgba(255,255,255,.30); }
.e2-modal-info { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:6px 10px; background:var(--e2-panel);
  border-bottom:1px solid var(--e2-shadow); font-size:10px; color:var(--e2-muted); }
.e2-modal-info .e2-sep { color:#999; }
.e2-table-wrap { overflow:auto; flex:1; min-height:0; background:#bdb9b1; }
table.e2-table { border-collapse:collapse; width:100%; font-size:10px; }
.e2-table th { position:sticky; top:0; z-index:1; background:var(--e2-panel); text-align:left; font-size:10px;
  color:var(--e2-ink); padding:4px 6px; border-bottom:1px solid var(--e2-shadow); }
.e2-table td { border-bottom:1px solid #b0aca4; padding:4px 6px; vertical-align:top; background:#cfcbc3; }
.e2-row.excluded td { opacity:.5; }
.e2-num { color:var(--e2-muted); text-align:center; font-variant-numeric:tabular-nums; }
.e2-line { max-width:360px; white-space:pre-wrap; line-height:1.3; color:var(--e2-ink); }
.e2-thumb { width:46px; height:62px; object-fit:cover; background:#111; border:1px solid var(--e2-shadow); display:block; }
.e2-thumb-empty { display:flex; align-items:center; justify-content:center; color:#777; }
.e2-det { display:flex; gap:5px; align-items:center; }
.e2-det img { width:40px; height:40px; object-fit:cover; border:1px solid var(--e2-shadow); }
.e2-audio { height:26px; width:150px; }
.e2-vidbtn { font-size:10px; padding:2px 8px; cursor:pointer; background:var(--e2-face);
  border:2px solid; border-color:var(--e2-light) var(--e2-shadow) var(--e2-shadow) var(--e2-light); }
.e2-state { font-size:10px; font-weight:bold; }
.e2-state.is-done { color:#1a8a1a; }
.e2-state.is-running { color:#c8801a; }
.e2-state.is-error { color:#c0392b; }
.e2-state.is-none { color:#888; font-weight:normal; }
.e2-state.is-na { color:#aaa; font-weight:normal; }
.e2-modal-foot { display:flex; align-items:center; gap:10px; padding:7px 10px; background:var(--e2-panel);
  border-top:1px solid var(--e2-shadow); }
.e2-foot-hint { font-size:10px; color:var(--e2-muted); }
.e2-foot-status { font-size:11px; color:var(--e2-muted); font-variant-numeric:tabular-nums; }
.e2-line-edit { width:100%; min-width:200px; box-sizing:border-box; font-family:inherit; font-size:11px; line-height:1.3;
  border:1px solid #b0aca4; border-radius:3px; padding:3px 5px; resize:vertical; background:#fff; color:#222; }
.e2-vbtn { font-size:10px; padding:3px 8px; background:#e9e9ec; margin-left:4px; vertical-align:middle; }
.e2-vbtn.go { background:var(--e2-accent); color:#fff; font-weight:600; }
.e2-genvoices { background:var(--e2-purple); color:#fff; font-weight:600; }

/* temporary nav button marker (Edit²) — distinguish from the live Edit */
.combo-mode-btn[data-combo="edit2"] { font-style:italic; }

@keyframes e2-fade { from { opacity:0; } to { opacity:1; } }
@keyframes e2-rise { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) {
  #edit2-modal, .e2-modal-box { animation:none; }
  .e2-card, .e2-bar > i { transition:none; }
}
`;
    const style = document.createElement('style');
    style.id = 'edit2-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function _bar(done, total) {
    const wrap = document.createElement('div');
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    wrap.className = 'e2-bar' + (total > 0 && done >= total ? ' full' : '');
    const fill = document.createElement('i');
    fill.style.width = pct + '%';
    wrap.appendChild(fill);
    return wrap;
  }

  function _progRow(label, done, total) {
    const row = document.createElement('div');
    row.className = 'e2-prog-row';
    const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = label;
    const num = document.createElement('span'); num.className = 'num'; num.textContent = done + '/' + total;
    row.appendChild(lbl);
    row.appendChild(_bar(done, total));
    row.appendChild(num);
    return row;
  }

  function _card(p) {
    const card = document.createElement('div');
    card.className = 'e2-card' + (p.closed ? ' closed' : '');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Open project: ' + p.title);

    // Thumbnail
    if (p.thumb) {
      const img = document.createElement('img');
      img.className = 'e2-card-thumb';
      img.src = p.thumb; img.loading = 'lazy'; img.decoding = 'async'; img.alt = '';
      card.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'e2-card-thumb empty';
      ph.textContent = '🎬';
      card.appendChild(ph);
    }

    // Body
    const body = document.createElement('div');
    body.className = 'e2-card-body';
    const chipRow = document.createElement('div'); chipRow.className = 'e2-chip-row';
    const chip = document.createElement('span');
    chip.className = 'e2-chip';
    chip.textContent = STAGE_LABEL[p.stage] || p.stage;
    chip.style.background = STAGE_COLOR[p.stage] || '#888';
    chipRow.appendChild(chip);
    if (p.closed) {
      const cl = document.createElement('span'); cl.className = 'e2-chip e2-chip-closed'; cl.textContent = 'Closed';
      chipRow.appendChild(cl);
    }
    body.appendChild(chipRow);
    const title = document.createElement('div'); title.className = 'e2-card-title'; title.textContent = p.title;
    body.appendChild(title);
    const sub = document.createElement('div'); sub.className = 'e2-card-sub';
    sub.textContent = [p.scenName, p.obrazName].filter(Boolean).join(' · ') || '—';
    body.appendChild(sub);

    const prog = document.createElement('div'); prog.className = 'e2-prog';
    const cnt = p.counts || {};
    prog.appendChild(_progRow('Voices', cnt.voices || 0, cnt.lines || 0));
    prog.appendChild(_progRow('Mixes',  cnt.mixes  || 0, cnt.mixNeed || 0));
    prog.appendChild(_progRow('Videos', cnt.videos || 0, cnt.lines || 0));
    body.appendChild(prog);
    card.appendChild(body);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'e2-card-actions';
    const openBtn = document.createElement('button');
    openBtn.className = 'e2-btn primary'; openBtn.textContent = 'Open';
    openBtn.addEventListener('click', (e) => { e.stopPropagation(); window.EDIT2Popup?.open(p.sessionKey); });
    actions.appendChild(openBtn);
    const grow = document.createElement('span'); grow.className = 'grow'; actions.appendChild(grow);
    const star = document.createElement('button');
    star.className = 'e2-btn e2-star' + (p.starred ? ' on' : '');
    star.textContent = p.starred ? '★' : '☆';
    star.title = p.starred ? 'In Merge — click to remove' : 'Send to Merge';
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      window.EDIT2?.setStarred(p.sessionKey, !p.starred);
      EDIT2Tab.render();
    });
    actions.appendChild(star);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'e2-btn e2-close'; closeBtn.textContent = '✕';
    closeBtn.title = 'Close project (hide from Edit — reopen from the dropdown above)';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.EDIT2?.closeProject(p.sessionKey);
      EDIT2Tab.render();
    });
    actions.appendChild(closeBtn);
    card.appendChild(actions);

    const open = () => window.EDIT2Popup?.open(p.sessionKey);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); open(); }
    });

    return card;
  }

  EDIT2Tab.render = function () {
    const root = document.getElementById('edit2-root');
    if (!root) return;
    _injectStyles();
    root.innerHTML = '';

    const all     = (window.EDIT2 && EDIT2.listProjects) ? EDIT2.listProjects(true) : [];
    const active  = all.filter(p => !p.closed);
    const closed  = all.filter(p => p.closed);

    // ── Top bar ───────────────────────────────────────────────────────────────
    const bar = document.createElement('div');
    bar.id = 'edit2-bar';
    bar.appendChild(Object.assign(document.createElement('h2'), { textContent: 'Projects' }));
    const count = document.createElement('span'); count.className = 'e2-count';
    count.textContent = active.length + ' active' + (closed.length ? ' · ' + closed.length + ' closed' : '');
    bar.appendChild(count);
    root.appendChild(bar);

    // ── Reopen-closed dropdown (only when there are closed projects) ────────────
    if (closed.length) {
      const row = document.createElement('div');
      row.id = 'edit2-reopen';
      const lbl = document.createElement('label');
      lbl.htmlFor = 'edit2-reopen-sel'; lbl.textContent = 'Reopen closed:';
      const sel = document.createElement('select');
      sel.id = 'edit2-reopen-sel';
      const ph = document.createElement('option');
      ph.value = ''; ph.textContent = 'Select a closed project… (' + closed.length + ')';
      sel.appendChild(ph);
      closed.forEach(p => {
        const o = document.createElement('option');
        o.value = p.sessionKey;
        o.textContent = p.title;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        const key = sel.value;
        if (!key) return;
        window.EDIT2?.reopenProject(key);
        EDIT2Tab.render();
      });
      row.appendChild(lbl);
      row.appendChild(sel);
      root.appendChild(row);
    }

    // ── Active projects grid ────────────────────────────────────────────────────
    if (!active.length) {
      const empty = document.createElement('div');
      empty.className = 'e2-empty';
      if (closed.length) {
        empty.textContent = 'No open projects. Reopen one from the dropdown above.';
      } else {
        const total = (typeof editFrozenSessions !== 'undefined') ? Object.keys(editFrozenSessions).length : 0;
        empty.textContent = total
          ? ('No renderable projects (found ' + total + ' session' + (total === 1 ? '' : 's') + ' — none with cells).')
          : 'No projects yet. Create one from the Scenarios tab, then it appears here.';
      }
      root.appendChild(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.id = 'edit2-grid';
    active.forEach(p => grid.appendChild(_card(p)));
    root.appendChild(grid);
  };

  EDIT2Tab.activate = function () {
    _inited = true;
    EDIT2Tab.render();
  };

  window.EDIT2Tab = EDIT2Tab;
})();
