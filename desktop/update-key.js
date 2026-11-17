'use strict';

// Where this program asks for updates, and the key it checks them with.
// PUBLIC_KEY is written by `node tools/release.js keygen` (the private half stays with the publisher, outside git);
// RELEASES is the GitHub Releases page the publisher puts versions on (tools/release.js upload). A fork sets its own
// pair and page - or leaves either empty: then no updates are asked for. A stand's build bakes its own in
// (tools/build-app.js --update-key / --update-url).

module.exports = {
  PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAf9u+JWNAPOHmOqz9OAiJLvYC1nnGSGZwogc6UBofRzA=\n-----END PUBLIC KEY-----\n",
  RELEASES: "https://github.com/aferist777/ugc-app/releases",
};
