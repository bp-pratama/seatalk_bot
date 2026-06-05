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

      // Nanti di sini Anda bisa menambahkan fungsi untuk memanggil API SeaTalk
      // (misalnya API untuk mengirim balasan pesan berdasarkan kata kunci)
      
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
