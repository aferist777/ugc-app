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
  const genBtn = document.getElementById('btn-lb-generate-mini');
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

  genBtn.addEventListener('click', async () => {
    if (!lbBlob) { setStatus('Upload an image.'); return; }
    genBtn.disabled = true;
    setStatus('Generating lookbook and background…');
    const balBefore = currentCredits;
    try {
      const base64 = await blobToBase64(lbBlob);
      const r = await fetch('/api/lookbook/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, imageEngine: getCharImageEngine() }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);

      const [clothingPath, bgPath] = await Promise.all([
        pollLbTask(d.clothingTaskId, `/api/lookbook/status/${d.clothingTaskId}`,  'clothing', 'Lookbook'),
        pollLbTask(d.bgTaskId,       `/api/environment/status/${d.bgTaskId}`,      'background', 'Background'),
      ]);

      loadLookbookThumbs?.();
      loadEnvironmentThumbs?.();
      setStatus('✓ Lookbook and background saved to database');
      if (clothingPath) logGeneration('Lookbook', location.origin + clothingPath, balBefore);
      if (bgPath)       logGeneration('Background', location.origin + bgPath, null);
    } catch (e) {
      setStatus('✗ ' + (e.message || e));
    } finally { genBtn.disabled = false; }
  });
})();

/* ── Hidden generate button (legacy, kept for back-compat) ──────── */
btnLbGenerate?.addEventListener('click', () => {
  document.getElementById('btn-lb-generate-mini')?.click();
});
