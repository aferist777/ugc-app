<h1 align="center">ugc-app</h1>

<p align="center">
  <b>One character. Many shots. One window.</b><br>
  A desktop-style web app that takes a vertical video ad from an idea to a finished mp4 —
  casting, wardrobe, script, generation, timeline and render — without opening a video editor.
</p>

<p align="center">
  <img alt="Node 18+" src="https://img.shields.io/badge/node-18%2B-3c873a">
  <img alt="Runtime dependencies: 9" src="https://img.shields.io/badge/runtime%20deps-9-informational">
  <img alt="Build step: none" src="https://img.shields.io/badge/build%20step-none-success">
  <img alt="Status: used in production" src="https://img.shields.io/badge/status-used%20in%20production-orange">
</p>

---

## The problem it starts from

Generative models are very good at making a striking image and very bad at making **the same
person twice**. Every tool that ignores this produces a folder of beautiful strangers, and an
ad needs one face for sixty seconds.

So the character comes first. You build a person once and the app keeps a 4K reference sheet —
the same face and body from several angles — which every later generation is conditioned on.
Everything downstream inherits that consistency: the outfits, the shots, the voice.

---

## The pipeline

| | Step | What happens |
|---|---|---|
| **1** | **Character** | Build a person once → a 4K reference sheet |
| **2** | **Looks** | Dress them; each outfit is saved and reusable across scripts |
| **3** | **Scenarios** | Write the ad line by line, cast who is in it and where |
| **4** | **Shots** | Each line becomes a frame, generated from the sheet |
| **5** | **Merge** | Six-lane timeline: cut, overlays, band, music, word-timed captions |
| **6** | **Render** | ffmpeg burns it to a vertical mp4 |

A character's voice is generated once and stays attached to them, so they sound the same in
every script they appear in.

---

## Features

- **Consistent casting** — one reference sheet drives every shot of that person
- **A real timeline** — six lanes, drag-to-place picture-in-picture, corner resize, rotation
- **Word-timed subtitles** — from a transcription, editable, with per-axis letter stretching
- **Bands** — a strip across the frame at any height, thickness and slice, feathered on the
  edges that face inward
- **Two aggregators per model** — the same engine through kie.ai or Replicate, because they
  fail separately
- **Everything portable** — one archive carries the whole install to another machine
- **No build step** — plain ES modules; edit a file, reload the page

---

## Quick start

```bash
git clone https://github.com/aferist777/ugc-app-v1.0.git
cd ugc-app-v1.0
npm install
cp .env.example .env      # fill in the keys you have
npm start                 # → http://localhost:3000
```

Node 18+. `npm run dev` runs it under nodemon.

An unset key disables the feature that needs it rather than failing halfway through a render,
so you can start with one provider and add the rest later.

### Keys

| | |
|---|---|
| `KIE_AI_API_KEY` | Images and video — the default aggregator |
| `REPLICATE_API_TOKEN` | The same models through a second one |
| `OPENROUTER_API_KEY` | Language and vision |
| `ELEVENLABS_API_KEY` | Voices |
| `GROQ_API_KEY` | Transcription, for word-timed captions |
| `APP_PASSWORD` | Gates the whole app. **Unset means no gate at all** |

### Hosting the media

This is the part that is not obvious. Providers **fetch** a reference image from a URL rather
than receiving it in the request, so generated media has to live somewhere they can reach.

Set the four `R2_*` variables for Cloudflare R2 and it works with no bucket configuration —
the app signs temporary links itself. Or point `PUBLIC_HOST_URL` at this install to serve them
directly.

> Providers are picky about that URL, and quietly so. A bare IP over plain `http` is refused
> outright by some and mishandled by others, and a free file host that answers `200` to *you*
> is not the same as one the model can read.

---

## How it is built

Deliberately small. No bundler, no framework, no database.

```
routes/     one file per API area; ffmpeg.js is the renderer
lib/        helpers.js (generation), config.js (paths), prompts.js
public/     the pages; js/<page>/ holds that page's modules
data/       JSON state — this is the user's work
uploads/    generated media
```

State is plain JSON on disk: `merge-v3.json` holds every timeline, `scen3-*.json` the
scenarios, `characters.json` the cast. Readable and editable by hand on purpose — when
something goes wrong the state is right there.

**Express + vanilla ES modules + canvas + ffmpeg.** Roughly 73,000 lines across 184 files,
719 commits since April 2026, and nine runtime dependencies.

---

## Import / Export

Everything in an install can be lifted out and dropped into another: scenarios, characters, 4K
sheets, thumbnails, voices, projects with every overlay, and the media they point at.

**Library → settings → ⚙.** Choose by group; each shows its size and file count. Selecting
projects pulls the media library in automatically, because a project stores the *path* of a
picture, never the picture.

The archive is built to a file rather than streamed — which is what makes a dropped download
**resumable** instead of restarting a multi-gigabyte transfer. Import is **additive**: nothing
already present is touched, and re-importing the same archive twice changes nothing.

---

## Honest notes

**It spends money.** Every generation is a paid API call. There is no sandbox mode and no
confirmation before a render — a reasonable trade for a tool used all day by the person who
owns the accounts, and a sharp edge for anyone else.

**The gate is one shared password**, not user accounts. It exists because the app holds live
keys, not because it expects a crowd.

**Renders are CPU-bound.** A couple of minutes for a finished sixty-second ad is normal.

---

## Status

Actively used and actively changed, shaped around one workflow. `master` is what is running.
Issues and questions welcome; feature requests may not fit the shape of it.

No licence is attached yet, which under GitHub's terms means **all rights reserved** — you may
view the code, but not reuse it. That will change if and when a licence is chosen.
