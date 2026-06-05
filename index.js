export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Bot SeaTalk Aktif.", { status: 200 });
    }

    try {
      const payload = await request.clone().json();
      console.log("Event diterima:", JSON.stringify(payload));

      // 1. TAHAP VERIFIKASI
      if (payload.event_type === "event_verification") {
        return new Response(JSON.stringify({ "seatalk_challenge": payload.event.seatalk_challenge }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      // 2. TAHAP PENANGANAN PESAN
      // Kita masukkan semua kemungkinan event_type agar bot tidak "buta"
      const eventType = payload.event_type;
      
      // Ambil teks dan employee_code berdasarkan struktur log Anda yang terbaru
      const incomingText = payload.event?.message?.text?.content?.trim().toLowerCase() || "";
      const employeeCode = payload.event?.employee_code;

      console.log("Mengecek pesan:", incomingText, "dari:", employeeCode);

      if (incomingText === "halo" && employeeCode) {
        console.log("Kondisi terpenuhi, mengirim balasan...");
        ctx.waitUntil(replyToUser(employeeCode, "Halo juga!"));
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

async function replyToUser(employeeCode, messageText) {
  const APP_ID = "NzE2Mjg3ODUxMjc5";
  const APP_SECRET = "c3urIS7asdvFi0rIwbhuAKBklGWY1yQv";

  try {
    // 1. Get Token
    const tokenRes = await fetch("https://openapi.seatalk.io/auth/app_access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
    });
    
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.app_access_token;

    if (!accessToken) throw new Error("Gagal ambil token: " + JSON.stringify(tokenData));

    // 2. Send Message
    const sendRes = await fetch("https://openapi.seatalk.io/messaging/v2/single_chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        employee_code: employeeCode,
        message: {
          tag: "text",
          text: { content: messageText }
        }
      })
    });

    const sendData = await sendRes.json();
    console.log("Hasil kirim pesan:", JSON.stringify(sendData));
  } catch (err) {
    console.error("Error fungsi replyToUser:", err);
  }
}
