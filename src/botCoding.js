<<<<<<< HEAD
/**
 * src/botCoding.js
 * Mengatur alur percakapan VA, Hybrid Memory, dan Auto-Threading.
 */

import { getAiReply, summarizeContext, AI_MODELS } from './aiHandler.js';
import { replyToUser, countWords, smartChunkMessage } from './utils.js';

export async function handleGeneralChat(env, targetId, text, isGroup, threadId, originalMessageId) {
  try {
    const kvKey = `memory_${targetId}`;
    let session = { contextNote: "", history: [] };

    // 1. Baca Memori dari KV
    try {
      const rawMem = await env.BOT_MEMORY.get(kvKey);
      if (rawMem) session = JSON.parse(rawMem);
    } catch (e) {
      console.log("DEBUG: Memori baru dimulai.");
    }

    // 2. Jika history > 6, Rangkum (Long-term) dan kosongkan history (Short-term)
    if (session.history.length >= 6) {
      session.contextNote = await summarizeContext(env, session.contextNote, session.history);
      session.history = []; // Reset memori jangka pendek
    }

    // 3. Tambahkan pesan baru
    session.history.push({ role: "user", content: text });

    // 4. Susun System Prompt dengan Context Note
    let systemPrompt = "Kamu asisten VA operasional yang cerdas dan efisien. Jawab dengan ringkas namun informatif.";
    if (session.contextNote) {
      systemPrompt += `\n\n[CATATAN INGATAN DARI PERCAKAPAN SEBELUMNYA]:\n${session.contextNote}`;
    }

    // 5. Minta jawaban AI
    const reply = await getAiReply(env, systemPrompt, session.history, AI_MODELS.CHAT_GENERAL);
    
    // 6. Simpan balasan ke history dan update KV (TTL 1 Jam)
    session.history.push({ role: "assistant", content: reply });
    await env.BOT_MEMORY.put(kvKey, JSON.stringify(session), { expirationTtl: 3600 });

    // 7. AUTO-THREADING & SMART CHUNKING LOGIC
    const wordCount = countWords(reply);
    
    if (wordCount > 20 && isGroup) {
      // Kirim pesan pendek dulu ke grup utama
      const shortMsg = "Aku balas lebih detail di thread ya! 👇";
      const initResp = await replyToUser(shortMsg, targetId, isGroup, threadId, originalMessageId);
      
      // Ambil message_id dari pesan pendek tadi untuk dijadikan tempat thread
      const newThreadId = initResp?.message?.message_id || originalMessageId;
      
      // Potong pesan panjang per paragraf/bagian
      const chunks = smartChunkMessage(reply);
      
      // Kirim potongan secara berurutan ke dalam thread
      for (const chunk of chunks) {
        await replyToUser(chunk, targetId, isGroup, newThreadId, null);
      }
    } else {
      // Jika <= 20 kata ATAU di pesan Japri (Single Chat), balas langsung dengan chunk
      const chunks = smartChunkMessage(reply);
      for (const chunk of chunks) {
        await replyToUser(chunk, targetId, isGroup, threadId, originalMessageId);
      }
    }

  } catch (err) {
    console.log("DEBUG: Error di handleGeneralChat:", err.message);
  }
=======
/**
 * src/botCoding.js
 * Mengatur alur percakapan VA, Hybrid Memory, dan Auto-Threading.
 */

import { getAiReply, summarizeContext, AI_MODELS } from './aiHandler.js';
import { replyToUser, countWords, smartChunkMessage } from './utils.js';
import { silentReadSheetForAI } from './botSheet.js'; 

export async function handleGeneralChat(env, targetId, text, isGroup, threadId, originalMessageId) {
  try {
    const kvKey = `memory_${targetId}`;
    let session = { contextNote: "", history: [], sheetContext: "", sheetUrl: "" };

    // 1. Ambil sesi yang tersimpan dari Cloudflare KV
    try {
      const rawMem = await env.BOT_MEMORY.get(kvKey);
      if (rawMem) {
        session = JSON.parse(rawMem);
      }
    } catch (e) {
      console.log("DEBUG: Memori baru dimulai atau gagal parse KV.");
    }

    // 2. Ringkas riwayat percakapan lama jika melebihi batas 6 pesan
    if (session.history.length >= 6) {
      session.contextNote = await summarizeContext(env, session.contextNote, session.history);
      session.history = []; 
    }

    // 3. Deteksi apakah pesan saat ini mengandung link Google Sheets baru
    const newSheetContext = await silentReadSheetForAI(env, text);

    if (newSheetContext) {
      // Tangani error autentikasi
      if (newSheetContext.startsWith("[ERROR_")) {
          const rawError = newSheetContext.replace("[ERROR_AUTH]", "").replace("[ERROR_API]", "").replace("[ERROR_ACCESS]", "").trim();
          // Menampilkan pesan error asli dari server Google agar kita tahu masalahnya
          await replyToUser(env, `⚠️ **VASA - Info Error:**\n\nDetail: ${newSheetContext}\n\nPeriksa 'npx wrangler tail' di terminal Anda untuk log lengkap.`, targetId, isGroup, threadId, originalMessageId);          return;
      }

      session.sheetContext = newSheetContext;
      const urlRegex = /(https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9-_]+[^\s]*)/;
      const match = text.match(urlRegex);
      if (match) session.sheetUrl = match[1];
    }

    // 4. Masukkan pesan user ke dalam riwayat
    session.history.push({ role: "user", content: text });

    // 5. Susun System Prompt
    let systemPrompt = "Kamu adalah VASA, asisten operasional cerdas di SOC Arjawinangun. Jawab dengan ramah, profesional, ringkas, dan solutif.";
    
    if (session.contextNote) systemPrompt += `\n\n[CATATAN INGATAN]:\n${session.contextNote}`;
    
    if (session.sheetContext) {
      systemPrompt += `\n\n[DATA SPREADSHEET]:\n${session.sheetContext}`;
    }

    // 6. Jalankan model AI
    const reply = await getAiReply(env, systemPrompt, session.history, AI_MODELS.CHAT_GENERAL);
    
    // 7. Simpan balasan ke KV
    session.history.push({ role: "assistant", content: reply });
    await env.BOT_MEMORY.put(kvKey, JSON.stringify(session), { expirationTtl: 3600 });

    // 8. Auto-threading
    const wordCount = countWords(reply);
    const chunks = smartChunkMessage(reply);
    
    if (wordCount > 20 && isGroup) {
      const initResp = await replyToUser(env, "Aku balas di thread ya! 👇", targetId, isGroup, threadId, originalMessageId);
      const newThreadId = initResp?.message?.message_id || originalMessageId;
      for (const chunk of chunks) await replyToUser(env, chunk, targetId, isGroup, newThreadId, null);
    } else {
      for (const chunk of chunks) await replyToUser(env, chunk, targetId, isGroup, threadId, originalMessageId);
    }

  } catch (err) {
    console.log("DEBUG: Error di handleGeneralChat:", err.message);
  }
>>>>>>> c686c6e (fix: resolved spreadsheet access, parameter sync, and tab lookup logic)
}