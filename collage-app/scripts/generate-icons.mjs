// public/favicon.svg から PWA 用 PNG アイコンを生成する（Playwright の Chromium を使用）
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['apple-touch-icon.png', 180, 0]]) {
  await page.setViewportSize({ width: size, height: size });
  // apple-touch-icon は iOS 側で角丸になるため、背景を全面に塗る
  const body = name.startsWith('apple')
    ? svg.replace('rx="112"', 'rx="0"')
    : svg;
  await page.setContent(`<html><body style="margin:0;background:transparent">${body.replace('<svg ', `<svg width="${size - pad * 2}" height="${size - pad * 2}" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: true });
  console.log('wrote', name);
}
await browser.close();
