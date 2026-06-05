export default {
  async fetch(request, env, ctx) {
    // Hanya proses request POST dari SeaTalk
    if (request.method !== "POST") {
      return new Response("Bot SeaTalk Aktif di Cloudflare. Menunggu event...", { status: 200 });
    }

    try {
      // Ambil data JSON yang dikirim oleh SeaTalk
      const payload = await request.clone().json();

      // ==============================================================
      // 1. TAHAP VERIFIKASI SEATALK (Wajib ada agar lolos pengecekan)
      // ==============================================================
      if (payload.event_type === "event_verification") {
        return new Response(JSON.stringify({
          "seatalk_challenge": payload.event.seatalk_challenge
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      // ==============================================================
      // 2. TAHAP EVENT BOT (Contoh: Menangani Pesan Masuk)
      // ==============================================================
      // Anda bisa memantau struktur payload ini di Cloudflare Dashboard (Logs)
      console.log("Event diterima dari SeaTalk:", payload);

      // Pastikan event yang masuk adalah pesan dari pengguna
      const eventType = payload.event_type;
      if (eventType === "message_from_bot" || eventType === "message" || eventType === "message_received_from_user") {
        
        // Ambil teks pesan dan kode karyawan (employee_code) pengirim
        const incomingText = payload.event.message?.text?.content?.trim().toLowerCase() || "";
        const employeeCode = payload.event.sender?.employee_code;

        // Jika pesan adalah "halo" dan kita tahu siapa pengirimnya, panggil fungsi balasan
        if (incomingText === "halo" && employeeCode) {
          // ctx.waitUntil() memastikan proses balasan berjalan di background
          ctx.waitUntil(replyToUser(employeeCode, "Halo juga!"));
        }
      }
      
      // Beri respons sukses agar SeaTalk tahu kita menerima event-nya
      return new Response(JSON.stringify({"status": "success"}), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    } catch (error) {
      // Jika terjadi error (misalnya request bukan JSON valid)
      return new Response(JSON.stringify({"error": error.message}), { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};

// ====================================================================
// FUNGSI UNTUK MEMBALAS PESAN KE SEATALK
// ====================================================================
async function replyToUser(employeeCode, messageText) {
  // ⚠️ GANTI DENGAN APP ID DAN APP SECRET BOT ANDA DARI DASHBOARD SEATALK
  const APP_ID = "NzE2Mjg3ODUxMjc5";
  const APP_SECRET = "c3urIS7asdvFi0rIwbhuAKBklGWY1yQv";

  try {
    // 1. Dapatkan Access Token (Wajib dipanggil sebelum kirim pesan)
    const tokenRes = await fetch("https://openapi.seatalk.io/auth/app_access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
    });
    
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.app_access_token;

    if (!accessToken) {
      console.error("Gagal mendapatkan Access Token:", tokenData);
      return;
    }

    // 2. Kirim Balasan Pesan ke Pengguna
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
          text: {
            content: messageText
          }
        }
      })
    });

    const sendData = await sendRes.json();
    console.log("Status kirim pesan:", sendData);
  } catch (err) {
    console.error("Error saat membalas pesan:", err);
  }
}
