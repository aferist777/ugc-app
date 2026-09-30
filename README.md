# UGC Studio

A desktop app that takes a vertical video ad from an idea to a finished mp4: casting, wardrobe,
script, generated frames and lipsync, a timeline and the render. It runs on one computer for one
person, in a window of its own, and keeps everything it makes in one folder - the library.

> This is the `local-app` branch. The server version it grew out of lives on the other branches.

---

## What is in it

| Page | What it does |
|---|---|
| **Merge** | Where the app opens. The talking head built line by line - cast, wardrobe, location, a frame per line, the voice, lipsync - and the timeline: clips, overlays, halfers, music, word-timed captions, and the render to mp4 |
| **Library** | The shelves: characters, lookbooks, environments, media, voices, music, scenarios, renders. On Characters, **New Character** builds a person once, as a 4K reference sheet (face and three full-body views) that every later picture of them is conditioned on, and a character's voices are chosen in its column; on Scenarios, the generator: sources and their transcripts, topics, scripts, narrators |
| **Admin** | API keys, and Import / Export of the whole library |

Generation goes out to paid services: images and video through kie.ai or Replicate (the same
models through two aggregators, because they fail separately), scripts through kie.ai or
Replicate, reading pictures through Replicate or kie.ai (OpenRouter where a ladder does not say
otherwise), voices through ElevenLabs, transcription through Replicate's Whisper. Every paid
picture, video and piece of music is a row in Alerts. Rendering is local, with ffmpeg.

---

## Running it

Until there is a built `UGC Studio.exe`, the app runs from this folder:

```bash
npm install
```

- **`UGC Studio.cmd`** opens the app on the library next to it, `library\`.
- **`npm start`** opens it on `local-data/` in the checkout - the library for development.
- **`npm run server`** runs the server alone (for a browser tab: `http://127.0.0.1:<PORT>`).

`UGC_DATA_DIR` names any other folder as the library. The window refuses to open on a library it
cannot write to, and runs one copy per library.

### Keys

On **Admin → API keys**. They are stored in the library (`data/settings.json`) and never sent to
the page - it only sees whether a key is set and a masked hint. A key that is not set disables
the feature that needs it.

References have to reach the aggregators by URL, so a picture attached to a generation is put in
your own **Cloudflare R2** bucket first (account ID, access key, secret, bucket; the public base is
optional). Without R2, generations that take a reference cannot start.

---

## The library

Everything the app writes, and nothing of the program:

```
library\
  data\        the shared stores - JSON, written atomically (temp file, fsync, rename)
  projects\    a folder per project: project.json (the Scenarios project itself), voice\,
               frames\, clips\, and merge\ with its timelines
  media\       characters, looks, lookbooks, locations, voice, audio, sources;
               images, birols, uploads, hooks - a folder per category, nocat for none;
               renders - a folder per project; work - what belongs to no project or shelf yet
  cache\       derived and made again when missing: thumbnail sizes, mannequin previews, voice
               samples, export archives, an updated yt-dlp, the window's profile
  backups\     what an upgrade of the library set aside
  logs\
```

A stored path like `/projects/Honey/clips/c.mp4` is a path inside the library. Renaming a project
or a category renames its folder, and every stored path follows. An update replaces the program
and leaves the library alone; a library from an older version is sorted into these folders the
first time the app starts (the old stores and the files nothing used go to `backups\`).

**Import / Export** (Admin) carries a whole library, or chosen groups of it, to another machine.
The archive is built to a file first, so a dropped download resumes; an import adds what is
missing and touches nothing that is already there - a project or category of the same name but
another origin gets a folder of its own. Archives from older versions and from the server version
are read too: they are sorted into this layout, and what has no place here is left out.

---

## How it is built

No bundler, no framework, no database.

```
desktop\    the Electron shell: window, keys, downloads, the server in a utility process
server.js   Express, bound to 127.0.0.1 only
routes\     one file per API area; ffmpeg.js is the renderer
lib\        config.js (the two roots: program and library), media paths, stores, generation
public\     the pages; js\<page>\ holds that page's ES modules
tools\      smoke-local.js (the quick check), fetch-yt-dlp.js, migrate-library.js, upgrade-library.js, warm-thumbs.js
```

`yt-dlp` ships with the app (`vendor/yt-dlp/`, fetched and checked by `npm install`).

After a change: `node tools/smoke-local.js` against a running server - every page and every
parameterless GET route, key redaction, removed routes still 404, '/' and '/character' landing where
they should. It spends nothing.

---

## Honest notes

- **It spends money.** Every generation is a paid API call, and there is no sandbox mode.
- **No sign-in.** Whoever opens the window is its user - which is why the server listens on
  loopback only.
- **Renders are CPU-bound.** A couple of minutes for a sixty-second ad is normal.

No licence is attached: all rights reserved.
