// LIBRARY — slow work on the server, and the countdown row that follows it.
//
// Shared by the scenario generator (js/library/make.js) and the narrators window
// (js/library/narrators.js): transcribing a source, finding its topics, writing hooks and a script,
// reading a narrator's voice. Each is a job on the server that the page polls; nothing is held open.
// The rows teach themselves how long a kind of job takes (js/progress.js keeps a running average
// per key) - and the keys are the ones Library 2 used, so what it learned carries over.

import { startInlineProgress } from '../progress.js';

export async function api(url, opts) {
  const r = await fetch(url, opts);
  let d = null;
  try { d = await r.json(); } catch (e) { /* a non-JSON body is handled below */ }
  if (!r.ok || !d || d.success === false) {
    const err = new Error((d && d.error) || `${r.status} ${r.statusText}`);
    err.status = r.status;
    err.data = d;
    throw err;
  }
  return d;
}

// Every 1.5 s until the job is done or has failed. `stop()` returning true abandons the wait
// (the job runs on at the server) - a window closed, a layout left for good.
export async function pollJob(base, jobId, onStep, stop) {
  for (;;) {
    await new Promise(r => setTimeout(r, 1500));
    if (typeof stop === 'function' && stop()) throw Object.assign(new Error('stopped waiting'), { stopped: true });
    let job;
    try { job = await api(`${base}/${encodeURIComponent(jobId)}`); }
    catch (e) { throw new Error('lost track of the job: ' + e.message); }
    if (onStep) onStep(job);
    if (job.state === 'done') return job;
    if (job.state === 'error') throw new Error(job.error || 'the job failed');
    if (job.state === 'cancelled') throw Object.assign(new Error('cancelled'), { cancelled: true });
  }
}

// A countdown row in `host`, which must be positioned (css: position:relative) - the row lies
// over it. `startedAt` re-attaches the row to a job already running, at its real age.
export function startJob(host, { key, label, estimateMs, startedAt, onCancel }) {
  host.hidden = false;
  host.textContent = '';
  return startInlineProgress(host, { key, label, estimateMs, startedAt, onCancel });
}

// The cross beside a countdown (phase G1): asks the server to stop the job. The poll then sees it
// cancelled; an answer that it had already ended is not an error.
export async function cancelJob(base, jobId) {
  return api(`${base}/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
}

// A line in the same place with no job behind it: "pick a file first", a refusal, the last word
// of a job that has finished.
export function sayJob(host, text, isError) {
  host.textContent = '';
  host.hidden = !text;
  if (!text) return;
  host.appendChild(Object.assign(document.createElement('div'), {
    className: 'lib-job-say' + (isError ? ' err' : ''), textContent: text,
  }));
}

export function clearJob(host) {
  host.hidden = true;
  host.textContent = '';
}

// Rounds a size to the nearest power of two, so runs of a similar size share an estimate: a
// ten-minute video and a two-hour one are not the same job.
export const bucket = (n) => Math.pow(2, Math.round(Math.log2(Math.max(1, +n || 0))));

// First-run guesses, from what these took on this machine. After one run of a key the countdown
// is the measured average and these stop mattering.
export const EST = {
  ingestFile: (bytes) => Math.max(90000, Math.round((bytes / 1048576) * 400)),
  ingestLink: 300000,
  topics: 45000,
  hooks: 20000,
  script: (scenes) => Math.max(40000, (scenes || 15) * 9000),
  humanize: 40000,
  rewrite: 20000,
  analyse: 45000,
  sample: (bytes) => Math.max(60000, Math.round((bytes / 1048576) * 500)),
};

export const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const clock = (s) => {
  const n = Math.max(0, Math.floor(+s || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(n % 60).padStart(2, '0');
};

export const mb = (b) => (b >= 1048576 ? Math.round(b / 1048576) + ' MB' : Math.round(b / 1024) + ' KB');

// How long a paragraph takes to say, at two and a half words a second.
export const spokenSeconds = (t) => Math.round(String(t || '').trim().split(/\s+/).filter(Boolean).length / 2.5);

// THE MODEL CHOICE - provider, model, effort - is the generator's and is remembered across forms and
// sessions (phase F3): a new form opens on it, and finding a source's topics and reading a narrator's
// voice run on it too, instead of on a default of their own.
const LS_MODEL = 'mk_model_v1';
export function modelChoice() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_MODEL) || 'null');
    return v && v.provider ? { provider: v.provider, model: v.model, effort: v.effort } : null;
  } catch (e) { return null; }
}
export function rememberModel(v) {
  try { localStorage.setItem(LS_MODEL, JSON.stringify({ provider: v.provider, model: v.model, effort: v.effort })); } catch (e) { /* this session only */ }
}

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
