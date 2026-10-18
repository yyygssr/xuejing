/* tools/kb_probe.mjs —— 「键盘收起后底部抬高」体检
   真机症状：打开一次待办输入框、键盘收起来之后，弹层整体上浮，底部空出一条。
   判据：键盘收起后，弹层底边必须贴着 .phone 底边，且 .phone 高度 == 视口高度。

   桌面无法真的弹键盘，所以这里用「人为缩小视口再恢复」模拟 adjustResize 的
   窗口 resize 过程 —— 这正好是 dvh 出问题的那个场景。
   跑法：node tools/kb_probe.mjs */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'tools', '_kb');
fs.mkdirSync(OUT, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-kb-' + Date.now());
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

const STATE = `(function(){
  var phone = document.getElementById('phone');
  var sheet = document.getElementById('sheet');
  var mask = document.getElementById('mask');
  var pr = phone.getBoundingClientRect();
  var sr = sheet ? sheet.getBoundingClientRect() : null;
  var mr = mask ? mask.getBoundingClientRect() : null;
  return {
    innerH: window.innerHeight,
    vvH: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    docH: document.documentElement.clientHeight,
    phoneTop: Math.round(pr.top), phoneH: Math.round(pr.height),
    phoneBottom: Math.round(pr.bottom),
    maskTop: mr ? Math.round(mr.top) : null,
    maskH: mr ? Math.round(mr.height) : null,
    sheetTop: sr ? Math.round(sr.top) : null,
    sheetBottom: sr ? Math.round(sr.bottom) : null,
    gapToPhoneBottom: sr ? Math.round(pr.bottom - sr.bottom) : null,
    transform: sheet ? getComputedStyle(sheet).transform : null
  };
})()`;

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
  const H = 932;
  const setVp = async (h) => send('Emulation.setDeviceMetricsOverride',
    { width: 430, height: h, deviceScaleFactor: 1, mobile: true });
  await setVp(H);
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/index.html' });
  await waitFor(async () => (await evaluate('document.readyState')) === 'complete');
  await evaluate("S.onboarded = true; try{ save(); }catch(e){}; var _o=document.getElementById('onboard'); if(_o)_o.classList.remove('show');");
  await evaluate("document.documentElement.classList.add('app-mode');");
  await evaluate("try{ S.uiTheme='pro'; applyLook(); }catch(e){}");
  await evaluate("window.__setInsets(34, 16);");
  await sleep(500);

  console.log('① 初始（无键盘）');
  console.log('   ', JSON.stringify(await evaluate(STATE)));

  /* 打开待办输入弹层 */
  await evaluate("openView('todos');");
  await sleep(600);
  await evaluate("try{ openSheet('todo'); }catch(e){ window.__e=String(e); }");
  await sleep(600);
  console.log('② 打开弹层');
  const s2 = await evaluate(STATE);
  console.log('   ', JSON.stringify(s2));
  await shot('s2-open');

  /* 模拟键盘：视口缩到 932-360，并通知页面 kb-open（原生就是这么做的） */
  await setVp(H - 360);
  await evaluate("window.onKb(1);");
  await sleep(700);
  const s3 = await evaluate(STATE);
  console.log('③ 键盘弹起（视口 572）');
  console.log('   ', JSON.stringify(s3));
  await shot('s3-kb');

  /* 键盘收起：视口恢复 + kb-open 摘掉 */
  await setVp(H);
  await evaluate("window.onKb(0);");
  await sleep(900);
  const s4 = await evaluate(STATE);
  console.log('④ 键盘收起后（视口恢复 932）');
  console.log('   ', JSON.stringify(s4));
  await shot('s4-after');

  console.log('\n判定：');
  const ok4 = s4.gapToPhoneBottom !== null && Math.abs(s4.gapToPhoneBottom) <= 2;
  console.log('  弹层底边与 .phone 底边的间隙 = ' + s4.gapToPhoneBottom + 'px（应 == 0）'
    + ' → ' + (ok4 ? 'PASS' : 'FAIL（底部抬高）'));
  const sameAsInit = Math.abs(s4.phoneH - s2.phoneH) <= 1;
  console.log('  .phone 高度 打开前=' + s2.phoneH + ' / 键盘收起后=' + s4.phoneH
    + ' → ' + (sameAsInit ? 'PASS' : 'FAIL（视口高度没恢复）'));
  /* --vh 是否写成整屏（真机 dvh 不重算的根因验证点） */
  const vh = await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--vh').trim()");
  console.log('  --vh = ' + vh + '（应等于视口高度 ' + H + 'px）');
  const vhOk = parseInt(vh, 10) === H;
  console.log('  innerHeight=' + s4.innerH + ' vvH=' + s4.vvH + ' docH=' + s4.docH);
  console.log('  sheet.transform=' + s4.transform);
  console.log('\n结论：' + (ok4 && sameAsInit && vhOk ? 'PASS' : 'FAIL'));
} catch (e) {
  console.log('失败：', e && e.message);
} finally {
  cleanup();
}
