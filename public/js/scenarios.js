/* ═══════════════════════════════════════
   SCENARIOS & DETAILS tabs
   ═══════════════════════════════════════ */

// ── Scenario assignments ──────────────────────────────────────────────────────
let scenarioAssignments = {};

async function loadScenarioAssignments() {
  try {
    const d = await fetch('/api/scenarios/assignments').then(r => r.json());
    if (d.success) scenarioAssignments = d.assignments;
  } catch {}
}

async function saveScenarioAssignments() {
  await fetch('/api/scenarios/assignments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments: scenarioAssignments }),
  });
}

// ── Build scenario item ───────────────────────────────────────────────────────
function buildScenarioItem(file, detailFiles) {
  const item   = document.createElement('div');
  item.className = 'scenario-item';

  const header = document.createElement('div');
  header.className = 'scenario-item-header';

  const delBtn = document.createElement('button');
  delBtn.className = 'scenario-del-btn'; delBtn.textContent = '🗑'; delBtn.title = 'Удалить сценарий';
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Удалить сценарий «${file.name}»?`)) return;
    try {
      const r = await fetch('/api/scenarios/delete', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.file }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      item.remove(); setStatus(`Удалено: ${file.name}`);
    } catch (err) { setStatus('Ошибка: ' + err.message); }
  });

  const toggle = document.createElement('span');
  toggle.className = 'scenario-toggle'; toggle.textContent = '▶';

  const title = document.createElement('span');
  title.className = 'scenario-title'; title.textContent = file.name;

  header.appendChild(delBtn); header.appendChild(toggle); header.appendChild(title);

  const body = document.createElement('div');
  body.className = 'scenario-body';
  let loaded = false;

  header.addEventListener('click', async () => {
    const open = body.classList.toggle('open');
    toggle.textContent = open ? '▼' : '▶';
    if (!open || loaded) return;
    body.innerHTML = '<span style="font-size:11px;color:#888;">Загрузка…</span>';
    try {
      const d = await fetch(`/api/scenarios/${encodeURIComponent(file.file)}`).then(r => r.json());
      body.innerHTML = '';

      const saveRow = document.createElement('div');
      saveRow.style.cssText = 'margin-bottom:6px;';
      const saveBtn = document.createElement('button');
      saveBtn.textContent = '💾 Сохранить назначения'; saveBtn.style.fontSize = '11px';
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        await saveScenarioAssignments();
        setStatus('Назначения сохранены.');
        saveBtn.disabled = false;
      });
      saveRow.appendChild(saveBtn);
      body.appendChild(saveRow);

      d.lines.forEach((line, i) => {
        const row = document.createElement('div');
        row.className = 'scenario-line';

        const num  = document.createElement('span');
        num.className = 'scenario-line-num'; num.textContent = i + 1;

        const text = document.createElement('span');
        text.className = 'scenario-line-text'; text.textContent = line;

        const sel = document.createElement('select');
        sel.className = 'scenario-detail-select';
        const blank = document.createElement('option');
        blank.value = ''; blank.textContent = '— предмет —';
        sel.appendChild(blank);
        detailFiles.forEach(df => {
          const opt = document.createElement('option');
          opt.value = df.file; opt.textContent = df.name;
          sel.appendChild(opt);
        });
        const key = `${file.file}__${i}`;
        if (scenarioAssignments[key]) sel.value = scenarioAssignments[key];
        sel.addEventListener('change', () => { scenarioAssignments[key] = sel.value; });

        row.appendChild(num); row.appendChild(text); row.appendChild(sel);
        body.appendChild(row);
      });
      loaded = true;
    } catch { body.textContent = 'Ошибка загрузки'; }
  });

  item.appendChild(header); item.appendChild(body);
  return item;
}

// ── Load scenarios ────────────────────────────────────────────────────────────
const scenarioList = document.getElementById('scenario-list');

async function loadScenarios() {
  if (!scenarioList) return;
  try {
    const [sd, dd] = await Promise.all([
      fetch('/api/scenarios').then(r => r.json()),
      fetch('/api/details').then(r => r.json()),
    ]);
    await loadScenarioAssignments();
    scenarioList.innerHTML = '';
    if (!sd.files.length) {
      scenarioList.innerHTML = '<div style="color:#888;font-size:11px;">Нет сценариев</div>';
      return;
    }
    sd.files.forEach(f => scenarioList.appendChild(buildScenarioItem(f, dd.success ? dd.files : [])));
  } catch { scenarioList.innerHTML = '<div style="color:#888;font-size:11px;">Ошибка загрузки</div>'; }
}

// ── Upload scenario file ──────────────────────────────────────────────────────
const scenarioDropzone  = document.getElementById('scenario-dropzone');
const scenarioInput     = document.getElementById('scenario-input');
const scenarioFileLabel = document.getElementById('scenario-file-label');
const scenarioNameInput = document.getElementById('scenario-name');
const btnScenarioUpload = document.getElementById('btn-scenario-upload');
let scenarioBlob = null;

scenarioDropzone?.addEventListener('click', () => scenarioInput?.click());
scenarioDropzone?.addEventListener('dragover', e => { e.preventDefault(); scenarioDropzone.classList.add('drag-over'); });
scenarioDropzone?.addEventListener('dragleave', () => scenarioDropzone.classList.remove('drag-over'));
scenarioDropzone?.addEventListener('drop', e => {
  e.preventDefault(); scenarioDropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (!f || !f.name.endsWith('.txt')) { setStatus('Только .txt файлы.'); return; }
  scenarioBlob = f; scenarioFileLabel.textContent = f.name;
  scenarioDropzone.classList.add('has-file'); btnScenarioUpload.disabled = false;
});
scenarioInput?.addEventListener('change', () => {
  const f = scenarioInput.files[0]; if (!f) return;
  scenarioBlob = f; scenarioFileLabel.textContent = f.name;
  scenarioDropzone.classList.add('has-file'); btnScenarioUpload.disabled = false;
});

btnScenarioUpload?.addEventListener('click', async () => {
  if (!scenarioBlob) return;
  btnScenarioUpload.disabled = true; setStatus('Загружаю сценарий…');
  try {
    const base64 = await blobToBase64(scenarioBlob);
    const r = await fetch('/api/scenarios/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBase64: base64, name: scenarioNameInput.value.trim() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Сценарий сохранён: ${d.name}`);
    scenarioBlob = null;
    scenarioFileLabel.textContent = 'Нажмите или перетащите .txt файл';
    scenarioDropzone.classList.remove('has-file');
    scenarioNameInput.value = ''; scenarioInput.value = '';
    loadScenarios();
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btnScenarioUpload.disabled = false; }
});

