export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Bot SeaTalk Aktif.", { status: 200 });
    }

    try {
      const payload = await request.clone().json();
      
      if (payload.event_type === "event_verification") {
        return new Response(JSON.stringify({ "seatalk_challenge": payload.event.seatalk_challenge }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      const eventType = payload.event_type;
      const incomingText = payload.event?.message?.text?.content?.trim() || "";
      const employeeCode = payload.event?.employee_code;

      if (incomingText && employeeCode) {
        console.log("Memproses AI untuk:", incomingText);
        // Mengirim ke fungsi AI (melewati env agar bisa akses AI binding)
        ctx.waitUntil(replyWithAI(employeeCode, incomingText, env));
      }

      return new Response(JSON.stringify({ "code": 0, "status": "success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    } catch (error) {
      console.error("Error utama:", error);
      return new Response(JSON.stringify({ "error": error.message }), { status: 500 });
    }
  }
};

async function replyWithAI(employeeCode, userPrompt, env) {
  const APP_ID = "NzE2Mjg3ODUxMjc5";
  const APP_SECRET = "c3urIS7asdvFi0rIwbhuAKBklGWY1yQv";

  try {
    // 1. Panggil AI untuk mendapatkan jawaban
    const aiResponse = await env.AI.run('@cf/nvidia/nemotron-3-8b-instruct-4k-fp8', {
      messages: [
        { role: 'system', content: 'Anda adalah asisten bot kantor yang ramah dan membantu.' },
        { role: 'user', content: userPrompt }
      ]
    });
    
    const botAnswer = aiResponse.response || "Maaf, saya tidak bisa memproses jawaban saat ini.";

    // 2. Dapatkan Token API SeaTalk
    const tokenRes = await fetch("https://openapi.seatalk.io/auth/app_access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
    });
    
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.app_access_token;

    // 3. Kirim Balasan ke SeaTalk
    await fetch("https://openapi.seatalk.io/messaging/v2/single_chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        employee_code: employeeCode,
        message: {
          tag: "text",
          text: { content: botAnswer }
        }
      })
    });
  } catch (err) {
    console.error("Error AI/API:", err);
  }
}
