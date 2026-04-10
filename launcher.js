'use strict';

// Launcher: spawns server.js and automatically restarts it when it exits.
// Used by "npm start" so the in-app restart button works.

const { spawn } = require('child_process');
const path = require('path');

let child = null;

function start() {
  child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    stdio: 'inherit',
    cwd: __dirname,
  });

  child.on('exit', (code, signal) => {
    console.log(`[launcher] server exited (code=${code}, signal=${signal}), restarting in 1s…`);
    setTimeout(start, 1000);
  });
}

// Forward SIGINT/SIGTERM to child so Ctrl-C still works
process.on('SIGINT',  () => { child?.kill('SIGINT');  process.exit(0); });
process.on('SIGTERM', () => { child?.kill('SIGTERM'); process.exit(0); });

start();
