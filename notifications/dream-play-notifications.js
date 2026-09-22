const admin = require("firebase-admin");

const ADMIN_UID = "6EsKceYMINh1Hiq9LRDH637HhlL2";

async function sendToAdminTokens(db, messaging, adminTokens, message) {
  const response = await messaging.sendEachForMulticast(message);

  console.log(
    `✅ Notification sent. Success: ${response.successCount}, Failed: ${response.failureCount}`
  );

  // Remove invalid tokens
  for (let i = 0; i < response.responses.length; i++) {
    const result = response.responses[i];

    if (!result.success) {
      const errorCode = result.error?.code || "";

      if (
        errorCode.includes("registration-token-not-registered") ||
        errorCode.includes("invalid-registration-token")
      ) {
        const tokenId = adminTokens[i].id;

        await db
          .collection("adminNotificationTokens")
          .doc(tokenId)
          .delete();

        console.log(`🗑️ Removed invalid admin token: ${tokenId}`);
      }
    }
  }

  return response;
}

async function claimNotificationEvent(db, eventId, data) {
  const eventRef = db
    .collection("notificationEvents")
    .doc(eventId);

  try {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(eventRef);

      if (snapshot.exists) {
        throw new Error("ALREADY_SENT");
      }

      transaction.create(eventRef, {
        ...data,
        status: "sending",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return true;

  } catch (error) {
    if (error.message === "ALREADY_SENT") {
      return false;
    }

    throw error;
  }
}

async function markNotificationSent(db, eventId) {
  await db
    .collection("notificationEvents")
    .doc(eventId)
    .update({
      status: "sent",
      sentAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

async function removeNotificationClaim(db, eventId) {
  await db
    .collection("notificationEvents")
    .doc(eventId)
    .delete()
    .catch(() => {});
}

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

  // =========================================================
  // 1. ADMIN NOTIFICATION TOKENS
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

  if (adminTokens.length > 0) {

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

      const eventId = `h2h_full_${roomId}`;

      // Reserve event BEFORE sending
      const claimed = await claimNotificationEvent(
        db,
        eventId,
        {
          type: "h2h_full",
          roomId: roomId,
          matchId: room.matchId || "",
          amount: room.amount || 0
        }
      );

      if (!claimed) {
        continue;
      }

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

      const title =
        "🔔 Dream Play — H2H FULL";

      const body =
        `${teamA} vs ${teamB} • ₹${amount} contest is FULL (2/2)`;

      console.log(
        `📢 Sending H2H notification: ${body}`
      );

      const message = {

        tokens: adminTokens.map(
          item => item.token
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

        await sendToAdminTokens(
          db,
          messaging,
          adminTokens,
          message
        );

        await db
          .collection("notificationEvents")
          .doc(eventId)
          .update({
            status: "sent",
            teamA: teamA,
            teamB: teamB,
            sentAt:
              admin.firestore.FieldValue.serverTimestamp()
          });

        newH2HNotifications++;

      } catch (error) {

        console.error(
          `❌ H2H notification failed for ${roomId}:`,
          error.message
        );

        // Allow retry on next workflow run
        await removeNotificationClaim(
          db,
          eventId
        );

      }

    }

    console.log(
      `🎯 New H2H notifications sent: ${newH2HNotifications}`
    );

  }

  // =========================================================
  // 3. PLAYER → ADMIN CHAT NOTIFICATIONS
  // =========================================================

  if (adminTokens.length > 0) {

    console.log(
      "💬 Checking player chat messages..."
    );

    const chatsSnapshot = await db
      .collection("chats")
      .get();

    console.log(
      `💬 Chat conversations found: ${chatsSnapshot.size}`
    );

    let newChatNotifications = 0;

    for (const chatDoc of chatsSnapshot.docs) {

      const chatId = chatDoc.id;

      // Only private admin_player chats
      if (!chatId.startsWith("admin_")) {
        continue;
      }

      const messagesSnapshot = await db
        .collection("chats")
        .doc(chatId)
        .collection("messages")
        .get();

      for (const messageDoc of messagesSnapshot.docs) {

        const message = messageDoc.data();

        // Ignore Admin → Player messages
        if (
          !message.senderUid ||
          message.senderUid === ADMIN_UID
        ) {
          continue;
        }

        const messageId = messageDoc.id;

        const eventId =
          `chat_player_${messageId}`;

        // IMPORTANT:
        // Reserve BEFORE sending.
        // This prevents duplicate notifications.
        const claimed = await claimNotificationEvent(
          db,
          eventId,
          {
            type: "chat_message",
            chatId: chatId,
            messageId: messageId,
            senderUid: message.senderUid,
            senderName:
              message.senderName || "Player"
          }
        );

        if (!claimed) {
          continue;
        }

        const playerName =
          message.senderName || "Player";

        const text =
          String(message.text || "").trim();

        if (!text) {

          await removeNotificationClaim(
            db,
            eventId
          );

          continue;
        }

        const shortText =
          text.length > 120
            ? text.substring(0, 117) + "..."
            : text;

        const title =
          "💬 Dream Play — New Message";

        const body =
          `${playerName}: ${shortText}`;

        console.log(
          `📢 Sending chat notification: ${body}`
        );

        const chatMessage = {

          tokens: adminTokens.map(
            item => item.token
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
            type: "chat_message",
            chatId: chatId,
            messageId: messageId
          }

        };

        try {

          await sendToAdminTokens(
            db,
            messaging,
            adminTokens,
            chatMessage
          );

          await markNotificationSent(
            db,
            eventId
          );

          newChatNotifications++;

        } catch (error) {

          console.error(
            `❌ Chat notification failed for ${messageId}:`,
            error.message
          );

          // Allow retry
          await removeNotificationClaim(
            db,
            eventId
          );

        }

      }

    }

    console.log(
      `💬 New player chat notifications sent: ${newChatNotifications}`
    );

  }

  console.log(
    "🏁 Dream Play notification checker finished."
  );
}

main().catch((error) => {

  console.error(
    "❌ Dream Play notification checker failed:"
  );

  console.error(error);

  process.exit(1);

});
