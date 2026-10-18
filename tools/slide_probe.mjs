/* tools/slide_probe.mjs —— 横滑方案的可行性体检（在动手改 index.html 之前跑）
   回答两个问题：
   ① 给 .page 加位移后，页内相对**外层**定位的 absolute/fixed 元素会不会「掉队」或错位；
   ② left 位移（不走合成层）在真实页面上的每帧成本有多高 —— 能不能撑住 60fps。
   跑法：node tools/slide_probe.mjs [me|home] */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TAB = process.argv[2] || 'me';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-slide-' + Date.now());
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
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/index.html' });
  await waitFor(async () => (await evaluate('document.readyState')) === 'complete');
  await evaluate("S.onboarded = true; try{ save(); }catch(e){}; var _o=document.getElementById('onboard'); if(_o)_o.classList.remove('show');");
  /* 横滑只在玻璃皮肤下走 left 通道，所以体检也在 Pro 下做 */
  await evaluate("try{ S.uiTheme='pro'; S.uiGlass='clear'; applyLook(); }catch(e){}");
  await sleep(500);
  await evaluate("go('" + TAB + "')");
  await sleep(900);

  console.log('html.className =', await evaluate('document.documentElement.className'));
  console.log('目标页 #page-' + TAB + '\n');

  /* ── ① 页内「定位基准在外层」的绝对定位元素 ───────────────────── */
  const risky = await evaluate(`(function(){
    var pg = document.getElementById('page-${TAB}');
    var out = [];
    var all = pg.querySelectorAll('*');
    for(var i=0;i<all.length;i++){
      var el = all[i];
      var pos = getComputedStyle(el).position;
      if(pos !== 'absolute' && pos !== 'fixed') continue;
      var op = el.offsetParent;
      var inside = op ? pg.contains(op) : null;
      if(inside === true) continue;
      out.push({
        sel: el.tagName.toLowerCase() + (el.id?'#'+el.id:'') +
             (el.className && typeof el.className==='string' && el.className.trim() ? '.'+el.className.trim().split(/\\s+/).slice(0,2).join('.') : ''),
        pos: pos,
        op: op ? (op.tagName.toLowerCase() + (op.id?'#'+op.id:'')) : 'null'
      });
    }
    return out;
  })()`);
  console.log('① 页内 absolute/fixed 且定位基准在 .page 之外的元素：', risky.length);
  risky.slice(0, 20).forEach(r => console.log('   ', r.pos, r.sel, '→ offsetParent =', r.op));
  if (!risky.length) console.log('    （无 —— 给 .page 加位移不会让任何元素掉队）');
  console.log();

  /* ── ② 每帧成本：left 位移 vs transform 位移 ──────────────────── */
  const cost = await evaluate(`(function(){
    function run(prop, done){
      var pg = document.getElementById('page-${TAB}');
      pg.getAnimations().forEach(function(a){ try{a.cancel();}catch(e){} });
      var kf = [], N = 24;
      for(var i=0;i<=N;i++){
        var p = i/N, v = (22*(1-p)).toFixed(2);
        kf.push(prop === 'left'
          ? { offset:p, left: v+'px' }
          : { offset:p, transform: 'translate3d('+v+'px,0,0)' });
      }
      if(prop === 'left') pg.style.position = 'relative';
      pg.style.willChange = 'auto';
      var ts = [], last = performance.now(), n = 0;
      var a = pg.animate(kf, { duration: 320, easing:'linear', fill:'both' });
      function tick(){
        var now = performance.now();
        ts.push(now - last); last = now; n++;
        if(n < 45) requestAnimationFrame(tick);
        else {
          try{ a.cancel(); }catch(e){}
          pg.style.position = '';
          var s = ts.slice(3).sort(function(x,y){return x-y;});
          done({ median: s[Math.floor(s.length/2)], p90: s[Math.floor(s.length*0.9)], max: s[s.length-1] });
        }
      }
      requestAnimationFrame(tick);
    }
    return new Promise(function(res){
      run('transform', function(r1){
        setTimeout(function(){
          run('left', function(r2){ res({ transform: r1, left: r2 }); });
        }, 500);
      });
    });
  })()`);
  console.log('② 每帧间隔（ms；60fps ≈ 16.7ms）');
  console.log('    transform 位移：中位数 ' + cost.transform.median.toFixed(1) +
              ' · p90 ' + cost.transform.p90.toFixed(1) + ' · 最大 ' + cost.transform.max.toFixed(1));
  console.log('    left     位移：中位数 ' + cost.left.median.toFixed(1) +
              ' · p90 ' + cost.left.p90.toFixed(1) + ' · 最大 ' + cost.left.max.toFixed(1));
  console.log('    注：桌面 headless --disable-gpu 的相对数据，不代表真机绝对值\n');

  /* ── ③ 全屏连拍：看横滑中途页面边缘有没有露出底色带 / 内容有没有错位 ── */
  const OUT = path.join(root, 'tools', '_bdroot');
  fs.mkdirSync(OUT, { recursive: true });
  async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  }
  await evaluate("go('" + (TAB === 'me' ? 'home' : 'me') + "')");
  await sleep(900);
  await shot('full-000-before');
  await evaluate("go('" + TAB + "')");
  await shot('full-010');
  await sleep(90); await shot('full-100');
  await sleep(120); await shot('full-220');
  await sleep(400); await shot('full-620-end');
  console.log('③ 全屏连拍已存到 tools/_bdroot/full-*.png（看边缘底色带与内容错位）');
} catch (e) {
  console.error('失败：', e.message);
} finally {
  cleanup();
  process.exit(0);
}
