/* scen-pickers.js — openEditCellLightbox, openImagePicker, openDetailPicker */

// ── Эдит cell lightbox: slider over all generated variants ───────────────────
// cell           — session.cells[i] (mutated on save)
// onSave(path)   — called with chosen imagePath, then lightbox closes
// availableImgs  — optional explicit list (e.g. obraz variations)
function openEditCellLightbox(cell, onSave, availableImgs) {
  const images = availableImgs?.length ? availableImgs
    : (cell.generatedImages?.length ? cell.generatedImages : null)
    || (cell.imagePath ? [cell.imagePath] : []);
  if (!images.length) return;

  let idx = Math.max(0, images.lastIndexOf(cell.imagePath));

  // Overlay
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9200;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // ── Image row: prev / img / next ────────────────────────────────────────────
  const imgRow = document.createElement('div');
  imgRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

  const prevBtn = document.createElement('button');
  prevBtn.textContent = '◀';
  prevBtn.style.cssText = 'font-size:18px;padding:6px 14px;cursor:pointer;flex-shrink:0;';

  const mainImg = document.createElement('img');
  mainImg.style.cssText =
    'max-width:80vw;max-height:68vh;display:block;object-fit:contain;' +
    'border:2px solid #808080;background:#111;';
  mainImg.addEventListener('click', e => e.stopPropagation());

  const nextBtn = document.createElement('button');
  nextBtn.textContent = '▶';
  nextBtn.style.cssText = 'font-size:18px;padding:6px 14px;cursor:pointer;flex-shrink:0;';

  function render() {
    mainImg.src = images[idx] + '?t=' + Date.now();
    counterEl.textContent = `${idx + 1} / ${images.length}`;
    prevBtn.disabled = (idx === 0);
    nextBtn.disabled = (idx === images.length - 1);
    prevBtn.style.opacity = prevBtn.disabled ? '0.35' : '1';
    nextBtn.style.opacity = nextBtn.disabled ? '0.35' : '1';
  }

  prevBtn.addEventListener('click', () => { if (idx > 0) { idx--; render(); } });
  nextBtn.addEventListener('click', () => { if (idx < images.length - 1) { idx++; render(); } });

  // Keyboard navigation
  function onKey(e) {
    if (e.key === 'ArrowLeft')  { if (idx > 0) { idx--; render(); } }
    if (e.key === 'ArrowRight') { if (idx < images.length - 1) { idx++; render(); } }
    if (e.key === 'Escape')     { overlay.remove(); document.removeEventListener('keydown', onKey); }
    if (e.key === 'Enter')      { save(); }
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('remove', () => document.removeEventListener('keydown', onKey));

  imgRow.appendChild(prevBtn);
  imgRow.appendChild(mainImg);
  imgRow.appendChild(nextBtn);

  // ── Counter ─────────────────────────────────────────────────────────────────
  const counterEl = document.createElement('div');
  counterEl.style.cssText = 'color:#bbb;font-size:11px;letter-spacing:0.5px;';

  // ── Hint ──────────────────────────────────────────────────────────────────
  const hint = document.createElement('div');
  hint.style.cssText = 'color:#777;font-size:10px;';
  hint.textContent = '← → для навигации';

  // ── Buttons ─────────────────────────────────────────────────────────────────
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:2px;';

  function save() {
    document.removeEventListener('keydown', onKey);
    onSave(images[idx]);
    overlay.remove();
  }

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Сохранить';
  saveBtn.style.cssText =
    'padding:5px 24px;font-size:12px;font-weight:bold;cursor:pointer;' +
    'background:#000080;color:#fff;border:2px solid #6060c0;';
  saveBtn.addEventListener('click', save);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Закрыть';
  closeBtn.style.cssText = 'padding:5px 18px;font-size:12px;cursor:pointer;';
  closeBtn.addEventListener('click', () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  });

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(closeBtn);

  overlay.appendChild(imgRow);
  overlay.appendChild(counterEl);
  overlay.appendChild(hint);
  overlay.appendChild(btnRow);
  document.body.appendChild(overlay);
  render();
}

