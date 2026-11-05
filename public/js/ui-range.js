/* ═══════════════════════════════════════════════════════════════════════════
   THE SLIDER'S FILL (phase V73 block 2, the shared part `.u-range` of css/app-shell.css).

   The part draws its track filled up to the thumb from the custom property --p; a native range cannot say where its
   thumb is, so the page says it: on every move, and once when it is built. Where code sets a slider's value itself
   (the timeline's zoom), it calls fill() after.
     wire(input)   the part's class, the fill now and on every move; returns the input
     fill(input)   the fill for the value it holds now
   ═══════════════════════════════════════════════════════════════════════════ */

export function fill(input) {
  if (!input) return;
  const min = input.min === '' ? 0 : +input.min;
  const max = input.max === '' ? 100 : +input.max;
  const v = +input.value;
  const p = max > min ? ((v - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--p', Math.max(0, Math.min(100, p)).toFixed(2) + '%');
}

export function wire(input) {
  if (!input) return input;
  input.classList.add('u-range');
  fill(input);
  input.addEventListener('input', () => fill(input));
  input.addEventListener('change', () => fill(input));
  return input;
}
