/* ════════════════════════════════════════════════════════════════════════════
   THE INTERFACE'S ICONS (phase V73 block 1, the owner 2026-11-04, (к18), (б1-4)).

   Lucide's line icons - lucide-static 1.60.0 (2026-10-20), ISC, some derived from Feather (MIT): the licence
   is public/icons/LICENSE-lucide.txt. Only the icons the app draws are here, each one's inner markup copied
   from the package's icons/<name>.svg as it is; nothing is installed (no package.json line, nothing in
   node_modules). A new icon is copied the same way from the same version (phase V73 block 5, part 5b: arrow-down, arrow-down-left,
   arrow-down-right, arrow-left, arrow-right-to-line, arrow-up-left, arrow-up-right, bold, italic, rotate-cw - from the same
   tarball, its SHA-256 feb647af...7d75 checked again).

   One size and one stroke everywhere: 16 px, stroke 1.5, the colour of the text it sits in (currentColor).
     icon('x')              the <svg> as a string
     iconEl('x', 18)        the <svg> as an element
   ════════════════════════════════════════════════════════════════════════════ */

const BODIES = {
  'arrow-down': '<path d="M12 5v14" /><path d="m19 12-7 7-7-7" />',
  'arrow-down-left': '<path d="M17 7 7 17" /><path d="M17 17H7V7" />',
  'arrow-down-right': '<path d="m7 7 10 10" /><path d="M17 7v10H7" />',
  'arrow-left': '<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />',
  'arrow-right': '<path d="M5 12h14" /><path d="m12 5 7 7-7 7" />',
  'arrow-right-to-line': '<path d="M17 12H3" /><path d="m11 18 6-6-6-6" /><path d="M21 5v14" />',
  'arrow-up': '<path d="m5 12 7-7 7 7" /><path d="M12 19V5" />',
  'arrow-up-left': '<path d="M7 17V7h10" /><path d="M17 17 7 7" />',
  'arrow-up-right': '<path d="M7 7h10v10" /><path d="M7 17 17 7" />',
  'bell': '<path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />',
  'bold': '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />',
  'camera': '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" /><circle cx="12" cy="13" r="3" />',
  'check': '<path d="M20 6 9 17l-5-5" />',
  'chevron-down': '<path d="m6 9 6 6 6-6" />',
  'chevron-left': '<path d="m15 18-6-6 6-6" />',
  'chevron-right': '<path d="m9 18 6-6-6-6" />',
  'chevron-up': '<path d="m18 15-6-6-6 6" />',
  'circle-alert': '<circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" />',
  'circle-check': '<circle cx="12" cy="12" r="10" /><path d="m16 9-5.5 5.5L8 12" />',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />',
  'crop': '<path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" />',
  'download': '<path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" />',
  'ellipsis': '<circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />',
  'fast-forward': '<path d="M12 6a2 2 0 0 1 3.414-1.414l6 6a2 2 0 0 1 0 2.828l-6 6A2 2 0 0 1 12 18z" /><path d="M2 6a2 2 0 0 1 3.414-1.414l6 6a2 2 0 0 1 0 2.828l-6 6A2 2 0 0 1 2 18z" />',
  'film': '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" /><path d="M3 16.5h4" /><path d="M17 3v18" /><path d="M17 7.5h4" /><path d="M17 16.5h4" />',
  'folder': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />',
  'folder-plus': '<path d="M12 10v6" /><path d="M9 13h6" /><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />',
  'grip-vertical': '<circle cx="9" cy="12" r="1" /><circle cx="9" cy="5" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="19" r="1" />',
  'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />',
  'italic': '<line x1="19" x2="10" y1="4" y2="4" /><line x1="14" x2="5" y1="20" y2="20" /><line x1="15" x2="9" y1="4" y2="20" />',
  'layers': '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" /><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" /><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
  'list': '<path d="M3 5h.01" /><path d="M3 12h.01" /><path d="M3 19h.01" /><path d="M8 5h13" /><path d="M8 12h13" /><path d="M8 19h13" />',
  'loader-circle': '<path d="M21 12a9 9 0 1 1-6.219-8.56" />',
  'maximize': '<path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />',
  'mic': '<path d="M12 19v3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><rect x="9" y="2" width="6" height="13" rx="3" />',
  'minus': '<path d="M5 12h14" />',
  'music': '<path d="M21 16V3a1 1 0 0 0-1.28-.96l-10 2.917a1 1 0 0 0-.72.96V19" /><circle cx="18" cy="16" r="3" /><circle cx="6" cy="19" r="3" />',
  'pause': '<rect x="14" y="3" width="5" height="18" rx="1" /><rect x="5" y="3" width="5" height="18" rx="1" />',
  'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />',
  'play': '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />',
  'plus': '<path d="M5 12h14" /><path d="M12 5v14" />',
  'redo-2': '<path d="m15 14 5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />',
  'rewind': '<path d="M12 6a2 2 0 0 0-3.414-1.414l-6 6a2 2 0 0 0 0 2.828l6 6A2 2 0 0 0 12 18z" /><path d="M22 6a2 2 0 0 0-3.414-1.414l-6 6a2 2 0 0 0 0 2.828l6 6A2 2 0 0 0 22 18z" />',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />',
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />',
  'scissors': '<circle cx="6" cy="6" r="3" /><path d="M8.12 8.12 12 12" /><path d="M20 4 8.12 15.88" /><circle cx="6" cy="18" r="3" /><path d="M14.8 14.8 20 20" />',
  'search': '<path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" />',
  'settings': '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" />',
  'skip-back': '<path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z" /><path d="M3 20V4" />',
  'square': '<rect width="18" height="18" x="3" y="3" rx="2" />',
  'star': '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />',
  'trash-2': '<path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
  'undo-2': '<path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />',
  'upload': '<path d="M12 3v12" /><path d="m17 8-5-5-5 5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />',
  'x': '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
};

