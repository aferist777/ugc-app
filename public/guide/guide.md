# UGC Studio - the guide (draft)

This is the draft of the app's guide - the part not yet written as chapters of the book. Getting started (1), Around the app (2),
The Library (3), Merge (4), Talking head (5), Voiceover (6) and Highlights (7) have their own chapters. The Assistant's Help mode answers by the chapters and by this draft.

## The generators

### Pictures chat

**IMAGES → generate** (or Home → Pictures). Write what you want; the analyst writes the model's prompt. Pick the model
(nano-banana-2, gpt-image-2.5, seedream-4.5, grok-imagine…) and the shape. **+** in the zone attaches pictures:
characters and looks, IMAGES, REFERENCES. Results go into **IMAGES → Generated**; drag one onto a lane.

### Video chat

**VIDEO → generate** (or Home → Video). Models: Grok, Seedance 2.0 mini / 2.0 / 2.5, Kling motion control. With the
writer on, a message stops for a look at the prompt before any money is spent; with it off, a send is one press.
Attach pictures, clips and sounds in the zone. Results go into **VIDEO → Generated → <model>**.

### Sound window

**AUDIO → generate** (or Home → Music & sounds). **MUSIC**: Simple (background music from a mood), Custom (title,
style, lyrics), Lyrics, From a description, Video to Music. **SOUNDS**: Sounds, Sound effects. Music goes into
**Music**, sounds into **SFX → My sounds → Generated**.

### Environments, lookbooks, props

**create** beside Environments / Lookbooks in the tree: a photo and a sentence → a new place or outfit. **Props**:
**New prop** adds a product photo with its name and your words; the app writes its description.

## The Assistant

The **Assistant** button (right of Library) opens this chat on any page but the 3D Studio's.
- **Ideas** - brainstorm videos, hooks, scripts and music; ask for prompts - each prompt comes in its own block with
  **copy** and the generator it is for. **+** beside the field attaches a character's look, a product of Props or a
  scenario (the model reads them as words).
- **Help** - ask how to do something in the app. Help first finds the chapters of this guide that answer, then answers
  by them; **Guide: <chapter › section>** under its answer opens the guide at that place. **Guide** beside "+ New chat"
  (in Help) opens the guide where you stopped reading - chapters on the left, the page with its pictures on the right.
- The **Model** list chooses who answers; a chat keeps its model. Each chat shows what it cost.
- Enter sends, Shift+Enter makes a new line; **Stop** ends an answer. A double press on a chat's name renames it; its ✕
  pressed twice deletes it.

## Where things are on disk

The library folder holds `projects/` (each project's files and timelines), `media/` (everything made or brought in, by
kind), `data/` (the app's lists), `cache/` (made again when missing), `backups/` and `logs/`. Renders are in
`media/renders/<project>/` - Library → **Renders**, the right button on a render → **Show in folder** opens them.
