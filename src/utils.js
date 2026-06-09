/**
 * src/utils.js
 */

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

export function countWords(text) {
  return text.trim().split(/\s+/).length;
}

export function smartChunkMessage(text, limit = 1500) { 
  const paragraphs = text.split('\n');
  const chunks = [];
  let currentChunk = "";

  for (const p of paragraphs) {
    if ((currentChunk.length + p.length + 1) > limit) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = p; 
    } else {
      currentChunk += (currentChunk ? '\n' : '') + p;
    }
  }
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

export async function replyToUser(env, messageText, targetId, isGroup, threadId, originalMessageId) {
  const cacheKey = "seatalk_access_token";
  let token = await env.BOT_MEMORY.get(cacheKey);

  if (!token) {
    const tokenRes = await fetch("https://openapi.seatalk.io/auth/app_access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: env.SEATALK_APP_ID, app_secret: env.SEATALK_APP_SECRET })
    });
    
    const tokenData = await tokenRes.json();
    if (!tokenData.app_access_token) {
      console.log("DEBUG: Gagal mendapatkan token SeaTalk", tokenData);
      return null;
    }
    token = tokenData.app_access_token;
    await env.BOT_MEMORY.put(cacheKey, token, { expirationTtl: 7000 }); // Cache berlaku ~1.9 jam
  }

  const endpoint = isGroup 
    ? "https://openapi.seatalk.io/messaging/v2/group_chat" 
    : "https://openapi.seatalk.io/messaging/v2/single_chat";

  let body = isGroup ? { group_id: targetId } : { employee_code: targetId };
  body.message = { tag: "text", text: { content: messageText } };

  if (isGroup) {
      if (threadId && threadId !== "") {
          body.thread_id = threadId;
      } else if (originalMessageId) {
          body.thread_id = originalMessageId; 
      }
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      "Authorization": `Bearer ${token}` 
    },
    body: JSON.stringify(body)
  });

  return await resp.json();
}

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

export async function sendScreenshotToUser(env, buffer, targetId, isGroup, threadId) {
    console.log("DEBUG: sendScreenshotToUser dipanggil, fitur segera disesuaikan.");
    return null;
}