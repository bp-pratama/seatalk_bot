/**
 * index.js
 * Bertindak sebagai Router (Polisi Lalu Lintas) dan Eksekutor Penjadwalan (Cron).
 */

import { handleGeneralChat } from './src/botCoding.js';
import { extractIncomingText, sendSystemWebhook, replyToUser } from './src/utils.js';
import { getHourlyReportData } from './src/botSheet.js';

export default {
  // 1. GERBANG MASUK CHAT (WEBHOOK SEATALK)
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Bot Active", { status: 200 });

    try {
      const payload = await request.json();
      const event = payload.event || {};

      if (payload.event_type === "event_verification") {
        return new Response(JSON.stringify({ "seatalk_challenge": event.seatalk_challenge }), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }

      const message = event.message || {};
      const incomingText = extractIncomingText(message);
      const groupId = event.group_id;
      const employeeCode = event.employee_code || event.message?.sender?.employee_code || event.sender_id;
      
      const isGroup = !!groupId;
      const targetId = groupId || employeeCode;
      const threadId = message.thread_id || ""; 
      const originalMessageId = message.message_id;

      if (!incomingText || !targetId) return new Response("OK", { status: 200 });

      // -- ROUTING LOGIC (1 Antarmuka, Banyak Fungsi) --
      
      // A. Jika User mengetik perintah pengaturan jadwal cron
      if (incomingText.startsWith("/set-report")) {
        ctx.waitUntil(handleSetReport(env, incomingText, targetId, isGroup, threadId, originalMessageId));
      } 
      // B. (Opsional) Jika command khusus inventory
      else if (incomingText.startsWith("/stok")) {
        // ctx.waitUntil(handleInventoryQuery(...)); // dari botSheet.js
      }
      // C. Default: Masuk ke AI VA (Bot General)
      else {
        ctx.waitUntil(handleGeneralChat(env, targetId, incomingText, isGroup, threadId, originalMessageId));
      }

      return new Response(JSON.stringify({ "code": 0 }), { status: 200 });
      
    } catch (error) {
      console.log("DEBUG: Fatal Error di fetch:", error.message);
      return new Response("OK", { status: 200 });
    }
  },

  // 2. GERBANG MASUK PENJADWALAN (CRON TRIGGERS)
  // Dipicu setiap menit secara otomatis oleh setting di wrangler.toml
  async scheduled(event, env, ctx) {
    ctx.waitUntil(executeDynamicScheduler(env));
  }
};

// ==========================================
// FUNGSI KHUSUS UNTUK INDEX.JS (ROUTER)
// ==========================================

// Fungsi mendaftarkan jadwal ke KV
async function handleSetReport(env, text, targetId, isGroup, threadId, originalMessageId) {
  // Format: /set-report NamaLaporan https://webhook.url 15
  const parts = text.split(" ");
  if (parts.length < 4) {
    await replyToUser("Format salah. Gunakan: `/set-report [NamaLaporan] [Webhook_URL] [Menit_0-59]`", targetId, isGroup, threadId, originalMessageId);
    return;
  }

  const name = parts[1];
  const webhookUrl = parts[2];
  const minute = parseInt(parts[3], 10);

  try {
    let cronJobs = [];
    const rawJobs = await env.BOT_MEMORY.get("cron_jobs");
    if (rawJobs) cronJobs = JSON.parse(rawJobs);

    // Filter duplikat jika nama sama
    cronJobs = cronJobs.filter(job => job.name !== name);
    cronJobs.push({ name, webhookUrl, minute });

    await env.BOT_MEMORY.put("cron_jobs", JSON.stringify(cronJobs));
    await replyToUser(`✅ Jadwal laporan '${name}' berhasil didaftarkan. Laporan akan dikirim setiap jam pada menit ke-${minute} via System Account.`, targetId, isGroup, threadId, originalMessageId);
  } catch (err) {
    await replyToUser("Gagal menyimpan jadwal.", targetId, isGroup, threadId, originalMessageId);
  }
}

// Fungsi eksekusi scheduler dinamis (Heartbeat checker)
async function executeDynamicScheduler(env) {
  try {
    // Dapatkan menit saat ini di WIB (UTC+7)
    const now = new Date();
    const currentMinute = now.toLocaleString("en-US", { timeZone: "Asia/Jakarta", minute: "numeric" });
    const targetMinute = parseInt(currentMinute, 10);

    const rawJobs = await env.BOT_MEMORY.get("cron_jobs");
    if (!rawJobs) return;
    
    const cronJobs = JSON.parse(rawJobs);
    
    // Cari jadwal yang menitnya cocok dengan menit saat ini
    const jobsToRun = cronJobs.filter(job => job.minute === targetMinute);

    if (jobsToRun.length > 0) {
      // Ambil data laporan (Contoh mengambil dari GSheets via modul botSheet)
      const reportText = await getHourlyReportData(env);
      
      // Eksekusi semua tembakan webhook secara paralel
      await Promise.all(
        jobsToRun.map(job => sendSystemWebhook(job.webhookUrl, reportText))
      );
      console.log(`DEBUG: Menjalankan ${jobsToRun.length} jadwal cron pada menit ke-${targetMinute}`);
    }
  } catch (err) {
    console.log("DEBUG: Error di Dynamic Scheduler:", err.message);
  }
}