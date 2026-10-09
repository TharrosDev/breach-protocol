# Breach Protocol

A browser-based, first-person PvE shooter that mixes Battlefield-style objective play with Call of Duty gunplay and Rainbow Six Siege gadgets.

Hold the sector: capture every objective, or drive the enemy's tickets to zero, before your reinforcements run out. Squad orders, killstreaks, perks, attachments, breach charges and a melee knife are all in.

## Play

Everything is in one file, `index.html`. It loads Three.js from jsDelivr, so you need an internet connection.

- Open `index.html` in Chrome or Edge, or
- use the hosted version on Vercel (see the project link in the repo description).

Keyboard and mouse only. Full controls are on the main menu and in Settings, where every key can be rebound.

## Notes

- Bloom and environment reflections load from the jsDelivr CDN and only run on High quality. If the CDN is blocked, the game runs without them.
- Settings, key bindings and loadouts are saved in the browser's local storage.
- Add `?debug` to the URL to expose internals for testing. Normal play doesn't need it.
