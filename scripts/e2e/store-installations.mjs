#!/usr/bin/env node
// Fresh defaults and UI installs use generated owner state, never deployment data.
import { chromium, firefox, webkit, expect as assertion } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { releaseFixture } from './release-fixture.mjs';

const expect = assertion.configure({ timeout: 15000 });
const engine = process.argv[2] ?? 'chromium';
if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error('Unknown browser');
const output = process.env.MSO_SCREENSHOT_DIR;
const fixture = await releaseFixture();
const results = []; let browser;
const shells = ['macos', 'windows', 'dashboard', 'ios', 'android'];
const mobile = shell => ['ios', 'android'].includes(shell);
const viewport = shell => mobile(shell) ? {width:390,height:844} : {width:1363,height:936};
const card = (page, title) => page.getByRole('tabpanel').getByRole('article', {name:`${title} app`,exact:true});
const installed = entry => entry.getByRole('button', {name:/^(Installed|Uninstall)$/});
async function screenshot(page, name) {
  if (!output) return;
  await mkdir(output, {recursive:true, mode:0o700});
  await page.screenshot({path:path.join(output,`${engine}-${name}.png`),animations:'disabled'});
}
async function switchShell(page, shell) {
  await page.setViewportSize(viewport(shell));
  await page.evaluate(({shell, isMobile}) => localStorage.setItem('sv:shell',JSON.stringify({desktop:isMobile?'macos':shell,mobile:isMobile?shell:'ios'})), {shell,isMobile:mobile(shell)});
  await page.reload();
  await expect(page.locator(`[data-shell="${shell}"]`)).toBeVisible();
}
try {
  const response=await fetch(fixture.base+'/api/auth/login',{method:'POST',headers:{origin:fixture.base,'content-type':'application/json'},body:JSON.stringify({password:fixture.password,deviceId:fixture.device,deviceLabel:'Synthetic Store QA'})});
  expect(response.ok).toBe(true);
  const cookie=/(?:^|,\s*)session=([^;]+)/.exec(response.headers.get('set-cookie')??'')?.[1]; expect(cookie).toBeTruthy();
  browser=await ({chromium,firefox,webkit})[engine].launch({headless:true, ...(engine==='webkit' && process.env.QA_WEBKIT_EXECUTABLE ? {executablePath:process.env.QA_WEBKIT_EXECUTABLE} : {})});
  const sentinel=path.join(fixture.dir,'fixture.txt'), original=await readFile(sentinel,'utf8');
  for (const initialShell of shells) {
    const context=await browser.newContext({viewport:viewport(initialShell),deviceScaleFactor:mobile(initialShell)?3:2,hasTouch:mobile(initialShell),serviceWorkers:'block'});
    await context.addCookies([{name:'session',value:cookie,url:fixture.base,sameSite:'Strict'}]);
    await context.addInitScript(({shell,isMobile})=>{
      if (window !== window.top) return;
      if (!localStorage.getItem('sv:shell')) localStorage.setItem('sv:shell',JSON.stringify({desktop:isMobile?'macos':shell,mobile:isMobile?shell:'ios'}));
      localStorage.setItem('mso:onboarding:v1','done');
    },{shell:initialShell,isMobile:mobile(initialShell)});
    const page=await context.newPage(), errors=[];
    context.on('page', p=>p.on('pageerror',error=>errors.push(error.message))); page.on('pageerror',error=>errors.push(error.message));
    await page.goto(fixture.base);await expect(page.locator(`[data-shell="${initialShell}"]`)).toBeVisible();
    await screenshot(page,`${initialShell}-essentials-home`);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox',{name:'Spotlight search'}).fill('Agent Vault');
    await expect(page.getByRole('option').filter({hasText:'Agent Vault'})).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto(fixture.base+'/store');
    await expect(page.getByRole('tab',{name:'Apps',exact:true})).toHaveAttribute('aria-selected','true');
    const panel=page.getByRole('tabpanel'), cards=panel.getByRole('article');
    await expect(cards).toHaveCount(27);
    await expect(panel.getByRole('button',{name:/^(Installed|Uninstall)$/})).toHaveCount(6);
    await expect(panel.getByRole('button',{name:'Required',exact:true})).toBeDisabled();
    await expect(card(page,'Camoufox')).toBeVisible(); await expect(installed(card(page,'Hermes'))).toBeVisible();
    await expect(card(page,'Agent Vault').getByRole('button',{name:'Install',exact:true})).toBeVisible();
    const n8n=card(page,'n8n');
    await expect.poll(()=>n8n.locator('img').evaluate(img=>img.complete && img.naturalWidth>0)).toBe(true);
    await expect(n8n.locator('img')).toHaveAttribute('src','/brand/official/n8n.svg');
    await screenshot(page,`${initialShell}-native-catalog`);
    const a11y=await new AxeBuilder({page}).include('[role="tabpanel"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(a11y.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
    await n8n.getByRole('button',{name:'Install',exact:true}).focus();await page.keyboard.press('Enter');await expect(installed(n8n)).toBeVisible();
    // Change only presentation; all five shells read the same install record.
    for (const shell of shells) {
      await switchShell(page,shell);await expect(installed(card(page,'n8n'))).toBeVisible();
      expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mso:enabled:v1')).n8n)).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    }
    await page.setViewportSize({width:844,height:390});await page.reload();
    await expect(installed(card(page,'n8n'))).toBeVisible();await screenshot(page,`${initialShell}-shared-landscape`);
    const other=await context.newPage();await other.goto(fixture.base+'/store');await expect(installed(card(other,'n8n'))).toBeVisible();
    await installed(card(page,'n8n')).click();
    const confirm=page.getByRole('dialog');await expect(confirm.getByText('Your data stays on disk. You can reinstall any time.')).toBeVisible();
    await confirm.getByRole('button',{name:'Cancel',exact:true}).click();await expect(installed(card(page,'n8n'))).toBeVisible();
    await installed(card(page,'n8n')).click();await confirm.getByRole('button',{name:'Uninstall',exact:true}).click();
    await expect(card(other,'n8n').getByRole('button',{name:'Install',exact:true})).toBeVisible();
    expect(await readFile(sentinel,'utf8')).toBe(original);await other.close();
    await page.reload();await expect(card(page,'n8n').getByRole('button',{name:'Install',exact:true})).toBeVisible();
    const requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
    await page.goto(fixture.base+'/n8n');await expect(page.getByText('n8n is not installed.',{exact:true})).toBeVisible();
    await expect(page.locator('[data-slot="n8n-feature"]')).toHaveCount(0);expect(requests.includes('/api/v1/workflow-embeds')).toBe(false);
    await screenshot(page,`${initialShell}-uninstalled-deep-link`);
    await page.getByRole('button',{name:'Open App Store',exact:true}).click();
    await expect(page.getByPlaceholder('Search apps')).toHaveValue('n8n');
    await card(page,'n8n').getByRole('button',{name:'Install',exact:true}).click();
    await page.goto(fixture.base+'/n8n');await expect(page.locator('[data-slot="n8n-feature"]')).toBeVisible();
    expect(errors).toEqual([]);await context.close();
    results.push({engine,initialShell,dpr:mobile(initialShell)?3:2,freshEssentials:7,catalog:27,switches:5,crossTab:'PASS',reload:'PASS',keyboard:'PASS',landscape:'PASS',uninstalledLazyLoad:'PASS',a11y:'PASS',sentinel:'PASS'});
    console.log(`PASS ${engine}/${initialShell}: seven defaults, complete catalog, all-shell install, cross-tab/reload, guarded removal, lazy deep link and accessibility`);
  }
  if (output) await writeFile(path.join(output,`${engine}-store-results.json`),JSON.stringify({synthetic:true,results},null,2),{mode:0o600});
} finally {await browser?.close();await fixture.close();}
