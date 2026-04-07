// firebase-messaging-sw.js
// À placer à la RACINE de votre site (même niveau que index.html)

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBx6R4LC9HOt4wXbG2VmjI9nmLciwzDmz0",
  authDomain: "makouez-it.firebaseapp.com",
  projectId: "makouez-it",
  storageBucket: "makouez-it.firebasestorage.app",
  messagingSenderId: "558314427247",
  appId: "1:558314427247:web:83e656344dd79019ccce9a"
});

const messaging = firebase.messaging();

// Gestion des notifications en arrière-plan
messaging.onBackgroundMessage(payload => {
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || 'Makouez IT', {
    body:  body  || 'Mise à jour de votre réservation',
    icon:  icon  || '/icon-192.png',
    badge: '/icon-192.png',
    data:  payload.data || {},
    actions: [
      { action: 'view', title: 'Voir ma réservation' }
    ]
  });
});

// Clic sur la notification → ouvre la page de suivi
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const rdvId = event.notification.data?.rdvId;
  const url   = rdvId
    ? `https://makouezit.org/suivi-rdv.html?id=${rdvId}`
    : 'https://makouezit.org/mon-rdv.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
