/* tools/view_blur_probe.mjs —— 「打开二级页时玻璃模糊什么时候到位」的时间序列
   和 blur_time_probe 同一套判据：把底换成 8px 高频横条，糊了 → 行均值 std 小；
   没糊 → std 大。区别在于这里开的是**二级页**（四大卡片走 MOTION.reveal 的
   clip-path 窗口展开），而且要给 .view 自己也铺条纹 ——
   二级页的底本来是不透明的 --base-bg，会把 .phone 的条纹挡掉，
   玻璃糊的是 .view 自己的底，所以条纹必须铺在 .view 上才测得到。
   跑法：node tools/view_blur_probe.mjs [clear|frost] [schedule|todos|notes] [asis|noreveal|...] */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GLASS = process.argv[2] || 'clear';
const VIEW = process.argv[3] || 'schedule';
const MODE = process.argv[4] || 'asis';
const OUT = path.join(root, 'tools', '_viewblur');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^t-/.test(f)) fs.unlinkSync(path.join(OUT, f));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-vblur-' + Date.now());
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
  /* 条纹铺两处：.phone（主页的底）和 .view（二级页自己的底）。
     二级页的玻璃糊的是 .view 的底，所以 .view 不铺条纹就测不出失明。 */
  /* translucent 模式：**只**给 .phone 铺条纹，并把 .view 改成半透明 ——
     模拟需求 2 的改法。这时页内玻璃的 backdrop root 虽然是 .view 自己，
     但它背后（主页面 + 条纹）是透得过来的，理论上不该再失明。 */
  const TRANS = MODE === 'translucent';
  await evaluate(`(function(){
    var s=document.createElement('style'); s.id='__probe';
    s.textContent=${MODE === 'shot'} ? '' : (${TRANS}
      /* 机制级干净实验：主页藏起来（免得挡住条纹）、scrim 不糊（免得它先把
         条纹糊掉，那就分不清是它糊的还是玻璃糊的）、.view 半透明。
         于是「玻璃有没有在干活」完全由 std 说了算：工作→条纹被糊平→std 小；
         失明→采空→直接露出未糊的条纹→std 大。 */
      ? 'html.ui-pro .phone,html.ui-pro.app-mode .phone{'
        + 'background:repeating-linear-gradient(0deg,#1e40af 0 4px,#f59e0b 4px 8px)!important}'
        + '#page-home{visibility:hidden!important}'
        + 'html.ui-pro .scrim{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}'
        + 'html.ui-pro .view{background:rgba(255,255,255,.30)!important}'
      : 'html.ui-pro .phone,html.ui-pro.app-mode .phone,'
        + 'html.ui-pro .view,html.ui-pro #view-focus{'
        + 'background:repeating-linear-gradient(0deg,#1e40af 0 4px,#f59e0b 4px 8px)!important}');
    document.head.appendChild(s);
  })()`);
  await sleep(400);

  /* scrim 模式：只测「二级页背后那层模糊」本身。
     .view 整块 display:none，让主页完全暴露在 .scrim 之下，
     于是采样到的就是 scrim 的糊 —— 能单独回答「scrim 在自己 220ms 淡入期间
     有没有失明」这个问题（它直接决定需求 2 能不能靠 scrim 实现）。 */
  const SCRIM = MODE === 'scrim';
  if (SCRIM) {
    await evaluate(`(function(){
      var s=document.createElement('style'); s.id='__probe4';
      s.textContent='html.ui-pro .view,html.ui-pro #view-focus{display:none!important}';
      document.head.appendChild(s);
    })()`);
    await sleep(200);
  }

  /* 打开方式：模拟手指按下那张卡片再开 —— MOTION.srcEl() 依赖 LAST_POINTER
     且要求 700ms 内，不派发事件就走不到 reveal 分支（会退化成侧入）。 */
  const OPEN = `(function(){
    var t = document.querySelectorAll('.g-tile')[${VIEW === 'schedule' ? 0 : VIEW === 'todos' ? 2 : 1}];
    var r = t.getBoundingClientRect();
    t.dispatchEvent(new PointerEvent('pointerdown', {clientX:r.x+20, clientY:r.y+20, bubbles:true}));
    openView('${VIEW}');
    return t.className;
  })()`;

  /* 先开一次：拿到稳定态 + 采样矩形（此时二级页可见，rect 有效） */
  await evaluate(OPEN);
  await sleep(900);
  /* 采样区：直接找二级页里**挂着 backdrop-filter 且尺寸够大**的那块玻璃 ——
     那才是我们关心的对象。写死 .list/.card 会扑空（课表二级页里没有这两种）。 */
  const rect = await evaluate(`(function(){
    if(${SCRIM}){
      /* 主页上挑一块高频内容（四宫格卡片），它就在 .scrim 下面 */
      var t = document.querySelector('#page-home .g-tile');
      var r = t.getBoundingClientRect();
      return {x:Math.round(r.x+6),y:Math.round(r.y+6),width:Math.round(r.width-12),height:Math.round(r.height-12),
              what:'home g-tile（scrim 之下）', n:1};
    }
    var v = document.querySelector('.view.show') || document.getElementById('view-${VIEW}');
    if(!v) return {err:'no view'};
    var kids = [].slice.call(v.querySelectorAll('*')).filter(function(e){
      var cs = getComputedStyle(e);
      var bf = cs.backdropFilter || cs.webkitBackdropFilter;
      if(!bf || bf === 'none') return false;
      var r = e.getBoundingClientRect();
      return r.width > 60 && r.height > 30;
    });
    if(!kids.length) return {err:'no glass in view'};
    var li = kids[0], r = li.getBoundingClientRect();
    return {x:Math.round(r.x+6),y:Math.round(r.y+6),width:Math.round(r.width-12),height:Math.round(r.height-12),
            what:(li.className||li.tagName).toString().slice(0,24), n:kids.length};
  })()`);
  if (rect.err) throw new Error('采样区退化：' + JSON.stringify(rect));
  console.log('采样区（二级页 ' + VIEW + '）' + JSON.stringify(rect) + '\n');
  if (rect.width < 10 || rect.height < 10) throw new Error('采样区退化：' + JSON.stringify(rect));
  console.log('采样区（二级页 ' + VIEW + '）' + JSON.stringify(rect) + '\n');
  await shot('t-steady', rect);

  /* 基准：强制关掉二级页内所有模糊 —— 这是「完全没糊」的 std 上限 */
  await evaluate(`(function(){
    var s=document.createElement('style'); s.id='__probe2';
    s.textContent=${SCRIM}
      ? 'html.ui-pro .scrim{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}'
      : 'html.ui-pro .view *{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}';
    document.head.appendChild(s);
  })()`);
  await sleep(400);
  await shot('t-noblur', rect);
  await evaluate("var s=document.getElementById('__probe2'); if(s) s.remove();");
  await sleep(300);

  /* 关键对照：把页内玻璃换成兜底实色 --card-solid（= 没有模糊时的等价实色），
     看它与真正的玻璃态差多少色。差得小，"动画期间用实色顶替"这个修法才成立。 */
  await evaluate(`(function(){
    var s=document.createElement('style'); s.id='__probe3';
    s.textContent='html.ui-pro .view *{background:var(--card-solid)!important;'
      + '-webkit-backdrop-filter:none!important;backdrop-filter:none!important}';
    document.head.appendChild(s);
  })()`);
  await sleep(400);
  await shot('t-solid', rect);
  await evaluate("var s=document.getElementById('__probe3'); if(s) s.remove();");
  await sleep(300);

  /* 关掉，回到首页，准备连拍 */
  await evaluate("(function(){ var v=document.querySelector('.view.show'); if(v) closeView(v.id.replace('view-','')); })()");
  await sleep(700);

  if (MODE === 'noreveal') {
    await evaluate("MOTION.reveal = function(){ return null; }");
    console.log('模式：noreveal（不播 clip-path 展开，其余照旧）\n');
  } else if (MODE === 'noenter') {
    await evaluate("MOTION.reveal = function(){ return null; }; MOTION.enter = function(){ return null; }");
    console.log('模式：noenter（reveal 与侧入都不播）\n');
  } else {
    console.log('模式：asis（原样）\n');
  }

  const t0 = Date.now();
  await evaluate(OPEN);
  const marks = [];
  for (let i = 0; i < 14; i++) {
    marks.push(Date.now() - t0);
    await shot('t-' + String(i).padStart(2, '0'), rect);
  }
  await sleep(1200);
  await shot('t-end', rect);
  if (MODE === 'shot') {
    /* 外观复核：真实配置下的整屏（不铺条纹、不关任何东西） */
    const r2 = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT, 'full.png'), Buffer.from(r2.data, 'base64'));
    console.log('整屏外观图 → tools/_viewblur/full.png');
  }
  fs.writeFileSync(path.join(OUT, 'frames-' + MODE + '.txt'),
    marks.map((t, i) => 't-' + String(i).padStart(2, '0') + '.png ' + t).join('\n'));
  console.log('连拍时刻(ms)：' + marks.join(', '));
  console.log('参考：t-steady（稳定态）· t-noblur（强制无模糊的上限）· t-end（末帧）');
} catch (e) {
  console.error('失败：', e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}
