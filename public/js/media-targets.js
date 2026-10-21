// WHERE MEDIA CAN BE PUT - the places of the media tree (GET /api/library/tree), as one list for a menu (phase TG).
// Read by the post viewer's "move to…" (js/references/post.js, block 5b) and by the window "save the piece to"
// after a stretch is chosen in any video (js/cut.js, block 7):
//
//   { head }                                   a group's title: REFERENCES, VIDEO, IMAGES
//   { kind, cat, label, text }                 a place: a kind and its category ('' - none), the category's name
//   { newCat: 'references', text }             "+ new category…" of REFERENCES
//
// REFERENCES - the source's folder (no category) and its own categories; VIDEO - Uploads, B-rolls' categories, Generated
// · Uncategorized, Hooks; IMAGES (only when asked) - its categories and Uncategorized.

const VIDEO_KINDS = new Set(['birols', 'uploads', 'hooks']);

export function targetsOf(tree, opts) {
  const o = opts || {};
  const out = [];
  const ref = (tree || []).find(n => n.key === 'references');
  out.push({ head: 'REFERENCES' });
  out.push({ kind: 'references', cat: '', label: '', text: o.refHome || 'the source\'s folder (no category)' });
  for (const c of ((ref && ref.children) || []).filter(c => c.cat)) out.push({ kind: 'references', cat: c.cat, label: c.name || c.label, text: c.label });
  out.push({ newCat: 'references', text: '+ new category…' });
  const walk = (n, trail, add) => {
    for (const c of n.children || []) {
      const p = trail ? trail + ' · ' + c.label : c.label;
      if (c.kind && (VIDEO_KINDS.has(c.kind) || c.kind === 'images')) {
        if (c.uncat) add({ kind: c.kind, cat: '', label: '', text: p });
        else if (c.cat && c.cat !== '__cat__') add({ kind: c.kind, cat: c.cat, label: c.name || c.label, text: p });
        else if (!c.cat && (c.key === 'uploads' || c.key === 'hooks') && !(c.children || []).some(x => x.uncat)) add({ kind: c.kind, cat: '', label: '', text: p });
      }
      walk(c, p, add);
    }
  };
  const video = (tree || []).find(n => n.key === 'video');
  out.push({ head: 'VIDEO' });
  if (video) walk(video, '', (t) => out.push(t));
  if (o.images !== false) {
    const images = (tree || []).find(n => n.key === 'images');
    out.push({ head: 'IMAGES' });
    if (images) {
      const before = out.length;
      walk(images, 'IMAGES', (t) => out.push(t));
      if (!out.slice(before).some(t => !t.cat)) out.splice(before, 0, { kind: 'images', cat: '', label: '', text: 'IMAGES · Uncategorized' });
    }
  }
  return out;
}

/** Where a place is, in words: "Uploads · Reels", "REFERENCES · its site's folder". */
export function whereText(to) {
  if (!to) return '';
  if (to.kind === 'references') return 'REFERENCES · ' + (to.cat ? to.label : 'its site\'s folder');
  if (to.kind === 'images') return 'IMAGES' + (to.cat ? ' · ' + to.label : '');
  if (to.kind === 'birols' && !to.cat) return 'Generated · Uncategorized';
  return ({ uploads: 'Uploads', birols: 'B-rolls', hooks: 'Hooks' }[to.kind] || to.kind) + (to.cat ? ' · ' + to.label : '');
}
