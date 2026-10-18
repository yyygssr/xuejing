/* tools/focus_bg_probe.mjs —— 专注页（#view-focus）的底色体检
   判据很简单：专注页是「和三个主页面同一块底」的全屏页，底必须**不透明**
   且和 .phone 一致；普通二级页（.view）才铺半透明纱 --view-veil。
   跑法：node tools/focus_bg_probe.mjs [clear|frost] */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GLASS = process.argv[2] || 'clear';
const OUT = path.join(root, 'tools', '_focusbg');
fs.mkdirSync(OUT, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-fbg-' + Date.now());
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
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
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
  await sleep(400);

  const BG = `(function(sel){
    var e = document.querySelector(sel); if(!e) return {err:'no '+sel};
    var c = getComputedStyle(e);
    return {color:c.backgroundColor, image:(c.backgroundImage||'').slice(0,60)};
  })`;

  const phone = await evaluate(BG + "('.phone')");
  console.log('主页面 .phone      底：', JSON.stringify(phone));

  /* ① 专注页 */
  await evaluate("try{ openFocus(); }catch(e){ window.__fbgErr = String(e); }");
  await sleep(900);
  const focus = await evaluate(BG + "('#view-focus')");
  const focusShown = await evaluate("document.getElementById('view-focus').classList.contains('show')");
  console.log('专注页 #view-focus 底：', JSON.stringify(focus), ' · show=' + focusShown);
  /* scrim 是真凶：它是唯一挂 backdrop-filter 的那层，显隐只认 body.view-open。
     v0.3.28/29 两次没找对它，所以这里必须把它单列出来测。 */
  const scrimOn = await evaluate(`(function(){
    var s = document.getElementById('scrim');
    var c = getComputedStyle(s);
    return {
      viewOpen: document.body.classList.contains('view-open'),
      opacity: c.opacity,
      blur: (c.backdropFilter || c.webkitBackdropFilter || 'none')
    };
  })()`);
  console.log('scrim（模糊层）  ：', JSON.stringify(scrimOn));
  await shot('focus');
  await evaluate("try{ closeView('focus'); }catch(e){}");
  await sleep(700);

  /* ② 普通二级页（课表） */
  await evaluate("try{ openView('schedule'); }catch(e){ window.__fbgErr = String(e); }");
  await sleep(900);
  const view = await evaluate(BG + "('.view.show')");
  console.log('二级页 .view       底：', JSON.stringify(view));
  await shot('view');

  /* ③ 判定 */
  function alpha(c) {
    const m = /^rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return p.length >= 4 ? p[3] : 1;
  }
  const aF = alpha(focus.color), aV = alpha(view.color);
  const scrimOk = scrimOn.viewOpen === true && parseFloat(scrimOn.opacity) > 0.9
    && scrimOn.blur !== 'none' && /blur\(/.test(scrimOn.blur);
  console.log('');
  console.log('专注页底色 alpha =', aF, '（应 <1，半透明纱 —— 要透出模糊的背景）');
  console.log('二级页底色 alpha =', aV, '（应 <1，半透明纱）');
  console.log('专注页 scrim 打开 =', scrimOn.viewOpen, '· opacity=' + scrimOn.opacity, '· blur=' + scrimOn.blur);
  console.log('结论：', scrimOk && aF !== null && aF < 1 && aV !== null && aV < 1 ? 'PASS' : 'FAIL');
} catch (e) {
  console.log('失败：', e && e.message);
} finally {
  cleanup();
}
