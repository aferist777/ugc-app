/* ════════════════════════════════════════════════════════════════════════════
   MERGE — making pictures, as a conversation, in a window (phase J, the owner 2026-10-02).

   What was being written and attached is remembered per project, so closing the window, another project or a
   reload loses nothing.

   Since phase V1 this file is the chat's DESCRIPTION: the conversation itself - the thread, the countdowns,
   the attachment row, sending, the right column, the narrow layout - is chat-shell.js, shared with the
   video chat. What is the pictures chat's own is here: the model table and its settings column (model,
   aggregator, quality, shape, price), what a finished picture looks like in the thread, and where the
   pictures come from (`POST /api/mv3/img/send`, the project's pictures, the Library's Images).

   (phase V55, the owner 2026-10-28, (гн6), (гн7)) Its attachments are laid out as the video chat's: a ZONE "PICTURES
   0/N" (N - as many as the model takes) of small squares, its "+" opening the attachment window with the tree
   (chat-pick.js); its right column is the folder column (js/folder-column.js): a dropdown of the media tree - this
   project, REFERENCES (pictures), IMAGES with all its folders -, the open folder's folders as tiles, then its pictures.

   (phase V64 block 3, the owner 2026-10-31) A WINDOW, no view of the Library panel any more (js/merge-v3/chat-window.js):
   opened by IMAGES' "generate" in the tree, the lane's right button, the gallery's "+" and
   ?open=pictures; a picture dragged out of it lays the window aside until it is let go on a lane.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './chat-owner.js';
import { openViewer } from '../library/viewer.js';
import { createChat, el, thumbOf, almanacSoon, refuseHome, mediaBtn } from './chat-shell.js';
import { chatWindow, CHAT_WIN } from './chat-window.js';
import { modelColumn } from './pic-models.js';
import * as Src from './chat-sources.js';
import { PICTURE_ACCEPT, isPictureFile } from '../picture-file.js';
import { backButton } from './tl-gen.js';

const MAX_ATTS = 5;
const LS_LAST = 'mv3-imagen-last';       // the model choice - the key the window this replaced used
// (phase V77) The description's way in from outside (openPictures with a thing from the timeline) - set when it is made.
let _api = null;

function PICTURES(ctx) {
  // The model, the aggregator, the quality, the shape and the price (phase V26.5: shared with the frames chat).
  const M = modelColumn(ctx, { lsKey: LS_LAST, maxAtts: MAX_ATTS, shapes: true });

  // (phase V77, the owner's (тч1), (тч8а)) A picture from the timeline: the zone emptied - the thread and the words in the box stay -,
  // the picture in it, the page's word at the end of the thread, the box ready for what to change.
  _api = {
    fromTimeline(o) {
      const a = (o && o.attach) || {};
      if (!a.path) return;
      ctx.useAtts([]);
      ctx.attach(a.path, a.name || '');
      // (phase V78) From the Library too (js/gen-menu.js).
      const lib = o.from === 'library';
      const what = (o.as === 'frame' ? 'The frame' : 'The picture') + (lib ? ' from the Library' : ' from the timeline');
      ctx.notice(what + ' is in the zone - say what to change in it.'
        + (o.back ? '\nWhen the picture is made, "' + o.back + '" under it puts it on the timeline.'
          : lib ? '\nWhat it makes lies in IMAGES → Generated.' : ''));
      const ui = ctx.ui();
      if (ui) ui.ta.focus();
    },
  };

  return {
    name: 'pictures',
    kind: 'image',
    ids: { root: 'mv3-pc' },
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
      empty: 'Describe a picture. What comes back stays in this project - and in the Library.',
      // (phase V73 block 0) Opened from Home or the Library the chat is on THE draft's conversation (chat-owner.js unbound):
      // no project to stay in - what it makes lies in IMAGES → Generated.
      emptyDraft: 'Describe a picture. What comes back lies in the Library, in IMAGES → Generated.',
      emptyNoProject: 'Describe a picture. A project is started for it with the first message.',
      onlyFiles: 'Only pictures can be attached here.',
      slot: 'A picture to work from - from the Library or this computer',
      plus: 'Add a picture from this computer. It goes into the folder open here when it is one of yours in IMAGES - else into IMAGES itself - and straight into the row above the message box.',
      cat: 'This project\'s pictures, or a folder of the Library',
    },
    // Any picture, a phone's HEIC too - the server makes it a JPEG on the way in (phase V24).
    upload: { url: '/api/mv3/img/upload', field: 'image', accept: PICTURE_ACCEPT, ok: isPictureFile },
    // The right column's "this project": the pictures made in it.
    feed: {
      url: (k) => '/api/mv3/img/feed?project=' + encodeURIComponent(k),
      map: (g) => ({ path: g.imagePath, aspect: g.aspect, state: g.state, name: g.prompt || '', error: g.error }),
    },
    // (phase V55, (гн7)) The right column: this project, then REFERENCES' pictures and IMAGES by their folders.
    // (phase V78, (лч16)) THIS PROJECT first - its pictures only.
    column: { roots: ['plinks', 'references', 'images'], files: 'photo', group: 'images', home: 'images' },
    // (phase V55, (гн6)) "+" of the zone opens the attachment window with the tree: characters & looks above it (and the
    // environments and lookbooks while IMAGES has no folders of them), REFERENCES and IMAGES in it.
    pick: {
      sources: () => [Src.PEOPLE_ROW],
      tree: () => Src.TREE.image,
      start: () => '',
      why: () => '',
      lands: { image: 'images' },
      upWords: { image: 'A picture goes into the folder open here when it is one of yours in IMAGES - else into IMAGES itself.' },
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
      // (phase V55, (гн6)) One part, as the video chat's: as many places as the model takes.
      zone: () => ({ parts: [{ kind: 'image', word: 'pictures', one: 'picture', room: M.room(), none: 'This model takes no pictures.' }] }),
      ready: M.ready,
      body: M.body,
    },

    // A finished picture in the thread: a miniature with "to reference" under it - a press on it does nothing, ⤢ in its
    // top-right corner opens it large (V91 block 3, the owner 2026-11-12). (phase V60.3, the owner's (вс1б)) No "to timeline":
    // it is dragged onto a lane.
    shot(g, cell, open) {
      const img = document.createElement('img');
      img.className = 'mv3-ig-shot';
      img.src = thumbOf(g.imagePath, 'strip');
      img.alt = g.prompt || '';
      img.loading = 'lazy'; img.decoding = 'async';
      img.style.aspectRatio = String(g.aspect || '9:16').replace(':', '/');
      img.title = 'Drag it onto a lane';
      // Dragged onto a lane as a tile of the right column is - the shelf's own payload.
      img.draggable = true;
      img.addEventListener('dragstart', (ev) => {
        if (refuseHome(img, ev)) return;
        ev.dataTransfer.effectAllowed = 'copy';
        ev.dataTransfer.setData(Store.DRAG_TYPE, JSON.stringify({
          libId: g.imageId || '', src: g.imagePath, thumb: g.imagePath, name: (g.prompt || '').slice(0, 60), group: 'images', dur: 0,
        }));
      });
      cell.appendChild(img);
      const big = mediaBtn('image', open);
      cell.appendChild(big);
      const acts = el('div', 'mv3-ig-acts');
      const use = el('button', 'mv3-c-btn u-btn is-s', 'To reference');
      use.type = 'button';
      use.title = 'Put it in the row above the message box and carry on from it';
      use.addEventListener('click', () => ctx.attach(g.imagePath, (g.prompt || '').slice(0, 60)));
      acts.append(use);
      // (phase V77) Made from a thing of the timeline: the button that lays it back there (js/merge-v3/tl-gen.js).
      const back = backButton(g, g.refs || [], { src: g.imagePath, thumb: g.imagePath, libId: g.imageId || '',
        name: (g.prompt || '').slice(0, 60), w: +g.w || 0, h: +g.h || 0 }, 'image');
      if (back) acts.append(back);
      cell.appendChild(acts);
      // Taken off the shelf since: said, instead of a broken picture, and nothing builds on it.
      img.addEventListener('error', () => {
        const gone = el('div', 'mv3-ig-gone', 'not in the Library any more');
        gone.style.aspectRatio = img.style.aspectRatio;
        img.replaceWith(gone);
        big.remove();
        use.disabled = true;
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
const WIN = chatWindow({ chat: CHAT, id: 'mv3-pc', ...CHAT_WIN.pictures });

/** Every way in - IMAGES' "generate", the gallery's "+" on IMAGES, the lane's right-click, ?open=pictures: its window. */
export async function openPictures(o) {
  await WIN.open();
  // (phase V77) Opened with a thing from the timeline (js/merge-v3/tl-gen.js).
  if (o && o.attach && _api) _api.fromTimeline(o);
}

export function initPicChat() { CHAT.init(); }
