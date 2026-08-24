# ugc-app

A single desktop-style web app for making short vertical video ads end to end: invent the
character, dress them, put them somewhere, write the script, generate the shots, cut them
together and burn the captions — without leaving the window or opening a video editor.

It is one person's working tool, used in production. Not a framework, not a library, and not
a polished product you install and forget: it holds live API keys, spends real credits on
every generation, and assumes the person running it is the person who owns those accounts.

---

## What it actually does

The through-line is **one character, many shots**. Generative models are good at making a
striking image and bad at making the same person twice. This app puts that problem first:

1. **Character** — build a person once. The result is a 4K reference sheet: the same face and
   body from several angles, which every later generation is conditioned on.
2. **Looks** — dress that character. Each outfit is saved as its own set of images and can be
   reused across scripts.
3. **Scenarios** — write the ad, line by line, and cast it: who is in it, where it happens.
   Each line becomes a shot with its own first frame.
4. **Merge** — a real timeline. Six lanes (main cut, two overlay lanes, a band, music,
   captions), drag-to-place picture-in-picture, per-clip speed and effects, word-timed
   subtitles from a transcription.
5. **Render** — ffmpeg burns the whole thing to a vertical mp4.

Voices are generated per character and stay attached to them, so a character sounds the same
across every script they appear in.

---

## Pages

| Route | What it is |
|---|---|
| `/character` | Building a character and their reference sheet |
| `/scenarios` | Writing an ad, casting it, generating each shot |
| `/merge` | The timeline: cutting, overlays, captions, rendering |
| `/library` | Everything generated, browsable — and the settings popup |
| `/birols` | B-roll archive and generation |
| `/studio` | Pose reference tool |

---

## Stack

Deliberately small. There is no build step, no bundler and no frontend framework — the pages
are plain HTML that load ES modules straight from `public/js/`. Editing a file and reloading
is the whole development loop.

- **Node + Express** — every route is a small file under `routes/`
- **Vanilla ES modules** on the client, canvas for the preview
- **ffmpeg** (via `ffmpeg-static`) for every render
- **JSON files on disk** for state, under `data/` — no database
- **sharp** for image work, **archiver** / **unzipper** for import-export

Generation itself is other people's: image and video models through
[kie.ai](https://kie.ai) and [Replicate](https://replicate.com), language models through
[OpenRouter](https://openrouter.ai), speech through [ElevenLabs](https://elevenlabs.io).
The app is the thing that holds them together and keeps a character consistent across them.

---

## Running it

Requires **Node 18+** and roughly a gigabyte of disk to start with — generated media grows
quickly.

```bash
git clone https://github.com/aferist777/ugc-app-v1.0.git
cd ugc-app-v1.0
npm install
cp .env.example .env      # then fill it in - see below
npm start                 # http://localhost:3000
```

`npm run dev` runs the same thing under nodemon.

### Configuration

Everything lives in `.env`. Nothing here has a default that costs money by accident: an
unset key disables the feature that needs it rather than failing at render time.

| Variable | What it is for |
|---|---|
| `KIE_AI_API_KEY` | Images and video (the default aggregator) |
| `REPLICATE_API_TOKEN` | The same models through a second aggregator |
| `OPENROUTER_API_KEY` | Language and vision models |
| `ELEVENLABS_API_KEY` | Voices |
| `GROQ_API_KEY` | Transcription, for word-timed captions |
| `APP_PASSWORD` | Gates the whole app. **Unset means no gate at all** |
| `SESSION_HOURS` | How long a sign-in lasts (default 6) |
| `APP_SECRET` | Signs the session cookie |
| `PORT` | Default 3000 |

Generated media has to be **fetchable by the model providers** — they download the reference
images from a URL rather than receiving them in the request. Set one of:

| Variable | What it is for |
|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare R2. Signed links work with no bucket configuration at all |
| `R2_PUBLIC_BASE` | Optional: the bucket's public address, for short permanent links instead of signed ones |
| `PUBLIC_HOST_URL` | Serve the files from this install instead. Must be an address the providers can reach — not localhost |

A word of warning learned the hard way: providers are picky about these URLs. A bare IP over
plain HTTP is refused outright by some and silently mishandled by others, and a free file host
that answers `200` to you is not the same as one the model can read.

---

## Where things live

```
routes/      one file per API area; ffmpeg.js is the renderer
lib/         helpers.js (generation), config.js (paths), prompts.js
public/      the pages; js/<page>/ holds each page's modules
data/        JSON state - gitignored, this is the user's work
uploads/     generated media - gitignored
```

State is plain JSON written to disk. `data/merge-v3.json` holds every timeline,
`data/scen3-*.json` the scenarios, `data/characters.json` the cast. They are readable and
editable by hand, which is deliberate: when something goes wrong the state is right there.

---

## Import / Export

Everything in an install can be taken out and put into another one — scenarios, characters,
4K sheets, thumbnails, voices, projects with every overlay, and the media they point at.

**Library → the settings popup → the gear.** Pick what to take by group; each shows its size
and file count. Projects pull the media library in automatically, because a project stores the
*path* of a picture, never the picture.

The archive is built to a file rather than streamed, which is what makes a broken download
resumable — it is served with Range support, so the browser or `curl -C -` picks up where it
stopped. It is kept for a day, so a retry costs nothing.

Import is **additive**. Nothing already on the receiving machine is touched, a record that
exists keeps its local version, and re-importing the same archive twice changes nothing. There
is a switch for the other behaviour when bringing a newer version across is the actual intent.

---

## Notes

**This app spends money.** Every generation is a paid API call. There is no sandbox mode and
no confirmation step before a render — that is a deliberate choice for a tool used all day by
its author, and a sharp edge for anyone else.

**The gate is a shared password, not user accounts.** It exists because the app holds live
keys, not because it expects a crowd. Leave `APP_PASSWORD` unset and there is no gate at all;
the app says so loudly at startup.

**Renders are slow and CPU-bound.** ffmpeg does real work; a couple of minutes for a finished
sixty-second ad is normal.

---

## Status

Actively used, actively changed, and shaped around one workflow. Issues and questions are
welcome; feature requests may not fit the shape of it. There is no release cadence — `master`
is what is running.
