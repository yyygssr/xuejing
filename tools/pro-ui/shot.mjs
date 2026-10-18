/* tools/pro-ui/shot.mjs —— UI Pro 皮肤预览样张
   做法：读 index.html → 注入 pro-skin.css 与一段引导脚本 → 落成自包含的 preview.html
   （可以直接用浏览器打开它，右上角切皮肤/主题），再用无头 Edge 逐屏截图。
   不动真实 index.html，不产生任何提交物。 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const here = path.join(root, 'tools', 'pro-ui');
const SHOTDIR = path.join(here, 'shots');
fs.mkdirSync(SHOTDIR, { recursive: true });
/* 整批跑之前清掉旧样张。Windows 上直接 rmSync 整个目录会撞 EPERM
   （资源管理器 / 索引服务 / 上一轮还没退干净的 Edge 都可能占着句柄），
   所以逐文件删 + 重试，删不动的报出来而不是让整个脚本挂掉。
   --detail 是「在已有样张上补一张」，不清。 */
if (!process.argv.includes('--detail')) {
  const stuck = [];
  for (let round = 0; round < 5; round++) {
    stuck.length = 0;
    for (const f of fs.readdirSync(SHOTDIR)) {
      try { fs.rmSync(path.join(SHOTDIR, f), { force: true }); }
      catch (e) { stuck.push(f); }
    }
    if (!stuck.length) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
  if (stuck.length) console.log('  ⚠️ 删不掉（被占用）：' + stuck.join(', '));
}

const app = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
/* 和 sync.mjs 一样先归一成 LF：源文件是 CRLF，index.html 里那段比对前也归一了，
   不归一就会永远报「不一致」这个假警报。 */
const skin = fs.readFileSync(path.join(here, 'pro-skin.css'), 'utf8').replace(/\r\n/g, '\n').trimEnd();

/* 引导脚本：灌演示数据 + 按 query 切皮肤/主题/页面。
   放在页面自身脚本之后执行，所以 S / go / openView 这些都已就绪。 */
const boot = String.raw`
/* ================= UI Pro 预览引导（仅预览文件，不进应用） ================= */
(function(){
  var q = new URLSearchParams(location.search);
  var pro = q.get('pro') !== '0';
  var theme = q.get('theme') || 'light';
  var pro = q.get('pro') !== '0';             /* 开不开 UI Pro */
  var glass = q.get('glass') || 'clear';      /* clear 通透 / frost 磨砂 */
  var edge = q.get('edge') !== '0';           /* 高光描边开关 */
  var screen = q.get('screen') || 'home';
  function apply(){
    /* 主题走真实路径：写 S，让 applyLook 去挂类、写 data-theme-kind 和 --blur-n。
       以前这里直接 classList.toggle('ui-pro')，那种写法会被随后的
       applyLook() 按 S 里的状态覆盖掉，preview 就永远停在经典皮肤。 */
    S.uiTheme = pro ? 'pro' : 'classic';
    S.uiEdge = edge;
    S.uiGlass = glass;
    S.theme = theme;
    applyLook();
  }
  function seed(){
    var P = ['#5a5ad6','#0fb8a5','#f08c3a','#e0508a','#2563eb'];
    S.onboarded = true;
    var ob = document.getElementById('onboard'); if(ob) ob.classList.remove('show');
    document.body.classList.remove('ob-open');
    S.courses = {
      0:[{n:'高等数学',t:'08:00-09:40',loc:'教三 305',c:P[0],w:'all'},
         {n:'大学英语',t:'10:00-11:40',loc:'外语楼 201',c:P[1],w:'all'},
         {n:'数据结构',t:'14:00-15:40',loc:'实验楼 B204',c:P[2],w:'all'}],
      1:[{n:'线性代数',t:'08:00-09:40',loc:'教三 210',c:P[3],w:'all'},
         {n:'体育课',t:'16:00-17:40',loc:'操场',c:P[4],w:'even'}],
      2:[{n:'高等数学',t:'08:00-09:40',loc:'教三 305',c:P[0],w:'all'}],
      3:[{n:'毛概',t:'10:00-11:40',loc:'文科楼 105',c:P[1],w:'odd'},
         {n:'数据结构实验',t:'14:00-15:40',loc:'实验楼 B204',c:P[2],w:'all'}],
      4:[{n:'大学英语',t:'10:00-11:40',loc:'外语楼 201',c:P[1],w:'all'}],
      5:[],6:[]};
    var tk = todayKey();
    S.days[tk] = {min:125, pomo:5};
    S.tasks[taskKey(todayI)] = [
      {h:'19:00',t:'错题复盘',s:'今天课上错的 6 道题过一遍',done:true,pomo:1,mins:25},
      {h:'19:40',t:'数据结构第 3 章习题',s:'重点：树的遍历',done:false,pomo:2,mins:50},
      {h:'21:00',t:'英语单词 List 12',s:'碎片时间也能做',done:false,pomo:1,mins:25}];
    S.todos = [
      {id:'pv1',t:'交数据结构实验报告',done:false,at:Date.now(),due:'',p:'high'},
      {id:'pv2',t:'预约图书馆研讨间',done:false,at:Date.now(),due:'',p:'normal'},
      {id:'pv3',t:'买下周教材',done:true,at:Date.now(),due:'',p:'low'}];
    S.notes = [
      {id:'pvn1',title:'中值定理 · 三种证法',body:'罗尔 → 拉格朗日 → 柯西，条件逐条放松。辅助函数是关键。',at:Date.now()-7200000,folder:'数学',mode:'text'},
      {id:'pvn2',title:'树的遍历小结',body:'前中后序 + 层序；由前序与中序可唯一确定二叉树。',at:Date.now()-86400000,folder:'计算机',mode:'text'}];
    S.goal = 8;
    S.nick = '同学';
    /* ?bg=1 塞一张程序生成的图，用来看「自定义背景图 + 遮罩 + 光晕」三层叠得对不对 */
    if(q.get('bg') === '1'){
      var cv = document.createElement('canvas'); cv.width = 860; cv.height = 1864;
      var cx = cv.getContext('2d');
      var gd = cx.createLinearGradient(0, 0, 860, 1864);
      gd.addColorStop(0, '#2b3a67'); gd.addColorStop(.45, '#5c7a8a'); gd.addColorStop(1, '#c96f4a');
      cx.fillStyle = gd; cx.fillRect(0, 0, 860, 1864);
      for(var i=0;i<26;i++){
        cx.beginPath();
        cx.arc(Math.random()*860, Math.random()*1864, 20+Math.random()*90, 0, 6.284);
        cx.fillStyle = 'rgba(255,255,255,' + (0.03 + Math.random()*0.09).toFixed(3) + ')';
        cx.fill();
      }
      S.bgImage = cv.toDataURL('image/jpeg', 0.82);
    }
    apply();
  }
  function goScreen(){
    document.querySelectorAll('.view.show').forEach(function(v){ v.classList.remove('show'); });
    closeSheet && closeSheet();
    if(screen === 'home'){ go('home'); renderWeek(); renderCourses(); renderPlan(); renderStats(); renderHomeTiles(); }
    else if(screen === 'chat'){
      msgs = [
        {r:'ai', t:'下午好。今天有三节课，数据结构实验在下午两点。**本周累计专注 2 小时 5 分钟**，比上周同期多 40 分钟。要不要我把晚上的时间排一下？', src:['课表','专注']},
        {r:'me', t:'好，帮我把错题复盘和习题排上，别太晚。'},
        {r:'ai', t:'排好了：\n\n· 19:00 错题复盘（25 分钟）\n· 19:40 数据结构第 3 章习题（50 分钟）\n· 21:00 英语单词 List 12（25 分钟）\n\n中间各留 10 分钟休息，最晚 21:40 结束。', src:['行程规划']}
      ];
      go('chat'); renderMsgs(); renderChatAiBar();
      /* 战术开关出一张「一开一关」的：用户报的就是这两态分不出来，
         只出两态都关的样张等于没出。 */
      S.deepThink = true;
      if(typeof renderChatSwitches === 'function') renderChatSwitches();
    }
    else if(screen === 'me'){ go('me'); renderProfile(); refreshAll(); }
    else if(screen === 'focus'){
      go('home');
      S.focus.on = true; S.focus.paused = false; S.focus.mode = 'work'; S.focus.dir = 'down';
      S.focus.total = 1500; S.focus.secs = 913; S.focus.label = '数据结构第 3 章习题';
      S.focus.startAt = Date.now() - 587000; S.focus.endsAt = Date.now() + 913000;
      openView('focus'); renderFocus(); setSegs();
    }
    else if(screen === 'sheet'){ go('home'); renderWeek(); renderCourses(); renderPlan(); renderStats(); renderHomeTiles(); openSheet('planpref'); }
    else if(screen === 'hist'){      /* 历史侧栏：先造两段归档，再拉开抽屉 */
      go('chat');
      msgs = [{r:'ai', t:'这是当前这段对话。'}];
      S.chatHistory = [
        {id:'h1', title:'期末复习怎么排', when:'10月14日', ts:Date.now()-3600000, fav:true,
          msgs:[{r:'me',t:'帮我排一下复习'},{r:'ai',t:'按科目切了三段…'}]},
        {id:'h2', title:'数据结构实验报告', when:'10月13日', ts:Date.now()-72000000,
          msgs:[{r:'me',t:'报告怎么写'},{r:'ai',t:'先给提纲…'}]},
        {id:'h3', title:'课表导入问题', when:'10月11日', ts:Date.now()-260000000, archived:true,
          msgs:[{r:'me',t:'导入失败'},{r:'ai',t:'看下格式…'}]}
      ];
      renderMsgs(); openHistDrawer();
    }
    else if(screen === 'look'){
      /* 设置页「外观」那一屏：新加的两行控件只有在这里能被看见 */
      go('me'); renderProfile();
      var hs = [].slice.call(document.querySelectorAll('.h2'));
      var h = hs.filter(function(x){ return x.textContent.indexOf('外观') >= 0; })[0];
      if(h){
        var sc = h.closest('.screen') || document.querySelector('.screen');
        sc.scrollTop = h.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 10;
      }
    }
    else if(screen === 'theme'){
      /* 主题二级页：三张主题卡 + 无级滑杆 + 背景图 */
      go('me'); renderProfile(); renderUiTheme(); openView('theme');
    }
    else if(screen === 'ident' || screen === 'term'){
      /* 「它的身份」（AI 名字 / 称呼 / 头像）与「学期与节假日」两屏：
         用户报的两条缺分隔线都在这里，且都在 .screen 靠下的位置，必须滚过去才看得见 */
      go('me'); renderProfile(); refreshAll();
      var want = screen === 'ident' ? '它的身份' : '学期与节假日';
      var hs = [].slice.call(document.querySelectorAll('.h2'));
      var hh = hs.filter(function(x){ return x.textContent.indexOf(want) >= 0; })[0];
      if(hh){
        var sc = hh.closest('.screen') || document.querySelector('.screen');
        sc.scrollTop = hh.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 10;
      }
    }
    else if(screen === 'notes'){ openNotes(); }
    /* 完整课表二级页：.sched-day 一天一条，是「二级页有没有糊」最直观的一屏 */
    else if(screen === 'sched'){ go('home'); openView('schedule'); }
    setTimeout(apply, 30);
  }
  seed(); goScreen();
  /* 右上角调试条：切皮肤 / 主题 / 页面，方便直接开 preview.html 手玩 */
  if(q.get('bare') === '1') return;
  var bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;display:flex;gap:6px;font:11px/1 system-ui';
  function btn(label, fn){
    var b = document.createElement('div');
    b.textContent = label;
    b.style.cssText = 'padding:6px 9px;border-radius:9px;background:rgba(0,0,0,.55);color:#fff;cursor:pointer';
    b.onclick = fn; bar.appendChild(b);
  }
  btn('皮肤', function(){ pro = !pro; apply(); });
  btn('主题', function(){ theme = theme === 'light' ? 'dark' : 'light'; apply(); });
  btn('皮肤', function(){ pro = !pro; apply(); });
  btn('玻璃', function(){ glass = glass === 'clear' ? 'frost' : 'clear'; apply(); });
  btn('描边', function(){ edge = !edge; apply(); });
  ['home','chat','me','focus','sheet','look','theme','hist','notes','sched'].forEach(function(s){
    btn(s, function(){ screen = s; goScreen(); });
  });
  document.body.appendChild(bar);
})();
`;

/* 注入：JS 放在应用脚本之后（引导要用 S / go / openView 这些）。
   CSS 以前也在这里注入，现在皮肤已经同步进 index.html 了 ——
   再注一遍就是同一份规则出现两次，改源文件反而看不出效果，所以只在
   应用里还没有皮肤段时才注（--check 模式下这个判断同样成立）。 */
const SKIN_MARK = '/* ==== UI Pro 皮肤 · 由 tools/pro-ui/sync.mjs 从 pro-skin.css 同步，勿手改此段 ==== */';
let out = app;
if (!out.includes(SKIN_MARK)) {
  out = out.replace('</style>', '\n/* ==== UI Pro 皮肤（预览注入） ==== */\n' + skin + '\n</style>');
} else {
  const at = out.indexOf(SKIN_MARK);
  const end = out.indexOf('/* ==== UI Pro 皮肤 结束 ==== */', at);
  /* cur 从头标记起算，所以要连头标记一起比，否则永远报不一致 */
  const cur = out.slice(at, end).replace(/\r\n/g, '\n').trim();
  if (cur !== (SKIN_MARK + '\n' + skin).trim()) {
    console.log('  ⚠️ index.html 里的皮肤与 pro-skin.css 不一致 —— 跑 node tools/pro-ui/sync.mjs');
  }
}
out = out.replace('</script>', boot + '\n</script>');
if(out === app){ console.error('注入失败：没找到 </style> 或 </script>'); process.exit(1); }
fs.writeFileSync(path.join(here, 'preview.html'), out);
console.log('  写出 preview.html (' + (out.length / 1024).toFixed(0) + ' KB)');

/* 视口矩阵：
     phone    430×932  → 应用自己的手机布局（悬浮 dock 该是横条）
     wide     1280×900 → 触发应用的平板布局 layout-tablet（该是侧栏，不是横条）
     classic  pro=0    → 反证：选经典时必须和「这份皮肤不存在」一模一样
     bgphoto  bg=1     → 自定义背景图 + 遮罩 + 半透面叠在一起读不读得字
     blurmin/max       → 无级滑杆的两个极端，证明它真的在动半径
   皮肤必须两边都不塌版，所以两边都要有样张。 */
const WIDTH = 1280, HEIGHT = 932;
const VIEWS = [
  { tag: 'phone', w: 430, h: 932, dsf: 2, pro: 1, bg: 0, screens: ['home', 'chat', 'me', 'focus', 'sheet', 'look', 'theme', 'hist', 'notes', 'sched', 'ident', 'term'] },
  { tag: 'wide', w: 1280, h: 900, dsf: 1, pro: 1, bg: 0, screens: ['home', 'me'] },
  /* 反证：选「经典」时必须和「这份皮肤不存在」一模一样 */
  { tag: 'classic', w: 430, h: 932, dsf: 2, pro: 0, bg: 0, screens: ['look', 'theme', 'home', 'hist'] },
  /* 自定义背景图：这是上一版「根本用不了」的那张图，重点看内容还在不在 */
  { tag: 'bgphoto', w: 430, h: 932, dsf: 2, pro: 1, bg: 1, screens: ['home', 'me', 'sched', 'notes'] },
  /* 无级模糊的两个极端 */
  { tag: 'blurmin', w: 430, h: 932, dsf: 2, pro: 1, bg: 0, blur: 0,   screens: ['home'] },
  { tag: 'blurmax', w: 430, h: 932, dsf: 2, pro: 1, bg: 0, blur: 100, screens: ['home'] }
];
/* 两轴：玻璃档（通透/磨砂）× 描边开关。描边关只出「能看出区别」的两屏，别把样张翻倍。 */
const GLASSES = [
  { tag: 'clear', glass: 'clear', edge: 1, screens: null },
  { tag: 'frost', glass: 'frost', edge: 1, screens: ['phone:home', 'phone:me', 'phone:sheet', 'phone:theme', 'bgphoto:home'] },
  { tag: 'noedge', glass: 'clear', edge: 0, screens: ['phone:home', 'phone:me', 'phone:ident', 'phone:term', 'bgphoto:home', 'bgphoto:me'] }
];
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(here, 'preview.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-pro-' + Date.now());
const dbgPort = 9700 + Math.floor(Math.random() * 200);
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio', '--hide-scrollbars',
  '--window-size=' + WIDTH + ',' + HEIGHT, '--force-device-scale-factor=2',
  '--remote-debugging-port=' + dbgPort, '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore', detached: true });
