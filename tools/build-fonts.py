#!/usr/bin/env python3
"""build-fonts.py - lays the caption fonts of phase V68 P4 into public/fonts/captions/ (the owner 2026-11-01/02, answers
(hp52)-(hp55) of docs/local-app/plan/: the 80 fonts the owner picked, all from Google Fonts).

Run by hand when the set changes; npm install never runs it. Needs Python 3 and fontTools (pip install fonttools):
    python tools/build-fonts.py                  downloads what is missing into <temp>/ugc-fonts-cache/, writes the fonts
    python tools/build-fonts.py --cache <dir>    the same with another cache
    python tools/build-fonts.py --check          says whether public/fonts/captions/ holds exactly what the list makes
Then node tools/caption-advances.js (the letters' widths) - and fonts.js gets a row per font (line, ink, twin).

WHERE THEY COME FROM: the repository google/fonts at ONE commit (the list's `commit`; Orbitron's static Black from an older
commit of the same repository, `commit` in its entry - the newer one keeps only its variable file), each file and its licence
pinned by its git blob SHA-1 (what GitHub's tree lists), checked before use.

WHAT IS DONE TO A FONT, and nothing else:
  - a VARIABLE file (one file, every weight) is made the static font of the weight picked - libass draws a variable file at
    its default instance, and the owner picked 700-900: every axis pinned (wght to the weight, the rest to their defaults),
    the names Google's static files have ("Caveat" Bold; "Big Shoulders Display Black" for 800/900);
  - a font whose licence reserves no font name is CUT to Latin and Cyrillic with their punctuation (the list's `keep`;
    (hp53) - the seven Japanese fonts weighed 24 MB for letters captions never draw); the OFL allows a modified font under
    the same name when no name is reserved. A font with a reserved name (`reserved`) is shipped exactly as it came; so are
    the Apache-2.0 ones (they are small).
Each licence goes beside the fonts, licenses/OFL-<folder>.txt or licenses/Apache-2.0-<folder>.txt."""

import argparse
import hashlib
import io
import json
import os
import sys
import tempfile
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIST = os.path.join(ROOT, 'tools', 'fonts-list.json')
OUT = os.path.join(ROOT, 'public', 'fonts', 'captions')
STYLE = {400: 'Regular', 700: 'Bold', 800: 'ExtraBold', 900: 'Black'}


def blob_sha1(data):
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()


def fetch(repo, commit, rel, sha, cache):
    """The file `rel` of the repository at `commit`, from the cache or downloaded - checked against its blob SHA-1."""
    p = os.path.join(cache, sha)
    if not os.path.exists(p):
        url = 'https://raw.githubusercontent.com/%s/%s/%s' % (repo, commit, urllib.request.quote(rel))
        with urllib.request.urlopen(url, timeout=120) as r:
            data = r.read()
        with open(p, 'wb') as f:
            f.write(data)
    with open(p, 'rb') as f:
        data = f.read()
    if blob_sha1(data) != sha:
        raise SystemExit('%s: not the pinned file (SHA-1 %s)' % (rel, blob_sha1(data)))
    return data


def unicodes(spec):
    out = []
    for part in spec.split(','):
        a, _, b = part.strip()[2:].partition('-')
        out.extend(range(int(a, 16), int(b or a, 16) + 1))
    return out


def family_of(font):
    n = font['name']
    return str(n.getName(16, 3, 1, 0x409) or n.getName(1, 3, 1, 0x409) or n.getDebugName(1))


