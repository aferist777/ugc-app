/* ═══════════════════════════════════════════════════════
   LOOKBOOK TAB — generate, show results with checkboxes
   ═══════════════════════════════════════════════════════ */

const lbDropzone    = document.getElementById('lb-dropzone');
const lbInput       = document.getElementById('lb-input');
const lbPreview     = document.getElementById('lb-preview');
const lbPlaceholder = document.getElementById('lb-placeholder');
const btnLbDelete   = document.getElementById('btn-lb-delete');
const btnLbGenerate = document.getElementById('btn-lb-generate');
const lbGrid        = document.getElementById('lb-grid');
let lbBlob = null;

function pollLbTask(taskId, statusEndpoint, type, label) {
  const trackId = `lb_${taskId}`;
  startActiveGen?.(trackId, label || type || 'Task');
  return new Promise((resolve, reject) => {
    const iv = setInterval(async () => {
      try {
        const sr = await fetch(statusEndpoint);
        const sd = await sr.json();
        if (!sd.success) {
          clearInterval(iv);
          finishActiveGen?.(trackId);
          const msg = sd.error || 'Server error';
          logError(label, msg);
          reject(new Error(msg));
          return;
        }
        if (sd.state === 'success') {
          clearInterval(iv);
          finishActiveGen?.(trackId);
          resolve(sd.imagePath);
        } else if (sd.state === 'failed') {
          clearInterval(iv);
          finishActiveGen?.(trackId);
          const msg = sd.error || 'Task failed';
          logError(label, msg);
          reject(new Error(msg));
        } else { setStatus(`${label}: ${sd.state}…`); }
      } catch (e) {
        clearInterval(iv);
        finishActiveGen?.(trackId);
        logError(label, e.message);
        reject(e);
      }
    }, 3000);
  });
}

/* ── Единый дропзон «Лукбук + Окружение» ────────────────────────── */
(function setupLbEnvDropzone() {
  const zone   = document.getElementById('lb-dropzone-mini');
  const input  = document.getElementById('lb-input-mini');
  const prev   = document.getElementById('lb-preview-mini');
  const ph     = document.getElementById('lb-placeholder-mini');
  const delBtn = document.getElementById('btn-lb-delete-mini');
  const genButtons = ['btn-lb-gen-lookbook', 'btn-lb-gen-environment', 'btn-lb-gen-both'].map(id => document.getElementById(id)).filter(Boolean);
  if (!zone) return;

  function showImg(src) {
    prev.src = src; prev.style.display = 'block';
    ph.style.display = 'none'; delBtn.style.display = 'inline-block';
  }
  function clear() {
    prev.src = ''; prev.style.display = 'none';
    ph.style.display = ''; delBtn.style.display = 'none';
    input.value = ''; lbBlob = null;
  }

  zone.addEventListener('click', () => { if (!lbBlob) input.click(); });
  input.addEventListener('change', () => {
    const f = input.files[0]; if (!f) return;
    lbBlob = f; showImg(URL.createObjectURL(f)); setStatus(`Uploaded: ${f.name}`);
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = '#3a5a8a'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = '#999'; });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.style.borderColor = '#999';
    const f = e.dataTransfer.files[0]; if (!f || !f.type.startsWith('image/')) return;
    lbBlob = f; showImg(URL.createObjectURL(f)); setStatus(`Uploaded: ${f.name}`);
  });
  delBtn.addEventListener('click', e => { e.stopPropagation(); clear(); setStatus('Removed.'); });

  async function runGen(mode) {
    if (!lbBlob) { setStatus('Upload an image.'); return; }
    genButtons.forEach(b => b.disabled = true);
    setStatus(mode === 'lookbook' ? 'Extracting lookbook…' : mode === 'environment' ? 'Extracting environment…' : 'Extracting lookbook and environment…');
    try {
      const base64 = await blobToBase64(lbBlob);
      const r = await fetch('/api/lookbook/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mode, imageEngine: (window.getLooksEnvEngine ? window.getLooksEnvEngine() : getCharImageEngine()) }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);

      const tasks = [];
      if (d.clothingTaskId) tasks.push(pollLbTask(d.clothingTaskId, `/api/lookbook/status/${d.clothingTaskId}`,  'clothing',   'Lookbook'));
      if (d.bgTaskId)       tasks.push(pollLbTask(d.bgTaskId,       `/api/environment/status/${d.bgTaskId}`,      'background', 'Background'));
      await Promise.all(tasks);

      if (d.clothingTaskId) window.loadLookbookThumbs?.();
      if (d.bgTaskId)       window.loadEnvironmentThumbs?.();
      setStatus('✓ Saved to database');
    } catch (e) {
      setStatus('✗ ' + (e.message || e));
    } finally { genButtons.forEach(b => b.disabled = false); }
  }

  document.getElementById('btn-lb-gen-lookbook')?.addEventListener('click', () => runGen('lookbook'));
  document.getElementById('btn-lb-gen-environment')?.addEventListener('click', () => runGen('environment'));
  document.getElementById('btn-lb-gen-both')?.addEventListener('click', () => runGen('both'));
})();

/* ── Hidden generate button (legacy, kept for back-compat) ──────── */
btnLbGenerate?.addEventListener('click', () => {
  document.getElementById('btn-lb-generate-mini')?.click();
});
