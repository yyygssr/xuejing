/* tools/bdroot_probe.mjs —— 「切页后模糊慢半拍」像素级取证
   假设：MOTION.enter 给 .page 打的是 transform（translate3d）动画。
        祖先带 transform 时 Chromium 会把它提升成独立 render surface，
        页内每个 backdrop-filter 的 backdrop root 随之变成 .page 自己 ——
        .page 背后没有内容（光晕画在 .phone 上），于是采到的是空底，
        卡片只剩自己那层半透明色 → 看着就是「透明」。动画结束 cancel() 后恢复。
   做法：不测 computed style（那永远是对的），测**真实像素**。
        把 .phone 的底换成 8px 周期的高频横条：糊了 → 条纹被抹平（对比度≈0）；
        没糊 → 条纹清晰（对比度很高）。然后逐档改变 .page 的状态截图对比。
   跑法：node tools/bdroot_probe.mjs [clear|frost] */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GLASS = process.argv[2] || 'clear';
const OUT = path.join(root, 'tools', '_bdroot');
fs.mkdirSync(OUT, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-bdroot-' + Date.now());
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
async function shot(name, rect) {
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
    fromSurface: true
  });
  const f = path.join(OUT, name + '.png');
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  return f;
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
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/index.html' });
  await waitFor(async () => (await evaluate('document.readyState')) === 'complete');
  await evaluate("S.onboarded = true; try{ save(); }catch(e){}; var _o=document.getElementById('onboard'); if(_o)_o.classList.remove('show');");
  await evaluate("try{ S.uiTheme='pro'; S.uiGlass='" + GLASS + "'; applyLook(); }catch(e){}");
  /* 高频横条底：8px 一个周期，蓝/橙强反差。糊掉之后应该几乎拉平。 */
  await evaluate(`(function(){
    var s=document.createElement('style'); s.id='__probe';
    s.textContent='html.ui-pro .phone,html.ui-pro.app-mode .phone{background:repeating-linear-gradient(0deg,#1e40af 0 4px,#f59e0b 4px 8px)!important}';
    document.head.appendChild(s);
  })()`);
  await sleep(500);

  await evaluate("go('me')");
  await sleep(900);   /* 等进场动画跑完并 cancel */

  const info = await evaluate(`(function(){
    var li=document.querySelector('#page-me .list');
    var r=li.getBoundingClientRect();
    var cs=getComputedStyle(li);
    return {x:Math.round(r.x+6),y:Math.round(r.y+6),width:Math.round(r.width-12),height:Math.round(r.height-12),
            blur:cs.backdropFilter||cs.webkitBackdropFilter, bg:cs.backgroundColor, glass:'${GLASS}'};
  })()`);
  console.log('玻璃档=' + info.glass + '  卡片 backdrop-filter=' + info.blur + '  bg=' + info.bg);
  console.log('采样区 ' + JSON.stringify({ x: info.x, y: info.y, w: info.width, h: info.height }) + '\n');

  const rect = { x: info.x, y: info.y, width: info.width, height: info.height };
  const rows = [];

  /* ── 1. 基线：动画已结束，.page 上没有任何 transform ── */
  await shot('1-base', rect);
  rows.push(['1 基线（无 transform）', '1-base']);

  /* ── 2. 静态 translate3d(0,0,0)：只为了触发提升，不改变位置 ── */
  await evaluate("document.getElementById('page-me').style.transform='translate3d(0,0,0)'");
  await sleep(400);
  await shot('2-t3d0', rect);
  rows.push(['2 .page transform:translate3d(0,0,0)', '2-t3d0']);

  /* ── 3. 进场动画中的真实取值（translate3d(14px,6px,0)），静态钉住 ── */
  await evaluate("document.getElementById('page-me').style.transform='translate3d(14px,6px,0)'");
  await sleep(400);
  await shot('3-t3d14', rect);
  rows.push(['3 .page transform:translate3d(14,6,0)', '3-t3d14']);

  /* ── 4. 动画真的在跑（WAAPI 暂停在第一帧之后 20ms 处）── */
  await evaluate(`(function(){
    var p=document.getElementById('page-me');
    p.style.transform='';
    var a=p.animate([{transform:'translate3d(14px,6px,0)'},{transform:'none'}],{duration:320,fill:'both'});
    a.pause(); a.currentTime=20; window.__pa=a;
  })()`);
  await sleep(400);
  await shot('4-anim', rect);
  rows.push(['4 WAAPI 动画进行中（20ms 处）', '4-anim']);

  /* ── 5. will-change:transform（合成层提升的另一个常见来源）── */
  await evaluate("try{window.__pa.cancel()}catch(e){}; var p=document.getElementById('page-me'); p.style.transform=''; p.style.willChange='transform'");
  await sleep(400);
  await shot('5-willchange', rect);
  rows.push(['5 .page will-change:transform', '5-willchange']);

  /* ── 6. opacity:.999（backdrop root 的另一个触发条件）── */
  await evaluate("var p=document.getElementById('page-me'); p.style.willChange=''; p.style.opacity='.999'");
  await sleep(400);
  await shot('6-opacity', rect);
  rows.push(['6 .page opacity:.999', '6-opacity']);

  /* ── 7. 关掉 backdrop-filter：对照组，用来标定「完全没糊」的对比度上限 ── */
  await evaluate(`(function(){
    var p=document.getElementById('page-me'); p.style.opacity='';
    var s=document.createElement('style'); s.id='__probe2';
    s.textContent='.page .list,.page .card,.page .g-tile{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}';
    document.head.appendChild(s);
  })()`);
  await sleep(500);
  await shot('7-noblur', rect);
  rows.push(['7 对照组：强制 backdrop-filter:none', '7-noblur']);

  fs.writeFileSync(path.join(OUT, 'rows.json'), JSON.stringify(rows, null, 2));
  console.log('截图已写入 ' + OUT);
  rows.forEach(r => console.log('  ' + r[1] + '.png  <-  ' + r[0]));
} catch (e) {
  console.error('失败：' + e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}
