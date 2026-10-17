/* tools/shot_focusbar.mjs —— 专注条样张
   整条 / 收起成小块 / 暂停（小块也要看得出停了）/ 拖到左缘吸附 / 展回整条 / 全屏专注页。
   用法：node tools/shot_focusbar.mjs  → 图在 tools/shots_focusbar/ */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTDIR = path.join(root, 'tools', 'shots_focusbar');
fs.rmSync(SHOTDIR, { recursive: true, force: true });
fs.mkdirSync(SHOTDIR, { recursive: true });

const WIDTH = Number(process.env.VIEWPORT_W || 430);
const HEIGHT = Number(process.env.VIEWPORT_H || 932);

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(root, 'index.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const URL_ = 'http://127.0.0.1:' + port + '/index.html';

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-fb-' + Date.now());
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
const R = `(function(){
  var e = document.getElementById('focusBar'), r = e.getBoundingClientRect(), st = getComputedStyle(e);
  return JSON.stringify({形态: e.classList.contains('pill') ? 'pill' : 'bar',
    左: Math.round(r.left), 上: Math.round(r.top), 宽: Math.round(r.width), 高: Math.round(r.height),
    可见: st.visibility, 透明: st.opacity});
})()`;

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
  await sleep(1400);
  await evaluate("(function(){var o=document.getElementById('onboard');if(o)o.classList.remove('show');document.body.classList.remove('ob-open');try{S.onboarded=true;}catch(e){}return 1})()");
  await sleep(400);

  await evaluate(`(function(){
    document.querySelectorAll('.view.show').forEach(function(e){ e.classList.remove('show'); });
    S.focus = JSON.parse(JSON.stringify(DEFAULT.focus));
    S.focus.on = true; S.focus.label = '高等数学 · 实验楼 B204'; S.focus.mode = 'work';
    S.focus.dir = 'down'; S.focus.total = 2700; S.focus.secs = 1543;
    fbState = 'bar'; fbPos = null; S.fbPos = null;
    go('home'); renderFocus(); return 1;
  })()`);
  await sleep(700);
  await shot('1-bar');
  log.push('① 整条        ' + await evaluate(R));

  await evaluate('fbCollapse()');
  await sleep(600);
  await shot('2-pill');
  log.push('② 收起成小块  ' + await evaluate(R));

  await evaluate('S.focus.paused = true; renderFocus();');
  await sleep(450);
  await shot('3-pill-paused');
  log.push('③ 暂停的小块  class=' + await evaluate("document.getElementById('focusBar').className")
    + ' · pulse动画=' + await evaluate("getComputedStyle(document.querySelector('#focusBar .pulse')).animationName")
    + ' · pulse显示=' + await evaluate("getComputedStyle(document.querySelector('#focusBar .pulse')).display"));
  await evaluate('S.focus.paused = false; renderFocus();');

  /* 拖到左外侧再松手：应当被夹回视口并吸附到左边缘 */
  await evaluate(`(function(){
    var el = document.getElementById('focusBar'), r = el.getBoundingClientRect();
    var x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    function ev(t, x, y){ el.dispatchEvent(new PointerEvent(t, { pointerId: 55, clientX: x, clientY: y, bubbles: true })); }
    ev('pointerdown', x0, y0);
    for (var i = 1; i <= 6; i++) ev('pointermove', x0 - 620 * i / 6, y0 - 150);
    ev('pointerup', x0 - 620, y0 - 150);
    return 1;
  })()`);
  await sleep(700);
  await shot('4-pill-snapped-left');
  log.push('④ 拖到左缘    ' + await evaluate(R)
    + ' · 写入 left=' + await evaluate("document.getElementById('focusBar').style.left")
    + ' · S.fbPos=' + await evaluate("JSON.stringify(S.fbPos)"));

  await evaluate('fbExpand()');
  await sleep(600);
  await shot('5-bar-again');
  log.push('⑤ 点小块展回  ' + await evaluate(R)
    + ' · 内联定位=' + await evaluate("(function(){var e=document.getElementById('focusBar');return JSON.stringify({left:e.style.left||'-',top:e.style.top||'-'})})()"));

  await evaluate('openFocus()');
  await sleep(800);
  await shot('6-focus-view');
  log.push('⑥ 全屏专注页  层=' + await evaluate("JSON.stringify([].slice.call(document.querySelectorAll('.view.show')).map(function(e){return e.id}))")
    + ' · 专注条=' + await evaluate(R));

  console.log('\n=== 专注条样张 ===');
  console.log(log.join('\n'));
  console.log('\n=== 页面错误 ===');
  console.log(events.length ? events.slice(0, 10).join('\n') : 'none');
  cleanup();
  process.exit(0);
} catch (e) {
  console.log('HARNESS ERROR: ' + (e && e.stack || e));
  console.log(log.join('\n'));
  cleanup();
  process.exit(3);
}
