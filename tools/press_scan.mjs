/* tools/press_scan.mjs —— 扫描「按压反馈会不会落到大容器上」
   判据：元素带 onclick（pressBind 的命中条件之一）且面积 ≥ 视口 25%，
   按下时 .press-on 会给它加 scale .972 + brightness —— 整块缩、整块变暗，
   四周露底 → 用户说的「穿帮」。
   跑法：node tools/press_scan.mjs */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-scan-' + Date.now());
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
  await sleep(500);

  /* 只扫「能显示出来」的容器：把各层都打开一遍，再统一量 */
  await evaluate(`(function(){
    try{ openHistDrawer && openHistDrawer(); }catch(e){}
    try{ pickPrefNum('workMin'); }catch(e){}
    return true;
  })()`);
  await sleep(600);

  const rows = await evaluate(`(function(){
    var VW = innerWidth, VH = innerHeight, area0 = VW * VH;
    var out = [];
    var all = document.querySelectorAll('[onclick]');
    for (var i = 0; i < all.length; i++){
      var el = all[i];
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      var ratio = (r.width * r.height) / area0;
      if (ratio < 0.20) continue;
      var sel = el.tagName.toLowerCase()
        + (el.id ? '#' + el.id : '')
        + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
      out.push({
        sel: sel.slice(0, 70),
        w: Math.round(r.width), h: Math.round(r.height),
        ratio: +(ratio * 100).toFixed(0),
        visible: !!(el.offsetWidth && getComputedStyle(el).visibility !== 'hidden')
      });
    }
    out.sort(function(a, b){ return b.ratio - a.ratio; });
    return out;
  })()`);

  console.log('视口 430×932 · 带 onclick 且面积 ≥20% 的元素：\n');
  rows.forEach(r => console.log('  ' + String(r.ratio).padStart(3) + '%  ' + r.w + '×' + r.h
    + '  ' + r.sel + (r.visible ? '' : '  (当前不可见)')));
  if (!rows.length) console.log('  （无）');
  console.log('\n共 ' + rows.length + ' 个。这些就是按下空白处会整块缩/变暗的嫌疑对象。');

  /* 行为验证：按下时到底有没有被挂上 press-on */
  const probes = await evaluate(`(function(){
    function down(el){
      if(!el) return { err: 'element null' };
      var r = el.getBoundingClientRect();
      var ev = { bubbles:true, cancelable:true, pointerId:91, pointerType:'touch', isPrimary:true,
                 clientX: Math.max(1, r.left + 12), clientY: Math.max(1, r.top + 12) };
      el.dispatchEvent(new PointerEvent('pointerdown', ev));
      var host = el.closest('.mask,.drawer-scrim,.pickmask') || el;
      var c = getComputedStyle(host);
      var out = { cls: host.className, scale: c.scale, filter: c.filter };
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, pointerId:91, pointerType:'touch' }));
      return out;
    }
    var out = {};
    /* ① 直接按遮罩本身 */
    out.mask = down(document.getElementById('mask'));
    /* ② 按弹层里的空白（sheet 的标题区，没有 onclick） */
    var h3 = document.querySelector('#sheet h3') || document.getElementById('sheet');
    out.sheetBlank = down(h3);
    /* ③ 按抽屉里的空白（列表容器底部） */
    out.drawerBlank = down(document.getElementById('histList'));
    /* ④ 按抽屉右侧的遮幕 */
    out.scrim = down(document.getElementById('histScrim'));
    return out;
  })()`);
  console.log('\n按下验证（看 cls 里有没有 press-on，scale 是不是 1）：');
  for (const k of Object.keys(probes)) {
    const p = probes[k];
    if (p.err) { console.log('  ' + k + '：' + p.err); continue; }
    const bad = /press-on/.test(p.cls) || parseFloat(p.scale) < 0.999 || p.filter !== 'none';
    console.log('  ' + k.padEnd(12) + (bad ? '✗ ' : '✓ ') + 'cls=[' + p.cls + '] scale=' + p.scale + ' filter=' + p.filter);
  }
} catch (e) {
  console.error('扫描失败：' + e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}
