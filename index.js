export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Bot Active", { status: 200 });

    try {
      const payload = await request.json();
      console.log("DEBUG: RAW PAYLOAD RECEIVED:", JSON.stringify(payload));

      const event = payload.event || {};

      if (payload.event_type === "event_verification") {
        return new Response(JSON.stringify({ "seatalk_challenge": event.seatalk_challenge }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      const message = event.message || {};
      let incomingText = "";
      
      if (typeof message.text === "string") {
        incomingText = message.text;
      } else if (typeof message.text === "object" && message.text !== null) {
        incomingText = message.text.plain_text || message.text.content || "";
      } else if (typeof message.content === "string") {
        incomingText = message.content;
      }
      
      incomingText = incomingText.trim();

      const groupId = event.group_id;
      const employeeCode = event.employee_code || event.message?.sender?.employee_code || event.sender_id;
      
      const isGroup = !!groupId;
      const targetId = groupId || employeeCode;
      
      const threadId = message.thread_id || ""; 
      const originalMessageId = message.message_id;

      if (!incomingText || !targetId) {
        return new Response("OK", { status: 200 });
      }

      console.log(`DEBUG: Memproses ${isGroup ? "GRUP" : "JAPRI"} - Target ID: ${targetId} | Thread ID: ${threadId} | Pesan: ${incomingText}`);

      await handleAiReply(env, targetId, incomingText, isGroup, threadId, originalMessageId);

      return new Response(JSON.stringify({ "code": 0 }), { status: 200 });
    } catch (error) {
      console.log("DEBUG: Fatal Error di fetch:", error.message);
      return new Response("OK", { status: 200 });
    }
  }
};

async function handleAiReply(env, targetId, text, isGroup, threadId, originalMessageId) {
  try {
    const kvKey = `history_${targetId}`;
    let history = [];

    try {
      const rawHistory = await env.BOT_MEMORY.get(kvKey);
      if (rawHistory) {
         history = JSON.parse(rawHistory);
         if (!Array.isArray(history)) history = [];
      }
    } catch (e) {
      console.log("DEBUG: History format invalid, mereset memori.");
      history = [];
    }

    history.push({ role: "user", content: text });
    if (history.length > 6) history = history.slice(-6);

    const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: "system", content: "Kamu asisten yang ramah." }, ...history],
    });

    const reply = aiResponse.response || "Maaf, saya tidak mengerti.";
    
    history.push({ role: "assistant", content: reply });
    await env.BOT_MEMORY.put(kvKey, JSON.stringify(history), { expirationTtl: 3600 });
    
    await replyToUser(reply, targetId, isGroup, threadId, originalMessageId);
  } catch (err) {
    console.log("DEBUG: Error di AI:", err.message);
  }
}

async function replyToUser(messageText, targetId, isGroup, threadId, originalMessageId) {
  const APP_ID = "NzE2Mjg3ODUxMjc5"; 
  const APP_SECRET = "c3urIS7asdvFi0rIwbhuAKBklGWY1yQv";

  const tokenRes = await fetch("https://openapi.seatalk.io/auth/app_access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  
  const tokenData = await tokenRes.json();
  if (!tokenData.app_access_token) return;

  const endpoint = isGroup 
    ? "https://openapi.seatalk.io/messaging/v2/group_chat" 
    : "https://openapi.seatalk.io/messaging/v2/single_chat";

  let body;
  if (isGroup) {
      body = { 
          group_id: targetId, // <---- PERBAIKAN: Menggunakan group_id
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
  console.log(`DEBUG: Status Kirim ${isGroup ? "Grup" : "Japri"} (${resp.status}):`, JSON.stringify(resData));
}