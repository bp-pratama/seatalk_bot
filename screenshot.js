import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

function getSystemChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  return candidates.find(p => p && fs.existsSync(p));
}

async function ensureDir(dir) {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (err) {
    // ignore
  }
}

function bufferToBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

async function getSeatalkToken(appId, appSecret) {
  console.log('SeaTalk auth request: appId=', appId ? 'SET' : 'MISSING', 'appSecret=', appSecret ? 'SET' : 'MISSING');
  const res = await fetch('https://openapi.seatalk.io/auth/app_access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const responseText = await res.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    throw new Error('Gagal parse response SeaTalk auth: ' + responseText);
  }
  console.log('SeaTalk auth response status:', res.status, 'body:', JSON.stringify(data));
  if (!data?.app_access_token) {
    throw new Error('Gagal mendapatkan token SeaTalk: ' + JSON.stringify(data));
  }
  return data.app_access_token;
}

async function sendScreenshotToSeatalk(appId, appSecret, targetId, isGroup, threadId, originalMessageId, buffer) {
  const token = await getSeatalkToken(appId, appSecret);
  const base64Image = bufferToBase64(buffer);

  const endpoint = isGroup ? 'https://openapi.seatalk.io/messaging/v2/group_chat' : 'https://openapi.seatalk.io/messaging/v2/single_chat';
  const requestBase = isGroup ? { group_id: targetId } : { employee_code: targetId };
  const messageVariants = [
    { tag: 'image', image_base64: { content: base64Image } },
    { tag: 'image', image: { base64: base64Image } },
    { tag: 'image', image: { base64: base64Image, type: 'image/png' } },
    { tag: 'image', image: { content: base64Image } },
    { tag: 'image', image: { content: base64Image, type: 'image/png' } },
    { tag: 'image', image_base64: base64Image },
    { tag: 'image', image: { data: base64Image } },
    { tag: 'image', image: { data: base64Image, type: 'image/png' } },
    { tag: 'image', image_base64: { data: base64Image } }
  ];

  let lastError = null;
  for (const variant of messageVariants) {
    const requestBody = { ...requestBase, message: variant };
    if (isGroup && threadId) requestBody.thread_id = threadId;
    else if (isGroup && originalMessageId) requestBody.thread_id = originalMessageId;

    console.log('SeaTalk image request variant:', JSON.stringify(variant).substring(0, 200));
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(requestBody)
    });
    const responseData = await response.json();

    console.log('SeaTalk image response:', JSON.stringify(responseData).substring(0, 300));

    if (responseData.code === 0) {
      return responseData;
    }

    lastError = responseData;
    if (responseData.code !== 4003 || typeof responseData.message !== 'string' || !responseData.message.includes('Message cannot be empty')) {
      throw new Error('SeaTalk image upload failed: ' + JSON.stringify(responseData));
    }
  }

  throw new Error('SeaTalk image upload failed: ' + JSON.stringify(lastError));
}

async function run() {
  const targetUrl = process.env.TARGET_URL;
  if (!targetUrl) {
    console.error('ERROR: TARGET_URL environment variable is required.');
    process.exit(1);
  }

  const outDir = path.resolve(process.cwd(), 'screenshots');
  await ensureDir(outDir);
  const outPath = path.join(outDir, `capture-${Date.now()}.png`);

  let browser;
  try {
    const launchOptions = {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: 'new',
    };
    const systemChrome = getSystemChromePath();
    if (systemChrome) {
      launchOptions.executablePath = systemChrome;
    }

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`Navigating to ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const screenshotBuffer = await page.screenshot({ fullPage: false });
    await fs.promises.writeFile(outPath, screenshotBuffer);
    console.log(`Screenshot saved locally: ${outPath}`);

    const seatalkTargetId = process.env.SEATALK_TARGET_ID || '';
    const seatalkAppId = process.env.SEATALK_APP_ID || '';
    const seatalkAppSecret = process.env.SEATALK_APP_SECRET || '';
    const seatalkIsGroup = process.env.SEATALK_IS_GROUP === '1';
    const seatalkThreadId = process.env.SEATALK_THREAD_ID || '';
    const seatalkOriginalMessageId = process.env.SEATALK_ORIGINAL_MESSAGE_ID || '';

    console.log('SeaTalk env debug:', {
      targetId: seatalkTargetId ? 'SET' : 'MISSING',
      appId: seatalkAppId ? 'SET' : 'MISSING',
      appSecret: seatalkAppSecret ? 'SET' : 'MISSING',
      isGroup: seatalkIsGroup,
      threadId: seatalkThreadId ? 'SET' : 'EMPTY',
      originalMessageId: seatalkOriginalMessageId ? 'SET' : 'EMPTY'
    });

    if (seatalkTargetId && seatalkAppId && seatalkAppSecret) {
      console.log(`Sending screenshot to SeaTalk target ${seatalkTargetId}`);
      const result = await sendScreenshotToSeatalk(
        seatalkAppId,
        seatalkAppSecret,
        seatalkTargetId,
        seatalkIsGroup,
        seatalkThreadId,
        seatalkOriginalMessageId,
        screenshotBuffer
      );
      console.log('SeaTalk send successful', result);
    } else {
      console.log('SeaTalk target not configured. Screenshot saved locally only.');
    }
  } catch (err) {
    console.error('Screenshot failed:', err && err.message ? err.message : err);
    process.exitCode = 2;
  } finally {
    try {
      if (browser) await browser.close();
    } catch (e) {}
  }
}

run();
