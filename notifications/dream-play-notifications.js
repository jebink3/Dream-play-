const admin = require("firebase-admin");

async function main() {
  console.log("🚀 Dream Play H2H notification checker started");

  // =========================================================
  // FIREBASE SERVICE ACCOUNT
  // =========================================================

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT secret is missing"
    );
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

  console.log("📱 Checking admin notification tokens...");

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
  // STOP IF THERE IS NO ADMIN TOKEN
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

  // =========================================================
  // 2. CHECK FULL H2H ROOMS
  // =========================================================

  console.log("");
  console.log("========================================");
  console.log("🏏 CHECKING H2H FULL ROOMS");
  console.log("========================================");

  const roomsSnapshot = await db
    .collection("rooms")
    .where("status", "==", "full")
    .get();

  console.log(
    `🏠 Full rooms found: ${roomsSnapshot.size}`
  );

  let newH2HNotifications = 0;

  // =========================================================
  // 3. CHECK EACH FULL ROOM
  // =========================================================

  for (const roomDoc of roomsSnapshot.docs) {
    const room = roomDoc.data();
    const roomId = roomDoc.id;

    // -------------------------------------------------------
    // Create a unique event ID.
    // This prevents the same room from sending
    // the notification again and again.
    // -------------------------------------------------------

    const eventId = `h2h_full_${roomId}`;

    const eventRef = db
      .collection("notificationEvents")
      .doc(eventId);

    const eventSnapshot = await eventRef.get();

    // Already notified
    if (eventSnapshot.exists) {
      continue;
    }

    // =======================================================
    // 4. GET MATCH INFORMATION
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

    // =======================================================
    // 5. GET H2H AMOUNT
    // =======================================================

    const amount = room.amount || 0;

    // =======================================================
    // 6. CREATE NOTIFICATION
    // =======================================================

    const title =
      "🔔 Dream Play — H2H FULL";

    const body =
      `${teamA} vs ${teamB} • ₹${amount} contest is FULL (2/2)`;

    console.log("");
    console.log(
      `📢 Sending H2H notification: ${body}`
    );

    // =======================================================
    // 7. FCM MESSAGE
    // =======================================================

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

    // =======================================================
    // 8. SEND NOTIFICATION
    // =======================================================

    try {
      const response =
        await messaging.sendEachForMulticast(
          message
        );

      console.log(
        `✅ H2H notification sent. Success: ${response.successCount}, Failed: ${response.failureCount}`
      );

      // =====================================================
      // 9. REMOVE INVALID TOKENS
      // =====================================================

      for (
        let i = 0;
        i < response.responses.length;
        i++
      ) {
        const result =
          response.responses[i];

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
              .collection(
                "adminNotificationTokens"
              )
              .doc(tokenId)
              .delete();

            console.log(
              `🗑️ Removed invalid admin token: ${tokenId}`
            );
          }
        }
      }

      // =====================================================
      // 10. SAVE NOTIFICATION EVENT
      // =====================================================
      //
      // This makes sure the same full room is not
      // notified repeatedly every 5 minutes.
      //

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

      console.log(
        `💾 Notification event saved for room: ${roomId}`
      );

    } catch (error) {
      console.error(
        `❌ H2H notification failed for room ${roomId}:`,
        error.message
      );
    }
  }

  // =========================================================
  // 11. FINAL RESULT
  // =========================================================

  console.log("");
  console.log("========================================");

  console.log(
    `🎯 New H2H notifications sent: ${newH2HNotifications}`
  );

  console.log(
    "🚫 Player chat notifications: DISABLED"
  );

  console.log(
    "📱 WhatsApp chat: USE WHATSAPP"
  );

  console.log("========================================");

  console.log(
    "🏁 Dream Play H2H notification checker finished."
  );
}

// ===========================================================
// ERROR HANDLING
// ===========================================================

main().catch((error) => {
  console.error(
    "❌ Dream Play H2H notification checker failed:"
  );

  console.error(error);

  process.exit(1);
});
