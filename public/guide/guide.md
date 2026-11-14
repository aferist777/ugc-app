# UGC Studio - the guide (draft)

This is the draft of the app's guide. The Assistant's Help mode answers by it. The full illustrated book will replace it
chapter by chapter.

## What UGC Studio is

UGC Studio is a desktop app for making UGC ads and short vertical videos (TikTok, Shorts, Reels) on your own computer.
Everything it makes lies in its library - a folder on this computer. It talks to AI services with your own keys: kie.ai
and Replicate (pictures, video, music, the agents), ElevenLabs (voices, music, sound effects), Anthropic (Claude),
Groq (hearing speech), Cloudflare (a bucket the models fetch reference pictures from), Pixabay (free stock).

What you can make:
- a **talking head** - a character speaks your script in a place, line by line;
- a **voiceover** - your script read in a voice, with stock B-roll found for every sentence;
- **highlights** - a long video (a podcast, a stream, a lecture) cut into vertical shorts with captions and music;
- anything on a **blank** timeline - clips, pictures, music, captions, effects - rendered to a video.

## The top strip

Every page has the same strip at the top:
- **Home** - the start page.
- **Merge** - the editor: projects and their timelines.
- **3D Studio** - blurred: it is still being built.
- **Library** - everything the app keeps: characters, media, voices, scenarios, renders.
- **Assistant** - this chat: **Ideas** for brainstorming, **Help** for questions about the app.
- On the right: **Queue** (the render queue), the wait, **Alerts** (everything being generated), **Admin** (keys and
  settings), and in the app window its own buttons: minimise, into a window, quit.

Every window over a page darkens the page behind it. **Escape** closes the topmost window. A window with a head can be
moved by its head and stretched by its edges; a double press on the head puts it back to its own size.

## Home

Home is made of blocks you can drag anywhere ("Reset layout" puts them back):
- **New project** - quick starts: **Blank** (a name and a format), **Highlights** (a long video into shorts),
  **Talking head** (a script and who speaks it), **Voiceover** (a text, a mood, a voice). The press makes the project and
  opens it in Merge.
- **Generate** - **Pictures**, **Video**, **Music & sounds**: the generators' windows open over Home; what they make
  goes into the Library.
- **Library** - **Character**, **Prop**, **Look**, **Environment**: making the things your videos are built from.
- **Projects** - the projects you changed last, by kind.
- **First steps** - what is left to set up (keys, the first character, the speech model).
- **The app** - your keys and balances, the Telegram bot.

## Admin

- **API keys** - paste each service's key; the app checks it and says whether it works. The Cloudflare key is one key,
  checked step by step. The Telegram bot is connected here too.
- **AI settings** - the agents' ladder: which models write prompts, read pictures and answer, in order. If the first
  does not answer, the next one is asked.
- **This computer** - whisper (hearing speech on this computer, free) and yt-dlp (downloading videos by a link).
- **Thanks** - the free software the app is made with.

## Alerts and the Queue

**Alerts** lists every paid generation - pictures, clips, music, sounds, characters, environments, lookbooks - while it
is made and after. A row says its stage and how long is left; a finished row opens the place the result went; a failed
row has **retry**. Generations run on the app's side: you can leave the page, the result is still filed.
Errors show as popups in the top-right corner.

**Queue** lists the renders waiting: open one, **Continue**, **Stop** or **Clear**.

## The Library

The Library has shelves on the left: **Characters**, **Media**, **Voices**, **Scenarios**, **Renders**.

### Media - the media tree

**Media** opens on its roots: **REFERENCES**, **IMAGES**, **VIDEO**, **AUDIO**.
- **REFERENCES** - what your Telegram bot brought in (links and media from your phone), and YouTube videos downloaded as
  sources.
- **IMAGES** - **Environments** and **Lookbooks** (what their generators made), **Props** (your products), **Generated**,
  **Screenshots**, **Stock**, and your own folders.
- **VIDEO** - **Generated** (a folder per video model, and Talking heads), **Hooks**, **Uploads** (your files, Stock).
- **AUDIO** - **Music** (with **highlights** moods and **Lyrics**), **SFX** (Favorites, Built-in, My sounds).

How the tree works:
- A press on a root opens it; deeper, a press selects a folder and a double press opens it.
- **generate** (gold) beside IMAGES, VIDEO and AUDIO opens that generator's window. **create** beside Environments,
  Lookbooks and Props opens their makers.
- **New folder**: the "+" of a kind, or the right button on a folder or the gallery's empty space. Folders go inside
  folders; drag a folder onto another to move it. A few folders are locked (Generated, Screenshots and the references of
  Environments and Lookbooks) - they are filled by the app.
- Tiles: Ctrl and Shift pick several, a band picks a group, **Delete** deletes, drag them onto a folder to move them,
  or use the right button: **Move to…**, ★, **Delete**. The right button on one picture also offers **Animate** or
  **Change** (a chat with it); on a clip **Continue** or **As a reference**.
- A press on a tile opens it large. Under a video: **Cut** pieces out of it (the bar of fragments, **Scenes**, **Save…**),
  and the right button: **Save audio**, **Save video as…**.
