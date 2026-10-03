# Competitor's research note

Date: 3 October 2026
Project: notify-pages

## Conclusion

Nothing found does the same thing as the shape written this morning. That shape is a public event page with a shareable URL, publishers who are approved before they can post, and a private notification pipe where each subscriber sets their own policy: instant, a daily digest, specific publishers only, or mute. Subscribe does not grant the right to post. There is no chat and no group cap. Delivery is Web Push.

The closest things are small websites that share one page or one blast, and large ticketing apps that let you follow an artist or a venue. None of them combines an open page, gated publishers, and a policy each subscriber sets.

## The GitHub repo: itshuey/word-of-mouth

Repository: https://github.com/itshuey/word-of-mouth

The description calls it a proof of concept for a social app for live events. There is no README.

Stack: Expo SDK 34, React Native, React 16.8. Redux is listed in package.json and is not used.

State: four commits. The last one is 16 September 2019, message "Pre-patent". Three tabs are static images. The buttons only pop an alert that says "shout" or "blackout". The logged-out screen is not wired up. There is no server.

Verdict: a weak partial fit. It is a visual demo from 2019, not something you could build on. It has no pages, no subscribe, no posting, no notifications, and no backend. It is not actively maintained.

## Products from the wider search

### Event Notis

Site: https://eventnotis.com/main/

What it does: an organization shares one link. People can get the notifications without an account, and everyone on that link gets the same push. On iPhone it expects you to add the site to the Home Screen.

How close: partial, and the closest of the small sites. It is a shared notification blast, not an open public page, not approved publishers, and not a policy each person sets.

Maintenance: the site is up. No app store listing was found, and no public release date or last commit was found. Whether a developer or company is still working on it is unknown.

### PopIn

Site: https://popin.events/

What it does: a shareable event page. Guests can RSVP without an account. The host broadcasts by email, text, or push, and the product says it avoids group-chat chaos. People who sign in also get chats. It is in early access and works as a site you can pin to your home screen. A get-the-app page claims iPhone and Android.

How close: partial. The shareable page and the host broadcast are in the neighborhood. Chats for signed-in users go the other way from "no chat", and there is no per-subscriber policy and no gated set of publishers.

Maintenance: the site is up and calls itself early access. No store version date was found.

### Calen

Site: https://www.calen.events/

What it does: a shareable page, add to calendar, follow an organizer, and an email when that organizer's next event is posted. Analytics is marked coming soon. It is a website, not a store app.

How close: partial. Following one organizer and getting mail about the next event is a thin version of the pipe. It is not open publishing by approved publishers, and it is not a policy of instant, digest, or selected publishers.

Maintenance: the site is up. On 3 October 2026 it still listed events dated 29 September 2026 as upcoming, so that page was a few days stale. No app store listing and no release date were found.

### Shotgun

What it does: ticketing. You can follow a public page and get notified when new events are posted.

How close: partial, and only on the "follow a page, hear about new events" slice. It is a ticket app, not a subscriber policy, and not gated publishing of a page you control.

Maintenance: active and downloadable. App Store version 11.43.0 was updated about two days before this search. Consumer terms are dated May 2026. Copyright 2026.

### DICE

What it does: ticketing. You follow artists and venues.

How close: partial, same slice as Shotgun. Follow a name, get told about shows. Not the page, the publishers, or the personal policy.

Maintenance: active and downloadable. App Store version 4.261.0 was updated about a day before this search. Copyright 2026, Dice FM Ltd. As of June 2026 it was still operating under Fever, had renewed venue deals, and was planning more countries.

### Bandsintown

What it does: follow artists, with email and push alerts. Ticketing.

How close: partial, the same follow-an-artist slice. Not the shape.

Maintenance: the App Store listing (id 471394851) exists, and the company's help docs are current. The listing that was fetched did not show a clear latest version date, so none is stated here.

### NextSocial

Site: https://www.nextsocialapp.com/
App Store id: 6743662932

What it does: an RSVP-gated feed, with chirps and chat. The site says it is live on iOS and Android.

How close: partial, and pointed the wrong way. A subscribe that lets people post is the opposite of "subscribe does not grant posting."

Maintenance: listed on the US App Store, and the site says it is live on iOS and Android. No version date was captured.

### Live Social

App Store id: 6751132795

What it does: discovery, maps, chat, and ticketing.

How close: partial at best. It is a social and ticket product, not a page with a private notification policy.

Maintenance: downloadable on that store. The listing shows version 2.0.1 dated 20 April. The year of that April update was not stated. Copyright 2026.

### whipIT

Site: https://whipit.app
App Store id: 6756919073

What it does: a social network plus venues, chat, and tickets. The site links the App Store and Google Play.

How close: partial at best. Social, venues, and chat, not the shape.

Maintenance: listed, with store links on the site. No version date was captured.

### Mooment

Site: https://moomentapp.com/

What it does: a marketing site for a local events product. "Hickory City Pass" is marked coming soon.

How close: not a match on what is public. There is not enough product there to compare with the page and the pipe.

Maintenance: the marketing site is up. No App Store listing was found. It should not be treated as downloadable, and it should not be treated as abandoned either. One feature is still marked coming soon.

## What would count as the same thing

A match would need all of these at once:

- A public page with a shareable URL, open to read.
- Only approved publishers can post.
- Subscribing does not let you post.
- Each subscriber picks instant, a daily digest, specific publishers, or mute.
- Web Push, with no chat and no cap on how many people can subscribe.

Event Notis, PopIn, and Calen each have one or two of those pieces, as small live sites, and they stop there. Shotgun, DICE, and Bandsintown are actively maintained and downloadable, and they are ticketing. NextSocial, Live Social, and whipIT are listed social or ticket apps, and the ones with a feed also have chat or let the audience post. The 2019 itshuey repo is a picture of an app, not an app.

No product in this search is the shape written this morning.