// ── Manual text input ─────────────────────────────────────────────────────────
document.getElementById('btn-scenario-manual-upload')?.addEventListener('click', async () => {
  const text = document.getElementById('scenario-manual-text')?.value.trim();
  if (!text) { setStatus('Введите текст сценария.'); return; }
  const btn = document.getElementById('btn-scenario-manual-upload');
  btn.disabled = true; setStatus('Сохраняю сценарий…');
  try {
    const base64 = btoa(unescape(encodeURIComponent(text)));
    const r = await fetch('/api/scenarios/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textBase64: base64, name: document.getElementById('scenario-manual-name')?.value.trim() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Сценарий сохранён: ${d.name}`);
    document.getElementById('scenario-manual-text').value = '';
    document.getElementById('scenario-manual-name').value = '';
    loadScenarios();
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btn.disabled = false; }
});

// ── Details ───────────────────────────────────────────────────────────────────
const detailDropzone    = document.getElementById('detail-dropzone');
const detailInput       = document.getElementById('detail-input');
const detailPreview     = document.getElementById('detail-preview');
const detailPlaceholder = document.getElementById('detail-placeholder');
const btnDetailDelete   = document.getElementById('btn-detail-delete');
const btnDetailUpload   = document.getElementById('btn-detail-upload');
const detailNameInput   = document.getElementById('detail-name');
const detailsGrid       = document.getElementById('details-grid');
let detailBlob = null;

function detailShowImg(src) {
  detailPreview.src = src; detailPreview.style.display = 'block';
  detailPlaceholder.style.display = 'none'; btnDetailDelete.style.display = 'inline-block';
}
function detailClear() {
  detailPreview.src = ''; detailPreview.style.display = 'none';
  detailPlaceholder.style.display = 'block'; btnDetailDelete.style.display = 'none';
  detailInput.value = ''; detailBlob = null; btnDetailUpload.disabled = true;
}

detailDropzone?.addEventListener('click', () => {
  if (!detailPreview.style.display || detailPreview.style.display === 'none') detailInput?.click();
});
detailPreview?.addEventListener('click', e => { e.stopPropagation(); openLightbox(detailPreview.src); });
detailDropzone?.addEventListener('dragover', e => { e.preventDefault(); detailDropzone.classList.add('drag-over'); });
detailDropzone?.addEventListener('dragleave', () => detailDropzone.classList.remove('drag-over'));
detailDropzone?.addEventListener('drop', e => {
  e.preventDefault(); detailDropzone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0]; if (!f || !f.type.startsWith('image/')) return;
  detailBlob = f; detailShowImg(URL.createObjectURL(f)); btnDetailUpload.disabled = false;
});
detailInput?.addEventListener('change', () => {
  const f = detailInput.files[0]; if (!f) return;
  detailBlob = f; detailShowImg(URL.createObjectURL(f)); btnDetailUpload.disabled = false;
});
btnDetailDelete?.addEventListener('click', e => { e.stopPropagation(); detailClear(); });

btnDetailUpload?.addEventListener('click', async () => {
  if (!detailBlob) return;
  btnDetailUpload.disabled = true; setStatus('Сохраняю предмет…');
  try {
    const base64 = await blobToBase64(detailBlob);
    const r = await fetch('/api/details/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, name: detailNameInput.value.trim() }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    setStatus(`Предмет сохранён: ${d.name}`);
    detailClear(); detailNameInput.value = '';
    loadDetails();
  } catch (e) { setStatus('Ошибка: ' + e.message); }
  finally { btnDetailUpload.disabled = false; }
});

async function loadDetails() {
  if (!detailsGrid) return;
  try {
    const d = await fetch('/api/details').then(r => r.json());
    detailsGrid.innerHTML = '';
    if (!d.files.length) { detailsGrid.innerHTML = '<div class="gallery-empty">Нет предметов</div>'; return; }
    d.files.forEach(item => detailsGrid.appendChild(buildGalleryCard(item)));
  } catch { detailsGrid.innerHTML = '<div class="gallery-empty">Ошибка загрузки</div>'; }
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadScenarios();
