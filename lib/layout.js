'use strict';

/* layout.js - the shape of the library.

   LAYOUT 6. Next to data/ (the stores shared by the whole app):
     projects/<name>/  a project: project.json is the Scenarios project itself, voice/ frames/ clips/
                       its working files, merge/ its timelines (which only point at media). A Merge
                       project made without Scenarios is a folder holding just merge/.
     media/<kind>/     what was made or brought in, one folder per kind - KINDS below. Shelves with
                       categories keep one folder per category (media/birols/<category>/, nocat for
                       none), renders one per project; work/ holds what belongs to no project or shelf.
     cache/            what is derived and made again when missing: the thumbnails /api/thumb serves,
                       pose previews, voice samples, the window's browser profile, an updated yt-dlp.
     backups/          copies of the stores taken before something rewrites them (lib/library-format.js snapshot).
   An address mirrors its folder: /projects/X/clips/c.mp4 is <library>/projects/X/clips/c.mp4, and
   /media/, /cache/ the same. lib/media.js turns one into the other; lib/names.js makes the names.

   No config and no disk here: lib/config.js reads KINDS from it, and lib/library-format.js LAYOUT before the library
   is settled. */

const LAYOUT = 6;

// One folder per kind of thing, under media/.
const KINDS = ['characters', 'looks', 'lookbooks', 'locations', 'images', 'birols', 'uploads',
  'hooks', 'renders', 'voice', 'audio', 'sources', 'work',
  // The Sounds shelf: categories like B-roll's (lib/sounds-store.js).
  'sounds',
  // The talking heads kept from deleted projects, a folder per project (lib/heads.js).
  'heads',
  // REFERENCES - posts, links and media sent to the person's own Telegram bot, a folder per source and its kind of
  // post (lib/references-store.js).
  'references',
  // IMAGES -> Props: the products a character holds in a frame, one picture each - the file IS the entry, what
  // is known about it in data/props-meta.json (lib/shelf-meta.js, lib/props.js).
  'props'];
// A project folder's working files, and where its timelines are.
const PROJECT_SUBS = { voice: 'voice', frames: 'frames', clips: 'clips', merge: 'merge' };
// The folder of a shelf item with no category.
const NOCAT = 'nocat';

module.exports = { LAYOUT, KINDS, PROJECT_SUBS, NOCAT };
