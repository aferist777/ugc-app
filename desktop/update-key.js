'use strict';

// Where this program asks for updates, and the key it checks them with.
// PUBLIC_KEY is written by `node tools/release.js keygen` (the private half stays with the publisher, outside git);
// WORKER_URL by `node tools/release.js worker` once the Worker is on the publisher's Cloudflare. Empty: no updates are
// asked for. A stand's build bakes its own in (tools/build-app.js --update-key / --update-url).

module.exports = {
  PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAf9u+JWNAPOHmOqz9OAiJLvYC1nnGSGZwogc6UBofRzA=\n-----END PUBLIC KEY-----\n",
  WORKER_URL: "https://ugc-updates.your-subdomain.workers.dev",
};
