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

## Everything UGC Studio uses (179)

### 3D Studio

- **Kenney Furniture Kit** - CC0 - https://kenney.nl/assets/furniture-kit
- **Mesh2Motion** - MIT code · CC0 models and motions - https://github.com/Mesh2Motion/mesh2motion-app
- **Quaternius** - CC0 - https://quaternius.com
- **three.js** (npm `three`) - MIT - https://github.com/mrdoob/three.js

### App and server

- **Anthropic TypeScript SDK** (npm `@anthropic-ai/sdk`) - MIT - https://github.com/anthropics/anthropic-sdk-typescript
- **Axios** (npm `axios`) - MIT - https://github.com/axios/axios
- **Busboy** - MIT - https://github.com/mscdex/busboy
- **dotenv** (npm `dotenv`) - BSD-2-Clause - https://github.com/motdotla/dotenv
- **Express** (npm `express`) - MIT - https://github.com/expressjs/express
- **Multer** (npm `multer`) - MIT - https://github.com/expressjs/multer
- **node-archiver** (npm `archiver`) - MIT - https://github.com/archiverjs/node-archiver
- **node-unzipper** (npm `unzipper`) - MIT - https://github.com/ZJONSSON/node-unzipper
- **Node.js** - MIT - https://github.com/nodejs/node
- **V8** - BSD-3-Clause - https://chromium.googlesource.com/v8/v8

### Caption presets

- **Capite** - MIT - https://github.com/muneebkhan08/Capite
- **CapShorts** - MIT - https://github.com/thealiraza2/CapShorts
- **Simple Icons** - CC0-1.0 - https://github.com/simple-icons/simple-icons

### Captions

- **abslink** - Apache-2.0 - https://github.com/ThaUnknown/abslink
- **FreeType** - FTL OR GPL-2.0-or-later - https://gitlab.freedesktop.org/freetype/freetype
- **GNU FriBidi** - LGPL-2.1-or-later - https://github.com/fribidi/fribidi
- **HarfBuzz** - MIT (the 'Old MIT' text, MIT-Modern-Variant) - https://github.com/harfbuzz/harfbuzz
- **JASSUB** - MIT; the package with its wasm: LGPL-2.1-or-later AND (FTL OR GPL-2.0-or-later) AND MIT AND MIT-Modern-Variant AND ISC AND NTP AND Zlib AND BSL-1.0 - https://github.com/ThaUnknown/jassub
- **JavascriptSubtitlesOctopus** - MIT - https://github.com/libass/JavascriptSubtitlesOctopus
- **lfa-ponyfill** - MIT - https://github.com/ThaUnknown/lfa-ponyfill
- **libass** - ISC - https://github.com/libass/libass

### Desktop

- **Chromium** - BSD-3-Clause - https://chromium.googlesource.com/chromium/src
- **Electron** (npm `electron`) - MIT - https://github.com/electron/electron

### Fonts

