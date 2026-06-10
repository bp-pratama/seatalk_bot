/**
 * src/botSheet.js
 * Engine pemrosesan Google Sheets dan rendering biner.
 */

import { replyToUser } from './utils.js';
import { importPKCS8, SignJWT } from 'jose';

async function parseJsonResponse(response, context) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (err) {
        console.error(`DEBUG: Invalid JSON response from ${context}. status=${response.status} body=${text.substring(0, 300)}`);
        return null;
    }
}

async function getGoogleToken(env) {
    const cacheKey = "google_oauth_token";
    try {
        const cachedToken = await env.BOT_MEMORY.get(cacheKey);
        if (cachedToken) return cachedToken;
    } catch (err) {}

    const now = Math.floor(Date.now() / 1000);
    let pemKey = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    const privateKey = await importPKCS8(pemKey, 'RS256');

    const jwt = await new SignJWT({
        iss: env.GOOGLE_CLIENT_EMAIL,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600, iat: now,
    }).setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).sign(privateKey);

    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    const data = await parseJsonResponse(res, "Google OAuth token");
    if (!data?.access_token) {
        throw new Error("Tidak dapat mengambil token Google");
    }
    await env.BOT_MEMORY.put(cacheKey, data.access_token, { expirationTtl: 3000 });
    return data.access_token;
}

export function extractSpreadsheetId(url) {
    const matches = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return matches ? matches[1] : null;
}

function normalizeRangeToken(rangeStr) {
    if (!rangeStr) return null;
    const normalized = rangeStr.trim().replace(/^range\s*[=:]\s*/i, '').replace(/^r\s*[=:]\s*/i, '');
    return normalized;
}

function parseCustomRange(rangeStr) {
    if (!rangeStr) return null;
    let upperRange = normalizeRangeToken(rangeStr).toUpperCase();

    // Pattern: A1:D15, A1:R28, dll dengan digit multi, atau A:D (column range)
    // Limit columns ke max 3 huruf (A-Z, AA-ZZ, AAA-ZZZ)
    const explicitMatch = upperRange.match(/^([A-Z]{1,3})?(\d+)?:([A-Z]{1,3})?(\d+)?$/);
    if (explicitMatch) {
        const [, startCol, startRow, endCol, endRow] = explicitMatch;
        // If both columns exist without numbers = pure column range like A:D
        if (startCol && endCol && !startRow && !endRow) {
            console.log(`Range parse: ${rangeStr} -> ${startCol}1:${endCol}50`);
            return `${startCol}1:${endCol}50`;
        }
        // Otherwise normal range parsing
        if (startCol || endCol || startRow || endRow) {
            const start = (startCol || 'A') + (startRow || '1');
            const end = (endCol || 'Z') + (endRow || '50');
            console.log(`Range parse: ${rangeStr} -> ${start}:${end}`);
            return `${start}:${end}`;
        }
    }

    // Pattern alternatif: 5-30 (baris 5-30, kolom A-Z)
    const rowMatch = upperRange.match(/^(\d+)-(\d+)$/);
    if (rowMatch) {
        const [, startRow, endRow] = rowMatch;
        console.log(`Range parse: ${rangeStr} -> A${startRow}:Z${endRow}`);
        return `A${startRow}:Z${endRow}`;
    }

    // Pattern: D15 (kolom D saja dengan baris awal) / OB15
    // PENTING: REQUIRE digit di akhir! Ini hindari match tab names tanpa angka
    const simpleMatch = upperRange.match(/^([A-Z]{1,3})(\d+)$/);
    if (simpleMatch) {
        const [, col, row] = simpleMatch;
        console.log(`Range parse: ${rangeStr} -> ${col}${row}:${col}50`);
        return `${col}${row}:${col}50`;
    }

    console.log(`Range parse: ${rangeStr} -> NOT A RANGE (tab name)`);
    return null;
}

