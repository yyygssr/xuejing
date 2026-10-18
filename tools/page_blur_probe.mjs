/* tools/page_blur_probe.mjs —— 切页后头几帧，玻璃层的 backdrop-filter 在不在
   要回答：第一帧是「半透明白 + 背景清晰」（看着像透明）还是「已经糊了」。
   跑法：node tools/page_blur_probe.mjs [pro|classic] */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const THEME = process.argv[2] || 'pro';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-pblur-' + Date.now());
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

const SAMPLER = `
window.__blurSample = function(pageSel, tileSel, act, ms){
  var page = document.querySelector(pageSel), tile = document.querySelector(tileSel);
  var out = [], t0 = performance.now();
  function tick(){
    var pc = getComputedStyle(page), tc = tile ? getComputedStyle(tile) : null;
    out.push({
      t: Math.round(performance.now() - t0),
      pd: pc.display, po: +parseFloat(pc.opacity).toFixed(2), pv: pc.visibility,
      lw: page.offsetWidth,
      tf: tc ? (tc.transform === 'none' ? 'none' : 'matrix') : '-',
      bf: tc ? ((tc.backdropFilter || tc.webkitBackdropFilter || 'none').slice(0, 22)) : '-',
      bg: tc ? tc.backgroundColor : '-',
      anim: tile ? tile.getAnimations().length : -1
    });
    if(performance.now() - t0 < ms) requestAnimationFrame(tick);
    else window.__blurOut = out;
  }
  window.__blurOut = out;
  requestAnimationFrame(tick);
  act();
  return true;
};
`;

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
  await sleep(600);
  await evaluate(SAMPLER);

  /* 预热类是否按预期加/摘，且卡片底色真的变了 */
  await evaluate("go('home')");
  await sleep(500);
  const warm = await evaluate(`(function(){
    go('me');
    var pg = document.getElementById('page-me');
    var li = pg.querySelector('.list');
    var t0 = { cls: pg.className, bg: getComputedStyle(li).backgroundColor };
    return new Promise(function(res){
      setTimeout(function(){
        res({ cls0: t0.cls, bg0: t0.bg, cls1: pg.className, bg1: getComputedStyle(li).backgroundColor });
      }, 420);
    });
  })()`);
  console.log('预热：切页瞬间 cls=' + warm.cls0 + ' bg=' + warm.bg0);
  console.log('      420ms 后 cls=' + warm.cls1 + ' bg=' + warm.bg1);

  for (const [from, to, pageSel, tileSel] of [
    ['home', 'me', '#page-me', '#page-me .list'],
    ['me', 'home', '#page-home', '#page-home .g-tile'],
    ['home', 'chat', '#page-chat', '#page-chat .card']
  ]) {
    await evaluate("go('" + from + "')");
    await sleep(450);
    await evaluate("window.__blurSample('" + pageSel + "','" + tileSel + "', function(){ go('" + to + "'); }, 420)");
    await sleep(700);
    const s = await evaluate('window.__blurOut') || [];
    console.log('\n── ' + from + ' → ' + to + '（' + tileSel + '）');
    s.slice(0, 10).forEach(x => console.log('  ' + String(x.t).padStart(3) + 'ms  display=' + x.pd
      + ' op=' + x.po + ' vis=' + x.pv + ' w=' + x.lw + ' anims=' + x.anim
      + ' | blur=' + x.bf + ' bg=' + x.bg));
    const noBlur = s.slice(0, 6).filter(x => x.bf === 'none').length;
    console.log('  前 6 帧里 backdrop-filter 缺失：' + noBlur + ' 帧');
  }
} catch (e) {
  console.error('失败：' + e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}
