/* ════════════════════════════════════════════════════════════════════════
   SCENARIOS V2 — self-contained scenario builder (parallel to legacy v1).
   No popups: the tab has two views toggled by top buttons — New / Saved.

   NEW:   Setup (type/mode/product/…) → Roles bound to saved characters
          (gender comes from the character) → Props pool (select + generate)
          → AI generate (reuses /api/scenarios/ai/generate) → editable text
          → Save to data/scenarios-v2.json.
   SAVED: cards of saved scenarios → open for editing (same form) / delete.
          Casting + parallel production lands in a later phase.

   window.ScenariosV2.activate() is called by tabs.js showComboPanel('scen2').
   ════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  let _built = false;
  let _view = 'new';            // 'new' | 'saved'
  let _editingId = null;        // id when editing an existing scenario

  // Caches
  let _types = [];              // [{id,label,defaultMulti,voiceover}]
  let _emotions = [];
  let _styles = [];
  let _catalogGender = 'women'; // which emotion/style catalog is loaded
  let _chars = [];              // saved characters (char-store)
  let _props = [];              // details (props)

  // Working state for the form
  let _roles = [{ id: 'r0', name: 'Host', charId: '' }, { id: 'r1', name: 'Guest', charId: '' }];
  let _selectedProps = new Set(); // prop paths in the scenario pool

  const $ = sel => document.querySelector(sel);
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'style') n.style.cssText = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'html') n.innerHTML = v;
      else if (v != null) n.setAttribute(k, v);
    }
    kids.flat().forEach(c => { if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  }
  const g = id => document.getElementById(id);

  // ── Entry point ─────────────────────────────────────────────────────────
  async function activate() {
    if (!_built) { _build(); _built = true; }
    await _loadCatalogs();
    if (_view === 'saved') _renderSaved();
  }

  function _build() {
    const root = g('s2-root');
    if (!root) return;
    root.innerHTML = '';
    root.append(
      el('div', { class: 's2-topbar' },
        el('button', { id: 's2-btn-new',   class: 's2-tab-btn active', onclick: () => _switch('new') }, '+ New scenario'),
        el('button', { id: 's2-btn-saved', class: 's2-tab-btn',        onclick: () => _switch('saved') }, 'Saved'),
        el('span', { style: 'flex:1' }),
        el('span', { id: 's2-status', class: 's2-status' }),
      ),
      // Saved-scenario picker bar (shown only in Saved mode).
      el('div', { id: 's2-savedbar', class: 's2-savedbar', style: 'display:none;' }),
      // The 2-column editor — shared by New and Saved.
      el('div', { id: 's2-new-view', class: 's2-view' }),
    );
    _buildNewView();
  }

  function _switch(v) {
    _view = v;
    g('s2-btn-new')?.classList.toggle('active', v === 'new');
    g('s2-btn-saved')?.classList.toggle('active', v === 'saved');
    const bar = g('s2-savedbar'); if (bar) bar.style.display = v === 'saved' ? '' : 'none';
    if (v === 'saved') _renderSaved();
    else _resetForm();
  }

  function _status(t, err) { const s = g('s2-status'); if (s) { s.textContent = t || ''; s.style.color = err ? '#c0392b' : '#557'; } }

  // ── Catalogs ──────────────────────────────────────────────────────────────
  async function _loadCatalogs() {
    await Promise.all([_loadOptions(_catalogGender), _loadChars(), _loadProps()]);
    _fillTypeSelect();
    _fillEmotionStyle();
    if (!_editingId) _roles = _defaultRolesForType(_typeDef()); // fresh form → type defaults
    _renderRoles();
    _renderPropPool();
    _fillDatalists();
  }
  async function _loadOptions(gender) {
    try {
      const d = await fetch('/api/scenarios/ai/options?gender=' + encodeURIComponent(gender)).then(r => r.json());
      if (d.success) { _types = d.types || []; _emotions = d.emotions || []; _styles = d.styles || []; }
    } catch {}
  }
  async function _loadChars() {
    try { const d = await fetch('/api/char-store/list').then(r => r.json()); _chars = (d && d.success) ? (d.chars || []) : []; } catch { _chars = []; }
  }
  async function _loadProps() {
    try { const d = await fetch('/api/details').then(r => r.json()); _props = (d && d.success && Array.isArray(d.files)) ? d.files : []; } catch { _props = []; }
  }

  // ── Editor (2 columns: LEFT params 3/5 · RIGHT preview 2/5) ───────────────
  function _buildNewView() {
    const v = g('s2-new-view');
    v.innerHTML = '';

    // Controls (stable ids preserved).
    const typeSel  = el('select', { id: 's2-type', class: 's2-inp', onchange: _onTypeChange });
    const product  = el('input',  { id: 's2-product', class: 's2-inp', list: 's2-dl-product', oninput: _autoTitle, placeholder: 'e.g. Collagen gummies' });
    const audience = el('input',  { id: 's2-audience', class: 's2-inp', list: 's2-dl-audience', placeholder: 'e.g. Women 30+' });
    const emotion  = el('select', { id: 's2-emotion', class: 's2-inp' });
    const style    = el('select', { id: 's2-style', class: 's2-inp' });
    const notes    = el('textarea', { id: 's2-notes', class: 's2-ta', style: 'height:62px;', placeholder: 'Freeform notes (any language → output English)' });
    const title    = el('input',  { id: 's2-title', class: 's2-inp', list: 's2-dl-title', placeholder: 'Auto from product + type' });
    const scenes   = (() => { const s = el('select', { id: 's2-scenes', class: 's2-inp' }); ['10-13', '14-17', '18-22'].forEach(r => s.append(el('option', { value: r, ...(r === '14-17' ? { selected: '1' } : {}) }, r))); return s; })();

    // Group 1 (left): type (+ multi), product, scenes, audience
    const group1 = el('div', { class: 's2-sec' },
      el('div', { class: 's2-sec-h' }, 'Setup'),
      el('div', { class: 's2-fld' }, el('label', { class: 's2-lbl' }, 'Type'), typeSel),
      _field('Product', product),
      _field('Scenes', scenes),
      _field('Audience', audience),
    );
    // Group 2 (right): emotion, style, notes
    const group2 = el('div', { class: 's2-sec' },
      el('div', { class: 's2-sec-h' }, 'Tone & notes'),
      _field('Emotion', emotion),
      _field('Style', style),
      el('div', { class: 's2-fld s2-fld-col' }, el('label', { class: 's2-lbl' }, 'Notes'), notes),
    );

    const rolesSec = el('div', { id: 's2-roles-sec', class: 's2-sec' },
      el('div', { class: 's2-sec-h' }, 'Roles → characters ', el('span', { class: 's2-hint' }, '(gender from character)')),
      el('div', { id: 's2-roles-list' }),
      el('button', { id: 's2-add-role', class: 's2-mini', onclick: () => { _roles.push({ id: 'r' + _roles.length, name: '', charId: '' }); _renderRoles(); } }, '+ Add role'),
    );
    const propsSec = el('div', { class: 's2-sec s2-props-sec' },
      el('div', { class: 's2-sec-h' }, 'Props pool ',
        el('button', { class: 's2-mini', onclick: _refreshProps, title: 'Reload props' }, '↻'),
        el('button', { class: 's2-mini', onclick: _openNewProp, title: 'Generate a new prop' }, '+ Generate prop')),
      el('div', { id: 's2-props-grid', class: 's2-props-grid' }),
    );

    const left = el('div', { class: 's2-col-params' },
      el('div', { class: 's2-sec' }, _field('Title', title)),       // title full width
      el('div', { class: 's2-2col' }, group1, group2),              // setup | tone
      el('div', { class: 's2-2col' }, rolesSec, propsSec),          // roles | props
    );

    // RIGHT: Generate (toggles to Regenerate once text exists) + ⚙ model menu + output + save
    const modelSel = (() => { const s = el('select', { id: 's2-model', class: 's2-inp' }); [['nousresearch/hermes-3-llama-3.1-70b', 'Hermes 3 70B'], ['anthropic/claude-sonnet-4.6', 'Claude Sonnet 4.6'], ['openai/gpt-4o', 'GPT-4o'], ['google/gemini-pro-1.5', 'Gemini Pro 1.5']].forEach(([id, l]) => s.append(el('option', { value: id }, l))); return s; })();
    const right = el('div', { class: 's2-col-preview' },
      el('div', { class: 's2-gen-bar' },
        el('button', { id: 's2-gen', class: 's2-gen-btn', onclick: () => _generate(g('s2-gen')?.dataset.mode || 'fresh') }, '✨ Generate'),
        el('button', { id: 's2-model-gear', class: 's2-mini', title: 'Generation model', onclick: _toggleModelMenu }, '⚙'),
      ),
      el('div', { id: 's2-model-menu', class: 's2-model-menu', style: 'display:none;' }, _field('Model', modelSel)),
      el('label', { class: 's2-lbl', style: 'margin:2px 0;' }, 'Generated scenario — editable'),
      el('textarea', { id: 's2-output', class: 's2-ta s2-output', oninput: _syncGenBtn, placeholder: 'Generated scenario appears here (editable). Multi-role lines are tagged [Role].' }),
      el('div', { class: 's2-save-bar' },
        el('button', { id: 's2-save', class: 's2-save-btn', onclick: _save }, '💾 Save scenario'),
        el('button', { id: 's2-newblank', class: 's2-mini', onclick: _resetForm, title: 'Clear the form for a new scenario' }, 'Clear'),
      ),
    );

    v.append(
      el('div', { class: 's2-editor' }, left, right),
      el('datalist', { id: 's2-dl-product' }),
      el('datalist', { id: 's2-dl-audience' }),
      el('datalist', { id: 's2-dl-title' }),
    );
    _fillDatalists();
  }

  // ── Setup-field history (suggest previous entries) ──────────────────────────
  const FH_KEY = 'scen2_field_history_v1';
  function _loadFH() { try { return JSON.parse(localStorage.getItem(FH_KEY) || '{}'); } catch { return {}; } }
  function _recordFH(field, val) {
    val = (val || '').trim(); if (!val) return;
    const h = _loadFH(); const arr = (h[field] || []).filter(x => x !== val);
    arr.unshift(val); h[field] = arr.slice(0, 25);
    try { localStorage.setItem(FH_KEY, JSON.stringify(h)); } catch {}
  }
  function _fillDatalists() {
    const h = _loadFH();
    [['product', 's2-dl-product'], ['audience', 's2-dl-audience'], ['title', 's2-dl-title']].forEach(([f, id]) => {
      const dl = g(id); if (!dl) return; dl.innerHTML = '';
      (h[f] || []).forEach(v => dl.append(el('option', { value: v })));
    });
  }

  // Default roles per type: voiceover → none; vsl/dialogue → 2; else 1.
  function _defaultRolesForType(t) {
    if (t.voiceover) return [];
    const two = (t.id === 'vsl' || t.id === 'dialogue');
    return (two ? ['Host', 'Guest'] : ['Narrator']).map((nm, i) => ({ id: 'r' + i, name: nm, charId: '' }));
  }

  function _toggleModelMenu() { const m = g('s2-model-menu'); if (m) m.style.display = m.style.display === 'none' ? '' : 'none'; }
  // Generate when output is empty; once a scenario exists the same button becomes Regenerate.
  function _syncGenBtn() {
    const b = g('s2-gen'); if (!b) return;
    const has = !!(g('s2-output')?.value || '').trim();
    b.dataset.mode = has ? 'regenerate' : 'fresh';
    b.textContent = has ? '↻ Regenerate' : '✨ Generate';
  }

  function _field(label, control) {
    return el('div', { class: 's2-fld' }, el('label', { class: 's2-lbl' }, label), control);
  }

  function _fillTypeSelect() {
    const sel = g('s2-type'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '';
    _types.forEach(t => {
      const o = el('option', { value: t.id }, t.label);
      o.dataset.defaultMulti = t.defaultMulti ? '1' : '';
      o.dataset.voiceover = t.voiceover ? '1' : '';
      sel.append(o);
    });
    if (cur) sel.value = cur;
  }
  function _fillEmotionStyle() {
    const em = g('s2-emotion'), st = g('s2-style');
    if (em) { const c = em.value; em.innerHTML = '<option value="">— none —</option>'; _emotions.forEach(e => em.append(el('option', { value: e.id }, e.label))); if (c) em.value = c; }
    if (st) { const c = st.value; st.innerHTML = '<option value="">— none —</option>'; _styles.forEach(s => st.append(el('option', { value: s.id }, s.label))); if (c) st.value = c; }
  }

  function _typeDef() { const sel = g('s2-type'); const o = sel?.selectedOptions?.[0]; return { id: sel?.value || 'ugc_ad', voiceover: o?.dataset.voiceover === '1', defaultMulti: o?.dataset.defaultMulti === '1' }; }
  // Mode is derived purely from the number of roles: voiceover → none, 1 → single, ≥2 → multi.
  function _modeVal() { const t = _typeDef(); if (t.voiceover) return 'voiceover'; return _roles.length >= 2 ? 'multi' : 'single'; }
  function _isMulti() { return _modeVal() === 'multi'; }

  function _onTypeChange() {
    // Switching type resets roles to that type's default count.
    _roles = _defaultRolesForType(_typeDef());
    _renderRoles();
    _autoTitle();
  }

  function _charGender(charId) { const c = _chars.find(x => String(x.id) === String(charId)); return c?.gender || null; }
  function _charOptions(selectedId) {
    let html = '<option value="">— pick character —</option>';
    _chars.forEach(c => {
      const sel = String(c.id) === String(selectedId) ? ' selected' : '';
      const gtag = c.gender ? ` (${c.gender[0]})` : '';
      html += `<option value="${c.id}"${sel}>${(c.name || 'Character').replace(/</g, '&lt;')}${gtag}</option>`;
    });
    return html;
  }

  function _renderRoles() {
    const sec = g('s2-roles-sec'); const list = g('s2-roles-list');
    if (!sec || !list) return;
    const t = _typeDef();
    const addBtn = g('s2-add-role');
    // Voiceover = no characters in frame → hide roles + the add button.
    sec.style.display = t.voiceover ? 'none' : '';
    if (addBtn) addBtn.style.display = t.voiceover ? 'none' : '';
    list.innerHTML = '';
    if (t.voiceover) return;
    if (!_roles.length) _roles = [{ id: 'r0', name: 'Narrator', charId: '' }];
    _roles.forEach((role, i) => {
      const row = el('div', { class: 's2-role-row' });
      const name = el('input', { class: 's2-inp s2-role-name', value: role.name || '', placeholder: 'Role', oninput: e => { _roles[i].name = e.target.value; } });
      const charSel = el('select', { class: 's2-inp', html: _charOptions(role.charId), onchange: e => { _roles[i].charId = e.target.value; _maybeReloadCatalogGender(); } });
      const del = el('button', { class: 's2-mini', title: 'Remove role', onclick: () => { if (_roles.length > 1) { _roles.splice(i, 1); _renderRoles(); } } }, '✕');
      row.append(name, charSel, del);
      list.append(row);
    });
  }

  // If the first assigned character implies a gender different from the loaded
  // emotion/style catalog, reload that catalog (keeps the modifier lists fitting).
  async function _maybeReloadCatalogGender() {
    const firstChar = _roles.map(r => r.charId).filter(Boolean)[0];
    const gen = _charGender(firstChar);
    const want = gen === 'male' ? 'men' : gen === 'female' ? 'women' : _catalogGender;
    if (want !== _catalogGender) { _catalogGender = want; await _loadOptions(want); _fillEmotionStyle(); }
  }

  function _renderPropPool() {
    const grid = g('s2-props-grid'); if (!grid) return;
    grid.innerHTML = '';
    if (!_props.length) { grid.append(el('div', { class: 's2-empty' }, 'No props. Generate one →')); return; }
    _props.forEach(p => {
      const path = p.path || ('/details/' + p.file);
      const tile = el('div', { class: 's2-prop' + (_selectedProps.has(path) ? ' sel' : ''), title: p.name || '' });
      tile.append(el('img', { src: (p.thumbPath || path) }));
      tile.addEventListener('click', () => { if (_selectedProps.has(path)) _selectedProps.delete(path); else _selectedProps.add(path); tile.classList.toggle('sel'); });
      grid.append(tile);
    });
  }
  async function _refreshProps() { await _loadProps(); _renderPropPool(); }
  function _openNewProp() {
    // Reuse the existing prop generator popup from the v1 scenarios tab.
    const btn = g('btn-detail-new');
    if (btn) { btn.click(); _status('After creating the prop, click ↻ to refresh the pool.'); }
    else _status('Prop generator not available here.', true);
  }

  function _autoTitle() {
    const titleEl = g('s2-title'); if (!titleEl || titleEl.dataset.dirty === '1') return;
    const product = (g('s2-product')?.value || '').trim() || 'untitled';
    const type = _typeDef().id;
    titleEl.value = `${product} — ${type}`;
  }

  // ── Generation ────────────────────────────────────────────────────────────
  function _genGender() {
    const firstChar = _roles.map(r => r.charId).filter(Boolean)[0];
    const gen = _charGender(firstChar);
    return gen === 'male' ? 'men' : 'women';
  }
  function _rolesForSubmit() {
    return _roles.map((r, i) => ({ id: r.id || ('r' + i), name: (r.name || '').trim() || ('Role' + (i + 1)), charId: r.charId || null }));
  }
  function _selectedPropNames() {
    return [..._selectedProps].map(pth => { const p = _props.find(x => (x.path || ('/details/' + x.file)) === pth); return p?.name || ''; }).filter(Boolean).join(', ');
  }

  async function _generate(opMode) {
    const mode = _modeVal();
    const body = {
      gender: _genGender(),
      type: _typeDef().id,
      mode,
      roles: mode === 'multi' ? _rolesForSubmit() : undefined,
      structured: {
        product:  g('s2-product')?.value.trim() || '',
        audience: g('s2-audience')?.value.trim() || '',
        emotion:  g('s2-emotion')?.value || '',
        style:    g('s2-style')?.value || '',
        ingredients: _selectedPropNames(),
      },
      notes: g('s2-notes')?.value.trim() || '',
      scenesRange: g('s2-scenes')?.value || '14-17',
      model: g('s2-model')?.value || 'nousresearch/hermes-3-llama-3.1-70b',
      opMode,
      prevText: opMode === 'regenerate' ? (g('s2-output')?.value || '') : '',
    };
    const gen = g('s2-gen'); if (gen) gen.disabled = true;
    _status('⏳ Generating…');
    try {
      const d = await fetch('/api/scenarios/ai/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(r => r.json());
      if (!d.success) throw new Error(d.error || 'generation failed');
      g('s2-output').value = d.text || '';
      _status('✅ Generated. Edit if needed, then Save.');
    } catch (e) { _status('⚠ ' + e.message, true); }
    finally { if (gen) gen.disabled = false; _syncGenBtn(); }
  }

  // ── Save ────────────────────────────────────────────────────────────────
  function _parseLines(text, roles, mode) {
    const names = roles.map(r => (r.name || '').trim()).filter(Boolean);
    const idxByName = {}; names.forEach((n, i) => { idxByName[n.toLowerCase()] = i; });
    const out = []; let last = 0;
    String(text || '').split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
      let idx = 0, txt = line;
      if (mode === 'multi') {
        const m = line.match(/^\[\s*([^\]]{1,30}?)\s*\]\s*(.*)$/);
        if (m && idxByName[m[1].trim().toLowerCase()] !== undefined) { idx = idxByName[m[1].trim().toLowerCase()]; txt = m[2].trim(); }
        else idx = last;
      }
      last = idx;
      out.push({ text: txt || line, roleId: (roles[idx] || roles[0] || { id: null }).id, propFile: null });
    });
    return out;
  }

  async function _save() {
    const text = (g('s2-output')?.value || '').trim();
    if (!text) { _status('Generate or write a scenario first.', true); return; }
    const mode = _modeVal();
    const t = _typeDef();
    const roles = t.voiceover ? [] : _rolesForSubmit();
    const payload = {
      id: _editingId || undefined,
      title:    (g('s2-title')?.value || '').trim() || `${(g('s2-product')?.value || 'untitled').trim()} — ${t.id}`,
      type:     t.id,
      mode,
      product:  g('s2-product')?.value.trim() || '',
      audience: g('s2-audience')?.value.trim() || '',
      emotion:  g('s2-emotion')?.value || '',
      style:    g('s2-style')?.value || '',
      scenesRange: g('s2-scenes')?.value || '14-17',
      notes:    g('s2-notes')?.value.trim() || '',
      roles,
      lines:    _parseLines(text, roles.length ? roles : [{ id: 'r0' }], mode),
      props:    [..._selectedProps],
    };
    const btn = g('s2-save'); if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }
    try {
      const d = await fetch('/api/scenarios-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
      if (!d.success) throw new Error(d.error || 'save failed');
      _editingId = d.scenario.id;
      _recordFH('product', g('s2-product')?.value);
      _recordFH('audience', g('s2-audience')?.value);
      _recordFH('title', g('s2-title')?.value);
      _fillDatalists();
      _status('✅ Saved: ' + d.scenario.title);
    } catch (e) { _status('⚠ ' + e.message, true); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '💾 Save scenario'; } }
  }

  function _resetForm() {
    _editingId = null;
    _roles = _defaultRolesForType(_typeDef());
    _selectedProps = new Set();
    ['s2-title', 's2-product', 's2-audience', 's2-notes', 's2-output'].forEach(id => { const e = g(id); if (e) e.value = ''; });
    const tEl = g('s2-title'); if (tEl) tEl.dataset.dirty = '';
    _renderRoles(); _renderPropPool(); _syncGenBtn();
    _status('Cleared.');
  }

  // ── SAVED view ────────────────────────────────────────────────────────────
  // Renders a picker bar (dropdown of saved scenarios + Delete/Produce) and
  // loads the selected scenario into the SAME 2-column editor for editing.
  async function _renderSaved() {
    const bar = g('s2-savedbar');
    if (!bar) return;
    bar.innerHTML = '<span class="s2-hint">Loading…</span>';
    let list = [];
    try { const d = await fetch('/api/scenarios-v2/list').then(r => r.json()); list = (d.success ? d.scenarios : []) || []; } catch {}
    bar.innerHTML = '';
    if (!list.length) {
      bar.append(el('span', { class: 's2-hint' }, 'No saved scenarios yet — fill the form and press Save to create one.'));
      _resetForm();
      return;
    }
    const sel = el('select', { id: 's2-saved-pick', class: 's2-inp', style: 'flex:0 1 360px;' });
    list.forEach(s => sel.append(el('option', { value: s.id }, `${s.title || '(untitled)'}  ·  ${s.type}  ·  ${s.sceneCount || 0} sc`)));
    sel.addEventListener('change', () => _openForEdit(sel.value));
    bar.append(
      el('span', { class: 's2-savedbar-lbl' }, 'Saved scenario:'),
      sel,
      el('button', { class: 's2-mini', onclick: () => _openForEdit(sel.value) }, '↻ Reload'),
      el('button', { class: 's2-mini', onclick: () => _status('Production (casting → projects) — coming in the next phase.') }, '▶ Produce'),
      el('button', { class: 's2-mini s2-del', onclick: () => _deleteCurrent(sel) }, '🗑 Delete'),
    );
    // Keep the currently-edited scenario selected if it's in the list, else the most recent.
    const wanted = (_editingId && list.some(s => String(s.id) === String(_editingId))) ? _editingId : list[0].id;
    sel.value = wanted;
    _openForEdit(wanted);
  }

  async function _deleteCurrent(sel) {
    const id = sel?.value;
    if (!id) return;
    try { await fetch('/api/scenarios-v2/' + encodeURIComponent(id), { method: 'DELETE' }); } catch (e) { _status('⚠ ' + e.message, true); return; }
    _editingId = null;
    _status('Deleted.');
    _renderSaved();
  }

  async function _openForEdit(id) {
    let s = null;
    try { const d = await fetch('/api/scenarios-v2/' + encodeURIComponent(id)).then(r => r.json()); if (d.success) s = d.scenario; } catch {}
    if (!s) { _status('Could not load scenario.', true); return; }
    _editingId = s.id;
    _roles = (s.roles && s.roles.length) ? s.roles.map(r => ({ ...r })) : [{ id: 'r0', name: 'Narrator', charId: '' }];
    _selectedProps = new Set(s.props || []);
    // Fill the shared editor (it's always mounted; no view switch needed).
    const set = (id2, val) => { const e = g(id2); if (e) e.value = val || ''; };
    set('s2-product', s.product); set('s2-audience', s.audience); set('s2-notes', s.notes);
    const tEl = g('s2-title'); if (tEl) { tEl.value = s.title || ''; tEl.dataset.dirty = '1'; }
    if (g('s2-type')) g('s2-type').value = s.type || 'ugc_ad';
    // roles already loaded from the saved scenario — render them without
    // resetting to type defaults (so the saved cast is preserved).
    await _maybeReloadCatalogGender();
    if (g('s2-emotion')) g('s2-emotion').value = s.emotion || '';
    if (g('s2-style')) g('s2-style').value = s.style || '';
    if (g('s2-scenes')) g('s2-scenes').value = s.scenesRange || '14-17';
    // Rebuild output text from stored lines (re-tag for multi so it round-trips).
    const out = g('s2-output');
    if (out) out.value = (s.lines || []).map(l => {
      if (s.mode === 'multi') { const r = (s.roles || []).find(x => x.id === l.roleId); return `[${r ? r.name : 'Role'}] ${l.text}`; }
      return l.text;
    }).join('\n');
    _renderRoles(); _renderPropPool(); _syncGenBtn();
    _status('Editing: ' + (s.title || ''));
  }

  // mark title dirty when user types
  document.addEventListener('input', e => { if (e.target && e.target.id === 's2-title') e.target.dataset.dirty = '1'; });

  window.ScenariosV2 = { activate };
})();
