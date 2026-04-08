/* ═══════════════════
   БИРОЛЫ TAB
   ═══════════════════ */

document.querySelectorAll('.biroly-slot').forEach(slot => {
  slot.addEventListener('click', () => slot.classList.toggle('selected'));
});
