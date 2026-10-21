/* ════════════════════════════════════════════════════════════════════════════
   MERGE — making pictures, as a conversation, IN THE LIBRARY PANEL (phase J, the owner 2026-10-02).

   It used to be a window over the whole page. Now the Library panel has its views: the shelf, and this
   chat - "LIBRARY / generate image" in the panel's header, a press on "Library" back to the shelf, and
   while the open project has a conversation a pale "/ generate image" beside the title on the shelf,
   back to it in one press. Which view a project was left on is remembered per project; so is what was
   being written and attached, so leaving for the shelf, another project or a reload loses nothing.

   Since phase V1 this file is the chat's DESCRIPTION: the conversation itself - the thread, the countdowns,
   the attachment row, sending, the right column, the narrow layout - is chat-shell.js, shared with the
   video chat. What is the pictures chat's own is here: the model table and its settings column (model,
   aggregator, quality, shape, price), what a finished picture looks like in the thread, and where the
   pictures come from (`POST /api/mv3/img/send`, the project's pictures, the Library's Images).
   ════════════════════════════════════════════════════════════════════════════ */

import { openViewer } from '../library/viewer.js';
import { createChat, el, thumbOf, almanacSoon } from './chat-shell.js';
import { modelColumn } from './pic-models.js';
import { PICTURE_ACCEPT, isPictureFile } from '../picture-file.js';

const MAX_ATTS = 5;
const LS_LAST = 'mv3-imagen-last';       // the model choice - the key the window this replaced used

// A library record carries its size; without one a square is wrong by less than anything else.
function arOf(i) {
  const w = +(i.w || (i.meta || {}).w || 0);
  const h = +(i.h || (i.meta || {}).h || 0);
  return (w > 0 && h > 0) ? (w + ':' + h) : '1:1';
}