- **Amatic SC** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/amaticsc
- **Anton** - OFL-1.1 - https://github.com/googlefonts/AntonFont
- **Audiowide** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/audiowide
- **Bagel Fat One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/bagelfatone
- **Bangers** - OFL-1.1 - https://github.com/googlefonts/bangers
- **Bebas Neue** - OFL-1.1 - https://github.com/dharmatype/Bebas-Neue
- **Big Shoulders Display** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/bigshouldersdisplay
- **Big Shoulders Stencil** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/bigshouldersstencil
- **Black Ops One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/blackopsone
- **Bungee** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/bungee
- **Butcherman** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/butcherman
- **Caveat** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/caveat
- **Cherry Bomb One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/cherrybombone
- **Chewy** - Apache-2.0 - https://github.com/google/fonts/tree/main/apache/chewy
- **Climate Crisis** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/climatecrisis
- **Coiny** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/coiny
- **Comforter Brush** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/comforterbrush
- **Creepster** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/creepster
- **Dela Gothic One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/delagothicone
- **DotGothic16** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/dotgothic16
- **Eater** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/eater
- **Emblema One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/emblemaone
- **Ewert** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/ewert
- **Exo 2** - OFL-1.1 - https://github.com/googlefonts/Exo-2.0
- **Faster One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/fasterone
- **Finger Paint** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/fingerpaint
- **Fira Sans Extra Condensed** - OFL-1.1 - https://github.com/googlefonts/FiraGFVersion
- **Fruktur** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/fruktur
- **Grenze Gotisch** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/grenzegotisch
- **Hachi Maru Pop** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/hachimarupop
- **Inter** - OFL-1.1 - https://github.com/rsms/inter
- **Jacquarda Bastarda 9** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/jacquardabastarda9
- **JetBrains Mono** - OFL-1.1 - https://github.com/JetBrains/JetBrainsMono
- **Kablammo** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/kablammo
- **Kaushan Script** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/kaushanscript
- **Knewave** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/knewave
- **Lacquer** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/lacquer
- **Liberation Sans** - OFL-1.1 - https://github.com/liberationfonts/liberation-fonts
- **Lobster** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/lobster
- **Londrina Solid** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/londrinasolid
- **Luckiest Guy** - Apache-2.0 - https://github.com/google/fonts/tree/main/apache/luckiestguy
- **Marck Script** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/marckscript
- **Metal Mania** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/metalmania
- **Modak** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/modak
- **Monoton** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/monoton
- **Montserrat** - OFL-1.1 - https://github.com/JulietaUla/Montserrat
- **Neucha** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/neucha
- **New Rocker** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/newrocker
- **Nosifer** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/nosifer
- **Orbitron** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/orbitron
- **Oswald** - OFL-1.1 - https://github.com/googlefonts/OswaldFont
- **Permanent Marker** - Apache-2.0 - https://github.com/google/fonts/tree/main/apache/permanentmarker
- **Pirata One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/pirataone
- **Pixelify Sans** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/pixelifysans
- **Press Start 2P** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/pressstart2p
- **PT Sans** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/ptsans
- **PT Serif** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/ptserif
- **Rampart One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rampartone
- **Reggae One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/reggaeone
- **Rubik** - OFL-1.1 - https://github.com/googlefonts/rubik
- **Rubik 80s Fade** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubik80sfade
- **Rubik Beastly** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikbeastly
- **Rubik Bubbles** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikbubbles
- **Rubik Burned** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikburned
- **Rubik Dirt** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikdirt
- **Rubik Doodle Shadow** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikdoodleshadow
- **Rubik Glitch** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikglitch
- **Rubik Marker Hatch** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikmarkerhatch
- **Rubik Mono One** - OFL-1.1 - https://github.com/alexeiva/rubikmonoone
- **Rubik Moonrocks** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikmoonrocks
- **Rubik Pixels** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikpixels
- **Rubik Scribble** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikscribble
- **Rubik Spray Paint** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikspraypaint
- **Rubik Vinyl** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikvinyl
- **Rubik Wet Paint** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rubikwetpaint
- **Ruslan Display** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/ruslandisplay
- **Russo One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/russoone
- **Rye** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/rye
- **Sedgwick Ave Display** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/sedgwickavedisplay
- **Seymour One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/seymourone
- **Shantell Sans** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/shantellsans
- **Sigmar One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/sigmarone
- **Six Caps** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/sixcaps
- **Smokum** - Apache-2.0 - https://github.com/google/fonts/tree/main/apache/smokum
- **Sofia Sans Extra Condensed** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/sofiasansextracondensed
- **Special Elite** - Apache-2.0 - https://github.com/google/fonts/tree/main/apache/specialelite
- **Splash** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/splash
- **Stalinist One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/stalinistone
- **Tektur** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/tektur
- **Tiny5** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/tiny5
- **Train One** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/trainone
- **Ultra** - Apache-2.0 - https://github.com/google/fonts/tree/main/apache/ultra
- **Unbounded** - OFL-1.1 - https://github.com/googlefonts/unbounded
- **Underdog** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/underdog
- **UnifrakturMaguntia** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/unifrakturmaguntia
- **Wallpoet** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/wallpoet
- **Yanone Kaffeesatz** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/yanonekaffeesatz
- **Yuji Boku** - OFL-1.1 - https://github.com/google/fonts/tree/main/ofl/yujiboku

### Ideas and rules we follow

- **AI-Youtube-Shorts-Generator** - MIT - https://github.com/Anil-matcha/AI-Youtube-Shorts-Generator
- **remotion-captions-kit** - MIT - https://github.com/Fats403/remotion-captions-kit
- **stable-ts** - MIT - https://github.com/jianfch/stable-ts
- **Subtitle Edit** - MIT - https://github.com/SubtitleEdit/subtitleedit

### Interface

- **Lucide** - ISC - https://github.com/lucide-icons/lucide

### Patterns

- **ambientCG** - CC0 - https://ambientcg.com
- **Flickr (patterns)** - CC0 (each photo we took) - https://www.flickr.com
- **Hero Patterns** - CC BY 4.0 - https://heropatterns.com/
- **Wikimedia Commons (patterns)** - CC0 (each file we took) - https://commons.wikimedia.org

### Pictures and video

- **AOM (libaom)** - BSD-2-Clause (with the AOMedia Patent License 1.0) - https://aomedia.googlesource.com/aom
- **BlazeFace** - Apache-2.0 - https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector
- **EfficientDet-Lite0** - Apache-2.0 - https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector
- **Face Landmarker** - Apache-2.0 - https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker
- **libheif** - LGPL-3.0-or-later - https://github.com/strukturag/libheif
- **libspng** - BSD-2-Clause (parts under the libpng License) - https://github.com/randy408/libspng
- **libtiff** - libtiff - https://gitlab.com/libtiff/libtiff
- **libvips** - LGPL-2.1-or-later - https://github.com/libvips/libvips
- **libwebp** - BSD-3-Clause - https://chromium.googlesource.com/webm/libwebp
- **MediaPipe** - Apache-2.0 - https://github.com/google-ai-edge/mediapipe
- **mozjpeg** - IJG AND BSD-3-Clause AND Zlib - https://github.com/mozilla/mozjpeg
- **Selfie Segmenter** - Apache-2.0 - https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter
- **sharp** (npm `sharp`) - Apache-2.0 - https://github.com/lovell/sharp
- **video-effects-pack** - MIT - https://github.com/neurolena1/video-effects-pack
- **Z-Image** - Apache-2.0 - https://github.com/Tongyi-MAI/Z-Image

