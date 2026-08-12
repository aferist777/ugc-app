/* ═══════════════════════════════════════════════════════════════════════════
   HOOKS STORE — the hook library, and the popup that puts files in it.

   Lifted out of scen-hooks.js, which is part of the old Scenarios block that is on its
   way out. These four names are the only ones the LIVE editor uses, so they should not
   go down with it:

     getHooksArchive / setHooksArchive   read by mergev2-adapter, mergev2-render and
                                         mergev2-tab whenever the timeline resolves a hook
     removeHookEntry                     the x on a hook card in the Merge gallery
     openHooksUploadPopup                the "+ Upload hooks" button in the Merge media bar

   The store itself is hooks_archive_v1 in localStorage, mirrored to data/hooks-archive.json
   by hooks-server-sync.js - that layer stays where it is and owns the syncing.

   What stayed behind in scen-hooks.js is the old UI: the archive grid of the retired Birols
   tab and the per-session hook bars of the old Sklejka. Nothing outside that file calls
   them except scen-timeline, which is the same block.

   cleanOrphanHooks came out here too and was dropped instead: it was exposed on window and
   nothing anywhere called it.
   ═══════════════════════════════════════════════════════════════════════════ */

const HOOKS_ARCHIVE_KEY = 'hooks_archive_v1';
function getHooksArchive()  { try { return JSON.parse(localStorage.getItem(HOOKS_ARCHIVE_KEY) || '[]'); } catch { return []; } }
function setHooksArchive(a) { localStorage.setItem(HOOKS_ARCHIVE_KEY, JSON.stringify(a)); }

// Remove a hook from the library by entry (used by the merge gallery × button). No confirm.
// Deletes the server file too, drops it from hooks_archive_v1, and refreshes views.
function removeHookEntry(hook) {
  if (!hook) return;
  if (hook.filename) {
    fetch('/api/hooks/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: hook.filename }) }).catch(() => {});
  }
  const arr = getHooksArchive();
  const i = arr.findIndex(h => (hook.id != null ? h.id === hook.id : h.videoPath === hook.videoPath));
  if (i >= 0) arr.splice(i, 1);
  setHooksArchive(arr);
  try { if (typeof loadAllHooks === 'function') loadAllHooks(); } catch {}
  window.refreshTimelineBirolys?.();
}
function _huid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

const HOOKS_MAX_MB = 20;

// ── Client-side video thumbnail via canvas ────────────────────────────────────
function generateVideoThumb(file, w = 200) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'metadata';
    let done = false;
    const finish = (dataUrl) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(dataUrl);
    };
    const drawFrame = () => {
      try {
        const h = vid.videoHeight ? Math.round(vid.videoHeight / vid.videoWidth * w) : Math.round(w * 9 / 16);
        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h || 120;
        canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.75));
      } catch { finish(null); }
    };
    vid.addEventListener('seeked',  drawFrame, { once: true });
    vid.addEventListener('error',   () => finish(null), { once: true });
    vid.addEventListener('loadedmetadata', () => {
      vid.currentTime = Math.min(0.5, (vid.duration || 1) * 0.1);
    }, { once: true });
    setTimeout(() => finish(null), 6000);
    vid.src = url;
  });
}

// ── Mini video preview lightbox (used inside popup) ───────────────────────────
function openVideoPreviewPopup(file) {
  const url = URL.createObjectURL(file);
  let lb = document.getElementById('hooks-vid-preview-lb');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'hooks-vid-preview-lb';
    lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:11000;align-items:center;justify-content:center;cursor:pointer;';
    document.body.appendChild(lb);
  }
  lb.innerHTML = '';
  const vid = document.createElement('video');
  vid.src = vid._objectUrl = url;
  vid.controls = true;
  vid.autoplay = true;
  vid.style.cssText = 'max-width:92vw;max-height:90vh;display:block;';
  vid.addEventListener('click', e => e.stopPropagation());
  lb.appendChild(vid);
  lb.style.display = 'flex';
  lb.onclick = () => {
    lb.style.display = 'none';
    vid.pause();
    URL.revokeObjectURL(url);
  };
}

