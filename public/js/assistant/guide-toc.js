/* guide-toc.js - THE GUIDE'S TABLE OF CONTENTS - one rule for the page and the server. The Guide window imports it, the
   server require()s it (lib/assistant-know.js), so a section the Help assistant names is the one the window opens.

   The book is the files public/guide/<nn>-<name>.md, one a chapter, in their numbers' order: its `# ` line is the
   chapter's title, each `## ` line a section. A section's id is its title as a slug. A book of another language is the same
   files in public/guide/<lang>/ (lib/assistant-know.js guideDir), its pictures in its own shots/. While chapters are being written,
   the draft public/guide/guide.md stands for the rest (id `draft`). */

export const CHAPTER_RE = /^(\d\d)-([a-z0-9-]+)\.md$/;
export const DRAFT = 'guide.md';

/** A heading as an id: lower case, every run of other characters one dash; Russian letters are kept as they are. */
export function slug(text) {
  return String(text || '').toLowerCase().replace(/[`*_]/g, '').replace(/[^a-z0-9а-яё]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

/** A chapter file's text -> { title, sections: [{ id, title }] }. Headings inside fences are not headings. */
export function tocOf(md, fallbackTitle) {
  let title = '';
  const sections = [];
  const seen = new Set();
  let fence = false;
  for (const line of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    if (h1 && !title) { title = h1[1].trim(); continue; }
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      let id = slug(h2[1]);
      while (seen.has(id)) id += '-2';
      seen.add(id);
      sections.push({ id, title: h2[1].replace(/[`*]/g, '').trim() });
    }
  }
  return { title: title || fallbackTitle || 'Guide', sections };
}
