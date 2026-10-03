# Word of Mouth

Free, open-source PWA for city-scale event pages. No chat, no group member cap.

## Product spec

1. **PAGE** — anyone can create a page (title, city, description, shareable URL). The page is the archive of posts: image, text, optional structured fields (date, venue, doors).
2. **SUBSCRIBE** — open subscribe via OAuth (Google/Apple). Real identity for preferences and abuse, no app install. Subscribing does NOT grant posting rights.
3. **PUBLISH** — posting is permissioned. Page owner approves publishers (venues, bookers, relays). Everyone else is read-only.
4. **NOTIFY** — each subscriber sets their own policy per subscription: instant from anyone approved; instant only from picked publishers; one daily digest; or mute without unsubscribing.
5. **DELIVERY** — phone notification via Web Push (free, browser vendors run the relay). iOS requires the site added to Home Screen (PWA, iOS 16.4+); Android notifies from the browser directly. The subscribe flow must end in 'Add to Home Screen' guidance on Apple.

## Data model

- **Page** — slug, owner, city, description
- **Publisher** — user approved on a page
- **Post** — image, text, optional date/venue/doors
- **Subscription** — user, page, mode (instant/daily), optional publisher filter
- **Device** — Web Push endpoint tied to user

## Tech stack

- Small Node or Go server (pick one and stick with it)
- SQLite or Postgres
- Web Push (web-push library)
- PWA manifest + service worker
- Self-hostable on a cheap VPS
- Open source, MIT license

## Build order

1. Server skeleton + data model
2. Page CRUD + public page view
3. OAuth login
4. Subscribe + subscription preferences
5. Publisher permission gate + post creation
6. Web Push delivery + daily digest job
7. PWA manifest + service worker + iOS home-screen guidance
8. README with self-hosting instructions