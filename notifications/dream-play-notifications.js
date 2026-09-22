const admin = require("firebase-admin");

const ADMIN_UID = "6EsKceYMINh1Hiq9LRDH637HhlL2";

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
  // HELPER: SEND NOTIFICATION TO ADMIN TOKENS
  // =========================================================

  async function sendToAdminTokens(message) {
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

    if (adminTokens.length === 0) {
      return {
        success: false,
        successCount: 0,
        failureCount: 0
      };
    }

    const response =
      await messaging.sendEachForMulticast({
        ...message,
        tokens: adminTokens.map(
          (item) => item.token
        )
      });

    console.log(
      `📨 Notification result: Success ${response.successCount}, Failed ${response.failureCount}`
    );

    // Remove invalid tokens
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

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount
    };
  }

  // =========================================================
  // 1. H2H FULL NOTIFICATIONS
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

  for (const roomDoc of roomsSnapshot.docs) {
    const room = roomDoc.data();
    const roomId = roomDoc.id;

    const eventId =
      `h2h_full_${roomId}`;

    const eventRef = db
      .collection("notificationEvents")
      .doc(eventId);

    const eventSnapshot =
      await eventRef.get();

    if (eventSnapshot.exists) {
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
        const match =
          matchDoc.data();

        teamA =
          match.teamA || "Team A";

        teamB =
          match.teamB || "Team B";
      }
    }

    const amount =
      room.amount || 0;

    const title =
      "🔔 Dream Play — H2H FULL";

    const body =
      `${teamA} vs ${teamB} • ₹${amount} contest is FULL (2/2)`;

    console.log(
      `📢 Sending H2H notification: ${body}`
    );

    const message = {
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
        matchId:
          room.matchId || "",
        amount:
          String(amount)
      }
    };

    try {
      const response =
        await sendToAdminTokens(message);

      if (
        response.success &&
        response.successCount > 0
      ) {
        await eventRef.create({
          type: "h2h_full",

          roomId: roomId,

          matchId:
            room.matchId || "",

          amount: amount,

          teamA: teamA,

          teamB: teamB,

          sentAt:
            admin.firestore.FieldValue
              .serverTimestamp()
        });

        newH2HNotifications++;

        console.log(
          "✅ H2H notification recorded."
        );
      }

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

  // =========================================================
  // 2. PLAYER → ADMIN CHAT NOTIFICATIONS
  // =========================================================

  console.log("");
  console.log("========================================");
  console.log("💬 CHECKING PLAYER → ADMIN CHAT");
  console.log("========================================");

  // ---------------------------------------------------------
  // IMPORTANT:
  // We use collectionGroup("messages")
  // instead of collection("chats").
  //
  // This finds messages even when the parent chat document
  // does not exist.
  // ---------------------------------------------------------

  const messagesSnapshot = await db
    .collectionGroup("messages")
    .get();

  console.log(
    `💬 Total chat messages found: ${messagesSnapshot.size}`
  );

  // ---------------------------------------------------------
  // Create baseline on first run
  // ---------------------------------------------------------

  const baselineRef = db
    .collection("notificationState")
    .doc("chatBaseline");

  const baselineSnapshot =
    await baselineRef.get();

  if (!baselineSnapshot.exists) {

    console.log(
      "🛡️ Creating chat notification baseline..."
    );

    let baselineCount = 0;

    for (
      const messageDoc of messagesSnapshot.docs
    ) {

      const message =
        messageDoc.data();

      // Ignore admin messages
      if (
        message.senderUid === ADMIN_UID
      ) {
        continue;
      }

      const chatId =
        messageDoc.ref.parent.parent
          ? messageDoc.ref.parent.parent.id
          : "";

      const eventRef = db
        .collection("notificationEvents")
        .doc(
          `chat_player_${messageDoc.id}`
        );

      await eventRef.set({
        type: "chat_baseline",

        chatId: chatId,

        messageId:
          messageDoc.id,

        createdAt:
          admin.firestore.FieldValue
            .serverTimestamp()
      });

      baselineCount++;
    }

    await baselineRef.set({
      createdAt:
        admin.firestore.FieldValue
          .serverTimestamp()
    });

    console.log(
      `✅ Chat baseline created. Existing messages marked: ${baselineCount}`
    );

    console.log(
      "ℹ️ New player messages will notify from the next workflow run."
    );

  } else {

    // =======================================================
    // PROCESS NEW PLAYER MESSAGES
    // =======================================================

    let newChatNotifications = 0;

    for (
      const messageDoc of messagesSnapshot.docs
    ) {

      const message =
        messageDoc.data();

      // Ignore Admin → Player messages
      if (
        !message.senderUid ||
        message.senderUid === ADMIN_UID
      ) {
        continue;
      }

      const messageId =
        messageDoc.id;

      // Get chat ID from:
      //
      // chats/{chatId}/messages/{messageId}
      //
      const chatParent =
        messageDoc.ref.parent.parent;

      if (!chatParent) {
        continue;
      }

      const chatId =
        chatParent.id;

      // Only our private admin/player chats
      if (
        !chatId.startsWith("admin_")
      ) {
        continue;
      }

      const eventId =
        `chat_player_${messageId}`;

      const eventRef = db
        .collection("notificationEvents")
        .doc(eventId);

      const eventSnapshot =
        await eventRef.get();

      // Already notified
      if (eventSnapshot.exists) {
        continue;
      }

      const playerName =
        message.senderName || "Player";

      const text =
        String(message.text || "")
          .trim();

      if (!text) {
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
        `📢 Sending player chat notification: ${body}`
      );

      const chatMessage = {

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

        const response =
          await sendToAdminTokens(
            chatMessage
          );

        if (
          response.success &&
          response.successCount > 0
        ) {

          await eventRef.create({

            type: "chat_message",

            chatId: chatId,

            messageId: messageId,

            senderUid:
              message.senderUid,

            senderName:
              playerName,

            text: text,

            sentAt:
              admin.firestore.FieldValue
                .serverTimestamp()
          });

          newChatNotifications++;

          console.log(
            "✅ Player chat notification recorded."
          );
        }

      } catch (error) {

        console.error(
          `❌ Chat notification failed for message ${messageId}:`,
          error.message
        );

      }
    }

    console.log(
      `💬 New player chat notifications sent: ${newChatNotifications}`
    );
  }

  // =========================================================
  // FINISHED
  // =========================================================

  console.log("");
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