// ── Upload popup: preview grid + rename + confirm ────────────────────────────
async function openHooksUploadPopup(rawFiles) {
  // Filter by size
  const valid     = rawFiles.filter(f => f.size <= HOOKS_MAX_MB * 1024 * 1024);
  const oversized = rawFiles.filter(f => f.size >  HOOKS_MAX_MB * 1024 * 1024);

  if (!valid.length) {
    alert(`All files exceed ${HOOKS_MAX_MB} MB.\nMaximum file size: ${HOOKS_MAX_MB} MB.`);
    return;
  }

  // Show popup skeleton immediately
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;';
  document.body.appendChild(overlay);

  const popup = document.createElement('div');
  popup.style.cssText = 'background:#c0c0c0;border:2px solid;border-color:#fff #808080 #808080 #fff;padding:10px;min-width:320px;max-width:92vw;max-height:90vh;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;';

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#000080;color:#fff;padding:3px 8px;margin:-10px -10px 0;flex-shrink:0;';
  const titleTxt = document.createElement('span');
  titleTxt.style.cssText = 'font-size:11px;font-weight:bold;';
  titleTxt.textContent = `Uploading hooks (${valid.length} file${valid.length === 1 ? '' : 's'})`;
  const closeBtnT = document.createElement('button');
  closeBtnT.textContent = '✕';
  closeBtnT.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:13px;padding:0 2px;line-height:1;';
  closeBtnT.addEventListener('click', () => overlay.remove());
  titleBar.appendChild(titleTxt);
  titleBar.appendChild(closeBtnT);
  popup.appendChild(titleBar);

  // Oversized warning
  if (oversized.length) {
    const warn = document.createElement('div');
    warn.style.cssText = 'font-size:9px;color:#993300;background:#ffe0d0;padding:4px 6px;border:1px solid #cc6633;flex-shrink:0;';
    warn.textContent = `⚠ Skipped (> ${HOOKS_MAX_MB} MB): ${oversized.map(f => f.name).join(', ')}`;
    popup.appendChild(warn);
  }

  // Grid placeholder while generating thumbs
  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;overflow-y:auto;max-height:55vh;padding:4px;flex:1;';
  grid.innerHTML = '<span style="font-size:10px;color:#555;padding:8px;">⏳ Generating previews…</span>';
  popup.appendChild(grid);

  // Status + buttons row (rendered now, active after thumbs load)
  const statusEl = document.createElement('span');
  statusEl.style.cssText = 'font-size:9px;color:#555;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'font-size:9px;padding:3px 10px;cursor:pointer;flex-shrink:0;';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const addBtn = document.createElement('button');
  addBtn.textContent = `Add (${valid.length})`;
  addBtn.disabled = true;
  addBtn.style.cssText = 'font-size:9px;padding:3px 14px;cursor:pointer;background:#c0ffc0;border:1px solid #4a8a4a;font-weight:bold;flex-shrink:0;';

  const bottomRow = document.createElement('div');
  bottomRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:2px;flex-shrink:0;';
  bottomRow.appendChild(statusEl);
  bottomRow.appendChild(cancelBtn);
  bottomRow.appendChild(addBtn);
  popup.appendChild(bottomRow);

  overlay.appendChild(popup);
  popup.addEventListener('mousedown', e => e.stopPropagation());
  popup.addEventListener('click',     e => e.stopPropagation());
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });

  // Generate thumbnails in parallel
  const items = await Promise.all(valid.map(async file => ({
    file,
    name: file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '').trim().slice(0, 50) || 'hook',
    thumb: await generateVideoThumb(file),
  })));

  // Render preview cards (re-callable when items array changes)
  const renderGrid = () => {
    grid.innerHTML = '';
    addBtn.textContent = `Add (${items.length})`;
    addBtn.disabled = items.length === 0;
    items.forEach((item, i) => {
      const card = document.createElement('div');
      card.style.cssText = 'display:flex;flex-direction:column;gap:3px;width:110px;background:#e0e0e0;padding:4px;border:1px solid #aaa;flex-shrink:0;position:relative;';

      // Remove from list button
      const delX = document.createElement('button');
      delX.textContent = '✕';
      delX.title = 'Remove from upload';
      delX.style.cssText = 'position:absolute;top:2px;right:2px;width:16px;height:16px;font-size:9px;padding:0;line-height:16px;text-align:center;cursor:pointer;background:rgba(180,0,0,0.75);color:#fff;border:none;z-index:2;border-radius:2px;';
      delX.addEventListener('click', () => { items.splice(i, 1); renderGrid(); });
      card.appendChild(delX);

      const thumbWrap = document.createElement('div');
      thumbWrap.style.cssText = 'width:100%;height:68px;background:#111;overflow:hidden;cursor:pointer;border:1px solid #808080;display:flex;align-items:center;justify-content:center;';
      thumbWrap.title = '▶ Click to preview';
      thumbWrap.addEventListener('click', () => openVideoPreviewPopup(item.file));
      if (item.thumb) {
        const img = document.createElement('img');
        img.src = item.thumb;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        thumbWrap.appendChild(img);
      } else {
        thumbWrap.innerHTML = '<span style="color:#fff;font-size:22px;pointer-events:none;">▶</span>';
      }
      card.appendChild(thumbWrap);

      const nameInp = document.createElement('input');
      nameInp.type  = 'text';
      nameInp.value = item.name;
      nameInp.style.cssText = 'font-size:9px;width:100%;box-sizing:border-box;padding:2px 3px;border:1px solid #aaa;';
      nameInp.placeholder = 'Name';
      nameInp.addEventListener('input',  () => { items[i].name = nameInp.value; });
      nameInp.addEventListener('change', () => { items[i].name = nameInp.value.trim() || item.file.name.replace(/\.[^.]+$/, ''); nameInp.value = items[i].name; });
      card.appendChild(nameInp);

      const sizeEl = document.createElement('div');
      sizeEl.style.cssText = 'font-size:8px;color:#666;';
      sizeEl.textContent = (item.file.size / (1024 * 1024)).toFixed(1) + ' MB';
      card.appendChild(sizeEl);

      grid.appendChild(card);
    });
  };
  renderGrid();

  // Upload handler
  addBtn.addEventListener('click', async () => {
    addBtn.disabled   = true;
    cancelBtn.disabled = true;
    let done = 0, failed = 0;

    const totalToUpload = items.length;
    for (const item of items) {
      statusEl.textContent = `⏳ ${done + failed + 1}/${totalToUpload} ${item.name}…`;
      try {
        const formData = new FormData();
        formData.append('video', item.file, item.file.name);
        formData.append('name',  item.name);
        const r  = await fetch('/api/hooks/upload', { method: 'POST', body: formData });
        let rj;
        try { rj = await r.json(); }
        catch (e) { throw new Error(`Server returned non-JSON (status ${r.status})`); }
        if (!rj.success) throw new Error(rj.error || `Server error (${r.status})`);
        const arr = getHooksArchive();
        arr.unshift({
          id:        _huid(),
          name:      rj.name,
          categoryId:    '',   // uncategorized on upload; assigned in Library -> Hooks
          categoryLabel: '',
          filename:  rj.filename,
          videoPath: rj.videoPath,
          thumbPath: rj.thumbPath || null,
          date:      new Date().toISOString(),
        });
        setHooksArchive(arr);
        console.log('[hooks] saved to archive:', rj.filename, '| total:', arr.length);
        done++;
      } catch (err) {
        failed++;
        console.error('[hooks upload] ERROR:', item.file.name, '—', err.message);
        statusEl.textContent = `⚠ ${item.file.name}: ${err.message}`;
      }
    }

    overlay.remove();
    loadAllHooks();
    window.refreshTimelineBirolys?.();
    window.MV2Tab?.refreshMedia?.();   // refresh the Merge v2 left gallery
    console.log('[hooks] archive after upload:', getHooksArchive());
  });
}
window.getHooksArchive      = getHooksArchive;
window.setHooksArchive      = setHooksArchive;
window.removeHookEntry      = removeHookEntry;
window.openHooksUploadPopup = openHooksUploadPopup;
