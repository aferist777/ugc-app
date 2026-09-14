'use strict';

/* The desktop shell's log: everything the server prints and every decision the shell makes, in
   one file in the library - logs/app.log - so a start that fails leaves something to read. Run
   from source, the same lines go to the terminal too.

   One generation is kept: a log past 5 MB becomes app.old.log at the next start. The last lines
   are also held in memory, for the dialog that says why the app could not start. */

const fs = require('fs');
const path = require('path');

const LIMIT = 5 * 1024 * 1024;
const KEEP_LINES = 40;

function openLog(dir, { echo }) {
  const file = path.join(dir, 'app.log');
  try { if (fs.statSync(file).size > LIMIT) fs.renameSync(file, path.join(dir, 'app.old.log')); }
  catch { /* no log yet */ }

  const out = fs.createWriteStream(file, { flags: 'a' });
  // A log that cannot be written is not a reason to stop the app.
  out.on('error', () => {});
  const recent = [];

  const write = (chunk) => {
    out.write(chunk);
    if (echo) process.stdout.write(chunk);
    recent.push(...String(chunk).split(/\r?\n/).filter(Boolean));
    if (recent.length > KEEP_LINES) recent.splice(0, recent.length - KEEP_LINES);
  };

  return {
    file,
    write,
    line: (msg) => write(`[desktop] ${new Date().toISOString()} ${msg}\n`),
    tail: (n) => recent.slice(-n),
  };
}

module.exports = { openLog };
