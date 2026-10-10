#!/usr/bin/env node
// Cold deep links use only synthetic owner state and never warm unrelated apps.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect as assertion } from '@playwright/test';
import { releaseFixture } from './release-fixture.mjs';
const expect = assertion.configure({ timeout: 15000 });
const chunks = new Map(fs.readdirSync('.next/static/chunks').filter(file => file.endsWith('.js'))
  .map(file => [file, fs.readFileSync(path.join('.next/static/chunks', file), 'utf8')]));
const vaultFiles = new Set([...chunks].filter(([, text]) => text.includes('Repository knowledge and recorded progress')).map(([file]) => file));
expect(vaultFiles.size).toBeGreaterThan(0);
const heavy = ['react-flow__renderer', 'Konva error', 'xterm-screen', 'ort-wasm-simd-threaded'];
const fixture = await releaseFixture({ live: true });
let browser;
try {
  const response = await fetch(fixture.base + '/api/auth/login', { method: 'POST', headers: { origin: fixture.base, 'content-type': 'application/json' }, body: JSON.stringify({ password: fixture.password, deviceId: fixture.device, deviceLabel: 'Synthetic deep-link QA' }) });
  expect(response.ok).toBe(true);
  const cookie = /(?:^|,\s*)session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1];
  expect(cookie).toBeTruthy();
  browser = await chromium.launch({ headless: true });
  for (const shell of ['macos', 'windows', 'dashboard', 'ios', 'android']) {
    const mobile = ['ios', 'android'].includes(shell);
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await context.addCookies([{ name: 'session', value: cookie, url: fixture.base, sameSite: 'Strict' }]);
    await context.addInitScript(({ shell, mobile, device }) => {
      localStorage.setItem('mso.device.id', device);
      localStorage.setItem('mso:onboarding:v1', 'done');
      localStorage.setItem('sv:shell', JSON.stringify({ desktop: mobile ? 'macos' : shell, mobile: mobile ? shell : 'ios' }));
    }, { shell, mobile, device: fixture.device });
    const page = await context.newPage(), requests = [], errors = [];
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(fixture.base + '/agent-vault', { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`#main-content[data-shell="${shell}"]`)).toBeVisible();
    await expect(page.locator('[data-slot="native-vault"]')).toBeVisible();
    await expect.poll(() => requests.findIndex(url => url.startsWith('/app-icons/'))).toBeGreaterThan(-1);
    const vaultIndex = requests.findIndex(url => vaultFiles.has(url.split('/').at(-1)));
    expect(vaultIndex).toBeGreaterThan(-1);
    expect(vaultIndex).toBeLessThan(requests.findIndex(url => url.startsWith('/app-icons/')));
    expect(requests.filter(url => heavy.some(marker => chunks.get(url.split('/').at(-1))?.includes(marker)))).toEqual([]);
    expect(errors).toEqual([]);
    console.log(`PASS ${shell}: requested Vault before artwork, no unrelated heavy engine or page error`);
    await context.close();
  }
} finally { await browser?.close(); await fixture.close(); }
