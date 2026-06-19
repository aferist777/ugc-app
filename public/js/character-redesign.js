/* ═══════════════════════════════════════════════════════════════════════════
   character-redesign.js — SANDBOX-ONLY enhancement for /character-redesign.html
   ---------------------------------------------------------------------------
   Reorganizes the existing Character DOM at runtime (the shared character.js is
   NOT modified). Nodes are REPARENTED (appendChild), so every original id and
   its event listeners are preserved and character.js keeps working untouched.

   Layout after reorg (3 columns):
     LEFT   = "Character" tools, with a [Создание | Применение] segment toggle:
                Создание  = the old Draft controls (name, params, refine, Save char)
                Применение = the old Apply-to-image panel (Looks&Env + slots) + Save obraz
     CENTRE = the face preview + history nav (unchanged Media column)
     RIGHT  = a saved-characters gallery (replaces the dropdown), Load/Edit/Delete
              on hover + a "+ New" card.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var booted = false;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function fn(name) { return (typeof window[name] === 'function') ? window[name] : null; }

  function boot() {
    if (booted) return;
    var panel = $('l1-character');
    var rowEl = panel && panel.querySelector('.char-cols-row');
    var cols  = rowEl ? rowEl.querySelectorAll(':scope > .col-9-16') : [];
    if (!panel || !rowEl || cols.length < 3) { return setTimeout(boot, 150); }
    booted = true;
    document.documentElement.classList.add('cr-redesign');

    var colTools = cols[0];   // LEFT   (was Draft)
    var colMedia = cols[1];   // CENTRE (preview)  — left as-is
    var colGal   = cols[2];   // RIGHT  (was Apply) — becomes the gallery
    // Marker classes (the row interleaves hidden .char-col-sash elements, so
    // :nth-child() can't reliably target the columns from CSS).
    colTools.classList.add('cr-col-tools');
    colMedia.classList.add('cr-col-preview');
    colGal.classList.add('cr-col-gallery');

    /* ── F1: segment toggle + move Apply-to-image into the left column ───── */
    // Old character dropdown + thumb strip are replaced by the gallery.
    ['char-dd-row', 'char-thumb-row'].forEach(function (id) { var e = $(id); if (e) e.style.display = 'none'; });

    var leftHeader = colTools.querySelector('.col-header');
    if (leftHeader) leftHeader.textContent = 'Character';

    var toggle    = el('div', 'cr-toggle');
    var segCreate = el('button', 'cr-seg cr-active'); segCreate.type = 'button'; segCreate.textContent = 'Create';
    var segApply  = el('button', 'cr-seg');           segApply.type  = 'button'; segApply.textContent  = 'Apply';
    toggle.appendChild(segCreate); toggle.appendChild(segApply);

    var grpCreate = el('div', 'cr-group'); grpCreate.id = 'cr-group-create';
    var grpApply  = el('div', 'cr-group'); grpApply.id  = 'cr-group-apply';

    // Everything currently in the left column (minus the header) is "Создание".
    Array.prototype.slice.call(colTools.children).forEach(function (ch) {
      if (ch === leftHeader) return;
      grpCreate.appendChild(ch);
    });

    // The Apply-to-image controls (Looks&Env button + slots) -> "Применение".
    ['btn-looks-env', 'apply-panel'].forEach(function (id) { var e = $(id); if (e) grpApply.appendChild(e); });
    // Save obraz lives with Применение (save the styled image).
    var saveObraz = $('btn-save-obraz-col2'); if (saveObraz) grpApply.appendChild(saveObraz);

    colTools.appendChild(toggle);
    colTools.appendChild(grpCreate);
    colTools.appendChild(grpApply);

    function setMode(m) {
      var apply = (m === 'apply');
      segApply.classList.toggle('cr-active', apply);
      segCreate.classList.toggle('cr-active', !apply);
      grpCreate.classList.toggle('cr-hide', apply);
      grpApply.classList.toggle('cr-hide', !apply);
    }
    segCreate.addEventListener('click', function () { setMode('create'); });
    segApply.addEventListener('click', function () { if (!segApply.disabled) setMode('apply'); });
    setMode('create');

    // Gate "Применение" until a face exists (nothing to style otherwise).
    var fp = $('face-preview');
    function hasFace() {
      if (!fp) return false;
      var src = fp.getAttribute('src') || '';
      if (!src) return false;
      try { if (getComputedStyle(fp).display === 'none') return false; } catch (e) {}
      return true;
    }
    function refreshApplyGate() {
      var ok = hasFace();
      segApply.disabled = !ok;
      segApply.title = ok ? '' : 'Create or upload a face first';
      if (!ok && !grpApply.classList.contains('cr-hide')) setMode('create');
    }
    if (fp) {
      try { new MutationObserver(refreshApplyGate).observe(fp, { attributes: true, attributeFilter: ['src', 'style'] }); } catch (e) {}
    }
    var fph = $('face-placeholder');
    if (fph) { try { new MutationObserver(refreshApplyGate).observe(fph, { attributes: true, attributeFilter: ['style'] }); } catch (e) {} }
    refreshApplyGate();

    /* ── F2: saved-characters gallery in the right column ────────────────── */
    var galHeader = colGal.querySelector('.col-header');
    if (galHeader) galHeader.textContent = 'Characters';
    // Hide whatever is left in the old Apply column (popup-managed sections like
    // #lookbook-apply-section / #env-select-section stay in the DOM, just hidden,
    // so the Looks&Env popup can still grab them by id).
    Array.prototype.slice.call(colGal.children).forEach(function (ch) {
      if (ch === galHeader) return;
      ch.style.display = 'none';
    });
    var gal = el('div', 'cr-gallery'); gal.id = 'cr-gallery';
    colGal.appendChild(gal);

    function curId() { var g = fn('_getCurrentCharId'); try { return g ? g() : null; } catch (e) { return null; } }
    // _actorCache is a top-level `let` in character.js (shared global lexical scope,
    // NOT a window property), so read it by bare name, not via window.
    function actors() { try { return (typeof _actorCache !== 'undefined' && Array.isArray(_actorCache)) ? _actorCache : []; } catch (e) { return []; } }

    function renderGallery() {
      var chars = actors();
      var sel = curId();
      gal.innerHTML = '';

      var nw = el('button', 'cr-card cr-new'); nw.type = 'button';
      nw.innerHTML = '<span class="cr-new-plus">+</span><span class="cr-new-lbl">New</span>';
      nw.title = 'New character (clears selection)';
      nw.addEventListener('click', startNew);
      gal.appendChild(nw);

      chars.forEach(function (c) {
        var card = el('div', 'cr-card'); card.dataset.charId = c.id;
        if (sel != null && String(sel) === String(c.id)) card.classList.add('cr-selected');

        var im = el('img', 'cr-card-img'); im.loading = 'lazy';
        var full = c.portrait || c.baseFace || c.tpose || '';
        if (full) { var lt = fn('loadThumb'); if (lt) lt(im, full); else im.src = full; }

        var nm = el('div', 'cr-card-name'); nm.textContent = c.name || 'Unnamed';

        var acts = el('div', 'cr-card-acts');
        var bL = el('button', 'cr-act');        bL.type = 'button'; bL.textContent = 'Load';
        var bE = el('button', 'cr-act');        bE.type = 'button'; bE.textContent = 'Edit';
        var bD = el('button', 'cr-act cr-act-del'); bD.type = 'button'; bD.textContent = 'Delete';
        bL.addEventListener('click', function (e) { e.stopPropagation(); loadChar(c); });
        bE.addEventListener('click', function (e) { e.stopPropagation(); var f = fn('openCharacterActorPopup'); if (f) f(c.id); });
        bD.addEventListener('click', function (e) { e.stopPropagation(); delChar(c); });
        acts.appendChild(bL); acts.appendChild(bE); acts.appendChild(bD);

        card.appendChild(im); card.appendChild(nm); card.appendChild(acts);
        card.addEventListener('click', function () { loadChar(c); });
        gal.appendChild(card);
      });
    }

    function loadChar(c) {
      var f = fn('_loadActorByItem');
      if (f) { try { f(c); } catch (e) { console.warn('[cr] load failed', e); } }
      renderGallery();
    }
    function startNew() {
      var f = fn('_setCurrentCharId'); if (f) { try { f(null); } catch (e) {} }
      setMode('create');
      renderGallery();
    }
    function delChar(c) {
      if (!confirm('Delete character "' + (c.name || '') + '"? Its photoshoots will be removed too.')) return;
      // Mirror character.js's cascade: drop this actor's photoshoots first.
      try {
        var getO = fn('getObrazы'); var delO = fn('deleteObraz');
        if (getO && delO) getO().filter(function (o) { return String(o.charId) === String(c.id); })
          .forEach(function (o) { try { delO(o.id); } catch (e) {} });
      } catch (e) {}
      fetch('/api/char-store/' + encodeURIComponent(c.id), { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.success) {
            try { if (curId() != null && String(curId()) === String(c.id)) { var s = fn('_setCurrentCharId'); if (s) s(null); } } catch (e) {}
            var lct = fn('loadCharacterThumbs'); if (lct) lct();   // refreshes _actorCache -> wrapper re-renders
            var lo = fn('loadObrazы'); if (lo) lo();
            var ls = fn('loadScenarioObrazы'); if (ls) ls();
            var lc3 = fn('loadCharCol3Obrazy'); if (lc3) lc3();
          } else { alert('Delete failed: ' + ((d && d.error) || '')); }
        })
        .catch(function (e) { alert('Delete error: ' + e.message); });
    }

    // Re-render the gallery whenever the app refreshes the character list.
    var lct0 = fn('loadCharacterThumbs');
    if (lct0) {
      window.loadCharacterThumbs = function () {
        var r = lct0.apply(this, arguments);
        Promise.resolve(r).then(renderGallery, renderGallery);
        return r;
      };
    }

    // Initial render (+ short poll until the first /api/char-store/list resolves).
    renderGallery();
    var tries = 0;
    (function poll() {
      renderGallery();
      if (!actors().length && tries++ < 12) setTimeout(poll, 300);
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
