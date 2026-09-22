const admin = require("firebase-admin");

async function main() {
  console.log("🚀 Dream Play notification checker started");

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT secret is missing");
  }

  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT
  );

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  const db = admin.firestore();
  const messaging = admin.messaging();

  // Get all admin notification tokens
  const tokenSnapshot = await db
    .collection("adminNotificationTokens")
    .get();

  const tokens = [];

  tokenSnapshot.forEach((doc) => {
    const data = doc.data();

    if (data.token) {
      tokens.push({
        id: doc.id,
        token: data.token
      });
    }
  });

  console.log(`📱 Admin notification tokens found: ${tokens.length}`);

  if (tokens.length === 0) {
    console.log("⚠️ No admin notification tokens found.");
    return;
  }

  // Find all H2H rooms that are full
  const roomsSnapshot = await db
    .collection("rooms")
    .where("status", "==", "full")
    .get();

  console.log(`🏠 Full rooms found: ${roomsSnapshot.size}`);

  let newNotifications = 0;

  for (const roomDoc of roomsSnapshot.docs) {
    const room = roomDoc.data();
    const roomId = roomDoc.id;

    // Unique event ID prevents duplicate notifications
    const eventId = `h2h_full_${roomId}`;

    const eventRef = db
      .collection("notificationEvents")
      .doc(eventId);

    // Check whether this room was already notified
    const eventSnapshot = await eventRef.get();

    if (eventSnapshot.exists) {
      continue;
    }

    // Get match information
    let teamA = "Team A";
    let teamB = "Team B";

    if (room.matchId) {
      const matchDoc = await db
        .collection("matches")
        .doc(room.matchId)
        .get();

      if (matchDoc.exists) {
        const match = matchDoc.data();

        teamA = match.teamA || "Team A";
        teamB = match.teamB || "Team B";
      }
    }

    const amount = room.amount || 0;

    const title = "🔔 Dream Play — H2H FULL";

    const body =
      `${teamA} vs ${teamB} • ₹${amount} contest is FULL (2/2)`;

    console.log(`📢 Sending notification: ${body}`);

    const message = {
      tokens: tokens.map((item) => item.token),

      notification: {
        title: title,
        body: body
      },

      webpush: {
        notification: {
          title: title,
          body: body,
          icon: "https://jebink3.github.io/Dream-play-/sanju.png"
        }
      },

      data: {
        type: "h2h_full",
        roomId: roomId,
        matchId: room.matchId || "",
        amount: String(amount)
      }
    };

    try {
      const response = await messaging.sendEachForMulticast(message);

      console.log(
        `✅ Notification sent. Success: ${response.successCount}, Failed: ${response.failureCount}`
      );

      // Remove invalid/expired FCM tokens
      for (let i = 0; i < response.responses.length; i++) {
        const result = response.responses[i];

        if (!result.success) {
          const errorCode = result.error?.code || "";

          if (
            errorCode.includes("registration-token-not-registered") ||
            errorCode.includes("invalid-registration-token")
          ) {
            const tokenId = tokens[i].id;

            await db
              .collection("adminNotificationTokens")
              .doc(tokenId)
              .delete();

            console.log(`🗑️ Removed invalid token: ${tokenId}`);
          }
        }
      }

      // Mark this room as notified
      await eventRef.create({
        type: "h2h_full",
        roomId: roomId,
        matchId: room.matchId || "",
        amount: amount,
        teamA: teamA,
        teamB: teamB,
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      });

      newNotifications++;

    } catch (error) {
      console.error(
        `❌ Notification failed for room ${roomId}:`,
        error.message
      );
    }
  }

  console.log(
    `🎯 Finished. New notifications sent: ${newNotifications}`
  );
}

main().catch((error) => {
  console.error("❌ Dream Play notification checker failed:");
  console.error(error);
  process.exit(1);
});
