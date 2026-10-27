// WHERE MEDIA CAN BE PUT - the places of the media tree (GET /api/library/tree), cut down to a smaller tree for the place
// picker (js/place-tree.js, phase V39): the window "save the piece to" after a stretch is chosen in any video (js/cut.js,
// phase TG block 7) and "move to…" of a REFERENCES post (js/references/post.js, block 5b).
//
//   { key, label, count, locked, to?, newCat?, children? }
//     to       the node is a place itself: { kind, cat, label, text } - a kind and its category ('' - none), the
//              category's name, the whole path in words ("Generated · B-rolls · Reels")
//     newCat   the row "+ new category…" of that kind - the last of its kind's own branch
//     a node with neither only opens.
//
// REFERENCES - back to the post's own source folder (no category: the sources' folders themselves are not places, a post
// goes back to its own) and its own categories; VIDEO - Generated (a B-roll with no category), B-rolls' categories,
// Hooks, Uploads and theirs (never Talking heads: a take is its project's); IMAGES (unless `images: false`) - IMAGES
// itself and its categories. (Phase V35: the tree has no Uncategorized nodes - what has no category lies in the node that
// says so with `loose`.)
//
// (phase V54, `audio: true` - "Move to…" of several tiles, js/tile-select.js) AUDIO too: Music itself, its highlights
// folder and the moods (`to.folder`, `to.mood` - a mood takes only the tracks its preset made, the server says so), My
// sounds and its categories; never Built-in or ★ Favorites.

const KINDS = new Set(['birols', 'uploads', 'hooks', 'images', 'references']);
const AUDIO_KINDS = new Set(['sounds', 'music']);
const ANYCAT = '__cat__';

/**
 * opts { images: false - without IMAGES; audio: true - with AUDIO (V54); refHome - the words for REFERENCES' "no category";
 *        newCats - the kinds whose branch ends in "+ new category…" }
 * -> the roots: REFERENCES, VIDEO, IMAGES (, AUDIO)
 */
export function placesOf(tree, opts) {
  const o = opts || {};
  const adds = new Set(o.newCats || []);
  const takes = (k) => KINDS.has(k) || (o.audio && AUDIO_KINDS.has(k));
  const map = (n, path) => {
    if (n.kind === 'heads' || n.ref) return null;
    if (n.kind === 'sfx' || n.key === 'sfx-fav') return null;          // Built-in is the app's; Favorites is a star
    let to = null;
    if (n.kind === 'music' && o.audio) to = { kind: 'music', cat: '', label: '', folder: n.folder || '', mood: n.mood || '', text: path || n.label };
    else if (n.loose && takes(n.loose)) to = { kind: n.loose, cat: '', label: '', text: path || n.label };
    else if (takes(n.kind) && n.cat && n.cat !== ANYCAT) to = { kind: n.kind, cat: n.cat, label: n.name || n.label, text: path };
    const kids = (n.children || []).map(c => map(c, path ? path + ' · ' + c.label : c.label)).filter(Boolean);
    // A kind's own node (its key is the kind: REFERENCES, B-rolls, Hooks, Uploads, IMAGES) holds its categories.
    if (n.key === n.kind && adds.has(n.kind)) kids.push({ key: 'new:' + n.kind, label: '+ new category…', newCat: n.kind });
    if (!to && !kids.length) return null;
    const p = { key: n.key, label: n.label, count: n.count || 0, locked: !!n.locked };
    if (to) p.to = to;
    if (kids.length) p.children = kids;
    return p;
  };
  const root = (key) => (tree || []).find(n => n.key === key);
  const out = [];
  const refs = root('references');
  const home = o.refHome || 'the source\'s folder (no category)';
  const r = (refs && map(refs, 'REFERENCES')) || { key: 'references', label: 'REFERENCES', count: 0, locked: false };
  r.children = [{ key: 'references:home', label: home, to: { kind: 'references', cat: '', label: '', text: 'REFERENCES · ' + home } }]
    .concat(r.children || []);
  out.push(r);
  const video = root('video') && map(root('video'), '');
  if (video) out.push(video);
  if (o.images !== false) {
    const images = root('images') && map(root('images'), 'IMAGES');
    if (images) out.push(images);
  }
  if (o.audio) {
    const audio = root('audio') && map(root('audio'), '');
    if (audio) out.push(audio);
  }
  return out;
}

/** Where a place is, in words: "Uploads · Reels", "REFERENCES · its site's folder". */
export function whereText(to) {
  if (!to) return '';
  if (to.kind === 'references') return 'REFERENCES · ' + (to.cat ? to.label : 'its site\'s folder');
  if (to.kind === 'images') return 'IMAGES' + (to.cat ? ' · ' + to.label : '');
  if (to.kind === 'sounds') return 'My sounds' + (to.cat ? ' · ' + to.label : '');
  if (to.kind === 'music') return to.text || 'Music';
  if (to.kind === 'birols' && !to.cat) return 'Generated';
  return ({ uploads: 'Uploads', birols: 'B-rolls', hooks: 'Hooks' }[to.kind] || to.kind) + (to.cat ? ' · ' + to.label : '');
}
