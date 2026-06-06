/**
 * src/utils.js
 * Berisi helper functions seperti parser, chunking, dan pengirim pesan.
 */

// Ekstraksi teks dari payload SeaTalk
export function extractIncomingText(message) {
  let incomingText = "";
  if (typeof message.text === "string") {
    incomingText = message.text;
  } else if (typeof message.text === "object" && message.text !== null) {
    incomingText = message.text.plain_text || message.text.content || "";
  } else if (typeof message.content === "string") {
    incomingText = message.content;
  }
  return incomingText.trim();
}

// Menghitung jumlah kata untuk fitur Auto-Threading
export function countWords(text) {
  return text.trim().split(/\s+/).length;
}

// Smart Chunking: Memecah pesan panjang tanpa merusak paragraf atau list
export function smartChunkMessage(text, limit = 3000) {
  const paragraphs = text.split('\n');
  const chunks = [];
  let currentChunk = "";

  for (const p of paragraphs) {
    // Jika menambah paragraf ini melebihi batas, simpan chunk saat ini
    if ((currentChunk.length + p.length + 1) > limit) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = p; // Mulai chunk baru
    } else {
      currentChunk += (currentChunk ? '\n' : '') + p;
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

// Fungsi utama untuk mengirim pesan balik ke SeaTalk API
export async function replyToUser(messageText, targetId, isGroup, threadId, originalMessageId) {
  const APP_ID = "NzE2Mjg3ODUxMjc5"; 
  const APP_SECRET = "c3urIS7asdvFi0rIwbhuAKBklGWY1yQv";

  const tokenRes = await fetch("https://openapi.seatalk.io/auth/app_access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  
  const tokenData = await tokenRes.json();
  if (!tokenData.app_access_token) return null;

  const endpoint = isGroup 
    ? "https://openapi.seatalk.io/messaging/v2/group_chat" 
    : "https://openapi.seatalk.io/messaging/v2/single_chat";

  let body;
  if (isGroup) {
      body = { 
          group_id: targetId,
          message: { tag: "text", text: { content: messageText } } 
      };
      if (threadId && threadId !== "") {
          body.thread_id = threadId;
      } else if (originalMessageId) {
          body.thread_id = originalMessageId; 
      }
  } else {
      body = { 
          employee_code: targetId, 
          message: { tag: "text", text: { content: messageText } } 
      };
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      "Authorization": `Bearer ${tokenData.app_access_token}` 
    },
    body: JSON.stringify(body)
  });

  const resData = await resp.json();
  // Mengembalikan data respon agar kita bisa mengambil message_id untuk thread
  return resData;
}

// Fungsi untuk menembak System Account Webhook (Cron Reports)
export async function sendSystemWebhook(webhookUrl, messageText) {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag: "text",
        text: { content: messageText }
      })
    });
  } catch (error) {
    console.log("DEBUG: Gagal mengirim webhook system account", error.message);
  }
}