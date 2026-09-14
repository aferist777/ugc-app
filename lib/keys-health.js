'use strict';

// ════════════════════════════════════════════════════════════════════════════
// IS THIS KEY ALIVE? — asked of each provider directly, on a timer.
//
// Until now a dead key was discovered by a generation failing: you paid the wait,
// and the actual answer - "that token was revoked" - was three layers down. Measured
// on a real one: Replicate had been answering 401 to everything for days, and nothing
// on the page said so.
//
// Every probe below is a provider's OWN free endpoint - no generation, no tokens, no
// cost - and each was run live before being written down:
//
//   kie.ai      GET /api/v1/chat/credit        350ms   -> the credit balance
//   OpenRouter  GET /api/v1/key                910ms   -> the key's own record
//   Replicate   GET /v1/account                957ms   -> the account
//   ElevenLabs  GET /v1/user/subscription     1787ms   -> tier and character quota,
//               GET /v1/voices                          or the voice list, when the key
//                                                       is not allowed to read the account
//   Groq        GET /openai/v1/models          457ms   -> the model list
//
// THREE states, not two. "unset" is not "down": a key nobody entered is a choice, and
// telling someone their Groq key is broken when they never had one sends them looking
// for a fault that does not exist.
//
// Cached for thirty minutes, because a key does not usually change its mind and five
// outbound requests per page load would be a tax on every visit. force() is what the
// "Check now" button calls, for the moment after a new key is pasted.
//
// In lib rather than in the route because the ladder runner reads it too: a step whose
// key is refused is a step worth stepping over rather than spending a timeout on.
// ════════════════════════════════════════════════════════════════════════════

const axios = require('axios');
const { getSettings } = require('./settings-io');

const TTL_MS = 30 * 60 * 1000;
const TIMEOUT = 15000;

const PROVIDERS = [
  {
    id: 'kie.ai', field: 'kieApiKey', kind: 'aggregator',
    url: 'https://api.kie.ai/api/v1/chat/credit',
    headers: (k) => ({ Authorization: 'Bearer ' + k }),
    // kie answers 200 with the failure inside the envelope, so the body has to be read
    // rather than the status code - the same trap that makes a missing model look like
    // an empty reply everywhere else in this app.
    read: (d) => {
      if (d && d.code != null && Number(d.code) !== 200) throw new Error(d.msg || ('code ' + d.code));
      const cr = Number(d && d.data);
      return Number.isFinite(cr) ? cr.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' cr' : 'ok';
    },
  },
  {
    id: 'openrouter', field: 'openRouterApiKey', kind: 'aggregator',
    url: 'https://openrouter.ai/api/v1/key',
    headers: (k) => ({ Authorization: 'Bearer ' + k }),
    read: (d) => {
      const x = (d && d.data) || {};
      // `label` is the key's own name and often contains part of it. Not ours to pass on.
      if (x.limit == null) return 'active, no limit';
      return 'active, ' + (x.limit_remaining != null ? x.limit_remaining : '?') + ' of ' + x.limit + ' left';
    },
  },
  {
    id: 'replicate', field: 'replicateApiKey', kind: 'aggregator',
    url: 'https://api.replicate.com/v1/account',
    headers: (k) => ({ Authorization: 'Bearer ' + k }),
    read: (d) => (d && (d.username || d.name)) ? String(d.username || d.name) : 'active',
  },
  {
    // TWO QUESTIONS, because a key can be allowed to speak without being allowed to talk about
    // itself. ElevenLabs keys carry per-scope permissions, and one made for this app needs
    // text_to_speech and voices_read - not user_read, which is what /v1/user/subscription
    // wants. A key like that answered 401 there and the panel called it refused, while
    // every voice line in the app was being generated with it perfectly happily.
    //
    // So: the subscription first, because it carries the character quota and that is worth
    // showing; and if it is refused for want of a permission, the voice list instead - which
    // is the thing the app actually needs the key to do. The quota is then said to be out of
    // reach rather than silently missing.
    id: 'elevenlabs', field: 'elevenLabsApiKey', kind: 'vendor',
    probe: async (k) => {
      const h = { 'xi-api-key': k };
      try {
        const { data: d } = await axios.get('https://api.elevenlabs.io/v1/user/subscription', { headers: h, timeout: TIMEOUT });
        const used = Number(d && d.character_count), cap = Number(d && d.character_limit);
        if (!Number.isFinite(used) || !Number.isFinite(cap)) return String((d && d.tier) || 'active');
        return used.toLocaleString('en-US') + ' of ' + cap.toLocaleString('en-US') + ' chars';
      } catch (e) {
        const st = e && e.response && e.response.status;
        const det = (e && e.response && e.response.data && e.response.data.detail) || {};
        const noPerm = st === 401 && (String(det.status || '') === 'missing_permissions'
                                   || /permission/i.test(String(det.message || '')));
        if (!noPerm) throw e;                          // a genuinely dead key still reads as down
        const { data: v } = await axios.get('https://api.elevenlabs.io/v1/voices', { headers: h, timeout: TIMEOUT });
        const n = (v && Array.isArray(v.voices)) ? v.voices.length : 0;
        return n + ' voices · quota hidden, the key has no user_read permission';
      }
    },
  },
  {
    id: 'groq', field: 'groqApiKey', kind: 'vendor',
    url: 'https://api.groq.com/openai/v1/models',
    headers: (k) => ({ Authorization: 'Bearer ' + k }),
    read: (d) => (d && Array.isArray(d.data)) ? (d.data.length + ' models') : 'active',
  },
];

