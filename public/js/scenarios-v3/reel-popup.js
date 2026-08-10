// Scenarios v3 — the finished reel, played as one video and cut here.
//
// Nothing is stitched. A real concat belongs to Merge, costs ffmpeg time and would have to
// be redone after every re-render; for judging the cut all that is needed is the chosen
// takes played back to back in fragment order.
//
// Two <video> elements take turns: one plays while the next clip loads into the other, and
// they swap on `ended`. With a single element every transition would stall for as long as
// the next file takes to open — exactly where a cut is judged.
//
// This is also where the cut is DECIDED: each fragment lists how many takes it has and
// pages through them, and choosing here is the same choice the cards show.

const $ = (sel, root) => (root || document).querySelector(sel);

let _ov = null;
let _st = null;      // { items, at, front, playing }

function _fmt(s) {
  const t = Math.max(0, Math.round(s || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// items: [{ n, variants: [clip…], at }] — one per fragment that has a take.
export function openReelPopup({ items, onPick, onSave } = {}) {
  closeReelPopup();
  const list = (items || []).filter(it => it && (it.variants || []).length);
  if (!list.length) return;

  const ov = document.createElement('div');
  ov.className = 'sv3-pop-ov sv3-reel-ov';
  ov.innerHTML = `
    <div class="sv3-pop sv3-reel">
      <div class="sv3-pop-head">
        <b>Reel preview</b>
        <span class="sv3-reel-meta"></span>
        <span class="sp"></span>
        <button class="sv3-btn sm" data-x="close" type="button">&#10005;</button>
      </div>
      <div class="sv3-reel-body">
        <div class="sv3-reel-left">
          <div class="sv3-reel-stage">
            <video class="sv3-reel-v is-front" playsinline></video>
            <video class="sv3-reel-v" playsinline></video>
          </div>
          <div class="sv3-reel-timeline"></div>
        </div>
        <div class="sv3-reel-side"><div class="sv3-reel-strip"></div></div>
      </div>
      <div class="sv3-pop-foot">
        <button class="sv3-btn" data-x="play" type="button">Play</button>
        <span class="sv3-reel-time"></span>
        <span class="sp"></span>
        <span class="sv3-status" id="sv3-reel-status"></span>
        <button class="sv3-btn primary" data-x="save" type="button">Save</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  _ov = ov;
  _st = { items: list, at: 0, front: 0, playing: false };

  const vids  = [...ov.querySelectorAll('.sv3-reel-v')];
  const strip = $('.sv3-reel-strip', ov);
  const tl    = $('.sv3-reel-timeline', ov);
  const meta  = $('.sv3-reel-meta', ov);
  const time  = $('.sv3-reel-time', ov);
  const playB = $('[data-x="play"]', ov);
  const saveB = $('[data-x="save"]', ov);
  const status = $('#sv3-reel-status', ov);

  const chosen = (it) => it.variants[Math.min(it.at, it.variants.length - 1)];
  const total  = () => list.reduce((a, it) => a + (chosen(it).dur || 0), 0);
  // where each fragment starts in the whole reel, so the clock is of the REEL and not of
  // whichever file happens to be playing
  const startOf = (k) => list.slice(0, k).reduce((a, it) => a + (chosen(it).dur || 0), 0);

  const front = () => vids[_st.front];
  const back  = () => vids[1 - _st.front];

  // ── the strip: one row per fragment, with its takes ──
  function paintStrip() {
    strip.textContent = '';
    list.forEach((it, k) => {
      const c = chosen(it);
      const row = document.createElement('div');
      row.className = 'sv3-reel-row' + (k === _st.at ? ' on' : '');
      row.innerHTML = `
        <button class="sv3-reel-shot" type="button" title="Play from this fragment">
          ${c.thumb ? `<img src="${c.thumb}" alt="">` : ''}
          <span class="sv3-reel-rn">${it.n}</span>
        </button>
        <div class="sv3-reel-info">
          <div class="sv3-reel-dur">${(c.dur || 0).toFixed(1)}s</div>
          <div class="sv3-reel-takes">
            <button class="sv3-reel-arrow" data-d="-1" type="button" title="Previous take">&#8249;</button>
            <span class="sv3-reel-count" title="takes of this fragment">${it.at + 1}/${it.variants.length}</span>
            <button class="sv3-reel-arrow" data-d="1" type="button" title="Next take">&#8250;</button>
          </div>
        </div>`;
      $('.sv3-reel-shot', row).addEventListener('click', () => go(k, _st.playing));
      row.querySelectorAll('.sv3-reel-arrow').forEach(b => {
        b.disabled = it.variants.length < 2;
        b.addEventListener('click', (e) => { e.stopPropagation(); step(k, +b.dataset.d); });
      });
      strip.appendChild(row);
    });
  }

  // ── the timeline: every fragment to scale, with the playhead inside the current one ──
  function paintTimeline() {
    tl.textContent = '';
    const sum = total() || 1;
    list.forEach((it, k) => {
      const c = chosen(it);
      const seg = document.createElement('button');
      seg.type = 'button';
      seg.className = 'sv3-reel-seg' + (k === _st.at ? ' on' : '');
      seg.style.flex = `${Math.max(0.4, c.dur || 0.4)} 1 0`;
      seg.title = `fragment ${it.n} · ${(c.dur || 0).toFixed(1)}s · take ${it.at + 1} of ${it.variants.length}`;
      seg.innerHTML = `<span class="sv3-reel-segn">${it.n}</span><i class="sv3-reel-head"></i>`;
      seg.addEventListener('click', () => go(k, _st.playing));
      tl.appendChild(seg);
    });
    void sum;
  }

  function paintHead() {
    const v = front();
    const cur = tl.children[_st.at];
    [...tl.children].forEach((seg, k) => {
      const h = seg.querySelector('.sv3-reel-head');
      if (h) h.style.width = k < _st.at ? '100%' : '0%';
    });
    if (cur && v) {
      const c = chosen(list[_st.at]);
      const share = (c.dur ? Math.min(1, (v.currentTime || 0) / c.dur) : 0) * 100;
      const h = cur.querySelector('.sv3-reel-head');
      if (h) h.style.width = share.toFixed(1) + '%';
    }
  }

  function paintTime() {
    const v = front();
    const done = startOf(_st.at) + (v && isFinite(v.currentTime) ? v.currentTime : 0);
    time.textContent = `${_fmt(done)} / ${_fmt(total())}`;
    meta.textContent = `${list.length} fragment${list.length === 1 ? '' : 's'} · ${_fmt(total())}`;
    paintHead();
  }

  const preload = () => {
    const nxt = list[_st.at + 1];
    const b = back();
    if (!nxt) { b.removeAttribute('src'); return; }
    const p = chosen(nxt).path;
    if (b.getAttribute('src') !== p) { b.src = p; b.load(); }
  };

  function go(k, play) {
    if (k < 0 || k >= list.length) return;
    _st.at = k;
    const v = front();
    const p = chosen(list[k]).path;
    if (v.getAttribute('src') !== p) v.src = p;
    v.currentTime = 0;
    vids.forEach((x, j) => x.classList.toggle('is-front', j === _st.front));
    paintStrip(); paintTimeline(); paintTime(); preload();
    if (play) v.play().catch(() => {});
    _st.playing = !!play;
    playB.textContent = _st.playing ? 'Pause' : 'Play';
  }

  // Change which take a fragment contributes. The page is told at once, so the cards and
  // the counters agree with what plays here — and Save reads the project, not this list.
  function step(k, d) {
    const it = list[k];
    if (!it || it.variants.length < 2) return;
    it.at = (it.at + d + it.variants.length) % it.variants.length;
    if (onPick) { try { onPick(it.n - 1, it.variants[it.at].id); } catch (e) { console.error('[sv3] reel pick', e); } }
    // reload the stage if the fragment on screen is the one that changed
    if (k === _st.at) go(k, _st.playing); else { paintStrip(); paintTimeline(); paintTime(); preload(); }
    status.textContent = `fragment ${it.n}: take ${it.at + 1} of ${it.variants.length}`;
    status.className = 'sv3-status';
  }

  function advance() {
    if (_st.at + 1 >= list.length) {
      _st.playing = false;
      playB.textContent = 'Play';
      paintTime();
      return;
    }
    _st.front = 1 - _st.front;      // the preloaded element takes over
    _st.at += 1;
    const v = front();
    vids.forEach((x, j) => x.classList.toggle('is-front', j === _st.front));
    v.currentTime = 0;
    v.play().catch(() => {});
    paintStrip(); paintTimeline(); paintTime(); preload();
  }

  vids.forEach(v => {
    v.addEventListener('timeupdate', () => { if (v === front()) paintTime(); });
    v.addEventListener('ended', () => { if (v === front()) advance(); });
    v.addEventListener('error', () => {
      if (v !== front()) return;
      status.textContent = `fragment ${list[_st.at].n} could not be played`;
      status.className = 'sv3-status err';
    });
  });

  playB.addEventListener('click', () => {
    const v = front();
    if (_st.playing) { v.pause(); _st.playing = false; playB.textContent = 'Play'; return; }
    v.play().then(() => { _st.playing = true; playB.textContent = 'Pause'; }).catch(() => {});
  });

  saveB.addEventListener('click', async () => {
    if (!onSave) return;
    saveB.disabled = true;
    status.textContent = 'Saving…';
    status.className = 'sv3-status';
    try {
      status.textContent = (await onSave()) || 'Saved';
      status.className = 'sv3-status ok';
    } catch (e) {
      status.textContent = 'Save failed: ' + e.message;
      status.className = 'sv3-status err';
    } finally {
      saveB.disabled = false;
    }
  });

  $('[data-x="close"]', ov).addEventListener('click', closeReelPopup);
  ov.addEventListener('click', (e) => { if (e.target === ov) closeReelPopup(); });
  document.addEventListener('keydown', _onKey);

  go(0, false);
}

function _onKey(e) { if (e.key === 'Escape') closeReelPopup(); }

export function closeReelPopup() {
  if (!_ov) return;
  _ov.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) {} v.removeAttribute('src'); });
  _ov.remove();
  _ov = null;
  _st = null;
  document.removeEventListener('keydown', _onKey);
}
