# Word of Mouth

Word of Mouth is a shareable public page for local events. Anyone can open the page and subscribe. Subscribing does not grant posting. Only the owner and approved publishers can post. Each subscriber chooses instant alerts, a daily digest, certain publishers only, or mute. Web Push delivers the alerts. Chat is intentionally absent.

> Status: runnable prototype. See [SPEC.md](SPEC.md). Apple sign-in is not included.

## Why

Local event groups (concerts, shows, meetups) die in WhatsApp/Signal: they hit member caps, get muted, and become spammy. Word of Mouth replaces the group with a **public page + private delivery pipe**.

- Anyone can create a page and share its URL anywhere (flyer, Instagram, door).
- Anyone can subscribe with one OAuth tap.
- Only approved publishers can post.
- Each subscriber controls their own notification policy: instant, daily digest, or specific publishers only.

## Stack

- Server: Node.js 22, TypeScript, Hono
- DB: SQLite via node:sqlite
- Push: Web Push API through the `web-push` package
- Client: server-rendered HTML, one CSS file, PWA manifest and service worker

Sign in with a display name for a local account. Google sign-in is registered only when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `PUBLIC_BASE_URL` are all set.

## Self-hosting

Node.js 22 is required.

```bash
git clone https://github.com/yacfish/word-of-mouth.git
cd word-of-mouth
npm install
npm run build
npm start
```

Open http://127.0.0.1:3000, sign in with a display name, and create a page.

Environment variables:

- `PORT`, default 3000
- `WOM_DB`, default `./data/word-of-mouth.sqlite`
- `WOM_SESSION_SECRET`, required when `NODE_ENV` is production
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `PUBLIC_BASE_URL`, optional. All three must be set or Google sign-in stays off.
- `WOM_VAPID_PUBLIC` and `WOM_VAPID_PRIVATE`, optional. If both are unset, a key pair is written to `./data/vapid.json` and reused on the next start.

Data lives in `./data` (the SQLite file, uploads, and VAPID keys).

A 5 euro VPS is the target. Put a reverse proxy with HTTPS in front of the app. Web Push needs HTTPS (localhost is the exception).

Apple sign-in is not built. It needs an Apple developer key, and this prototype does not include it.

## License

MIT
