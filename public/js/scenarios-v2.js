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
      // New = the 2-column editor; Saved = a list of saved scenarios (cards).
      el('div', { id: 's2-new-view', class: 's2-view' }),
      el('div', { id: 's2-saved-view', class: 's2-view', style: 'display:none;' }),
    );
    _buildNewView();
  }

  function _switch(v) {
    _view = v;
    g('s2-btn-new')?.classList.toggle('active', v === 'new');
    g('s2-btn-saved')?.classList.toggle('active', v === 'saved');
    g('s2-new-view').style.display   = v === 'new'   ? '' : 'none';
    g('s2-saved-view').style.display = v === 'saved' ? '' : 'none';
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
      el('div', { class: 's2-sec-h' }, 'Props ',
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
        el('button', { id: 's2-newblank', class: 's2-mini', onclick: _resetForm, title: 'Clear all fields' }, 'Clear'),
        el('span', { style: 'flex:1;' }),
        el('button', { id: 's2-save', class: 's2-save-btn', onclick: _save }, '💾 Save scenario'),
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

  // Photoshoots (obrazy) of a character, newest first.
  function _photoshootsFor(charId) {
    if (!charId) return [];
    return (window.getObrazы?.() || [])
      .filter(o => String(o.charId) === String(charId))
      .sort((a, b) => (b.id || 0) - (a.id || 0));
  }
  function _shotOptions(shots, selId) {
    return '<option value="">— photoshoot —</option>' +
      shots.map(o => `<option value="${o.id}"${String(o.id) === String(selId) ? ' selected' : ''}>${(o.name || 'shoot').replace(/</g, '&lt;')}</option>`).join('');
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
      const charSel = el('select', { class: 's2-inp', html: _charOptions(role.charId) });
      let shots = _photoshootsFor(role.charId);

      // Custom photoshoot dropdown — shows the selected shoot's thumbnail inline.
      const dd     = el('div', { class: 's2-shot-dd' });
      const ddBtn  = el('button', { type: 'button', class: 's2-shot-dd-btn' });
      const ddList = el('div', { class: 's2-shot-dd-list', style: 'display:none;' });
      // Separate thumbnail — clicking it opens the photoshoot viewer popup.
      const thumb  = el('img', { class: 's2-shot-thumb', alt: '', title: 'Click to view the photoshoot' });

      const selObraz = () => shots.find(x => String(x.id) === String(_roles[i].obrazId));
      const mainOf   = (o) => o ? (window.pickMainObrazImage?.(o) || o.char) : null;
      function renderBtn() {
        ddBtn.innerHTML = '';
        const o = selObraz(), m = mainOf(o);
        if (o && m) ddBtn.append(el('img', { src: (window.toThumbPath?.(m) || m) + '?t=' + Date.now() }));
        ddBtn.append(el('span', { class: 's2-shot-dd-name' + (o ? '' : ' s2-muted') }, o ? (o.name || 'shoot') : '— photoshoot —'));
        ddBtn.append(el('span', { class: 's2-shot-dd-caret' }, '▾'));
      }
      function renderList() {
        ddList.innerHTML = '';
        if (!shots.length) { ddList.append(el('div', { class: 's2-shot-dd-empty' }, 'No photoshoots for this character')); return; }
        shots.forEach(o => {
          const m = mainOf(o);
          const it = el('div', { class: 's2-shot-dd-item' });
          if (m) it.append(el('img', { src: (window.toThumbPath?.(m) || m) + '?t=' + Date.now() }));
          it.append(el('span', {}, o.name || 'shoot'));
          it.addEventListener('click', () => { _roles[i].obrazId = String(o.id); renderBtn(); updThumb(); ddList.style.display = 'none'; });
          ddList.append(it);
        });
      }
      function updThumb() {
        const o = selObraz(), m = mainOf(o);
        if (m) { thumb.src = (window.toThumbPath?.(m) || m) + '?t=' + Date.now(); thumb.style.display = ''; }
        else { thumb.removeAttribute('src'); thumb.style.display = 'none'; }
      }
      ddBtn.addEventListener('click', e => {
        e.stopPropagation();
        const willOpen = ddList.style.display === 'none';
        document.querySelectorAll('.s2-shot-dd-list').forEach(l => { l.style.display = 'none'; });
        if (willOpen) { renderList(); ddList.style.display = 'block'; }
      });
      thumb.addEventListener('click', () => { const o = selObraz(); if (o) window.openPhotoshootViewer?.(o); });
      charSel.addEventListener('change', e => {
        _roles[i].charId = e.target.value; _roles[i].obrazId = '';
        shots = _photoshootsFor(_roles[i].charId);
        renderBtn(); updThumb(); _maybeReloadCatalogGender();
      });
      dd.append(ddBtn, ddList);

      const del = el('button', { class: 's2-mini', title: 'Remove role', onclick: () => { if (_roles.length > 1) { _roles.splice(i, 1); _renderRoles(); } } }, '✕');
      row.append(name, charSel, dd, thumb, del);
      list.append(row);
      renderBtn(); updThumb();
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
    return _roles.map((r, i) => ({ id: r.id || ('r' + i), name: (r.name || '').trim() || ('Role' + (i + 1)), charId: r.charId || null, obrazId: r.obrazId || null }));
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

  // ── SAVED view — list of saved scenarios (not a second editor) ──────────────
  function _scenarioSummary(s) {
    const roleNames = (s.roles || []).map(r => { const c = _chars.find(x => String(x.id) === String(r.charId)); return c ? c.name : (r.name || 'role'); });
    return [s.type, (s.scenesRange ? s.scenesRange + ' sc' : ''), [s.emotion, s.style].filter(Boolean).join('/'), roleNames.join(' + ')].filter(Boolean).join('  ·  ');
  }
  function _linesToText(s) {
    return (s.lines || []).map(l => {
      if (s.mode === 'multi') { const r = (s.roles || []).find(x => x.id === l.roleId); return `[${r ? r.name : 'Role'}] ${l.text}`; }
      return l.text;
    }).join('\n');
  }

  async function _renderSaved() {
    const v = g('s2-saved-view');
    if (!v) return;
    v.innerHTML = '<div class="s2-empty">Loading…</div>';
    let list = [];
    try { const d = await fetch('/api/scenarios-v2/list').then(r => r.json()); list = (d.success ? d.scenarios : []) || []; } catch {}
    v.innerHTML = '';
    if (!list.length) { v.append(el('div', { class: 's2-empty' }, 'No saved scenarios yet. Create one in “New scenario”.')); return; }
    const wrap = el('div', { class: 's2-saved-list' });
    list.forEach(s => {
      const card = el('div', { class: 's2-scard' });
      card.append(
        el('div', { class: 's2-scard-title' }, s.title || '(untitled)'),
        el('div', { class: 's2-scard-sum' }, _scenarioSummary(s)),
        el('div', { class: 's2-scard-actions' },
          el('button', { class: 's2-mini', onclick: () => _openVersionPopup(s.id) }, '🎬 Versions & cast'),
          el('button', { class: 's2-mini', onclick: () => _editBase(s.id) }, '✎ Template'),
          el('button', { class: 's2-mini s2-del', onclick: () => _deleteCard(s.id, card) }, '🗑'),
        ),
      );
      wrap.append(card);
    });
    v.append(wrap);
  }

  function _deleteCard(id, card) {
    if (!card.dataset.armed) { card.dataset.armed = '1'; card.classList.add('s2-card-arm'); setTimeout(() => { card.dataset.armed = ''; card.classList.remove('s2-card-arm'); }, 2000); _status('Click 🗑 again to delete.'); return; }
    fetch('/api/scenarios-v2/' + encodeURIComponent(id), { method: 'DELETE' }).then(() => { card.remove(); _status('Deleted.'); }).catch(() => {});
  }

  // Edit the base TEMPLATE in the New editor (no second editor in Saved).
  function _editBase(id) {
    _view = 'new';
    g('s2-btn-new')?.classList.add('active');
    g('s2-btn-saved')?.classList.remove('active');
    g('s2-new-view').style.display = '';
    g('s2-saved-view').style.display = 'none';
    _openForEdit(id);
  }

  // ── Version & cast popup ────────────────────────────────────────────────────
  // A "version" = a casting (role→character) + pointwise field tweaks + editable
  // text, snapshotted when the user creates an Edit project. Versions live on the
  // scenario; the dropdown lets you base a new project on a previous one. Actual
  // Edit-project spawning is stubbed until the Produce phase.
  let _vpScenario = null;
  async function _openVersionPopup(id) {
    let s = null;
    try { const d = await fetch('/api/scenarios-v2/' + encodeURIComponent(id)).then(r => r.json()); if (d.success) s = d.scenario; } catch {}
    if (!s) { _status('Could not load scenario.', true); return; }
    _vpScenario = s;
    if (!Array.isArray(s.versions)) s.versions = [];

    const ov = el('div', { class: 's2-vp-ov', onmousedown: e => { if (e.target === ov) ov.remove(); } });
    const emoOpts = (cur) => '<option value="">— none —</option>' + _emotions.map(e => `<option value="${e.id}"${e.id === cur ? ' selected' : ''}>${e.label}</option>`).join('');
    const styOpts = (cur) => '<option value="">— none —</option>' + _styles.map(x => `<option value="${x.id}"${x.id === cur ? ' selected' : ''}>${x.label}</option>`).join('');

    const verSel = el('select', { class: 's2-inp', style: 'flex:1;' });
    const casting = el('div', { class: 's2-vp-casting' });
    const textTa  = el('textarea', { class: 's2-ta', style: 'flex:1;min-height:200px;' });
    const audienceI = el('input', { class: 's2-inp', value: s.audience || '' });
    const emoSel = el('select', { class: 's2-inp', html: emoOpts(s.emotion || '') });
    const stySel = el('select', { class: 's2-inp', html: styOpts(s.style || '') });
    const notesTa = el('textarea', { class: 's2-ta', style: 'height:46px;', value: s.notes || '' });

    function renderCasting(castMap) {
      casting.innerHTML = '';
      (s.roles || []).forEach(r => {
        const row = el('div', { class: 's2-role-row' });
        row.append(
          el('span', { class: 's2-lbl', style: 'flex:0 0 90px;' }, r.name || 'Role'),
          el('select', { class: 's2-inp', html: _charOptions((castMap && castMap[r.id]) || r.charId), onchange: e => { _vpCast[r.id] = e.target.value; } }),
        );
        casting.append(row);
      });
    }

    // Working state for the popup
    let _vpCast = {};
    function loadVersion(ver) {
      _vpCast = {};
      const cast = ver ? ver.casting : null;
      (s.roles || []).forEach(r => { _vpCast[r.id] = (cast && cast[r.id]) || r.charId || ''; });
      renderCasting(_vpCast);
      textTa.value = ver ? (ver.text || '') : _linesToText(s);
      const ov2 = ver ? (ver.overrides || {}) : {};
      audienceI.value = ov2.audience != null ? ov2.audience : (s.audience || '');
      emoSel.value = ov2.emotion != null ? ov2.emotion : (s.emotion || '');
      stySel.value = ov2.style != null ? ov2.style : (s.style || '');
      notesTa.value = ov2.notes != null ? ov2.notes : (s.notes || '');
    }
    function fillVerSel() {
      verSel.innerHTML = '';
      verSel.append(el('option', { value: '' }, '➕ New project from template'));
      s.versions.forEach(ver => verSel.append(el('option', { value: ver.id }, ver.name || ('Version ' + ver.id))));
    }
    verSel.addEventListener('change', () => {
      const ver = s.versions.find(x => String(x.id) === String(verSel.value));
      loadVersion(ver || null);
    });

    const status = el('div', { class: 's2-vp-status' });
    const createBtn = el('button', { class: 's2-save-btn', onclick: async () => {
      const ver = {
        id: Date.now(),
        name: _scenarioSummary({ ...s, emotion: emoSel.value, style: stySel.value, roles: (s.roles || []).map(r => ({ ...r, charId: _vpCast[r.id] })) }) + '  ·  ' + new Date().toLocaleDateString('en-GB'),
        casting: { ..._vpCast },
        text: textTa.value,
        overrides: { audience: audienceI.value, emotion: emoSel.value, style: stySel.value, notes: notesTa.value },
        createdAt: new Date().toISOString(),
      };
      s.versions.unshift(ver);
      try {
        await fetch('/api/scenarios-v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
      } catch (e) { status.textContent = '⚠ ' + e.message; return; }
      fillVerSel(); verSel.value = ver.id;
      status.textContent = '✅ Version saved. (Edit-project spawning lands in the Produce phase.)';
    } }, '🎬 Create Edit project');

    const box = el('div', { class: 's2-vp-box' },
      el('div', { class: 's2-vp-title' },
        el('span', { style: 'flex:1;' }, '🎬 ' + (s.title || 'Scenario')),
        el('button', { class: 's2-vp-x', onclick: () => ov.remove() }, '✕'),
      ),
      el('div', { class: 's2-vp-body' },
        el('div', { class: 's2-vp-col' },
          el('div', { class: 's2-fld' }, el('label', { class: 's2-lbl' }, 'Version'), verSel),
          el('div', { class: 's2-sec' }, el('div', { class: 's2-sec-h' }, 'Cast (role → character)'), casting),
          el('div', { class: 's2-sec' }, el('div', { class: 's2-sec-h' }, 'Pointwise tweaks'),
            _field('Audience', audienceI), _field('Emotion', emoSel), _field('Style', stySel),
            el('div', { class: 's2-fld s2-fld-col' }, el('label', { class: 's2-lbl' }, 'Notes'), notesTa),
          ),
        ),
        el('div', { class: 's2-vp-col' },
          el('label', { class: 's2-lbl', style: 'margin-bottom:3px;' }, 'Scenario text — editable for this project'),
          textTa,
        ),
      ),
      el('div', { class: 's2-vp-footer' }, status, el('span', { style: 'flex:1;' }), createBtn),
    );
    ov.append(box);
    document.body.append(ov);
    fillVerSel();
    loadVersion(null);
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
  // close any open photoshoot dropdown on an outside click
  document.addEventListener('click', () => { document.querySelectorAll('.s2-shot-dd-list').forEach(l => { l.style.display = 'none'; }); });

  window.ScenariosV2 = { activate };
})();
