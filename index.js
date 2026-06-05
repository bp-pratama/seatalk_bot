export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Bot SeaTalk Aktif (Mode AI).", { status: 200 });
    }

    try {
      const payload = await request.json();
      
      // 1. Verifikasi Event
      if (payload.event_type === "event_verification") {
        return new Response(JSON.stringify({ "seatalk_challenge": payload.event.seatalk_challenge }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      // 2. Ekstraksi Data
      const incomingText = payload.event?.message?.text?.content?.trim();
      const employeeCode = payload.event?.employee_code;

      if (incomingText && employeeCode) {
        // Jalankan tugas di latar belakang agar respon ke SeaTalk cepat
        ctx.waitUntil(handleAiReply(env, employeeCode, incomingText));
      }

      return new Response(JSON.stringify({ "code": 0, "status": "success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    } catch (error) {
      console.error("Worker Error:", error);
      return new Response(JSON.stringify({ "error": error.message }), { status: 500 });
    }
  }
};

async function handleAiReply(env, employeeCode, text) {
  try {
    // 1. Dapatkan Respon AI
    const aiResponse = await env.AI.run('@cf/nvidia/nemotron-3-120b-a12b', {
      prompt: text
    });
    
    const message = aiResponse.response || "Maaf, saya tidak mengerti.";

    // 2. Kirim ke SeaTalk
    await replyToUser(message, employeeCode);
  } catch (err) {
    console.error("AI/Reply Error:", err);
  }
}

async function replyToUser(messageText, employeeCode) {
  // Gunakan env variable untuk keamanan, jangan di-hardcode di script!
  const APP_ID = "NzE2Mjg3ODUxMjc5"; 
  const APP_SECRET = "c3urIS7asdvFi0rIwbhuAKBklGWY1yQv";

  // Ambil Access Token
  const tokenRes = await fetch("https://openapi.seatalk.io/auth/app_access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  
  const tokenData = await tokenRes.json();
  if (!tokenData.app_access_token) throw new Error("Gagal mengambil token");

  // Kirim Pesan
  const response = await fetch("https://openapi.seatalk.io/messaging/v2/single_chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tokenData.app_access_token}`
    },
    body: JSON.stringify({
      employee_code: employeeCode,
      message: { tag: "text", text: { content: messageText } }
    })
  });

  if (!response.ok) {
    const errorDetails = await response.text();
    throw new Error(`SeaTalk API Error: ${errorDetails}`);
  }
}