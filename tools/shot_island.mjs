/* 灵动岛设置页的可视化验证：两列排版预览（课前/上课中）、元素自定义、
   深浅色、以及关掉倒计时后右列消失。产出 tools/shots_island/*.png */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTDIR = path.join(root, 'tools', 'shots_island');
fs.rmSync(SHOTDIR, { recursive: true, force: true });
fs.mkdirSync(SHOTDIR, { recursive: true });

const WIDTH = Number(process.env.VIEWPORT_W || 412);
const HEIGHT = Number(process.env.VIEWPORT_H || 915);

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(root, 'index.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const URL_ = 'http://127.0.0.1:' + port + '/index.html';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-app-' + Date.now());
const dbgPort = 9900 + Math.floor(Math.random() * 200);
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
try {
  const ver = await waitFor(async () => { try { const r = await fetch('http://127.0.0.1:' + dbgPort + '/json/version'); return await r.json(); } catch (e) { return null; } });
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')) });
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
  await sleep(400);

  // ① 灵动岛设置页（浅色，默认全开、元素面板收起）
  await evaluate(`(function(){
    S.prefs.islandOn = true; S.prefs.islandStart = true; S.prefs.islandEnd = true;
    S.prefs.islandStay = true; S.prefs.islandFocus = true; S.prefs.islandLen = 'normal';
    S.prefs.islandElems = ['course','place','countdown'];
    S.prefs.islandFoldOpen = false;
    save(); applyIslandPref(); islandBadgeSync();
    openView('island');
    return 1;
  })()`);
  await sleep(500);
  /* 分段控件几何诊断：宽度之外还要量高度 ——
     .seg 默认 height:38 而 .segThumb 是 32（= 38 - 2×3 padding）。
     我为这行单独把 .seg 压到 34，thumb 仍是 32，于是 top:3 + 32 = 35 > 34，
     滑块就顶出边框了。宽度对了不代表高度也对，两个方向都得量。 */
  log.push('seg 几何：' + await evaluate(`(function(){
    function m(sel){
      var seg = document.querySelector(sel);
      var th = seg && seg.querySelector('.segThumb');
      if(!seg || !th) return sel + '=缺失';
      var s = seg.getBoundingClientRect(), t = th.getBoundingClientRect();
      return sel + ' 轨道=' + Math.round(s.width) + '×' + Math.round(s.height)
        + ' 滑块=' + Math.round(t.width) + '×' + Math.round(t.height)
        + ' 顶部溢出=' + Math.round(s.top - t.top)
        + ' 底部溢出=' + Math.round((t.bottom - s.bottom))
        + ' 左右溢出=' + Math.round((s.left - t.left) + (t.right - s.right));
    }
    return [m('#islandLenSeg')].join(' ｜ ');
  })()`));
  await evaluate("closeView('island'); go('me')");
  await sleep(350);
  log.push('既有 seg 几何：' + await evaluate(`(function(){
    function m(sel){
      var seg = document.querySelector(sel);
      var th = seg && seg.querySelector('.segThumb');
      if(!seg || !th) return sel + '=缺失';
      var s = seg.getBoundingClientRect(), t = th.getBoundingClientRect();
      return sel + ' 轨道=' + Math.round(s.width) + '×' + Math.round(s.height)
        + ' 滑块=' + Math.round(t.width) + '×' + Math.round(t.height)
        + ' 溢出(上下/左右)=' + Math.round(s.top - t.top + t.bottom - s.bottom) + '/'
        + Math.round((s.left - t.left) + (t.right - s.right));
    }
    return [m('#fsSeg'), m('#themeSeg')].join(' ｜ ');
  })()`));
  await evaluate("go('me'); openView('island')");
  await sleep(400);
  await shot('island-light');

  // ② 元素面板展开（点标题行）。**必须先滚到那一段** ——
  //    折叠内容在长页面的下方，不滚的话截图和收起时长一样（第一版就白拍了）。
  await evaluate("islandToggleFold(true); renderIsland(); islandToggleFold(true); document.getElementById('islFoldRow').scrollIntoView({block:'center'})");
  await sleep(450);
  log.push('折叠状态：' + await evaluate(`(function(){
    var f = document.getElementById('islFold');
    if(!f) return '找不到 #islFold';
    var cs = getComputedStyle(f);
    return 'open类=' + f.classList.contains('open') + ' · max-height=' + cs.maxHeight
      + ' · opacity=' + cs.opacity + ' · 高度=' + Math.round(f.getBoundingClientRect().height)
      + ' · 元素数=' + document.querySelectorAll('.isl-el .el').length;
  })()`));
  await shot('island-fold-open');

  // ③ 只留课程名 + 倒计时
  await evaluate(`(function(){
    S.prefs.islandElems = ['course','countdown'];
    save(); applyIslandPref(); renderIsland(); islandToggleFold(true);
    return 1;
  })()`);
  await sleep(400);
  await shot('island-elems-min');

  // ④ 加上「上下课时间」
  await evaluate(`(function(){
    S.prefs.islandElems = ['course','place','time','countdown'];
    save(); applyIslandPref(); renderIsland(); islandToggleFold(true);
    return 1;
  })()`);
  await sleep(400);
  await shot('island-elems-all');
  log.push('四元素全开：' + await evaluate(`(function(){
    var p = document.querySelectorAll('.isl-pill');
    return '上课「' + p[0].querySelector('.ip-l b').textContent + ' / '
      + p[0].querySelector('.ip-r').textContent + '」 专注「'
      + p[1].querySelector('.ip-l b').textContent + ' / '
      + p[1].querySelector('.ip-r').textContent + '」';
  })()`));

  // ⑤ 深色 + 长停留
  await evaluate("setTheme('dark'); applyLook(); islandSetLen('long'); renderIsland(); islandToggleFold(true)");
  await sleep(450);
  await shot('island-dark-long');

  // ⑥ 「我的」页那行的角标 + 量一下既有的 seg（正文大小/主题色）有没有同样的病
  await evaluate("closeView('island'); go('me')");
  await sleep(400);
  log.push('既有 seg：' + await evaluate(`(function(){
    function m(sel){
      var seg = document.querySelector(sel);
      if(!seg) return sel + '=缺失';
      var r = seg.getBoundingClientRect();
      var items = [].map.call(seg.querySelectorAll('.segI'), function(x){
        var q = x.getBoundingClientRect();
        return Math.round(q.width);
      });
      return sel + ' 宽=' + Math.round(r.width) + ' 各档宽=' + items.join('/');
    }
    return [m('#fsSeg'), m('#themeSeg')].join(' ｜ ');
  })()`));
  await shot('me-row-dark');
  log.push('角标=' + await evaluate("(document.getElementById('islandBadge')||{}).textContent"));

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
