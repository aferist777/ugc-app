'use strict';

/* names.js - a folder or file name made from something a person typed: a project's name, a
   category's, a timeline's title.

   A folder is named after what it holds so the library can be browsed by eye (docs/local-app/PLAN.md,
   phase 2). What Windows refuses in a name is replaced - <>:"/\|?* and control characters - and so
   is what breaks an address on the pages: # and % end or escape a URL, and ' and ` close the CSS
   url('...') a page draws a thumbnail with. / and : become '-' (a time like 21:38 reads 21-38), the
   rest '_'. Spaces and dots at the ends go, because Windows drops them without saying so; a device
   name (CON, NUL, COM1...) gets a trailing '_'; and the name is cut to 60 characters, so a render's
   full path stays well inside what ffmpeg can open.

   No disk here: the caller says which names are taken. */

const MAX = 60;
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

// Text -> a name that is safe as one path segment.
function folderName(text, fallback = 'untitled') {
  let s = String(text == null ? '' : text).normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[/:]/g, '-')
    .replace(/[<>"\\|?*#%'`\u0000-\u001f\u007f]/g, '_')
    .trim();
  if (s.length > MAX) {
    // Cut at a word when one ends near the limit, and drop the separator left dangling.
    let cut = s.slice(0, MAX);
    const space = cut.lastIndexOf(' ');
    if (space > MAX - 16) cut = cut.slice(0, space);
    s = cut.replace(/[\s\-_,;—–]+$/, '');
  }
  s = s.replace(/^[\s.]+|[\s.]+$/g, '');
  if (!s) s = folderName(fallback, 'untitled');
  if (DEVICE.test(s)) s += '_';
  return s;
}

const _lower = (taken) => new Set([...(taken || [])].map((t) => String(t).toLowerCase()));

// `name`, or "name (2)", "name (3)"... - the first one no entry of `taken` already is, ignoring
// case the way Windows does.
function uniqueName(name, taken) {
  const have = _lower(taken);
  if (!have.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const cand = name.slice(0, MAX - suffix.length).replace(/[\s.]+$/, '') + suffix;
    if (!have.has(cand.toLowerCase())) return cand;
  }
}

// A file name no entry of `taken` already is: x.mp4, then x_2.mp4, x_3.mp4. For a file moved into
// a folder that already holds one of its name - the files of a deleted category going to nocat.
function uniqueFile(file, taken) {
  const have = _lower(taken);
  if (!have.has(file.toLowerCase())) return file;
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : '';
  for (let n = 2; ; n++) {
    const cand = `${stem}_${n}${ext}`;
    if (!have.has(cand.toLowerCase())) return cand;
  }
}

module.exports = { folderName, uniqueName, uniqueFile, MAX };
