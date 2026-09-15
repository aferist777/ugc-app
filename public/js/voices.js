/* voices.js — the ElevenLabs voice catalog: the list, the ready-gate, and the helpers
   that turn a stored voice reference into a <select>, a preview URL, or an orphan flag.

   Lifted verbatim out of scen-state.js, which was a file about scenario state and held
   this only by accident. scen-state.js belonged to the old Merge/Scenarios pages and is
   gone; the voice catalog outlived them because it is what Library plates and the
   Character voice UI read to tell a live voice from a dangling reference.

   Loaded by birols.html, the one page that needs it. Sole server dependency:
   GET /api/audio/custom-voices (routes/audio.js), whose catalog is data/custom-voices.json. */

// ── ElevenLabs voices ─────────────────────────────────────────────────────────
// Catalog source of truth = data/custom-voices.json (server-side). All voices
// are user-generated via ElevenLabs Voice Design — there's no hardcoded base
// list any more. Voices created via the Character Edit popup land in the
// catalog and are appended to window.ELEVENLABS_VOICES on the next reload.
window.ELEVENLABS_VOICES = [];
window._elVoicePreviews  = {};   // { voiceId: '/cache/voice-previews/<voiceId>.mp3' }

// ── Voices-ready gate ────────────────────────────────────────────────────────
// Boot-time race condition: loadObrazы / loadScenarioObrazы render plates
// synchronously, but isOrphanVoiceRef(obraz.voice) needs the catalog. If render
// happens before the catalog fetch resolves, every obraz with a valid voice
// looks orphan → red + click-opens-popup instead of click-selects, which kills
// the Создание flow (activeObrazIds stays empty).
//
// Fix: window.elVoicesReady is a Promise resolved by the FIRST successful
// loadCustomVoices(). loadObrazы / loadScenarioObrazы await it before their
// first render, so they always see a populated catalog. After the first
// resolve, the Promise stays resolved → subsequent awaits are zero-cost.
let _voicesReadyResolve = null;
window.elVoicesReady = new Promise(resolve => { _voicesReadyResolve = resolve; });

// Rebuild voice list from server. Called on boot and after Voice Design "Save".
// Fires 'el-voices-updated' so every registered <select> repopulates.
window.loadCustomVoices = async function() {
  try {
    const r = await fetch('/api/audio/custom-voices');
    const d = await r.json();
    if (d?.success && Array.isArray(d.voices)) {
      // Server catalog entries shape: { id, voiceId, name, gender, desc, ... }
      // Mark every entry custom:true so buildVoiceSelect uses voiceId as the
      // <option value> rather than the (potentially non-unique) name.
      window.ELEVENLABS_VOICES = d.voices.map(v => ({
        id:     v.voiceId,        // raw ElevenLabs voice_id — the lookup key
        name:   v.name,
        gender: v.gender === 'm' ? 'm' : 'f',
        desc:   v.desc || '',
        custom: true,
      }));
    } else {
      window.ELEVENLABS_VOICES = [];
    }
  } catch {
    window.ELEVENLABS_VOICES = [];
  }
  window.dispatchEvent(new CustomEvent('el-voices-updated'));
  // Resolve the gate exactly once — subsequent reloads after a Voice Design
  // save also call this function but the gate is already open.
  if (_voicesReadyResolve) { _voicesReadyResolve(); _voicesReadyResolve = null; }
};
// Kick off initial load. Callers awaiting window.elVoicesReady unblock when
// this resolves.
window.loadCustomVoices();

// Register a live <select> element so it gets rebuilt on loadCustomVoices().
// getSavedValue() should return the current "restore to" value (usually sel.value || defaultName).
window.registerVoiceSelect = function(sel, getSavedValue) {
  const handler = () => {
    if (!document.contains(sel)) { window.removeEventListener('el-voices-updated', handler); return; }
    window.buildVoiceSelect(sel, getSavedValue());
  };
  window.addEventListener('el-voices-updated', handler);
};

// ── Helper: get voice object by option value (name or id) ─────────────────────
// All voices are custom now; value = v.id (raw ElevenLabs voice_id). The name
// fallback survives so legacy obrazy entries storing voice="Chris" can still
// be matched if a custom voice happens to have the same display name.
window.findVoiceByValue = function(val) {
  return (window.ELEVENLABS_VOICES || []).find(v => v.id === val || v.name === val) || null;
};

// True if `savedValue` (an obraz.voice field) doesn't resolve to any voice in
// the current catalog — caller decides how to render the orphan state (red
// border in Library grid, disabled state in Scenarios row, etc.).
window.isOrphanVoiceRef = function(savedValue) {
  if (!savedValue) return true; // null/empty voice → also orphan (needs setup)
  return !window.findVoiceByValue(savedValue);
};

// ── Helper: get preview URL — local cached file first, fallback to null ──────
window.getVoicePreviewUrl = function(v) {
  if (!v || !v.id) return null;
  return (window._elVoicePreviews && window._elVoicePreviews[v.id]) || null;
};

// ── Helper: populate a <select> with optgroups (♀ Female / ♂ Male) ───────────
// All voices are custom-generated → value = v.id (raw ElevenLabs voice_id).
// The TTS backend resolves either name or id to the same voice_id (see
// _resolveVoiceId in routes/audio.js), so legacy obrazy entries that stored
// the name continue to match by name if any catalog entry has that name.
window.buildVoiceSelect = function(sel, savedValue) {
  sel.innerHTML = '';
  const all = window.ELEVENLABS_VOICES || [];
  if (!all.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '(no voices — generate via Edit popup)';
    o.disabled = true;
    o.selected = true;
    sel.appendChild(o);
    return;
  }
  const sections = [
    { label: '♀ Female', filter: v => v.gender === 'f' },
    { label: '♂ Male',   filter: v => v.gender === 'm' },
  ];
  sections.forEach(({ label, filter }) => {
    const voices = all.filter(filter);
    if (!voices.length) return;
    const group = document.createElement('optgroup');
    group.label = label;
    voices.forEach(v => {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.name + (v.desc ? ` — ${v.desc}` : '');
      if (v.name === savedValue || v.id === savedValue) o.selected = true;
      group.appendChild(o);
    });
    sel.appendChild(group);
  });
  if (!sel.value) sel.selectedIndex = 0;
};
