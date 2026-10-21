importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAGsQtu9G5wEzldXPy0Scf7vuLM3-YMpFY",
  authDomain: "realconnect-5ec0d.firebaseapp.com",
  projectId: "realconnect-5ec0d",
  storageBucket: "realconnect-5ec0d.firebasestorage.app",
  messagingSenderId: "309844857391",
  appId: "1:309844857391:web:84f738dbb707982f57acda"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "RealConnect";
  const options = {
    body: payload.notification?.body || "You have a new notification.",
    icon: "/icons/icon-192.png"
  };

  self.registration.showNotification(title, options);
});
