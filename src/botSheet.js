/**
 * src/botSheet.js
 */

import { replyToUser } from './utils.js';
import { importPKCS8, SignJWT } from 'jose';

async function getGoogleToken(env) {
    const cacheKey = "google_oauth_token";
    try {
        const cachedToken = await env.BOT_MEMORY.get(cacheKey);
        if (cachedToken) return cachedToken;
    } catch (err) {}

    const now = Math.floor(Date.now() / 1000);
    let pemKey = env.GOOGLE_PRIVATE_KEY;
    if (!pemKey) throw new Error("GOOGLE_PRIVATE_KEY belum dikonfigurasi.");
    pemKey = pemKey.replace(/\\n/g, '\n');

    const privateKey = await importPKCS8(pemKey, 'RS256');

    const jwt = await new SignJWT({
        iss: env.GOOGLE_CLIENT_EMAIL,
        scope: "https://www.googleapis.com/auth/spreadsheets", 
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now,
    })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .sign(privateKey);

    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    
    const data = await res.json();
    if (!data.access_token) throw new Error("Google OAuth gagal.");

    await env.BOT_MEMORY.put(cacheKey, data.access_token, { expirationTtl: 3300 });
    return data.access_token;
}

export function extractSpreadsheetId(text) {
    const regex = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
    const matches = text.match(regex);
    return matches ? matches[1] : null;
}

export async function silentReadSheetForAI(env, text) {
    const sheetId = extractSpreadsheetId(text);
    if (!sheetId) return null; 

    try {
        const token = await getGoogleToken(env);
        const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
        const metaResponse = await fetch(metaUrl, { headers: { "Authorization": `Bearer ${token}` } });
        const metaData = await metaResponse.json();

        // Cari tab: Cek apakah user menyebutkan nama tab secara spesifik di text
        // Contoh: "dari tab jadwal" -> akan mencari tab yang mengandung kata "jadwal"
        let targetTab = metaData.sheets[0].properties.title; // Default tab pertama
        const tabMatch = text.match(/tab\s+([a-zA-Z0-9\s]+)/i);
        
        if (tabMatch && tabMatch[1]) {
            const requestedName = tabMatch[1].trim().toLowerCase();
            const found = metaData.sheets.find(s => s.properties.title.toLowerCase().includes(requestedName));
            if (found) targetTab = found.properties.title;
        }

        // Ambil data
        const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(targetTab)}!A1:G100`;
        const response = await fetch(dataUrl, { headers: { "Authorization": `Bearer ${token}` } });
        const data = await response.json();
        
        if (!data.values || data.values.length === 0) {
            return `[ERROR_API] Tab '${targetTab}' terdeteksi kosong.`;
        }

        let output = `[DATA DARI TAB: ${targetTab}]\n`;
        data.values.slice(0, 20).forEach((row, idx) => {
            output += `Baris ${idx + 1}: ${row.join(" | ")}\n`;
        });
        
        return output;

    } catch (error) {
        return `[ERROR_API] Exception: ${error.message}`;
    }
}

export async function handleSetSheet(env, targetId, text, isGroup, threadId, originalMessageId) {
    try {
        const sheetId = extractSpreadsheetId(text);
        if (!sheetId) {
            await replyToUser(env, "⚠️ URL tidak valid. Contoh: `/set-sheet https://docs.google.com/spreadsheets/d/ID...`", targetId, isGroup, threadId, originalMessageId);
            return;
        }
        await env.BOT_MEMORY.put(`default_sheet_${targetId}`, sheetId);
        await replyToUser(env, `✅ Spreadsheet Default Didaftarkan!\nPastikan share akses ke: ${env.GOOGLE_CLIENT_EMAIL}`, targetId, isGroup, threadId, originalMessageId);
    } catch (error) {
        await replyToUser(env, `⚠️ Gagal: ${error.message}`, targetId, isGroup, threadId, originalMessageId);
    }
}

// Logic Terpusat: Eksekusi membaca Sheet, entah dari URL di text atau dari default yang di-save
async function executeReadCommand(env, targetId, text, isGroup, threadId, originalMessageId) {
    let sheetId = extractSpreadsheetId(text);
    
    if (!sheetId) {
        sheetId = await env.BOT_MEMORY.get(`default_sheet_${targetId}`);
    }

    if (!sheetId) {
        await replyToUser(env, "⚠️ Belum ada sheet terdaftar. Daftarkan dengan `/set-sheet [URL]`", targetId, isGroup, threadId, originalMessageId);
        return;
    }

    const fakeUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    const result = await silentReadSheetForAI(env, fakeUrl);
    await replyToUser(env, result || "Gagal membaca sheet.", targetId, isGroup, threadId, originalMessageId);
}

export async function handleInventoryQuery(env, targetId, text, isGroup, threadId, originalMessageId) {
    await executeReadCommand(env, targetId, text, isGroup, threadId, originalMessageId);
}

export async function handleReadSheet(env, targetId, text, isGroup, threadId, originalMessageId) {
    await executeReadCommand(env, targetId, text, isGroup, threadId, originalMessageId);
}

export async function getHourlyReportData(env) {
    const time = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    return `📊 **Laporan Otomatis**\nWaktu: ${time}\nBerjalan normal.`;
}