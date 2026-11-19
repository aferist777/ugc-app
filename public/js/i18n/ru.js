/* ru.js - THE RUSSIAN DICTIONARY: English text -> Russian, in parts by the part of the app they belong to, so the parts
   are translated and changed apart. Read by the server only (lib/i18n.js): a page gets the merged dictionary from
   GET /api/i18n/dict.js, never this module, so a page in English loads no Russian.

   A line is 'English': 'Русский'; a count's line is the English `other` text with its three forms - one, few, many:
   '{n} files': ['{n} файл', '{n} файла', '{n} файлов']; a line for one place is 'ctx::English' (t.js tc). */

import common from './ru/common.js';
import shell from './ru/shell.js';
import home from './ru/home.js';
import admin from './ru/admin.js';
import tree from './ru/tree.js';
import windows from './ru/windows.js';
import thanks from './ru/thanks.js';
import library from './ru/library.js';
import scenarios from './ru/scenarios.js';
import character from './ru/character.js';
import shelf from './ru/shelf.js';

export const PARTS = { common, shell, home, admin, tree, windows, thanks, library, scenarios, character, shelf };

const all = {};
for (const part of Object.values(PARTS)) Object.assign(all, part);
export default all;
