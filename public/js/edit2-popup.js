/* ═══════════════════════════════════════════════════════════════════════════
   edit2-popup.js — the Edit v2 workspace popup (window.EDIT2Popup).

   Opened from a project card. Renders, for one session, a read-only scenario
   TABLE: one row per scenario line, with stage columns (image · product/pose ·
   voice · video) plus the line text and a per-row action placeholder.

   Ф1 = read-only: real data via EDIT2.buildWorkspace, audio playback works,
   video thumbnails open the existing video popup. Editing + generation buttons
   are wired in later phases (Ф2 voices → Ф3 mixes → Ф4 video). Settings strip is
   a compact read-only summary now; the full settings move here in Ф6.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const EDIT2Popup = {};

  const STAGE_LABEL = { draft: 'Draft', voicing: 'Voicing', voiced: 'Voiced', producing: 'Producing', done: 'Done' };
  const STAGE_COLOR = { draft: '#888', voicing: '#2e86c1', voiced: '#7a5cae', producing: '#c8801a', done: '#1a8a1a' };

  let _lastFocus = null;

  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function _stateCell(state, content) {
    const td = _el('td');
    const span = _el('span', 'e2-state is-' + state);
    if (content != null) span.textContent = content;
    td.appendChild(span);
    return { td, span };
  }

  function _openVideo(src) {
    if (typeof openVideoPopup === 'function') { try { openVideoPopup(src); return; } catch {} }
    window.open(src, '_blank');
  }

  EDIT2Popup.close = function () {
    const ov = document.getElementById('edit2-modal');
    if (ov) ov.remove();
    document.removeEventListener('keydown', _onKey);
    if (_lastFocus && _lastFocus.focus) { try { _lastFocus.focus(); } catch {} }
    _lastFocus = null;
  };

  function _onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); EDIT2Popup.close(); }
  }

  EDIT2Popup.open = function (sessionKey) {
    const model = (window.EDIT2 && EDIT2.buildWorkspace) ? EDIT2.buildWorkspace(sessionKey) : null;
    if (!model) return;
    EDIT2Popup.close();
    _lastFocus = document.activeElement;

    const overlay = _el('div');
    overlay.id = 'edit2-modal';
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) EDIT2Popup.close(); });

    const box = _el('div', 'e2-modal-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Project workspace: ' + model.title);

    // ── Header ────────────────────────────────────────────────────────────────
    const head = _el('div', 'e2-modal-head');
    const chip = _el('span', 'e2-chip');
    chip.textContent = STAGE_LABEL[model.stage] || model.stage;
    chip.style.background = STAGE_COLOR[model.stage] || '#888';
    chip.style.color = '#fff';
    head.appendChild(chip);
    head.appendChild(_el('b', null, model.title));
    const xBtn = _el('button', 'e2-modal-x', '✕');
    xBtn.title = 'Close';
    xBtn.addEventListener('click', EDIT2Popup.close);
    head.appendChild(xBtn);
    box.appendChild(head);

    // ── Info strip (read-only summary; full settings arrive in Ф6) ──────────────
    const info = _el('div', 'e2-modal-info');
    const c = model.counts || {};
    const bits = [
      model.obraz ? ('Character: ' + (model.obraz.name || '—')) : null,
      'Scenario: ' + (model.scenName || '—'),
      'Voices ' + (c.voices || 0) + '/' + (c.lines || 0),
      'Mixes ' + (c.mixes || 0) + '/' + (c.mixNeed || 0),
      'Videos ' + (c.videos || 0) + '/' + (c.lines || 0),
    ].filter(Boolean);
    bits.forEach((t, i) => {
      if (i) info.appendChild(_el('span', 'e2-sep', '·'));
      info.appendChild(_el('span', null, t));
    });
    box.appendChild(info);

    // ── Table ───────────────────────────────────────────────────────────────────
    const wrap = _el('div', 'e2-table-wrap');
    const table = _el('table', 'e2-table');
    const thead = _el('thead');
    const htr = _el('tr');
    ['#', 'Line', 'Image', 'Product / Pose', 'Voice', 'Video', 'Action'].forEach(h => {
      htr.appendChild(_el('th', null, h));
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = _el('tbody');
    model.rows.forEach(row => {
      const tr = _el('tr', 'e2-row' + (row.excluded ? ' excluded' : ''));

      // # number
      tr.appendChild(_el('td', 'e2-num', String(row.idx + 1)));

      // Line text (read-only in Ф1)
      const tdLine = _el('td');
      tdLine.appendChild(_el('div', 'e2-line', row.line || '—'));
      tr.appendChild(tdLine);

      // Image (frame)
      const tdImg = _el('td');
      if (row.frameImage) {
        const img = _el('img', 'e2-thumb');
        img.src = row.frameImage; img.loading = 'lazy'; img.decoding = 'async';
        img.alt = 'Frame ' + (row.idx + 1);
        tdImg.appendChild(img);
      } else {
        tdImg.appendChild(_el('div', 'e2-thumb e2-thumb-empty', '—'));
      }
      tr.appendChild(tdImg);

      // Product / Pose
      const tdDet = _el('td');
      if (row.detInfo) {
        const d = _el('div', 'e2-det');
        if (row.detInfo.thumbPath || row.detInfo.path) {
          const di = _el('img');
          di.src = row.detInfo.thumbPath || row.detInfo.path; di.loading = 'lazy';
          di.alt = row.detInfo.name || 'Product';
          d.appendChild(di);
        }
        d.appendChild(_el('span', null, row.detInfo.name || 'Product'));
        tdDet.appendChild(d);
      } else {
        tdDet.appendChild(_el('span', 'e2-state is-na', model.itemsMode === 'noitems' ? '—' : 'no product'));
      }
      tr.appendChild(tdDet);

      // Voice
      if (row.audioPath) {
        const td = _el('td');
        const a = _el('audio'); a.controls = true; a.preload = 'none'; a.src = row.audioPath;
        a.className = 'e2-audio';
        td.appendChild(a);
        tr.appendChild(td);
      } else if (row.voiceState === 'error') {
        tr.appendChild(_stateCell('error', '✗ error').td);
      } else {
        tr.appendChild(_stateCell('none', '—').td);
      }

      // Video
      const tdVid = _el('td');
      if (row.videoPath) {
        const v = _el('button', 'e2-vidbtn', '▶ play');
        v.title = 'Play video';
        v.addEventListener('click', () => _openVideo(row.videoPath));
        tdVid.appendChild(v);
      } else if (row.videoState === 'running') {
        tdVid.appendChild(_el('span', 'e2-state is-running', '⏳'));
      } else if (row.videoState === 'error') {
        tdVid.appendChild(_el('span', 'e2-state is-error', '✗ ' + (row.videoError || 'error').slice(0, 30)));
      } else {
        tdVid.appendChild(_el('span', 'e2-state is-none', '—'));
      }
      tr.appendChild(tdVid);

      // Action (placeholder — wired in Ф2+)
      const tdAct = _el('td');
      const act = _el('button', 'e2-btn', '🗣');
      act.disabled = true;
      act.title = 'Generation wired in next phases';
      tdAct.appendChild(act);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);

    // ── Footer ──────────────────────────────────────────────────────────────────
    const foot = _el('div', 'e2-modal-foot');
    const genAll = _el('button', 'e2-btn primary', '▶ Generate all');
    genAll.disabled = true;
    genAll.title = 'Wired in Ф4';
    foot.appendChild(genAll);
    foot.appendChild(_el('span', 'e2-foot-hint', 'Read-only preview — generation controls arrive in the next phases.'));
    const closeF = _el('button', 'e2-btn', 'Close');
    closeF.style.marginLeft = 'auto';
    closeF.addEventListener('click', EDIT2Popup.close);
    foot.appendChild(closeF);
    box.appendChild(foot);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', _onKey);
    try { xBtn.focus(); } catch {}
  };

  window.EDIT2Popup = EDIT2Popup;
})();