// ── Image variation picker popup (anchored to anchor element) ────────────────
// images     — array of image paths
// anchorEl   — element to position popup near (the clicked img/box)
// currentPath — currently displayed image path
// onSave(path) — called with chosen path, popup closes
function openImagePicker(images, anchorEl, currentPath, onSave) {
  document.getElementById('image-picker-popup')?.remove();
  document.getElementById('image-picker-backdrop')?.remove();
  if (!images || !images.length) return;

  const THUMB_W = 60, THUMB_H = 80, COLS = 2, GAP = 4, PAD = 6;
  const POPUP_W = COLS * THUMB_W + (COLS - 1) * GAP + PAD * 2;

  const rect = anchorEl.getBoundingClientRect();
  let left = rect.left + window.scrollX;
  let top  = rect.bottom + window.scrollY + 4;
  if (left + POPUP_W > window.innerWidth - 8) left = window.innerWidth - POPUP_W - 8;
  if (left < 4) left = 4;

  const backdrop = document.createElement('div');
  backdrop.id = 'image-picker-backdrop';
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:9190;';
  backdrop.addEventListener('click', close);

  const popup = document.createElement('div');
  popup.id = 'image-picker-popup';
  popup.style.cssText =
    `position:absolute;left:${left}px;top:${top}px;z-index:9200;` +
    'background:#1e1e1e;border:1px solid #555;box-shadow:0 4px 16px rgba(0,0,0,0.7);' +
    `padding:${PAD}px;width:${POPUP_W}px;box-sizing:border-box;`;
  popup.addEventListener('click', e => e.stopPropagation());

  const grid = document.createElement('div');
  grid.style.cssText =
    `display:grid;grid-template-columns:repeat(${COLS},${THUMB_W}px);gap:${GAP}px;` +
    'max-height:280px;overflow-y:auto;';

  images.forEach(src => {
    const cell = document.createElement('div');
    const isActive = src === currentPath;
    cell.style.cssText =
      `cursor:pointer;border:2px solid ${isActive ? '#5080ff' : 'transparent'};` +
      `width:${THUMB_W}px;height:${THUMB_H}px;overflow:hidden;background:#333;flex-shrink:0;`;

    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';
    img.onerror = () => { img.style.display = 'none'; cell.style.background = '#555'; };
    cell.appendChild(img);

    cell.addEventListener('mouseenter', () => { if (src !== currentPath) cell.style.borderColor = '#888'; });
    cell.addEventListener('mouseleave', () => { cell.style.borderColor = (src === currentPath) ? '#5080ff' : 'transparent'; });
    cell.addEventListener('click', () => { close(); onSave(src); });
    grid.appendChild(cell);
  });

  popup.appendChild(grid);

  function close() { backdrop.remove(); popup.remove(); }

  document.body.appendChild(backdrop);
  document.body.appendChild(popup);
}

// ── Detail/item picker popup (anchored to anchor element) ────────────────────
// items       — array of { file, name, path, thumbPath }
// anchorEl    — element to position popup near (the clicked detailBox)
// currentFile — currently assigned detail file (or null)
// onSave(item|null) — called with chosen detail object or null (clear), popup closes
function openDetailPicker(items, anchorEl, currentFile, onSave) {
  // Remove any existing picker
  document.getElementById('detail-picker-popup')?.remove();
  if (!items || !items.length) return;

  // ── Position: below the anchor, shifted left to stay in viewport ─────────
  const rect = anchorEl.getBoundingClientRect();
  const POPUP_W = 220;
  let left = rect.left + window.scrollX;
  let top  = rect.bottom + window.scrollY + 4;
  if (left + POPUP_W > window.innerWidth - 8) left = window.innerWidth - POPUP_W - 8;
  if (left < 4) left = 4;

  // ── Backdrop (transparent, closes on outside click) ───────────────────────
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:9190;';
  backdrop.addEventListener('click', close);

  // ── Popup container ───────────────────────────────────────────────────────
  const popup = document.createElement('div');
  popup.id = 'detail-picker-popup';
  popup.style.cssText =
    `position:absolute;left:${left}px;top:${top}px;z-index:9200;` +
    'background:#1e1e1e;border:1px solid #555;box-shadow:0 4px 16px rgba(0,0,0,0.7);' +
    'padding:6px;width:' + POPUP_W + 'px;box-sizing:border-box;';
  popup.addEventListener('click', e => e.stopPropagation());

  // ── Grid of thumbnails ────────────────────────────────────────────────────
  const grid = document.createElement('div');
  grid.style.cssText =
    'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;' +
    'max-height:260px;overflow-y:auto;padding-right:2px;';

  items.forEach(item => {
    const cell = document.createElement('div');
    const isActive = item.file === currentFile;
    cell.style.cssText =
      'cursor:pointer;border:2px solid ' + (isActive ? '#5080ff' : 'transparent') + ';' +
      'background:#333;overflow:hidden;aspect-ratio:1/1;';
    cell.title = item.name || item.file;

    const img = document.createElement('img');
    img.src = (item.thumbPath || item.path);
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';
    img.onerror = () => { img.style.display = 'none'; cell.style.background = '#555'; };
    cell.appendChild(img);

    cell.addEventListener('mouseenter', () => {
      if (item.file !== currentFile) cell.style.borderColor = '#888';
    });
    cell.addEventListener('mouseleave', () => {
      cell.style.borderColor = (item.file === currentFile) ? '#5080ff' : 'transparent';
    });
    cell.addEventListener('click', () => {
      close();
      onSave(item);
    });
    grid.appendChild(cell);
  });

  // ── "Clear" link at bottom ────────────────────────────────────────────────
  const clearRow = document.createElement('div');
  clearRow.style.cssText = 'text-align:center;margin-top:5px;';
  const clearBtn = document.createElement('button');
  clearBtn.textContent = '✕ Убрать предмет';
  clearBtn.style.cssText =
    'font-size:9px;color:#aaa;background:none;border:none;cursor:pointer;padding:2px 6px;';
  clearBtn.addEventListener('click', () => { close(); onSave(null); });
  clearRow.appendChild(clearBtn);

  popup.appendChild(grid);
  popup.appendChild(clearRow);

  function close() {
    backdrop.remove();
    popup.remove();
  }

  document.body.appendChild(backdrop);
  document.body.appendChild(popup);
}

