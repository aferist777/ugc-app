'use strict';

/* render-busy.js - whether a render is encoding right now.

   Preview proxies made ahead of time (routes/proxies.js) wait while one is: they would take the
   cores from a file somebody is waiting for. A proxy a person is waiting for does not wait.

   const done = start();   ...   done();   // once, when the render and its finishing passes are over
   busy() -> true while any render has started and not said done */

let running = 0;

function start() {
  running++;
  let over = false;
  return () => {
    if (over) return;
    over = true;
    running = Math.max(0, running - 1);
  };
}

const busy = () => running > 0;

module.exports = { start, busy };
