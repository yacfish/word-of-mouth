// Server-rendered pages. Every piece of user content must pass through escapeHtml.

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

export function renderDocument(input: {
  title: string;
  bodyHtml: string;
  signedIn: boolean;
  csrf: string | null;
  iosNote: boolean;
  askPush: boolean;
  vapidPublicKey: string | null;
}): string {
  const signOut = input.signedIn && input.csrf
    ? `<form method="post" action="/sign-out" class="inline">
        <input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}">
        <button type="submit">Sign out</button>
      </form>`
    : '';
  const note = input.iosNote
    ? `<p id="ios-push-note" class="note">On iPhone or iPad, add Word of Mouth to the Home Screen, or push will not arrive. This needs iOS 16.4 or newer.</p>`
    : '';
  const config = safeJson({
    csrf: input.csrf ?? '',
    vapidPublicKey: input.vapidPublicKey ?? '',
    askPush: Boolean(input.askPush && input.csrf && input.vapidPublicKey),
    iosNote: input.iosNote,
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <link rel="stylesheet" href="/styles.css">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Word of Mouth">
</head>
<body>
  <header class="top">
    <a href="/" class="brand">Word of Mouth</a>
    ${signOut}
  </header>
  ${note}
  ${input.bodyHtml}
  <script id="wom-config" type="application/json">${config}</script>
  <script>
    (function () {
      var node = document.getElementById('wom-config');
      var wom = {};
      try { wom = JSON.parse(node ? node.textContent || '{}' : '{}'); } catch (err) { wom = {}; }
      if (wom.iosNote && (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone)) {
        var note = document.getElementById('ios-push-note');
        if (note) note.remove();
      }
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(function () {});
      }
      function urlBase64ToUint8Array(base64String) {
        var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        var raw = atob(base64);
        var out = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
        return out;
      }
      if (!wom.askPush || !wom.vapidPublicKey || !wom.csrf) return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
      navigator.serviceWorker.ready.then(function (reg) {
        return Notification.requestPermission().then(function (permission) {
          if (permission !== 'granted') return null;
          return reg.pushManager.getSubscription().then(function (existing) {
            if (existing) return existing;
            return reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(wom.vapidPublicKey)
            });
          });
        }).then(function (sub) {
          if (!sub) return;
          return fetch('/push/subscribe', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf': wom.csrf },
            body: JSON.stringify(sub)
          });
        });
      }).catch(function () {});
    })();
  </script>
</body>
</html>
`;
}
