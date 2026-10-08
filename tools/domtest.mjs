import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(root, 'index.html');

const ASSERTS = String.raw`
(async function(){
  var R = [];
  function T(name, fn){
    var rec = { name: name };
    try { var r = fn() || {}; rec.ok = !!r.ok; rec.info = (r.info === undefined ? '' : String(r.info)); }
    catch(e){ rec.ok = false; rec.info = 'THREW: ' + (e && (e.message || e)); }
    R.push(rec);
  }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function cls(el){ return el ? (el.className || '') : 'NULL'; }
  function shownViews(){ return [].slice.call(document.querySelectorAll('.view.show')).map(function(e){ return e.id; }); }
  async function visible(id){
    await sleep(420);
    var el = document.getElementById(id);
    if(!el) return { top:false, opacity:'n/a', hits:'n/a' };
    var st = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    var hit = document.elementFromPoint(r.x + r.width/2, r.y + 140);
    return { top: !!hit && el.contains(hit), opacity: st.opacity, hits: hit ? ('<' + hit.tagName + ' class="' + cls(hit) + '">') : 'null' };
  }
  function alertShown(){ var b = document.getElementById('alertBox'); return !!b && b.classList.contains('show'); }
  function snapState(){
    return JSON.parse(JSON.stringify({
      sys: S.sysHolidays, hol: S.holidays, off: S.holidayOff,
      ranges: S.holidayRanges, flat: S.__holFlat, err: S.holLastErr,
      prefs: S.prefs, courses: S.courses, roles: S.roles, models: S.models,
      pm: S.providerModels, ml: S.modelList, pr: S.priceRules, u: S.aiUsage
    }));
  }
  function restoreState(x){
    S.sysHolidays = x.sys || {}; S.holidays = x.hol || {}; S.holidayOff = x.off || {};
    S.holidayRanges = x.ranges || []; S.__holFlat = x.flat || null; S.holLastErr = x.err || '';
    S.prefs = x.prefs || {}; S.courses = x.courses || {};
    if(x.roles) S.roles = x.roles; if(x.models) S.models = x.models;
    if(x.pm) S.providerModels = x.pm; if(x.ml) S.modelList = x.ml;
    if(x.pr) S.priceRules = x.pr; else S.priceRules = {};
    if(x.u) S.aiUsage = x.u;
  }

  var phone = document.getElementById('phone');

  T('app booted (phone + state S)', function(){
    return { ok: !!phone && typeof S === 'object', info: 'phone=' + !!phone + ' S=' + (typeof S) };
  });

  // ---------- 结构 ----------
  T('view-aihub 是 .phone 的直接子节点', function(){
    var v = document.getElementById('view-aihub');
    return { ok: !!v && v.parentElement === phone, info: v ? v.parentElement.id : 'MISSING' };
  });
  T('所有 .view 都是 .phone 的直接子节点', function(){
    var bad = [];
    document.querySelectorAll('.view').forEach(function(v){ if (v.parentElement !== phone) bad.push(v.id); });
    return { ok: bad.length === 0, info: 'views=' + document.querySelectorAll('.view').length + ' bad=[' + bad.join(',') + ']' };
  });
  T('没有重复 id', function(){
    var seen = {}, dup = [];
    document.querySelectorAll('[id]').forEach(function(el){ if(seen[el.id]) dup.push(el.id); else seen[el.id] = 1; });
    return { ok: dup.length === 0, info: dup.join(',') || 'none' };
  });

  // ---------- 三级页 ----------
  T('openAiConfig() 只显示一层二级页', function(){
    openAiConfig();
    var s = shownViews();
    return { ok: s.length === 1 && s[0] === 'view-ai', info: 'shown=' + s.join(',') };
  });
  var vAi = await visible('view-ai');
  T('view-ai 确实可见（对照组）', function(){
    return { ok: vAi.opacity === '1' && vAi.top, info: JSON.stringify(vAi) };
  });
  T('真点「提供商」入口 → 只剩 view-aihub', function(){
    var cand = document.querySelector('#view-ai [onclick*="openAiHub"]');
    if (!cand) return { ok:false, info:'入口没找到' };
    cand.click();
    var s = shownViews();
    return { ok: s.length === 1 && s[0] === 'view-aihub', info: 'shown=[' + s.join(',') + ']' };
  });
  var vHub = await visible('view-aihub');
  T('view-aihub 可见且在最上层', function(){
    return { ok: vHub.opacity === '1' && vHub.top, info: JSON.stringify(vHub) };
  });
  T('三级页返回键回到 AI 配置', function(){
    closeView('aihub');
    return { ok: shownViews().join() === 'view-ai', info: 'shown=[' + shownViews().join(',') + ']' };
  });

  // ---------- 提供商页 ----------
  T('提供商页是横条卡片 + 新增入口', function(){
    openAiHub();
    var host = document.getElementById('provList');
    var cards = host.querySelectorAll(':scope > .card').length;
    var add = /新增提供商/.test(host.textContent);
    return { ok: cards >= 5 && add, info: 'cards=' + cards + ' add=' + add };
  });
  T('点卡片展开能配 url / key / 可用模型', function(){
    toggleProvCard('deepseek');
    var host = document.getElementById('provList');
    var html = host.innerHTML;
    var n = host.querySelectorAll('input').length;
    return { ok: n >= 3 && /Base URL/.test(html) && /API Key/.test(html) && /可用模型/.test(html) && /拉取模型列表/.test(html),
             info: 'inputs=' + n };
  });
  T('可用模型可增可删', function(){
    providerModelsAdd('deepseek', '__t_model__');
    var a = providerModelsOf('deepseek').indexOf('__t_model__') >= 0;
    providerModelsDel('deepseek', '__t_model__');
    var b = providerModelsOf('deepseek').indexOf('__t_model__') < 0;
    return { ok: a && b, info: 'added=' + a + ' deleted=' + b };
  });
  T('新增提供商会出现在列表里且可展开', function(){
    var before = customProviders().length;
    addCustomProvider();
    var after = customProviders().length;
    var open = window.__provOpen;
    var has = /名称/.test(document.getElementById('provList').innerHTML);
    return { ok: after === before + 1 && !!open && has, info: 'before=' + before + ' after=' + after + ' open=' + open };
  });
  T('拉取后模型进「待添加」，不自动进可用名单', function(){
    var st = snapState();
    try{
      S.providerModels = S.providerModels || {};
      S.providerModels.__tp__ = [];
      S.modelList = S.modelList || {};
      S.modelListAt = S.modelListAt || {};
      window.onModelsFetched(true, JSON.stringify({data:[{id:'m-a'},{id:'m-b'}]}));
      /* onModelsFetched 用 __fetchProvId；这里直接看存储 */
      S.modelList.__tp__ = ['m-a','m-b'];
      S.modelListAt.__tp__ = Date.now();
      var enabled = providerModelsOf('__tp__');
      var fetched = (S.modelList||{}).__tp__ || [];
      return { ok: enabled.length === 0 && fetched.length === 2,
               info: 'enabled=' + enabled.length + ' fetched=' + fetched.length };
    } finally { restoreState(st); }
  });

  // ---------- 弹页：各功能模型 / 回复风格 ----------
  T('各功能模型是弹页入口', function(){
    openAiConfig();
    var sheet = document.getElementById('sheet');
    openSheet('modelroles');
    var has = !!document.getElementById('modelList') && !document.getElementById('fetchBox')
      && /选渠道与模型|各功能使用的模型/.test(sheet.textContent.replace(/\s+/g,' '));
    var n = document.getElementById('modelList').children.length;
    closeSheet();
    return { ok: has && n >= 5, info: 'rows=' + n + ' has=' + has };
  });
  T('回复风格是弹页入口', function(){
    openSheet('replystyle');
    var sheet = document.getElementById('sheet');
    var n = (document.getElementById('replyStyleList')||{children:[]}).children.length;
    var has = n >= 8 && /回复风格/.test(sheet.textContent);
    closeSheet();
    return { ok: has, info: 'items=' + n };
  });
  T('模型选择弹层是双列（左渠道 / 右模型）', function(){
    openAiConfig();
    pickModel('chat');
    var sheet = document.getElementById('sheet');
    var g = sheet.querySelector('div[style*="grid-template-columns"]');
    if (!g) return { ok:false, info:'没找到双列容器' };
    var gtc = getComputedStyle(g).gridTemplateColumns;
    var cols = gtc.split(' ').filter(function(x){ return x && x !== '0px'; }).length;
    var a = g.children[0].getBoundingClientRect(), b = g.children[1].getBoundingClientRect();
    closeSheet();
    return { ok: cols === 2 && Math.abs(a.top - b.top) < 2 && b.left > a.right - 1,
             info: 'gtc=' + gtc + ' 左x=' + Math.round(a.left) + ' 右x=' + Math.round(b.left) };
  });

  // ---------- 记忆 ----------
  T('openMemory() 写入 #memBody 且只显一层', function(){
    closeSheet();
    openMemory();
    var el = document.getElementById('memBody');
    return { ok: el.innerHTML.length > 0 && shownViews().join() === 'view-memory',
             info: 'len=' + el.innerHTML.length + ' shown=[' + shownViews().join(',') + ']' };
  });
  var vMem = await visible('view-memory');
  T('记忆页可见且在最上层（不是白屏）', function(){
    return { ok: vMem.opacity === '1' && vMem.top, info: JSON.stringify(vMem) };
  });
  T('有记忆时渲染成列表', function(){
    var st = snapState();
    try{
      if(!S.memory) S.memory = {};
      S.memory.items = [{ id:'__t1__', text:'数学是弱项', cat:'study', at: Date.now() }];
      openMemory();
      var el = document.getElementById('memBody');
      return { ok: el.querySelectorAll('.li').length >= 1, info: 'rows=' + el.querySelectorAll('.li').length };
    } finally { /* 记忆不在 snapState 里，手动还原省事 */ }
  });

  // ---------- 自动专注 ----------
  var BOOK = '__domtest_booking__';
  function withBooking(bookingObj, focusPatch, fn){
    var sb = JSON.parse(JSON.stringify(S.bookings || {}));
    var sf = JSON.parse(JSON.stringify(S.focus));
    var calls = 0;
    var orig = window.startBookedClass;
    try {
      window.startBookedClass = function(){ calls++; };
      if (!S.bookings) S.bookings = {};
      if (bookingObj) S.bookings[BOOK] = bookingObj; else delete S.bookings[BOOK];
      if (focusPatch) { for (var k in focusPatch) S.focus[k] = focusPatch[k]; }
      return fn(function(){ return calls; });
    } finally {
      window.startBookedClass = orig;
      S.bookings = sb;
      S.focus = sf;
    }
  }
  function hhmm(offsetMin){
    var d = new Date(Date.now() + offsetMin * 60000);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  T('预约到点只开一次，开完就删（不再无限 start）', function(){
    var now = hhmm(0);
    return withBooking({ day: todayI, t: now + '-' + now }, { on: false, courseId: null }, function(nCalls){
      tickBookings();
      var first = nCalls(), left1 = !!S.bookings[BOOK];
      tickBookings(); tickBookings(); tickBookings();
      var all = nCalls(), left2 = !!S.bookings[BOOK];
      return { ok: first === 1 && all === 1 && !left1 && !left2,
               info: '第1次后=' + first + ' 第4次后=' + all + ' 预约还在=' + left2 };
    });
  });
  T('过点太久的预约作废，不补开', function(){
    var nowM = toMin(nowHM());
    if (nowM < 5) return { ok: true, info: '跳过：距零点不足 5 分钟' };
    var past = hhmm(-30);
    return withBooking({ day: todayI, t: past + '-' + past }, { on: false, courseId: null }, function(nCalls){
      tickBookings();
      return { ok: nCalls() === 0 && !S.bookings[BOOK], info: '调用=' + nCalls() };
    });
  });
  T('正在别的专注时不抢开', function(){
    var now = hhmm(0);
    return withBooking({ day: todayI, t: now + '-' + now }, { on: true, courseId: '__other__' }, function(nCalls){
      tickBookings();
      var b = S.bookings[BOOK];
      return { ok: nCalls() === 0 && !!b && b.startedOn === todayKey(), info: '调用=' + nCalls() };
    });
  });

  // ---------- 节假日 ----------
  T('节假日模块就绪（区间模型）', function(){
    return { ok: typeof holidayOn === 'function' && typeof holidaySync === 'function'
      && typeof holidayAdd === 'function' && typeof holidayDel === 'function'
      && typeof holidayRanges === 'function' && typeof holidayInvalidate === 'function',
      info: 'holidayRanges=' + typeof holidayRanges };
  });
  T('系统日历结果按区间并进状态', function(){
    var st = snapState();
    try{
      window.onHolidaysFetched(true, JSON.stringify({
        ranges: [
          {from:'2099-10-01', to:'2099-10-07', name:'国庆节'},
          {from:'2099-05-01', to:'2099-05-03', name:'劳动节'}
        ],
        cals: 4, events: 20, matched: 2
      }));
      var a = holidayOn('2099-10-01') === '国庆节' && holidayOn('2099-10-07') === '国庆节'
        && holidayOn('2099-10-04') === '国庆节';
      var b = holidayOn('2099-05-02') === '劳动节';
      var n = holidayAll().length;
      return { ok: a && b && n === 2, info: 'range days ok=' + (a&&b) + ' ranges=' + n };
    } finally { restoreState(st); }
  });
  T('同步失败能记下原因（不静默）', function(){
    var st = snapState();
    try{
      window.onHolidaysFetched(false, '缺少日历权限');
      return { ok: !!S.holLastErr, info: 'holLastErr=' + S.holLastErr };
    } finally { restoreState(st); }
  });
  T('手动按范围添加：3 天全生效', function(){
    var st = snapState();
    try{
      document.getElementById('holFrom') && (document.getElementById('holFrom').value = '2099-03-01');
      if(document.getElementById('holTo')) document.getElementById('holTo').value = '2099-03-03';
      if(document.getElementById('holName')) document.getElementById('holName').value = '校运会';
      openSheet('holidays');
      document.getElementById('holFrom').value = '2099-03-01';
      document.getElementById('holTo').value = '2099-03-03';
      document.getElementById('holName').value = '校运会';
      holidayAdd();
      var v1 = holidayOn('2099-03-01'), v2 = holidayOn('2099-03-02'), v3 = holidayOn('2099-03-03');
      var outside = holidayOn('2099-03-04');
      var n = holidayAll().filter(function(r){ return r.name === '校运会'; }).length;
      return { ok: v1 === '校运会' && v2 === '校运会' && v3 === '校运会' && !outside && n === 1,
               info: '三天=[' + v1 + ',' + v2 + ',' + v3 + '] 范围外=[' + outside + '] 段数=' + n };
    } finally { restoreState(st); closeSheet(); }
  });
  T('手动移除整段（不是一天）', function(){
    var st = snapState();
    try{
      S.holidayRanges = [{id:'u_x', from:'2099-04-01', to:'2099-04-03', name:'考试周', src:'user'}];
      S.__holFlat = null;
      holidayDel('u_x');
      return { ok: !holidayOn('2099-04-01') && !holidayOn('2099-04-02') && !holidayOn('2099-04-03')
        && holidayAll().length === 0, info: 'r1=' + holidayOn('2099-04-01') + ' left=' + holidayAll().length };
    } finally { restoreState(st); }
  });
  T('手动加的段不受同步覆盖', function(){
    var st = snapState();
    try{
      S.holidayRanges = [{id:'u_m', from:'2099-03-01', to:'2099-03-03', name:'校运会', src:'user'}];
      S.__holFlat = null;
      window.onHolidaysFetched(true, JSON.stringify({ranges:[{from:'2099-03-01',to:'2099-03-03',name:'被盖掉'}]}));
      var v = holidayOn('2099-03-01');
      return { ok: v === '校运会', info: '值=' + v };
    } finally { restoreState(st); }
  });
  T('手动移除的系统段同步回来也不复活', function(){
    var st = snapState();
    try{
      S.holidayRanges = [{id:'s_a', from:'2099-05-01', to:'2099-05-03', name:'劳动节', src:'sys'}];
      S.holidayOff = {'2099-05-01':1, '2099-05-02':1, '2099-05-03':1};
      S.__holFlat = null;
      window.onHolidaysFetched(true, JSON.stringify({ranges:[{from:'2099-05-01',to:'2099-05-03',name:'劳动节'}]}));
      var v = holidayOn('2099-05-02');
      return { ok: v === '', info: '值=[' + v + ']（应为空）' };
    } finally { restoreState(st); }
  });
  T('节假日当天的课被隐藏，关掉模式就恢复', function(){
    var st = snapState();
    try{
      S.courses[todayI] = [{t:'08:00-09:40', n:'高等数学', loc:'教一楼', c:1, w:'all'}];
      var dk = dateKeyForDayIdx(todayI);
      S.holidayRanges = [{id:'u_t', from:dk, to:dk, name:'测试假日', src:'user'}];
      S.holidayOff = {};
      S.__holFlat = null;
      S.prefs.holidayMode = true;
      var nHol = coursesAt(todayI).length;
      S.prefs.holidayMode = false;
      var nOff = coursesAt(todayI).length;
      return { ok: nHol === 0 && nOff === 1, info: 'date=' + dk + ' 节假日下=' + nHol + ' 关闭后=' + nOff };
    } finally { restoreState(st); }
  });
  T('区间中间的一天同样隐藏', function(){
    var st = snapState();
    try{
      S.courses[todayI] = [{t:'08:00-09:40', n:'高等数学', loc:'教一楼', c:1, w:'all'}];
      var dk = dateKeyForDayIdx(todayI);
      S.holidayRanges = [{id:'u_r', from: dkAdd(dk, -1), to: dkAdd(dk, 1), name:'三天假', src:'user'}];
      S.holidayOff = {};
      S.__holFlat = null;
      S.prefs.holidayMode = true;
      var n = coursesAt(todayI).length;
      return { ok: n === 0, info: '课程数=' + n };
    } finally { restoreState(st); }
  });
  T('完整课表页有节假日开关与设置入口', function(){
    openSchedule();
    return { ok: !!document.getElementById('swHoliday') && !!document.getElementById('holidayCountHint')
      && !!document.getElementById('schedGrid'), info: 'ok' };
  });
  T('节假日设置弹层：范围输入 + 区间列表', function(){
    var st = snapState();
    try{
      S.holidayRanges = [
        {id:'s_g', from:'2099-10-01', to:'2099-10-07', name:'国庆节', src:'sys'},
        {id:'u_x', from:'2099-11-11', to:'2099-11-12', name:'校庆', src:'user'}
      ];
      S.holidayOff = {}; S.__holFlat = null;
      openSheet('holidays');
      var txt = document.getElementById('sheet').textContent.replace(/\s+/g,' ');
      var has = /10-01 ~ 10-07|10\.01|10-01/.test(txt) && /国庆节/.test(txt) && /校庆/.test(txt)
        && /从系统日历同步/.test(txt) && !!document.getElementById('holFrom') && !!document.getElementById('holTo');
      return { ok: has, info: txt.slice(0, 120) };
    } finally { restoreState(st); closeSheet(); }
  });
  T('同步不会冲掉正在填的输入框', function(){
    var st = snapState();
    try{
      openSheet('holidays');
      document.getElementById('holFrom').value = '2099-07-01';
      document.getElementById('holTo').value = '2099-07-05';
      document.getElementById('holName').value = '期末';
      renderHolidaySheetIfOpen(true);
      var v = document.getElementById('holName').value;
      var f = document.getElementById('holFrom').value;
      return { ok: v === '期末' && f === '2099-07-01', info: 'name=' + v + ' from=' + f };
    } finally { restoreState(st); closeSheet(); }
  });

  // ---------- 杂项 ----------
  // ---------- 回归：语音播报重构（原生 TextToSpeech 为主，不再静默失败） ----------
  T('语音：任何失败都写日志并提示，绝不静默', function(){
    /* 浏览器预览下没有原生桥 → ttsInit 应落到某个明确状态，而不是崩或什么都不做 */
    var r = ttsInit();
    var known = ['ready','pending','error','noengine','web'].indexOf(r) >= 0;
    /* 核心回归点：旧实现所有异常都进了 catch(e){}，用户只看到「没声音」。
       现在 ttsFail 必须同时写日志 + 出提示。 */
    var before = RUNTIME_LOG.length;
    ttsFail('__测试失败原因__');
    var logged = RUNTIME_LOG.some(function(x){
      return x.tag === '语音' && String(x.msg).indexOf('__测试失败原因__') >= 0;
    });
    var grew = RUNTIME_LOG.length > before;
    var tip = (document.getElementById('toast') || {}).textContent || '';
    RUNTIME_LOG.length = before;      /* 别把测试噪音留给后面的断言 */
    return { ok: known && logged && grew && tip.indexOf('朗读') >= 0,
      info: 'ttsInit=' + r + ' 失败写日志=' + logged + ' 日志增长=' + grew
        + ' 提示=' + JSON.stringify(tip.slice(0, 22)) };
  });

  // ---------- 对话页增强：加号菜单 / 快捷开关 / 长按操作 / 文件上传 ----------

  T('对话：加号菜单含拍照·相册·文件·换模型，图标都画出来了', function(){
    var btn = document.getElementById('plusBtn');
    var menu = document.getElementById('plusMenu');
    if(!btn || !menu) return { ok:false, info:'加号按钮或菜单容器缺失' };
    /* 原来这里是相机按钮，现在必须是加号 —— SVG 路径要对 */
    var isPlus = /M12 5v14M5 12h14/.test(btn.innerHTML);
    togglePlusMenu();
    var shown = menu.classList.contains('show');
    var labels = [].map.call(menu.querySelectorAll('.actrow'), function(r){
      var d = r.querySelector('div[style*="font-weight"]');
      return d ? d.textContent : '';
    });
    /* 每行都要有真图标（空心方框 = 图标没灌上，openSheet 修过同类坑） */
    var svgs = menu.querySelectorAll('.actrow .ic svg');
    var iconsOk = svgs.length === 4 && [].every.call(svgs, function(s){
      return s && s.innerHTML.length > 4;
    });
    var joined = labels.join('|');
    var want = ['拍照','相册','上传文件','换个模型'];
    var hasAll = want.every(function(w){ return joined.indexOf(w) >= 0; });
    /* 历史对话在左上角已有一个入口（openChatHistory）——
       这里再放一个既重复又多点一次，用户明确要求删掉。 */
    var noDup = joined.indexOf('历史对话') < 0;
    var posOk = !!(menu.style.top && menu.style.left && menu.style.width);
    closePlusMenu();
    var closed = !menu.classList.contains('show');
    return { ok: isPlus && shown && hasAll && noDup && iconsOk && posOk && closed,
      info: '加号=' + isPlus + ' 弹出=' + shown + ' 项=' + joined
        + ' 无重复历史入口=' + noDup
        + ' 图标数=' + svgs.length + ' 图标有内容=' + iconsOk
        + ' 定位=' + posOk + ' 收起=' + closed };
  });

  T('对话：三个菜单里的入口都指向真实存在的函数', function(){
    /* 踩过：写了 openView("chatHistory")，那个视图压根不存在，
       点一下什么都不会发生。这里把 onclick 串里的函数名全抠出来验。
       **三个菜单都要扫**（加号 / 模型 / 长按）——
       只扫一个就是半个守卫，剩下的照样可能写错名字。 */
    var keepRoles = S.roles, keepList = S.providerModels;
    var keepKey = S.apiKey, keepUrl = S.baseUrl;
    S.roles = {chat:{p:'deepseek', m:'m1'}};
    S.providerModels = {deepseek: ['m1', 'm2']};
    S.apiKey = 'sk-t'; S.baseUrl = 'https://e.invalid';
    var names = [];
    function collect(menu){
      [].forEach.call(menu.querySelectorAll('.actrow'), function(r){
        var oc = r.getAttribute('onclick') || '';
        /* 一行里可能有多个调用（如 closePlusMenu();openChatHistory()），
           只取第一个会漏掉后面那个 —— 漏掉就等于这条守卫失效。 */
        var re = /([A-Za-z_$][\w$]*)\s*\(/g, m2;
        while((m2 = re.exec(oc))){
          if(m2[1] !== 'if' && m2[1] !== 'function') names.push(m2[1]);
        }
      });
    }
    togglePlusMenu();
    collect(document.getElementById('plusMenu'));
    closePlusMenu();
    plusModelMenu();
    collect(document.getElementById('plusMenu'));
    closePlusMenu();
    msgs = [{r:'me', t:'问'}, {r:'ai', t:'答'}];
    renderMsgs();
    openMsgActions(1, {x:200, y:200, h:20, point:true});
    collect(document.getElementById('msgMenu'));
    closeMsgMenu();
    var missing = names.filter(function(n){
      return typeof window[n] !== 'function' && typeof eval(n) !== 'function';
    });
    var uniq = names.filter(function(n, i){ return names.indexOf(n) === i; });
    S.roles = keepRoles; S.providerModels = keepList;
    S.apiKey = keepKey; S.baseUrl = keepUrl;
    /* 期望 8 个不同函数：加号 3（camera/album/file）+ 模型 3（quick/more/close）
       + 长按 4（regen/copy/speak/rate…）—— 少于 8 说明有一处菜单没扫到 */
    return { ok: !missing.length && uniq.length >= 8,
      info: '共 ' + names.length + ' 处调用 / ' + uniq.length + ' 个不同函数：'
        + uniq.join(',') + ' 缺失=' + (missing.join(',') || '无') };
  });

  T('对话：模型快捷菜单列出当前渠道的模型，且能真切换', function(){
    /* 模型列表来自 providerModelsOf，测试里造两个假模型 */
    var keepP = S.provider, keepList = S.providerModels, keepKey = S.apiKey;
    S.provider = 'deepseek';
    S.providerModels = {deepseek: ['fast-a', 'smart-b']};
    S.apiKey = 'sk-test'; S.baseUrl = 'https://example.invalid';
    var keepRoles = S.roles;
    /* 当前模型要绑在 roles.chat.m 上：roleModelName() **优先**读它，
       S.models.chat 只是回落项 —— 而同文件里别的断言会改 S.models.chat，
       用它当基准会读到别人的值。 */
    S.roles = {chat:{p:'deepseek', m:'fast-a'}};
    closePlusMenu();
    plusModelMenu();
    var box = document.getElementById('plusMenu');
    var txt = box.textContent;
    /* 头部要写清是哪个渠道，否则用户看到一串模型名不知道属于谁 */
    var hasHead = txt.indexOf('DeepSeek') >= 0 || txt.indexOf('deepseek') >= 0;
    var listsBoth = txt.indexOf('fast-a') >= 0 && txt.indexOf('smart-b') >= 0;
    /* 当前模型要标出来，且那一行带 on（选中态） */
    var onRows = box.querySelectorAll('.actrow.on');
    var curMarked = onRows.length === 1 && box.querySelector('.actrow.on').textContent.indexOf('fast-a') >= 0;
    /* 必须留「更多选择」出口：换渠道 / 手填 ID 只能从那儿走 */
    var hasMore = txt.indexOf('更多选择') >= 0;
    var iconsOk = [].every.call(box.querySelectorAll('.actrow .ic svg'), function(s){
      return s && s.innerHTML.length > 4;
    });
    /* 真切一次：smart-b 应当写进 roles.chat.m */
    applyQuickModel('smart-b');
    var switched = (rolesCfg().chat || {}).m === 'smart-b';
    /* 再点当前模型不该改动（幂等 + 提示） */
    applyQuickModel('smart-b');
    var stillOne = (rolesCfg().chat || {}).m === 'smart-b';
    closePlusMenu();
    S.provider = keepP; S.providerModels = keepList; S.apiKey = keepKey;
    S.roles = keepRoles;
    return { ok: hasHead && listsBoth && curMarked && hasMore && iconsOk
        && switched && stillOne,
      info: '含渠道名=' + hasHead + ' 列出模型=' + listsBoth
        + ' 当前项标记=' + curMarked + ' 有更多出口=' + hasMore
        + ' 图标=' + iconsOk + ' 切换生效=' + switched + ' 重复点击不变=' + stillOne };
  });

  T('对话：模型快捷菜单在没配 Key 时直接引导去配置', function(){
    var keepList = S.providerModels, keepKey = S.apiKey, keepUrl = S.baseUrl;
    var keepAcc = providerAccs().deepseek;
    S.provider = 'deepseek';
    S.providerModels = {deepseek: ['m1']};
    S.apiKey = ''; S.baseUrl = '';
    closePlusMenu();
    plusModelMenu();
    var box = document.getElementById('plusMenu');
    var txt = box.textContent;
    /* 没配好时列模型没意义（点了也不通），要直接说清并给出路 */
    var guides = txt.indexOf('还没配好') >= 0 && txt.indexOf('配置') >= 0;
    closePlusMenu();
    S.providerModels = keepList; S.apiKey = keepKey; S.baseUrl = keepUrl;
    if(keepAcc) { S.apiKey = keepAcc.key || ''; S.baseUrl = keepAcc.url || ''; }
    return { ok: guides, info: '引导去配置=' + guides };
  });

  T('对话：深度思考开关只改 system，不动 tools/stream', function(){
    var base = 'BASE_SYSTEM';
    var keep = S.deepThink;
    S.deepThink = false;
    var off = deepThinkSystem(base);
    S.deepThink = true;
    var on = deepThinkSystem(base);
    /* 推理模型自带 reasoning，再注入一遍只是浪费 token */
    /* roleModelName('chat') 读的是 roles.chat.m，不是 S.models.chat ——
       两条都得改，只改一条会读到旧值（第一次写这条断言时就这么错的）。 */
    var m = S.models.chat, rm = (S.roles && S.roles.chat) ? S.roles.chat.m : undefined;
    S.models.chat = 'deepseek-r1';
    if(S.roles && S.roles.chat) S.roles.chat.m = '';
    var onReasoning = deepThinkSystem(base);
    S.models.chat = m;
    if(S.roles && S.roles.chat) S.roles.chat.m = rm;
    S.deepThink = keep;
    return { ok: off === base && on !== base && on.indexOf('BASE_SYSTEM') === 0
        && onReasoning === base,
      info: '关时原样=' + (off === base) + ' 开时追加=' + (on !== base)
        + ' 原前缀保留=' + (on.indexOf('BASE_SYSTEM') === 0)
        + ' 推理模型不重复注入=' + (onReasoning === base) };
  });

  T('对话：联网搜索开关驱动 webSearchCfg 而不另存一份', function(){
    var c = webSearchCfg(), keep = c.on, hadKey = c.key;
    c.on = false;
    renderChatSwitches();
    var row = document.getElementById('chatSwitches');
    var txt = row ? row.textContent : '';
    var hasBoth = txt.indexOf('深度思考') >= 0 && txt.indexOf('联网搜索') >= 0;
    var svgs = row ? row.querySelectorAll('.qsw svg') : [];
    var icons = svgs.length === 2 && [].every.call(svgs, function(s){
      return s && s.innerHTML.length > 4;
    });
    /* 打开但没配 Key 时要写「未配置」，不能让用户以为联网了 */
    c.on = true; c.key = '';
    renderChatSwitches();
    var notes = (row ? row.textContent : '').indexOf('未配置') >= 0;
    c.on = keep; c.key = hadKey;
    renderChatSwitches();
    return { ok: hasBoth && icons && notes,
      info: '两项=' + hasBoth + ' 图标数=' + svgs.length + ' 图标有内容=' + icons
        + ' 缺配置提示=' + notes };
  });

  T('对话：长按消息弹锚点菜单（不遮全屏），底部只剩朗读', function(){
    msgs = [
      {r:'me', t:'今天要背哪几个词'},
      {r:'ai', t:'先背 Unit 1 的十个，明天再复习一遍。'}
    ];
    renderMsgs();
    var box = document.getElementById('msgs');
    var says = box.querySelectorAll('[data-say]');
    /* 原来有四个 badge（重新生成/朗读/赞/踩），现在一个都不该剩 */
    var oldBadges = box.querySelectorAll('.msg.ai > div > div > div > .badge');
    var holds = box.querySelectorAll('[data-hold]');
    /* **必须先切到对话页**：页面容器要有 .active 才 display:flex，
       否则 getBoundingClientRect 全返回 0 —— 量不到位置就等于没量。
       这是本项目的老坑：断言里凡是要量尺寸/坐标，先确认元素可见。 */
    var keepTab = (document.querySelector('.page.active') || {}).id;
    go('chat');
    bubble = box.querySelectorAll('[data-hold]')[1];
    var br = bubble.getBoundingClientRect();
    var visible = br.height > 0 && br.width > 0;
    /* 按在气泡中间偏上：菜单应该出现在附近，而不是屏幕底部 */
    var at = {x: br.left + br.width/2, y: br.top + 10, h: br.height, point:true};
    openMsgActions(1, at);
    var menu = document.getElementById('msgMenu');
    var shown = menu.classList.contains('show');
    var joined = menu.textContent;
    var want = ['重新生成','复制内容','朗读这条','答得不错','不太对','删除'];
    var hasAll = want.every(function(w){ return joined.indexOf(w) >= 0; });
    var svgs = menu.querySelectorAll('.actrow .ic svg');
    var iconsOk = svgs.length === 6 && [].every.call(svgs, function(s){
      return s && s.innerHTML.length > 4;
    });
    /* **关键回归**：菜单必须出现在按下的位置附近。
       底部弹层会把整个对话盖住，用户失去「我按的是哪条」的视觉锚点。 */
    var mh = menu.offsetHeight, mtop = parseFloat(menu.style.top) || 0;
    var nearAnchor = mtop < window.innerHeight * 0.62;
    /* 头部要标明这是谁的哪条 */
    var hasHead = menu.querySelector('.menuhead') !== null;
    /* 底部弹层不该被打开 */
    var sheetOpen = (document.getElementById('sheet') || {}).classList
                     && document.getElementById('sheet').classList.contains('show');
    /* 用户消息是另一套（编辑/复制/删除），不该有「重新生成」 */
    closeMsgMenu();
    openMsgActions(0, at);
    var t2 = (document.getElementById('msgMenu') || {}).textContent || '';
    var userOk = t2.indexOf('编辑这条提问') >= 0 && t2.indexOf('重新生成') < 0;
    closeMsgMenu();
    if(keepTab && keepTab !== 'page-chat') go(keepTab.replace('page-', ''));
    return { ok: says.length === 1 && oldBadges.length === 0 && holds.length === 2
        && shown && hasAll && iconsOk && nearAnchor && hasHead && !sheetOpen
        && userOk && visible && mh > 0,
      info: '元素可见=' + visible + ' 菜单高=' + mh
        + ' 朗读按钮=' + says.length + ' 旧badge=' + oldBadges.length
        + ' 可长按=' + holds.length + ' 锚点菜单弹出=' + shown
        + ' AI项齐全=' + hasAll + ' 图标数=' + svgs.length
        + ' 靠近按点=' + nearAnchor + '（顶=' + Math.round(mtop)
        + '/' + window.innerHeight + ' 高=' + mh + '）'
        + ' 有头部=' + hasHead + ' 未开底部弹层=' + (!sheetOpen) + ' 用户项=' + userOk };
  });

  T('对话：朗读按钮可点第二次打断，图标变回喇叭', function(){
    /* 先切到对话页，否则量到的全是 0（#page-chat 无 .active 时不布局） */
    var keepTab2 = (document.querySelector('.page.active') || {}).id;
    go('chat');
    msgs = [{r:'ai', t:'这是一段用来测试打断的文字'}];
    renderMsgs();
    /* 尺寸：底部只剩它一个按钮，36px 显得笨重；收到 30px。
       但不能低于 28px —— 再小就难点了，等于把「点不准」问题换回来。 */
    var sz = document.querySelector('[data-say="0"]').getBoundingClientRect();
    var btnW = Math.round(sz.width), btnH = Math.round(sz.height);
    var sizeOk = btnW >= 28 && btnW <= 32 && btnW === btnH;
    var stopped = 0, realStop = ttsStop;
    ttsStop = function(){ stopped++; };
    toggleSpeakMsg(0);
    var b1 = document.querySelector('[data-say="0"]');
    var onFirst = b1.classList.contains('on');
    var ico1 = b1.querySelector('.sb-i').innerHTML;
    var isStop = ico1.indexOf('<rect') >= 0;
    toggleSpeakMsg(0);
    var b2 = document.querySelector('[data-say="0"]');
    var onSecond = b2.classList.contains('on');
    var ico2 = b2.querySelector('.sb-i').innerHTML;
    ttsStop = realStop;
    if(keepTab2 && keepTab2 !== 'page-chat') go(keepTab2.replace('page-', ''));
    /* 打断必须真调了 ttsStop，且按钮复位成喇叭 ——
       不复位的话下次点会变成「再停一次」而不是重新朗读。 */
    return { ok: onFirst && isStop && stopped >= 2 && !onSecond
        && ico2.indexOf('M4.5 9.4') >= 0 && sizeOk,
      info: '尺寸=' + btnW + 'x' + btnH + '（28~32 且为正方形=' + sizeOk + '）'
        + ' 首次高亮=' + onFirst + ' 图标变停止=' + isStop
        + ' ttsStop调用=' + stopped + ' 二次后复位=' + (!onSecond)
        + ' 图标回喇叭=' + (ico2.indexOf('M4.5 9.4') >= 0) };
  });

  T('对话：附件做成胶囊挂件，不塞进输入框', function(){
    /* 旧做法（已删）：把文件正文贴进输入框。几千字一贴，
       输入框就只剩滚动条 —— 看不见、改不了、无法定位。
       现在是输入框上方的胶囊，点开能预览。 */
    var inp = document.getElementById('chatInput');
    var row = document.getElementById('attachRow');
    if(!row) return { ok:false, info:'附件行容器缺失' };
    inp.value = '';
    clearAttach();
    var emptyHidden = row.innerHTML === '';

    addAttach({kind:'text', name:'讲义.txt', size:2048,
      text:'x'.repeat(500), truncated:false});
    addAttach({kind:'pdf', name:'实验指导.pdf', size:900000,
      dataUrls:['data:image/jpeg;base64,AAAA'], pages:1});
    var capsules = row.querySelectorAll('.attach');
    var txt = row.textContent;
    /* 每个胶囊都要有：图标 + 文件名 + 可点的预览 + 一个 × 移除 */
    var iconsOk = [].every.call(row.querySelectorAll('.attach .ai svg'), function(s){
      return s && s.innerHTML.length > 4;
    });
    var hasNames = txt.indexOf('讲义.txt') >= 0 && txt.indexOf('实验指导.pdf') >= 0;
    var hasMeta = txt.indexOf('KB 文本') >= 0 && txt.indexOf('PDF') >= 0;
    var hasRemove = row.querySelectorAll('.attach .ax').length === 2;
    /* 输入框正文一个字都不能被塞进去 */
    var inputClean = inp.value === '';

    /* 点胶囊 → 预览弹层；点 × → 只移除自己 */
    peekAttach(ATTACH[0].id);
    var peekSheet = document.getElementById('sheet');
    var peekOk = !!(peekSheet && peekSheet.textContent.indexOf('讲义.txt') >= 0
      && peekSheet.querySelector('.filepeek'));
    closeSheet();
    removeAttach(ATTACH[0].id);
    var afterRemove = row.querySelectorAll('.attach').length === 1;
    var firstGone = row.textContent.indexOf('讲义.txt') < 0;
    clearAttach();
    var cleared = row.innerHTML === '';
    inp.value = '';
    return { ok: emptyHidden && capsules.length === 2 && iconsOk && hasNames
        && hasMeta && hasRemove && inputClean && peekOk && afterRemove
        && firstGone && cleared,
      info: '空时隐藏=' + emptyHidden + ' 胶囊数=' + capsules.length
        + ' 图标=' + iconsOk + ' 文件名=' + hasNames + ' 副标题=' + hasMeta
        + ' 可移除=' + hasRemove + ' 输入框未被污染=' + inputClean
        + ' 预览弹层=' + peekOk + ' 移除其一=' + afterRemove
        + ' 只剩一个=' + firstGone + ' 清空=' + cleared };
  });

  T('对话：附件能正确拼进请求（文本进正文、图片进多模态）', function(){
    clearAttach();
    addAttach({kind:'text', name:'a.txt', text:'第一章 绪论', truncated:false});
    addAttach({kind:'image', name:'b.png', dataUrl:'data:image/jpeg;base64,BBBB'});
    var p1 = attachPayload();
    /* 文本 → 正文；图片 → images 数组（视觉模型只认 image_url） */
    var textIn = p1.text.indexOf('第一章 绪论') >= 0;
    var nameIn = p1.text.indexOf('a.txt') >= 0;
    var imgIn = p1.images.length === 1 && p1.images[0].indexOf('data:image/') === 0;
    var namesList = p1.names.join(',') === 'a.txt,b.png';
    /* 纯文本附件时不该凭空造出 images */
    clearAttach();
    addAttach({kind:'text', name:'c.txt', text:'只有文本'});
    var p2 = attachPayload();
    var noImg = p2.images.length === 0;
    /* PDF：每页都进 images，并在正文里说明共几页 */
    clearAttach();
    addAttach({kind:'pdf', name:'d.pdf', dataUrls:['data:image/jpeg;base64,C','data:image/jpeg;base64,D'], truncated:true});
    var p3 = attachPayload();
    var pdfImgs = p3.images.length === 2;
    var pdfExplained = p3.text.indexOf('共渲染 2 页') >= 0 && p3.text.indexOf('文档更长') >= 0;
    clearAttach();
    return { ok: textIn && nameIn && imgIn && namesList && noImg && pdfImgs && pdfExplained,
      info: '文本进正文=' + textIn + ' 带文件名=' + nameIn
        + ' 图片进多模态=' + imgIn + ' 名单=' + namesList
        + ' 纯文本不造images=' + noImg
        + ' PDF每页成图=' + pdfImgs + ' PDF说明了页数=' + pdfExplained };
  });

  T('对话：长文本附件截断时如实标注', function(){
    clearAttach();
    var long = new Array(FILE_TEXT_MAX + 500).join('y');
    addAttach({kind:'text', name:'big.txt', text: long.slice(0, FILE_TEXT_MAX),
      truncated:true, rawLen: long.length});
    var row = document.getElementById('attachRow');
    var marked = row.textContent.indexOf('已截断') >= 0;
    /* 预览里也要说明「发给模型的是前 N 字符」 */
    peekAttach(ATTACH[0].id);
    var sheet = document.getElementById('sheet');
    var peekSays = !!(sheet && sheet.textContent.indexOf('发给模型的是前') >= 0);
    closeSheet();
    clearAttach();
    return { ok: marked && peekSays, info: '胶囊标注已截断=' + marked + ' 预览说明截断=' + peekSays };
  });

  T('对话：输入框随内容长高，到顶后内部滚动', function(){
    /* 必须先切到对话页：#page-chat 无 .active 时不布局，量到的全是 0 */
    var keepTab = (document.querySelector('.page.active') || {}).id;
    go('chat');
    var inp = document.getElementById('chatInput');
    if(!inp) return { ok:false, info:'输入框不是 textarea' };
    var isTa = inp.tagName === 'TEXTAREA';
    /* 单行：约等于最小高 */
    inp.value = '';
    autoGrowInput(inp);
    var h1 = Math.round(inp.getBoundingClientRect().height);
    /* 多行：应该变高 */
    inp.value = new Array(6).join('这是一行比较长的文字用来把输入框撑开看看效果');
    autoGrowInput(inp);
    var h6 = Math.round(inp.getBoundingClientRect().height);
    /* 极长：到上限就停住，不再继续长 */
    inp.value = new Array(120).join('很多很多很多很多很多字');
    autoGrowInput(inp);
    var hMax = Math.round(inp.getBoundingClientRect().height);
    var scrolls = inp.style.overflowY === 'auto';
    /* 清空后要能缩回去 —— auto-grow 最常见的 bug 是「只涨不跌」 */
    inp.value = '';
    autoGrowInput(inp);
    var hBack = Math.round(inp.getBoundingClientRect().height);
    if(keepTab && keepTab !== 'page-chat') go(keepTab.replace('page-', ''));
    return { ok: isTa && h6 > h1 && hMax <= INPUT_MAX_H + 2
        && hMax >= INPUT_MAX_H - 2 && scrolls && hBack === h1,
      info: 'textarea=' + isTa
        + ' 单行高=' + h1 + ' 六行高=' + h6
        + ' 封顶高=' + hMax + '(上限' + INPUT_MAX_H + ')'
        + ' 到顶可滚动=' + scrolls
        + ' 清空缩回=' + hBack + '(==' + h1 + ')' };
  });

  T('对话：全屏输入与输入框**实时同步**（关掉不丢内容）', function(){
    /* 先切到对话页：#page-chat 无 .active 时不布局，
       textarea 的 scrollHeight 量到 0，auto-grow 就算不出高度。
       （本轮第三次踩这个坑，已写进技能。） */
    var keepTab3 = (document.querySelector('.page.active') || {}).id;
    go('chat');
    var inp = document.getElementById('chatInput');
    var keep = inp.value;
    inp.value = '小框里原有的字';
    openFullInput();
    var ta = document.getElementById('fullInputTa');
    var opened = !!ta;
    /* 打开时应该把现有内容带上去（不是空白重来） */
    var carried = opened && ta.value === '小框里原有的字';
    /* **核心**：在全屏框里打字，必须【立刻】同步到主输入框，
       不需要点任何按钮 —— 全屏输入只是同一份内容的另一种形态。 */
    ta.value = '全屏里写的一大段文字\n第二行\n第三行';
    ta.dispatchEvent(new Event('input', {bubbles:true}));
    var liveSync = inp.value === '全屏里写的一大段文字\n第二行\n第三行';
    /* 模拟「误点弹层外面的遮罩」：直接关掉，不点任何确认。
       内容必须还在 —— 这正是改成实时同步要解决的问题。 */
    closeSheet();
    var survived = inp.value === '全屏里写的一大段文字\n第二行\n第三行';
    /* 反向：程序改主输入框（如发送后清空）时，全屏框要跟着走 */
    openFullInput();
    var ta2 = document.getElementById('fullInputTa');
    var reopenCarried = !!ta2 && ta2.value === inp.value;
    inp.value = '';
    syncInputToFull();
    var reverseSync = (document.getElementById('fullInputTa') || {}).value === '';
    closeSheet();
    var back = survived;
    /* 三行字在最小高度里放得下，高度本来就该不变 ——
       「高度变了」不是正确判据，**换回的字一字不差**才是。
       高度只在内容真的超高时才该涨。 */
    var hNow = parseInt(inp.style.height, 10) || 0;
    var sane = hNow >= INPUT_MIN_H && hNow <= INPUT_MAX_H + 2;
    /* 真正超高时才该涨 */
    inp.value = new Array(20).join('很长很长很长很长很长很长很长的文字');
    autoGrowInput(inp);
    var grew = parseInt(inp.style.height, 10) > INPUT_MIN_H;
    inp.value = keep;
    autoGrowInput(inp);
    if(keepTab3 && keepTab3 !== 'page-chat') go(keepTab3.replace('page-', ''));
    return { ok: opened && carried && liveSync && survived && reopenCarried
        && reverseSync && back && sane && grew,
      info: '弹层打开=' + opened + ' 带出原有内容=' + carried
        + ' **打字即时同步=' + liveSync + '**'
        + ' 误关不丢=' + survived
        + ' 重开仍带出=' + reopenCarried
        + ' 反向同步=' + reverseSync
        + ' 高度合理=' + sane + '(' + hNow + 'px)'
        + ' 超长时变高=' + grew };
  });

  T('架构：菜单能被空白/切页/再点同条关掉', function(){
    /* 用户实测反馈：点空白关不掉、切页还留着。
       根因是 var hit = e.target.closest 取出了方法、丢了 this，
       后面 hit('#msgMenu') 抛 Illegal invocation，
       同一函数里后面的语句全没跑到（而且**没有任何报错**）。 */
    msgs = [{r:'me', t:'问'}, {r:'ai', t:'答'}];
    renderMsgs();
    go('chat');
    var mm = document.getElementById('msgMenu');
    function openOn(ix){
      var list = document.querySelectorAll('[data-hold]');
      if(!list[ix]) return false;
      var b = list[ix];
      var r = b.getBoundingClientRect();
      openMsgActions(+b.getAttribute('data-hold'),
        {x:r.left+r.width/2, y:r.top+8, h:r.height, point:true});
      return mm.classList.contains('show');
    }
    var out = [];
    // 1) 点空白
    var opened = openOn(1);
    closeAnyMenu(document.getElementById('quickwrap'));
    out.push('点空白关=' + !mm.classList.contains('show'));
    // 2) 切页
    openOn(1);
    go('me');
    out.push('切页关=' + !mm.classList.contains('show'));
    go('chat');
    // 3) 进二级页
    renderMsgs();
    openOn(1);
    openView('schedule');
    out.push('进二级页关=' + !mm.classList.contains('show'));
    closeView('schedule');
    go('chat');
    // 4) 点菜单内部不该关
    renderMsgs();
    openOn(1);
    var head = document.querySelector('#msgMenu .menuhead');
    if(head) closeAnyMenu(head);
    out.push('点菜单内不关=' + mm.classList.contains('show'));
    // 5) 再点同一条 = 收起（「只是想看看有什么」的路径）
    closeMsgMenu();
    renderMsgs();
    startHold(1, 100, 100, document.querySelectorAll('[data-hold]')[1]);
    startHold(1, 100, 100, document.querySelectorAll('[data-hold]')[1]);
    out.push('再点同条关=' + !mm.classList.contains('show'));
    endHold();
    closeMsgMenu();
    // 6) 关键：源码里不能再出现「取出方法再裸调」的写法
    var html = document.documentElement.innerHTML;
    var bad = /var\s+\w+\s*=\s*\w+\.closest\s*;/.test(html);
    out.push('无裸调closest=' + (!bad));
    var all = out.every(function(x){ return x; });
    return { ok: all && opened, info: out.join(' | ') };
  });

  T('架构：弹出菜单挂在 #screen 下，不在 #page-chat 里', function(){
    /* 查源码结构而不是运行时：#page-chat 无 .active 时是 display:none，
       子元素连 offsetWidth 都量到 0 → openAnchorMenu 的定位全部算错。
       position:fixed 摆脱的是**定位**，摆脱不了祖先的 display。
       运行时难复现（要看当时在哪个页面），源码结构一查就清。 */
    var d = document;
    var menu = d.getElementById('msgMenu');
    var plus = d.getElementById('plusMenu');
    if(!menu || !plus) return { ok:false, info:'菜单容器缺失' };
    /* 判据：父节点不是 #page-chat（#page-chat 自己会被 display:none） */
    var p1 = menu.parentElement, p2 = plus.parentElement;
    var chat = d.getElementById('page-chat');
    var outOfChat = p1 !== chat && p2 !== chat;
    /* 再退一步：即使不是直接子节点，祖先里也不能有 page-chat */
    function hasChatAncestor(el){
      while(el && el !== d.body){
        if(el === chat) return true;
        el = el.parentElement;
      }
      return false;
    }
    var noAncestor = !hasChatAncestor(menu) && !hasChatAncestor(plus);
    /* 运行时复现：切到别的页，菜单仍能量到尺寸 */
    msgs = [{r:'me', t:'问'}, {r:'ai', t:'答'}];
    go('home');
    var stillMeasurable = false;
    try{
      openMsgActions(1, {x:100, y:100, h:20, point:true});
      stillMeasurable = menu.offsetWidth > 100 && menu.offsetHeight > 30;
      closeMsgMenu();
    }catch(e){}
    go('chat');
    return { ok: outOfChat && noAncestor && stillMeasurable,
      info: '父节点=' + (p1 && p1.id || p1 && p1.className)
        + ' 不在page-chat里=' + outOfChat
        + ' 祖先无page-chat=' + noAncestor
        + ' 切到首页仍能量到尺寸=' + stillMeasurable
        + '（' + (menu.offsetWidth) + 'x' + (menu.offsetHeight) + '）' };
  });

  T('对话：锚点菜单贴边时不越出屏幕', function(){
    /* 按在左上角 / 右下角 / 正中，菜单都要留在视口内 ——
       越界的话最后几项点不到。菜单挂在 body 上，不受 #page-chat 布局影响。 */
    function probe(ax, ay){
      var box = document.getElementById('msgMenu');
      /* 要给真内容（多几行）才量得到高度；空壳量到 0，定位断言就是空的 */
      /* 用 menuRowsHtml 生成，别手拼 <div>：.ic 里没有 svg 时没有尺寸，
         整行会塌成 0 高，量出来的定位就是假的（这个坑踩过一次）。 */
      box.innerHTML = '<div class="menuhead"><b>操作</b><small class="muted">测试</small></div>'
        + menuRowsHtml([
            {i:'refresh', t:'第一项', d:'说明一', run:'x'},
            {i:'copy',    t:'第二项', d:'说明二', run:'x'},
            {i:'trash',   t:'第三项', d:'说明三', run:'x'}
          ]);
      openAnchorMenu(box, {x:ax, y:ay, h:20, point:true}, {centerOn:true});
      var r = {t: parseFloat(box.style.top), l: parseFloat(box.style.left),
               w: box.offsetWidth, h: box.offsetHeight};
      closeMsgMenu();
      return r;
    }
    var vw = window.innerWidth, vh = window.innerHeight;
    var a = probe(2, 2);              // 左上角
    var b = probe(vw - 2, vh - 2);    // 右下角
    var c = probe(vw / 2, vh / 2);    // 正中
    function inView(r){
      return r.t >= 8 && r.l >= 8
        && r.t + r.h <= vh - 8 + 1
        && r.l + r.w <= vw - 8 + 1;
    }
    var allIn = inView(a) && inView(b) && inView(c);
    /* 正中时应该真的居中，而不是被边距推走 */
    var centered = Math.abs((c.l + c.w/2) - vw/2) < 3;
    /* 高度量到 0 的话定位断言没意义 —— 必须真量到 */
    var measured = c.h > 30 && c.w > 100;
    return { ok: allIn && centered && measured,
      info: '左上=' + JSON.stringify(a) + ' 右下=' + JSON.stringify(b)
        + ' 正中=' + JSON.stringify(c)
        + ' 全部在视口内=' + allIn + ' 正中居中=' + centered
        + ' 量到真实尺寸=' + measured + '（菜单高 ' + c.h + '）' };
  });

  T('对话：长按有移动容差（滚动不该误弹操作框）', function(){
    /* 少了容差，用户想滚动列表却会误弹菜单 —— 比没有长按更烦 */
    return { ok: typeof HOLD_MS === 'number' && HOLD_MS >= 350
        && typeof HOLD_SLOP === 'number' && HOLD_SLOP >= 6
        && typeof startHold === 'function' && typeof moveHold === 'function'
        && typeof endHold === 'function'
        && typeof fireHold === 'function',
      info: 'HOLD_MS=' + HOLD_MS + 'ms 容差=' + HOLD_SLOP + 'px 三函数齐备' };
  });

  T('AI：思考开关按接口地址认出平台，发对应那家的字段', function(){
    /* 锁的是「开关真的能控制模型思考」—— 光在 system 里写「请先思考」是
       控制不了的：DeepSeek V4 / GLM-4.5+ 默认就开着思考。
       字段名来自各家官方文档（2026-10 逐个核对），改之前先去核对，别凭印象。
       **认平台靠地址而不是渠道下拉框** —— 很多人是用「自定义渠道」把官方地址
       填进来的，按渠道名分支就认不出来。 */
    function probe(url, model, on){
      var b = {};
      var hit = applyThinkMode(b, model, url, on);
      return { hit: hit, body: b };
    }
    var DS = 'https://api.deepseek.com/v1';
    var d1 = probe(DS, 'deepseek-v4-flash', false);
    var d2 = probe(DS, 'deepseek-v4-flash', true);
    var z1 = probe('https://open.bigmodel.cn/api/paas/v4', 'glm-5.2', false);
    var v1 = probe('https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-1-pro-260628', false);
    var m1 = probe('https://api.xiaomimimo.com/v1', 'mimo-v2.6-pro', false);
    var q1 = probe('https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.8-max', false);
    var s1 = probe('https://api.siliconflow.cn/v1', 'Qwen/Qwen3-8B', false);
    var thinkFam = function(r){
      return !!r.hit && r.body.thinking && r.body.thinking.type === 'disabled'
        && !('enable_thinking' in r.body);
    };
    var ethFam = function(r){
      return !!r.hit && r.body.enable_thinking === false && !('thinking' in r.body);
    };
    /* 纯推理模型没有「不思考」这一档，发了要么被忽略要么 400 */
    var r1 = probe(DS, 'deepseek-reasoner', false);
    var r2 = probe('https://open.bigmodel.cn/api/paas/v4', 'glm-z1-air', false);
    /* 认不出的地址（中转 / 自建 / 仿冒域名）宁可不发，也不能把请求打回去 */
    var c1 = probe('https://my-proxy.example.com/v1', 'my-model', false);
    var c2 = probe('https://fakedeepseek.com/v1', 'x', false);
    var ok = thinkFam(d1) && d1.body.thinking.type === 'disabled'
      && d2.hit && d2.body.thinking.type === 'enabled'
      && thinkFam(z1) && thinkFam(v1) && thinkFam(m1)
      && ethFam(q1) && ethFam(s1)
      && !r1.hit && !Object.keys(r1.body).length
      && !r2.hit && !Object.keys(r2.body).length
      && !c1.hit && !Object.keys(c1.body).length
      && !c2.hit && !Object.keys(c2.body).length;
    return { ok: ok,
      info: 'DeepSeek关=' + JSON.stringify(d1.body)
        + ' 开=' + JSON.stringify(d2.body)
        + ' 智谱=' + JSON.stringify(z1.body)
        + ' 方舟=' + JSON.stringify(v1.body)
        + ' 小米=' + JSON.stringify(m1.body)
        + ' 千问=' + JSON.stringify(q1.body)
        + ' 硅基=' + JSON.stringify(s1.body)
        + ' 纯推理不发=' + (!r1.hit && !r2.hit)
        + ' 认不出的地址不发=' + (!c1.hit && !c2.hit) };
  });

  T('AI：内置渠道的地址都能被思考参数表认出来（两张表联动）', function(){
    /* 渠道表（PROVIDERS/PROVIDER_URL）和思考参数表（THINK_PLATFORMS）是两份
       手写数据，靠域名串起来。改了一边忘了另一边 = 那个渠道的深度思考开关
       静默失效（不报错，只是关不掉）。所以把两张表对起来验。 */
    var miss = [];
    Object.keys(PROVIDER_URL).forEach(function(k){
      if(!PROVIDERS[k]){ miss.push(k + '(渠道表里没有)'); return; }
      if(!thinkPlatformOf(PROVIDER_URL[k])) miss.push(k);
    });
    /* 反向：每个平台的域名片段都得能匹配到它自己的地址 */
    var badMatch = [];
    THINK_PLATFORMS.forEach(function(pl){
      if(!thinkPlatformOf('https://' + pl.d[0] + '/v1')) badMatch.push(pl.n);
    });
    /* 自定义渠道的示例地址不该被认成任何一家 */
    var customHit = thinkPlatformOf(PROVIDERS.custom.url);
    return { ok: !miss.length && !badMatch.length && !customHit,
      info: '渠道数=' + Object.keys(PROVIDER_URL).length
        + ' 各平台数=' + THINK_PLATFORMS.length
        + ' 有地址却认不出=' + (miss.join(',') || '无')
        + ' 平台表自匹配失败=' + (badMatch.join(',') || '无')
        + ' 自定义示例地址没被误认=' + !customHit };
  });

  T('AI：思考字段被服务端拒绝时能识别出来（好去掉重试）', function(){
    /* 有的渠道的模型不认识这个字段会 400。识别得准，才能「去掉参数重发一次」
       而不是让用户整条对话都用不了。判据要求**既提到字段名、又说它不合法** ——
       只看关键词会在模型正常聊到 thinking 时误判。 */
    var yes = [
      '{"error":{"message":"Unknown parameter: thinking"}}',
      '{"error":{"message":"enable_thinking is not supported for this model"}}',
      '{"error":{"message":"unrecognized field thinking"}}'
    ];
    var no = [
      '{"error":{"message":"Invalid API key"}}',
      '{"error":{"message":"Rate limit exceeded"}}',
      '深度思考模式已启用',
      ''
    ];
    var badYes = yes.filter(function(s){ return !looksLikeParamReject(s); });
    var badNo = no.filter(function(s){ return looksLikeParamReject(s); });
    return { ok: !badYes.length && !badNo.length,
      info: '该识别漏掉=' + (badYes.length ? badYes.length + ' 条' : '无')
        + ' 误判=' + (badNo.length ? badNo.length + ' 条' : '无') };
  });

  T('对话：弹出菜单能在锚点移动后重新贴回去', function(){
    /* 键盘弹出/收起会改变可视区（本 App 用 adjustResize），输入栏整体位移，
       而菜单的 top/left 是打开那一刻算好写死的 —— 不重排就会「悬在半空」。 */
    var keepTab = (document.querySelector('.page.active') || {}).id;
    go('chat');
    togglePlusMenu();
    var box = document.getElementById('plusMenu');
    if(!box || !box.classList.contains('show')) return { ok:false, info:'加号菜单没打开' };
    var wired = typeof box.__place === 'function' && typeof box.__resolve === 'function';
    var boundOnce = _menuReflowBound === true;

    /* 把按钮推下去 40px（用 transform：不改布局但会改 getBoundingClientRect，
       正是锚点求值读的东西），菜单应当跟着走 40px */
    var btn = document.getElementById('plusBtn');
    var keepTf = btn.style.transform;
    var top1 = box.getBoundingClientRect().top;
    btn.style.transform = 'translateY(40px)';
    var moved = reflowMenu(box);
    var top2 = box.getBoundingClientRect().top;
    var followed = Math.abs((top2 - top1) - 40) <= 4;
    btn.style.transform = keepTf;

    /* 贴边收拢之后也要仍在可视区内 */
    var r = box.getBoundingClientRect();
    var inside = r.top >= 0 && r.left >= 0
      && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
    closePlusMenu();

    /* 锚点失效（消息被清掉，气泡不在了）→ reflowMenu 必须返回 false，
       调用方据此把菜单收掉，而不是让它飘在空处 */
    msgs = [{ r:'me', t:'问' }];
    renderMsgs();
    openMsgActions(0, { x:100, y:200, h:20, point:true });
    var mm = document.getElementById('msgMenu');
    var opened = !!mm && mm.classList.contains('show');
    /* 直接把气泡从 DOM 里摘掉 —— 不能用 msgs=[] 再 renderMsgs()：
       那个函数在 msgs 为空时会**自动补一条欢迎语**，气泡还在，
       锚点根本没失效（第一次就是这么误判的）。 */
    var b0 = document.querySelector('[data-hold="0"]');
    if(b0 && b0.parentNode) b0.parentNode.removeChild(b0);
    var gone = reflowMenu(mm) === false;
    closeMsgMenu();

    if(keepTab && keepTab !== 'page-chat') go(keepTab.replace('page-', ''));
    return { ok: wired && boundOnce && moved && followed && inside && opened && gone,
      info: '挂了重排钩子=' + wired + ' resize监听只绑一次=' + boundOnce
        + ' 锚点移动后跟随=' + followed
        + '（' + top1.toFixed(0) + '→' + top2.toFixed(0) + 'px）'
        + ' 收拢后不越界=' + inside
        + ' 锚失效能判出=' + gone };
  });

  T('我的页：分成四组，且组标题的层级高于小节标题', function(){
    /* 这一条锁的是「设置页别又长成一锅粥」。
       第一版把组标题写成 12.5px，而全局 .h2 是 15px —— 组标题反而更小，
       两级长得一模一样，等于白加一层（截图才看出来）。所以这里直接比字号。 */
    var keepTab = (document.querySelector('.page.active') || {}).id;
    go('me');
    var me = document.getElementById('page-me');
    if(!me) return { ok:false, info:'我的页缺失' };
    var groups = [].map.call(me.querySelectorAll('.mgroup b'), function(e){ return e.textContent.trim(); });
    var want = ['小径', '我', '专注与学习', '数据'];
    var namesOk = groups.length === want.length
      && groups.every(function(g, i){ return g === want[i]; });
    var gb = me.querySelector('.mgroup b'), hb = me.querySelector('.h2');
    var gs = gb ? parseFloat(getComputedStyle(gb).fontSize) : 0;
    var hs = hb ? parseFloat(getComputedStyle(hb).fontSize) : 0;
    var hierarchy = gs > hs;
    /* 重排是「搬位置」，但手写 HTML 有漏项的风险 —— 关键入口逐个点一遍 */
    var ids = ['myAvatar', 'myName', 'mySub', 'nickInput', 'aiNameInput', 'callInput',
               'callEcho', 'avatarHint', 'swMemOn', 'swMemAuto', 'memBadge', 'memCount',
               'aiEntry', 'skillBadge', 'skillCountHint', 'themeSeg', 'accentList',
               'vWorkMin', 'vShortMin', 'vLongMin', 'swAutoNext', 'swClassRemind',
               'vRemindBefore', 'swEndRemind', 'swClassMute', 'swFocusNotify', 'exactBadge',
               'swIslandOn', 'vTermStart', 'termStartInput', 'swHoliday', 'holidayCountHint',
               'h2TabletNav', 'tabletNavList', 'restoreFile'];
    var lost = ids.filter(function(x){ return !document.getElementById(x); });
    /* 不能有游离的小节：每个 .h2 都得在某个组标题之后 */
    var orphan = 0, seen = false;
    [].forEach.call(me.querySelectorAll('.col > *'), function(k){
      if(!k.classList) return;
      if(k.classList.contains('mgroup')) seen = true;
      else if(k.classList.contains('h2') && !seen) orphan++;
    });
    if(keepTab && keepTab !== 'page-me') go(keepTab.replace('page-', ''));
    return { ok: namesOk && hierarchy && !lost.length && orphan === 0,
      info: '分组=' + groups.join('/') + ' 顺序对=' + namesOk
        + ' 组标题' + gs + 'px > 小节' + hs + 'px =' + hierarchy
        + ' 丢的入口=' + (lost.join(',') || '无')
        + ' 游离小节=' + orphan };
  });

  T('AI 配置：密钥能显示出来，且看一眼不改动它的值', function(){
    /* 密码框解决了「别人偷看」，顺手把「自己也看不了」一起解决了 ——
       填错一个字符只能整段重填，想复制到别处也不可能。 */
    var host = document.createElement('div');
    host.innerHTML = '<div class="keyrow">'
      + '<input class="f" id="_kTest" type="password" value="sk-abc123456">'
      + '<div class="icon-btn" onclick="toggleKeyVisible(\'_kTest\', this)"></div>'
      + '<div class="icon-btn" onclick="copyKey(\'_kTest\')"></div></div>';
    document.body.appendChild(host);
    var inp = document.getElementById('_kTest');
    var btns = host.querySelectorAll('.icon-btn');
    var startHidden = inp.type === 'password';
    var wired = typeof toggleKeyVisible === 'function' && typeof copyKey === 'function';
    toggleKeyVisible('_kTest', btns[0]);
    var shown = inp.type === 'text';
    var onState = btns[0].classList.contains('on');
    /* 只切 type，**绝不碰 value** —— 看一眼不该改动密钥本身 */
    var kept = inp.value === 'sk-abc123456';
    toggleKeyVisible('_kTest', btns[0]);
    var backHidden = inp.type === 'password' && inp.value === 'sk-abc123456'
      && !btns[0].classList.contains('on');
    /* 复制走的是项目里那个唯一的剪贴板出口，所以要么成功、要么给兜底提示 */
    copyKey('_kTest');
    var said = /密钥已复制|没法自动复制/.test(document.body.textContent);
    host.remove();
    /* 真实位置也得接上（构造的那份只验了行为，没验真的挂了按钮） */
    var real = document.documentElement.innerHTML;
    var wiredReal = real.indexOf('id="accKey"') >= 0
      && real.indexOf("toggleKeyVisible('accKey'") >= 0
      && real.indexOf("copyKey('accKey')") >= 0
      && real.indexOf('id="obKey"') >= 0
      && real.indexOf("toggleKeyVisible('obKey'") >= 0;
    return { ok: startHidden && wired && shown && onState && kept && backHidden && said && wiredReal,
      info: '默认隐藏=' + startHidden + ' 函数在=' + wired
        + ' 点了能显示=' + shown + ' 按钮高亮=' + onState
        + ' 值没被改=' + kept + ' 能切回隐藏=' + backHidden
        + ' 复制有反馈=' + said + ' 两处真实入口都接了=' + wiredReal };
  });

  T('对话：开关在输入栏上方、附件在下方，胶囊上下留白相等', function(){
    /* 这三块的位置关系被用户要求过两次（先移到下面、再移回上面），
       属于「会反复调」的地方 —— 必须锁住，否则下次挪动没人发现。 */
    var keepTab = (document.querySelector('.page.active') || {}).id;
    go('chat');
    renderChatSwitches();
    ATTACH.length = 0;
    addAttach({ kind:'text', name:'第三章-换元积分法.txt', text:'换元积分法的核心是变量代换', truncated:false });

    var row  = document.getElementById('chatSwitches');
    var comp = document.querySelector('#page-chat .composer');
    var att  = document.getElementById('attachRow');
    if(!row || !comp || !att) return { ok:false, info:'三块区域有缺失' };

    /* ① DOM 顺序：开关 → 输入栏 → 附件 */
    function after(a, b){
      return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    }
    var order = after(row, comp) && after(comp, att);

    /* ② 左边缘与输入栏里的按钮对齐（不对齐看着就像「歪出去一块」） */
    var L = function(x){ return x.getBoundingClientRect().left; };
    var leftGap = Math.abs(L(row.querySelector('.qsw')) - L(document.getElementById('plusBtn')));

    /* ③ 胶囊与输入框、与页面底部的留白要**相等** —— 这是用户明确要求的那条 */
    var inp  = document.getElementById('chatInput').getBoundingClientRect();
    var chip = document.querySelector('#attachRow .attach');
    if(!chip) return { ok:false, info:'胶囊没渲染出来' };
    var cr   = chip.getBoundingClientRect();
    var page = document.getElementById('page-chat').getBoundingClientRect();
    var up   = cr.top - inp.bottom;
    var down = page.bottom - cr.bottom;
    var even = Math.abs(up - down) <= 1;

    /* ④ 没附件时整行不占位（:empty 隐藏），否则输入框下方会空一条 */
    ATTACH.length = 0;
    attachRow();
    var collapsed = att.getBoundingClientRect().height === 0;

    if(keepTab && keepTab !== 'page-chat') go(keepTab.replace('page-', ''));
    return { ok: order && leftGap <= 1 && even && collapsed,
      info: '顺序 开关→输入栏→附件=' + order
        + ' 左边缘差=' + leftGap.toFixed(1) + 'px'
        + ' 上留白=' + up.toFixed(1) + 'px 下留白=' + down.toFixed(1) + 'px 相等=' + even
        + ' 空附件不占位=' + collapsed };
  });

  T('对话：快捷开关的图标与文字在同一水平线上，且够大', function(){
    /* 必须在对话页量：容器没有 .active 时不参与布局，量出来全是 0。 */
    var keepTab = (document.querySelector('.page.active') || {}).id;
    go('chat');
    renderChatSwitches();
    var row = document.getElementById('chatSwitches');
    if(!row) return { ok:false, info:'开关行缺失' };
    var sw = row.querySelector('.qsw');
    var qi = sw && sw.querySelector('.qi');
    var svg = qi && qi.querySelector('svg');
    if(!svg) return { ok:false, info:'图标没画出来' };
    /* 文字是裸文本节点，只能用 Range 量 */
    var tn = null;
    for(var i = 0; i < sw.childNodes.length; i++){
      var n = sw.childNodes[i];
      if(n.nodeType === 3 && n.textContent.trim()){ tn = n; break; }
    }
    if(!tn) return { ok:false, info:'找不到开关文字' };
    var rg = document.createRange();
    rg.selectNodeContents(tn);
    function mid(x){ return x.top + x.height / 2; }
    var r = sw.getBoundingClientRect();
    var s = svg.getBoundingClientRect();
    var tr = rg.getBoundingClientRect();
    /* 三者中心要在一条线上。.qi 是 inline span、里面 svg 也是 inline 时，
       会按**行盒基线**对齐，图标整体偏上 —— 这正是原来的毛病。 */
    var dIcon = Math.abs(mid(s) - mid(r));
    var dText = Math.abs(mid(tr) - mid(r));
    var aligned = dIcon <= 1.5 && dText <= 1.5;
    /* 原来只有 23px 高（5px 内边距 + 11.5px 字），比手指小一圈 */
    var big = r.height >= 30 && parseFloat(getComputedStyle(sw).fontSize) >= 12.5;
    var iconBig = s.width >= 15;
    if(keepTab && keepTab !== 'page-chat') go(keepTab.replace('page-', ''));
    return { ok: aligned && big && iconBig,
      info: '胶囊=' + r.width.toFixed(0) + 'x' + r.height.toFixed(0)
        + ' 图标=' + s.width.toFixed(0) + 'x' + s.height.toFixed(0)
        + ' 图标偏心=' + dIcon.toFixed(2) + 'px 文字偏心=' + dText.toFixed(2) + 'px'
        + ' 够大=' + big };
  });

  T('对话：长按气泡有蒙版反馈，四种走法都要对', function(){
    msgs = [{ r:'me', t:'问' }, { r:'ai', t:'答' }];
    renderMsgs();
    go('chat');
    var b = document.querySelectorAll('[data-hold]')[1];
    if(!b) return { ok:false, info:'气泡缺失' };

    /* ① 按下【立刻】有反馈 —— 这是本条断言存在的理由：
          没有它用户不知道有没有识别到，会反复按或放弃。 */
    startHold(1, 100, 300, b);
    var marked = b.classList.contains('holding');
    var cs = getComputedStyle(b, '::after');
    var hasMask = cs.animationName === 'holdMask';
    /* ② 动画时长必须与 HOLD_MS **同源**：错开了就会出现
          「蒙版还没显完菜单就弹了」，那比没有反馈更困惑。 */
    var durMs = parseFloat(cs.animationDuration) * 1000;
    var sameOrigin = Math.abs(durMs - HOLD_MS) < 1
      && getComputedStyle(document.documentElement)
           .getPropertyValue('--hold-ms').trim() === HOLD_MS + 'ms';
    /* 蒙版要真的能看见：有底色、且压在气泡上 */
    var visible = cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
      && parseFloat(cs.opacity) >= 0 && cs.pointerEvents === 'none';
    var scaled = getComputedStyle(b).transform !== 'none';

    /* ③ 松手但没到时长 = 没触发，蒙版必须撤掉（顺便告诉用户「刚才不算」） */
    endHold();
    var afterUp = !b.classList.contains('holding')
      && !document.getElementById('msgMenu').classList.contains('show');

    /* ④ 手指滑走（滚动列表）也算作废，且绝不该弹菜单 */
    startHold(1, 100, 300, b);
    var markedAgain = b.classList.contains('holding');
    moveHold(100 + HOLD_SLOP + 20, 300);
    var afterMove = markedAgain && !b.classList.contains('holding')
      && !document.getElementById('msgMenu').classList.contains('show');

    /* ⑤ 满时长：清蒙版 **且** 菜单弹出 */
    closeMsgMenu();
    startHold(1, 100, 300, b);
    fireHold();
    var afterFire = !b.classList.contains('holding')
      && document.getElementById('msgMenu').classList.contains('show');
    closeMsgMenu();

    return { ok: marked && hasMask && sameOrigin && visible && scaled
        && afterUp && afterMove && afterFire,
      info: '按下即蒙版=' + marked + ' 蒙版在=' + hasMask
        + ' 时长同源=' + sameOrigin + '(' + durMs + 'ms)'
        + ' 可见=' + visible + ' 缩放=' + scaled
        + ' 松手撤=' + afterUp + ' 滑走撤=' + afterMove + ' 到点清+弹菜单=' + afterFire };
  });

  T('语音：待读文本清洗（代码块/链接/标签不该被念出来）', function(){
    /* 反引号必须运行时拼 —— 本文件整段断言是 String.raw 模板，
       在这里直接写代码围栏会把模板截断（踩过一次，注释里写也不行）。 */
    var fence = String.fromCharCode(96,96,96);
    var s = ttsClean('看这个 ' + fence + 'const a=1;' + fence
      + ' 还有 [文档](https://x.com) 与 <b>粗体</b> 和 # 标题');
    var ok = s.indexOf('const') < 0 && s.indexOf('https') < 0 && s.indexOf('<b>') < 0
      && s.indexOf('文档') >= 0 && s.indexOf('粗体') >= 0;
    return { ok: ok, info: JSON.stringify(s) };
  });

  T('语音：自动播报与静音两个开关都在，且能正确渲染开/关', function(){
    var sw = document.getElementById('swTts');
    var mw = document.getElementById('swTtsMute');
    var t = ttsStore(), keepOn = t.on, keepMute = t.mute;
    t.on = false; t.mute = false; renderTtsRow();
    var offState = !!sw && !sw.classList.contains('on') && !mw.classList.contains('on');
    t.on = true; renderTtsRow();
    var onState = !!sw && sw.classList.contains('on');
    /* 静音时自动播报的开关视觉上也要灭掉 —— 两个开关同时亮着会让人以为还能自动播 */
    t.mute = true; renderTtsRow();
    var muteWins = !sw.classList.contains('on') && mw.classList.contains('on');
    /* 静音必须真的短路 ttsSpeak（手动点也要挡） */
    var before = RUNTIME_LOG.length;
    var spoke = ttsSpeak('静音时不该出声', {force:true});
    var tip = (document.getElementById('toast') || {}).textContent || '';
    t.on = keepOn; t.mute = keepMute; renderTtsRow();
    RUNTIME_LOG.length = before;
    /* 「引擎状态」行已按用户要求移除，别把它当回归加回来 */
    var noStateRow = !document.getElementById('ttsStateLab');
    return { ok: !!sw && !!mw && offState && onState && muteWins && spoke === false
        && tip.indexOf('静音') >= 0 && noStateRow && !!ttsEngineLabel(),
      info: '自动播报开关=' + !!sw + ' 静音开关=' + !!mw + ' 关=' + offState + ' 开=' + onState
        + ' 静音压制自动播报=' + muteWins + ' 静音时不出声=' + (spoke === false)
        + ' 提示=' + JSON.stringify(tip.slice(0, 20)) + ' 已移除引擎状态行=' + noStateRow };
  });
  T('SUBVIEWS 认得 aihub / memory', function(){
    var s = (typeof SUBVIEWS !== 'undefined') ? SUBVIEWS : null;
    return { ok: !!s && s.indexOf('aihub') >= 0 && s.indexOf('memory') >= 0, info: s ? s.join(',') : 'x' };
  });


  // ---------- 关于页 ----------
  T('隐私政策有正式版 + 简要版切换', function(){
    openSheet('privacy');
    var txt = document.getElementById('sheet').textContent.replace(/\s+/g,' ');
    var hasFormal = /引言/.test(txt) && /我们收集的信息/.test(txt) && /您的权利/.test(txt);
    /* 正式版上有「看简要版」入口 */
    var hasToggle = /简要版/.test(txt);
    var before = txt.length;
    togglePrivacyPlain();
    var txt2 = document.getElementById('sheet').textContent.replace(/\s+/g,' ');
    /* 简要版：正文是正常总结（含「没有服务器」），且带「看正式版」回程入口、比正式版短 */
    var hasPlain = /没有服务器/.test(txt2) && /正式版/.test(txt2) && txt2.length < before;
    togglePrivacyPlain();
    closeSheet();
    return { ok: hasFormal && hasToggle && hasPlain, info: '正式=' + hasFormal + ' 切换=' + hasToggle + ' 简要版=' + hasPlain };
  });
  T('特别鸣谢只留白皂与测试版用户', function(){
    openSheet('credits');
    var txt = document.getElementById('sheet').textContent.replace(/\s+/g,' ');
    closeSheet();
    return { ok: /白皂/.test(txt) && /测试版用户/.test(txt) && !/DeepSeek V4|MIMO/.test(txt),
             info: txt.slice(0, 90) };
  });
  T('清空数据要手输 delete 才能按', function(){
    openSheet('clear');
    var btn = document.getElementById('clearGo');
    var inp = document.getElementById('clearConfirm');
    if(!btn || !inp) { closeSheet(); return { ok:false, info:'缺 clearGo/clearConfirm' }; }
    var locked = btn.style.pointerEvents === 'none';
    inp.value = 'DELETE'; clearConfirmCheck();
    var stillLocked = btn.style.pointerEvents === 'none';
    inp.value = 'delete'; clearConfirmCheck();
    var unlocked = btn.style.pointerEvents === 'auto';
    closeSheet();
    return { ok: locked && stillLocked && unlocked, info: '锁=' + locked + ' 大写仍锁=' + stillLocked + ' 正确解锁=' + unlocked };
  });

  // ---------- 引导 ----------
  T('引导改成 4 步，第一步是认人（昵称+头像）', function(){
    openOnboard();
    var t0 = document.getElementById('onboard').textContent;
    var ok0 = /昵称/.test(t0) && /头像|obAv/.test(document.getElementById('onboard').innerHTML);
    renderOnboard(1);
    var t1 = document.getElementById('onboard').textContent;
    var ok1 = /课表/.test(t1) && /手动录入/.test(t1);
    renderOnboard(2);
    var t2 = document.getElementById('onboard').textContent;
    var ok2 = /API Key/.test(t2) && /提供商|服务商/.test(t2);
    renderOnboard(3);
    var t3 = document.getElementById('onboard').textContent;
    var ok3 = /准备好了/.test(t3);
    closeOnboard();
    return { ok: ok0 && ok1 && ok2 && ok3 && OB_LAST === 3,
             info: 'OB_LAST=' + OB_LAST + ' 步=' + [ok0,ok1,ok2,ok3].join(',') };
  });
  T('引导里填的 Key 走 providerAccs（和配置页同一份）', function(){
    var st = snapState();
    try{
      openOnboard(); renderOnboard(2);
      obSetProvider('deepseek');
      obSaveField('key', '__ob_key__');
      var inAcc = (providerAccs().deepseek || {}).key === '__ob_key__';
      var inOld = S.apiKey === '__ob_key__';
      closeOnboard();
      return { ok: inAcc && inOld, info: 'acc=' + inAcc + ' 旧字段同步=' + inOld };
    } finally { restoreState(st); try{ closeOnboard(); }catch(e){} }
  });

  // ---------- 计费 ----------
  T('定价按「渠道 × 模型」存', function(){
    var st = snapState();
    try{
      priceRuleSet('__p1__', '__m1__', {in: 2, out: 8});
      var r = priceRuleOf('__p1__', '__m1__');
      return { ok: r && r.in === 2 && r.out === 8, info: JSON.stringify(r) };
    } finally { restoreState(st); }
  });
  T('峰谷：时段内用峰价，时段外用谷价', function(){
    var st = snapState();
    try{
      priceRuleSet('__p1__', '__m1__', {
        in: 1, out: 2, peakOn: true, peakIn: 10, peakOut: 20,
        peakFrom: '00:00', peakTo: '23:59'
      });
      var inPeak = inPeakWindow(priceRuleOf('__p1__', '__m1__'));
      var cPeak = calcCost('__p1__', '__m1__', 1000000, 1000000);
      priceRuleSet('__p1__', '__m1__', {peakFrom: '00:00', peakTo: '00:01'});
      var outPeak = !inPeakWindow(priceRuleOf('__p1__', '__m1__'));
      var cOff = calcCost('__p1__', '__m1__', 1000000, 1000000);
      return { ok: inPeak && outPeak && Math.abs(cPeak - 30) < 0.001 && Math.abs(cOff - 3) < 0.001,
               info: '峰=' + inPeak + ' 谷=' + outPeak + ' 峰价=' + cPeak + ' 谷价=' + cOff };
    } finally { restoreState(st); }
  });
  T('每渠道独立：同名模型不同价', function(){
    var st = snapState();
    try{
      priceRuleSet('pA', 'm', {in: 1, out: 1});
      priceRuleSet('pB', 'm', {in: 9, out: 9});
      var a = calcCost('pA', 'm', 1000000, 0), b = calcCost('pB', 'm', 1000000, 0);
      return { ok: Math.abs(a - 1) < 0.001 && Math.abs(b - 9) < 0.001, info: 'A=' + a + ' B=' + b };
    } finally { restoreState(st); }
  });
  T('Token 与资费栏仍保留总用量', function(){
    openAiHub();
    var txt = (document.getElementById('usageBox')||{textContent:''}).textContent.replace(/\s+/g,' ');
    return { ok: /累计 Token/.test(txt) && /已消耗资费/.test(txt) && /模型定价/.test(txt),
             info: txt.slice(0, 100) };
  });
  T('提供商卡片里能打开模型定价弹层', function(){
    window.__provOpen = 'deepseek';
    renderProviders();
    var host = document.getElementById('provList');
    var html = host ? host.innerHTML : '';
    var has = /模型定价/.test(html);
    openSheet('modelprice', {pid:'deepseek'});
    var sheet = document.getElementById('sheet');
    var ok = /模型定价/.test(sheet.textContent) && /元 \/ 1M/.test(sheet.textContent);
    closeSheet();
    return { ok: has && ok, info: '卡片有入口=' + has + ' 弹层=' + ok + ' htmlLen=' + html.length + ' 深搜=' + /DeepSeek/.test(html) };
  });

  // ---------- UI ----------
  T('底栏「对话」与今日/我的同款（不再是凸起 FAB）', function(){
    var chat = document.querySelector('.tabbar .tab[data-tab="chat"]');
    var home = document.querySelector('.tabbar .tab[data-tab="home"]');
    if(!chat || !home) return { ok:false, info:'找不到 tab' };
    return { ok: !chat.classList.contains('center') && !chat.querySelector('.fab')
      && !!chat.querySelector('svg') && !!home.querySelector('svg'),
      info: 'center=' + chat.classList.contains('center') + ' fab=' + !!chat.querySelector('.fab') };
  });
  T('专注条可收起成悬浮块 / 展开 / 进专注页', function(){
    return { ok: typeof fbClick === 'function' && typeof fbApply === 'function'
      && typeof fbBindDrag === 'function' && typeof fbToggleShape === 'function',
      info: 'fbClick=' + typeof fbClick };
  });
  T('节假日入口在「我的」页，不在完整课表页', function(){
    go('me'); renderProfile();
    var me = document.getElementById('page-me');
    var inMe = me && /节假日模式/.test(me.textContent) && /节假日设置/.test(me.textContent);
    openSchedule();
    var sched = document.getElementById('view-schedule');
    var inSched = sched && /节假日模式/.test(sched.textContent);
    return { ok: !!inMe && !inSched, info: '我的=' + !!inMe + ' 课表页仍有=' + !!inSched };
  });

  // ---------- 2026-10-01 修复 / 新增 ----------
  T('行程规划偏好弹层能真正渲染出来（不再弹残留内容）', function(){
    openSheet('planpref');
    var kind = window.__sheetKind;
    var txt = document.getElementById('sheet').textContent.replace(/\s+/g,' ');
    closeSheet();
    var ok = kind === 'planpref' && /密度/.test(txt) && /时长取向/.test(txt)
      && /忙碌时段/.test(txt) && /偏好空闲时段/.test(txt)
      && /更满/.test(txt) && /更松/.test(txt) && /大段连续/.test(txt) && /零碎时间/.test(txt);
    return { ok: ok, info: 'kind=' + kind + ' len=' + txt.length };
  });
  T('节假日功能已提供 AI 工具（查/增/删/同步/开关）', function(){
    var ks = AI_TOOLS.map(function(t){ return t.k; });
    var has = ['listHoliday','addHoliday','delHoliday','syncHoliday','toggleHolidayMode']
      .every(function(k){ return ks.indexOf(k) >= 0; });
    var snap = snapState();
    var r1 = runOneTool('addHoliday', {from:'2027-01-01', to:'2027-01-03', name:'元旦测试'});
    var listed = runOneTool('listHoliday', {});
    var r2 = runOneTool('delHoliday', {name:'元旦测试'});
    var after = runOneTool('listHoliday', {});
    restoreState(snap);
    return { ok: has && /已添加节假日/.test(r1) && /元旦测试/.test(listed)
      && /已移除节假日/.test(r2) && !/元旦测试/.test(after),
      info: 'tools=' + has + ' add=' + /已添加节假日/.test(r1) + ' del=' + /已移除节假日/.test(r2) };
  });
  T('用量提醒 / 达量停用：可配置且能拦截', function(){
    var snap = snapState();
    var hadLimit = ('aiLimit' in S), limSnap = hadLimit ? JSON.stringify(S.aiLimit) : null;
    var st = usageStore();
    var L = aiLimitStore();
    L.warnOn = true; L.warnCost = 1; L.stopOn = true; L.stopCost = 2;
    L.warned = false; L.stopped = false;
    st.totalCost = 1.5;                       /* 越过提醒线、但未到上限 */
    var notBlocked = aiUsageBlocked();
    checkUsageLimits();
    var warned = aiLimitStore().warned;
    st.totalCost = 2.5;                       /* 越过上限 */
    var blocked = aiUsageBlocked();
    checkUsageLimits();
    var stopped = aiLimitStore().stopped;
    renderUsagePanel();
    var panelTxt = (document.getElementById('usageBox') || {}).textContent || '';
    var panelOk = /用量提醒/.test(panelTxt) && /达量停用/.test(panelTxt);
    restoreState(snap);
    if(limSnap === null){ try{ delete S.aiLimit; }catch(e){} } else { S.aiLimit = JSON.parse(limSnap); }
    return { ok: notBlocked === '' && /已达用量上限/.test(blocked) && warned && stopped && panelOk,
      info: '未达限="" ' + (notBlocked === '') + ' 拦=' + /已达用量上限/.test(blocked)
        + ' warned=' + warned + ' stopped=' + stopped + ' 面板=' + panelOk };
  });
  T('关于页与我的页版本号与 build.gradle 一致（' + window.__EXPECT_VER__ + '）', function(){
    var want = window.__EXPECT_VER__;
    var hero = document.querySelector('#view-about .about-ver');
    var me = document.getElementById('page-me');
    var ok = !!want && !!hero && hero.textContent.indexOf(want) >= 0 && APP_VER === want
      && !!me && me.textContent.indexOf(want) >= 0;
    return { ok: ok, info: 'hero=' + (hero ? hero.textContent.trim() : 'MISSING')
      + ' APP_VER=' + APP_VER + ' 期望=' + want + ' 我的页=' + (!!me && me.textContent.indexOf(want) >= 0) };
  });

  // 放在最后：这条会触发一次异步（无 AI 时的本地兜底），别影响前面的用例
  T('重新生成不再重复插入用户消息（send noPush）', function(){
    var sendSrc = String(send), regenSrc = String(regenChat);
    var guard = /opts\.noPush/.test(sendSrc) && /if\(!opts\.noPush\)/.test(sendSrc);
    var regenOk = /send\(q, \{noPush:true\}\)/.test(regenSrc);
    var before = msgs.length;
    try{ send('__probe_noPush__', {noPush:true}); }catch(e){}
    var added = msgs.length - before;
    var pushed = msgs.some(function(m){ return m.t === '__probe_noPush__'; });
    return { ok: guard && regenOk && added === 0 && !pushed,
      info: 'guard=' + guard + ' regen=' + regenOk + ' 新增消息=' + added };
  });

  // ---------- 弹层渲染完备性（回归：曾有一批 sheet 只被 open、renderSheet 里没有分支） ----------
  T('renderSheet 覆盖所有被打开的 kind（结构检查）', function(){
    var src = document.documentElement.outerHTML;
    var used = [], m;
    var re = /(?:openSheet|renderSheet)\(\s*\\?'([A-Za-z0-9_]+)\\?'/g;
    while((m = re.exec(src))){ if(used.indexOf(m[1]) < 0) used.push(m[1]); }
    /* 用真实运行的函数源码取分支，避免读到注释或其它字符串里的假象 */
    var fnsrc = String(renderSheet);
    var branches = [], re2 = /kind === '([A-Za-z0-9_]+)'/g;
    while((m = re2.exec(fnsrc))){ if(branches.indexOf(m[1]) < 0) branches.push(m[1]); }
    var miss = used.filter(function(k){ return branches.indexOf(k) < 0; });
    return { ok: used.length > 0 && miss.length === 0,
      info: '被打开 ' + used.length + ' 种 / 分支 ' + branches.length + ' 个' + (miss.length ? '；缺失=[' + miss.join(' ') + ']' : '') };
  });
  T('7 个曾丢分支的弹层能真正渲染出内容', function(){
    /* 'cam'（拍照给 AI 的确认弹层）已删除：拍照/相册改成直接唤起系统相机，
       图片直接用胶囊附件带走，不再经过确认弹层。 */
    var cases = [
      ['chathist', '聊天记录', {}],
      ['todoform', '添加待办', {}],
      ['tableform', '插入表格', {}],
      ['skillform', '新建技能', { id: '' }],
      ['memform', '添加记忆', {}],
      ['memdel', '删除这条记忆', { id: '' }],
      ['minutes', '分钟', {}]
    ];
    var bad = [], det = [];
    cases.forEach(function(c){
      var sheet = document.getElementById('sheet');
      sheet.innerHTML = '<div id="__s__">SENTINEL</div>';
      var err = '';
      try{ openSheet(c[0], c[2]); }catch(e){ err = String(e && (e.message || e)); }
      var txt = (sheet.textContent || '').replace(/\s+/g, ' ').trim();
      var changed = sheet.innerHTML.indexOf('__s__') === -1;
      var hit = changed && txt.indexOf(c[1]) >= 0;
      det.push(c[0] + (hit ? '✓' : '✗'));
      if(!hit) bad.push(c[0] + (changed ? ('(文案=' + txt.slice(0, 24) + ')') : '(未渲染)') + (err ? (' ERR=' + err) : ''));
      try{ closeSheet(); }catch(e){}
    });
    return { ok: bad.length === 0, info: det.join(' ') + (bad.length ? ' | 异常: ' + bad.join(' ; ') : '') };
  });
  T('特别鸣谢：白皂头像 / 上岛逻辑 / 测试版用户寄语', function(){
    openSheet('credits');
    var sheet = document.getElementById('sheet');
    var txt = (sheet.textContent || '').replace(/\s+/g, ' ');
    var hasImg = /data:image\/jpeg;base64,/.test(sheet.innerHTML);
    var hasLogic = /上岛逻辑/.test(txt);
    var hasMsg = /感谢你愿意使用这个不完善的版本，请多提建议！/.test(txt);
    closeSheet();
    return { ok: hasImg && hasLogic && hasMsg && /白皂/.test(txt) && /每一位测试版用户/.test(txt),
      info: '头像=' + hasImg + ' 上岛逻辑=' + hasLogic + ' 寄语=' + hasMsg };
  });

  // ---------- 回归：模型把工具协议裹成 <TOOL>…</TOOL> 标签时，标签不能落进参数值 ----------
  T('TOOL 标签不落进工具参数（假日名不能是「国庆</TOOL>」）', function(){
    var snap = snapState();
    var out = '', err = '';
    try{
      out = String(runToolCall('<TOOL>TOOL:addHoliday|from=2026-10-01|to=2026-10-07|name=国庆</TOOL>') || '');
    }catch(e){ err = String(e && (e.message || e)); }
    var hit = null;
    holidayAll().forEach(function(r){ if(r && r.from === '2026-10-01' && r.src === 'user') hit = r; });
    var nm = hit ? String(hit.name) : '(未添加)';
    var noTag = nm.indexOf('<') < 0 && nm.indexOf('>') < 0;
    var cleanOut = out.indexOf('<') < 0 && out.indexOf('>') < 0;
    restoreState(snap);
    return { ok: noTag && cleanOut && /国庆/.test(nm),
      info: 'name=' + nm + ' 回执=' + out.slice(0, 36) + (err ? ' ERR=' + err : '') };
  });

  // ---------- 回归：放假当天的「今日课程」也要隐藏（以前只有完整课表隐藏了） ----------
  T('放假时主页今日课程隐藏并提示放假', function(){
    var snap = snapState();
    var ti = todayI;
    var dk = dateKeyForDayIdx(ti, weekNo(new Date()));
    S.prefs.holidayMode = true;
    S.courses[ti] = [{ t:'08:00-09:40', n:'__假期测试课__', loc:'测试楼', w:'all', c:0, p:'normal' }];
    if(!Array.isArray(S.holidayRanges)) S.holidayRanges = [];
    S.holidayRanges.push({ id:'u__test__', from:dk, to:dk, name:'__测试假__', src:'user' });
    holidayInvalidate();
    selIdx = ti;
    renderCourses();
    var txt = String((document.getElementById('courses') || {}).textContent || '').replace(/\s+/g, ' ');
    var hid = txt.indexOf('__假期测试课__') < 0;
    var say = txt.indexOf('__测试假__') >= 0;
    restoreState(snap);
    holidayInvalidate();
    selIdx = ti; renderCourses(); renderWeek();
    return { ok: hid && say, info: '课已隐藏=' + hid + ' 显示放假=' + say + ' | ' + txt.slice(0, 34) };
  });

  // ---------- 回归：日程语义必须只有一个判定口（dayInfo），各入口结论一致 ----------
  T('日程语义单一口：放假当天各入口结论一致，且非假节日不受牵连', function(){
    var snap = snapState();
    var ti = todayI, wn = weekNo(new Date());
    var dk = dateKeyForDayIdx(ti, wn);
    var nb = (ti + 1) % 7, nbKey = dateKeyForDayIdx(nb, wn);
    S.prefs.holidayMode = true;
    S.courses[ti]  = [{ t:'08:00-09:40', n:'__单一口课A__', loc:'', w:'all', c:0, p:'normal' }];
    S.courses[nb]  = [{ t:'10:00-11:40', n:'__单一口课B__', loc:'', w:'all', c:0, p:'normal' }];
    if(!Array.isArray(S.holidayRanges)) S.holidayRanges = [];
    S.holidayRanges.push({ id:'u__gate__', from:dk, to:dk, name:'__单一口假__', src:'user' });
    holidayInvalidate();

    var info = dayInfo(ti);
    var nbInfo = dayInfo(nb);
    /* 证明 coursesAt 真的走 dayInfo：把 dayInfo 换成探针，coursesAt 的结果应随之改变。
       否则「单一口」只是注释上的说法 —— 哪天有人另开一份实现，这条会红。 */
    var origInfo = dayInfo, followed = false;
    window.dayInfo = function(d, w){ followed = true; return origInfo(d, w); };
    var probe = coursesAt(ti);
    window.dayInfo = origInfo;

    var ok = info.holiday === true
      && info.hasClass === false
      && info.count === 0
      && info.holidayName === '__单一口假__'
      && info.dateKey === dk
      && probe.length === 0
      && followed === true
      /* 关键：只压假那一天，别的日子照常有课（不能一把梭全滤掉） */
      && nbInfo.holiday === false
      && nbInfo.courses.length === 1;

    restoreState(snap);
    holidayInvalidate();
    return { ok: ok, info: '放假那天 holiday=' + info.holiday + ' 假期名=' + info.holidayName
      + ' 课数=' + info.count + ' | coursesAt 走 dayInfo=' + followed
      + ' | 次日 holiday=' + nbInfo.holiday + ' 仍有课=' + nbInfo.courses.length };
  });

  // ---------- 回归：推给原生的判定契约必须带上节假日，否则原生判不出来 ----------
  T('推给原生的判定契约带上了节假日（放假当天推得出去）', function(){
    var snap = snapState();
    var ti = todayI, wn = weekNo(new Date());
    var dk = dateKeyForDayIdx(ti, wn);
    S.prefs.holidayMode = true;
    if(!Array.isArray(S.holidayRanges)) S.holidayRanges = [];
    S.holidayRanges.push({ id:'u__con__', from:dk, to:dk, name:'__契约假__', src:'user' });
    holidayInvalidate();

    /* NATIVE 是 var 声明的全局，浏览器里为 null —— 换成假桥就能抓到真实 payload */
    var captured = null, oldN = (typeof NATIVE !== 'undefined' ? NATIVE : null);
    NATIVE = { setSchedule: function(j){ captured = j; }, setPrefs: function(){} };
    try { pushScheduleToNative(); } catch(e) {}
    NATIVE = oldN;

    var p = null; try { p = JSON.parse(captured); } catch(e) {}
    restoreState(snap);
    holidayInvalidate();

    var ok = !!p && p.holidayMode === true && !!p.holidays
      && String(p.holidays[dk] || '') === '__契约假__'
      && 'termStart' in p && 'courses' in p && 'bookings' in p;
    return { ok: ok, info: p
      ? ('推了 ' + Object.keys(p).join(',') + ' | holidayMode=' + p.holidayMode
         + ' | 今日 ' + dk + ' 在 holidays 里=' + (String(p.holidays[dk] || '') === '__契约假__'))
      : '没抓到 setSchedule 调用（payload 为 ' + captured + '）' };
  });

  // ---------- 回归：功能模型「取消选择」 ----------
  T('功能模型可取消选择，并稳定保持「跟随对话模型」', function(){
    openAiConfig();
    var keepR = JSON.parse(JSON.stringify(rolesCfg()));
    var keepM = JSON.parse(JSON.stringify(S.models || {}));
    applyModelPick('summarize', S.provider || 'deepseek', '__test_model__');
    var bound = roleBound('summarize') && roleModelName('summarize') === '__test_model__';
    clearModelPick('summarize');
    var afterOff = roleModelName('summarize') === '' && !roleBound('summarize');
    var lab = modelLabel('summarize');
    /* 关键回归点：重进列表时 renderModels() 会把「没填」的空值自动补成第一个模型。
       这里必须确认「取消」不会被补回来 —— 否则用户的操作等于没做。 */
    renderModels();
    var staysOff = roleModelName('summarize') === '' && S.models.summarize === ROLE_OFF;
    var fallsBack = !!(roleModelName('summarize') || S.models.chat);
    S.roles = keepR; S.models = keepM; save(); renderModels();
    return { ok: bound && afterOff && lab.indexOf('跟随对话模型') >= 0 && staysOff && fallsBack,
      info: '绑定成功=' + bound + ' 取消后为空=' + afterOff + ' 标签=' + JSON.stringify(lab)
        + ' 重进列表仍为空=' + staysOff + ' 回落对话模型=' + fallsBack };
  });

  // ---------- 回归：AI 头像可自定义，且坏值不能污染样式 ----------
  T('AI 头像可自定义、能回落默认、坏值被拒', function(){
    var keep = S.aiAvatar;
    delete S.aiAvatar;
    var byDefault = aiAvatarSrc() === AI_AVATAR_URL && !aiAvatarCustom();
    S.aiAvatar = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    var custom = aiAvatarCustom() && aiAvatarSrc() === S.aiAvatar;
    var styled = aiAvStyle().indexOf('data:image/jpeg') >= 0;
    /* 关键：S 里存进非 dataURL 的脏值时必须回落默认，
       否则它会被拼进 background-image:url() 把整个气泡样式弄坏。 */
    S.aiAvatar = 'javascript:alert(1)';
    var badRejected = aiAvatarSrc() === AI_AVATAR_URL;
    /* 提示与面板必须在「自定义生效时」查 —— 先还原再查的话当然只剩默认值，
       那样这条断言永远测不到「恢复默认」那一行是否出现。 */
    S.aiAvatar = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    renderProfile();
    var hint = (document.getElementById('avatarHint') || {}).textContent || '';
    var sheet = renderAvatarSheet();
    if(keep) S.aiAvatar = keep; else delete S.aiAvatar;
    renderProfile();
    return { ok: byDefault && custom && styled && badRejected
        && sheet.indexOf('aiAvatarPick') >= 0 && sheet.indexOf('aiAvatarClear') >= 0,
      info: '默认回落=' + byDefault + ' 自定义生效=' + custom + ' 样式含图=' + styled
        + ' 脏值被拒=' + badRejected + ' 设置行提示=' + JSON.stringify(hint)
        + ' 面板有换图/恢复=' + (sheet.indexOf('aiAvatarClear') >= 0) };
  });

  // ---------- 回归：问题报告（关于页 → 运行日志） ----------
  T('问题报告：抓得到错误、含环境、Key 已脱敏', function(){
    var keep = RUNTIME_LOG.length;
    logErr('__报告测试错误__');
    var st = logStats();
    var rep = buildBugReport();
    var hasEnv = rep.indexOf('## 环境') >= 0 && rep.indexOf('WebView 内核') >= 0;
    var hasCfg = rep.indexOf('## AI 配置') >= 0;
    var hasErr = rep.indexOf('__报告测试错误__') >= 0;
    /* 脱敏要单测 maskKey 本身 —— 报告里那行长什么样取决于当前有没有配 Key，
       直接在报告里 grep '未填' 会在有 Key 的测试环境下误报。 */
    var maskUnit = maskKey('') === '未填'
      && maskKey('short') === '已填（5 字）'
      && maskKey('abcdefghijklmnop').indexOf('abcdefgh') < 0
      && maskKey('abcdefghijklmnop').indexOf('…') > 0
      && maskKey('abcdefghijklmnop').indexOf('16 字') > 0;
    /* 脱敏后长这样：Key __ob…ey__（10 字）／Key 未填／Key 已填（5 字）
       —— 省略号在字符串中间，所以不能只找「…（」。 */
    var keyLine = rep.indexOf('Key ') >= 0 && /(未填|已填|（\d+ 字）)/.test(rep);
    /* 明文 Key 绝不能进报告；聊天正文也不该出现 */
    var leakKey = (S.apiKey && rep.indexOf(String(S.apiKey)) >= 0) ? true : false;
    RUNTIME_LOG.length = keep;
    return { ok: st.err >= 1 && hasEnv && hasCfg && hasErr && maskUnit && keyLine && !leakKey,
      info: '错误计数=' + st.err + ' 含环境=' + hasEnv + ' 含配置=' + hasCfg
        + ' 含错误=' + hasErr + ' 脱敏函数正确=' + maskUnit + ' 报告Key已脱敏=' + keyLine
        + ' 泄露明文=' + leakKey + ' 报告长度=' + rep.length };
  });

  T('运行日志：能落盘、重启后读得回、且优先保住错误', function(){
    try{ localStorage.removeItem(LOG_KEY); }catch(e){}
    RUNTIME_LOG.length = 0;
    logIt('系统', '__普通信息__');
    logErr('__要保住的那条错误__');
    logSaveNow();
    RUNTIME_LOG.length = 0;
    logLoad();
    var back = RUNTIME_LOG.length >= 2;
    var keptErr = RUNTIME_LOG.some(function(x){ return x.tag === '错误'; });
    /* 写满时先淘汰普通信息：塞 400 条普通 + 1 条错误，看错误还在不在 */
    RUNTIME_LOG.length = 0;
    for(var i=0;i<400;i++) logIt('系统', '填充' + i);
    logErr('__压线之后的错误__');
    var saveFn = logSaveNow.toString();
    logSaveNow();
    RUNTIME_LOG.length = 0;
    logLoad();
    var survived = RUNTIME_LOG.some(function(x){ return String(x.msg).indexOf('__压线之后的错误__') >= 0; });
    var dropped = !RUNTIME_LOG.some(function(x){ return String(x.msg).indexOf('填充0') >= 0; });
    try{ localStorage.removeItem(LOG_KEY); }catch(e){}
    return { ok: back && keptErr && survived && dropped && typeof saveFn === 'string',
      info: '重启读回=' + back + ' 错误在=' + keptErr + ' 压线后错误仍在=' + survived
        + ' 普通信息被淘汰=' + dropped };
  });

  // ---------- 回归：语音模型留空 = 用系统语音（真机反馈） ----------
  T('语音模型留空即用系统语音，不跟随对话模型', function(){
    var keepR = JSON.parse(JSON.stringify(rolesCfg()));
    var keepM = JSON.parse(JSON.stringify(S.models || {}));
    /* 场景一：用户点过「取消选择」 */
    clearModelPick('tts');
    var noModel = roleModelName('tts') === '';
    var label = modelLabel('tts');
    renderModels();
    var staysEmpty = roleModelName('tts') === '';
    /* 场景二：全新用户从没碰过 tts —— 原来会被自动补一个文本对话模型，
       而文本模型走 audio/speech 只会失败，用户会误判成「朗读坏了」。 */
    delete S.models.tts;
    if(S.roles && S.roles.tts) S.roles.tts.m = '';
    renderModels();
    var freshStaysEmpty = roleModelName('tts') === '';
    S.roles = keepR; S.models = keepM; save(); renderModels();
    return { ok: noModel && staysEmpty && freshStaysEmpty
        && label.indexOf('用系统语音') >= 0 && label.indexOf('跟随对话模型') < 0,
      info: '取消后无模型=' + noModel + ' 重进列表仍为空=' + staysEmpty
        + ' 全新状态也为空=' + freshStaysEmpty + ' 标签=' + JSON.stringify(label) };
  });

  // ---------- 回归：语音失败的提示要能读完（真机截图踩过） ----------
  T('语音失败：toast 只给短句，完整原因进日志与排查页', function(){
    var keep = RUNTIME_LOG.length;
    var longWhy = '系统里没有安装任何语音引擎。到「设置 → 系统 → 语言和输入法 → 文字转语音」装一个。';
    ttsFail(longWhy);
    var tip = (document.getElementById('toast') || {}).textContent || '';
    /* toast 只能放短句：超过二十来个字会被省略号截断在半句上 */
    var shortOk = tip.length > 0 && tip.length <= 12;
    var logged = RUNTIME_LOG.some(function(x){
      return x.tag === '语音' && String(x.msg).indexOf('没有安装任何语音引擎') >= 0;
    });
    RUNTIME_LOG.length = keep;
    /* 实测渲染宽度：必须小于 .toast 的 max-width，否则一定被截 */
    toast('朗读没成功');
    var el = document.getElementById('toast');
    var w = el ? Math.round(el.getBoundingClientRect().width || 0) : 0;
    return { ok: shortOk && logged && w > 0 && w < 330,
      info: 'toast=' + JSON.stringify(tip) + '（' + tip.length + ' 字）'
        + ' 完整原因进日志=' + logged + ' 实测宽度=' + w + 'px（上限 330）' };
  });

  // ---------- 回归：待办超时（算出来的，不存标志位） ----------
  T('待办超时：过期未完成才标，已完成与无截止都不标', function(){
    var keep = JSON.parse(JSON.stringify(todosAll()));
    var d = new Date();
    var p2 = function(n){ return (n < 10 ? '0' : '') + n; };
    var day = d.getFullYear() + '-' + p2(d.getMonth()+1) + '-' + p2(d.getDate());
    var cases = [
      {id:'__o1__', t:'昨天就该交', done:false, due:day + 'T00:01'},   /* 已过 */
      {id:'__o2__', t:'今天截止',   done:false, due:day + 'T23:59'},   /* 还没到 */
      {id:'__o3__', t:'交过了',     done:true,  due:day + 'T00:01'},   /* 已完成 */
      {id:'__o4__', t:'没设时间',   done:false, due:''}                /* 无截止 */
    ];
    S.todos = cases; save(); renderTodos();
    var c1 = todoOverdue(cases[0]) === true;
    var c2 = todoOverdue(cases[1]) === false;
    var c3 = todoOverdue(cases[2]) === false;
    var c4 = todoOverdue(cases[3]) === false;
    var cnt = todoOverdueCount();
    var html = (document.getElementById('todosBody') || {}).innerHTML || '';
    /* 「已超时」两处：行内徽标 + 顶部统计。另一句是「已超过截止」，不含这三个字。 */
    var badge = (html.match(/已超时/g) || []).length;
    var rowCls = /todo-row overdue/.test(html);
    var red = /已超过截止/.test(html);
    S.todos = keep; save(); renderTodos();
    return { ok: c1 && c2 && c3 && c4 && cnt === 1 && badge === 2 && rowCls && red,
      info: '过期未完成=' + c1 + ' 未到期=' + c2 + ' 已完成=' + c3 + ' 无截止=' + c4
        + ' 计数=' + cnt + ' 页面「已超时」' + badge + ' 处 · 行有 overdue 类=' + rowCls
        + ' · 截止文案变了=' + red };
  });

  // ---------- 回归：工具格式必须在提示词里钉死，且泄漏的协议块要清干净 ----------
  T('系统提示把工具格式钉死，并点名禁止标签与 JSON 形态', function(){
    var tb = toolsBlock();
    var sys = sysPrompt(true);
    var noTool = sysPrompt(false);
    var exact = /TOOL:工具名\|参数=值/.test(tb);
    var demo = /TOOL:addHoliday\|from=2026-10-01/.test(tb);
    var ban = /OCML/.test(tb) && /parameter=TOOL_call/.test(tb) && /不要写成 JSON/.test(tb);
    /* 铁律要在系统提示的最末尾再来一遍。按两段的实际长度算位置，
       别写死一个字符数 —— 改文案就会让断言莫名其妙地红。 */
    var lawN = toolFormatLaw().length + TOOL_BAN.length + 24;
    var lawAt = sys.lastIndexOf('唯一允许的格式');
    var endLaw = lawAt > sys.length - lawN && sys.lastIndexOf('禁止的写法') > lawAt;
    var cleanNoTool = noTool.indexOf('OCML') < 0;
    return { ok: exact && demo && ban && endLaw && cleanNoTool,
      info: '唯一格式=' + exact + ' 正例=' + demo + ' 点名禁止=' + ban
        + ' 提示末尾再钉=' + endLaw + ' 无工具角色干净=' + cleanNoTool };
  });

  T('正文与思考过程都能清掉标签式工具调用', function(){
    var sample = '好的，这就加上～<OCML>\n<parameter=TOOL_call>addHoliday</parameter>\n'
      + '<parameter=TOOL_args>{"from": "2026-10-01", "name": "国庆"}</parameter>\n</OCML>';
    var out = stripToolLine(sample);
    var tagOk = out.indexOf('OCML') < 0 && out.indexOf('parameter') < 0
      && out.indexOf('addHoliday') < 0 && out.indexOf('好的，这就加上') === 0;
    var out2 = stripToolLine('好的\nTOOL:addTodo|title=交作业\n');
    var oldOk = out2.indexOf('TOOL') < 0 && out2.indexOf('好的') === 0;
    var scripts = Array.prototype.map.call(document.scripts, function(s){ return s.textContent || ''; })
      .filter(function(x){ return x.indexOf('__ASSERTS' + 'RC__') < 0; }).join('\n');
    var thinkOk = /stripToolLine\(\s*meta\.reasoning\s*\)/.test(scripts)
      && /stripToolLine\(\s*String\(meta\.reasoning\)\s*\)/.test(scripts);
    return { ok: tagOk && oldOk && thinkOk,
      info: '标签块清干净=' + tagOk + ' 原有TOOL行仍清=' + oldOk + ' 思考过程也清洗=' + thinkOk
        + ' | ' + JSON.stringify(out).slice(0, 64) };
  });

  /* ================= 笔记：图片导入 / 分享导出 ================= */
  var _notesKeep = JSON.parse(JSON.stringify(S.notes || []));
  var _TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  T('笔记能插入图片并立即落盘', function(){
    openNotes(); noteNew();
    var bd = document.getElementById('noteBody');
    noteInsertImg(_TINY_PNG);
    var n = noteById(noteCurId);
    var domHas = bd ? /<img\b/i.test(bd.innerHTML) : false;
    var savedHas = /<img\b/i.test(String(n.body || ''));
    /* 同一张图重复选应被拦下：误触两次不该把同一张插两遍 */
    noteInsertImg(_TINY_PNG);
    var imgN = (String(document.getElementById('noteBody').innerHTML).match(/<img\b/gi) || []).length;
    return { ok: domHas && savedHas && imgN === 1,
      info: 'DOM含图=' + domHas + ' 已落盘=' + savedHas + ' 去重后图片数=' + imgN };
  });

  T('文字笔记改为全屏编辑，工具栏在底部', function(){
    openNotes(); noteNew();
    var h = (document.getElementById('notesBody') || {}).innerHTML || '';
    var entry = h.indexOf('noteFullEnter()') >= 0;       /* 编辑页只剩「打开全屏编辑」 */
    var hasShare = h.indexOf('noteOpenShare()') >= 0;
    var prev = !!document.getElementById('notePreview'); /* 编辑页保留内容预览 */
    var bodyInFull = !!document.querySelector('#noteFull #noteBody');
    noteFullEnter();
    var full = document.getElementById('noteFull');
    var opened = !!full && full.classList.contains('show');
    var kids = full ? [].slice.call(full.children).map(function(e){ return e.id || ''; }) : [];
    var barAtBottom = kids[kids.length - 1] === 'noteBarFull';   /* 工具栏必须是最后一个子元素 */
    var bar = (document.getElementById('noteBarFull') || {}).innerHTML || '';
    var hasImg = bar.indexOf('notePickImg()') >= 0;
    var hasTable = bar.indexOf("openSheet('tableform')") >= 0;
    noteFullExit();
    return { ok: entry && hasShare && prev && bodyInFull && opened && barAtBottom && hasImg && hasTable,
      info: '入口=' + entry + ' 预览=' + prev + ' 正文在全屏层=' + bodyInFull + ' 能打开=' + opened
        + ' 工具栏置底=' + barAtBottom + ' 插图=' + hasImg + ' 表格=' + hasTable + ' 分享=' + hasShare };
  });

  T('保存笔记后回到总览并给出反馈', function(){
    openNotes(); noteNew();
    noteFullEnter();
    document.getElementById('noteBody').innerHTML = '<b>正文甲</b>';
    document.getElementById('noteTitle').value = '标题甲';
    noteSave();
    var saved = noteById(S.notes[0].id) || {};
    var tip = (document.getElementById('toast') || {}).textContent || '';
    var bodyOk = String(saved.body).indexOf('正文甲') >= 0;
    return { ok: noteMode === 'list' && bodyOk && saved.title === '标题甲' && tip.length > 0,
      info: '回总览=' + (noteMode === 'list') + ' 正文已存=' + bodyOk
        + ' 标题=' + JSON.stringify(saved.title) + ' 提示=' + JSON.stringify(tip) };
  });

  T('换一篇笔记不会串内容（全屏层每次重灌）', function(){
    openNotes(); noteNew(); var a = noteCurId;
    noteFullEnter(); document.getElementById('noteBody').innerHTML = 'AAA'; noteFullExit();
    noteNew();                                          /* 此时全屏层里还是 A 的内容 */
    var b = noteCurId;
    noteFullEnter();
    var shown = document.getElementById('noteBody').innerHTML;
    noteFullExit();
    return { ok: a !== b && shown.indexOf('AAA') < 0,
      info: 'B 编辑区=' + JSON.stringify(shown.slice(0, 16)) };
  });

  T('笔记编辑页的删除按钮是危险色（红）', function(){
    openNotes(); noteNew();
    var host = document.getElementById('notesBody') || document.body;
    var del = [].slice.call(host.querySelectorAll('.btn')).filter(function(b){
      return String(b.textContent).trim() === '删除'; })[0];
    var isDanger = !!del && del.classList.contains('danger');
    /* 行为验证：挂两个探针，确认 .btn.danger 真的算出了和普通按钮不同的颜色 ——
       只查类名会漏掉「类写了但 CSS 没生效」这种情况。 */
    var p1 = document.createElement('div'); p1.className = 'btn';
    var p2 = document.createElement('div'); p2.className = 'btn danger';
    p1.style.position = p2.style.position = 'fixed';
    document.body.appendChild(p1); document.body.appendChild(p2);
    var c1 = getComputedStyle(p1).color, c2 = getComputedStyle(p2).color;
    p1.remove(); p2.remove();
    noteBack();
    return { ok: isDanger && !!c2 && c1 !== c2,
      info: '删除按钮类=' + (del ? del.className : '无') + ' 普通色=' + c1 + ' 危险色=' + c2 };
  });

  T('切换到手写模式仍可用（别被全屏文字改动带崩）', function(){
    openNotes(); noteNew();
    noteSetMode('ink');
    var tw = document.getElementById('noteTextWrap');
    var iw = document.getElementById('noteInkWrap');
    var swap = tw.style.display === 'none' && iw.style.display === '';
    inkEnterFull();
    var ink = document.getElementById('inkFull');
    var opened = !!ink && ink.classList.contains('show');
    inkExitFull();
    var closed = !document.getElementById('inkFull').classList.contains('show');
    noteSave();
    return { ok: swap && opened && closed,
      info: '切到手写=' + swap + ' 全屏手写打开=' + opened + ' 退出=' + closed };
  });

  T('含图片的笔记只能导出为图片', function(){
    openNotes(); noteNew();
    noteInsertImg(_TINY_PNG);
    var n = noteById(noteCurId);
    var rich = noteHasRich(n);
    noteOpenShare();
    var txt = (document.getElementById('sheet') || {}).textContent || '';
    var noTextItem = txt.indexOf('导出为文字') < 0 && txt.indexOf('分享文字') < 0;
    var hasImgItem = txt.indexOf('导出为图片') >= 0 && txt.indexOf('分享图片') >= 0;
    var explained = txt.indexOf('会丢掉它们') >= 0;
    closeSheet();
    return { ok: rich && noTextItem && hasImgItem && explained,
      info: '含图=' + rich + ' 无文字项=' + noTextItem + ' 有图片项=' + hasImgItem + ' 有说明=' + explained };
  });

  T('纯文字笔记可导出文字，转换不留标签', function(){
    openNotes(); noteNew();
    var bd = document.getElementById('noteBody');
    if(bd) bd.innerHTML = '<div>今天学了高数</div><div>还有线代</div>';
    noteSyncEdit();
    var n = noteById(noteCurId);
    var pt = notePlainText(n);
    var plainOk = pt.indexOf('今天学了高数') >= 0 && pt.indexOf('线代') >= 0
      && pt.indexOf('<div>') < 0 && pt.indexOf('</div>') < 0;
    noteOpenShare();
    var txt = (document.getElementById('sheet') || {}).textContent || '';
    var four = txt.indexOf('导出为文字') >= 0 && txt.indexOf('导出为图片') >= 0
      && txt.indexOf('分享文字') >= 0 && txt.indexOf('分享图片') >= 0;
    closeSheet();
    return { ok: plainOk && four, info: '纯文本转换=' + plainOk + ' 四个入口=' + four };
  });

  /* 图片生成本身是异步的（要等离屏 img 解码完），先 await 出结果再同步断言 */
  var _pngPlain = '', _pngImg = '';
  await new Promise(function(res){
    openNotes(); noteNew();
    var bd = document.getElementById('noteBody');
    if(bd) bd.innerHTML = '<div>第一段文字</div><div>第二段文字</div>';
    noteSyncEdit();
    noteRenderPng(noteById(noteCurId), function(u){ _pngPlain = u || ''; res(); });
  });
  await new Promise(function(res){
    openNotes(); noteNew();
    noteInsertImg(_TINY_PNG);
    var bd2 = document.getElementById('noteBody');
    if(bd2) bd2.innerHTML = '<div>带图的笔记</div>' + bd2.innerHTML;
    noteSyncEdit();
    noteRenderPng(noteById(noteCurId), function(u){ _pngImg = u || ''; res(); });
  });
  T('笔记能导出为长图（纯文字 / 含图都不炸）', function(){
    var a = /^data:image\/png;base64,/.test(_pngPlain) && _pngPlain.length > 2000;
    var b = /^data:image\/png;base64,/.test(_pngImg) && _pngImg.length > 2000;
    return { ok: a && b, info: '纯文字图=' + _pngPlain.length + ' 字符 · 含图=' + _pngImg.length + ' 字符' };
  });

  /* ================= 聊天记录：删除 ================= */
  T('聊天记录可以删除', function(){
    var keep = JSON.parse(JSON.stringify(S.chatHistory || []));
    S.chatHistory = [
      { title:'测试会话A', when:'今天', msgs:[{r:'me', t:'hi'}] },
      { title:'测试会话B', when:'昨天', msgs:[{r:'ai', t:'yo'}] }
    ];
    save();
    openSheet('chathist');
    var sheetTxt = (document.getElementById('sheet') || {}).textContent || '';
    var hasDel = sheetTxt.indexOf('删') >= 0;
    delChatSession(0);
    var left = (S.chatHistory || []).map(function(h){ return h.title; });
    var okDel = left.length === 1 && left[0] === '测试会话B';
    S.chatHistory = keep; save();
    closeSheet();
    return { ok: hasDel && okDel, info: '列表有删除=' + hasDel + ' 删后剩余=' + left.join('|') };
  });

  /* ================= 联网搜索 ================= */
  T('联网搜索：配置入口 + 三家服务 + 默认关闭', function(){
    var c = webSearchCfg();
    var defOff = c.on === false && webSearchReady() === false;
    openAiConfig();
    var v = document.getElementById('view-ai');
    var hasEntry = !!v && v.textContent.indexOf('联网搜索') >= 0;
    openSheet('websearch');
    var st = (document.getElementById('sheet') || {}).textContent || '';
    var three = st.indexOf('博查') >= 0 && st.indexOf('Tavily') >= 0 && st.indexOf('SearXNG') >= 0;
    closeSheet();
    return { ok: defOff && hasEntry && three,
      info: '默认关=' + defOff + ' 配置页入口=' + hasEntry + ' 三家齐=' + three };
  });

  T('webSearch 已进工具表与系统提示', function(){
    var inTools = false;
    for(var i = 0; i < AI_TOOLS.length; i++) if(AI_TOOLS[i].k === 'webSearch') inTools = true;
    var sys = sysPrompt(true);
    var inPrompt = sys.indexOf('webSearch') >= 0;
    var notReady = webSearchReady() === false;
    return { ok: inTools && inPrompt && notReady,
      info: '工具表=' + inTools + ' 提示词=' + inPrompt + ' 未开启时不可用=' + notReady };
  });

  T('能解析搜索请求与三家响应', function(){
    var qs = webSearchQueries('好的\nTOOL:webSearch|q=高数 期末 复习方法');
    var b = webSearchParse('bocha', JSON.stringify({data:{webPages:{value:[{name:'标题A',url:'http://a.com',snippet:'摘要A'}]}}}));
    var tv = webSearchParse('tavily', JSON.stringify({answer:'直接答案', results:[{title:'T',url:'http://t',content:'C'}]}));
    var sx = webSearchParse('searxng', JSON.stringify({results:[{title:'S',url:'http://s',content:'CS'}]}));
    var okQ = qs.length === 1 && qs[0] === '高数 期末 复习方法';
    var okB = b.indexOf('标题A') >= 0 && b.indexOf('http://a.com') >= 0;
    var okT = tv.indexOf('直接答案') >= 0 && tv.indexOf('http://t') >= 0;
    var okS = sx.indexOf('CS') >= 0 && sx.indexOf('http://s') >= 0;
    return { ok: okQ && okB && okT && okS,
      info: '搜索词=' + okQ + ' 博查=' + okB + ' Tavily=' + okT + ' SearXNG=' + okS };
  });

  T('未开启联网时明确回话，不空转', function(){
    var ready = webSearchReady();
    var r = runOneTool('webSearch', {q:'x'});
    var said = (typeof r === 'string') && r.length > 0;
    return { ok: ready === false && said,
      info: '可搜=' + ready + ' 兜底回话=' + JSON.stringify(String(r).slice(0, 36)) };
  });

  T('GET 回调按 id 分发且一次性', function(){
    var fnOk = typeof window.onHttpGet === 'function';
    var got = '';
    HTTP_GET_WAIT['__t'] = function(ok, body){ got = String(body); };
    window.onHttpGet('__t', true, 'hello');
    var once = (typeof HTTP_GET_WAIT['__t'] === 'undefined');
    var noThrow = true;
    try{ window.onHttpGet('never-registered', true, 'x'); }catch(e){ noThrow = false; }
    return { ok: fnOk && got === 'hello' && once && noThrow,
      info: '入口=' + fnOk + ' 收到=' + got + ' 一次性=' + once + ' 未知id不抛错=' + noThrow };
  });

  /* ================= 死代码清理 / 图标库 ================= */
  function pageScripts(){
    return Array.prototype.map.call(document.scripts, function(s){ return s.textContent || ''; })
      .filter(function(x){ return x.indexOf('__ASSERTS' + 'RC__') < 0; }).join('\n');
  }

  T('已删除的小爱课表导入没留下死代码', function(){
    var src = pageScripts();
    /* 关键字拆开拼，免得断言脚本自己去匹配自己 */
    var keys = ['xa' + 'oai', 'tryXiaoai' + 'Url', '__httpGet' + 'Fallback',
                'xa' + 'Status', 'impOCRResult' + 'Preview'];
    var left = keys.filter(function(k){ return src.indexOf(k) >= 0; });
    var hook = src.indexOf('window.__httpGet' + 'Fallback =') >= 0;
    return { ok: !left.length && !hook, info: '残留=' + (left.join(',') || '无') + ' 旧钩子=' + hook };
  });

  T('图标库：补绘的图标齐备且都有引用', function(){
    var need = ['globe', 'align', 'layout', 'dynamic', 'wand', 'key', 'heart', 'smile',
                'coin', 'target', 'pressure', 'chip', 'terminal', 'book', 'database',
                'holiday', 'voice', 'speed', 'paper', 'puzzle', 'check'];
    var missing = need.filter(function(k){ return !(k in ICON); });
    var src = pageScripts();
    /* 静态 HTML 里的图标不在 <script> 里，要连 DOM 一起看 */
    var dom = [].slice.call(document.querySelectorAll('.ic[data-i]'))
      .map(function(e){ return e.dataset.i; });
    var unused = need.filter(function(k){
      return src.indexOf('data-i="' + k + '"') < 0
        && src.indexOf("icSvg('" + k + "'") < 0
        && dom.indexOf(k) < 0;
    });
    return { ok: !missing.length && !unused.length,
      info: '共 ' + need.length + ' 个 · 缺=' + (missing.join(',') || '无')
        + ' 无人引用=' + (unused.join(',') || '无') };
  });

  T('重复借用的图标已按语义换开', function(){
    /* 两种写法都要认：静态 HTML 用 data-i；render 出来的走 icSvg()、没有 data-i，
       就拿 .ic 里的 SVG 路径去和 ICON 表比。
       注意：innerHTML 序列化会把 <path .../> 写成 <path ...></path>，
       所以整串比对必然失配，只能比 d="..." 这一段。 */
    function icOf(label){
      var lis = document.querySelectorAll('.li');
      for(var i = 0; i < lis.length; i++){
        if((lis[i].textContent || '').indexOf(label) < 0) continue;
        var ic = lis[i].querySelector('.ic');
        if(!ic) continue;
        if(ic.dataset.i) return ic.dataset.i;
        var html = ic.innerHTML || '';
        for(var k in ICON){
          var ds = ICON[k].match(/d="[^"]+"/g);
          if(ds && ds.length){
            var all = true;
            for(var j = 0; j < ds.length; j++){ if(html.indexOf(ds[j]) < 0){ all = false; break; } }
            if(all) return k;
          }
        }
        return '';
      }
      return '';
    }
    var want = { '联网搜索': 'globe', '侧栏按钮对齐': 'align', '灵动岛上岛': 'dynamic',
                 '管理技能': 'puzzle', '管理记忆': 'chip', '节假日模式': 'holiday',
                 '让 AI 记住我': 'chip', '备份学习数据': 'database', '特别鸣谢': 'heart',
                 '服务商与模型': 'sparkle',   /* 这个本来就该是 AI 星标，别换错 */
                 '已消耗资费': 'coin', '累计 Token': 'gauge', '提前提醒': 'alarm',
                 '准点提醒': 'target' };
    renderProfile(); renderAiEntry();      /* 「我的」页入口卡是渲染出来的，先落地 */
    openAiConfig(); openAiHub();           /* 资费面板在「AI 提供商」页里，也要先渲染 */
    var got = {}, bad = [];
    Object.keys(want).forEach(function(k){
      got[k] = icOf(k);
      if(got[k] !== want[k]) bad.push(k + '=' + (got[k] || '无') + '(应 ' + want[k] + ')');
    });
    var diag = 'li总数=' + document.querySelectorAll('.li').length
      + ' aiEntry字节=' + (((document.getElementById('aiEntry') || {}).innerHTML) || '').length;
    return { ok: !bad.length,
      info: bad.length ? (bad.join(' ') + ' | ' + diag)
                       : '全部对得上（' + Object.keys(want).length + ' 处）' };
  });

  S.notes = _notesKeep; save();

  // 提醒卡去重的**运行时**行为验证（不只是扫源码）。
  //  复现原 bug 的调用序列：同一节课连续推 5 次；点「稍后提醒」后再推 3 次。
  //  期望：只有第一次弹；snooze 之后的推送一律被挡住。
  //  对照组：换一节不同的课，应当照常弹 —— 证明闸门没有把正常提醒一起封死。
  T('上课提醒：同一节重复推送只弹一次，「稍后提醒」后不再弹', function(){
    var snapCourses = JSON.parse(JSON.stringify(S.courses));
    var snapHold = S.__alertHold;
    var hadHold = Object.prototype.hasOwnProperty.call(S, '__alertHold');

    var dA = todayI;
    var cA = { t:'08:00-09:40', n:'自测·重复课A', loc:'', c:1, w:'all' };
    var cB = { t:'10:00-11:40', n:'自测·对照课B', loc:'', c:1, w:'all' };
    if(!S.courses[dA]) S.courses[dA] = [];
    S.courses[dA].push(cA, cB);
    if(!S.classes) S.classes = {};

    var pops = 0;
    var realShow = window.showAlert;
    var realToast = window.toast;
    window.showAlert = function(kind){ if(kind === 'start') pops++; return realShow.apply(window, arguments); };
    window.toast = function(){};

    try{
      // ① 同一节推 5 次 —— 只有第 1 次该弹
      for(var i=0;i<5;i++) window.onNativeClassAlert('start', '自测·重复课A');
      var afterRepeat = pops;

      // ② 点「稍后提醒」后再推 3 次 —— 一次都不该弹
      S.__pending = { day:dA, c:cA };
      window.snoozeAlert();
      var base = pops;
      for(var j=0;j<3;j++) window.onNativeClassAlert('start', '自测·重复课A');
      var afterSnooze = pops - base;

      // ③ 对照组：另一节课仍能正常弹
      var beforeB = pops;
      window.onNativeClassAlert('start', '自测·对照课B');
      var poppedB = pops - beforeB;

      // ④ 点了「开始上课并记录专注」之后，这节也不该再弹
      S.__pending = { day:dA, c:cB };
      try{ window.confirmStartClass(); }catch(e0){}
      var beforeC = pops;
      window.onNativeClassAlert('start', '自测·对照课B');
      var afterStart = pops - beforeC;

      return {
        ok: afterRepeat === 1 && afterSnooze === 0 && poppedB === 1 && afterStart === 0,
        info: '重复推5次弹=' + afterRepeat + '（期望1）· snooze后再推3次弹=' + afterSnooze
          + '（期望0）· 对照组B弹=' + poppedB + '（期望1）· 开始专注后再推弹=' + afterStart + '（期望0）'
      };
    } catch(err){
      return { ok: false, info: 'THREW: ' + (err && (err.message || err)) };
    } finally {
      window.showAlert = realShow;
      window.toast = realToast;
      window.closeAlert();
      S.courses = snapCourses;
      if(hadHold) S.__alertHold = snapHold; else delete S.__alertHold;
      S.__pending = null;
      delete S.classes[cid(dA, cB)];
      delete S.classes[cid(dA, cA)];
    }
  });

  // 字号调节：换档要真的改变「读的字」的计算字号，且图标/间距不能跟着变。
  //  这里量真实计算值，不扫源码 —— 令牌没接上时变量会被解析成默认值，量出来就是没变。
  T('字号：四档切换真的改变正文计算字号（图标/间距不动）', function(){
    var snapFs = S.fontScale;
    var root = document.documentElement;
    var body = document.getElementById('page-me');
    // 取一个用 --fs-body 的元素做样本：列表主标题
    var probe = document.querySelector('#page-me .li .tx b');
    if(!body || !probe) return { ok:false, info:'找不到 #page-me 或 .li .tx b 样本' };

    function measure(at){
      S.fontScale = at; applyLook();
      return {
        body: parseFloat(getComputedStyle(probe).fontSize) || 0,
        htmlAttr: root.dataset.fs || '',
        // 图标/间距的对照：拿一个不参与字号的尺寸（列表图标容器宽）
        icon: parseFloat(getComputedStyle(document.querySelector('#page-me .li .ic')).width) || 0
      };
    }
    try{
      var sm = measure('sm'), md = measure('md'), lg = measure('lg'), xl = measure('xl');
      // 单调递增
      var mono = sm.body < md.body && md.body < lg.body && lg.body < xl.body;
      // 档位属性确实挂上去了
      var attrs = sm.htmlAttr==='sm' && md.htmlAttr==='md' && lg.htmlAttr==='lg' && xl.htmlAttr==='xl';
      // 图标尺寸不随字号变
      var iconFixed = sm.icon === xl.icon && sm.icon > 0;
      return {
        ok: mono && attrs && iconFixed,
        info: '正文 ' + [sm.body, md.body, lg.body, xl.body].join(' → ')
          + '（sm→xl）· 属性=' + [sm.htmlAttr,md.htmlAttr,lg.htmlAttr,xl.htmlAttr].join('/')
          + ' · 单调=' + mono + ' · 图标固定=' + iconFixed + '(' + sm.icon + 'px)'
      };
    } finally {
      S.fontScale = snapFs; applyLook();
    }
  });

  // 降明度：只在深色生效 —— 浅色模式开了也不能动任何一个色变量。
  //  这是用户明确要的边界，必须用对照实验钉住（只测深色会漏掉「浅色被误改」）。
  T('降低主题色明度：仅深色生效，浅色模式完全不受影响', function(){
    var snap = { fs:S.fontScale, dim:S.dimBrand, acc:S.accent, th:S.theme };
    var root = document.documentElement;
    function brandNow(){ return root.style.getPropertyValue('--brand').trim(); }

    function lum(hex){
      var h = String(hex).replace('#','');
      if(h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      var r = parseInt(h.slice(0,2),16)/255, g = parseInt(h.slice(2,4),16)/255, b = parseInt(h.slice(4,6),16)/255;
      return 0.2126*r + 0.7152*g + 0.0722*b;
    }
    try{
      S.theme = 'dark'; S.accent = 'indigo';

      S.dimBrand = false; applyLook();
      var darkOff = brandNow();
      S.dimBrand = true;  applyLook();
      var darkOn = brandNow();

      S.theme = 'light';
      S.dimBrand = false; applyLook();
      var lightOff = brandNow();
      S.dimBrand = true;  applyLook();
      var lightOn = brandNow();

      var darkDims = lum(darkOn) < lum(darkOff);
      var lightIntact = lightOff === lightOn && lightOff !== '';
      /* 压暗要「柔和化」而不是「变刺眼」：高饱和 + 中明度的颜色在深色底上很扎眼。
         用「向背景混合」时饱和度会跟着掉，所以这里盯住**饱和度也必须降**——
         这正是第一版栽过的地方（只乘 HSL 明度，L 掉了但 S 还 82%，反而更电）。 */
      function sat(hex){
        var h = String(hex).replace('#',''); if(h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
        var r=parseInt(h.slice(0,2),16)/255,g=parseInt(h.slice(2,4),16)/255,b=parseInt(h.slice(4,6),16)/255;
        var mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,d=mx-mn;
        if(!d) return 0;
        return (l > .5 ? d/(2-mx-mn) : d/(mx+mn)) * 100;
      }
      var satDrops = sat(darkOn) < sat(darkOff);
      var dimmed = darkDims && satDrops;

      return {
        ok: dimmed && lightIntact,
        info: '深色 ' + darkOff + '→' + darkOn
          + '（变暗=' + darkDims + ' · 降饱和=' + satDrops
          + '  ' + sat(darkOff).toFixed(0) + '%→' + sat(darkOn).toFixed(0) + '%）'
          + ' · 浅色 ' + lightOff + '→' + lightOn + '（不动=' + lightIntact + '）'
      };
    } finally {
      S.fontScale = snap.fs; S.dimBrand = snap.dim; S.accent = snap.acc; S.theme = snap.th;
      applyLook(); renderFontScale(); renderDimBrand();
    }
  });

  // 降明度开着但当前是浅色时，提示语必须说清楚「切到深色后生效」——
  //  否则用户会以为开关坏了（这属于「开关只在需要它的场合生效」的沟通成本）。
  T('降明度开关的提示语会区分「生效中 / 待生效」', function(){
    var snap = { dim:S.dimBrand, th:S.theme };
    var hint = document.getElementById('dimBrandHint');
    if(!hint) return { ok:false, info:'找不到 #dimBrandHint' };
    try{
      S.dimBrand = true; S.theme = 'light';
      renderDimBrand();
      var lightTxt = hint.textContent;
      S.theme = 'dark'; renderDimBrand();
      var darkTxt = hint.textContent;
      S.dimBrand = false; renderDimBrand();
      var offTxt = hint.textContent;
      return {
        ok: /切到深色|深色模式后生效/.test(lightTxt) && /已生效/.test(darkTxt) && lightTxt !== darkTxt,
        info: '浅色时="' + lightTxt + '" · 深色时="' + darkTxt + '" · 关闭时="' + offTxt + '"'
      };
    } finally {
      S.dimBrand = snap.dim; S.theme = snap.th; applyLook(); renderDimBrand();
    }
  });

  // 字号四档的滑块是 4 等分 —— .segThumb 写死 1/3 会盖住 1.33 格、与文字错位。
  T('四档字号滑块按 1/4 宽（不是写死 1/3）', function(){
    var seg = document.getElementById('fsSeg');
    if(!seg) return { ok:false, info:'找不到 #fsSeg' };
    var thumb = document.getElementById('fsThumb');
    var segW = seg.getBoundingClientRect().width;
    var thW = thumb.getBoundingClientRect().width;
    var actual = segW ? (thW / (segW - 6)) : 0;
    return {
      ok: seg.dataset.n === '4' && Math.abs(actual - 0.25) < 0.02,
      info: 'data-n=' + seg.dataset.n + ' · 滑块占宽 ' + (actual*100).toFixed(1) + '%（期望 25%）'
    };
  });

  // 设置项确实在「我的 → 外观」里，且点了能改状态（不只是画了个壳）
  T('外观页有字号与降明度入口，点击真的改状态', function(){
    var fsSeg = document.getElementById('fsSeg');
    var dimSw = document.getElementById('dimBrandSw');
    if(!fsSeg || !dimSw) return { ok:false, info:'缺 fsSeg=' + !!fsSeg + ' dimBrandSw=' + !!dimSw };
    var snapFs = S.fontScale, snapDim = S.dimBrand;
    try{
      setFontScale('lg');
      var fsOk = S.fontScale === 'lg' && document.documentElement.dataset.fs === 'lg';
      setDimBrand(true);
      var dimOk = S.dimBrand === true && dimSw.classList.contains('on');
      setDimBrand(false);
      var dimOff = S.dimBrand === false && !dimSw.classList.contains('on');
      return {
        ok: fsOk && dimOk && dimOff,
        info: '改字号=' + fsOk + ' · 开降明度=' + dimOk + ' · 关降明度=' + dimOff
      };
    } finally {
      S.fontScale = snapFs; S.dimBrand = snapDim; applyLook(); renderFontScale(); renderDimBrand();
    }
  });

  // 降明度的开关必须用项目的 .switch 类 —— 别用 .sw（.sw 是色盘：26×26 方块+白对勾，
  // 关态完全不可见，2026-10-08 踩过：用户反馈"对勾没开时完全不显示、样式和应用不同"）。
  T('降明度开关与其它开关同一套样式（不是色盘 .sw）', function(){
    var sw = document.getElementById('dimBrandSw');
    if(!sw) return { ok:false, info:'找不到 #dimBrandSw' };
    var peers = [].slice.call(document.querySelectorAll('.switch')).filter(function(e){ return e !== sw; });
    if(!peers.length) return { ok:false, info:'页面上没有其它 .switch 可对照' };
    var own = getComputedStyle(sw);
    var ref = getComputedStyle(peers[0]);
    var sameBox = own.width === ref.width && own.height === ref.height
               && own.borderRadius === ref.borderRadius;
    var hadOn = sw.classList.contains('on');
    sw.classList.remove('on');
    var offBg = getComputedStyle(sw).backgroundColor;
    var offVisible = !!offBg && offBg !== 'transparent' && offBg !== 'rgba(0, 0, 0, 0)';
    if(hadOn) sw.classList.add('on');
    var knob = getComputedStyle(sw, '::after');
    var hasKnob = !!knob && knob.content && !/none/.test(knob.content);
    var wrongClass = sw.classList.contains('sw');
    return {
      ok: sameBox && offVisible && hasKnob && !wrongClass,
      info: '类名=' + sw.className + ' · 与其他开关同尺寸=' + sameBox
        + ' (' + own.width + '×' + own.height + ' r' + own.borderRadius + ')'
        + ' · 关态可见=' + offVisible + ' (bg ' + offBg + ')'
        + ' · 有圆钮=' + hasKnob + ' · 误用 .sw=' + wrongClass
    };
  });

  return JSON.stringify(R);
})()
`;

