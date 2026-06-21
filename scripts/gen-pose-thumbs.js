// One-time: make lightweight thumbnails (<=120KB) for the built-in pose mannequins
// so the pose dropdowns load fast. Output -> public/poses/thumbs/<key>.jpg.
// Matches toThumbPath() (utils.js): /poses/x.jpg -> /poses/thumbs/x.jpg.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DIR = path.join(__dirname, '..', 'public', 'poses');
const THUMBS = path.join(DIR, 'thumbs');

(async () => {
  fs.mkdirSync(THUMBS, { recursive: true });
  const files = fs.readdirSync(DIR).filter(f => /\.(jpe?g|png)$/i.test(f));
  for (const f of files) {
    const src = path.join(DIR, f);
    const dest = path.join(THUMBS, f.replace(/\.[^.]+$/, '') + '.jpg');
    try {
      // 360px wide keeps mannequins crisp at 10-per-row while staying well under 120KB.
      let q = 80, buf;
      do {
        buf = await sharp(src).resize(360, 360, { fit: 'inside' }).jpeg({ quality: q }).toBuffer();
        q -= 10;
      } while (buf.length > 120 * 1024 && q >= 30);
      fs.writeFileSync(dest, buf);
      console.log('thumb:', f, '->', Math.round(buf.length / 1024) + 'KB');
    } catch (e) { console.error('FAIL', f, e.message); }
  }
  console.log('done:', files.length, 'thumbs ->', path.relative(path.join(__dirname, '..'), THUMBS));
})();