### Sound effects

- **Freesound** - CC0 (each sound we took) - https://freesound.org
- **Kenney audio packs** - CC0 - https://kenney.nl/assets/category:Audio
- **Openverse** - API terms of use · MIT code - https://openverse.org

### Speech

- **form-data** (npm `form-data`) - MIT - https://github.com/form-data/form-data
- **ggml** - MIT - https://github.com/ggml-org/ggml
- **insanely-fast-whisper** - Apache-2.0 - https://github.com/Vaibhavs10/insanely-fast-whisper
- **OpenAI Whisper** - MIT - https://github.com/openai/whisper
- **OpenBLAS** - BSD-3-Clause - https://github.com/OpenMathLib/OpenBLAS
- **Whisper models for whisper.cpp** - MIT - https://huggingface.co/ggerganov/whisper.cpp
- **whisper.cpp** - MIT - https://github.com/ggml-org/whisper.cpp

### Text presets

- **Animista** - BSD-2-Clause - https://animista.net
- **FFCreator** - MIT - https://github.com/tnfe/FFCreator
- **lyger Aegisub automation scripts** - MIT - https://github.com/lyger/Aegisub_automation_scripts
- **Magic UI** - MIT - https://github.com/magicuidesign/magicui
- **Remocn** - MIT - https://github.com/Remocn/remocn
- **RVE remotion-templates** - MIT per its README - no license file, so ideas only - https://github.com/reactvideoeditor/remotion-templates

### Tools and build

- **ESLint** (npm `eslint`) - MIT - https://github.com/eslint/eslint
- **globals** (npm `globals`) - MIT - https://github.com/sindresorhus/globals

### Video almanac

- **AI Camera Movements** - a free reference - no license stated · prompts and previews © their author - https://aicameramovements.com

### Video and audio tools

- **CPython** - PSF-2.0 - https://github.com/python/cpython
- **FFmpeg** - GPL-3.0-or-later (our build; FFmpeg's own code is LGPL-2.1-or-later) - https://github.com/FFmpeg/FFmpeg
- **ffmpeg-static** (npm `ffmpeg-static`) - GPL-3.0-or-later - https://github.com/eugeneware/ffmpeg-static
- **LAME** - LGPL-2.0-or-later - https://sourceforge.net/p/lame/svn/HEAD/tree/
- **libvpx** - BSD-3-Clause - https://chromium.googlesource.com/webm/libvpx
- **NVENC (nv-codec-headers)** - MIT (the headers in our FFmpeg build; the encoder itself is NVIDIA's driver) - https://github.com/FFmpeg/nv-codec-headers
- **Opus (libopus)** - BSD-3-Clause - https://github.com/xiph/opus
- **Rubber Band Library** - GPL-2.0-or-later - https://github.com/breakfastquay/rubberband
- **x264** - GPL-2.0-or-later - https://code.videolan.org/videolan/x264
- **yt-dlp** - Unlicense; the Windows program we ship: GPL-3.0-or-later (it bundles GPL code) - https://github.com/yt-dlp/yt-dlp
- **yt-dlp EJS** - Unlicense - https://github.com/yt-dlp/ejs

## Taken into our own files

### Capite

The other 27 of our 127 caption presets were converted from its styles in the same way, leaving its shadow and karaoke bugs behind (public/js/captions/presets.js).

https://github.com/muneebkhan08/Capite

```
MIT License

Copyright (c) 2026 Capite Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### CapShorts

100 of our 127 caption presets were converted from its templates. Their bugs were left behind, the fonts were swapped for shipped ones with Cyrillic, and the Urdu ones were left out (public/js/captions/presets.js). Our caption transcription also follows its setup: Groq whisper-large-v3 first, and Whisper on this computer when Groq cannot be reached (lib/captions-job.js).

https://github.com/thealiraza2/CapShorts

```
MIT License

Copyright (c) 2026 Ali Raza

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### video-effects-pack

Its timings, curves, measured camera paths and the look of its scenes are written again in JavaScript for Merge's clip effects - Quick zoom, Drop in, Heartbeat, Vignette, Sparkle, Color frame, Digital zoom, Orbit, Paper cutout and the rest - so the preview and the render draw them by one rule (public/js/fx/, lib/fx-render.js). None of its code or Python runs in the app.

https://github.com/neurolena1/video-effects-pack

```
MIT License

Copyright (c) 2026 NeuroLena

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

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
