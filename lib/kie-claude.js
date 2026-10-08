'use strict';

/* kie-claude.js - Claude Opus 5.5 on kie.ai, for the 3D Studio's agents (docs/local-app/PLAN.md "3D Studio - план
   по этапам": "Claude Opus 5.5 на kie - пробы 2026-10-08").

   POST https://api.kie.ai/claude/v1/messages - Anthropic's Messages shape, the app's kie key as a Bearer. What the
   probes showed, and what this module does about it:
     - kie's max_tokens defaults to 4096, and Opus 5.5 always thinks inside the same limit - a long answer is cut
       off. Every call names its own ceiling (64 000 by default); a ceiling costs nothing, only what is written.
     - The answer is always STREAMED (Server-Sent Events, as Anthropic sends them): a minute-long answer without a
       stream is a minute-long open request a proxy may drop.
     - A picture goes as base64 only - kie refuses a picture by address.
     - 429 comes after about ten calls in a few minutes: a pause of 30 s and up to three tries, then words.
     - An answer cut at its ceiling (stop_reason max_tokens) is returned as such - the caller never applies it.
     - `credits_consumed` (1 credit ≈ $0.005) comes in the last event and is passed on, so a page can say the price.
   Effort cannot be chosen (kie drops output_config) and no thinking text comes back. */

const { getSettings } = require('./settings-io');

const URL = 'https://api.kie.ai/claude/v1/messages';
const MODEL = 'claude-opus-5-5';
const PAUSE_429 = 30000;
const TRIES = 3;
const TIMEOUT = 5 * 60 * 1000;

const _sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('stopped')); }, { once: true });
});

// The stream into Anthropic's message: text blocks, tool_use blocks with their input parsed, the stop reason,
// the usage and kie's credits.
async function _read(res) {
  const blocks = [];
  let stop = null, usage = {}, credits = 0, error = null;
  let buf = '';
  const dec = new TextDecoder();
  const take = (ev) => {
    if (!ev) return;
    if (ev.type === 'content_block_start') {
      const b = Object.assign({}, ev.content_block);
      if (b.type === 'tool_use') { b._json = ''; b.input = {}; }
      if (b.type === 'text') b.text = b.text || '';
      blocks[ev.index] = b;
    } else if (ev.type === 'content_block_delta') {
      const b = blocks[ev.index];
      if (!b) return;
      if (ev.delta.type === 'text_delta') b.text += ev.delta.text;
      else if (ev.delta.type === 'input_json_delta') b._json += ev.delta.partial_json;
    } else if (ev.type === 'content_block_stop') {
      const b = blocks[ev.index];
      if (b && b.type === 'tool_use') {
        try { b.input = b._json ? JSON.parse(b._json) : {}; } catch (e) { b.input = null; b.bad = true; }
        delete b._json;
      }
    } else if (ev.type === 'message_delta') {
      if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
      if (ev.usage) usage = Object.assign(usage, ev.usage);
      if (ev.credits_consumed != null) credits = Number(ev.credits_consumed) || 0;
    } else if (ev.type === 'message_start' && ev.message && ev.message.usage) {
      usage = Object.assign({}, ev.message.usage);
    } else if (ev.type === 'error') {
      error = (ev.error && ev.error.message) || 'the answer broke off';
    }
  };
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      try { take(JSON.parse(line.slice(5).trim())); } catch (e) { /* a keep-alive or a broken line */ }
    }
  }
  if (buf.trim().startsWith('data:')) { try { take(JSON.parse(buf.trim().slice(5).trim())); } catch (e) { /* the end */ } }
  return { content: blocks.filter(Boolean), stop_reason: stop, usage, credits, error };
}

/**
 * One call. `o`: { system, messages, tools?, maxTokens?, signal?, label? }.
 * Returns { content, stop_reason, usage, credits } or throws in words.
 */
async function ask(o) {
  const key = String(getSettings().kieApiKey || '').trim();
  if (!key) throw new Error('No kie.ai key - add it on Admin -> API keys.');
  const body = { model: MODEL, stream: true, max_tokens: o.maxTokens || 64000, messages: o.messages };
  if (o.system) body.system = o.system;
  if (o.tools && o.tools.length) body.tools = o.tools;
  let last = null;
  for (let t = 1; t <= TRIES; t++) {
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    if (o.signal) o.signal.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, TIMEOUT);
    try {
      const res = await fetch(URL, { method: 'POST', signal: ctl.signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 429 || res.status >= 500) {
        last = new Error('kie.ai answered ' + res.status + (res.status === 429 ? ' - too many requests' : ''));
        await res.text().catch(() => '');
      } else if (!res.ok || !/event-stream/.test(res.headers.get('content-type') || '')) {
        const raw = await res.text().catch(() => '');
        let msg = raw.slice(0, 200);
        try { const j = JSON.parse(raw); msg = (j.error && j.error.message) || j.msg || msg; } catch (e) { /* not JSON */ }
        throw Object.assign(new Error('kie.ai refused the request (' + res.status + '): ' + msg), { final: true });
      } else {
        const r = await _read(res);
        if (r.error && !r.content.length) { last = new Error('kie.ai: ' + r.error); }
        else {
          console.log(`[kie-claude] ${o.label || 'ask'}: ${r.stop_reason}, out ${r.usage.output_tokens || '?'} tokens, ${r.credits} credits`);
          return r;
        }
      }
    } catch (e) {
      if (e.final) throw e;
      if (o.signal && o.signal.aborted) throw new Error('stopped');
      last = e.name === 'AbortError' ? new Error('kie.ai did not answer in five minutes') : e;
    } finally {
      clearTimeout(timer);
      if (o.signal) o.signal.removeEventListener('abort', stop);
    }
    console.warn(`[kie-claude] ${o.label || 'ask'}: try ${t} - ${last.message}`);
    if (t < TRIES) await _sleep(PAUSE_429, o.signal);
  }
  throw last || new Error('kie.ai did not answer');
}

/** A picture on disk as an image block: its long side at most `max` px, a JPEG. */
async function imageBlock(abs, max = 1568) {
  const sharp = require('sharp');
  const buf = await sharp(abs).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } };
}

const textOf = (r) => (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
const toolOf = (r, name) => (r.content || []).find(b => b.type === 'tool_use' && (!name || b.name === name)) || null;

module.exports = { ask, imageBlock, textOf, toolOf, MODEL };
