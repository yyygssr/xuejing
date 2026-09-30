import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTDIR = path.join(root, 'tools', 'shots');
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

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-shot-' + Date.now());
const dbgPort = 9500 + Math.floor(Math.random() * 300);
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
const PROBE = `(function(){
  var out = [];
  [[215,140],[215,300],[215,520],[215,760],[215,900]].forEach(function(p){
    var e = document.elementFromPoint(p[0], p[1]);
    out.push(p.join(',') + ' -> ' + (e ? ('<' + e.tagName + ' class="' + (e.className||'') + '">') : 'null'));
  });
  return out.join('\\n');
})()`;

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
  await sleep(500);
  log.push('viewport=' + await evaluate('window.innerWidth + "x" + window.innerHeight') + ' dsf=' + await evaluate('window.devicePixelRatio'));

  // 1. AI 配置
  await evaluate("(function(){document.querySelectorAll('.view.show').forEach(function(e){e.classList.remove('show')});openAiConfig();return 1})()");
  await sleep(800); await shot('ai-config');

  // 2. 点进三级页
  await evaluate("(function(){var c=document.querySelector('#view-ai [onclick*=\"openAiHub\"]');if(c)c.click();return 1})()");
  await sleep(900); await shot('aihub');
  log.push('huB views=' + JSON.stringify(await evaluate("[].slice.call(document.querySelectorAll('.view.show')).map(function(e){return e.id})")));
  log.push('hub opacity=' + await evaluate("getComputedStyle(document.getElementById('view-aihub')).opacity"));
  log.push('--- hub probe ---\n' + await evaluate(PROBE));

  // 3. 三级页返回
  await evaluate("closeView('aihub')"); await sleep(900); await shot('back-to-ai');
  log.push('back views=' + JSON.stringify(await evaluate("[].slice.call(document.querySelectorAll('.view.show')).map(function(e){return e.id})")));

  // 4. 模型选择弹层（需求 4：双列）
  await evaluate("(function(){document.querySelectorAll('.view.show').forEach(function(e){e.classList.remove('show')});openAiConfig();pickModel('chat');return 1})()");
  await sleep(900); await shot('modelpick');
  const gtc = await evaluate("(function(){var s=document.getElementById('sheetBody');if(!s)return 'no sheetBody';var m=s.matchMedia&&0;var g=s.querySelector('div[style*=\"grid-template-columns\"]');return g?getComputedStyle(g).gridTemplateColumns:'no grid container'})()");
  log.push('modelpick grid-template-columns = ' + JSON.stringify(gtc));
  log.push('modelpick mpCustom present = ' + await evaluate("!!document.getElementById('mpCustom')"));
  log.push('--- modelpick probe ---\n' + await evaluate(PROBE));

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
