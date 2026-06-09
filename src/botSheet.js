/**
 * src/botSheet.js
 * Engine pemrosesan Google Sheets dan rendering biner.
 */

import { replyToUser, sendScreenshotToUser } from './utils.js';
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
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, { headers: { "Authorization": `Bearer ${token}` } });
    const metaData = await parseJsonResponse(metaRes, `Google Sheets metadata for ${spreadsheetId}`);
    const sheets = metaData?.sheets || [];
    if (sheets.length === 0) {
        throw new Error("Spreadsheet tidak memiliki sheet.");
    }
    let targetSheetTitle = sheets[0].properties.title;
    if (tabName) {
        const foundSheet = sheets.find(s => s.properties.title.toLowerCase().includes(tabName.toLowerCase()));
        if (foundSheet) targetSheetTitle = foundSheet.properties.title;
    }

    const range = customRange || "A1:Z50";
    console.log(`Fetching ${spreadsheetId} / ${targetSheetTitle} / ${range}`);
    const sheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?ranges=${encodeURIComponent(`${targetSheetTitle}!${range}`)}&includeGridData=true`, { headers: { "Authorization": `Bearer ${token}` } });
    const sheetData = await parseJsonResponse(sheetRes, `Google Sheets grid data for ${spreadsheetId}/${targetSheetTitle}/${range}`);

    const sheet = sheetData?.sheets?.[0];
    if (!sheet) {
        throw new Error(`Tidak dapat mengambil data sheet "${targetSheetTitle}".`);
    }

    const gridData = sheet.data?.[0];
    const rows = gridData?.rowData || [];
    if (!rows || rows.length === 0) {
        throw new Error(`Tidak ada data di sheet "${targetSheetTitle}" range ${range}.`);
    }

    const parseA1Cell = (a1) => {
        const match = a1.match(/^([A-Z]{1,3})(\d+)$/);
        if (!match) return { row: 0, col: 0 };
        const col = match[1].split("").reduce((val, ch) => val * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
        return { row: Number(match[2]) - 1, col };
    };

    const [rangeStartA1, rangeEndA1] = range.split(":");
    const rangeStart = parseA1Cell(rangeStartA1);
    const rangeEnd = parseA1Cell(rangeEndA1);
    const rangeRowCount = rangeEnd.row - rangeStart.row + 1;
    const rangeColCount = rangeEnd.col - rangeStart.col + 1;
    const normalizedRows = Array.from({ length: rangeRowCount }, (_, idx) => rows[idx]?.values || []);

    const mergeMap = new Map();
    const mergedCells = new Set();
    const merges = sheet.merges || [];
    for (const merge of merges) {
        const startRow = merge.startRowIndex - rangeStart.row;
        const endRow = merge.endRowIndex - rangeStart.row;
        const startCol = merge.startColumnIndex - rangeStart.col;
        const endCol = merge.endColumnIndex - rangeStart.col;
        if (startRow >= 0 && startCol >= 0 && endRow <= rangeRowCount && endCol <= rangeColCount) {
            mergeMap.set(`${startRow},${startCol}`, { rowspan: endRow - startRow, colspan: endCol - startCol });
            for (let r = startRow; r < endRow; r++) {
                for (let c = startCol; c < endCol; c++) {
                    if (r !== startRow || c !== startCol) {
                        mergedCells.add(`${r},${c}`);
                    }
                }
            }
        }
    }

    const rgbColor = (color) => {
        if (!color) return null;
        const r = Math.round((color.red ?? 0) * 255);
        const g = Math.round((color.green ?? 0) * 255);
        const b = Math.round((color.blue ?? 0) * 255);
        return `rgb(${r},${g},${b})`;
    };

    const escapeCell = (value) => {
        const text = String(value || "");
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\r\n|\r|\n/g, " ")
            .replace(/"/g, "&quot;")
            .substring(0, 200);
    };

    const renderCellText = (cell) => {
        if (!cell) return "";
        return escapeCell(cell.formattedValue ?? cell.effectiveValue?.stringValue ?? cell.effectiveValue?.numberValue ?? "");
    };

    const renderCellStyle = (cell) => {
        if (!cell) return "";
        const format = cell.effectiveFormat || cell.userEnteredFormat || {};
        const styles = [];
        if (format.backgroundColor) {
            const color = rgbColor(format.backgroundColor);
            if (color) styles.push(`background:${color}`);
        }
        if (format.horizontalAlignment) {
            styles.push(`text-align:${format.horizontalAlignment.toLowerCase()}`);
        }
        if (format.verticalAlignment) {
            const valign = format.verticalAlignment === 'MIDDLE' ? 'middle' : format.verticalAlignment.toLowerCase();
            styles.push(`vertical-align:${valign}`);
        }
        if (format.textFormat) {
            if (format.textFormat.bold) styles.push('font-weight:700');
            if (format.textFormat.italic) styles.push('font-style:italic');
            if (format.textFormat.underline) styles.push('text-decoration:underline');
            if (format.textFormat.strikethrough) styles.push('text-decoration:line-through');
            if (format.textFormat.foregroundColor) {
                const fg = rgbColor(format.textFormat.foregroundColor);
                if (fg) styles.push(`color:${fg}`);
            }
        }
        if (format.wrapStrategy === 'WRAP') {
            styles.push('white-space:normal');
        } else {
            styles.push('white-space:nowrap');
        }
        return styles.join(';');
    };

    const columnMeta = gridData.columnMetadata || [];
    const hasColumnWidths = columnMeta.some(col => col.pixelSize);
    const colGroup = hasColumnWidths
        ? `<colgroup>${columnMeta.slice(0, rangeColCount).map(col => `<col style="width:${Math.max(col.pixelSize || 80, 40)}px"></col>`).join('')}</colgroup>`
        : '';

    let tableHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;margin:0;padding:12px;background:#fff;color:#111}h3{margin:0 0 12px;font-size:18px;font-weight:600}table{border-collapse:collapse;width:100%;min-width:100%;font-size:11px;table-layout:fixed}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top;background:#fff;word-break:break-word}th{background:#f6f6f6;font-weight:700}td{min-width:50px;height:24px}tr:nth-child(even) td{background:#fcfcfc}</style></head><body><h3>${escapeCell(targetSheetTitle)}</h3><table>${colGroup}`;

    for (let rowIndex = 0; rowIndex < rangeRowCount; rowIndex++) {
        const row = normalizedRows[rowIndex] || [];
        tableHtml += '<tr>';
        for (let colIndex = 0; colIndex < rangeColCount; colIndex++) {
            if (mergedCells.has(`${rowIndex},${colIndex}`)) continue;
            const merge = mergeMap.get(`${rowIndex},${colIndex}`);
            const cell = row[colIndex] || {};
            const text = renderCellText(cell);
            const style = renderCellStyle(cell);
            const spanAttrs = [];
            if (merge) {
                if (merge.rowspan > 1) spanAttrs.push(`rowspan="${merge.rowspan}"`);
                if (merge.colspan > 1) spanAttrs.push(`colspan="${merge.colspan}"`);
            }
            if (style) spanAttrs.push(`style="${style}"`);
            tableHtml += `<td ${spanAttrs.join(' ')}>${text || '&nbsp;'}</td>`;
        }
        tableHtml += '</tr>';
    }

    tableHtml += `</table></body></html>`;
    console.log(`HTML generated, length: ${tableHtml.length}`);

    const formData = new URLSearchParams();
    formData.append("source", tableHtml);
    const h2iResponse = await fetch(`https://www.html2image.net/api/api.php?key=${env.HTML2IMAGE_API_KEY}&type=png&delay=1`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString()
    });

    const rawResponse = await h2iResponse.text();
    console.log(`HTML2Image response: ${rawResponse.substring(0, 300)}`);
    let h2iData;
    try {
        h2iData = JSON.parse(rawResponse);
    } catch (err) {
        throw new Error(`Gagal merender gambar: respon tidak valid dari HTML2Image (${h2iResponse.status})`);
    }

    if (!h2iData?.Status || h2iData.Status !== "OK" || !h2iData.Link) {
        throw new Error(`Gagal merender gambar: ${h2iData?.Message || JSON.stringify(h2iData)}`);
    }

    const imageUrl = h2iData.Link;
    console.log(`Fetching image from: ${imageUrl}`);
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
        throw new Error(`Gagal mengambil gambar dari HTML2Image: HTTP ${imageRes.status}`);
    }

    const buffer = await imageRes.arrayBuffer();
    console.log(`Image buffer size: ${buffer.byteLength}`);
    if (buffer.byteLength < 100) {
        throw new Error("Gambar hasil rendering tidak valid atau kosong.");
    }

    const header = new Uint8Array(buffer.slice(0, 8));
    const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (!pngSignature.every((byte, index) => header[index] === byte)) {
        throw new Error("Gambar hasil rendering bukan PNG yang valid.");
    }

    return buffer;
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
        const buffer = await generatePrivateSheetBuffer(env, sheetId, tabName, customRange);
        await sendScreenshotToUser(env, buffer, targetId, isGroup, threadId);
    } catch (err) {
        console.error(`Screenshot error: tabName="${tabName}" customRange="${customRange}" - ${err.message}`);
        await replyToUser(env, `❌ ${err.message}`, targetId, isGroup, threadId, originalMessageId);
    }
}