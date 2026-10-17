// Measure image delivery only. No recognition, answer clicks, or validation.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const out = resolve('output/playwright/captcha-dpr-probe-' + Date.now());
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: false });
const results = [];
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
    try {
      const page = await context.newPage();
      const images = new Map();
      page.on('response', response => {
        if (response.request().resourceType() === 'image') images.set(response.url(), response);
      });
      await page.goto('https://www.zhihuishu.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.evaluate(() => {
        if (!document.querySelector('#captchaYidun')) {
          const el = document.createElement('div'); el.id = 'captchaYidun'; document.body.appendChild(el);
        }
      });
      if (!await page.evaluate(() => typeof window.initNECaptchaWithFallback === 'function'))
        await page.addScriptTag({ url: 'https://www.zhihuishu.com/assets/ableCaptcha/yidun-captcha.js' });
      if (!await page.evaluate(() => typeof window.initAbleYidunFallback === 'function'))
        await page.addScriptTag({ url: 'https://www.zhihuishu.com/assets/ableCaptcha/ableCaptchaCommon.js' });
      await page.evaluate(() => Promise.race([
        new Promise(resolve => window.initAbleYidunFallback({ showPop: true, enableClose: 1, capType: 'space',
          captchaIns: instance => { instance.popUp(); resolve(true); }, onSuccessAble: () => {}, onErrorAble: () => resolve(false) })),
        new Promise(resolve => setTimeout(() => resolve(false), 25000))
      ]));
      await page.waitForFunction(() => {
        const img = document.querySelector('.yidun_popup .yidun_bg-img');
        return img?.complete && img.naturalWidth > 0;
      }, null, { timeout: 25000 });
      const state = await page.evaluate(() => {
        const img = document.querySelector('.yidun_popup .yidun_bg-img');
        const r = img.getBoundingClientRect();
        return { source: img.currentSrc, dpr: devicePixelRatio, userAgent: navigator.userAgent,
          naturalSize: { width: img.naturalWidth, height: img.naturalHeight },
          displaySize: { width: r.width, height: r.height }, viewport: { width: innerWidth, height: innerHeight } };
      });
      const response = images.get(state.source);
      if (!response) throw new Error('Image response unavailable');
      const bytes = await response.body();
      const decoded = bytes[0] === 0xff ? jpeg.decode(bytes) : PNG.sync.read(bytes);
      const { source, ...safeState } = state;
      const shot = await page.locator('.yidun_popup .yidun_bg-img').screenshot({ path: join(out, `dpr-${dpr}-element.png`) });
      const screenshot = PNG.sync.read(shot);
      const row = { configuredDpr: dpr, ...safeState, responseSize: { width: decoded.width, height: decoded.height },
        screenshotSize: { width: screenshot.width, height: screenshot.height }, browserVersion: browser.version(),
        recognized: false, submitted: false };
      results.push(row);
      writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
      console.log(JSON.stringify(row));
    } finally { await context.close(); }
  }
} finally { await browser.close(); console.log('Artifacts: ' + out); }
