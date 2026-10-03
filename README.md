# notify-pages

City-scale event pages with push notifications. No chat. No group cap.

> Status: server skeleton and data model in progress. See [SPEC.md](SPEC.md) for the full product spec.

## Why

Local event groups (concerts, shows, meetups) die in WhatsApp/Signal: they hit member caps, get muted, and become spammy. notify-pages replaces the group with a **public page + private delivery pipe**.

- Anyone can create a page and share its URL anywhere (flyer, Instagram, door).
- Anyone can subscribe with one OAuth tap.
- Only approved publishers can post.
- Each subscriber controls their own notification policy: instant, daily digest, or specific publishers only.

## Stack

Locked for this repo:

- Server: Node.js 22 (Express). No native addons.
- DB: SQLite via `node:sqlite`, file at `data/notify-pages.sqlite`.
- Push: Web Push API (free, no third-party relay) — not wired yet.
- Client: PWA (manifest + service worker), no app store — not wired yet.

## Develop

```bash
cp .env.example .env
npm install
npm start
```

`GET /health` returns the migrated tables. Page CRUD is next.

## Self-hosting

Coming soon. Target: a 5€ VPS.

## License

MIT