child.unref();
const cleanup = () => {
  try { ws && ws.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
};
process.on('exit', cleanup);

async function waitFor(fn, ms = 40000, step = 200) {
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

const log = [];
try {
  const ver = await waitFor(async () => { try { const r = await fetch('http://127.0.0.1:' + dbgPort + '/json/version'); return await r.json(); } catch (e) { return null; } });
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  const events = [];
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; events.push('EXC: ' + ((d.exception && d.exception.description) || d.text)); }
  };
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, false);
  const att = await send('Target.attachToTarget', { targetId, flatten: true }, false);
  sessionId = att.sessionId;
  await send('Runtime.enable'); await send('Page.enable');

  /* ---- 细节诊断模式：node tools/pro-ui/shot.mjs --detail
     只放大截某一块卡片，并把这一层套一层的 computed style 打出来。
     「颜色覆盖不完全」这类问题，看整屏截图是查不出来的。 ---- */
  if (process.argv.includes('--detail')) {
    const arg = p => { const a = process.argv.find(x => x.startsWith(p + '=')); return a ? a.slice(p.length + 1) : null; };
    const theme = arg('theme') || 'light';
    const pick = arg('el') || '服务商与模型';
    const kind = arg('kind') || 'glass';
    await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/preview.html?bare=1&screen=me&theme=${theme}&kind=${kind}` });
    await waitFor(async () => (await evaluate('document.readyState')) === 'complete');
    await sleep(900);
    const dump = await evaluate(`(function(){
      var li=[].slice.call(document.querySelectorAll('.li')).find(function(x){return x.textContent.indexOf(${JSON.stringify(pick)})>=0;});
      if(!li) return JSON.stringify({err:'找不到含「'+${JSON.stringify(pick)}+'」的 .li'});
      var card=li.closest('.list,.card')||li.parentElement;
      var g=function(e,d){if(!e)return null;var c=getComputedStyle(e);return {
        who:d,cls:e.className||e.tagName,
        bgColor:c.backgroundColor,bgImage:c.backgroundImage.slice(0,72),
        radius:[c.borderTopLeftRadius,c.borderTopRightRadius,c.borderBottomRightRadius,c.borderBottomLeftRadius].join('|'),
        overflow:c.overflow,blur:(c.backdropFilter||c.webkitBackdropFilter||'none').slice(0,30),
        rect:(function(){var r=e.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)+' @'+Math.round(r.x)+','+Math.round(r.y);})()};};
      var r=card.getBoundingClientRect();
      return JSON.stringify({chain:[g(card,'card'),g(li,'.li'),g(li.querySelector('.ic'),'.ic'),g(li.querySelector('.badge'),'.badge')],
        box:{x:r.left,y:r.top,w:r.width,h:r.height}},null,1);
    })()`);
    const parsed = JSON.parse(dump);
    console.log(parsed.chain ? parsed.chain.map(c => JSON.stringify(c)).join('\n') : dump);
    if (parsed.box) {
      const shot = await send('Page.captureScreenshot', {
        format: 'png', clip: { x: parsed.box.x - 6, y: parsed.box.y - 6, width: parsed.box.w + 12, height: parsed.box.h + 12, scale: 1 },
        captureBeyondViewport: true
      });
      /* 文件名走 ASCII：中文元素名在部分工具链里读不出来 */
      const f = path.join(SHOTDIR, `detail-${kind}-${theme}-el.png`);
      fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
      console.log('  写出 ' + f);
    }
    cleanup(); process.exit(0);
  }

  /* ---- 巡检模式：node tools/pro-ui/shot.mjs --sweep[=screen]
     把每一屏里「底色是半透明、却没挂 backdrop-filter」的面揪出来。
     这类面在 UI Pro 下就是透明塑料片 —— 用户报的「二级页没模糊」连着四轮都是它，
     每轮只补被点到的那几个类，下一屏又冒出来新的。所以不再靠点名：
     按「半透 + 无糊 = 违规」这条规则整屏扫，一次看全。
     只统计真的在屏上占地方、且是「一张面」尺寸（≥40×40）的元素，
     小徽标/图标底不在语义范围内（它们本来就该是实心色块）。 ---- */
  if (process.argv.some(a => a === '--sweep' || a.startsWith('--sweep='))) {
    const only = (process.argv.find(a => a.startsWith('--sweep=')) || '').split('=')[1];
    await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
    const screens = only ? [only] : ['home', 'chat', 'me', 'focus', 'sched', 'notes', 'theme', 'hist', 'sheet', 'look'];
    for (const sc of screens) {
      for (const glass of ['clear', 'frost']) {
        await send('Page.navigate', { url: `http://127.0.0.1:${port}/preview.html?bare=1&screen=${sc}&theme=light&glass=${glass}&pro=1&bg=1` });
        await waitFor(async () => (await evaluate('document.readyState')) === 'complete');
        await sleep(900);
        const dump = await evaluate(`(function(){
          var out=[];
          [].slice.call(document.querySelectorAll('*')).forEach(function(e){
            var c=getComputedStyle(e);
            var b=c.backdropFilter||c.webkitBackdropFilter||'none';
            if(b!=='none') return;
            var bg=c.backgroundColor;
            var m=/rgba\\((\\d+), (\\d+), (\\d+), ([\\d.]+)\\)/.exec(bg);
            if(!m) return;                       /* 实色与透明不算面 */
            var al = parseFloat(m[4]);
            if(al >= 0.98 || al <= 0.02) return;  /* α=0 是「没有底」，不是透明塑料片 */
            var r=e.getBoundingClientRect();
            if(r.width<40||r.height<40) return;
            if(r.bottom<0||r.top>window.innerHeight) return;
            if(e.offsetParent===null&&getComputedStyle(e).position!=='fixed') return;
            if(e.children.length && !e.textContent.trim()) return;  /* 纯容器交给子元素 */
            var cls=(typeof e.className==='string'?e.className:e.tagName)||'(no class)';
            out.push({cls:cls.slice(0,46), tag:e.tagName, alpha:m[4],
              size:Math.round(r.width)+'x'+Math.round(r.height),
              inView:(e.closest('.view')||{}).id||''});
          });
          /* 同一类只报一次，附上出现次数 */
          var by={}; out.forEach(function(o){ var k=o.cls+'|'+o.inView;
            by[k]=by[k]||{n:0,o:o}; by[k].n++; });
          return JSON.stringify(Object.keys(by).map(function(k){
            return by[k].o.cls+' @'+(by[k].o.inView||'主页面')+' ×'+by[k].n
              + ' α='+by[k].o.alpha+' '+by[k].o.size; }));
        })()`);
        const list = JSON.parse(dump);
        console.log(`\n[sweep] ${sc} · ${glass} · 半透无糊 ${list.length} 类`);
        list.forEach(x => console.log('   · ' + x));
      }
    }
    cleanup(); process.exit(0);
  }

  for (const gd of GLASSES) {
    for (const theme of ['light', 'dark']) {
      for (const view of VIEWS) {
        await send('Emulation.setDeviceMetricsOverride',
          { width: view.w, height: view.h, deviceScaleFactor: view.dsf, mobile: view.tag === 'phone' });
        await sleep(260); /* 等 resize 监听把 layout-tablet 类切到位 */
        for (const screen of view.screens) {
          if (gd.screens && !gd.screens.includes(view.tag + ':' + screen)) continue;
          await send('Page.navigate', { url: `http://127.0.0.1:${port}/preview.html?bare=1&screen=${screen}&theme=${theme}&glass=${gd.glass}&pro=${view.pro}&bg=${view.bg}&edge=${gd.edge}` });
          await waitFor(async () => (await evaluate('document.readyState')) === 'complete');
          await sleep(900);
          const layout = await evaluate(`document.documentElement.className || '(none)'`);
          /* 只截手机壳那块，别把预览页的灰底一起进来 */
          const box = await evaluate(`(function(){var p=document.querySelector('.phone');var r=p.getBoundingClientRect();
            return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height});})()`);
          const b = JSON.parse(box);
          const clipScale = view.tag === 'wide' ? 0.62 : 1;
          const shot = await send('Page.captureScreenshot', {
            format: 'png',
            clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: clipScale },
            captureBeyondViewport: true
          });
          const f = path.join(SHOTDIR, `${view.tag}-${gd.tag}-${theme}-${screen}.png`);
          fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
          log.push(`  shot ${path.basename(f)}  [${view.w}x${view.h}]  html.class=${layout}`);
          if (screen === 'home') {
            /* 底栏排布 + 内外圆角 + 当前生效的模糊半径 */
            const probe = await evaluate(`(function(){
              var t=document.querySelector('.tabbar'),r=t.getBoundingClientRect();
              var tabs=[].slice.call(t.querySelectorAll('.tab')).map(function(x){var b=x.getBoundingClientRect();return [Math.round(b.left),Math.round(b.top)];});
              var horiz=tabs.length>1&&tabs.every(function(p){return Math.abs(p[1]-tabs[0][1])<6;});
              var g=function(s){var e=document.querySelector(s);return e?getComputedStyle(e).borderTopLeftRadius:'-';};
              var cs=getComputedStyle(document.querySelector('.card')||document.body);
              return JSON.stringify({dock:horiz?'横排':'竖排',tabbar:Math.round(r.width)+'x'+Math.round(r.height),
                tabs:tabs.length,tablet:document.documentElement.classList.contains('layout-tablet'),
                kind:document.documentElement.getAttribute('data-theme-kind')||document.documentElement.classList.contains('ui-pro')?'pro':'classic',edge:document.documentElement.getAttribute('data-edge'),blurpx:document.documentElement.style.getPropertyValue('--blur-n'),
                seg:g('.seg'),thumb:g('.segThumb'),tile:g('.g-tile'),gi:g('.g-tile .gi'),
                blur:(cs.backdropFilter||cs.webkitBackdropFilter||'').slice(0,30),
                sheen:(cs.backgroundImage||'').slice(0,34)});
            })()`);
            log.push('    probe ' + probe);
          }
        }
      }
    }
  }
  console.log(log.join('\n'));
  console.log('\n=== 页面错误 ===');
  console.log(events.length ? events.slice(0, 10).join('\n') : 'none');
  cleanup(); process.exit(0);
} catch (e) {
  console.log('HARNESS ERROR: ' + (e && e.stack || e));
  console.log(log.join('\n'));
  cleanup(); process.exit(3);
}
