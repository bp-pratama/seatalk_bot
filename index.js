export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Bot SeaTalk Aktif (Mode AI).", { status: 200 });
    }

    try {
      const payload = await request.clone().json();
      
      // 1. TAHAP VERIFIKASI (PENTING!)
      if (payload.event_type === "event_verification") {
        return new Response(JSON.stringify({ "seatalk_challenge": payload.event.seatalk_challenge }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      // 2. TAHAP AI
      const incomingText = payload.event?.message?.text?.content?.trim() || "";
      const employeeCode = payload.event?.employee_code;

      if (incomingText && employeeCode) {
        console.log("Memproses AI untuk:", incomingText);
        
        // Menjalankan AI
        const aiResponse = await env.AI.run('@cf/nvidia/nemotron-3-120b-a12b', {
          prompt: incomingText
        });

        // Balas ke user
        ctx.waitUntil(replyToUser(employeeCode, aiResponse.response));
      }

      return new Response(JSON.stringify({ "code": 0, "status": "success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    } catch (error) {
      console.error("Error:", error);
      return new Response(JSON.stringify({ "error": error.message }), { status: 500 });
    }
  }
};

async function replyToUser(employeeCode, messageText) {
  const APP_ID = "NzE2Mjg3ODUxMjc5";
  const APP_SECRET = "c3urIS7asdvFi0rIwbhuAKBklGWY1yQv";

  // Ambil token dulu
  const tokenRes = await fetch("https://openapi.seatalk.io/auth/app_access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
  });
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.app_access_token;

  // Kirim pesan
  await fetch("https://openapi.seatalk.io/messaging/v2/single_chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      employee_code: employeeCode,
      message: { tag: "text", text: { content: messageText } }
    })
  });
}