importScripts("https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDNJpHm2zUExVeSumw3IJAtcpaY-VFa5Ks",
  authDomain: "dream-play-5147c.firebaseapp.com",
  projectId: "dream-play-5147c",
  storageBucket: "dream-play-5147c.firebasestorage.app",
  messagingSenderId: "565687121147",
  appId: "1:565687121147:web:c09168c38f1f31f04f6c5"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("Background message received:", payload);

  const notificationTitle =
    payload.notification?.title || "Dream Play";

  const notificationOptions = {
    body: payload.notification?.body || "New notification",
    icon: "/Dream-play-/sanju.png"
  };

  self.registration.showNotification(
    notificationTitle,
    notificationOptions
  );
});