export async function silentReadSheetForAI(env, spreadsheetId, tabName = "") {
    if (!spreadsheetId) return null;
    const token = await getGoogleToken(env);
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, { headers: { "Authorization": `Bearer ${token}` } });
    const metaData = await parseJsonResponse(metaRes, `Google Sheets metadata for ${spreadsheetId}`);
    const sheets = metaData?.sheets || [];
    if (sheets.length === 0) return null;

    let targetSheetTitle = sheets[0].properties.title;
    if (tabName) {
        const foundSheet = sheets.find(s => s.properties.title.toLowerCase().includes(tabName.toLowerCase()));
        if (foundSheet) targetSheetTitle = foundSheet.properties.title;
    }

    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(targetSheetTitle)}!A1:Z50`, { headers: { "Authorization": `Bearer ${token}` } });
    const data = await parseJsonResponse(res, `Google Sheets values for ${spreadsheetId} / ${targetSheetTitle}`);
    return (data.values || []).map(row => row.join(" | ")).join("\n");
}

export async function generatePrivateSheetBuffer(env, spreadsheetId, tabName = "", customRange = null) {
    const token = await getGoogleToken(env);
    
    // 1. Ambil metadata untuk mendapatkan GID dari sheet yang ditargetkan
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, { 
        headers: { "Authorization": `Bearer ${token}` } 
    });
    const metaData = await parseJsonResponse(metaRes, `Google Sheets metadata for ${spreadsheetId}`);
    const sheets = metaData?.sheets || [];
    
    if (sheets.length === 0) {
        throw new Error("Spreadsheet tidak memiliki sheet.");
    }

    // 2. Cari sheet berdasarkan nama atau gunakan sheet pertama
    let targetSheet = sheets[0];
    if (tabName) {
        const foundSheet = sheets.find(s => s.properties.title.toLowerCase().includes(tabName.toLowerCase()));
        if (foundSheet) targetSheet = foundSheet;
    }

    const targetSheetTitle = targetSheet.properties.title;
    const sheetGid = targetSheet.properties.sheetId;

    console.log(`Generating screenshot: ${spreadsheetId} / ${targetSheetTitle} (GID: ${sheetGid})`);

    // 3. Construct Google Sheets URL untuk di-screenshot
    // Format: https://docs.google.com/spreadsheets/d/{id}/edit#gid={gid}
    const sheetsUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetGid}`;
    return { sheetsUrl, targetSheetTitle };
}

async function triggerScreenshotWorkflow(env, targetUrl, targetId, isGroup, threadId, originalMessageId) {
    // GITHUB_TRIGGER_TOKEN harus berupa GitHub Personal Access Token.
    // Fine-grained PAT direkomendasikan dan harus memiliki akses Actions + repo ke repository ini.
    const token = env.GITHUB_TRIGGER_TOKEN;
    if (!token) throw new Error("GITHUB_TRIGGER_TOKEN tidak dikonfigurasi. Tambahkan secret di environment.");

    const repo = env.GITHUB_REPOSITORY || 'bp-pratama/seatalk_bot';
    const parts = repo.split('/');
    if (parts.length !== 2) throw new Error("GITHUB_REPOSITORY harus dalam format owner/repo atau set env.GITHUB_REPOSITORY.");
    const owner = parts[0];
    const repoName = parts[1];

    const workflowId = 'screenshot.yml';
    const url = `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${workflowId}/dispatches`;
    const inputs = {
      target_url: targetUrl,
      target_id: targetId,
      is_group: isGroup ? '1' : '0',
      thread_id: threadId || '',
      original_message_id: originalMessageId || ''
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'seatalk-bot'
        },
        body: JSON.stringify({ ref: 'main', inputs })
    });

    if (res.status === 204) return true;
    const txt = await res.text();
    if (res.status === 404) {
      throw new Error(`Gagal memicu workflow: HTTP 404 - Not Found. Pastikan GITHUB_TRIGGER_TOKEN memiliki akses ke repo dan Actions, serta workflow file '.github/workflows/screenshot.yml' benar-benar ada.`);
    }
    throw new Error(`Gagal memicu workflow: HTTP ${res.status} - ${txt.substring(0,300)}`);
}

export async function handleSetSheet(env, targetId, text, isGroup, threadId, originalMessageId) {
    const sheetId = extractSpreadsheetId(text);
    if (!sheetId) return await replyToUser(env, "⚠️ URL tidak valid.", targetId, isGroup, threadId, originalMessageId);
    await env.BOT_MEMORY.put(`default_sheet_${targetId}`, sheetId);
    await replyToUser(env, "✅ Spreadsheet disimpan.", targetId, isGroup, threadId, originalMessageId);
}

