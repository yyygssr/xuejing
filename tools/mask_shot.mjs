/* tools/mask_shot.mjs —— 拍「弹层 / 历史侧栏」的遮罩边缘，用于逐像素看穿帮
   跑法：node tools/mask_shot.mjs drawer|sheet|pick [tag]
   输出：tools/shots-mask/<kind>-<tag>.png（DPR 2 → 860×1864） */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KIND = process.argv[2] || 'sheet';
const TAG = process.argv[3] || 'now';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const OUT = path.join(root, 'tools', 'shots-mask');
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-mask-' + Date.now());
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
  /* 用 Pro 皮肤（真实使用档位），浅色 */
  const DARK = process.argv[4] === 'dark';
  await evaluate("try{ S.uiTheme='pro'; S.uiGlass='frost'; " + (DARK ? "S.dark=true; applyLook(); bindTheme && 0;" : "") + "applyLook(); }catch(e){}");
  if (DARK) await evaluate("try{ document.documentElement.setAttribute('data-theme','dark'); document.documentElement.classList.toggle('dark', true); applyLook(); }catch(e){}");
  await sleep(700);

  if (KIND === 'drawer') {
    await evaluate("go('home'); try{ openHistDrawer(); }catch(e){ document.getElementById('histScrim').classList.add('show'); document.getElementById('histDrawer').classList.add('show'); }");
  } else if (KIND === 'pick') {
    await evaluate("try{ pickModel && 0; }catch(e){}; try{ openPick && openPick('测试'); }catch(e){}");
  } else {
    await evaluate("try{ pickPrefNum('workMin'); }catch(e){ openSheet('diag'); }");
  }
  await sleep(900);

  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, KIND + '-' + TAG + '.png');
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('截图：' + path.relative(root, file));
  const st = await evaluate(`(function(){
    var m = document.getElementById('mask'), s = document.getElementById('histScrim');
    var c = m && getComputedStyle(m);
    return { maskBg: c ? c.backgroundColor : '-', maskBlur: c ? (c.backdropFilter || c.webkitBackdropFilter) : '-',
      scrimBg: s ? getComputedStyle(s).backgroundColor : '-',
      scrimBlur: s ? (getComputedStyle(s).backdropFilter || '-') : '-' };
  })()`);
  console.log(JSON.stringify(st));
} catch (e) {
  console.error('失败：' + e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}
