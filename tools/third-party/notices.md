# Third-party notices

UGC Studio is Copyright (C) 2026 aferist777 and free software under the GNU Affero General Public License, version 3 or
(at your option) any later version - see [LICENSE](LICENSE).

It is built on the work of others. This file says what each of them is, under which license, where its license text
is, and - for the programs under the GPL or LGPL that a build of UGC Studio carries - where their source code is. The
same list, with what each one does in the app, is in the app on **Admin → Thanks**.

*Made by `node tools/third-party.js` from `public/js/admin-thanks.js` and `tools/third-party/` - edit those, not this file.*

## Where the license texts are

| What | Its license text |
|---|---|
| npm packages - Express, sharp, Electron, three.js and the rest, with what they carry | in each package's folder, `node_modules/<name>/`; in a build, `resources/app/node_modules/<name>/` |
| FFmpeg (through ffmpeg-static) | `node_modules/ffmpeg-static/ffmpeg.exe.LICENSE` (GPL-3.0) and `ffmpeg.exe.README` (the build's configuration) |
| libvips and its libraries, inside sharp | `node_modules/@img/sharp-win32-x64/`, [licenses/LGPL-3.0.txt](licenses/LGPL-3.0.txt), [licenses/LGPL-2.1.txt](licenses/LGPL-2.1.txt) |
| yt-dlp | [licenses/GPL-3.0.txt](licenses/GPL-3.0.txt) |
| JASSUB, libass and what they carry | `vendor/jassub/LICENSE`, `vendor/jassub/LICENSES.txt` |
| whisper.cpp | `vendor/whisper/LICENSE.txt` |
| MediaPipe and its models | `vendor/mediapipe/LICENSES.txt`, [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt) |
| The 3D Studio's figures, motions and furniture | `vendor/3d/` |
| The caption fonts | `public/fonts/captions/licenses/` - each family's own |
| The interface fonts, Inter and JetBrains Mono | `public/fonts/ui/OFL-Inter.txt`, `public/fonts/ui/OFL-JetBrainsMono.txt` |
| Lucide's icons | `public/icons/LICENSE-lucide.txt` |
| The built-in sounds | `vendor/sfx/LICENSE.txt`; each sound's author and page in `vendor/sfx/sfx.json` |
| The built-in patterns | `vendor/patterns/LICENSE.txt` |
| What is taken into this repository's own files | [below](#taken-into-our-own-files) |

`vendor/` is laid out by `npm install` (`tools/fetch-*.js`, each pinned by version and checksum); a build carries it whole.

## Programs under the GPL or LGPL in a build, and their source

- **FFmpeg 6.1.1** - the Windows "essentials" build by gyan.dev, with x264, LAME, Rubber Band, libass, FreeType,
  HarfBuzz, FriBidi, libopus, libvpx and the other libraries its configuration names - is GPL-3.0-or-later as built.
  Source: FFmpeg's commit [e38092ef93](https://github.com/FFmpeg/FFmpeg/commit/e38092ef93); the build and the versions
  of its libraries: [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) and `node_modules/ffmpeg-static/ffmpeg.exe.README`.
- **yt-dlp 2026.10.10.233141** (nightly), `vendor/yt-dlp/yt-dlp.exe`: yt-dlp itself is under the Unlicense; the
  Windows program bundles GPL-3.0-or-later code (and CPython, PSF-2.0), so the program is GPL-3.0-or-later. Source:
  [its release](https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/tag/2026.10.10.233141) and
  [yt-dlp](https://github.com/yt-dlp/yt-dlp).
- **libvips 8.17.3**, inside sharp 0.34.5, with libheif and the other libraries
  `node_modules/@img/sharp-win32-x64/versions.json` lists - LGPL. Source:
  [libvips v8.17.3](https://github.com/libvips/libvips/releases/tag/v8.17.3); how the prebuilt libraries are made:
  [sharp-libvips](https://github.com/lovell/sharp-libvips).
- **JASSUB 2.5.16** - libass compiled to WebAssembly, with FreeType, HarfBuzz and FriBidi - MIT, with LGPL-2.1-or-later
  parts. Source: [JASSUB](https://github.com/ThaUnknown/jassub) and the libraries `vendor/jassub/LICENSES.txt` names.

UGC Studio does not change any of them; it runs them as they are.

## Everything UGC Studio uses ({{COUNT}})

{{LIST}}

## Taken into our own files

{{COPIED}}

### Hero Patterns

14 of the built-in patterns are [Hero Patterns](https://heropatterns.com/) by Steve Schoger, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) - coloured white and laid as larger seamless tiles by us.
The other patterns' authors and licenses are in `vendor/patterns/LICENSE.txt`.

### Simple Icons

The TikTok, YouTube Shorts and Instagram marks of Merge's preview are from [Simple Icons](https://github.com/simple-icons/simple-icons)
(CC0-1.0). The marks themselves are their owners' trademarks; they are shown only to say which platform's screen is
laid over the frame.

### AI Camera Movements

The video chat's almanac of camera moves - their names, categories, prompts and small looping examples - is from
[AI Camera Movements](https://aicameramovements.com), a free reference that states no license; the prompts and the
previews are their author's. Credited here, in the app and in the almanac; any of them is removed at its author's
request.
