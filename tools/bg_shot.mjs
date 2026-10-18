/* tools/bg_shot.mjs —— 拍默认背景（无自定义图），给逐列亮度分析用
   跑法：node tools/bg_shot.mjs [pro|classic] [light|dark] [tag] */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const THEME = process.argv[2] || 'pro';
const MODE = process.argv[3] || 'light';
const TAG = process.argv[4] || (THEME + '-' + MODE);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const OUT = path.join(root, 'tools', 'shots-bg');
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-bg-' + Date.now());
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
  await evaluate("try{ S.uiTheme='" + THEME + "'; S.uiGlass='clear'; S.dark=" + (MODE === 'dark') + "; applyLook(); }catch(e){}");
  await sleep(600);
  await evaluate("go('home')");
  await sleep(500);

  /* 把首页内容清空，只看背景（这样亮度分析不被卡片干扰） */
  await evaluate(`(function(){
    var st = document.createElement('style'); st.id = '_bgonly';
    st.textContent = '#page-home .week,#page-home .home-grid,#page-home .home-cols,#page-home .h1,#page-home .sec-title{visibility:hidden!important}';
    document.head.appendChild(st);
    return true;
  })()`);
  await sleep(300);

  if(process.env.MEASURE){
    const m = await evaluate(`(function(){
      function probe(tag){
        var t = document.querySelector('.g-tile');
        var c = getComputedStyle(t);
        var hs = getComputedStyle(document.documentElement);
        return tag + ' edge=' + document.documentElement.dataset.edge
          + ' var(--glass-line)=' + hs.getPropertyValue('--glass-line').trim()
          + ' var(--hair)=' + hs.getPropertyValue('--hair').trim()
          + ' border=' + c.borderTopColor
          + ' shadow=' + c.boxShadow.slice(0, 90);
      }
      var out = [probe('初始')];
      setUiEdge(false); out.push(probe('关描边'));
      setUiEdge(true);  out.push(probe('开描边'));
      return out;
    })()`);
    console.log(m.join(' | '));
  }
  if(process.env.BG_CSS){
    await evaluate("(function(){var s=document.createElement('style');s.textContent=" + JSON.stringify(process.env.BG_CSS) + ";document.head.appendChild(s);return 1})()");
    await sleep(350);
  }
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, TAG + '.png');
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  const chain = await evaluate(`(function(){
    var out = [];
    var el = document.elementFromPoint(5, 200);
    while(el){
      var c = getComputedStyle(el);
      out.push({
        tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
        bg: c.backgroundImage === 'none' ? c.backgroundColor : ('img ' + c.backgroundImage.slice(0, 60)),
        sh: c.boxShadow === 'none' ? '-' : c.boxShadow.slice(0, 60),
        op: c.opacity
      });
      el = el.parentElement;
    }
    return out;
  })()`);
  const kids = await evaluate(`(function(){
    return [].map.call(document.querySelectorAll('#screen > *'), function(el){
      var c = getComputedStyle(el);
      return { tag: (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\s+/).slice(0,3).join('.')),
        d: c.display, v: c.visibility, o: c.opacity, pos: c.position, z: c.zIndex,
        bg: (c.backgroundImage === 'none' ? '' : 'img ') + c.backgroundColor };
    }).filter(function(x){ return x.d !== 'none' && x.v !== 'hidden' && x.o !== '0'; });
  })()`);
  console.log('#screen 里仍在渲染的子元素：');
  kids.forEach(x => console.log('  ' + x.tag.slice(0, 40).padEnd(40) + ' pos=' + x.pos.padEnd(8) + ' z=' + String(x.z).padEnd(4) + ' op=' + x.o + ' ' + x.bg));
  console.log('(5,200) 向上的元素链：');
  chain.forEach(x => console.log('  ' + x.tag.slice(0, 46).padEnd(46) + ' bg=' + x.bg + ' sh=' + x.sh + ' op=' + x.op));
  const bg = await evaluate("getComputedStyle(document.querySelector('.phone')).backgroundImage.slice(0,200)");
  console.log('截图：' + path.relative(root, file));
  console.log('.phone 背景：' + bg);
} catch (e) {
  console.error('失败：' + e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}
