import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTDIR = path.join(root, 'tools', 'shots_appearance');
fs.rmSync(SHOTDIR, { recursive: true, force: true });
fs.mkdirSync(SHOTDIR, { recursive: true });

const WIDTH = Number(process.env.VIEWPORT_W || 412);
const HEIGHT = Number(process.env.VIEWPORT_H || 915);

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(root, 'index.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const URL_ = 'http://127.0.0.1:' + port + '/index.html';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-app-' + Date.now());
const dbgPort = 9700 + Math.floor(Math.random() * 200);
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--hide-scrollbars',
  '--window-size=' + WIDTH + ',' + HEIGHT,
  '--force-device-scale-factor=1',
  '--remote-debugging-port=' + dbgPort, '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore', detached: true });
child.unref();

const cleanup = () => {
  try { ws && ws.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
};
process.on('exit', cleanup);

async function waitFor(fn, ms = 40000, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await new Promise(r => setTimeout(r, step)); }
  throw new Error('timeout');
}
let ws, msgId = 0, sessionId = null;
const pending = new Map();
function send(method, params = {}, useSession = true) {
  const id = ++msgId;
  const msg = { id, method, params };
  if (useSession && sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
  return r.result.value;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(SHOTDIR, String(++n).padStart(2, '0') + '-' + name + '.png');
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  console.log('  shot ' + path.basename(f));
}

const log = [];
try {
  const ver = await waitFor(async () => { try { const r = await fetch('http://127.0.0.1:' + dbgPort + '/json/version'); return await r.json(); } catch (e) { return null; } });
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  const events = [];
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; events.push('EXC: ' + ((d.exception && d.exception.description) || d.text)); }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') events.push('LOG: ' + m.params.entry.text);
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, false);
  const att = await send('Target.attachToTarget', { targetId, flatten: true }, false);
  sessionId = att.sessionId;
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL_ });
  await waitFor(async () => (await evaluate('document.readyState')) === 'complete');
  await sleep(1500);
  await evaluate("(function(){var o=document.getElementById('onboard');if(o)o.classList.remove('show');document.body.classList.remove('ob-open');try{S.onboarded=true;}catch(e){}return 1})()");
  await sleep(400);

  // 打开「我的」页并滚到外观区
  await evaluate("(function(){go('me');return 1})()");
  await sleep(700);

  async function gotoAppearance(){
    await evaluate(`(function(){
      var h2 = [].slice.call(document.querySelectorAll('#page-me .h2')).filter(function(e){return e.textContent.indexOf('外观')>=0})[0];
      if(h2) h2.scrollIntoView({block:'start'});
      var sc = document.querySelector('#page-me .list, #page-me');
      return 1;
    })()`);
    await sleep(400);
  }

  for (const fsName of ['sm','md','lg','xl']) {
    await evaluate(`(function(){ setFontScale('${fsName}'); return 1 })()`);
    await sleep(350);
    await gotoAppearance();
    await shot('fs-' + fsName);
    // 量一下有没有横向溢出
    log.push('fs=' + fsName
      + ' data-fs=' + await evaluate("document.documentElement.dataset.fs")
      + ' 正文=' + await evaluate("getComputedStyle(document.querySelector('#page-me .li .tx b')).fontSize")
      + ' 溢出=' + await evaluate("document.getElementById('phone').scrollWidth > document.getElementById('phone').clientWidth"));
  }

  // 深色 + 降明度对照
  await evaluate("(function(){ setFontScale('md'); setTheme('dark'); S.dimBrand=false; applyLook(); return 1 })()");
  await sleep(400);
  await gotoAppearance();
  await shot('dark-dim-off');
  log.push('dark off --brand=' + await evaluate("document.documentElement.style.getPropertyValue('--brand')"));

  await evaluate("(function(){ setDimBrand(true); return 1 })()");
  await sleep(400);
  await gotoAppearance();
  await shot('dark-dim-on');
  log.push('dark on  --brand=' + await evaluate("document.documentElement.style.getPropertyValue('--brand')"));

  await evaluate("(function(){ setDimBrand(false); return 1 })()");
  await sleep(400);
  await gotoAppearance();
  await shot('dark-dim-back-to-off');
  log.push('dark 关  --brand=' + await evaluate("document.documentElement.style.getPropertyValue('--brand')"));

  // 浅色对照
  await evaluate("(function(){ setTheme('light'); return 1 })()");
  await sleep(400);
  await gotoAppearance();
  await shot('light-dim-ignored');
  log.push('light    --brand=' + await evaluate("document.documentElement.style.getPropertyValue('--brand')"));

  // 特大字号下的聊天页，看排版会不会崩
  await evaluate("(function(){ setFontScale('xl'); setTheme('system'); go('chat'); return 1 })()");
  await sleep(600);
  await shot('chat-xl');
  log.push('chat xl 气泡字号=' + await evaluate("(function(){var b=document.querySelector('#page-chat .msg .bubble');return b?getComputedStyle(b).fontSize:'无气泡'})()"));

  console.log('\n=== LOG ===');
  console.log(log.join('\n'));
  console.log('\n=== PAGE ERRORS ===');
  console.log(events.length ? events.slice(0, 15).join('\n') : 'none');
  cleanup();
  process.exit(0);
} catch (e) {
  console.log('HARNESS ERROR: ' + (e && e.stack || e));
  console.log(log.join('\n'));
  cleanup();
  process.exit(3);
}
