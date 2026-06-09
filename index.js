/**
 * index.js
<<<<<<< HEAD
 * Bertindak sebagai Router (Polisi Lalu Lintas) dan Eksekutor Penjadwalan (Cron).
=======
>>>>>>> c686c6e (fix: resolved spreadsheet access, parameter sync, and tab lookup logic)
 */

import { handleGeneralChat } from './src/botCoding.js';
import { extractIncomingText, sendSystemWebhook, replyToUser } from './src/utils.js';
<<<<<<< HEAD
import { getHourlyReportData } from './src/botSheet.js';
=======
import { getHourlyReportData, handleInventoryQuery, handleSetSheet, handleReadSheet } from './src/botSheet.js';
>>>>>>> c686c6e (fix: resolved spreadsheet access, parameter sync, and tab lookup logic)

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

<<<<<<< HEAD
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
=======
      if (incomingText.startsWith("/set-sheet")) {
        ctx.waitUntil(handleSetSheet(env, targetId, incomingText, isGroup, threadId, originalMessageId));
      }
      else if (incomingText.startsWith("/baca")) {
        ctx.waitUntil(handleReadSheet(env, targetId, incomingText, isGroup, threadId, originalMessageId));
      }
      else if (incomingText.startsWith("/stok")) {
        ctx.waitUntil(handleInventoryQuery(env, targetId, incomingText, isGroup, threadId, originalMessageId));
      }
      else if (incomingText.startsWith("/set-report")) {
        ctx.waitUntil(handleSetReport(env, incomingText, targetId, isGroup, threadId, originalMessageId));
      } 
>>>>>>> c686c6e (fix: resolved spreadsheet access, parameter sync, and tab lookup logic)
      else {
        ctx.waitUntil(handleGeneralChat(env, targetId, incomingText, isGroup, threadId, originalMessageId));
      }

      return new Response(JSON.stringify({ "code": 0 }), { status: 200 });
      
    } catch (error) {
      console.log("DEBUG: Fatal Error di fetch:", error.message);
      return new Response("OK", { status: 200 });
    }
  },

<<<<<<< HEAD
  // 2. GERBANG MASUK PENJADWALAN (CRON TRIGGERS)
  // Dipicu setiap menit secara otomatis oleh setting di wrangler.toml
=======
>>>>>>> c686c6e (fix: resolved spreadsheet access, parameter sync, and tab lookup logic)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(executeDynamicScheduler(env));
  }
};

<<<<<<< HEAD
// ==========================================
// FUNGSI KHUSUS UNTUK INDEX.JS (ROUTER)
// ==========================================

// Fungsi mendaftarkan jadwal ke KV
async function handleSetReport(env, text, targetId, isGroup, threadId, originalMessageId) {
  // Format: /set-report NamaLaporan https://webhook.url 15
  const parts = text.split(" ");
  if (parts.length < 4) {
    await replyToUser("Format salah. Gunakan: `/set-report [NamaLaporan] [Webhook_URL] [Menit_0-59]`", targetId, isGroup, threadId, originalMessageId);
=======
async function handleSetReport(env, text, targetId, isGroup, threadId, originalMessageId) {
  const parts = text.split(" ");
  if (parts.length < 4) {
    await replyToUser(env, "Format salah. Gunakan: `/set-report [NamaLaporan] [Webhook_URL] [Menit_0-59]`", targetId, isGroup, threadId, originalMessageId);
>>>>>>> c686c6e (fix: resolved spreadsheet access, parameter sync, and tab lookup logic)
    return;
  }

  const name = parts[1];
  const webhookUrl = parts[2];
  const minute = parseInt(parts[3], 10);

<<<<<<< HEAD
=======
  if (isNaN(minute) || minute < 0 || minute > 59) {
    await replyToUser(env, "Menit tidak valid. Gunakan angka 0-59.", targetId, isGroup, threadId, originalMessageId);
    return;
  }

>>>>>>> c686c6e (fix: resolved spreadsheet access, parameter sync, and tab lookup logic)
  try {
    let cronJobs = [];
    const rawJobs = await env.BOT_MEMORY.get("cron_jobs");
    if (rawJobs) cronJobs = JSON.parse(rawJobs);

<<<<<<< HEAD
    // Filter duplikat jika nama sama
=======
>>>>>>> c686c6e (fix: resolved spreadsheet access, parameter sync, and tab lookup logic)
    cronJobs = cronJobs.filter(job => job.name !== name);
    cronJobs.push({ name, webhookUrl, minute });

    await env.BOT_MEMORY.put("cron_jobs", JSON.stringify(cronJobs));
<<<<<<< HEAD
    await replyToUser(`✅ Jadwal laporan '${name}' berhasil didaftarkan. Laporan akan dikirim setiap jam pada menit ke-${minute} via System Account.`, targetId, isGroup, threadId, originalMessageId);
  } catch (err) {
    await replyToUser("Gagal menyimpan jadwal.", targetId, isGroup, threadId, originalMessageId);
  }
}

// Fungsi eksekusi scheduler dinamis (Heartbeat checker)
async function executeDynamicScheduler(env) {
  try {
    // Dapatkan menit saat ini di WIB (UTC+7)
=======
    await replyToUser(env, `✅ Jadwal laporan '${name}' disimpan. Akan dikirim menit ke-${minute}.`, targetId, isGroup, threadId, originalMessageId);
  } catch (err) {
    await replyToUser(env, "Gagal menyimpan jadwal.", targetId, isGroup, threadId, originalMessageId);
  }
}

async function executeDynamicScheduler(env) {
  try {
>>>>>>> c686c6e (fix: resolved spreadsheet access, parameter sync, and tab lookup logic)
    const now = new Date();
    const currentMinute = now.toLocaleString("en-US", { timeZone: "Asia/Jakarta", minute: "numeric" });
    const targetMinute = parseInt(currentMinute, 10);

    const rawJobs = await env.BOT_MEMORY.get("cron_jobs");
    if (!rawJobs) return;
    
    const cronJobs = JSON.parse(rawJobs);
<<<<<<< HEAD
    
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
=======
    const jobsToRun = cronJobs.filter(job => job.minute === targetMinute);

    if (jobsToRun.length > 0) {
      const reportText = await getHourlyReportData(env);
      await Promise.all(jobsToRun.map(job => sendSystemWebhook(job.webhookUrl, reportText)));
>>>>>>> c686c6e (fix: resolved spreadsheet access, parameter sync, and tab lookup logic)
    }
  } catch (err) {
    console.log("DEBUG: Error di Dynamic Scheduler:", err.message);
  }
}