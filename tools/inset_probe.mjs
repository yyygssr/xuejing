/* tools/inset_probe.mjs —— 二级页顶部状态栏适配体检
   模拟真机：html.app-mode + --sb-inset=32px（典型 Android 状态栏 dp），
   逐个打开二级页，量顶部到底让位了没有、以及有没有多出来的空档。
   跑法：node tools/inset_probe.mjs [sb=32] */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SB = Number((process.argv[2] || 'sb=32').split('=')[1]) || 32;
const OUT = path.join(root, 'tools', '_inset');
fs.mkdirSync(OUT, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-inset-' + Date.now());
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
  /* 模拟真机：app-mode + 原生报来的状态栏高度 */
  await evaluate("document.documentElement.classList.add('app-mode');");
  await evaluate("try{ S.uiTheme='pro'; applyLook(); }catch(e){}");
  await evaluate("window.__setInsets(" + SB + ", 16);");
  await sleep(500);

  const MEASURE = `(function(id){
    var v = document.getElementById(id);
    var head = v.querySelector('.viewhead');
    var body = v.querySelector('.viewbody');
    var sb = document.querySelector('.statusbar');
    var vr = v.getBoundingClientRect();
    var hr = head ? head.getBoundingClientRect() : null;
    var sbr = sb.getBoundingClientRect();
    var cs = getComputedStyle(v);
    /* 顶栏里第一个可见子元素（返回按钮 / 标题）的实际内容盒 */
    var first = null;
    if(head){
      var kids = head.querySelectorAll('*');
      for(var i=0;i<kids.length;i++){
        var r = kids[i].getBoundingClientRect();
        if(r.width > 0 && r.height > 0){ first = {tag:kids[i].className || kids[i].tagName, top:r.top, bottom:r.bottom}; break; }
      }
    }
    return {
      id: id,
      viewTop: Math.round(vr.top * 10) / 10,
      viewH: Math.round(vr.height),
      cssTop: cs.top,
      headTop: hr ? Math.round(hr.top * 10) / 10 : null,
      headH: hr ? Math.round(hr.height) : null,
      bodyTop: body ? Math.round(body.getBoundingClientRect().top * 10) / 10 : null,
      sbH: Math.round(sbr.height * 10) / 10,
      sbTop: Math.round(sbr.top * 10) / 10,
      firstChild: first
    };
  })`;

  const rows = [];

  /* 三个有代表性、且在 subview 清单里的页 */
  for (const id of ['schedule', 'notes', 'memory']) {
    await evaluate("try{ openView('" + id + "'); }catch(e){ window.__e=String(e); }");
    await sleep(900);
    const m = await evaluate(MEASURE + "('view-" + id + "')");
    rows.push(m);
    await shot('v-' + id);
    await evaluate("try{ closeView('" + id + "'); }catch(e){}");
    await sleep(700);
  }

  /* 专注页（走专用分支） */
  await evaluate("try{ openFocus(); }catch(e){ window.__e=String(e); }");
  await sleep(1000);
  rows.push(await evaluate(MEASURE + "('view-focus')"));
  await shot('v-focus');
  await evaluate("try{ closeView('focus'); }catch(e){}");
  await sleep(800);

  console.log('app-mode · --sb-inset = ' + SB + 'px\n');
  console.log('页            view.top  view.h  head.top  head.h  body.top  状态栏h  第一个子元素');
  for (const r of rows) {
    console.log(
      (r.id + '                ').slice(0, 14)
      + String(r.viewTop).padStart(6)
      + String(r.viewH).padStart(8)
      + String(r.headTop).padStart(10)
      + String(r.headH).padStart(8)
      + String(r.bodyTop).padStart(10)
      + String(r.sbH).padStart(9)
      + '  ' + (r.firstChild ? (r.firstChild.tag + '@' + r.firstChild.top) : '(无)')
    );
  }

  console.log('\n判定（顶部内容必须 >= 状态栏高度 ' + SB + 'px）：');
  let bad = 0;
  for (const r of rows) {
    const okTop = r.headTop !== null && r.headTop >= SB - 0.6;
    const overlap = r.firstChild && r.firstChild.top < SB - 0.6;
    /* 留空：顶栏顶部离状态栏底部超过 4px */
    const gap = r.headTop !== null ? r.headTop - SB : null;
    const okGap = gap !== null && Math.abs(gap) <= 4;
    if (!okTop || overlap || !okGap) bad++;
    console.log('  ' + (r.id + '          ').slice(0, 11)
      + (okTop && !overlap && okGap ? 'PASS' : 'FAIL')
      + ' · head.top=' + r.headTop + ' (状态栏底=' + SB + ')'
      + ' · 与状态栏间隙=' + gap + (okGap ? '' : ' ← 不该这么多'))
  }
  console.log('\n结论：' + (bad === 0 ? 'PASS' : 'FAIL（' + bad + ' 页有问题）'));
} catch (e) {
  console.log('失败：', e && e.message);
} finally {
  cleanup();
}
