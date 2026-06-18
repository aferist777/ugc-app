/* ════════════════════════════════════════════════════════════════════════
   edit2-new-from-scenario.js — "New project from a saved scenario" popup,
   opened from the ＋ cell in the Edit² projects grid.

   DELIBERATELY SELF-CONTAINED: it does NOT reuse the Scenarios-tab popup code.
   Each tab is being split into its own standalone HTML page, so the Edit tab
   owns its own copy of the scenario picker + routing + casting + project build.
   The only shared surface is the saved-scenario REST store (/api/scenarios-v2)
   and the global Edit² session map (editFrozenSessions) / EDIT2Popup / EDIT2Tab.

   window.EditNewFromScenario.open()  ← called by the ＋ grid cell.
   ════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const API = '/api/scenarios-v2';
  const $esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let _ov = null;                 // master/detail overlay element
  let _st = null;                 // { list, selId, search }
  let _types = null;              // [{id,label}] cached for type labels

  // ── shared globals (loaded by the Edit² scripts) ──────────────────────────
  function _FZ() { return (typeof editFrozenSessions !== 'undefined') ? editFrozenSessions : (window.editFrozenSessions || {}); }
  function _obrazList() { try { return (typeof getObrazы === 'function') ? getObrazы() : []; } catch { return []; } }
  function _gn(g) { const s = String(g || '').toLowerCase(); return (s === 'male' || s === 'female') ? s : 'any'; }
  function _genderObrazy(g) { const all = _obrazList(); const ng = _gn(g); const f = (ng === 'any') ? all : all.filter(o => _gn(o.gender) === ng); return f.length ? f : all; }
  function _voiceDefaultId(g) { const list = window.ELEVENLABS_VOICES || []; const ng = _gn(g); const want = ng === 'male' ? 'm' : ng === 'female' ? 'f' : null; const m = (want ? list.find(v => v.gender === want) : null) || list[0]; return m ? m.id : ''; }
  function _typeLabel(id) { const t = (_types || []).find(x => x.id === id); return (t && t.label) || id; }

  // ── styles (scoped, independent of pl-* and e2-*) ─────────────────────────
  function _css() {
    if (document.getElementById('enfs-styles')) return;
    const s = document.createElement('style');
    s.id = 'enfs-styles';
    s.textContent = `
.enfs-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99980;font-family:inherit}
.enfs-box{background:#f4f3f0;color:#222;width:1000px;max-width:95vw;height:80vh;max-height:80vh;border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden}
.enfs-hd{display:flex;align-items:center;gap:8px;padding:10px 14px;background:linear-gradient(180deg,#2e86c1,#1c5e85);color:#fff;font-weight:700;font-size:13px}
.enfs-hd .enfs-x{margin-left:auto;background:rgba(255,255,255,.18);color:#fff;border:none;border-radius:5px;width:26px;height:24px;cursor:pointer;font-size:13px}
.enfs-body{flex:1;min-height:0;display:flex}
.enfs-left{flex:0 0 320px;display:flex;flex-direction:column;border-right:1px solid #d8d4cc;min-height:0;background:#efece6}
.enfs-search{margin:10px 12px;font-size:12px;padding:5px 8px;border:1px solid #cfcabf;border-radius:6px}
.enfs-list{flex:1;min-height:0;overflow:auto;padding:0 8px 10px}
.enfs-item{padding:9px 10px;border-radius:7px;cursor:pointer;border:1px solid transparent;margin-bottom:2px}
.enfs-item:hover{background:#e6e1d8}
.enfs-item.sel{background:#dbe9f6;border-color:#2e86c1}
.enfs-item .t{font-weight:600;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.enfs-item .m{display:flex;gap:7px;align-items:center;color:#777;font-size:10.5px;margin-top:3px}
.enfs-badge{font-size:9.5px;font-weight:700;background:#efeaf7;color:#5e4690;border-radius:9px;padding:1px 7px}
.enfs-detail{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;background:#fff}
.enfs-dhd{padding:13px 16px 10px;border-bottom:1px solid #e2ded6;flex-shrink:0}
.enfs-dtitle{font-size:15px;font-weight:700;margin-bottom:6px}
.enfs-dmeta{display:flex;gap:8px;flex-wrap:wrap;color:#777;font-size:11.5px}
.enfs-lines{flex:1;min-height:0;overflow:auto;padding:10px 16px}
.enfs-line{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #eee;font-size:12.5px}
.enfs-line:last-child{border-bottom:none}
.enfs-ln{flex:0 0 40px;color:#999;font-size:10.5px;text-align:right}
.enfs-ln.hook{color:#c8801a;font-weight:700}
.enfs-lt{flex:1;min-width:0;color:#222}
.enfs-foot{display:flex;align-items:center;gap:8px;padding:11px 16px;border-top:1px solid #e2ded6;background:#ecebe7;flex-shrink:0}
.enfs-grow{flex:1}
.enfs-btn{font-size:11px;padding:6px 12px;cursor:pointer;border:1px solid #cfcabf;border-radius:6px;background:#f7f5f1;color:#333}
.enfs-btn:hover{background:#eee9f7}
.enfs-btn:disabled{opacity:.5;cursor:default}
.enfs-btn.enfs-primary{background:#2e86c1;color:#fff;border-color:#1c5e85;font-weight:700}
.enfs-btn.enfs-primary:hover{background:#3a97d4}
.enfs-del{color:#a33}
.enfs-empty{color:#999;font-size:13px;text-align:center;padding:40px 0}
/* nested cast overlay */
.enfs-cast-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99985}
.enfs-cast{background:#fff;color:#222;width:480px;max-width:92vw;border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.5);overflow:hidden}
.enfs-cast-hd{padding:11px 14px;background:linear-gradient(180deg,#2e86c1,#1c5e85);color:#fff;font-weight:700;font-size:13px}
.enfs-cast-bd{padding:14px 16px;display:flex;flex-direction:column;gap:8px;font-size:12px}
.enfs-cast-bd select{width:100%;font-size:12px;padding:6px 8px;border:1px solid #cfcabf;border-radius:6px}
.enfs-cast-warn{font-size:11px;color:#b8791b}
.enfs-cast-ft{display:flex;gap:8px;justify-content:flex-end;padding:11px 16px;border-top:1px solid #e2ded6}
.enfs-add-plus{font-size:42px;line-height:1}
.enfs-add-lbl{font-size:11px;margin-top:6px;text-align:center}
`;
    document.head.appendChild(s);
  }

  // ════════════════════════════════════════════════════════════════════════
  // MASTER / DETAIL POPUP
  // ════════════════════════════════════════════════════════════════════════
  async function open() {
    _css();
    if (!_types) { try { const c = await fetch(`${API}/config`).then(r => r.json()); _types = c.types || []; } catch { _types = []; } }
    let list = [];
    try { const d = await fetch(`${API}/list`).then(r => r.json()); list = (d.success ? d.scenarios : []) || []; } catch {}
    const ov = document.createElement('div'); ov.className = 'enfs-ov';
    ov.addEventListener('mousedown', e => { if (e.target === ov) _close(); });
    ov.innerHTML = `
      <div class="enfs-box">
        <div class="enfs-hd"><span>＋ New Edit project — pick a saved scenario</span><button class="enfs-x" id="enfsX">✕</button></div>
        <div class="enfs-body">
          <div class="enfs-left">
            <select class="enfs-search" id="enfsVert" title="Filter scenarios by vertical"></select>
            <div class="enfs-list" id="enfsList"></div>
          </div>
          <div class="enfs-detail" id="enfsDetail"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    _ov = ov; _st = { list, selId: (list[0] && list[0].id) || null, vertical: '' };
    ov.querySelector('#enfsX').onclick = _close;
    const vsel = ov.querySelector('#enfsVert');
    const verts = [...new Set(list.map(s => (s.vertical && s.vertical.label) || '').filter(Boolean))].sort();
    vsel.innerHTML = '<option value="">All verticals</option>' + verts.map(v => `<option value="${$esc(v)}">${$esc(v)}</option>`).join('');
    vsel.addEventListener('change', () => { _st.vertical = vsel.value; _renderList(); });
    _renderList();
    if (_st.selId != null) _select(_st.selId);
    else ov.querySelector('#enfsDetail').innerHTML = '<div class="enfs-empty">No saved scenarios yet.<br>Create one in the Scenarios tab.</div>';
  }
  function _close() { if (_ov) { _ov.remove(); _ov = null; _st = null; } }
  function _q(sel) { return _ov ? _ov.querySelector(sel) : null; }
  function _dateStr(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); } catch { return ''; } }

  function _renderList() {
    const host = _q('#enfsList'); if (!host) return; host.innerHTML = '';
    const items = _st.list.filter(s => !_st.vertical || ((s.vertical && s.vertical.label) || '') === _st.vertical);
    if (!items.length) { host.innerHTML = '<div class="enfs-empty" style="padding:18px 8px">nothing found</div>'; return; }
    items.forEach(s => {
      const it = document.createElement('div'); it.className = 'enfs-item' + (String(s.id) === String(_st.selId) ? ' sel' : '');
      it.innerHTML = `<div class="t">${$esc(s.title || '(untitled)')}</div><div class="m"><span class="enfs-badge">${$esc(_typeLabel(s.type))}</span><span>${s.sceneCount || 0} ln</span><span>${_dateStr(s.updatedAt || s.createdAt)}</span></div>`;
      it.onclick = () => _select(s.id);
      host.append(it);
    });
  }

  async function _select(id) {
    _st.selId = id; _renderList();
    const det = _q('#enfsDetail'); if (!det) return;
    det.innerHTML = '<div class="enfs-empty">Loading…</div>';
    let s = null; try { const d = await fetch(`${API}/${encodeURIComponent(id)}`).then(r => r.json()); if (d.success) s = d.scenario; } catch {}
    if (!s) { det.innerHTML = '<div class="enfs-empty">Failed to load.</div>'; return; }
    det.innerHTML = '';
    const hd = document.createElement('div'); hd.className = 'enfs-dhd';
    hd.innerHTML = `<div class="enfs-dtitle">${$esc(s.title || '(untitled)')}</div>
      <div class="enfs-dmeta"><span class="enfs-badge">${$esc(_typeLabel(s.type))}</span><span>vertical: ${$esc((s.vertical && s.vertical.label) || '—')}</span><span>taboo: ${$esc(s.taboo || '—')}</span><span>${(s.lines || []).length} lines</span></div>`;
    det.append(hd);
    const lines = document.createElement('div'); lines.className = 'enfs-lines';
    let _saveT = null;
    const _saveLines = () => {
      if (_saveT) clearTimeout(_saveT);
      _saveT = setTimeout(() => { fetch(`${API}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) }).catch(() => {}); }, 600);
    };
    (s.lines || []).forEach((ln, i) => {
      const row = document.createElement('div'); row.className = 'enfs-line';
      const num = document.createElement('div'); num.className = 'enfs-ln' + (i === 0 ? ' hook' : ''); num.textContent = i === 0 ? '🪝 1' : (i + 1);
      const ta = document.createElement('textarea'); ta.value = ln.text || ''; ta.rows = 1;
      ta.style.cssText = 'flex:1;min-width:0;font-size:12px;padding:3px 6px;border:1px solid #cfcabf;border-radius:4px;background:#fff;color:inherit;resize:vertical;font-family:inherit;line-height:1.35;';
      ta.title = 'Edit this line — saved to the scenario';
      ta.addEventListener('input', () => { ln.text = ta.value; _saveLines(); });
      row.append(num, ta);
      lines.append(row);
    });
    det.append(lines);
    const ft = document.createElement('div'); ft.className = 'enfs-foot';
    const bDup = document.createElement('button'); bDup.className = 'enfs-btn'; bDup.textContent = '⧉ Duplicate'; bDup.onclick = () => _duplicate(s.id);
    const bDel = document.createElement('button'); bDel.className = 'enfs-btn enfs-del'; bDel.textContent = '🗑 Delete'; bDel.onclick = () => _delete(s.id, bDel);
    const grow = document.createElement('span'); grow.className = 'enfs-grow';
    const bLoad = document.createElement('button'); bLoad.className = 'enfs-btn enfs-primary'; bLoad.textContent = '✎ Load into editor'; bLoad.onclick = () => _loadNoCast(s);
    ft.append(bDup, bDel, grow, bLoad);
    det.append(ft);
  }

  async function _duplicate(id) {
    try {
      const d = await fetch(`${API}/${encodeURIComponent(id)}`).then(r => r.json());
      if (!d.success) return;
      const s = { ...d.scenario }; delete s.id; delete s.createdAt; delete s.updatedAt;
      s.title = (s.title || 'untitled') + ' (copy)';
      const r = await fetch(`${API}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) }).then(x => x.json());
      const d2 = await fetch(`${API}/list`).then(x => x.json()); _st.list = (d2.success ? d2.scenarios : []) || [];
      if (r.success && r.scenario) _st.selId = r.scenario.id;
      _renderList(); if (_st.selId != null) _select(_st.selId);
    } catch {}
  }
  function _delete(id, btn) {
    if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = '🗑 Confirm'; setTimeout(() => { try { btn.dataset.armed = ''; btn.textContent = '🗑 Delete'; } catch {} }, 2200); return; }
    fetch(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => {
      _st.list = _st.list.filter(x => String(x.id) !== String(id));
      const next = _st.list[0]; _st.selId = next ? next.id : null;
      _renderList();
      if (_st.selId != null) _select(_st.selId);
      else { const det = _q('#enfsDetail'); if (det) det.innerHTML = '<div class="enfs-empty">No saved scenarios left.</div>'; }
    }).catch(() => {});
  }

  // ════════════════════════════════════════════════════════════════════════
  // ROUTING + CAST + BUILD (self-contained copy — see header note)
  // ════════════════════════════════════════════════════════════════════════
  function _computeRouting(s) {
    const cfg = (_types || []).find(t => t.id === s.type) || {};
    const isVoiceover = (cfg.characters === 0) || s.mode === 'voiceover';
    const out = [];
    (s.lines || []).forEach(ln => {
      if (isVoiceover) { out.push({ text: ln.text, kind: 'vo', who: 'narrator', gender: s.narratorGender || 'any' }); return; }
      const role = (s.roles || []).find(r => r.id === ln.roleId) || (s.roles || [])[0] || {};
      out.push({ text: ln.text, kind: 'on_camera', who: role.name || 'Presenter', gender: role.gender || 'any' });
    });
    return out;
  }

  // "Load into editor" — build the project WITHOUT a cast step and open it; the
  // user casts (character → photoshoot → voice) inside the project Settings.
  function _loadNoCast(s) {
    const routed = _computeRouting(s);
    if (!routed.length) { alert('This scenario has no lines to load.'); return; }
    const isVO = routed.every(r => r.kind === 'vo');
    _build(s, routed, { voice: null, obrazByRole: {} }, isVO);
  }

  function _openCast(s) {
    const routed = _computeRouting(s);
    if (!routed.length) { alert('This scenario has no lines.'); return; }
    const isVO = routed.every(r => r.kind === 'vo');
    const ov = document.createElement('div'); ov.className = 'enfs-cast-ov';
    ov.addEventListener('mousedown', e => { if (e.target === ov) ov.remove(); });
    const box = document.createElement('div'); box.className = 'enfs-cast';
    const hd = document.createElement('div'); hd.className = 'enfs-cast-hd'; hd.textContent = '⬈ Build Edit project — cast';
    const bd = document.createElement('div'); bd.className = 'enfs-cast-bd';
    let voiceSel = null; let roles = []; const picks = { voice: null, obrazByRole: {} };
    const okBtn = document.createElement('button'); okBtn.className = 'enfs-btn enfs-primary'; okBtn.textContent = 'Build project';
    const curVoice = () => voiceSel ? (voiceSel.value || '') : '';
    function updateOk() { okBtn.disabled = isVO ? !curVoice() : (roles.length === 0 || Object.values(picks.obrazByRole).some(v => !v)); }
    if (isVO) {
      const g = _gn(s.narratorGender);
      const lbl = document.createElement('div'); lbl.textContent = `Faceless voiceover — pick a narrator voice${g !== 'any' ? ' (' + g + ')' : ''}. B-roll & subtitles are added in Merge.`;
      bd.append(lbl);
      voiceSel = document.createElement('select');
      const defId = () => _voiceDefaultId(g);
      if (typeof window.registerVoiceSelect === 'function') window.registerVoiceSelect(voiceSel, defId);
      if (window.buildVoiceSelect) window.buildVoiceSelect(voiceSel, defId());
      voiceSel.onchange = updateOk;
      bd.append(voiceSel);
      const warn = document.createElement('div'); warn.className = 'enfs-cast-warn';
      if (!(window.ELEVENLABS_VOICES || []).length) warn.textContent = '⚠ voice catalog still loading — the picker fills in shortly.';
      bd.append(warn);
      const onV = () => { if (!document.contains(voiceSel)) { window.removeEventListener('el-voices-updated', onV); return; } warn.textContent = ''; updateOk(); };
      window.addEventListener('el-voices-updated', onV);
    } else {
      const seen = new Set();
      routed.forEach(r => { if (r.kind !== 'on_camera') return; const k = r.who + '|' + r.gender; if (seen.has(k)) return; seen.add(k); roles.push(r); });
      if (roles.length > 1) { const n = document.createElement('div'); n.className = 'enfs-cast-warn'; n.textContent = 'Multiple roles — one look is cast to the whole session (first role).'; bd.append(n); }
      roles.forEach((r, ri) => {
        const lbl = document.createElement('div'); lbl.textContent = `Role: ${r.who}${r.gender !== 'any' ? ' (' + r.gender + ')' : ''} — pick a look`;
        const sel = document.createElement('select');
        const cand = _genderObrazy(r.gender);
        sel.innerHTML = cand.length ? cand.map(o => `<option value="${o.id}">${$esc(o.name || String(o.id))}${_gn(o.gender) === 'male' ? ' ♂' : _gn(o.gender) === 'female' ? ' ♀' : ''}</option>`).join('') : '<option value="">(no looks yet — create one in Project Looks)</option>';
        picks.obrazByRole[ri] = sel.value || null;
        sel.onchange = () => { picks.obrazByRole[ri] = sel.value; updateOk(); };
        bd.append(lbl, sel);
        const ng = _gn(r.gender);
        if (ng !== 'any' && !_obrazList().some(o => _gn(o.gender) === ng)) { const w = document.createElement('div'); w.className = 'enfs-cast-warn'; w.textContent = '⚠ no look matches this gender — showing all looks.'; bd.append(w); }
      });
    }
    const ft = document.createElement('div'); ft.className = 'enfs-cast-ft';
    const cancel = document.createElement('button'); cancel.className = 'enfs-btn'; cancel.textContent = 'Cancel'; cancel.onclick = () => ov.remove();
    okBtn.onclick = () => { if (isVO) picks.voice = curVoice(); ov.remove(); _build(s, routed, picks, isVO); };
    ft.append(cancel, okBtn);
    box.append(hd, bd, ft); ov.append(box); document.body.appendChild(ov);
    updateOk();
  }

  function _build(s, routed, picks, isVO) {
    const FZ = _FZ();
    const now = Date.now();
    const scenFile = `sv2_${s.id}`;
    const nums = Object.values(FZ).filter(x => (x.scenFile || '') === scenFile).map(x => x.num || 0);
    const num = nums.length ? Math.max.apply(null, nums) + 1 : 1;
    const d = new Date(now);
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const scenName = String(s.title || 'scenario').replace(/\s·\sstep\s\d+$/, '');
    const roleLabel = isVO ? 'Narrator' : (((routed.find(r => r.kind === 'on_camera') || {}).who) || 'Presenter');
    let key;
    if (isVO) {
      const vid = picks.voice || _voiceDefaultId(_gn(s.narratorGender));   // may be '' when skipping cast — set later in Settings
      const vobj = (vid && typeof window.findVoiceByValue === 'function') ? window.findVoiceByValue(vid) : null;
      const vlabel = (vobj && vobj.name) ? String(vobj.name).split(' — ')[0] : 'Voiceover';
      key = `__vo____${scenFile}__${now}`;
      FZ[key] = {
        pending: false, num, title: `${stamp} — ${scenName} — ${vid ? 'VO: ' + vlabel : 'Voiceover'}`,
        itemsMode: 'noitems', assignments: {}, obrazId: '__vo__', scenFile, obrazChar: null, roleLabel,
        templateSessionKey: null, date: d.toISOString(), voiceKind: 'vo', narratorGender: _gn(s.narratorGender),
        cells: routed.map(r => ({ line: r.text, detInfo: null, charImagePath: null, imagePath: null, audioPath: null, segKind: 'vo' })),
      };
      if (vid) { try { localStorage.setItem('edit_voice__' + key, vid); } catch {} }
    } else {
      const obrazId = (picks.obrazByRole && picks.obrazByRole[0]) || '';
      const obraz = _obrazList().find(o => String(o.id) === String(obrazId)) || null;
      const vars = obraz ? [obraz.char].concat((obraz.variations || []).filter(v => v && v !== 'error')).filter(Boolean) : [];
      const pickVar = () => vars.length ? vars[Math.floor(Math.random() * vars.length)] : ((obraz && obraz.char) || null);
      const oname = (obraz && obraz.name) || String(obrazId);
      key = `${obrazId}__${scenFile}__${now}`;
      FZ[key] = {
        pending: false, num, title: `${stamp} — ${scenName} — ${oname}`,
        itemsMode: 'noitems', assignments: {}, obrazId: String(obrazId), scenFile, obrazChar: (obraz && obraz.char) || null, roleLabel,
        templateSessionKey: null, date: d.toISOString(),
        cells: routed.map(r => ({ line: r.text, detInfo: null, charImagePath: pickVar(), imagePath: null, audioPath: null, segKind: 'on_camera' })),
      };
    }
    if (typeof saveEditState === 'function') saveEditState();
    // Kick off restrained, emotion-led motion-prompt generation in the backend
    // right away (cached under scenFile sv2_<id>); fire-and-forget so the project
    // opens immediately — the Motion field/avatar prompts pick it up once ready.
    try { fetch(`${API}/${encodeURIComponent(s.id)}/ensure-motion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}); } catch {}
    _close();
    try { if (window.EDIT2Tab && EDIT2Tab.render) EDIT2Tab.render(); } catch {}
    setTimeout(() => { try { if (window.EDIT2Popup && EDIT2Popup.open) EDIT2Popup.open(key); } catch {} }, 200);
  }

  window.EditNewFromScenario = { open };
})();
