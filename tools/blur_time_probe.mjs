/* tools/blur_time_probe.mjs —— 切页后「模糊什么时候到位」的时间序列 + 成本清点
   做法：把 .phone 的底换成 8px 高频横条。糊了 → 行均值 std 小；没糊 → std 大。
        go('me') 之后立刻连续截图，记录每张图的时刻与 std，看模糊是「第一帧就有」
        还是「过若干帧才补上」。同时清点当前页里 backdrop-filter 元素的个数与总面积。
   跑法：node tools/blur_time_probe.mjs [clear|frost] [me|home] */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GLASS = process.argv[2] || 'clear';
const TAB = process.argv[3] || 'me';
/* asis = 原样；notransform = 把进场动画的位移抹成 0（保留动画本身）；
   noanim = 干脆不播进场动画。用来反证「模糊缺失」就是这段 transform 造成的。 */
const MODE = process.argv[4] || 'asis';
const OUT = path.join(root, 'tools', '_bdroot');
fs.mkdirSync(OUT, { recursive: true });
/* 每次跑之前清掉上一轮的连拍，免得新旧帧混在一批里被当成同一条曲线 */
for (const f of fs.readdirSync(OUT)) if (/^t-/.test(f)) fs.unlinkSync(path.join(OUT, f));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-btime-' + Date.now());
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
  await evaluate(`(function(){
    var s=document.createElement('style'); s.id='__probe';
    s.textContent='html.ui-pro .phone,html.ui-pro.app-mode .phone{background:repeating-linear-gradient(0deg,#1e40af 0 4px,#f59e0b 4px 8px)!important}';
    document.head.appendChild(s);
  })()`);
  await sleep(400);

  await evaluate("go('" + TAB + "')");
  await sleep(900);

  /* 成本清点：当前页里有多少个元素挂着 backdrop-filter，总面积多大 */
  const cost = await evaluate(`(function(){
    function scan(sel){
      var host=document.querySelector(sel); if(!host) return {err:'no '+sel};
      var all=host.querySelectorAll('*'); var n=0, area=0, maxA=0, list=[];
      for(var i=0;i<all.length;i++){
        var e=all[i], cs=getComputedStyle(e);
        var bf=cs.backdropFilter||cs.webkitBackdropFilter||'none';
        if(bf && bf!=='none'){
          var r=e.getBoundingClientRect(), a=Math.round(r.width*r.height);
          n++; area+=a; if(a>maxA) maxA=a;
          list.push((e.className||e.tagName).toString().slice(0,18)+':'+a);
        }
      }
      var pr=host.getBoundingClientRect();
      return {n:n, area:area, maxA:maxA, hostArea:Math.round(pr.width*pr.height),
              ratio:+(area/Math.max(1,pr.width*pr.height)).toFixed(2), list:list.slice(0,20)};
    }
    return {me:scan('#page-me'), home:scan('#page-home'), chat:scan('#page-chat')};
  })()`);
  console.log('=== backdrop-filter 成本清点（玻璃档 ' + GLASS + '） ===');
  for (const k of ['home', 'me', 'chat']) {
    const c = cost[k];
    if (c.err) { console.log('  #page-' + k + ': ' + c.err); continue; }
    console.log('  #page-' + k + '：' + c.n + ' 个元素挂模糊，总面积 ' + c.area
      + 'px²（页面积 ' + c.hostArea + '，倍数 ' + c.ratio + '），最大单个 ' + c.maxA + 'px²');
    console.log('     ' + c.list.join('  '));
  }
  console.log('');

  /* ⚠️ 采样矩形必须在目标页**可见**的时候取 —— 页是 display:none 时
     getBoundingClientRect() 全是 0，clip 退化会变成整屏截图（既慢又测不到东西）。 */
  const rect = await evaluate(`(function(){
    var li=document.querySelector('#page-${TAB} .list, #page-${TAB} .card, #page-${TAB} .g-tile');
    var r=li.getBoundingClientRect();
    return {x:Math.round(r.x+6),y:Math.round(r.y+6),width:Math.round(r.width-12),height:Math.round(r.height-12)};
  })()`);
  if (rect.width < 10 || rect.height < 10) throw new Error('采样区退化：' + JSON.stringify(rect));
  console.log('采样区（#page-' + TAB + '）' + JSON.stringify(rect) + '\n');

  /* 时间序列：切页后立刻连拍 */
  await evaluate("go('" + (TAB === 'me' ? 'home' : 'me') + "')");
  await sleep(700);
  await shot('t-pre', rect);

  if (MODE === 'notransform') {
    await evaluate(`(function(){
      var o = MOTION.enter;
      MOTION.enter = function(el, opt){
        opt = opt || {}; opt.x = 0; opt.y = 0; opt.sc = 0;
        return o(el, opt);
      };
    })()`);
    console.log('模式：notransform（动画还在，位移抹成 0）\n');
  } else if (MODE === 'noanim') {
    await evaluate("MOTION.enter = function(){ return null; }");
    console.log('模式：noanim（完全不播进场动画）\n');
  } else if (MODE === 'cards') {
    /* 动画挂在页内每一块玻璃面自己身上，而不是它们的共同祖先 .page 上。
       单块被提升时，它的 backdrop 还是父层（父层里有 .phone 的光晕），
       理论上模糊应该活下来。 */
    await evaluate(`(function(){
      var o = MOTION.enter;
      MOTION.enter = function(el, opt){
        if(!el || !el.classList || !el.classList.contains('page')) return o(el, opt);
        var kids = [].slice.call(el.children).filter(function(k){ return k.nodeType === 1; });
        kids.forEach(function(k){ o(k, opt); });
        return null;
      };
    })()`);
    console.log('模式：cards（动画下放到页内每块玻璃面自己身上）\n');
  } else if (MODE === 'bgfix') {
    /* 动画期间给 .page 自己铺一份「固定」的底（和 .phone 同一份 --base-bg）。
       这样即使 .page 被提升成 backdrop root，root 内部也有东西可糊。
       background-attachment:fixed 保证它不随内容滚动漂移。 */
    await evaluate(`(function(){
      var s=document.createElement('style'); s.id='__probe3';
      s.textContent='html.ui-pro .page.__ent{background:var(--base-bg);background-attachment:fixed}';
      document.head.appendChild(s);
      var o = MOTION.enter;
      MOTION.enter = function(el, opt){
        var a = o(el, opt);
        if(el && el.classList && el.classList.contains('page') && a){
          el.classList.add('__ent');
          var done = function(){ el.classList.remove('__ent'); };
          if(a.finished && a.finished.then) a.finished.then(done, done);
          else setTimeout(done, 400);
        }
        return a;
      };
    })()`);
    console.log('模式：bgfix（动画期间给 .page 临时铺固定底）\n');
  } else if (MODE === 'relative') {
    /* 改用 top/left 做位移：不进合成层，也就不产生新的 backdrop root。
       代价是每帧走布局，低端机会抖。 */
    await evaluate(`(function(){
      MOTION.enter = function(el, opt){
        opt = opt || {};
        if(!el || !el.animate) return null;
        el.style.position = 'relative';
        return el.animate([
          { top: (opt.y || 6) + 'px', left: (opt.x || -14) + 'px' },
          { top: '0px', left: '0px' }
        ], { duration: 320, easing: 'cubic-bezier(.22,.9,.24,1)' });
      };
    })()`);
    console.log('模式：relative（改动画 top/left，不碰 transform）\n');
  } else {
    console.log('模式：asis（原样）\n');
  }

  const t0 = Date.now();
  await evaluate("go('" + TAB + "')");
  const marks = [];
  for (let i = 0; i < 14; i++) {
    const t = Date.now() - t0;
    await shot('t-' + String(i).padStart(2, '0'), rect);
    marks.push(t);
  }
  await sleep(1200);
  await shot('t-end', rect);
  const frames = marks.map((t, i) => ({ f: 't-' + String(i).padStart(2, '0') + '.png', t }));
  fs.writeFileSync(path.join(OUT, 'frames-' + MODE + '.json'), JSON.stringify({ marks, rect, glass: GLASS, tab: TAB, mode: MODE }, null, 2));
  fs.writeFileSync(path.join(OUT, 'frames-' + MODE + '.txt'), frames.map(x => x.f + ' ' + x.t).join('\n'));
  console.log('连拍时刻(ms)：' + marks.join(', '));
  console.log('末帧(t-end) 为稳定态参考');
} catch (e) {
  console.error('失败：' + e.message);
  process.exitCode = 2;
} finally {
  cleanup();
}