export function icon(name, size = 16) {
  const b = BODIES[name];
  if (!b) throw new Error('no icon ' + name);
  return '<svg class="u-ico" xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24"'
    + ' fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + b + '</svg>';
}

export function iconEl(name, size = 16) {
  const t = document.createElement('template');
  t.innerHTML = icon(name, size);
  return t.content.firstChild;
}

// ── The one menu's icons (phase V73 block 2, (б2-16)) ──
// Only a row whose action is obvious gets one: ★ - star, Delete - trash-2, Rename - pencil, Cut… - scissors, Move to - folder,
// New folder - folder-plus. A menu with such a row gets the icon column (`.u-menu.has-icons`, css/app-shell.css) and its
// other rows keep their words in the second column; a menu with none has no empty column. A leading ★ in the words goes -
// the icon says it. Called once the rows are in, before the menu is measured.
const MENU_ICONS = [[/^★/, 'star'], [/^(un)?favou?rite\b/i, 'star'], [/^delete\b/i, 'trash-2'], [/^rename\b/i, 'pencil'],
  [/^cut…/i, 'scissors'], [/^move to\b/i, 'folder'], [/^new folder\b/i, 'folder-plus']];

export function menuIcons(menu) {
  if (!menu) return menu;
  let any = false;
  for (const row of menu.querySelectorAll('.u-mi')) {
    const words = row.querySelector(':scope > span');
    if (!words || row.querySelector(':scope > .u-ico')) continue;
    const text = words.textContent.trim();
    const hit = MENU_ICONS.find(([re]) => re.test(text));
    if (!hit) continue;
    if (text.startsWith('★')) words.textContent = text.replace(/^★\s*/, '');
    row.insertBefore(iconEl(hit[1]), row.firstChild);
    any = true;
  }
  menu.classList.toggle('has-icons', any);
  return menu;
}
