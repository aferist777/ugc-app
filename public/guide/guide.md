# UGC Studio - the guide (draft)

This is the draft of the app's guide - the part not yet written as chapters of the book. Getting started (1), Around the app (2),
The Library (3) and Merge (4) have their own chapters. The Assistant's Help mode answers by the chapters and by this draft.

## Talking head

A character speaks your script in a place. It starts in **setup**:
1. **who** and **where** - pick a character's look and an environment (each opens a window; "+ new look", "+ new
   environment" make new ones). Until both are chosen the rest waits.
2. **mood & voice** - pick the voice (a menu: the character's voices, saved voices, the ElevenLabs library…) and
   press **generate**: the script is marked up for the mood and read line by line.
3. **frames** - the frames of the person in the place; **frames chat** makes more (close-up, medium, wide, with your
   products of Props).
4. **video** - **kling avatar** or **omnihuman 2.0** makes one clip per line from its frame and its read.
Each finished clip lands on the timeline in order. A line is never deleted, only taken off. Changing the character puts
the work aside in the project - casting the old one again brings it back.

## Voiceover

Your script read in a voice, with B-roll:
1. In setup pick the script (a scenario or **+ your text**), then **mood & voice** - the voice reads it.
2. **find B-roll** - the app finds stock videos and pictures (Pixabay) for every sentence and lays them under the words.
3. Press a B-roll piece on main video to see its sentence, its search words and other choices - a press swaps it.

## Highlights

A long video into vertical shorts:
1. **+ new project → highlights** (or Home → Highlights). The window has two steps: the video (a link, a file of this
   computer or a video of the Library) and the kind (auto, podcast · interview, true crime · bodycam, documentary,
   lecture, fragmentation), the length and how many; then the music moods and the captions' style.
2. The app hears the words, an agent finds the moments, and each becomes a 9:16 fragment with captions, its frame
   following the faces (or the speaker).
3. Tick fragments to change their settings together (Subtitles, Main video, Main audio, Music · for all N) and
   **Render N** to render them all.
A file of this computer is not copied into the library - it is read where it lies.

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
