// Scenarios v3 — "press twice to confirm" gesture, shared so every destructive
// button behaves and times out identically.
//
// First press arms the button and swaps its label; a second press within `ms`
// confirms. If nothing follows, it disarms itself. `skipConfirm` lets a caller
// bypass the whole dance when there is demonstrably nothing to lose.

const ARM_MS = 3000;

export function makeArmable(btn, { idleLabel, armedLabel, ms = ARM_MS, onConfirm, skipConfirm }) {
  if (!btn) return { disarm() {}, isArmed: () => false };

  const idle = idleLabel != null ? idleLabel : btn.textContent;
  let t = null;

  function disarm() {
    clearTimeout(t);
    t = null;
    btn.classList.remove('armed');
    btn.textContent = idle;
  }

  btn.addEventListener('click', () => {
    if (skipConfirm && skipConfirm()) { disarm(); onConfirm(); return; }
    if (btn.classList.contains('armed')) { disarm(); onConfirm(); return; }
    btn.classList.add('armed');
    btn.textContent = armedLabel;
    clearTimeout(t);
    t = setTimeout(disarm, ms);
  });

  return { disarm, isArmed: () => btn.classList.contains('armed') };
}
