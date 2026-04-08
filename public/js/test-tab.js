/* ═══════════════════════════════════════════════════════════════════
   TEST TAB — isolated sandbox for trying new API calls / features.
   Reads from main-tab globals (generatedImagePath, currentFaceBlob,
   selectedLbPath, selectedEnvPath) but NEVER writes to them.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  /* ── own state, completely isolated ───────────────────────────── */
  let _testBlob    = null;   // uploaded image for this tab only
  let _taskPoller  = null;   // setInterval handle

  /* ── DOM refs ─────────────────────────────────────────────────── */
  const imgSource     = document.getElementById('test-img-source');
  const uploadRow     = document.getElementById('test-upload-row');
  const dropzone      = document.getElementById('test-img-dropzone');
  const imgInput      = document.getElementById('test-img-input');
  const imgPreview    = document.getElementById('test-img-preview');
  const imgPlaceholder= document.getElementById('test-img-placeholder');
  const modelSel      = document.getElementById('test-model');
  const promptTA      = document.getElementById('test-prompt');
  const extraTA       = document.getElementById('test-extra-params');
  const btnReadCtx    = document.getElementById('btn-test-read-ctx');
  const btnRun        = document.getElementById('btn-test-run');
  const btnClear      = document.getElementById('btn-test-clear');
  const btnClearLog   = document.getElementById('btn-test-clear-log');
  const statusEl      = document.getElementById('test-status');
  const outputEl      = document.getElementById('test-request-output');
  const rawLogEl      = document.getElementById('test-raw-log');
  const resultImg     = document.getElementById('test-result-img');

  /* ── helpers ───────────────────────────────────────────────────── */
  function setTestStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  function appendLog(label, data) {
    const ts   = new Date().toLocaleTimeString('ru-RU');
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const prev = rawLogEl.textContent === 'Нет данных' ? '' : rawLogEl.textContent;
    rawLogEl.textContent = `[${ts}] ${label}\n${text}\n\n` + prev;
  }

  function showPreview(src) {
    imgPreview.src = src;
    imgPreview.style.display = 'block';
    imgPlaceholder.style.display = 'none';
  }
  function clearPreview() {
    imgPreview.src = '';
    imgPreview.style.display = 'none';
    imgPlaceholder.style.display = 'block';
    _testBlob = null;
  }

  /* ── image source selector ─────────────────────────────────────── */
  imgSource?.addEventListener('change', () => {
    uploadRow.style.display = imgSource.value === 'upload' ? 'block' : 'none';
    if (imgSource.value !== 'upload') clearPreview();
  });

  dropzone?.addEventListener('click', () => {
    if (!imgPreview.style.display || imgPreview.style.display === 'none')
      imgInput?.click();
  });
  imgPreview?.addEventListener('click', e => {
    e.stopPropagation();
    if (imgPreview.src) openLightbox(imgPreview.src);
  });
  dropzone?.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone?.addEventListener('drop', e => {
    e.preventDefault(); dropzone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (!f || !f.type.startsWith('image/')) return;
    _testBlob = f;
    showPreview(URL.createObjectURL(f));
  });
  imgInput?.addEventListener('change', () => {
    const f = imgInput.files[0]; if (!f) return;
    _testBlob = f;
    showPreview(URL.createObjectURL(f));
  });

  /* ── "⬇ Из сессии" — copy readable values from main tabs ──────── */
  btnReadCtx?.addEventListener('click', () => {
    const lines = [];

    // generatedImagePath — path string, safe to read
    if (typeof generatedImagePath !== 'undefined' && generatedImagePath) {
      lines.push(`Сгенерированное: ${generatedImagePath}`);
      imgSource.value = 'generated';
      uploadRow.style.display = 'none';
    }
    if (typeof selectedLbPath !== 'undefined' && selectedLbPath)
      lines.push(`Лукбук: ${selectedLbPath}`);
    if (typeof selectedEnvPath !== 'undefined' && selectedEnvPath)
      lines.push(`Окружение: ${selectedEnvPath}`);
    if (typeof currentCredits !== 'undefined')
      lines.push(`Кредиты: ${currentCredits}`);

    if (lines.length) {
      outputEl.textContent = 'Значения из сессии:\n' + lines.join('\n');
      setTestStatus('Значения считаны.');
    } else {
      setTestStatus('Нет доступных значений из сессии.');
    }
  });

  /* ── clear button ──────────────────────────────────────────────── */
  btnClear?.addEventListener('click', () => {
    promptTA.value = '';
    extraTA.value  = '';
    outputEl.textContent = 'Нет данных';
    resultImg.style.display = 'none';
    resultImg.src = '';
    setTestStatus('');
    clearPreview();
    imgSource.value = 'none';
    uploadRow.style.display = 'none';
    if (_taskPoller) { clearInterval(_taskPoller); _taskPoller = null; }
  });

  btnClearLog?.addEventListener('click', () => { rawLogEl.textContent = 'Нет данных'; });

  /* ── resolve image to base64 string ────────────────────────────── */
  async function resolveImageBase64() {
    const src = imgSource.value;
    if (src === 'none') return null;

    if (src === 'upload') {
      if (!_testBlob) { setTestStatus('Загрузите изображение.'); return null; }
      return await blobToBase64(_testBlob);
    }

    // reading path globals — read-only, no writes
    let imgPath = null;
    if (src === 'generated' && typeof generatedImagePath !== 'undefined')
      imgPath = generatedImagePath;
    else if (src === 'lookbook' && typeof selectedLbPath !== 'undefined')
      imgPath = selectedLbPath;
    else if (src === 'environment' && typeof selectedEnvPath !== 'undefined')
      imgPath = selectedEnvPath;
    else if (src === 'face' && typeof currentFaceBlob !== 'undefined' && currentFaceBlob)
      return await blobToBase64(currentFaceBlob);

    if (!imgPath) { setTestStatus('Изображение не выбрано в основных вкладках.'); return null; }

    // fetch the image and convert to base64
    const resp = await fetch(imgPath);
    if (!resp.ok) { setTestStatus('Не удалось загрузить изображение: ' + imgPath); return null; }
    const blob = await resp.blob();
    return await blobToBase64(blob);
  }

  /* ── main run ───────────────────────────────────────────────────── */
  btnRun?.addEventListener('click', async () => {
    if (_taskPoller) { clearInterval(_taskPoller); _taskPoller = null; }
    btnRun.disabled = true;
    setTestStatus('Подготовка…');
    resultImg.style.display = 'none';
    outputEl.textContent = '…';

    try {
      const model  = modelSel.value;
      const prompt = promptTA.value.trim();

      // parse extra params
      let extra = {};
      if (extraTA.value.trim()) {
        try { extra = JSON.parse(extraTA.value.trim()); }
        catch { setTestStatus('Ошибка: доп. параметры не валидный JSON'); btnRun.disabled = false; return; }
      }

      // build input object
      const input = { prompt, ...extra };

      // attach image if source selected
      const src = imgSource.value;
      if (src !== 'none') {
        setTestStatus('Загружаю изображение…');
        const base64 = await resolveImageBase64();
        if (!base64) { btnRun.disabled = false; return; }

        if (model.startsWith('qwen2')) {
          // upload to public host via server helper
          const upRes = await fetch('/api/test/upload-b64', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64 }),
          });
          const upData = await upRes.json();
          appendLog('upload response', upData);
          if (!upData.success) throw new Error(upData.error || 'Upload failed');
          input.image_url = upData.url;
        } else {
          // nano-banana style: pass base64 directly
          input.image_input = base64;
        }
      }

      const payload = { model, input };
      setTestStatus('Отправляю задачу…');
      appendLog('payload', payload);

      const taskRes = await fetch('/api/test/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const taskData = await taskRes.json();
      appendLog('task response', taskData);
      outputEl.textContent = JSON.stringify(taskData, null, 2);

      const taskId = taskData?.data?.taskId;
      if (!taskId) throw new Error('taskId не получен: ' + JSON.stringify(taskData));

      setTestStatus(`Задача создана: ${taskId}. Ожидаю результат…`);

      // poll
      let attempts = 0;
      _taskPoller = setInterval(async () => {
        attempts++;
        if (attempts > 120) {
          clearInterval(_taskPoller); _taskPoller = null;
          setTestStatus('Timeout — слишком долго.');
          btnRun.disabled = false;
          return;
        }
        try {
          const sRes  = await fetch(`/api/status/${taskId}`);
          const sData = await sRes.json();
          appendLog(`poll #${attempts}`, sData);

          if (sData.state === 'success') {
            clearInterval(_taskPoller); _taskPoller = null;
            outputEl.textContent = JSON.stringify(sData, null, 2);
            if (sData.imagePath) {
              resultImg.src = sData.imagePath;
              resultImg.style.display = 'block';
            }
            setTestStatus('Готово!');
            btnRun.disabled = false;
          } else if (sData.state === 'failed') {
            clearInterval(_taskPoller); _taskPoller = null;
            outputEl.textContent = JSON.stringify(sData, null, 2);
            setTestStatus('Ошибка: ' + (sData.error || 'failed'));
            btnRun.disabled = false;
          } else {
            setTestStatus(`Состояние: ${sData.state || 'pending'} (${attempts}s)`);
          }
        } catch (pollErr) {
          appendLog('poll error', pollErr.message);
        }
      }, 3000);

    } catch (err) {
      outputEl.textContent = 'Ошибка: ' + err.message;
      appendLog('error', err.message);
      setTestStatus('Ошибка: ' + err.message);
      btnRun.disabled = false;
    }
  });

  /* ── result image lightbox ─────────────────────────────────────── */
  resultImg?.addEventListener('click', () => {
    if (resultImg.src) openLightbox(resultImg.src);
  });

})();
