# Word of Mouth

City-scale event pages with push notifications. No chat. No group cap.

> Status: spec written, development starting. See [SPEC.md](SPEC.md) for the full product spec.

## Why

Local event groups (concerts, shows, meetups) die in WhatsApp/Signal: they hit member caps, get muted, and become spammy. Word of Mouth replaces the group with a **public page + private delivery pipe**.

- Anyone can create a page and share its URL anywhere (flyer, Instagram, door).
- Anyone can subscribe with one OAuth tap.
- Only approved publishers can post.
- Each subscriber controls their own notification policy: instant, daily digest, or specific publishers only.

## Stack

- Server: Node.js 22, TypeScript, Hono
- DB: SQLite via node:sqlite
- Push: Web Push API (free, no third-party relay)
- Client: PWA (manifest + service worker), no app store

Step 1 is the server skeleton and the schema, and the rest of the build order is not built yet.

## Self-hosting

Coming soon. Target: a 5€ VPS.

## License

MIT