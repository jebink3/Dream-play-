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

  if (adminTokens.length > 0) {

    const roomsSnapshot = await db
      .collection("rooms")
      .where("status", "==", "full")
      .get();

    console.log(`🏠 Full rooms found: ${roomsSnapshot.size}`);

    let newH2HNotifications = 0;

    for (const roomDoc of roomsSnapshot.docs) {

      const room = roomDoc.data();
      const roomId = roomDoc.id;

      const eventId = `h2h_full_${roomId}`;

      const eventRef = db
        .collection("notificationEvents")
        .doc(eventId);

      const eventSnapshot = await eventRef.get();

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

        // Remove invalid tokens
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

  } else {

    console.log(
      "⚠️ No admin notification tokens available for H2H notifications."
    );

  }

  // =========================================================
  // 3. PLAYER → ADMIN CHAT NOTIFICATIONS
  // =========================================================

  if (adminTokens.length > 0) {

    console.log("💬 Checking player chat messages...");

    const chatsSnapshot = await db
      .collection("chats")
      .get();
    // First chat-notification run:
    // mark existing messages as already seen.
    const baselineRef = db
      .collection("notificationState")
      .doc("chatBaseline");

    const baselineSnapshot = await baselineRef.get();

    if (!baselineSnapshot.exists) {

      console.log("🛡️ Creating chat notification baseline...");

      for (const chatDoc of chatsSnapshot.docs) {

        const existingMessages = await db
          .collection("chats")
          .doc(chatDoc.id)
          .collection("messages")
          .get();

        for (const messageDoc of existingMessages.docs) {

          const eventRef = db
            .collection("notificationEvents")
            .doc(`chat_player_${messageDoc.id}`);

          await eventRef.set({
            type: "chat_baseline",
            chatId: chatDoc.id,
            messageId: messageDoc.id,
            createdAt:
              admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }

      await baselineRef.set({
        createdAt:
          admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(
        "✅ Chat baseline created. Old messages will not notify."
      );

      return;
    }
    console.log(
      `💬 Chat conversations found: ${chatsSnapshot.size}`
    );

    let newChatNotifications = 0;

    for (const chatDoc of chatsSnapshot.docs) {

      const chatId = chatDoc.id;

      // Current Dream Play private chat format:
      // admin_PLAYER_UID
      if (!chatId.startsWith("admin_")) {
        continue;
      }

      const messagesSnapshot = await db
        .collection("chats")
        .doc(chatId)
        .collection("messages")
        .get();

      for (
        const messageDoc of messagesSnapshot.docs
      ) {

        const message = messageDoc.data();

        // Ignore Admin → Player messages here.
        if (
          !message.senderUid ||
          message.senderUid === ADMIN_UID
        ) {
          continue;
        }

        const messageId = messageDoc.id;

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
          String(message.text || "").trim();

        if (!text) {
          continue;
        }

        // Keep notification body short
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
            type: "chat_message",
            chatId: chatId,
            messageId: messageId
          }

        };

        try {

          const response =
            await messaging.sendEachForMulticast(
              chatMessage
            );

          console.log(
            `✅ Chat notification sent. Success: ${response.successCount}, Failed: ${response.failureCount}`
          );

          // Remove invalid admin tokens
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

          // Mark this chat message as notified
          await eventRef.create({

            type: "chat_message",

            chatId: chatId,

            messageId: messageId,

            senderUid:
              message.senderUid,

            senderName:
              playerName,

            sentAt:
              admin.firestore.FieldValue
                .serverTimestamp()

          });

          newChatNotifications++;

        } catch (error) {

          console.error(
            `❌ Chat notification failed for message ${messageId}:`,
            error.message
          );

        }

      }

    }

    console.log(
      `💬 New player chat notifications sent: ${newChatNotifications}`
    );

  } else {

    console.log(
      "⚠️ No admin tokens available for chat notifications."
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
