/* ════════════════════════════════════════════════════════════════════════════
   THE SIDE MENU'S ICONS - filled, on a 24×24 grid, `currentColor`, the same way as Home's tiles (js/home/icons.js):
   put into the page AS SVG, so they take the tile's gold; the parts with an opacity are shades of the same colour.
   Their size is the menu's (css/app-nav.css); the word beside each is text.

     the top      full - four corners going out; window - four corners going in; app - the app's "U" (the same sign
                  as tools/make-icon.js draws for the window and the launcher); fold - the menu's panel and an arrow back
     pages        home - a house; merge - three lanes and a playhead; studio3d - a cube in an orbit; library - books on a
                  shelf; assistant - a speech bubble with a spark
     work         queue - three rows waiting, the first with ▶; alerts - a bell
     the foot     update - a circle with an arrow down; guide - an open book; donate - a heart; settings - a gear
   ════════════════════════════════════════════════════════════════════════════ */

const svg = (body) => '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' + body + '</svg>';

export const NAV_ICONS = {
  full: svg('<path d="M3 3h6.5v2.6H5.6v3.9H3zM14.5 3H21v6.5h-2.6V5.6h-3.9zM21 14.5V21h-6.5v-2.6h3.9v-3.9zM9.5 21H3v-6.5h2.6v3.9h3.9z"/>'
    + '<rect x="8.2" y="8.2" width="7.6" height="7.6" rx="1.2" opacity=".45"/>'),
  window: svg('<path d="M7 3h2.6v6.6H3V7h4zM14.4 3H17v4h4v2.6h-6.6zM21 14.4V17h-4v4h-2.6v-6.6zM9.6 21H7v-4H3v-2.6h6.6z"/>'),
  app: svg('<path d="M7.7 5.8V13.1a4.3 4.3 0 0 0 8.6 0V5.8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>'),
  fold: svg('<rect x="2" y="3" width="6" height="18" rx="1.5"/>'
    + '<path d="M21 10.9h-7.1l2.5-2.5-1.5-1.5-5.1 5.1 5.1 5.1 1.5-1.5-2.5-2.5H21z" opacity=".7"/>'),
  home: svg('<path fill-rule="evenodd" d="M12 2.6 1.8 11.2h2.7v9.3A1.5 1.5 0 0 0 6 22h12a1.5 1.5 0 0 0 1.5-1.5v-9.3h2.7zM10 15h4v7h-4z"/>'),
  merge: svg('<rect x="2" y="4" width="11" height="4" rx="1.2"/><rect x="6" y="10" width="15" height="4" rx="1.2" opacity=".7"/>'
    + '<rect x="3" y="16" width="9" height="4" rx="1.2" opacity=".5"/><rect x="15.2" y="4" width="1.8" height="18" rx=".9"/>'
    + '<path d="M13.4 2h5.4l-2.7 3.2z"/>'),
  studio3d: svg('<path d="M12 4.6 18.2 8 12 11.4 5.8 8z"/><path d="M5.2 9.1 11.3 12.5v7L5.2 16.1z" opacity=".75"/>'
    + '<path d="M12.7 12.5 18.8 9.1v7l-6.1 3.4z" opacity=".5"/>'
    + '<ellipse cx="12" cy="12.4" rx="10.6" ry="3.6" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".6" transform="rotate(-18 12 12.4)"/>'),
  library: svg('<rect x="2.5" y="4" width="4.4" height="15.4" rx="1"/><rect x="7.9" y="7" width="4.4" height="12.4" rx="1" opacity=".7"/>'
    + '<path d="M13.6 6.4 17.8 5.3l3.9 13.6-4.2 1.1z" opacity=".5"/><rect x="1.5" y="20.3" width="21" height="1.9" rx=".95"/>'),
  assistant: svg('<path fill-rule="evenodd" d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-8l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 5.5c.5 3 1.6 4.1 4.6 4.6-3 .5-4.1 1.6-4.6 4.6-.5-3-1.6-4.1-4.6-4.6 3-.5 4.1-1.6 4.6-4.6z"/>'),
  queue: svg('<path fill-rule="evenodd" d="M3.5 3h17A1.5 1.5 0 0 1 22 4.5v2A1.5 1.5 0 0 1 20.5 8h-17A1.5 1.5 0 0 1 2 6.5v-2A1.5 1.5 0 0 1 3.5 3zM5.2 4.2v2.6l2.4-1.3z"/>'
    + '<rect x="2" y="9.5" width="20" height="5" rx="1.5" opacity=".7"/><rect x="2" y="16" width="20" height="5" rx="1.5" opacity=".45"/>'),
  alerts: svg('<path d="M12 2.2a1.6 1.6 0 0 1 1.6 1.6v.5a6.5 6.5 0 0 1 4.9 6.3v4.2l2 2.7a.9.9 0 0 1-.7 1.5H4.2a.9.9 0 0 1-.7-1.5l2-2.7v-4.2a6.5 6.5 0 0 1 4.9-6.3v-.5A1.6 1.6 0 0 1 12 2.2z"/>'
    + '<path d="M9.4 20h5.2a2.6 2.6 0 0 1-5.2 0z" opacity=".7"/>'),
  update: svg('<path fill-rule="evenodd" d="M12 1.8a10.2 10.2 0 1 1 0 20.4 10.2 10.2 0 0 1 0-20.4zM10.9 6v7.1l-2.8-2.8-1.5 1.5 5.4 5.4 5.4-5.4-1.5-1.5-2.8 2.8V6z"/>'),
  guide: svg('<path d="M11 5.2C8.6 3.6 5.6 3.2 2 3.6v15.6c3.6-.4 6.6 0 9 1.6z"/><path d="M13 5.2c2.4-1.6 5.4-2 9-1.6v15.6c-3.6-.4-6.6 0-9 1.6z" opacity=".7"/>'),
  donate: svg('<path d="M12 19.4 4.05 11.9A4.8 4.8 0 0 1 12 5.45a4.8 4.8 0 0 1 7.95 6.45z"/>'),
  settings: svg('<path fill-rule="evenodd" d="M20 10.21L22.49 10.51L22.49 13.49L20 13.79A8.2 8.2 0 0 1 18.92 16.39L20.48 18.36L18.36 20.48L16.39 18.92A8.2 8.2 0 0 1 13.79 20L13.49 22.49L10.51 22.49L10.21 20A8.2 8.2 0 0 1 7.61 18.92L5.64 20.48L3.52 18.36L5.08 16.39A8.2 8.2 0 0 1 4 13.79L1.51 13.49L1.51 10.51L4 10.21A8.2 8.2 0 0 1 5.08 7.61L3.52 5.64L5.64 3.52L7.61 5.08A8.2 8.2 0 0 1 10.21 4L10.51 1.51L13.49 1.51L13.79 4A8.2 8.2 0 0 1 16.39 5.08L18.36 3.52L20.48 5.64L18.92 7.61A8.2 8.2 0 0 1 20 10.21zM15.3 12a3.3 3.3 0 1 0-6.6 0 3.3 3.3 0 1 0 6.6 0z"/>'),
};
