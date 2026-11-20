'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CAN THIS AGGREGATOR BE ASKED?
//
// The video chat offers a model only through an aggregator it has a key for, and says so: kie.ai - no key,
// Replicate - no key, R2 missing for attachments. Three answers per aggregator, kept apart:
//   keyed(agg)   a key is in settings.json - read live, every call (a key pasted on Admin counts at once)
//   down(agg)    the key-health cache (lib/keys-health.js) says the provider refused it - SYNCHRONOUS and
//                never a probe: the matrix is read by smoke with no key and must not go to the network;
//                before the first check nothing is proven, and unknown is not down
//   r2()         public links can be made for attachments (lib/r2.js)
//
// The chats say 'kie' and 'replicate'; the health check says 'kie.ai' - translated here, once.
// ════════════════════════════════════════════════════════════════════════════

const { getSettings } = require('./settings-io');
const I18N = require('./i18n');

const AGGS = ['kie', 'replicate'];
const LABEL = { kie: 'kie.ai', replicate: 'Replicate' };
const HEALTH_ID = { kie: 'kie.ai', replicate: 'replicate' };
const FIELD = { kie: 'kieApiKey', replicate: 'replicateApiKey' };

function keyed(agg) {
  const f = FIELD[agg];
  if (!f) return false;
  let s = {};
  try { s = getSettings() || {}; } catch (e) { s = {}; }
  return !!String(s[f] || '').trim();
}

function down(agg) {
  try { return require('./keys-health').isDown(HEALTH_ID[agg]); } catch (e) { return false; }
}

function why(agg) {
  if (!keyed(agg)) return I18N.t('{label} - no key (Admin -> API keys)', { label: LABEL[agg] });
  if (down(agg)) {
    let d = '';
    try { d = require('./keys-health').reasonFor(HEALTH_ID[agg]); } catch (e) { d = ''; }
    return d ? I18N.t('{label} refused its key at the last check ({why})', { label: LABEL[agg], why: d })
      : I18N.t('{label} refused its key at the last check', { label: LABEL[agg] });
  }
  return '';
}

function r2() {
  try { return require('./r2').isConfigured(); } catch (e) { return false; }
}

/** For the page: every aggregator with its label, whether it has a key, and its last known health. */
function state() {
  return AGGS.map(id => ({ id, label: LABEL[id], keyed: keyed(id), health: !keyed(id) ? 'unset' : (down(id) ? 'down' : 'ok-or-unknown'), why: why(id) }));
}

module.exports = { AGGS, LABEL, keyed, down, why, r2, state };
