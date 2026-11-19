// A PICTURE FROM THIS COMPUTER (every picture brought in is made a format that works - lib/image-in.js on
// the server). What counts as a picture, what the file pickers offer, and
// a phone's HEIC turned into a JPEG by the server before the page shows it: the browser cannot draw a
// HEIC, and a phone's HEIC often arrives with no type at all - so it is known by its name too.

/** What a picture's file picker offers: every image type, and a HEIC/HEIF/AVIF a system may not list. */
import { t } from './i18n/t.js';

export const PICTURE_ACCEPT = 'image/*,.heic,.heif,.avif';

const EXT = /\.(jpe?g|png|webp|avif|heic|heif|gif|tiff?|svg)$/i;
const HEIC = /\.hei[cf]$/i;

/** Is this file a picture - by its type, or by its name when the system gave it none? */
export const isPictureFile = (f) => !!f && (/^image\//.test(f.type || '') || EXT.test(f.name || ''));

const _isHeic = (f) => /^image\/hei[cf]/i.test(f.type || '') || HEIC.test(f.name || '');

/**
 * The file as a data URL the page can show and send: read as it is, and a HEIC first made a JPEG by the
 * server (POST /api/images/sendable - the app's own ffmpeg reads it, lib/heic.js). Throws in words.
 */
export async function pictureDataUrl(file) {
  const raw = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error(t('could not read the file')));
    fr.readAsDataURL(file);
  });
  if (!_isHeic(file)) return raw;
  const d = await fetch('/api/images/sendable', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: raw }),
  }).then(r => r.json()).catch(() => null);
  if (!d || !d.success) throw new Error((d && d.error) || t('that photo could not be read'));
  return d.dataUrl;
}
