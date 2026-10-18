/* tools/page_shot.mjs —— 三个 tab 各截一张（验证常驻渲染没把布局弄坏）
   跑法：node tools/page_shot.mjs [pro|classic] */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const THEME = process.argv[2] || 'pro';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const OUT = path.join(root, 'tools', 'shots-page');
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-page-' + Date.now());
const dbgPort = 9900 + Math.floor(Math.random() * 80);
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--hide-scrollbars',
  '--window-size=430,932', '--remote-debugging-port=' + dbgPort,
  '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore', detached: true });
child.unref();
let ws;
const cleanup = () => {
  try { ws && ws.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
};
process.on('exit', cleanup);

let msgId = 0, sessionId = null;
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
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result.value;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v; } catch (e) {}
    await sleep(150);
  }
  throw new Error('timeout');
}

try {
  const ver = await waitFor(async () => {
    try { const r = await fetch('http://127.0.0.1:' + dbgPort + '/json/version'); return await r.json(); } catch (e) { return null; }
  });
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, false);
  sessionId = (await send('Target.attachToTarget', { targetId, flatten: true }, false)).sessionId;
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/index.html' });
  await waitFor(async () => (await evaluate('document.readyState')) === 'complete');
  await evaluate("S.onboarded = true; try{ save(); }catch(e){}; var _o=document.getElementById('onboard'); if(_o)_o.classList.remove('show');");
  await evaluate("try{ S.uiTheme='" + THEME + "'; S.uiGlass='frost'; applyLook(); }catch(e){}");
  await sleep(700);

  for (const tab of ['home', 'me', 'chat']) {
    await evaluate("go('" + tab + "')");
    await sleep(700);
    const geo = await evaluate(`(function(){
      var p = document.getElementById('page-${tab}');
      var c = getComputedStyle(p);
      var r = p.getBoundingClientRect();
      /* 可视区里有多少非空内容：被裁掉的页面量不到卡片 */
      var hit = document.elementFromPoint(215, 300);
      return {
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        op: c.opacity, z: c.zIndex, oflow: c.overflowY,
        scrollH: p.scrollHeight, clientH: p.clientHeight,
        at300: hit ? ('<' + hit.tagName + '.' + String(hit.className).split(' ')[0] + '>') : 'null'
      };
    })()`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, THEME + '-' + tab + '.png'), Buffer.from(r.data, 'base64'));
    /* 再来一张滚到底的：确认底栏不压内容 */
    if(tab !== 'chat'){
      await evaluate("(function(){var p=document.getElementById('page-" + tab + "');p.scrollTop=p.scrollHeight;return 1})()");
      await sleep(450);
      const r2 = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, THEME + '-' + tab + '-bottom.png'), Buffer.from(r2.data, 'base64'));
      await evaluate("(function(){var p=document.getElementById('page-" + tab + "');p.scrollTop=0;return 1})()");
      await sleep(250);
    }
    console.log(tab.padEnd(5) + ' rect=' + JSON.stringify(geo.rect) + ' op=' + geo.op + ' z=' + geo.z
      + ' 滚动 ' + geo.scrollH + '/' + geo.clientH + ' · (215,300)处=' + geo.at300);
  }
  console.log('\n截图：tools/shots-page/' + THEME + '-*.png');
} catch (e) {
  console.error('失败：' + e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}