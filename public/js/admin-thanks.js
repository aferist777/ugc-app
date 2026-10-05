/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN -> THANKS: the open-source work UGC Studio is built on (the owner, 2026-10-03).

   Every repository the app uses - the npm packages, what they carry inside (libvips in sharp, the
   codecs in our FFmpeg build), what is fetched at install (yt-dlp, JASSUB, whisper.cpp) or on demand
   (the Whisper model), the caption fonts and presets, and the projects whose rules our captions follow -
   each with its licence, what it is, and what it does HERE. Checked against the files themselves (the
   packages' package.json and LICENSE, the vendor pins, the font licences) on 2026-10-03.

   A dependency added to package.json without a line here fails the smoke check (tools/smoke-local.js
   reads the `npm` names below) - a new library gets its thanks in the same change.

   Plain data and a renderer; the pane is built once, the first time it shows. ONE LIST, A-Z (phase S5, the
   owner 2026-10-05: every entry in alphabetical order): the case is ignored, so "dotenv" stands among the
   D's, and the group an entry belongs to is a pale tag on its line.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var THANKS = [
    { group: "App and server", name: "Node.js",
      url: "https://github.com/nodejs/node", license: "MIT",
      what: "The JavaScript runtime the app's server is written for.",
      how: "Runs the whole server in the background. In the desktop app it is the Node 24 built into Electron, and it is restarted if it ever stops (desktop/supervisor.js). It also solves YouTube's JavaScript checks for yt-dlp, so links work without installing anything else (lib/ytdlp.js)." },
    { group: "App and server", name: "V8",
      url: "https://chromium.googlesource.com/v8/v8", license: "BSD-3-Clause",
      what: "Google's JavaScript and WebAssembly engine.",
      how: "Runs every line of our JavaScript: the server inside Electron's Node, and the pages inside Chromium. It also runs the WebAssembly libass that draws the captions in Merge's preview." },
    { group: "App and server", name: "Express", npm: "express",
      url: "https://github.com/expressjs/express", license: "MIT",
      what: "A minimal web framework for Node.js.",
      how: "It is the app's local server. It answers every page and every action the pages ask for, and serves the library's pictures, clips and renders to the window (server.js, routes/)." },
    { group: "App and server", name: "Axios", npm: "axios",
      url: "https://github.com/axios/axios", license: "MIT",
      what: "A popular library for making web requests.",
      how: "Nearly every request to a paid service goes through it: kie.ai and Replicate for pictures, video, music and writing, ElevenLabs voices, Groq captions, OpenRouter, and the references uploaded to your Cloudflare R2 bucket. It also downloads the results (lib/helpers.js, lib/groq-stt.js, lib/r2.js). One exception: Replicate's Whisper for Sources uses Node's own fetch (lib/stt-replicate.js)." },
    { group: "App and server", name: "Multer", npm: "multer",
      url: "https://github.com/expressjs/multer", license: "MIT",
      what: "An Express add-on that receives uploaded files.",
      how: "Receives every file you bring in and saves it into the library: photos for the Images shelf and the picture chat, b-roll clips, source videos, narrator samples, the yt-dlp cookies file, and Import archives of up to 32 GB (routes/images.js, routes/data-io.js and four other routes)." },
    { group: "App and server", name: "Busboy",
      url: "https://github.com/mscdex/busboy", license: "MIT",
      what: "A streaming parser for uploaded form data.",
      how: "Works inside Multer. It is the part that reads each upload as it streams in, before Multer saves it to the library." },
    { group: "App and server", name: "node-archiver", npm: "archiver",
      url: "https://github.com/archiverjs/node-archiver", license: "MIT",
      what: "A library that builds zip archives on the fly.",
      how: "Builds the Export on Admin -> Import / Export. It streams data/, projects/ and media/ into zip volumes without compressing them again, because the media is already compressed (routes/data-io.js)." },
    { group: "App and server", name: "node-unzipper", npm: "unzipper",
      url: "https://github.com/ZJONSSON/node-unzipper", license: "MIT",
      what: "A library that reads zip archives.",
      how: "Opens an Import archive so each volume can be unpacked and merged into the library (routes/data-io.js). It also unpacks the whisper.cpp program at install, and the NVIDIA build when it is downloaded from Admin (tools/fetch-whisper.js, lib/whisper-local.js)." },
    { group: "App and server", name: "dotenv", npm: "dotenv",
      url: "https://github.com/motdotla/dotenv", license: "BSD-2-Clause",
      what: "Loads settings from a .env file.",
      how: "Reads the .env kept inside the library when the app starts (server.js). The migration tool also uses it to carry an old server install's API keys into the library's settings (tools/migrate-library.js)." },
    { group: "Desktop", name: "Electron", npm: "electron",
      url: "https://github.com/electron/electron", license: "MIT",
      what: "A framework for desktop apps that bundles Chromium and Node.js.",
      how: "It is the desktop app itself. It opens the full-screen window, handles keys, the right-click menu, links and downloads, asks before quitting during a render, and keeps the server running behind the window (desktop/main.js, desktop/supervisor.js)." },
    { group: "Desktop", name: "Chromium",
      url: "https://chromium.googlesource.com/chromium/src", license: "BSD-3-Clause",
      what: "The open-source browser engine behind Google Chrome.",
      how: "Comes inside Electron and draws every page of the app. It plays the clips in Merge's preview and runs the WebAssembly libass that draws the captions there." },
    { group: "Video and audio tools", name: "FFmpeg",
      url: "https://github.com/FFmpeg/FFmpeg", license: "GPL-3.0-or-later (our build; FFmpeg's own code is LGPL-2.1-or-later)",
      what: "The standard toolkit for decoding, editing and encoding video and audio.",
      how: "Does all the media work: the final render of a Merge timeline with its burnt-in captions, preview proxies, posters, voice loudness, the sound sent for captions, music crossfades, and yt-dlp's joins (lib/mv3b-render.js, lib/render-finish.js, routes/proxies.js, lib/loudness.js, lib/captions-job.js, routes/music.js, lib/ytdlp.js)." },
    { group: "Video and audio tools", name: "ffmpeg-static", npm: "ffmpeg-static",
      url: "https://github.com/eugeneware/ffmpeg-static", license: "GPL-3.0-or-later",
      what: "An npm package that fetches a ready-made ffmpeg program for Windows.",
      how: "It is how FFmpeg gets into the app. npm install downloads the 6.1.1 build, and every ffmpeg run the app starts uses the path it gives (require('ffmpeg-static') in 18 files)." },
    { group: "Video and audio tools", name: "x264",
      url: "https://code.videolan.org/videolan/x264", license: "GPL-2.0-or-later",
      what: "The best-known free H.264 video encoder.",
      how: "Inside FFmpeg it encodes the picture of every MP4 the app writes: renders, preview proxies, and uploaded clips that need re-encoding (lib/render-finish.js, routes/proxies.js, routes/library.js)." },
    { group: "Video and audio tools", name: "LAME",
      url: "https://sourceforge.net/p/lame/svn/HEAD/tree/", license: "LGPL-2.0-or-later",
      what: "The classic free MP3 encoder.",
      how: "Inside FFmpeg it writes the MP3 when the two takes Suno returns for a music generation are crossfaded into one track (routes/music.js)." },
    { group: "Video and audio tools", name: "yt-dlp",
      url: "https://github.com/yt-dlp/yt-dlp", license: "Unlicense",
      what: "A command-line downloader for YouTube and many other video sites.",
      how: "Adds a Source from a link in the scenario generator by reading the video's details and downloading it. The pinned 2026.08.19 build ships with the app, and it updates itself into the library's cache when YouTube changes (lib/ytdlp.js, routes/sources.js)." },
    { group: "Video and audio tools", name: "yt-dlp EJS",
      url: "https://github.com/yt-dlp/ejs", license: "Unlicense",
      what: "yt-dlp's scripts that solve YouTube's JavaScript challenges.",
      how: "Built into the shipped yt-dlp. The app points it at its own Node, so YouTube links work without installing Deno or anything else (lib/ytdlp.js)." },
    { group: "Video and audio tools", name: "CPython",
      url: "https://github.com/python/cpython", license: "PSF-2.0",
      what: "The reference Python interpreter.",
      how: "yt-dlp is a Python program. The yt-dlp.exe we ship carries its own Python 3.10.11, so links work on a computer that has never had Python installed (vendor/yt-dlp/)." },
    { group: "Pictures and video", name: "sharp", npm: "sharp",
      url: "https://github.com/lovell/sharp", license: "Apache-2.0",
      what: "A fast Node.js library for resizing, converting and cropping images.",
      how: "Makes every thumbnail and poster size in the app. It turns engine PNGs and AVIF, GIF or TIFF photos into JPEGs, squeezes a JPEG under 9 MB before upload, and cuts a reframed first frame (lib/thumbs.js, lib/helpers.js, routes/makechat.js, routes/scen3.js)." },
    { group: "Pictures and video", name: "libvips",
      url: "https://github.com/libvips/libvips", license: "LGPL-2.1-or-later",
      what: "The image-processing library that does the actual work inside sharp.",
      how: "Decodes, resizes, crops and encodes every picture behind the sharp features above. Its operation cache is switched off so Windows can overwrite a thumbnail in place (server.js)." },
    { group: "Pictures and video", name: "mozjpeg",
      url: "https://github.com/mozilla/mozjpeg", license: "IJG AND BSD-3-Clause AND Zlib",
      what: "Mozilla's improved JPEG encoder.",
      how: "Inside sharp it reads JPEGs and writes every JPEG that sharp makes: thumbnails, posters, converted photos and engine PNGs, and cropped first frames." },
    { group: "Pictures and video", name: "libwebp",
      url: "https://chromium.googlesource.com/webm/libwebp", license: "BSD-3-Clause",
      what: "Google's library for WebP images.",
      how: "Inside FFmpeg it encodes the animated tiles of the caption presets in the Library panel's captions view (lib/caption-tiles.js). Inside sharp it reads WebP pictures and writes the thumbnails of pictures with transparency (lib/thumbs.js)." },
    { group: "Pictures and video", name: "libspng",
      url: "https://github.com/randy408/libspng", license: "BSD-2-Clause (parts under the libpng License)",
      what: "A simple, fast PNG decoding library.",
      how: "Inside sharp it reads PNGs: the engines' PNG answers that are turned into JPEGs (trueJpeg in lib/helpers.js), and PNG pictures when their thumbnails are made (lib/thumbs.js)." },
    { group: "Pictures and video", name: "libheif",
      url: "https://github.com/strukturag/libheif", license: "LGPL-3.0-or-later",
      what: "A library for HEIF and AVIF image files.",
      how: "Inside sharp it opens AVIF photos brought into the New environment and New lookbook chats so they can be turned into JPEGs. It also recognises a phone's HEIC photo, so the chat can say in words that it cannot read it (routes/makechat.js)." },
    { group: "Pictures and video", name: "AOM (libaom)",
      url: "https://aomedia.googlesource.com/aom", license: "BSD-2-Clause (with the AOMedia Patent License 1.0)",
      what: "The Alliance for Open Media's reference AV1 codec.",
      how: "Inside libheif it decodes the AV1 picture inside an AVIF photo, before sharp turns it into a JPEG (routes/makechat.js)." },
    { group: "Pictures and video", name: "libtiff",
      url: "https://gitlab.com/libtiff/libtiff", license: "libtiff",
      what: "The standard library for reading and writing TIFF images.",
      how: "Inside sharp it opens TIFF photos brought into the New environment and New lookbook chats so they can be turned into JPEGs (routes/makechat.js)." },
    { group: "Pictures and video", name: "Z-Image",
      url: "https://github.com/Tongyi-MAI/Z-Image", license: "Apache-2.0",
      what: "An open text-to-image model from Alibaba's Tongyi Lab; Z-Image-Turbo is its fast version.",
      how: "Draws the portrait in New Character by default. It runs on Replicate as prunaai/z-image-turbo (lib/cv2-ladders.js, lib/img-providers.js)." },
    { group: "Speech", name: "OpenAI Whisper",
      url: "https://github.com/openai/whisper", license: "MIT",
      what: "OpenAI's open speech-recognition model and its reference code.",
      how: "The model behind all three ways the app turns speech into text: captions through Groq, Sources and narrator samples through Replicate, and captions on this computer through whisper.cpp (lib/groq-stt.js, lib/stt-replicate.js, lib/whisper-local.js). We never run its Python code, but our captions follow its thresholds for dropping made-up segments and its rules for word timings (public/js/captions/heard.js, lib/whisper-words.js)." },
    { group: "Speech", name: "whisper.cpp",
      url: "https://github.com/ggml-org/whisper.cpp", license: "MIT",
      what: "A C/C++ port of Whisper that runs on an ordinary computer.",
      how: "Makes captions on this computer when the subtitle lane says 'this computer' or Groq cannot be reached. The processor build ships with the app; the NVIDIA build is downloaded by its button on Admin -> This computer (lib/whisper-local.js, vendor/whisper/)." },
    { group: "Speech", name: "Whisper models for whisper.cpp",
      url: "https://huggingface.co/ggerganov/whisper.cpp", license: "MIT",
      what: "Whisper's weights converted for whisper.cpp, hosted on Hugging Face.",
      how: "The large-v3-turbo q5_0 model (574 MB) is downloaded from here the first time captions are made on this computer, or ahead of time from Admin -> This computer, which can also remove it. It is pinned and checked by SHA-256 (lib/whisper-local.js, public/js/admin-local.js)." },
    { group: "Speech", name: "ggml",
      url: "https://github.com/ggml-org/ggml", license: "MIT",
      what: "The machine-learning library whisper.cpp computes with.",
      how: "Its DLLs run the model inside whisper.cpp and pick the fastest code for your processor at run time. The NVIDIA build adds a CUDA one (vendor/whisper/)." },
    { group: "Speech", name: "OpenBLAS",
      url: "https://github.com/OpenMathLib/OpenBLAS", license: "BSD-3-Clause",
      what: "A fast library for the matrix maths that models need.",
      how: "Ships with the whisper.cpp build we chose. On the owner's laptop processor, that build made captions about 15% faster than the plain one (vendor/whisper/, tools/fetch-whisper.js)." },
    { group: "Speech", name: "insanely-fast-whisper",
      url: "https://github.com/Vaibhavs10/insanely-fast-whisper", license: "Apache-2.0",
      what: "A recipe that runs Whisper large-v3 very fast on a GPU.",
      how: "Replicate's model vaibhavs10/incredibly-fast-whisper is built from it. It transcribes a Source or a narrator sample for topic mining and narrator reading (lib/stt-replicate.js)." },
    { group: "Speech", name: "form-data", npm: "form-data",
      url: "https://github.com/form-data/form-data", license: "MIT",
      what: "Builds multipart form requests for uploading files.",
      how: "Packs each piece of sound, with the model and the language, into the request sent to Groq when captions are made from the sound. It builds the request again for every retry (lib/groq-stt.js)." },
    { group: "Captions", name: "libass",
      url: "https://github.com/libass/libass", license: "ISC",
      what: "The reference renderer for ASS/SSA subtitles.",
      how: "Draws every caption. Inside FFmpeg it burns them into the render, screenshots and preset tiles with our shipped fonts. Inside JASSUB it draws the same .ass file in the preview, so the screen matches the video (lib/mv3b-render.js, lib/caption-shot.js, lib/caption-tiles.js, public/js/captions/layer.js)." },
    { group: "Captions", name: "JASSUB",
      url: "https://github.com/ThaUnknown/jassub", license: "MIT; the package with its wasm: LGPL-2.1-or-later AND (FTL OR GPL-2.0-or-later) AND MIT AND MIT-Modern-Variant AND ISC AND NTP AND Zlib AND BSL-1.0",
      what: "libass compiled to WebAssembly so it can draw subtitles in a web page; a fork of JavascriptSubtitlesOctopus.",
      how: "Draws the captions in Merge's preview with the same libass and the same shipped fonts as the render (public/js/captions/layer.js). Version 2.5.16 is laid out in vendor/jassub/ at install (tools/fetch-jassub.js) and served at /vendor/jassub/ (server.js:88)." },
    { group: "Captions", name: "JavascriptSubtitlesOctopus",
      url: "https://github.com/libass/JavascriptSubtitlesOctopus", license: "MIT",
      what: "The original project that put libass in the browser through WebAssembly.",
      how: "JASSUB grew out of it and still carries its code, so its contributors are named in the licence that ships with the preview's caption renderer (vendor/jassub/LICENSE)." },
    { group: "Captions", name: "FreeType",
      url: "https://gitlab.freedesktop.org/freetype/freetype", license: "FTL OR GPL-2.0-or-later",
      what: "The library that reads font files and draws their letters.",
      how: "Inside libass, in both the render and the preview, it opens our caption fonts and draws every letter of a caption." },
    { group: "Captions", name: "HarfBuzz",
      url: "https://github.com/harfbuzz/harfbuzz", license: "MIT (the 'Old MIT' text, MIT-Modern-Variant)",
      what: "A text-shaping engine that decides which glyph goes where.",
      how: "Inside libass it lays out each caption line (Cyrillic, ligatures, accents, any script) in the render and in the preview." },
    { group: "Captions", name: "GNU FriBidi",
      url: "https://github.com/fribidi/fribidi", license: "LGPL-2.1-or-later",
      what: "An implementation of the Unicode bidirectional algorithm.",
      how: "Inside libass it puts right-to-left and mixed text in captions in the right order, in the render and in the preview." },
    { group: "Captions", name: "abslink",
      url: "https://github.com/ThaUnknown/abslink", license: "Apache-2.0",
      what: "A small library for calling functions across a web worker.",
      how: "Carries the messages between JASSUB's page side and the worker that draws the captions in the preview (vendor/jassub/deps/abslink/)." },
    { group: "Captions", name: "lfa-ponyfill",
      url: "https://github.com/ThaUnknown/lfa-ponyfill", license: "MIT",
      what: "A stand-in for the browser's Local Font Access API.",
      how: "JASSUB's worker imports it. The preview hands JASSUB our own font files and turns system font lookup off (queryFonts: false), so it never asks this computer for a font (public/js/captions/layer.js)." },
    { group: "Fonts", name: "Montserrat",
      url: "https://github.com/JulietaUla/Montserrat", license: "OFL-1.1",
      what: "A geometric sans-serif by Julieta Ulanovsky.",
      how: "Our main caption face: 63 of the 127 presets use its Black, ExtraBold or Bold weight. A style that names The Bold Font, Poppins or Outfit is drawn in it (public/js/captions/fonts.js)." },
    { group: "Fonts", name: "Fira Sans Extra Condensed",
      url: "https://github.com/googlefonts/FiraGFVersion", license: "OFL-1.1",
      what: "The narrowest width of Fira, the sans-serif designed for Mozilla by Carrois.",
      how: "Its Black weight is the tall, narrow headline face of 16 presets. A style that names Impact or Anton is drawn in it (public/js/captions/fonts.js)." },
    { group: "Fonts", name: "Inter",
      url: "https://github.com/rsms/inter", license: "OFL-1.1",
      what: "A sans-serif by Rasmus Andersson, designed for screens.",
      how: "Shipped in Black, ExtraBold and Bold and used by 12 presets. A style that names IBM Plex Sans or Plus Jakarta Sans is drawn in it (public/js/captions/fonts.js)." },
    { group: "Fonts", name: "Liberation Sans",
      url: "https://github.com/liberationfonts/liberation-fonts", license: "OFL-1.1",
      what: "Red Hat's font with the same letter widths as Arial.",
      how: "The fallback caption font, in Regular and Bold. An unknown font, or an old project that named Arial or Helvetica, is drawn in it so the layout stays where it was (FALLBACK in public/js/captions/fonts.js). JASSUB's own fallback font is Liberation Sans too, but our preview never loads it." },
    { group: "Fonts", name: "PT Sans",
      url: "https://github.com/google/fonts/tree/main/ofl/ptsans", license: "OFL-1.1",
      what: "ParaType's sans-serif made for the languages of Russia.",
      how: "A caption font in Regular and Bold, used by 5 presets. It also stands in for Tahoma, Verdana and Courier New, and the preview draws in it any letter another caption font lacks (defaultFont in public/js/captions/layer.js)." },
    { group: "Fonts", name: "PT Serif",
      url: "https://github.com/google/fonts/tree/main/ofl/ptserif", license: "OFL-1.1",
      what: "ParaType's serif companion to PT Sans.",
      how: "A caption font in Regular and Bold, used by 11 presets. An old project that named Georgia or Times New Roman is drawn in it (public/js/captions/fonts.js)." },
    { group: "Fonts", name: "Rubik Mono One",
      url: "https://github.com/alexeiva/rubikmonoone", license: "OFL-1.1",
      what: "A heavy monospaced display face from the Rubik family, with Cyrillic.",
      how: "The comic-style face of 10 presets. It stands in for Komika Axis (the owner's choice), Bangers and Luckiest Guy, which the app does not ship (public/js/captions/fonts.js)." },
    { group: "Fonts", name: "Russo One",
      url: "https://github.com/google/fonts/tree/main/ofl/russoone", license: "OFL-1.1",
      what: "A sporty, technical display sans by Jovanny Lemonad.",
      how: "Used by 3 presets. A style that names Orbitron is drawn in it (public/js/captions/fonts.js)." },
    { group: "Fonts", name: "Oswald",
      url: "https://github.com/googlefonts/OswaldFont", license: "OFL-1.1",
      what: "A condensed display sans by Vernon Adams.",
      how: "Shipped in Bold and used by 2 presets. A style that names Bebas Neue is drawn in it (public/js/captions/fonts.js)." },
    { group: "Fonts", name: "Unbounded",
      url: "https://github.com/googlefonts/unbounded", license: "OFL-1.1",
      what: "A wide display sans by the NaN foundry.",
      how: "Shipped in Black and used by one preset. A style that names Syne is drawn in it (public/js/captions/fonts.js)." },
    { group: "Fonts", name: "Rubik",
      url: "https://github.com/googlefonts/rubik", license: "OFL-1.1",
      what: "A slightly rounded sans-serif by Hubert & Fischer.",
      how: "Shipped in Black as one of the caption fonts on offer; no preset uses it yet (public/fonts/captions/)." },
    { group: "Fonts", name: "Exo 2",
      url: "https://github.com/googlefonts/Exo-2.0", license: "OFL-1.1",
      what: "A geometric sans with a technical feel by Natanael Gama.",
      how: "Shipped in Black as one of the caption fonts on offer; no preset uses it yet (public/fonts/captions/)." },
    { group: "Caption presets", name: "CapShorts",
      url: "https://github.com/thealiraza2/CapShorts", license: "MIT",
      what: "An open-source desktop editor for subtitles and shorts, with about a hundred caption templates.",
      how: "100 of our 127 caption presets were converted from its templates. Their bugs were left behind, the fonts were swapped for shipped ones with Cyrillic, and the Urdu ones were left out (public/js/captions/presets.js). Our caption transcription also follows its setup: Groq whisper-large-v3 first, and Whisper on this computer when Groq cannot be reached (lib/captions-job.js)." },
    { group: "Caption presets", name: "Capite",
      url: "https://github.com/muneebkhan08/Capite", license: "MIT",
      what: "A self-hosted caption generator with word-timed animated subtitle styles.",
      how: "The other 27 of our 127 caption presets were converted from its styles in the same way, leaving its shadow and karaoke bugs behind (public/js/captions/presets.js)." },
    { group: "Tools and build", name: "ESLint", npm: "eslint",
      url: "https://github.com/eslint/eslint", license: "MIT",
      what: "A tool that finds problems in JavaScript code.",
      how: "Checks our code for mistakes such as undefined names. A rule set in our config fails any program start without windowsHide, so no ffmpeg run pops up a console window (eslint.config.mjs)." },
    { group: "Tools and build", name: "globals", npm: "globals",
      url: "https://github.com/sindresorhus/globals", license: "MIT",
      what: "Lists of the global names each JavaScript environment defines.",
      how: "Tells ESLint which names exist in the pages and which exist on the server (eslint.config.mjs)." },
    { group: "Ideas and rules we follow", name: "Subtitle Edit",
      url: "https://github.com/SubtitleEdit/subtitleedit", license: "MIT",
      what: "An open-source subtitle editor that breaks and splits subtitle lines automatically.",
      how: "Our captions break a page into lines the way its auto-break does. Lines are measured in pixels, the most even split wins, a tie goes to the wider lower line, and a line never ends on a weak word (public/js/captions/pages.js). This is our own code; none of theirs is copied." },
    { group: "Ideas and rules we follow", name: "stable-ts",
      url: "https://github.com/jianfch/stable-ts", license: "MIT",
      what: "A Python library on top of Whisper for steadier word timings and for regrouping words into subtitles.",
      how: "Heard words are cut into caption pages with its 'even split': the fewest pages that fit, with the words spread as evenly as possible (public/js/captions/pages.js). This is our own code, with our own costs added for prepositions and particles." },
    { group: "Ideas and rules we follow", name: "remotion-captions-kit",
      url: "https://github.com/Fats403/remotion-captions-kit", license: "MIT",
      what: "Animated caption presets for Remotion, with a paginator that respects sentences.",
      how: "Our rules for where a caption page ends match its paginator: a 0.4 s silence or a sentence end closes a page, and a page under 0.3 s joins a neighbour (public/js/captions/pages.js). Written from scratch; our research notes name the project but the code does not." },
  ];
  window.UGC_THANKS = THANKS;

  var body = document.getElementById('thx-body');
  if (!body) return;
  var built = false;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function build() {
    built = true;
    var count = document.getElementById('thx-count');
    if (count) count.textContent = 'the open-source work this app is built on - ' + THANKS.length + ' repositories';
    body.appendChild(el('p', 'thx-intro', 'UGC Studio stands on the work of these projects and the people behind them. '
      + 'Each is listed with its licence, what it is, and what it does in this app. Thank you.'));
    var coll = null;
    try { coll = new Intl.Collator('en', { sensitivity: 'base', numeric: true }); } catch (e) { /* plain compare then */ }
    var list = THANKS.slice().sort(function (a, b) {
      if (coll) return coll.compare(a.name, b.name);
      var x = a.name.toLowerCase(), y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    var sec = el('section', 'thx-group');
    list.forEach(function (t) {
      var row = el('div', 'thx-row');
      var top = el('div', 'thx-top');
      var a = el('a', 'thx-name', t.name);
      a.href = t.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = t.url;
      top.appendChild(a);
      top.appendChild(el('span', 'thx-lic', t.license));
      top.appendChild(el('span', 'thx-grp', t.group));
      row.appendChild(top);
      row.appendChild(el('div', 'thx-what', t.what));
      row.appendChild(el('div', 'thx-how', t.how));
      sec.appendChild(row);
    });
    body.appendChild(sec);
  }

  document.addEventListener('adm-pane', function (e) { if (e.detail === 'thanks' && !built) build(); });
})();
