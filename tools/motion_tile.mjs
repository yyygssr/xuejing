/* tools/motion_tile.mjs —— 四大卡片「一镜到底」进入 / 返回的逐帧采样
   目的：把「返回动画哪里不对」变成可读的数字 —— clip-path 的四个边、transform、
   圆角、透明度，各自随时间的序列。顺带截图关键帧。
   跑法：node tools/motion_tile.mjs [view]
     view: schedule | notes | todos | focus（默认 schedule） */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const VIEW = process.argv[2] || 'schedule';
const SHOT_DIR = path.join(root, 'tools', 'shots-tile');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-tile-' + Date.now());
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
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  }
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

/* 采样器：每帧记录 clip-path / transform / 圆角 / 透明度 / 是否有 ghost */
const SAMPLER = `
window.__inset = function(s){
  if(!s || s === 'none') return null;
  var m = String(s).match(/inset\\(([^)]+)\\)/);
  if(!m) return null;
  var parts = m[1].trim().split(/\\s+(?![^(]*\\))/);
  var nums = m[1].match(/-?[\\d.]+/g) || [];
  return { raw: String(s), nums: nums.map(function(x){ return +x; }) };
};
window.__sampleView = function(id, act, ms){
  var el = document.getElementById('view-' + id);
  var out = [];
  var t0 = performance.now();
  function tick(){
    var c = getComputedStyle(el);
    var tx = c.transform;
    var sc = 1, ttx = 0, tty = 0;
    var mm = tx && tx.match(/matrix\\(([^)]+)\\)/);
    if(mm){ var v = mm[1].split(',').map(parseFloat); sc = v[0]; ttx = v[4]; tty = v[5]; }
    var cp = c.clipPath;
    var nums = (String(cp).match(/-?[\\d.]+/g) || []).map(Number);
    out.push({
      t: Math.round(performance.now() - t0),
      cp: nums,                       // [top,right,bottom,left,radius]
      cps: cp === 'none' ? 'none' : 'inset',
      sc: +sc.toFixed(4), tx: +ttx.toFixed(1), ty: +tty.toFixed(1),
      op: +parseFloat(c.opacity).toFixed(3),
      rad: +parseFloat(c.borderTopLeftRadius || 0).toFixed(1),
      ghost: document.querySelectorAll('.g-tile[style*="z-index:61"],.g-tile[style*="z-index: 61"]').length
    });
    if(performance.now() - t0 < ms) requestAnimationFrame(tick);
    else window.__samples = out;
  }
  window.__samples = out;
  requestAnimationFrame(tick);
  act();
  return true;
};
`;

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, 'base64'));
}

const pct = (a, b) => b ? ((a / b) * 100).toFixed(0) + '%' : '-';
function line(label, s, key, fmt) {
  const pick = s.filter((_, i) => i % Math.max(1, Math.floor(s.length / 14)) === 0);
  console.log('  ' + label.padEnd(6) + '：' + pick.map(x => fmt ? fmt(x[key]) : x[key]).join(' → '));
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
  await evaluate("S.onboarded = true; try{ save(); }catch(e){}; var _ob = document.getElementById('onboard'); if(_ob) _ob.classList.remove('show');");
  await sleep(700);
  await evaluate(SAMPLER);
  console.log('视图：' + VIEW + ' · clip 支持：' + await evaluate('MOTION.clipOk'));

  /* 卡片位置 */
  const geo = await evaluate(`(function(){
    var t = document.querySelectorAll('.g-tile')[${['schedule', 'notes', 'todos', 'focus'].indexOf(VIEW)}];
    var r = t.getBoundingClientRect();
    return {l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};
  })()`);
  console.log('卡片矩形：' + JSON.stringify(geo) + ' · 视口 430×932');

  /* 进入 */
  await evaluate(`(function(){
    var t = document.querySelectorAll('.g-tile')[${['schedule', 'notes', 'todos', 'focus'].indexOf(VIEW)}];
    var r = t.getBoundingClientRect();
    t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+5,clientY:r.top+5,pointerType:'touch',pointerId:31}));
    t.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:r.left+5,clientY:r.top+5,pointerType:'touch',pointerId:31}));
    ${VIEW === 'focus' ? 'openFocus()' : (VIEW === 'notes' ? 'openNotes()' : VIEW === 'todos' ? 'openTodos()' : "openView('" + VIEW + "')")};
  })()`);
  await evaluate(`window.__sampleView('${VIEW}', function(){}, 640)`);
  await sleep(900);
  let s = await evaluate('window.__samples');
  console.log('\n── 进入 reveal');
  line('clip边', s, 'cp', v => v ? v[3] + '/' + v[0] : 'none');
  line('圆角', s, 'rad');
  line('缩放', s, 'sc');
  line('透明', s, 'op');
  line('残影', s, 'ghost');

  /* 返回 */
  await evaluate(`window.__sampleView('${VIEW}', function(){
    ${VIEW === 'focus' ? 'collapseFocusView()' : "closeView('" + VIEW + "')"};
  }, 640)`);
  await sleep(900);
  s = await evaluate('window.__samples');
  console.log('\n── 返回 conceal');
  line('clip边', s, 'cp', v => v ? v[3] + '/' + v[0] : 'none');
  line('clip圆角', s, 'cp', v => v && v[4] != null ? v[4].toFixed(1) : '-');
  line('圆角', s, 'rad');
  line('缩放', s, 'sc');
  line('位移', s, 'tx');
  line('透明', s, 'op');
  const first = s[0] || {};
  console.log('  首帧：clip=' + (first.cps === 'none' ? 'none' : JSON.stringify(first.cp))
    + ' rad=' + first.rad + ' sc=' + first.sc + ' op=' + first.op);
  console.log('  卡片目标：w=' + geo.w + ' h=' + geo.h + ' → 期望末帧 scale≈' + (geo.w / 430).toFixed(3) + '/' + (geo.h / 886).toFixed(3));

  /* 关键帧截图：必须重新派发 pointerdown 才有卡片来源（否则走侧出，抓的不是这条路径） */
  await evaluate(`(function(){
    var t = document.querySelectorAll('.g-tile')[${['schedule', 'notes', 'todos', 'focus'].indexOf(VIEW)}];
    var r = t.getBoundingClientRect();
    t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+5,clientY:r.top+5,pointerType:'touch',pointerId:41}));
    t.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:r.left+5,clientY:r.top+5,pointerType:'touch',pointerId:41}));
  })()`);
  await evaluate(VIEW === 'focus' ? 'openFocus()' : (VIEW === 'notes' ? 'openNotes()' : VIEW === 'todos' ? 'openTodos()' : "openView('" + VIEW + "')"));
  await sleep(900);
  const shots = [0, 120, 240, 360];
  const t0 = Date.now();
  await evaluate(VIEW === 'focus' ? 'collapseFocusView()' : "closeView('" + VIEW + "')");
  for (const ms of shots) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    await shot('back-' + String(ms).padStart(3, '0') + 'ms.png');
  }
  console.log('\n截图：tools/shots-tile/back-*.png');
} catch (e) {
  console.error('探测失败：' + e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}