function PICTURES(ctx) {
  // The model, the aggregator, the quality, the shape and the price (phase V26.5: shared with the frames chat).
  const M = modelColumn(ctx, { lsKey: LS_LAST, maxAtts: MAX_ATTS, shapes: true });

  return {
    name: 'pictures',
    kind: 'image',
    ids: { root: 'mv3-pc', head: 'mv3-pc-head', crumb: 'mv3-lib-gen' },
    keys: { draft: 'mv3_pc_draft_v1', write: 'mv3_pc_write_v1', strip: 'mv3-ig-strip-w' },
    maxAtts: MAX_ATTS,
    counts: [1, 2, 4],
    noun: { one: 'picture', many: 'pictures' },
    busyWord: 'drawing',
    // Only the first guess. startInlineProgress keeps a running average per key, so each model learns its
    // own pace after one picture - and they differ by a factor of ten.
    eta: 40000,
    progressKey: (g) => 'mv3-imagen-' + (g.engine || ''),
    sendUrl: '/api/mv3/img/send',
    text: {
      placeholder: 'Describe a picture, or say what to change.',
      empty: 'Describe a picture. What comes back stays in this project — and in the Library.',
      emptyNoProject: 'Describe a picture. A project is started for it with the first message.',
      onlyFiles: 'Only pictures can be attached here.',
      slot: 'A picture to work from - from this computer, or press one on the right',
      plus: 'Add a picture from this computer. It goes into Images and straight into the row above the message box.',
      cat: 'This project\'s pictures, or a category of the Library\'s Images',
      crumb: 'The pictures chat - pictures made with a model',
    },
    // Any picture, a phone's HEIC too - the server makes it a JPEG on the way in (phase V24).
    upload: { url: '/api/mv3/img/upload', field: 'image', accept: PICTURE_ACCEPT, ok: isPictureFile },
    // The right column: this project's pictures, or any category of the Library's Images.
    feed: {
      url: (k) => '/api/mv3/img/feed?project=' + encodeURIComponent(k),
      map: (g) => ({ path: g.imagePath, aspect: g.aspect, state: g.state, name: g.prompt || '', error: g.error }),
    },
    cats: {
      // (phase TG, block 5d) REFERENCES' pictures are one more category here (`refs=1`).
      url: '/api/library/shelf/media?filter=images&refs=1',
      map: (i) => ({ path: i.media, aspect: arOf(i), state: 'done', name: i.name || '', libId: i.id || '' }),
      group: 'images',
    },
    resultPath: (g) => g.imagePath,

    settings: {
      load: M.load,
      paint: M.paint,
      // The pairing decides how many references fit, so the engines are read again whenever the row changes.
      onAtts: M.onAtts,
      onCount: M.onCount,
      // The project's own shape is the dot among the shapes.
      onProject: M.onProject,
      room: M.room,
      ready: M.ready,
      body: M.body,
    },

    // A finished picture in the thread: a miniature - hovering shows it properly, a press opens it over
    // everything - with "to reference" and "to timeline" under it.
    shot(g, cell, open) {
      const img = document.createElement('img');
      img.className = 'mv3-ig-shot';
      img.src = thumbOf(g.imagePath, 'strip');
      img.alt = g.prompt || '';
      img.loading = 'lazy'; img.decoding = 'async';
      img.style.aspectRatio = String(g.aspect || '9:16').replace(':', '/');
      img.title = 'Open it large';
      img.addEventListener('mouseenter', () => ctx.peekShow(thumbOf(g.imagePath, 'main'), img));
      img.addEventListener('mouseleave', ctx.peekHide);
      img.addEventListener('click', open);
      cell.appendChild(img);
      const acts = el('div', 'mv3-ig-acts');
      const use = el('button', 'mv3-c-btn', 'to reference');
      use.type = 'button';
      use.title = 'Put it in the row above the message box and carry on from it';
      use.addEventListener('click', () => ctx.attach(g.imagePath, (g.prompt || '').slice(0, 60)));
      const add = el('button', 'mv3-c-btn', 'to timeline');
      add.type = 'button';
      add.title = 'Puts it on the lane above main video, at the playhead.';
      add.addEventListener('click', () => ctx.place({ src: g.imagePath, thumb: g.imagePath, libId: g.imageId || '', name: (g.prompt || '').slice(0, 60) }, add));
      acts.append(use, add);
      cell.appendChild(acts);
      // Taken off the shelf since: said, instead of a broken picture, and nothing builds on it.
      img.addEventListener('error', () => {
        const gone = el('div', 'mv3-ig-gone', 'not in the Library any more');
        gone.style.aspectRatio = img.style.aspectRatio;
        img.replaceWith(gone);
        use.disabled = true; add.disabled = true;
      }, { once: true });
    },

    // The technical half of a turn, folded away under "read more".
    facts: (g) => [
      ['model', (g.engine || '') + ' · ' + (g.provider || '?') + ' · ' + (g.quality || '')],
      ['asked as', g.model || ''],
      ['shape', (g.aspect || '') + ((g.w && g.h) ? ' · ' + g.w + '×' + g.h : '')],
      ['took', g.secs ? g.secs + 's' : ''],
      ['references', (g.refs || []).length ? String(g.refs.length) : ''],
      ['writer', g.fell ? 'sent as typed - ' + g.fell : (g.writer || '')],
      ['sent as', (g.prompt && g.said && g.prompt !== g.said) ? g.prompt : ''],
    ],

    // Every picture this thread finished, in the Library's viewer - drawn from the 2048px tier, never the
    // 4K original (phase J4).
    view(done, at) {
      openViewer(
        done.map(x => ({ id: x.id, kind: 'images', media: x.imagePath, thumb: x.imagePath, name: x.prompt || '', meta: { date: x.at } })),
        at,
        { showSrc: (it) => thumbOf(it.media, 'main') });
    },

    // (phase V25, the owner 2026-10-13) The almanac at the foot of the column, as in the video chat - still to come, so
    // dimmed. The gear in the header that opened the models' rules and the analyst's ladder is gone: the ladder is on
    // Admin -> AI settings.
    columnFoot: () => [almanacSoon()],
  };
}

const CHAT = createChat(PICTURES);

/** Every way in: the generate menu, "+" on the Images shelf, the lane's right-click, ?open=pictures. */
export const openPictures = () => CHAT.open();

export function initPicChat() { CHAT.init(); }
