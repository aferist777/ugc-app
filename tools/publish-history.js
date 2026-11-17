'use strict';
/* publish-history.js - the history of the working branch, made fit to publish, in a repository of its own.

       node tools/publish-history.js [--rules <file>] [--out <folder>]

   The rules - kept OUTSIDE the project, by default ~/.ugc-release/history-rules.json, because they name what must not
   be published - say:
     branch       the branch whose history is taken (its commit at the start of the run);
     author       { name, email } every commit is written with (the dates stay as they are);
     dropPaths    paths no version of the history keeps - a folder ends with "/", anything else is a file or a prefix;
     tipOnly      paths whose every version is the LAST one (pictures re-made under stricter rules): an earlier version is
                  never written, the last one stands in its place - and a path the last tree no longer has is dropped;
     replace      [{ s: literal | re: pattern, f: flags, r: replacement }], in order, applied to every version of every text
                  file and to every commit message.
   What it does, touching nothing of this repository: a bare clone of the branch into <out>/src.git; `git fast-export` of
   it read and rewritten as it streams - the blobs only dropped paths use are never written, the text of the others and
   every message rewritten, the authors set, file changes on dropped paths left out, and a commit left with no change at
   all left out too (its children take its parent) - into `git fast-import` of a new bare repository, <out>/public.git,
   branch main. The same rules over the same history give the same commits, so a later run differs only by what was
   committed since.
   Then it checks the result and says so in <out>/report.txt:
     - the last tree is the branch's last tree without the dropped paths, file for file;
     - no version of any file and no message holds anything a rule looks for (text and binary alike);
     - no version of any file holds a key of this computer's libraries or the shape of one (tools/key-scan.js);
     - the pictures the history keeps, by path, for a look.
   <out>/commits.txt pairs every commit of the branch with the public commit it became ("<branch's> <public>"; a
   left-out commit with the one its children took) - where tools/release.js upload puts a release's tag.
   Nothing is sent anywhere: publishing <out>/public.git is a separate step. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const KEYS = require('./key-scan.js');

const REPO = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const RULES_FILE = path.resolve(arg('--rules', path.join(os.homedir(), '.ugc-release', 'history-rules.json')));
const OUT = path.resolve(arg('--out', path.join(os.tmpdir(), 'ugc-public')));
const say = (s) => console.log('[history] ' + s);

function git(args, opts = {}) {
  const r = spawnSync('git', args, Object.assign({ encoding: 'utf8', maxBuffer: 1 << 30, windowsHide: true }, opts));
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + String(r.stderr || '').trim());
  return r.stdout;
}

// ── The rules ───────────────────────────────────────────────────────────────
function readRules() {
  let j;
  try { j = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')); } catch (e) { throw new Error('the rules are needed - ' + RULES_FILE + ' (or --rules <file>)'); }
  if (!j.branch || !j.author || !j.author.email || !Array.isArray(j.dropPaths) || !Array.isArray(j.replace)) throw new Error('the rules lack branch, author, dropPaths or replace');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const replace = j.replace.map((x) => ({
    find: x.s != null ? new RegExp(esc(x.s), 'g') : new RegExp(x.re, (x.f || 'g').includes('g') ? (x.f || 'g') : (x.f || '') + 'g'),
    to: x.s != null ? x.r.replace(/\$/g, '$$$$') : x.r,
  }));
  // What the checks look for: every rule's own pattern, as it is matched.
  const check = replace.map((x) => new RegExp(x.find.source, x.find.flags.replace('g', '')));
  const under = (list) => (p) => (list || []).some((d) => (d.endsWith('/') ? p.startsWith(d) : p === d || p.startsWith(d)));
  return { branch: j.branch, author: j.author, replace, check, dropped: under(j.dropPaths), tipOnly: under(j.tipOnly) };
}

const isText = (buf) => buf.length < 64 * 1024 * 1024 && !buf.subarray(0, 8000).includes(0);
function rewrite(text, rules) {
  let t = text;
  for (const { find, to } of rules.replace) { find.lastIndex = 0; t = t.replace(find, to); }
  return t;
}

// A path as fast-export writes it: as it is, or C-quoted when it has to be.
function unquote(p) {
  if (!p.startsWith('"')) return p;
  const bytes = [];
  for (let i = 1; i < p.length - 1; i++) {
    const c = p[i];
    if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
    const n = p[++i];
    if (/[0-7]/.test(n)) { bytes.push(parseInt(p.substr(i, 3), 8)); i += 2; } else bytes.push({ n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 }[n] || n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

// ── The last versions of the tipOnly paths: path -> { oid, mode } ──────────
function tipVersions(src, ref, rules) {
  const out = new Map();
  for (const e of git(['-C', src, 'ls-tree', '-r', '-z', ref]).split('\0').filter(Boolean)) {
    const [meta, p] = e.split('\t');
    const [mode, , oid] = meta.split(' ');
    if (rules.tipOnly(p) && !rules.dropped(p)) out.set(p, { oid, mode });
  }
  return out;
}

// ── The blobs some kept path uses ───────────────────────────────────────────
function keptBlobs(src, ref, rules, tip) {
  const out = new Set();
  const raw = git(['-C', src, 'log', '--raw', '--no-abbrev', '--no-renames', '-m', '--root', '-z', '--format=%H', ref]);
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const m = /(?:^|\n):(\d+) (\d+) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])\d*$/.exec(parts[i]);
    if (!m) continue;
    const p = parts[++i];
    if (m[5] === 'D' || rules.dropped(p)) continue;
    if (rules.tipOnly(p)) { const t = tip.get(p); if (t && t.oid === m[4]) out.add(m[4]); continue; }
    out.add(m[4]);
  }
  return out;
}

// ── The stream ──────────────────────────────────────────────────────────────
class Reader {
  constructor(stream) { this.chunks = []; this.len = 0; this.ended = false; this.wait = null;
    stream.on('data', (c) => { this.chunks.push(c); this.len += c.length; if (this.wait) { const w = this.wait; this.wait = null; w(); } });
    stream.on('end', () => { this.ended = true; if (this.wait) { const w = this.wait; this.wait = null; w(); } }); }
  async _more() { if (this.ended) return false; await new Promise((r) => { this.wait = r; }); return true; }
  _flat() { if (this.chunks.length > 1) { this.chunks = [Buffer.concat(this.chunks)]; } return this.chunks[0] || Buffer.alloc(0); }
  async line() {
    for (;;) {
      const b = this._flat();
      const i = b.indexOf(10);
      if (i >= 0) { this.chunks = [b.subarray(i + 1)]; this.len -= i + 1; return b.subarray(0, i).toString('utf8'); }
      if (!(await this._more())) { if (!this.len) return null; const s = b.toString('utf8'); this.chunks = []; this.len = 0; return s; }
    }
  }
  async bytes(n) {
    while (this.len < n) { if (!(await this._more())) throw new Error('the stream ended inside a data block'); }
    const b = this._flat();
    this.chunks = [b.subarray(n)]; this.len -= n;
    return Buffer.from(b.subarray(0, n));
  }
  async peek() { while (!this.len) { if (!(await this._more())) return null; } return this._flat()[0]; }
}

async function run() {
  const rules = readRules();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const src = path.join(OUT, 'src.git');
  const dst = path.join(OUT, 'public.git');
  git(['clone', '-q', '--bare', '--single-branch', '--branch', rules.branch, REPO, src]);
  const ref = 'refs/heads/' + rules.branch;
  const head = git(['-C', src, 'rev-parse', ref]).trim();
  say('taken: ' + rules.branch + ' at ' + head.slice(0, 12) + ', ' + git(['-C', src, 'rev-list', '--count', ref]).trim() + ' commits');
  const tip = tipVersions(src, ref, rules);
  const kept = keptBlobs(src, ref, rules, tip);
  const markOf = new Map();             // a written blob's original oid -> its mark
  const tipData = (oid) => spawnSync('git', ['-C', src, 'cat-file', 'blob', oid], { maxBuffer: 1 << 30, windowsHide: true }).stdout;
  git(['init', '-q', '--bare', '--initial-branch=main', dst]);

  const exp = spawn('git', ['-C', src, 'fast-export', '--reencode=yes', '--show-original-ids', '--signed-tags=strip', '--tag-of-filtered-object=drop', ref], { windowsHide: true });
  const marksFile = path.join(OUT, 'marks.txt');
  const imp = spawn('git', ['-C', dst, 'fast-import', '--quiet', '--done', '--export-marks=' + marksFile], { windowsHide: true, stdio: ['pipe', 'inherit', 'pipe'] });
  let impErr = '';
  let expErr = '';
  imp.stderr.on('data', (d) => { impErr += d; });
  exp.stderr.on('data', (d) => { expErr += d; });
  // Either side stopping early stops the run with its words - a write would otherwise wait for a drain that never comes.
  let stopped = null;
  const failed = new Promise((res) => { stopped = res; });
  // The ends are listened for from the start: fast-export is long gone when the last commit has been read.
  const expClosed = new Promise((res) => exp.on('close', res));
  const impClosed = new Promise((res) => imp.on('close', res));
  imp.on('close', (c) => { if (c) stopped(new Error('fast-import stopped with ' + c + ': ' + impErr.trim().slice(-2000))); });
  exp.on('close', (c) => { if (c) stopped(new Error('fast-export stopped with ' + c + ': ' + expErr.trim().slice(-2000))); });
  const write = (b) => Promise.race([
    new Promise((res) => { if (imp.stdin.write(b)) res(); else imp.stdin.once('drain', res); }),
    failed.then((e) => { throw e; }),
  ]);
  const rd = new Reader(exp.stdout);
  const droppedBlob = new Set();
  const alias = new Map();              // a left-out commit's mark -> the mark its children take instead ('' = none)
  const resolve = (m) => { while (alias.has(m)) m = alias.get(m); return m; };
  const commitMarks = new Map();        // a commit's original oid -> its mark
  const stat = { blobs: 0, blobsLeft: 0, textChanged: 0, commits: 0, commitsLeft: 0, msgChanged: 0, opsLeft: 0, pinned: 0 };
  let tipMark = '';
  const sign = (l) => l.replace(/^(author|committer) .*? <[^>]*> /, (m0, who) => who + ' ' + rules.author.name + ' <' + rules.author.email + '> ');

  for (;;) {
    const l = await rd.line();
    if (l === null) break;
    if (l === '' || l.startsWith('feature ') || l.startsWith('progress ')) continue;
    if (l === 'done') break;
    if (l === 'blob') {
      const mark = (await rd.line()).slice(5);
      let ln = await rd.line();
      let oid = '';
      if (ln.startsWith('original-oid ')) { oid = ln.slice(13); ln = await rd.line(); }
      const data = await rd.bytes(Number(ln.slice(5)));
      stat.blobs++;
      if (!kept.has(oid)) { droppedBlob.add(mark); stat.blobsLeft++; continue; }
      markOf.set(oid, mark);
      let out = data;
      if (isText(data)) {
        const t = data.toString('utf8');
        const r = rewrite(t, rules);
        if (r !== t) { out = Buffer.from(r, 'utf8'); stat.textChanged++; }
      }
      await write(Buffer.concat([Buffer.from('blob\nmark ' + mark + '\ndata ' + out.length + '\n'), out, Buffer.from('\n')]));
      continue;
    }
    if (l.startsWith('reset ')) {
      // A reset is followed, at most, by its `from`; the branch is written as main.
      if ((await rd.peek()) === 0x66) { const f = await rd.line(); const m = resolve(f.slice(5)); if (m) await write('reset refs/heads/main\nfrom ' + m + '\n\n'); }
      continue;
    }
    if (l.startsWith('commit ')) {
      stat.commits++;
      const hdr = [];
      let mark = '';
      let oid = '';
      let ln;
      for (;;) {
        ln = await rd.line();
        if (ln.startsWith('mark ')) mark = ln.slice(5);
        else if (ln.startsWith('original-oid ')) oid = ln.slice(13);
        else if (ln.startsWith('encoding ')) { /* --reencode=yes: none come */ } else if (ln.startsWith('author ') || ln.startsWith('committer ')) hdr.push(sign(ln));
        else if (ln.startsWith('data ')) break;
        else throw new Error('unexpected in a commit: ' + ln);
      }
      const msg0 = (await rd.bytes(Number(ln.slice(5)))).toString('utf8');
      const msg = rewrite(msg0, rules);
      if (msg !== msg0) stat.msgChanged++;
      const parents = [];
      const ops = [];
      for (;;) {
        const nb = await rd.peek();
        if (nb === null) break;
        const op = await rd.line();
        if (op === '') { if (ops.length || parents.length) break; continue; }
        if (op.startsWith('from ') || op.startsWith('merge ')) { parents.push(op.slice(op.indexOf(' ') + 1)); continue; }
        if (op === 'deleteall') { ops.push(op); continue; }
        const m = /^(M) (\d+) (\S+) (.*)$/.exec(op) || /^(D) ()()(.*)$/.exec(op);
        if (!m) throw new Error('unexpected file change: ' + op);
        const p = unquote(m[4]);
        if (rules.dropped(p)) { stat.opsLeft++; continue; }
        if (m[1] === 'M' && rules.tipOnly(p)) {
          // An earlier version of a tipOnly path: the last version in its place - by its mark once written, else inline.
          const t = tip.get(p);
          if (!t) { stat.opsLeft++; continue; }
          if (!droppedBlob.has(m[3])) { ops.push(op); continue; }
          stat.pinned++;
          if (markOf.has(t.oid)) { ops.push('M ' + t.mode + ' ' + markOf.get(t.oid) + ' ' + m[4]); continue; }
          const d = tipData(t.oid);
          ops.push(Buffer.concat([Buffer.from('M ' + t.mode + ' inline ' + m[4] + '\ndata ' + d.length + '\n'), d]));
          continue;
        }
        if (m[1] === 'M' && droppedBlob.has(m[3])) throw new Error('a kept path names a dropped blob: ' + p);
        ops.push(op);
      }
      const ps = [];
      for (const p of parents) { const r = resolve(p); if (r && !ps.includes(r)) ps.push(r); }
      if (parents.length && !resolve(parents[0]) && ps.length) throw new Error('a commit lost its first parent but keeps another: ' + mark);
      if (oid === head) tipMark = mark;
      if (oid) commitMarks.set(oid, mark);
      if (!ops.length && ps.length <= 1) { alias.set(mark, ps[0] || ''); stat.commitsLeft++; continue; }
      const body = Buffer.from(msg, 'utf8');
      await write(Buffer.concat([
        Buffer.from('commit refs/heads/main\nmark ' + mark + '\n' + hdr.join('\n') + '\ndata ' + body.length + '\n'), body,
        Buffer.from('\n' + ps.map((p, i) => (i ? 'merge ' : 'from ') + p + '\n').join('')),
        ...ops.map((o) => Buffer.concat([Buffer.isBuffer(o) ? o : Buffer.from(o), Buffer.from('\n')])),
        Buffer.from('\n'),
      ]));
      continue;
    }
    if (l.startsWith('tag ')) throw new Error('a tag in the stream - not expected');
    throw new Error('unexpected in the stream: ' + l);
  }
  // The branch ends where its last commit ends - or, when that one was left out, where its parent does.
  if (!tipMark || !resolve(tipMark)) throw new Error('the last commit was not found in the stream');
  await write('reset refs/heads/main\nfrom ' + resolve(tipMark) + '\n\n');
  await write('done\n');
  imp.stdin.end();
  const [ec, ic] = await Promise.all([expClosed, impClosed]);
  if (ec !== 0) throw new Error('fast-export stopped with ' + ec);
  if (ic !== 0) throw new Error('fast-import stopped with ' + ic + ': ' + impErr.trim());
  // Each commit of the branch and the public one it became.
  const shaOf = new Map(fs.readFileSync(marksFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')));
  const pairs = [];
  for (const [oid, mark] of commitMarks) { const m = resolve(mark); if (m && shaOf.has(m)) pairs.push(oid + ' ' + shaOf.get(m)); }
  fs.writeFileSync(path.join(OUT, 'commits.txt'), pairs.join('\n') + '\n');
  fs.rmSync(marksFile, { force: true });
  say('written: ' + (stat.commits - stat.commitsLeft) + ' commits of ' + stat.commits + ' (' + stat.commitsLeft + ' had nothing left), '
    + (stat.blobs - stat.blobsLeft) + ' file versions (' + stat.blobsLeft + ' only in dropped paths), ' + stat.textChanged + ' rewritten, '
    + stat.msgChanged + ' messages rewritten, ' + stat.pinned + ' earlier versions of tipOnly paths given their last one');
  return { rules, src, dst, ref, head, stat };
}

// ── The checks ──────────────────────────────────────────────────────────────
function checks({ rules, src, dst, ref, head, stat }) {
  const lines = [];
  const add = (s) => { lines.push(s); say(s); };
  add('the branch: ' + head + '; the result: ' + git(['-C', dst, 'rev-parse', 'main']).trim());
  // 1. The last tree.
  const tree = (repo, r) => git(['-C', repo, 'ls-tree', '-r', '-z', r]).split('\0').filter(Boolean);
  const want = tree(src, ref).filter((e) => !rules.dropped(e.slice(e.indexOf('\t') + 1)));
  const got = tree(dst, 'main');
  const same = want.length === got.length && want.every((e, i) => e === got[i]);
  add('the last tree: ' + (same ? 'the same as the branch without the dropped paths, ' + got.length + ' files' : 'DIFFERENT - ' + want.length + ' wanted, ' + got.length + ' written'));
  if (!same) {
    const g = new Set(got);
    for (const e of want.filter((x) => !g.has(x)).slice(0, 20)) add('  wanted: ' + e.replace(/\t/, ' '));
  }
  // 2. Every version of every file, and every message.
  const objs = git(['-C', dst, 'rev-list', '--objects', 'main']).split('\n').filter(Boolean).map((l) => { const i = l.indexOf(' '); return i < 0 ? { oid: l, p: '' } : { oid: l.slice(0, i), p: l.slice(i + 1) }; });
  const types = git(['-C', dst, 'cat-file', '--batch-check=%(objectname) %(objecttype)', '--batch-all-objects']).split('\n').reduce((m, l) => { const [o, t] = l.split(' '); if (o) m.set(o, t); return m; }, new Map());
  const blobs = objs.filter((o) => types.get(o.oid) === 'blob');
  const targets = KEYS.targets().filter((t) => t.kind !== 'path');
  const hits = [];
  const keyHits = [];
  const pictures = new Set();
  const batch = spawnSync('git', ['-C', dst, 'cat-file', '--batch'], { input: blobs.map((b) => b.oid).join('\n') + '\n', maxBuffer: 2 ** 31, windowsHide: true });
  const buf = batch.stdout;
  let at = 0;
  for (const b of blobs) {
    const nl = buf.indexOf(10, at);
    const size = Number(buf.subarray(at, nl).toString('latin1').split(' ')[2]);
    const data = buf.subarray(nl + 1, nl + 1 + size);
    at = nl + 1 + size + 1;
    if (/\.(png|jpe?g|webp|gif)$/i.test(b.p)) pictures.add(b.p);
    const s = isText(data) ? data.toString('utf8') : data.toString('latin1');
    rules.check.forEach((re, i) => { if (re.test(s)) hits.push('rule ' + i + ' in ' + b.p + ' (' + b.oid.slice(0, 10) + ')'); });
    for (const t of targets) if (s.includes(t.value)) keyHits.push(t.what + ' in ' + b.p);
    if (isText(data) && KEYS.SHAPES && KEYS.SHAPES.test(s)) keyHits.push('a key\'s shape in ' + b.p);
  }
  const msgs = git(['-C', dst, 'log', '--format=%H%x00%B%x00%an <%ae>%x00%cn <%ce>%x01', 'main']).split('\x01').filter((x) => x.trim());
  for (const m of msgs) {
    const [h, body, a, c] = m.replace(/^\n/, '').split('\0');
    rules.check.forEach((re, i) => { if (re.test(body)) hits.push('rule ' + i + ' in the message of ' + h.slice(0, 10)); });
    if (a !== rules.author.name + ' <' + rules.author.email + '>' || c !== a) hits.push('another author or committer in ' + h.slice(0, 10) + ': ' + a + ' / ' + c);
  }
  add('every version (' + blobs.length + ' files) and every message (' + msgs.length + '): ' + (hits.length ? hits.length + ' MATCHES' : 'nothing any rule looks for'));
  for (const h of hits.slice(0, 40)) add('  ' + h);
  add('keys of this computer\'s libraries and their shapes: ' + (keyHits.length ? keyHits.length + ' FOUND' : 'none'));
  for (const h of keyHits.slice(0, 20)) add('  ' + h);
  add('commits: ' + (stat.commits - stat.commitsLeft) + ' of ' + stat.commits + '; size: ' + git(['-C', dst, 'count-objects', '-vH']).split('\n').filter((l) => /^size/.test(l)).join(', '));
  add('pictures the history keeps (' + pictures.size + ' paths) - listed in pictures.txt');
  fs.writeFileSync(path.join(OUT, 'pictures.txt'), [...pictures].sort().join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'report.txt'), lines.join('\n') + '\n');
  return !(hits.length || keyHits.length || !same);
}

if (require.main === module) {
  run().then((r) => { process.exitCode = checks(r) ? 0 : 1; say('the report: ' + path.join(OUT, 'report.txt')); })
    .catch((e) => { console.error('[history] ' + (e && e.message || e)); process.exitCode = 1; });
}
