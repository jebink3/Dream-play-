const admin = require("firebase-admin");

async function main() {
  console.log("🚀 Dream Play H2H notification checker started");

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

  // =========================================================
  // 1. GET ADMIN NOTIFICATION TOKENS
  // =========================================================

  const tokenSnapshot = await db
    .collection("adminNotificationTokens")
    .get();

  const adminTokens = [];

  tokenSnapshot.forEach((doc) => {
    const data = doc.data();

    if (data.token) {
      adminTokens.push({
        id: doc.id,
        token: data.token
      });
    }
  });

  console.log(
    `📱 Admin notification tokens found: ${adminTokens.length}`
  );

  // =========================================================
  // 2. H2H FULL NOTIFICATIONS
  // =========================================================

  if (adminTokens.length === 0) {
    console.log(
      "⚠️ No admin notification tokens available."
    );

    console.log(
      "🏁 Dream Play H2H notification checker finished."
    );

    return;
  }

  const roomsSnapshot = await db
    .collection("rooms")
    .where("status", "==", "full")
    .get();

  console.log(
    `🏠 Full rooms found: ${roomsSnapshot.size}`
  );

  let newH2HNotifications = 0;

  for (const roomDoc of roomsSnapshot.docs) {
    const room = roomDoc.data();
    const roomId = roomDoc.id;

    // One notification only for each full room.
    const eventId = `h2h_full_${roomId}`;

    const eventRef = db
      .collection("notificationEvents")
      .doc(eventId);

    const eventSnapshot = await eventRef.get();

    if (eventSnapshot.exists) {
      continue;
    }

    // =======================================================
    // GET MATCH TEAM NAMES
    // =======================================================

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

    console.log(
      `📢 Sending H2H notification: ${body}`
    );

    const message = {
      tokens: adminTokens.map(
        (item) => item.token
      ),

      notification: {
        title: title,
        body: body
      },

      webpush: {
        notification: {
          title: title,
          body: body,
          icon:
            "https://jebink3.github.io/Dream-play-/sanju.png"
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
      const response =
        await messaging.sendEachForMulticast(message);

      console.log(
        `✅ H2H notification sent. Success: ${response.successCount}, Failed: ${response.failureCount}`
      );

      // =====================================================
      // REMOVE INVALID ADMIN TOKENS
      // =====================================================

      for (
        let i = 0;
        i < response.responses.length;
        i++
      ) {
        const result = response.responses[i];

        if (!result.success) {
          const errorCode =
            result.error?.code || "";

          if (
            errorCode.includes(
              "registration-token-not-registered"
            ) ||
            errorCode.includes(
              "invalid-registration-token"
            )
          ) {
            const tokenId =
              adminTokens[i].id;

            await db
              .collection("adminNotificationTokens")
              .doc(tokenId)
              .delete();

            console.log(
              `🗑️ Removed invalid admin token: ${tokenId}`
            );
          }
        }
      }

      // =====================================================
      // SAVE EVENT SO THIS ROOM IS NOT NOTIFIED AGAIN
      // =====================================================

      await eventRef.create({
        type: "h2h_full",
        roomId: roomId,
        matchId: room.matchId || "",
        amount: amount,
        teamA: teamA,
        teamB: teamB,
        sentAt:
          admin.firestore.FieldValue
            .serverTimestamp()
      });

      newH2HNotifications++;

    } catch (error) {
      console.error(
        `❌ H2H notification failed for room ${roomId}:`,
        error.message
      );
    }
  }

  console.log(
    `🎯 New H2H notifications sent: ${newH2HNotifications}`
  );

  console.log(
    "🏁 Dream Play H2H notification checker finished."
  );
}

main().catch((error) => {
  console.error(
    "❌ Dream Play H2H notification checker failed:"
  );

  console.error(error);

  process.exit(1);
});