- Music plays in the player under the gallery; **Cut…** on a track or a sound cuts a piece of it into a new file.

### Characters

**New Character** makes a character: a portrait from your description (or a photo), then a 4K sheet of the character -
the reference every frame of a talking head keeps. A character can have several **looks** (outfits), dressed from a
lookbook. Its voices are ElevenLabs voices.

### Scenarios

Scripts for talking heads and voiceovers. **New scenario** is a menu: **blank** (write it yourself) or **narrator**
(the generator: hooks of forty types, a script in a narrator's voice, rewrites). A source - a YouTube video or a file -
gives the generator topics. Scenarios no longer needed go into the **Archive** at the bottom of the list (right button:
Archive / Restore).

### Renders

Every finished render, by project. The right button on a render, or its viewer, offers **Show in folder** - Explorer
on its folder with the file picked.

## Merge - the editor

Merge is one editor: the project picker and the project bar on top, the preview on the left, the Library panel on the
right, the timeline at the bottom.

### Projects

The project picker lists the draft first, then your projects. **+ new project** offers: **blank** (an empty timeline),
**talking head** (from a scenario), **highlights** (a long video into shorts), **voiceover** (a scenario or your own
text, read in a voice). With no project open you are in **the draft** - always there: **clear** empties it, **save**
names it and a new draft takes its place.

### The timeline

Lanes, top to bottom: video lanes, **main video**, **main audio**, other sound lanes, **Subtitles** and text lanes.
- Drag a file from the Library panel (or from Explorer) onto a lane. A lane takes only its own media; letting go above
  the top lane or below the bottom one makes a new lane.
- The playhead moves only by the **ruler**. A press and sweep on the lanes draws a stretch; Shift + a click picks clips
  one by one.
- **Delete** over a drawn stretch cuts it out of every lane and moves the rest left.
- **Cut silence** (the button right of ⏩, or the key **S**): first draw a stretch over a wave or pick clips - with
  nothing drawn or picked the button only asks you to. The pauses of main audio inside the stretch or the picked clips
  are shortened to the length you set, on every lane at once, in one undo step. "Silent below" is the loudness counted
  as silence (auto by default).
- Several clips in a row picked: **Merge N clips into one?**
- **Ctrl+C / Ctrl+V** copy picked clips, also into another timeline. **Ctrl+Z** undoes.
- **Space** plays; with clips picked it plays only them.
- **Alt + wheel** zooms toward the playhead.

### A clip's settings (the inspector)

Pick a clip and its settings open in groups (one group open at a time):
- **Crop** - cut the frame on the preview: drag a side; Alt + the middle slides the picture inside. On main video a
  cropped clip becomes a picture-in-picture over its own blur.
- **Opacity**, **Color** (brightness, contrast, saturation, gamma), **Blend** mode for clips above main video.
- **Pitch** of a sound: −12 to +12 semitones, the voice's timbre kept or not.
- **Effects**: **+ Effect** opens the effects panel - tiles by group (Hook, graphics, cards, screens, glitches, behind the
  person…); an effect covers the whole clip, **Start / End** set its part. A clip with effects is outlined in violet.
- **Patterns**: on the main video lane's strip, tick patterns to lay over the whole video.

### Captions

The **captions** view of the Library panel has tabs **presets**, **animation**, **fonts**, **text**:
- **presets** - styles for the Subtitles lane (Shift mixes several);
- **animation** - how pages come in and go out;
- **fonts** - one font or several dealt over the pages;
- **text** - all lines as one document to correct.
Captions are heard by Groq, or by whisper on this computer when there is no Groq key (Admin → This computer). Drag a
caption on the preview to move it; **Rows: one / two** draws pages in two rows. TikTok / Shorts / Instagram screens over
the preview show what the platform's buttons cover.

### Rendering

**Export** (gold, on the project bar) opens the render window: format, quality, then **Render** (now) or
**Add to queue** (later, from **Queue**). The video goes into the project's renders folder (Library → **Renders**), with
an .srt of the subtitles beside it when the project has them.

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

## The Telegram bot

Admin → API keys: give the bot's key and pair it with the code. Send it links and media from your phone - they arrive in
**REFERENCES** (a post is one tile). With the Cloudflare key working, messages wait for you while the app is closed.

## The Assistant

The **Assistant** button (right of Library) opens this chat on any page but the 3D Studio's.
- **Ideas** - brainstorm videos, hooks, scripts and music; ask for prompts - each prompt comes in its own block with
  **copy** and the generator it is for. **+** beside the field attaches a character's look, a product of Props or a
  scenario (the model reads them as words).
- **Help** - ask how to do something in the app.
- The **Model** list chooses who answers; a chat keeps its model. Each chat shows what it cost.
- Enter sends, Shift+Enter makes a new line; **Stop** ends an answer. A double press on a chat's name renames it; its ✕
  pressed twice deletes it.

## Where things are on disk

The library folder holds `projects/` (each project's files and timelines), `media/` (everything made or brought in, by
kind), `data/` (the app's lists), `cache/` (made again when missing), `backups/` and `logs/`. Renders are in
`media/renders/<project>/` - Library → **Renders**, the right button on a render → **Show in folder** opens them.