const LABELS = { 'kie.ai': 'kie.ai', openrouter: 'OpenRouter', replicate: 'Replicate',
                 elevenlabs: 'ElevenLabs', groq: 'Groq' };

// What a provider actually said, dug out of whichever envelope it used. axios's own
// "Request failed with status code 401" names the status and nothing else.
function _why(e) {
  const d = e && e.response && e.response.data;
  const said = d && (d.detail || d.msg || (d.error && d.error.message) || d.title
    || (typeof d === 'string' ? d.slice(0, 120) : ''));
  const code = e && e.response && e.response.status;
  if (code === 401 || code === 403) return code + ' - the key was rejected';
  if (said) return (code ? code + ' - ' : '') + String(said).slice(0, 120);
  return String((e && e.message) || 'no answer').slice(0, 120);
}

async function _probe(p, key) {
  const t0 = Date.now();
  if (!key) return { id: p.id, label: LABELS[p.id], kind: p.kind, state: 'unset', detail: 'no key set', ms: 0 };
  try {
    // A provider with its own way of asking (see elevenlabs) answers with a detail string.
    if (p.probe) return { id: p.id, label: LABELS[p.id], kind: p.kind, state: 'ok', detail: await p.probe(key), ms: Date.now() - t0 };
    const r = await axios.get(p.url, { headers: p.headers(key), timeout: TIMEOUT });
    return { id: p.id, label: LABELS[p.id], kind: p.kind, state: 'ok', detail: p.read(r.data), ms: Date.now() - t0 };
  } catch (e) {
    return { id: p.id, label: LABELS[p.id], kind: p.kind, state: 'down', detail: _why(e), ms: Date.now() - t0 };
  }
}

let _cache = null;      // { at, providers }
let _inflight = null;   // so several callers on one page load make ONE round of probes

async function _run() {
  const s = getSettings();
  const providers = await Promise.all(PROVIDERS.map(p => _probe(p, String(s[p.field] || '').trim())));
  _cache = { at: Date.now(), providers };
  return _cache;
}

async function getHealth({ force = false } = {}) {
  const fresh = _cache && (Date.now() - _cache.at) < TTL_MS;
  if (!force && fresh) return _cache;
  if (!_inflight) _inflight = _run().finally(() => { _inflight = null; });
  return _inflight;
}

// The cached verdict, without asking anyone. Deliberately synchronous and deliberately
// NOT a probe: the ladder runner calls this between steps, and a step must never wait
// on a network round trip to find out whether to take a network round trip.
//
// Unknown is not down. Before the first check nothing has been proven, and skipping a
// step on a suspicion is worse than trying it.
function isDown(providerId) {
  if (!_cache) return false;
  const p = _cache.providers.find(x => x.id === String(providerId));
  return !!(p && p.state === 'down');
}

function reasonFor(providerId) {
  if (!_cache) return '';
  const p = _cache.providers.find(x => x.id === String(providerId));
  return (p && p.state === 'down') ? p.detail : '';
}

// Shaped for the wire. `ageMs` rather than a promise about the future: the page decides
// what counts as stale, and it already knows the ttl.
function shape(c) {
  return {
    success: true,
    checkedAt: new Date(c.at).toISOString(),
    ageMs: Date.now() - c.at,
    ttlMs: TTL_MS,
    providers: c.providers,
  };
}

module.exports = { getHealth, isDown, reasonFor, shape, TTL_MS, PROVIDERS: PROVIDERS.map(p => p.id) };
