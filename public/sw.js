self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Word of Mouth', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Word of Mouth';
  const body = data.body || '';
  const url = data.url || '/';
  event.waitUntil(self.registration.showNotification(title, { body, data: { url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/';
  const target = new URL(raw, self.location.origin).href;
  event.waitUntil(self.clients.openWindow(target));
});
