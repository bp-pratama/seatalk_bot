src/aiHandler.js/**
 * src/aiHandler.js
 * Manajemen Multi-Model Cloudflare Workers AI.
 */

// Katalog Model AI yang digunakan (Gratis via CF Workers)
export const AI_MODELS = {
  CHAT_GENERAL: '@cf/meta/llama-3.1-8b-instruct',  // Model utama yang pintar dan ramah
  SUMMARY_FAST: '@cf/qwen/qwen1.5-0.5b-chat',      // Model sangat ringan khusus untuk merangkum
  CODING_LOGIC: '@cf/meta/llama-3-8b-instruct'     // (Opsional) jika butuh model khusus logika/koding
};

// Fungsi Utama Chat AI
export async function getAiReply(env, systemPrompt, history, model = AI_MODELS.CHAT_GENERAL) {
  try {
    const aiResponse = await env.AI.run(model, {
      messages: [
        { role: "system", content: systemPrompt }, 
        ...history
      ],
    });
    return aiResponse.response || "Maaf, sistem AI tidak memberikan respon.";
  } catch (err) {
    console.log(`DEBUG: Error AI Handler (${model}):`, err.message);
    return "Maaf, koneksi ke jaringan AI sedang sibuk. Mohon coba lagi.";
  }
}

// Fungsi Hybrid Memory: Meringkas percakapan lama menjadi Context Note
export async function summarizeContext(env, currentContext, oldHistory) {
  try {
    const historyText = oldHistory.map(m => `${m.role}: ${m.content}`).join('\n');
    const prompt = `Buatlah ringkasan singkat maksimal 2 kalimat dari percakapan berikut untuk dijadikan catatan ingatan VA. 
Catatan sebelumnya: ${currentContext || 'Belum ada'}
Percakapan baru:
${historyText}`;

    const summaryResponse = await env.AI.run(AI_MODELS.SUMMARY_FAST, {
      messages: [{ role: "user", content: prompt }]
    });
    
    return summaryResponse.response;
  } catch (err) {
    console.log("DEBUG: Gagal merangkum konteks", err.message);
    return currentContext; // Kembalikan konteks lama jika gagal
  }
}