def set_names(font, fam, weight):
    """The names a static file of this weight has on Google Fonts: 700 is the family's Bold, 800/900 a family of their own."""
    style = STYLE[weight]
    ps = fam.replace(' ', '') + '-' + style
    n = font['name']
    n.names = [r for r in n.names if r.nameID not in (1, 2, 3, 4, 6, 16, 17, 25)]
    ribbi = weight in (400, 700)
    rows = {1: fam if ribbi else fam + ' ' + style, 2: style if ribbi else 'Regular', 4: fam + ' ' + style, 6: ps}
    if not ribbi:
        rows[16], rows[17] = fam, style
    ver = str(n.getName(5, 3, 1, 0x409) or 'Version 1.000').replace('Version ', '').split(';')[0]
    rows[3] = '%s;%s' % (ver, ps)
    for k, v in rows.items():
        n.setName(v, k, 3, 1, 0x409)
        n.setName(v, k, 1, 0, 0)
    os2 = font['OS/2']
    os2.usWeightClass = weight
    sel = os2.fsSelection & ~(1 << 0 | 1 << 5 | 1 << 6)
    os2.fsSelection = sel | (1 << 5 if weight == 700 else 1 << 6)
    font['head'].macStyle = (font['head'].macStyle & ~1) | (1 if weight == 700 else 0)


def build_one(e, data, keep):
    """The font file as the app ships it: (file name, bytes, what was done)."""
    src_name = e['file'].split('/')[-1]
    font = TTFont(io.BytesIO(data), recalcTimestamp=False)
    done = []
    name = src_name
    if 'fvar' in font:
        fam = family_of(font)
        limits = {a.axisTag: a.defaultValue for a in font['fvar'].axes}
        if 'wght' in limits:
            limits['wght'] = e['weight']
        instancer.instantiateVariableFont(font, limits, inplace=True, updateFontNames=False)
        set_names(font, fam, e['weight'])
        name = fam.replace(' ', '') + '-' + STYLE[e['weight']] + '.ttf'
        done.append('static %d' % e['weight'])
    if not e.get('reserved') and e['license'].startswith('ofl/'):
        opt = subset.Options()
        opt.layout_features = ['*']
        opt.name_IDs = ['*']
        opt.name_languages = ['*']
        opt.name_legacy = True
        opt.legacy_kern = True
        opt.notdef_outline = True
        opt.glyph_names = True
        sub = subset.Subsetter(opt)
        sub.populate(unicodes=keep)
        sub.subset(font)
        done.append('cut')
    if not done:
        return name, data, 'as it came'
    buf = io.BytesIO()
    font.save(buf)
    return name, buf.getvalue(), ', '.join(done)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'ugc-fonts-cache'))
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    with open(LIST, encoding='utf-8') as f:
        L = json.load(f)
    os.makedirs(a.cache, exist_ok=True)
    keep = unicodes(L['keep'])
    bad = 0
    lic_dir = os.path.join(OUT, 'licenses')
    for e in L['fonts']:
        commit = e.get('commit') or L['commit']
        data = fetch(L['repo'], commit, e['file'], e['sha1'], a.cache)
        lic = fetch(L['repo'], L['commit'], e['license'], e['licenseSha1'], a.cache)
        name, out, how = build_one(e, data, keep)
        folder = e['license'].split('/')[1]
        lic_name = ('OFL-' if e['license'].startswith('ofl/') else 'Apache-2.0-') + folder + '.txt'
        targets = [(os.path.join(OUT, name), out), (os.path.join(lic_dir, lic_name), lic)]
        if a.check:
            for p, b in targets:
                # A licence checked out by git may have CRLF ends (core.autocrlf); a font is binary to git.
                now = open(p, 'rb').read() if os.path.exists(p) else None
                if now is not None and p.endswith('.txt'):
                    now, b = now.replace(b'\r\n', b'\n'), b.replace(b'\r\n', b'\n')
                if now != b:
                    print('differs: ' + os.path.relpath(p, ROOT))
                    bad += 1
            continue
        for p, b in targets:
            with open(p, 'wb') as f:
                f.write(b)
        print('%-28s %-40s %7.0f KB  %s' % (e['name'], name, len(out) / 1024, how))
    if a.check:
        print('public/fonts/captions/ matches the list.' if not bad else '%d files differ - run python tools/build-fonts.py' % bad)
        sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
