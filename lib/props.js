'use strict';

// IMAGES -> PROPS (phase V26.6, the owner 2026-10-30, (п1)-(п9), (пр1)-(пр5)): the products a character holds in a frame.
//
// A product is ONE picture in media/props/ - the file IS the entry, as an environment's is (routes/library.js MADE) - and
// what is known about it lives beside it in data/props-meta.json (lib/shelf-meta.js), keyed by the picture's address:
//   name          what it is called - given in the New prop window, or the agent's NAME when none was
//   words         what the person said about it, as typed, in any language - kept apart, so "read again" reads them anew
//   description   the agent's, in English, in sections (NAME / WHAT IT IS / SIZE / LOOK / LABEL / HOW IT IS HELD /
//                 FROM YOUR WORDS) - or written by hand in the viewer (`by: 'you'`)
//   by, at        who wrote the description (the agent's model, or 'you') and when
//
// Nothing is generated and no Alerts row is written: the description is a reading of fractions of a cent.

const _reading = new Set();             // the products being described right now, by address

/** Whether the agent is describing the product at `media` right now. */
function reading(media) {
  return _reading.has(String(media || ''));
}

module.exports = { reading };