export async function handleReadSheet(env, targetId, text, isGroup, threadId, originalMessageId) {
    const args = text.replace(/^\S+\s*/, "").trim();
    const tokens = args.split(/\s+/).filter(Boolean);
    const explicitSheetId = extractSpreadsheetId(args) || (tokens[0] && extractSpreadsheetId(tokens[0]));
    const sheetId = explicitSheetId || await env.BOT_MEMORY.get(`default_sheet_${targetId}`);
    const tabName = explicitSheetId ? (tokens.length > 1 ? tokens.slice(1).join(" ") : "") : tokens.join(" ");

    if (!sheetId) return await replyToUser(env, "⚠️ Belum ada sheet terdaftar.", targetId, isGroup, threadId, originalMessageId);
    const result = await silentReadSheetForAI(env, sheetId, tabName);
    await replyToUser(env, result || "Data kosong.", targetId, isGroup, threadId, originalMessageId);
}

function parseScreenshotArguments(tokens) {
    let tabNameParts = [];
    let customRange = null;
    let collectingSheetName = false;

    for (let token of tokens) {
        if (!token) continue;
        const lowerToken = token.toLowerCase();
        if (/^(https?:\/\/|www\.|docs\.google\.com\/spreadsheets)/i.test(token)) {
            continue;
        }
        if (/^url=/i.test(token)) {
            continue;
        }

        if (/^(range|r)=/i.test(token)) {
            const parsed = parseCustomRange(token);
            if (parsed) {
                customRange = parsed;
            }
            collectingSheetName = false;
            continue;
        }

        const sheetNameMatch = token.match(/^(sheet_name|sheet|tab_name)=(.+)$/i);
        if (sheetNameMatch) {
            collectingSheetName = true;
            tabNameParts.push(sheetNameMatch[2]);
            continue;
        }

        const rangeParsed = parseCustomRange(token);
        if (rangeParsed && !customRange) {
            customRange = rangeParsed;
            collectingSheetName = false;
            continue;
        }

        if (collectingSheetName) {
            tabNameParts.push(token);
            continue;
        }

        tabNameParts.push(token);
    }

    return { tabName: tabNameParts.join(" ").trim(), customRange };
}

export async function handleScreenshotCommand(env, targetId, text, isGroup, threadId, originalMessageId) {
    const args = text.replace(/^\S+\s*/, "").trim();
    const tokens = args.split(/\s+/).filter(Boolean);
    
    // Cari sheet ID, tab name, dan custom range
    const explicitSheetId = extractSpreadsheetId(args) || (tokens[0] && extractSpreadsheetId(tokens[0]));
    const sheetId = explicitSheetId || await env.BOT_MEMORY.get(`default_sheet_${targetId}`);
    
    if (!sheetId) return await replyToUser(env, "⚠️ Sheet tidak ditemukan.", targetId, isGroup, threadId, originalMessageId);
    
    const tokensForTabAndRange = explicitSheetId
        ? tokens.filter(token => !extractSpreadsheetId(token) && !/^url=/i.test(token))
        : tokens;
    const { tabName, customRange } = parseScreenshotArguments(tokensForTabAndRange);
    
    console.log(`Screenshot command: sheetId=${sheetId} tabName="${tabName}" customRange=${customRange}`);
    
    try {
        const { sheetsUrl, targetSheetTitle } = await generatePrivateSheetBuffer(env, sheetId, tabName, customRange);
        await triggerScreenshotWorkflow(env, sheetsUrl, targetId, isGroup, threadId, originalMessageId);
        await replyToUser(env, `✅ Permintaan screenshot dikirim untuk sheet "${targetSheetTitle}". Workflow sedang berjalan dan hasil akan dikirim ke SeaTalk.`, targetId, isGroup, threadId, originalMessageId);
    } catch (err) {
        console.error(`Screenshot error: tabName="${tabName}" customRange="${customRange}" - ${err.message}`);
        await replyToUser(env, `❌ ${err.message}`, targetId, isGroup, threadId, originalMessageId);
    }
}

export async function getHourlyReportData(env) {
    return "Data Laporan (Sistem sedang disinkronisasi)";
}

export async function handleInventoryQuery(env, targetId, text, isGroup, threadId, originalMessageId) {
    console.log("DEBUG: handleInventoryQuery dipanggil.");
    return null;
}