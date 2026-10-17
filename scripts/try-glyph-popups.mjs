/** Bounded, recorded public-SDK trials. Uses the copied runtime, not account/course state. */
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(project, process.argv[2] || 'output/playwright/glyph-live-10-20261017');
if (existsSync(join(out, 'results.json'))) throw new Error('Choose a fresh output directory');
mkdirSync(out, { recursive: true });
const runtime = join(project, 'resources/glyph-recognition');
const { Detector, RoiClassifier, decodeRgb, recognize } = await import(pathToFileURL(join(runtime, 'js/src/index.mjs')).href);
const detector = await Detector.create(join(runtime, 'models/detector.onnx'));
const classifier = await RoiClassifier.create(join(runtime, 'models/roi-classifier'));
const trials = [];
let browser, context, page, video, blocked = false;
const startedAt = new Date().toISOString();
const clean = value => String(value).replace(/https?:\/\/\S+/g, '[URL omitted]').slice(0, 240);
const save = extra => writeFileSync(join(out, 'status.json'), JSON.stringify({ startedAt, requested: 10, trials, ...extra }, null, 2));
const state = () => {
  const popup = Array.from(document.querySelectorAll('.yidun_popup')).find(el => {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
  });
  const image = popup?.querySelector('.yidun_bg-img');
  if (!image) return null;
  const r = image.getBoundingClientRect();
  return { source: image.currentSrc, instruction: popup.querySelector('.yidun_tips__text')?.textContent?.trim(),
    width: image.naturalWidth, height: image.naturalHeight, complete: image.complete,
    rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
};
const panel = async (number, text) => page.evaluate(({ number, text }) => {
  let el = document.getElementById('__glyph_trial');
  if (!el) {
    el = document.createElement('div'); el.id = '__glyph_trial'; document.body.appendChild(el);
    el.style.cssText = 'position:fixed;left:16px;top:12px;right:16px;z-index:2147483647;pointer-events:none;background:#142235ee;color:white;padding:14px 18px;border-radius:10px;font:16px system-ui;box-shadow:0 5px 20px #0004';
  }
  el.textContent = `离线模型真实弹窗测试 ${number}/10 · ${text}`;
}, { number, text });

try {
  browser = await chromium.launch({ headless: false });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, recordVideo: { dir: join(out, 'video'), size: { width: 1280, height: 900 } } });
  page = await context.newPage(); video = page.video();
  const responses = new Map();
  let checks = [];
  page.on('response', response => {
    const url = new URL(response.url());
    const provider = /dun\.163\.com|cstaticdun\.|necaptcha\.|nosdn\.127\.net/.test(url.hostname);
    if (provider && [403, 429].includes(response.status())) blocked = true;
    if (response.request().resourceType() === 'image') {
      responses.set(response.url(), response);
      if (responses.size > 30) responses.delete(responses.keys().next().value);
    }
    if (provider && /\/check(?:\?|$)/.test(response.url())) {
      const current = checks;
      void response.text().then(body => {
        const wrapped = body.match(/^[\w.$]+\(([\s\S]*)\)\s*;?\s*$/);
        const payload = JSON.parse(wrapped ? wrapped[1] : body);
        current.push({ error: payload.error ?? null, message: clean(payload.msg ?? ''), result: typeof payload.data?.result === 'boolean' ? payload.data.result : null });
      }).catch(() => current.push({ parseError: true }));
    }
  });
  for (let number = 1; number <= 10; number++) {
    if (blocked || existsSync(join(out, 'STOP'))) break;
    const dir = join(out, String(number).padStart(2, '0')); mkdirSync(dir);
    const record = { number, startedAt: new Date().toISOString(), submitted: false, outcome: 'initializing' };
    trials.push(record); checks = []; responses.clear(); save();
    try {
      await page.goto('https://www.zhihuishu.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.evaluate(() => {
        window.__trialSuccess = false; window.__trialSdkError = false;
        if (!document.querySelector('#captchaYidun')) { const div = document.createElement('div'); div.id = 'captchaYidun'; document.body.appendChild(div); }
      });
      await panel(number, '正在触发验证码');
      if (!await page.evaluate(() => typeof window.initNECaptchaWithFallback === 'function')) await page.addScriptTag({ url: 'https://www.zhihuishu.com/assets/ableCaptcha/yidun-captcha.js' });
      if (!await page.evaluate(() => typeof window.initAbleYidunFallback === 'function')) await page.addScriptTag({ url: 'https://www.zhihuishu.com/assets/ableCaptcha/ableCaptchaCommon.js' });
      const initialized = await page.evaluate(() => Promise.race([
        new Promise(resolve => window.initAbleYidunFallback({ showPop: true, enableClose: 1, capType: 'space',
          captchaIns: instance => { instance.popUp(); resolve(true); },
          onSuccessAble: () => { window.__trialSuccess = true; }, onErrorAble: () => { window.__trialSdkError = true; resolve(false); } })),
        new Promise(resolve => setTimeout(() => resolve(false), 25000)),
      ]));
      if (!initialized || blocked) throw new Error('SDK initialization failed or provider rate-limited');
      await page.waitForFunction(() => {
        const image = document.querySelector('.yidun_popup .yidun_bg-img');
        return image?.complete && image.naturalWidth > 0 && /^请点击/.test(document.querySelector('.yidun_popup .yidun_tips__text')?.textContent?.trim() || '');
      }, null, { timeout: 25000 });
      await page.waitForTimeout(800);
      const before = await page.evaluate(state);
      if (!before?.complete || !before.instruction || blocked) throw new Error('No complete visible challenge');
      writeFileSync(join(dir, 'snapshot.txt'), await page.locator('body').ariaSnapshot());
      const originalResponse = responses.get(before.source);
      if (!originalResponse) throw new Error('Original challenge response unavailable');
      const bytes = await originalResponse.body();
      const image = await decodeRgb(bytes);
      if (image.width !== before.width || image.height !== before.height) throw new Error('Image dimensions changed');
      const filename = bytes[0] === 0xff ? 'original.jpg' : 'original.png';
      writeFileSync(join(dir, filename), bytes);
      Object.assign(record, { instruction: before.instruction, original: filename,
        sha256: createHash('sha256').update(bytes).digest('hex'), imageSize: { width: image.width, height: image.height } });
      await panel(number, `题目：${before.instruction}`);
      await page.screenshot({ path: join(dir, 'before.png') });
      if (number === 1 && process.argv.includes('--inspect-first')) {
        console.log('FIRST_CHALLENGE_READY'); save({ phase: 'awaiting-first-review' });
        const until = Date.now() + 120000;
        while (!existsSync(join(out, 'CONTINUE')) && Date.now() < until) await page.waitForTimeout(250);
        if (!existsSync(join(out, 'CONTINUE'))) throw new Error('First-challenge review timed out');
      }
      const start = performance.now();
      const result = await recognize(image.pixels, image.width, image.height, before.instruction, detector, classifier);
      record.inferenceMs = Math.round(performance.now() - start);
      writeFileSync(join(dir, 'prediction.json'), JSON.stringify(result, null, 2));
      record.predictionStatus = result.status; record.predictionReason = result.reason; record.targetId = result.targetId;
      const target = result.objects.find(object => object.id === result.targetId), point = result.pointInImage;
      if (result.status !== 'matched' || !point || !target || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        point.x <= 0 || point.y <= 0 || point.x >= image.width || point.y >= image.height ||
        point.x < target.bbox_xyxy[0] || point.x > target.bbox_xyxy[2] || point.y < target.bbox_xyxy[1] || point.y > target.bbox_xyxy[3]) {
        record.outcome = 'abstained';
        await panel(number, `未提交：${result.reason || result.status}`);
      } else {
        const current = await page.evaluate(state);
        if (!current || current.source !== before.source || current.instruction !== before.instruction || blocked || existsSync(join(out, 'STOP'))) throw new Error('Challenge changed or trial stopped before click');
        const x = current.rect.x + point.x * current.rect.width / image.width;
        const y = current.rect.y + point.y * current.rect.height / image.height;
        record.pointInImage = point; record.pagePoint = { x, y };
        await panel(number, `模型选择：${target.identity} / ${target.orientation} / ${target.color} · ${record.inferenceMs} ms`);
        await page.evaluate(({ x, y }) => {
          const mark = document.createElement('div'); mark.id = '__glyph_target';
          mark.style.cssText = `position:fixed;left:${x - 15}px;top:${y - 15}px;width:30px;height:30px;border:3px solid #ff3153;border-radius:50%;z-index:2147483646;pointer-events:none;box-sizing:border-box;background:#ff315322`;
          document.body.appendChild(mark);
        }, { x, y });
        await page.screenshot({ path: join(dir, 'selection.png') });
        await page.waitForTimeout(1300);
        const final = await page.evaluate(state);
        if (!final || final.source !== before.source || final.instruction !== before.instruction) throw new Error('Challenge refreshed before click');
        const box = await page.locator('.yidun_popup:visible .yidun_bg-img').boundingBox();
        if (!box) throw new Error('Challenge disappeared before click');
        const click = { x: box.x + point.x * box.width / image.width, y: box.y + point.y * box.height / image.height };
        const unobstructed = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.yidun_popup') != null, click);
        if (!unobstructed || blocked || existsSync(join(out, 'STOP'))) throw new Error('Challenge obstructed or stopped before click');
        await page.mouse.click(click.x, click.y); record.submitted = true;
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline && !blocked) {
          const success = await page.evaluate(() => window.__trialSuccess === true);
          if (success || checks.some(check => check.result === true)) { record.outcome = 'accepted'; break; }
          if (checks.some(check => check.result === false)) { record.outcome = 'rejected'; break; }
          await page.waitForTimeout(200);
        }
        if (record.outcome === 'initializing') record.outcome = 'unconfirmed';
        record.providerChecks = [...checks];
        record.successCallback = await page.evaluate(() => window.__trialSuccess === true);
        await panel(number, `站点结果：${record.outcome === 'accepted' ? '验证通过' : record.outcome === 'rejected' ? '验证未通过' : '未获得明确确认'}`);
      }
      await page.waitForTimeout(1600);
      await page.screenshot({ path: join(dir, 'after.png') });
    } catch (error) {
      record.outcome = 'error'; record.error = clean(error);
      await page.screenshot({ path: join(dir, 'error.png') }).catch(() => {});
    }
    record.finishedAt = new Date().toISOString();
    writeFileSync(join(dir, 'result.json'), JSON.stringify(record, null, 2)); save(); console.log(JSON.stringify(record));
    if (number < 10 && !blocked) await page.waitForTimeout(8000);
  }
} finally {
  await context?.close().catch(() => {});
  if (video) { const recorded = await video.path(); renameSync(recorded, join(out, 'session.webm')); }
  await browser?.close().catch(() => {});
  await classifier.session.release(); await detector.session.release();
  const summary = { startedAt, finishedAt: new Date().toISOString(), requested: 10, triggered: trials.length,
    submitted: trials.filter(t => t.submitted).length, accepted: trials.filter(t => t.outcome === 'accepted').length,
    rejected: trials.filter(t => t.outcome === 'rejected').length, unconfirmed: trials.filter(t => t.outcome === 'unconfirmed').length,
    abstained: trials.filter(t => t.outcome === 'abstained').length, errors: trials.filter(t => t.outcome === 'error').length,
    stoppedForProviderLimit: blocked, scope: 'Public SDK popup + copied models; not the production CaptchaService hook', trials };
  writeFileSync(join(out, 'results.json'), JSON.stringify(summary, null, 2));
  save({ complete: trials.length === 10 });
  console.log('SUMMARY ' + JSON.stringify({ ...summary, trials: undefined }));
}