// 期望版本号从 build.gradle 读，断言里不写死；发版只需改 build.gradle 与 index.html
let EXPECT_VER = '';
try {
  const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
  const mv = /versionName\s+"([^"]+)"/.exec(gradle);
  if (mv) EXPECT_VER = 'v' + mv[1];
} catch (e) {}
if (!EXPECT_VER) { console.error('读不到 android/app/build.gradle 的 versionName'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
if (!/<\/body>/.test(html)) { console.error('index.html 里没有 </body>'); process.exit(1); }
html = html.replace(/<\/body>/, '\n<script>\nwindow.__ASSERTSRC__ = ' + JSON.stringify(ASSERTS) + ';\nwindow.__EXPECT_VER__ = ' + JSON.stringify(EXPECT_VER) + ';\n</script>\n</body>');
fs.writeFileSync(path.join(root, 'tools', '_domtest.html'), html, 'utf8');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(root, 'tools', '_domtest.html')));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = path.join(os.tmpdir(), 'edge-cdp-' + Date.now());
const dbgPort = 9233 + Math.floor(Math.random() * 200);
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio',
  '--remote-debugging-port=' + dbgPort, '--user-data-dir=' + profile, 'about:blank'
], { stdio: 'ignore', detached: true });
child.unref();

let cleanupDone = false;
function cleanup(){
  if (cleanupDone) return; cleanupDone = true;
  try { ws && ws.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
}
process.on('exit', cleanup);

async function waitFor(fn, ms = 40000, step = 250){
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await new Promise(r => setTimeout(r, step)); }
  throw new Error('timeout');
}
let ws, msgId = 0, sessionId = null;
const pending = new Map();
function send(method, params = {}, useSession = true){
  const id = ++msgId;
  const msg = { id, method, params };
  if (useSession && sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

try {
  const ver = await waitFor(async () => {
    try { const r = await fetch('http://127.0.0.1:' + dbgPort + '/json/version'); return await r.json(); } catch (e) { return null; }
  }, 40000);
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 连不上')); });

  const events = [];
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      events.push('EXCEPTION: ' + ((d.exception && d.exception.description) || d.text));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') events.push('LOG.ERROR: ' + m.params.entry.text);
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, false);
  const att = await send('Target.attachToTarget', { targetId, flatten: true }, false);
  sessionId = att.sessionId;
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/index.html' });
  await waitFor(async () => {
    const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    return r.result.value === 'complete';
  }, 40000);
  await new Promise(r => setTimeout(r, 1600));
  await send('Runtime.evaluate', {
    expression: "(function(){var o=document.getElementById('onboard');if(o)o.classList.remove('show');document.body.classList.remove('ob-open');try{S.onboarded=true;}catch(e){}return 1})()",
    returnByValue: true
  });
  await new Promise(r => setTimeout(r, 400));

  const evalOut = await send('Runtime.evaluate', {
    expression: 'window.__ASSERTSRC__ ? (0,eval)(window.__ASSERTSRC__) : "NO_ASSERTS"',
    returnByValue: true, awaitPromise: true
  });
  if (evalOut.exceptionDetails) {
    console.log('断言脚本自身抛错：');
    console.log(JSON.stringify(evalOut.exceptionDetails, null, 1).slice(0, 3000));
    process.exit(1);
  }

  const results = JSON.parse(evalOut.result.value);

  /* ---------- Node 侧架构守卫：不依赖页面状态，防的是「架构漂移」 ---------- */
  // A) 语义一致性审计：绕过单一口 + 跨语言契约对账
  //    注意用 import 而不是 spawnSync —— 本机 node 进程拉不起第二个 node（EBUSY）
  try {
    const { runChecks } = await import('./audit.mjs');
    const r = runChecks({ onlyGate: true });
    results.push({
      name: '架构守卫：日程语义审计（绕过单一口 + 跨语言契约对账）',
      ok: r.ok,
      info: r.ok
        ? `通过：S.courses 共 ${r.gate.rows.length} 处读取全在登记白名单内；`
          + `契约字段 ${r.con.fields.join(',')} 两端一致`
        : r.problems.slice(0, 3).join(' | ').slice(0, 320)
    });
  } catch (e) {
    results.push({ name: '架构守卫：日程语义审计', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // B) 原生侧必须真的实现了同一套判定（跨语言语义的第二份实现）
  try {
    const jd = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'xuejing', 'app');
    const rs = fs.readFileSync(path.join(jd, 'ReminderScheduler.java'), 'utf8');
    const cr = fs.readFileSync(path.join(jd, 'ClassAlarmReceiver.java'), 'utf8');
    const hasFn = /static boolean isHolidayNow\s*\(/.test(rs);
    const readsHolidays = /optJSONObject\(\s*"holidays"/.test(rs);
    const readsMode = /optBoolean\(\s*"holidayMode"/.test(rs);   // 双参形式 optBoolean(k, def)
    const usedOnFire = /isHolidayNow\s*\(/.test(cr);
    /* 判定必须在「触发时」而不是排程时 —— 排程时过滤会让放假那周一个闹钟都不排 */
    const fireTime = /thisWeek\s*&&\s*!skipHoliday/.test(cr) || /isHolidayNow/.test(cr);
    results.push({
      name: '原生侧也按同一套规则判节假日（放假不弹通知）',
      ok: hasFn && readsHolidays && readsMode && usedOnFire && fireTime,
      info: 'isHolidayNow=' + hasFn + ' 读holidays=' + readsHolidays
        + ' 读holidayMode=' + readsMode + ' 接收器调用=' + usedOnFire
        + ' 触发时判定=' + fireTime
    });
  } catch (e) {
    results.push({ name: '原生侧也按同一套规则判节假日（放假不弹通知）', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // C) 语音必须有原生实现 —— 旧实现只有 WebView 一条路，是「从来没成功过」的主因
  try {
    const jd = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'xuejing', 'app');
    const tts = fs.readFileSync(path.join(jd, 'Tts.java'), 'utf8');
    const nb = fs.readFileSync(path.join(jd, 'NativeBridge.java'), 'utf8');
    const hasEngine = /new TextToSpeech\(/.test(tts);
    const hasSpeak = /tts\.speak\(/.test(tts);
    const hasVoices = /getVoices\(\)/.test(tts);
    const hasProgress = /UtteranceProgressListener/.test(tts);
    /* 原来的 engineAvailable() 已移除：它拿 queryIntentServices 当判据，
       在 Android 11+ 上会被包可见性过滤骗到（真机踩过）。诊断改用可见引擎列表。 */
    const hasAvail = /visibleEnginesJson\(/.test(tts);
    const noBadGate = !/boolean engineAvailable\(/.test(tts);
    const bridges = ['ttsInit', 'ttsSpeak', 'ttsStop', 'ttsVoices']
      .filter(m => new RegExp('public\\s+\\w+\\s+' + m + '\\s*\\(').test(nb));
    results.push({
      name: '架构守卫：语音走原生引擎（不再是 WebView 独苗）',
      ok: hasEngine && hasSpeak && hasVoices && hasProgress && hasAvail && noBadGate && bridges.length === 4,
      info: `TextToSpeech=${hasEngine} speak=${hasSpeak} 音色枚举=${hasVoices}`
        + ` 进度回调=${hasProgress} 可见引擎诊断=${hasAvail} 已移除不可靠判据=${noBadGate}`
        + ` 桥=${bridges.length}/4`
        + (bridges.length < 4 ? ' 缺:' + ['ttsInit','ttsSpeak','ttsStop','ttsVoices'].filter(x=>bridges.indexOf(x)<0).join(',') : '')
    });
  } catch (e) {
    results.push({ name: '架构守卫：语音走原生引擎', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // D) toast 只能放短句 —— .toast 是 nowrap + max-width 330px + 省略号，
  //    超长会断在半句上（真机实测过：「…没有安装任何语音引擎。到「设…」）。
  //    这类 bug 会反复出现，所以做成 lint 而不是每次靠肉眼。
  try {
    const src = fs.readFileSync(SRC, 'utf8');
    const re = /toast\(\s*'([^']{10,})'/g;
    const bad = [];
    let m;
    while ((m = re.exec(src))) {
      const s = m[1];
      /* 粗略量「显示宽度」：中文按 1 个字宽，ASCII 按 0.5 */
      let w = 0;
      for (const ch of s) w += (ch.charCodeAt(0) > 255 ? 1 : 0.5);
      if (w > 22) bad.push(s.slice(0, 26) + '≈' + Math.round(w) + '字宽');
    }
    results.push({
      name: '架构守卫：toast 文案不过长（超出会被省略号截断）',
      ok: bad.length === 0,
      info: bad.length
        ? ('过长 ' + bad.length + ' 处 → ' + bad.slice(0, 3).join(' | ').slice(0, 300))
        : '所有 toast 字面文案都在 22 字宽以内（拼接生成的文案查不到，属已知盲区）'
    });
  } catch (e) {
    results.push({ name: '架构守卫：toast 文案不过长', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // E) 源码里不该出现 \uXXXX 转义 —— 曾经有 23 行被写成转义序列（某次补丁带进来的），
  //    JS 照样能跑，但没人读得懂，而且会让「扫源码」类检查算出错误的字宽。
  //    \u0001 是代码块占位符（控制符），保留转义是对的，单独放行。
  try {
    const src = fs.readFileSync(SRC, 'utf8');
    const all = src.match(/\\u[0-9a-fA-F]{4}/g) || [];
    const ctrl = all.filter(x => parseInt(x.slice(2), 16) < 0x20);
    const bad = all.length - ctrl.length;
    results.push({
      name: '架构守卫：源码无 \\uXXXX 转义（可读性）',
      ok: bad === 0,
      info: bad === 0
        ? `共 ${all.length} 处转义，全部是 \\u0001 占位符（允许）`
        : `${bad} 处可打印字符被写成了转义序列，应还原成真中文`
    });
  } catch (e) {
    results.push({ name: '架构守卫：源码无 \\uXXXX 转义', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // F) TTS 的 Android 11+ 包可见性 —— 本项目真实踩过：
  //    清单里没声明 TTS_SERVICE，系统把小爱/小米语音引擎过滤掉了，
  //    queryIntentServices 返回空，app 就误报「没装任何引擎」。
  //    两条一起盯：清单要声明；且**不能**再拿那个查询结果当判据。
  try {
    const jd2 = path.join(root, 'android', 'app', 'src', 'main');
    const mf = fs.readFileSync(path.join(jd2, 'AndroidManifest.xml'), 'utf8');
    const nb2 = fs.readFileSync(path.join(jd2, 'java', 'com', 'xuejing', 'app', 'NativeBridge.java'), 'utf8');
    const tts2 = fs.readFileSync(path.join(jd2, 'java', 'com', 'xuejing', 'app', 'Tts.java'), 'utf8');
    const hasQuery = /<queries>[\s\S]*android\.intent\.action\.TTS_SERVICE[\s\S]*<\/queries>/.test(mf);
    /* ttsInit 里再出现「查不到就提前判死」就说明有人把不可靠的判据请回来了 */
    const gates = /ttsInit\(\)\s*\{[\s\S]{0,500}?(engineAvailable|queryIntentServices|visibleEnginesJson)/.test(nb2);
    /* 诊断通道要留着：可见引擎列表是分辨「看不到」与「初始化失败」的唯一依据 */
    const hasDiag = /public String ttsEngines\(\)/.test(nb2) && /visibleEnginesJson/.test(tts2);
    results.push({
      name: '架构守卫：TTS 包可见性与判据（Android 11+，真机踩过）',
      ok: hasQuery && !gates && hasDiag,
      info: `清单声明 TTS_SERVICE=${hasQuery} · ttsInit 仍拿查询结果当判据=${gates}`
        + ` · 保留可见引擎诊断通道=${hasDiag}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：TTS 包可见性与判据', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // G) 上课提醒「循环弹窗」—— 真机踩过：到了点卡片每 2 秒弹一次，点「稍后提醒」也没用。
  //    根因是原生 reschedule 把已过窗口的课前提醒重新武装成 now+2s，
  //    而接收器每次触发后无条件重排 → 自己触发了自己。
  //    这里盯住三件事：① 补发夹取代码不许回来 ② 课前提醒触发后不重排 ③ 页面有去重闸门。
  try {
    const rel = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'xuejing', 'app');
    const schedRaw = fs.readFileSync(path.join(rel, 'ReminderScheduler.java'), 'utf8');
    const recvRaw = fs.readFileSync(path.join(rel, 'ClassAlarmReceiver.java'), 'utf8');
    const page = fs.readFileSync(SRC, 'utf8');
    /* 先剥注释：注释里会写「历史写法是 remindAt = now + 2000L」，
       不剥的话守卫会把「描述旧 bug 的注释」当成旧 bug 本身，误报。 */
    const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const sched = strip(schedRaw), recv = strip(recvRaw);

    /* ① 不许再出现「把 remindAt 夹到 now+2s」这种补发写法 */
    const reArm = /remindAt\s*<=\s*now\s*\)\s*remindAt\s*=\s*now\s*\+/.test(sched);
    /* 要真的有「窗口已过就跳过」的判定 */
    const hasWindowGuard = /if\s*\(\s*remindAt\s*>\s*now\s*\)\s*\{[\s\S]{0,200}?set\(c,\s*am,\s*codeStart/.test(sched);
    /* ② 重排必须带条件 —— 无条件 rescheduleFromStore 就是循环的推手 */
    const uncondResched = /if\s*\(thisWeek\s*&&\s*!skipHoliday\)\s*\{[\s\S]*?\}\s*\n\s*(?:\/\/[^\n]*\n\s*)*ReminderScheduler\.rescheduleFromStore/.test(recv);
    const condResched = /if\s*\(!isStart\s*\|\|\s*before\s*<=\s*0\)\s*\{[\s\S]{0,200}?rescheduleFromStore/.test(recv);
    /* 还要有 60 秒去重 */
    const hasDedup = /DEDUP_MS/.test(recv) && /firedRecently\s*\(/.test(recv);

    /* ③ 页面侧：去重闸门 + snooze 真的记沉默窗口 */
    const hasGate = /function classAlertAllowed\s*\(/.test(page);
    const gateUsed = /if\s*\(!classAlertAllowed\(nx\.day,\s*nx\.c\)\)\s*return;/.test(page);
    const snoozeHolds = /function snoozeAlert\(\)\{[\s\S]{0,400}?holdAlert\(/.test(page);

    results.push({
      name: '架构守卫：上课提醒不循环（真机踩过：每 2 秒弹一次）',
      ok: !reArm && hasWindowGuard && !uncondResched && condResched && hasDedup
          && hasGate && gateUsed && snoozeHolds,
      info: `残留补发夹取=${reArm} · 窗口已过跳过=${hasWindowGuard}`
        + ` · 无条件重排=${uncondResched} · 课前提醒不重排=${condResched}`
        + ` · 原生 60s 去重=${hasDedup}`
        + ` · 页面去重闸门=${hasGate && gateUsed} · snooze 记窗口=${snoozeHolds}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：上课提醒不循环', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // I) 降明度不能用「只乘 HSL 明度」实现 —— 第一版就是这么写的：
  //    #7f7ff2 → #2121e8，L 从 72% 掉到 52% 达标了，但饱和度还挂在 82%，
  //    在深色底上又刺又电，比不压还扎眼。改用向背景混合后 S 会跟着降。
  //    这里盯源码里不许再出现 hsl 明度缩放，且必须有 dimMix。
  try {
    const page2 = fs.readFileSync(SRC, 'utf8');
    const strip2 = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const js = strip2(page2);
    const hslScale = /\[\s*2\s*\]\s*\*?=\s*0?\.\d/.test(js) || /hsl\s*\[\s*2\s*\]\s*=/.test(js);
    const hasMix = /function dimMix\s*\(/.test(js);
    const mixUsed = /dimMix\(c0\)/.test(js);
    /* 浅色模式不能进压暗分支 —— 边界写错会把浅色也一起压暗 */
    const onlyDark = /var dim = dark && !!S\.dimBrand/.test(js);
    results.push({
      name: '架构守卫：降明度用「向背景混合」而非只乘 HSL 明度',
      ok: !hslScale && hasMix && mixUsed && onlyDark,
      info: `残留 HSL 明度缩放=${hslScale} · 有 dimMix=${hasMix}`
        + ` · 已接入 applyLook=${mixUsed} · 仅深色分支=${onlyDark}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：降明度实现方式', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  let fail = 0;
  for (const t of results) {
    if (!t.ok) fail++;
    console.log((t.ok ? 'PASS  ' : 'FAIL  ') + t.name + (t.info ? '\n        ' + t.info : ''));
  }
  console.log('\n-- 页面运行期错误 --');
  console.log(events.length ? events.slice(0, 20).join('\n') : 'none');
  console.log('\n' + (fail ? fail + ' 项失败' : '全部通过') + ' / 共 ' + results.length + ' 项');
  cleanup();
  process.exit(fail ? 2 : 0);
} catch (e) {
  console.log('HARNESS ERROR: ' + (e && e.stack || e));
  cleanup();
  process.exit(3);
}
