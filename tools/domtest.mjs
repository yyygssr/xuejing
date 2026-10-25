import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fileFixtures } from './filefix.mjs';

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
  /* 异步版断言：要等图片 onload / transition 这类真实回调的检查用这个，
     调用处必须 await，否则 R 会在结果回来前就被序列化。 */
  async function TA(name, fn){
    var rec = { name: name };
    try { var r = (await fn()) || {}; rec.ok = !!r.ok; rec.info = (r.info === undefined ? '' : String(r.info)); }
    catch(e){ rec.ok = false; rec.info = 'THREW: ' + (e && (e.message || e)); }
    R.push(rec);
  }
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
      pm: S.providerModels, ml: S.modelList, pr: S.priceRules, u: S.aiUsage,
      /* 2026-10-22：这几项是新增功能的数据。不加进快照，测试之间会互相污染 ——
         比如「错题本」用例清空 S.mistakes，后面的用例就少了一份真实样本。 */
      days: S.days, todos: S.todos, exams: S.exams, mistakes: S.mistakes
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
    if(x.days) S.days = x.days; if(x.todos) S.todos = x.todos;
    if(x.exams) S.exams = x.exams; if(x.mistakes) S.mistakes = x.mistakes;
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

  T('对话：加号菜单含拍照·相册·文件·搭档·换模型，图标都画出来了', function(){
    var btn = document.getElementById('plusBtn');
    var menu = document.getElementById('plusMenu');
    if(!btn || !menu) return { ok:false, info:'加号按钮或菜单容器缺失' };
    /* 原来这里是相机按钮，现在必须是加号 —— SVG 路径要对 */
    var isPlus = /M12 5v14M5 12h14/.test(btn.innerHTML);
    togglePlusMenu();
    var shown = menu.classList.contains('show');
    var rows = menu.querySelectorAll('.actrow');
    var labels = [].map.call(rows, function(r){
      var d = r.querySelector('div[style*="font-weight"]');
      return d ? d.textContent : '';
    });
    /* 每行都要有真图标（空心方框 = 图标没灌上，openSheet 修过同类坑）。
       ⚠️ 判据是「图标数 == 行数」而不是写死 4 —— 写死数字的话每次加菜单项
       都要回来改断言，而漏改的表现是「加了一项就红」，容易被顺手放宽成永真。 */
    var svgs = menu.querySelectorAll('.actrow .ic svg');
    var iconsOk = svgs.length === rows.length && rows.length >= 4
      && [].every.call(svgs, function(s){ return s && s.innerHTML.length > 4; });
    var joined = labels.join('|');
    var want = ['拍照','相册','上传文件','搭档','换个模型'];
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
        + ' 图标数=' + svgs.length + '/' + rows.length + ' 图标有内容=' + iconsOk
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
      /* 菜单行早就不带 onclick 了（改成 data-mi + 事件委托），
         要验「入口指向真实存在的函数」，得去盒子上取绑好的 items.run。
         两条路都留着：万一以后又换回内联属性，这条守卫照样能扫。 */
      var its = menu.__menuItems || [];
      its.forEach(function(it){
        /* 2026-10-24 审计修复：菜单项从「run 源码字符串」改成「act 函数引用」，
           所以这里要读函数本身（String(fn) 拿到源码）再扫函数名。
           两条路都留：run 是历史写法，act 是现在的写法。 */
        var src = (it && it.run) || (it && typeof it.act === 'function' ? String(it.act) : '');
        var re = /([A-Za-z_$][\w$]*)\s*\(/g, m2;
        while((m2 = re.exec(src))){
          if(m2[1] !== 'if' && m2[1] !== 'function') names.push(m2[1]);
        }
      });
      if(!its.length) [].forEach.call(menu.querySelectorAll('.actrow'), function(r){
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
    var keepRoles = S.roles, keepModels = JSON.stringify(S.models);
    /* 当前渠道 = deepseek，所以 chat 是「跟随」语义：生效模型看 S.models.chat
       （固定到别家时才看 roles.chat.m）。见下面「渠道绑定」那条守卫。 */
    S.roles = {chat:{p:'', m:'fast-a', fx:false}};
    S.models.chat = 'fast-a';
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
    /* 真切一次：跟随语义下要写进 S.models.chat */
    applyQuickModel('smart-b');
    var switched = S.models.chat === 'smart-b';
    /* 再点当前模型不该改动（幂等 + 提示） */
    applyQuickModel('smart-b');
    var stillOne = S.models.chat === 'smart-b';
    closePlusMenu();
    S.provider = keepP; S.providerModels = keepList; S.apiKey = keepKey;
    S.roles = keepRoles; S.models = JSON.parse(keepModels);
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

  /* 真机 v0.3.0：加号菜单点「换个模型」，菜单整个消失，模型列表没展开。
     根因不在 plusModelMenu 里：它复用的是同一个 #plusMenu 盒子，innerHTML 重建后
     .show 确实加上了 —— 但**同一次点击**继续冒泡到 document 上那个「点空白收起」处理器，
     而此时 e.target 还是被 innerHTML 换掉的**旧行**，旧行已脱离文档，
     closest('#plusMenu') 返回 null → 判定「点在菜单外」→ 刚展开的列表被立刻关掉。
     ⚠️ 这条必须走真实点击（bubbles:true）。直接调 plusModelMenu() 测不到，
        上一轮加的「模型快捷切换」守卫就是这么漏过的：它只验列表内容和切换结果，
        没验「点进去这个动作本身」。 */
  T('对话：加号菜单点「换个模型」要展开模型列表，不许同一次点击就关掉', function(){
    var keepTab = (document.querySelector('.page.active') || {}).id;
    var keepP = S.provider, keepList = S.providerModels, keepKey = S.apiKey,
      keepUrl = S.baseUrl, keepRoles = S.roles, keepModel = S.models.chat;
    try{
      S.provider = 'deepseek';
      S.providerModels = {deepseek: ['fast-a', 'smart-b']};
      S.apiKey = 'sk-test'; S.baseUrl = 'https://example.invalid';
      S.roles = {chat: {p: '', m: 'fast-a', fx: false}}; S.models.chat = 'fast-a';
      go('chat');
      closePlusMenu();
      togglePlusMenu();
      var box = document.getElementById('plusMenu');
      if(!box || !box.classList.contains('show')) return { ok:false, info:'加号菜单没打开' };
      var row = [].slice.call(box.querySelectorAll('.actrow'))
        .filter(function(x){ return x.textContent.indexOf('换个模型') >= 0; })[0];
      if(!row) return { ok:false, info:'菜单里找不到「换个模型」那一行' };
      row.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
      var open = box.classList.contains('show');
      var listed = box.textContent.indexOf('fast-a') >= 0
        && box.textContent.indexOf('smart-b') >= 0;
      var head = /共 \d+ 个模型/.test(box.textContent);
      return { ok: open && listed && head,
        info: '点完仍在=' + open + ' 列出模型=' + listed + ' 带渠道头部=' + head
          + '（菜单文案：' + box.textContent.replace(/\s+/g, ' ').slice(0, 34) + '…）' };
    } finally {
      closePlusMenu();
      S.provider = keepP; S.providerModels = keepList; S.apiKey = keepKey;
      S.baseUrl = keepUrl; S.roles = keepRoles; S.models.chat = keepModel;
      if(keepTab && keepTab !== 'page-chat') go(keepTab.replace('page-', ''));
    }
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
    /* 朗读本身也要 mock。无头 Edge 里没有可用音色，ttsSpeak 会（同步或很快）
       走 onEnd → markSpeaking(-1) 把按钮复位，于是「点了却不高亮」。
       那是**环境**问题不是产品问题 —— 真机上引擎不可用时复位同样是对的，
       不能留一个停不下来的停止态。这里只验证交互本身：
       点一下 → 高亮 + 图标变停止；再点 → 调 ttsStop 并复位成喇叭。 */
    var realForce = ttsSpeakForce, forceCalled = 0;
    ttsStop = function(){ stopped++; };
    ttsSpeakForce = function(){ forceCalled++; return true; };
    toggleSpeakMsg(0);
    var b1 = document.querySelector('[data-say="0"]');
    var onFirst = b1.classList.contains('on');
    var ico1 = b1.querySelector('.sb-i').innerHTML;
    var isStop = ico1.indexOf('<rect') >= 0;
    toggleSpeakMsg(0);
    var b2 = document.querySelector('[data-say="0"]');
    var onSecond = b2.classList.contains('on');
    var ico2 = b2.querySelector('.sb-i').innerHTML;
    ttsStop = realStop; ttsSpeakForce = realForce;
    if(keepTab2 && keepTab2 !== 'page-chat') go(keepTab2.replace('page-', ''));
    /* 打断必须真调了 ttsStop，且按钮复位成喇叭 ——
       不复位的话下次点会变成「再停一次」而不是重新朗读。 */
    return { ok: onFirst && isStop && stopped >= 2 && !onSecond
        && ico2.indexOf('M4.5 9.4') >= 0 && sizeOk && forceCalled >= 1,
      info: '尺寸=' + btnW + 'x' + btnH + '（28~32 且为正方形=' + sizeOk + '）'
        + ' 首次高亮=' + onFirst + ' 图标变停止=' + isStop
        + ' ttsStop调用=' + stopped + ' 二次后复位=' + (!onSecond)
        + ' 图标回喇叭=' + (ico2.indexOf('M4.5 9.4') >= 0)
        + ' 朗读调用=' + forceCalled };
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
    var hasMeta = txt.indexOf('TXT') >= 0 && txt.indexOf('k字') >= 0 && txt.indexOf('PDF') >= 0;
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

  /* 真机 v0.3.0：上传文件后，解析出来的正文整段出现在**用户自己的气泡**里。
     根因在 send()：它把「用户输入 + 附件正文」拼成一个 text，
     同一个 text 既 push 进 msgs 渲染气泡、又拼进 turns 发给模型 —— 一份内容两个用途。
     修法是把两者拆开：气泡只留提问 + 附件名，请求与后续轮次用完整正文。
     ⚠️ 这里拦掉 aiRequest 只取请求体，不发网络；
        「后续轮次仍带全文 / 重新生成仍带全文」是这次拆分的代价所在，必须一起验，
        否则修好「不泄漏」会换来「AI 看不见文件」。 */
  T('对话：附件正文只进请求，不进用户气泡（且后续轮次与重新生成仍带全文）', function(){
    var keepMsgs = msgs, keepReq = window.aiRequest, keepTab = (document.querySelector('.page.active') || {}).id;
    var keepP = S.provider, keepKey = S.apiKey, keepUrl = S.baseUrl,
      keepRoles = S.roles, keepModel = S.models.chat;
    var cap = [];
    try{
      window.aiRequest = function(body){ cap.push(body); };   /* 只录请求，不发出去 */
      S.provider = 'deepseek'; S.apiKey = 'sk-test'; S.baseUrl = 'https://example.invalid';
      S.roles = {chat: {p: '', m: 'fast-a', fx: false}}; S.models.chat = 'deepseek-chat';
      go('chat');
      clearAttach();
      addAttach({kind:'text', name:'算法讲义.docx', fmt:'docx',
        text:'ZZDOCXBODY 折半查找是 O(log n)', rawLen: 26, truncated:false});
      msgs = [];
      send('这份讲义讲了什么');
      var bubble = document.querySelector('.msg.me .bubble');
      var shown = bubble ? bubble.textContent : '(没有气泡)';
      var b1 = JSON.stringify(cap[0] ? cap[0].messages : '');
      var clean = shown.indexOf('ZZDOCXBODY') < 0;
      var named = shown.indexOf('算法讲义.docx') >= 0;
      var asked = shown.indexOf('这份讲义讲了什么') >= 0;
      var sentFull = b1.indexOf('ZZDOCXBODY') >= 0 && b1.indexOf('算法讲义.docx') >= 0;
      /* 第二轮：不带附件追问，历史里必须还记得文件正文 */
      clearAttach();
      msgs.push({r:'ai', t:'讲了折半查找。'});
      send('那它和二分查找有区别吗');
      var b2 = JSON.stringify(cap[1] ? cap[1].messages : '');
      var remembered = b2.indexOf('ZZDOCXBODY') >= 0;
      /* 重新生成：复用已经存在的那条提问，正文同样不能丢 */
      msgs.push({r:'ai', t:'没区别。'});
      regenChat(msgs.length - 1);
      var b3 = JSON.stringify(cap[2] ? cap[2].messages : '');
      var regenFull = b3.indexOf('ZZDOCXBODY') >= 0;
      clearAttach();
      return { ok: clean && named && asked && sentFull && remembered && regenFull,
        info: '气泡不含正文=' + clean + ' 气泡带附件名=' + named + ' 气泡保留提问=' + asked
          + ' 请求带全文=' + sentFull + ' 追问还记得=' + remembered
          + ' 重新生成还带全文=' + regenFull
          + '（气泡：' + shown.replace(/\s+/g, ' ').slice(0, 46) + '…）' };
    } finally {
      window.aiRequest = keepReq;
      msgs = keepMsgs; renderMsgs();
      S.provider = keepP; S.apiKey = keepKey; S.baseUrl = keepUrl;
      S.roles = keepRoles; S.models.chat = keepModel;
      clearAttach();
      if(keepTab && keepTab !== 'page-chat') go(keepTab.replace('page-', ''));
    }
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

  T('对话：全屏输入是同一个输入框换尺寸（不是第二个副本）', function(){
    /* 契约在 2026-10-17 变了：以前是 openSheet 里再养一个 textarea（fullInputTa），
       两份内容靠同步函数维持；现在是同一个 #chatInput 换尺寸。
       所以这条守卫要钉的是「只有一个框」+「收起后内容还在」，
       而不是「两个框互相同步」—— 那条已经不成立了。 */
    var keepTab3 = (document.querySelector('.page.active') || {}).id;
    go('chat');
    var inp = document.getElementById('chatInput');
    var keep = inp.value;
    try{
      inp.value = '小框里原有的字';
      openFullInput();
      var pg = document.getElementById('page-chat');
      var opened = pg.classList.contains('fsinput');
      /* **核心**：全屏态下页里仍然只有这一个 textarea */
      var oneBox = document.querySelectorAll('#page-chat textarea').length === 1;
      var sameNode = document.getElementById('chatInput') === inp;
      var carried = inp.value === '小框里原有的字';
      closeFullInput();
      var closed = !pg.classList.contains('fsinput');
      var survived = inp.value === '小框里原有的字';
      /* ⚠️ 判据要看**实际渲染高度**，不是 style.height。
         2026-10-24 起空态不再写内联 height（改由 CSS 撑，否则会把
         手机 Pro 档的 44px 钉成 38、两侧按钮突出来）。
         继续读 style.height 的话，空态是空串 → 0px → 假失败。 */
      var hNowRender = Math.round(inp.getBoundingClientRect().height);
      var sane = hNowRender >= 30 && hNowRender <= INPUT_MAX_H + 40;
      inp.value = new Array(20).join('很长很长很长很长很长很长很长的文字');
      autoGrowInput(inp);
      var grew = Math.round(inp.getBoundingClientRect().height) > hNowRender;
      return { ok: opened && oneBox && sameNode && carried && closed && survived && sane && grew,
        info: '全屏态=' + opened + ' 只有一个输入框=' + oneBox + ' 同一个节点=' + sameNode
          + ' 内容带过去=' + carried + ' 收起=' + closed + ' 收起后内容还在=' + survived
          + ' 高度合理=' + sane + '(' + hNowRender + 'px) 超长变高=' + grew };
    } finally {
      /* 必须收干净：脏状态会让后面量布局的用例全部错位。
         ⚠️ 光收不够 —— closeFullInput 会启动一段 FLIP 动画，而这里全是同步代码，
         后面的用例量到的是动画第一帧（元素还带着放大/位移），于是"留白相等"
         会量出 -8.3px 这种鬼值。所以把 composer 上残留的动画直接 cancel 掉。 */
      try{ closeFullInput(); }catch(e){}
      try{
        [].forEach.call(document.querySelectorAll('#page-chat .composer, .fwrap'), function(b){
          [].forEach.call(b.getAnimations ? b.getAnimations() : [], function(a){ a.cancel(); });
        });
      }catch(e){}
      inp.value = keep; autoGrowInput(inp);
      if(keepTab3 && keepTab3 !== 'page-chat') go(keepTab3.replace('page-', ''));
    }
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

  T('我的页：只剩四个大类入口，类内设置都在二级页，且字段一个不少', function(){
    /* 2026-10-19 重构：这一页从 320 行设置项收成「四类入口」。
       这一条锁两件事，缺一不可：
         ① 入口必须齐（小径/我/专注与学习/数据），且都真能打开对应的二级页；
         ② 原来那几十个字段 id 一个都不能丢 —— 它们被 renderProfile() 与
            各处的 oninput 直接 getElementById，少一个就是**静默失效**
            （不报错、只是改了没反应）。所以按 id 逐个查，而不是信任搬移。 */
    var keepTab = (document.querySelector('.page.active') || {}).id;
    go('me');
    var me = document.getElementById('page-me');
    if(!me) return { ok:false, info:'我的页缺失' };
    var cards = [].slice.call(me.querySelectorAll('.me-card'));
    var want = ['小径', '我', '专注与学习', '数据'];
    var titles = cards.map(function(e){
      var b = e.querySelector('b'); return b ? b.textContent.trim() : '';
    });
    var namesOk = titles.length === want.length
      && titles.every(function(g, i){ return g === want[i]; });
    /* 每张卡都得是能点的，且点下去目标页真的存在 */
    var openOk = cards.length > 0 && cards.every(function(e){
      var m = /openView\('([a-z]+)'\)/.exec(e.getAttribute('onclick') || '');
      return !!(m && document.getElementById('view-' + m[1]));
    });
    /* 这一页不许再留设置项（除头像卡）：.li / .h2 出现在这里就说明有人又往回堆了 */
    var leaked = me.querySelectorAll('.li, .h2, .list').length;
    var ids = ['myAvatar', 'myName', 'mySub', 'nickInput', 'aiNameInput', 'callInput',
               'callEcho', 'avatarHint', 'swMemOn', 'swMemAuto', 'memBadge', 'memCount',
               'aiEntry', 'skillBadge', 'skillCountHint', 'themeSeg', 'accentList',
               'vWorkMin', 'vShortMin', 'vLongMin', 'swAutoNext', 'swClassRemind',
               'vRemindBefore', 'swEndRemind', 'swClassMute', 'swFocusNotify', 'exactBadge',
               'islandBadge', 'vTermStart', 'termStartInput', 'swHoliday', 'holidayCountHint',
               'h2TabletNav', 'tabletNavList', 'restoreFile'];
    var lost = ids.filter(function(x){ return !document.getElementById(x); });
    if(keepTab && keepTab !== 'page-me') go(keepTab.replace('page-', ''));
    return { ok: namesOk && openOk && leaked === 0 && !lost.length,
      info: '入口=' + titles.join('/') + ' 顺序对=' + namesOk
        + ' 都能打开=' + openOk + ' 本页残留设置项=' + leaked
        + ' 丢的字段=' + (lost.join(',') || '无') };
  });

  /* ============================================================
     2026-10-22 · 第一梯队三项：学习看板 / 倒计时 / 错题本
     ------------------------------------------------------------
     这三项都不依赖网络（AI 拆解除外），所以可以在这里把数据全跑一遍。
     重点是**算对**：看板的连续天数、倒计时的天数、SM-2 的间隔，
     这三处错了界面照样好看，只有数字是错的 —— 最需要断言。
     ============================================================ */
  T('学习看板：数字卡/热力图/柱图/各科节数都按真实数据算出来', function(){
    var snap = snapState();
    try{
      /* 造 30 天数据：今天和昨天有专注、前天为 0 —— 连续天数应是 2（不是 3） */
      S.days = {};
      var dk = function(k){ var d = new Date(); d.setDate(d.getDate() + k); return dayKey(d); };
      /* ⚠️ k 为负才是过去：+1 是明天。第一版写成 +1 当「昨天」，
         于是连续天数只能数到今天自己（1），断言把正确的代码判成了错。 */
      S.days[dk(0)] = { min: 30, pomo: 1 };
      S.days[dk(-1)] = { min: 50, pomo: 2 };
      S.days[dk(-2)] = { min: 0, pomo: 0 };
      S.days[dk(-3)] = { min: 20, pomo: 1 };
      S.courses = {0:[{t:'08:00',n:'高数',loc:'A',c:0}],1:[{t:'08:00',n:'高数',loc:'A',c:0}],
                   2:[{t:'10:00',n:'物理',loc:'B',c:1}],3:[],4:[],5:[],6:[]};
      S.todos = [{id:'a',t:'一',done:true},{id:'b',t:'二',done:false}];
      save();
      go('me'); openView('stats');
      var b = document.getElementById('statsBody');
      var cells = b.querySelectorAll('.heat i').length;
      var bars = b.querySelectorAll('.bars .b').length;
      var subj = [].slice.call(b.querySelectorAll('.sbar .n')).map(function(e){ return e.textContent; });
      var txt = b.textContent.replace(/\s+/g, ' ');
      closeView('stats');
      /* 140 = 20 周 × 7 天；14 = 近 14 天柱子 */
      var shape = cells === 140 && bars === 14;
      var streak = statsStreak() === 2;
      var subjOk = subj.indexOf('高数') >= 0 && subj.indexOf('物理') >= 0;
      var rate = /待办完成率\s*50\s*%/.test(txt);
      return { ok: shape && streak && subjOk && rate,
        info: '热力格=' + cells + ' 柱=' + bars + ' 连续=' + statsStreak()
          + ' 科目=' + subj.join('/') + ' 完成率50%=' + rate };
    } finally { restoreState(snap); }
  });

  T('倒计时：未来在前过去在后、今日页有条、AI 工具能增删', function(){
    var snap = snapState();
    try{
      S.exams = []; S.todos = [];
      var dk = function(k){ var d = new Date(); d.setDate(d.getDate() + k); return dayKey(d); };
      /* 用 AI 工具的同一入口写入，顺带验证工具可用 */
      var r1 = runOneTool('addExam', { name: '高数期末', date: dk(10), kind: 'exam' });
      var r2 = runOneTool('addExam', { name: '物理报告', date: dk(2), kind: 'ddl' });
      var r3 = runOneTool('addExam', { name: '上周补考', date: dk(-3), kind: 'exam' });
      var names = examSorted().map(function(x){ return x.e.name; });
      /* 排序：两天后的最前，然后十天，最后是过去的那条 */
      var orderOk = names[0] === '物理报告' && names[1] === '高数期末' && names[2] === '上周补考';
      var daysOk = examDays(dk(2)) === 2 && examDays(dk(-3)) === -3;
      renderCountStrip();
      var strip = document.getElementById('countStrip');
      var stripTxt = strip.textContent.replace(/\s+/g, ' ');
      var inStrip = /物理报告/.test(stripTxt) && /2 天/.test(stripTxt);
      /* 今天页条只显示未来，不该出现已过去的那条 */
      var noPast = stripTxt.indexOf('上周补考') < 0;
      var listTxt = runOneTool('listExam', {}) || '';
      var del = runOneTool('delExam', { name: '物理报告' }) || '';
      var afterDel = examSorted().length;
      return { ok: orderOk && daysOk && inStrip && noPast && /2 天后/.test(listTxt)
          && /已删除/.test(del) && afterDel === 2,
        info: '排序=' + names.join(' > ') + ' 天数=' + daysOk + ' 今日页有=' + inStrip
          + ' 不显示过去=' + noPast + ' 工具删除=' + (afterDel === 2) };
    } finally { restoreState(snap); }
  });

  T('错题本：新建即到期、复习评级推进间隔、连对归档', function(){
    var snap = snapState();
    try{
      S.mistakes = [];
      /* 走真实的保存入口，而不是直接 push —— 这样 due 的初始化也被测到 */
      openSheet('mistakeform');
      document.getElementById('misSubjIn').value = '高等数学';
      document.getElementById('misQIn').value = '求 lim (sin x - x)/x³';
      document.getElementById('misReasonIn').value = '用了等价无穷小';
      mistakeSaveForm();
      var m = S.mistakes[0];
      var dueToday = !!m && m.due === todayKey();
      var inQueue = misDueFor(S.mistakes).length === 1;
      startReview();
      var qLen = __rvQueue.length;
      /* 「会了」：第一次给 1 天 */
      reviewRate(5);
      var after1 = S.mistakes[0];
      var r1 = after1.iv === 1 && after1.reps === 1 && after1.due === misDateAfter(1);
      /* ★ 必须再评一次「会了」：第一次本来就是 1 天，
         只验第一步的话，「间隔永远 1 天」这种错也能通过（实测过）。
         第二次应跳到 3 天 —— 这一步才是 SM-2 真正在工作。 */
      __rvQueue = [after1]; __rvIdx = 0; reviewRate(5);
      var r2 = after1.iv === 3 && after1.reps === 2;
      /* 连对到 5 次应归档 */
      for(var i = 0; i < 4; i++){ if(!after1.arch){ __rvQueue = [after1]; __rvIdx = 0; reviewRate(5); } }
      var archived = !!S.mistakes[0].arch;
      /* 「忘了」回到明天 */
      var m2 = { id: 'x', q: 'q', due: todayKey(), iv: 9, ef: 2.5, reps: 2, arch: false };
      S.mistakes.push(m2);
      __rvQueue = [m2]; __rvIdx = 0;
      reviewRate(1);
      var forgot = m2.iv === 1 && m2.reps === 0;
      closeView('review'); closeSheet();
      return { ok: dueToday && inQueue && qLen >= 1 && r1 && r2 && archived && forgot,
        info: '新建即到期=' + dueToday + ' 进队列=' + inQueue + ' 首评1天=' + r1
          + ' 二次3天=' + r2 + ' 连对归档=' + archived + ' 忘了回1天=' + forgot };
    } finally { restoreState(snap); }
  });

  T('错题本 AI 工具：增 / 查 / 改 / 删 都能落到数据上', function(){
    var snap = snapState();
    try{
      S.mistakes = [];
      var r1 = runOneTool('addMistake', { q: '求 lim (sin x - x)/x^3', subj: '高等数学', point: '洛必达' });
      var id = S.mistakes[0] && S.mistakes[0].id;
      var list1 = runOneTool('listMistake', {}) || '';
      var r2 = runOneTool('editMistake', { id: id, reason: '等价无穷小用错', steps: '展开到三阶' });
      var m = S.mistakes[0] || {};
      var dueList = runOneTool('listMistake', { due: 'true' }) || '';
      /* ★ 还要看**有没有落盘**：只查内存的话，「忘记 save()」这种错抓不到 ——
         用户改完看着是对的，一重启就没了（实测注入 save 缺失时内存断言照样绿）。 */
      var disk = {};
      try{ disk = JSON.parse(localStorage.getItem(KEY) || '{}'); }catch(e){}
      var persisted = (disk.mistakes || []).some(function(x){
        return x.id === id && x.reason === '等价无穷小用错' && x.steps === '展开到三阶';
      });
      var r3 = runOneTool('delMistake', { q: 'sin x' });
      return { ok: /已加进/.test(r1) && !!id && /洛必达/.test(list1)
          && /已更新/.test(r2) && m.reason === '等价无穷小用错' && m.steps === '展开到三阶'
          && /今天该复习/.test(dueList) && persisted && /已删除/.test(r3) && S.mistakes.length === 0,
        info: '新增=' + /已加进/.test(r1) + ' 列出=' + /洛必达/.test(list1)
          + ' 修改=' + (m.reason === '等价无穷小用错') + ' 已落盘=' + persisted
          + ' 到期列表=' + /今天该复习/.test(dueList) + ' 删除=' + (S.mistakes.length === 0) };
    } finally { restoreState(snap); }
  });

  await TA('错题拍照录入：识图结果预填表单、确认后才入库、失败有出路', async function(){
    var snap = snapState();
    var origVision = aiVision, origKey = hasKey, origReady = aiReady, origSv = solveHasVision;
    try{
      S.mistakes = [];
      aiVision = function(role, prompt, img, cb){
        window.__misOcrPrompt = prompt;
        /* 故意让返回值套一层 json 围栏：模型经常这么干
           （注释与字符串里都不能出现反引号，String.raw 模板会被截断） */
        setTimeout(function(){
          var fence = String.fromCharCode(96, 96, 96);
          cb(true, fence + 'json\n{"subj":"大学物理","point":"动量守恒","q":"两球对心碰撞，求碰后速度"}\n' + fence);
        }, 10);
      };
      hasKey = function(){ return true; };
      aiReady = function(){ return true; };
      solveHasVision = function(){ return true; };
      mistakeOcrRun('data:image/png;base64,AAAA');
      await sleep(120);
      var formOpen = window.__sheetKind === 'mistakeform';
      var subj = (document.getElementById('misSubjIn') || {}).value || '';
      var q = (document.getElementById('misQIn') || {}).value || '';
      var savedBefore = S.mistakes.length;      /* 关键：还没保存时不该入库 */
      var promptOk = /不要编造数字|绝对不要编造/.test(window.__misOcrPrompt || '');
      mistakeSaveForm();
      var savedOk = S.mistakes.length === 1 && S.mistakes[0].due === todayKey();
      /* 失败分支：按钮要真的能进手动表单，不能只改文案 */
      aiVision = function(role, prompt, img, cb){ setTimeout(function(){ cb(false, '网络超时'); }, 10); };
      closeSheet();
      openSheet('mistakeocr', { img: '' });
      mistakeOcrRun('data:image/png;base64,AAAA');
      await sleep(120);
      var hint = (document.getElementById('misOcrStatus') || {}).textContent || '';
      var ghost = document.querySelector('#sheet .btn.ghost');
      var btnOk = !!ghost && /手动填写/.test(ghost.textContent)
        && /mistakeAddPrompt/.test(ghost.getAttribute('onclick') || '');
      closeSheet();
      return { ok: formOpen && subj === '大学物理' && /碰撞/.test(q) && savedBefore === 0
          && savedOk && promptOk && /识别失败/.test(hint) && btnOk,
        info: '预填=' + (subj + '/' + q.slice(0, 8)) + ' 未保存不入库=' + (savedBefore === 0)
          + ' 保存后到期=' + savedOk + ' 提示词防编造=' + promptOk
          + ' 失败提示=' + /识别失败/.test(hint) + ' 失败有出路=' + btnOk };
    } finally {
      aiVision = origVision; hasKey = origKey; aiReady = origReady; solveHasVision = origSv;
      closeSheet();
      restoreState(snap);
    }
  });

  /* ⚠️ 用 TA + await：这条要等退场动画收尾，同步 T 会读到动画中间态
     （而且 T 不认 Promise 返回值，写错就是静默失败）。 */
  await TA('我的页：四个大类页各自能返回上一层（不是一路掉回标签页）', async function(){
    /* 二级页同时只有一层是 show，所以「从哪来」必须显式记。
       实际路径：我的 → 小径 → 技能 → 返回 → 应回到小径（不是我的）。
       不测这条的话，从子页返回会「跳两级」，用户会觉得点错了。 */
    var keepTab = (document.querySelector('.page.active') || {}).id;
    go('me');
    /* 先清干净：别的断言可能留了一个开着的二级页（实测这里残留过 view-memory），
       不清的话"最后有没有残留"这一判据会被它污染成假失败。 */
    document.querySelectorAll('.view.show').forEach(function(o){ o.classList.remove('show'); });
    document.body.classList.remove('view-open');
    openView('xj');
    var okXj = document.getElementById('view-xj').classList.contains('show');
    openView('skills');
    var okSk = document.getElementById('view-skills').classList.contains('show');
    var xjHidden = !document.getElementById('view-xj').classList.contains('show');
    closeView('skills');
    var backToXj = document.getElementById('view-xj').classList.contains('show');
    closeView('xj');
    /* 退场动画 320ms，收尾后才真正摘干净 —— 同步读会读到"还在播"的中间态，
       所以这里等一下再判（不是放宽标准，是不测动画中间态）。 */
    await new Promise(function(res){ setTimeout(res, 420); });
    var left = [].slice.call(document.querySelectorAll('.view.show')).map(function(e){ return e.id; });
    var noView = left.length === 0;
    var scrimOff = !document.body.classList.contains('view-open');
    if(keepTab && keepTab !== 'page-me') go(keepTab.replace('page-', ''));
    return { ok: okXj && okSk && xjHidden && backToXj && noView && scrimOff,
      info: '小径打开=' + okXj + ' 技能打开=' + okSk + ' 父页已收=' + xjHidden
        + ' 返回回到小径=' + backToXj + ' 再返回残留=' + (left.join(',') || '无')
        + ' scrim已收=' + scrimOff };
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

  T('二级页顶栏：标题在整页水平居中（不管有没有右上角按钮）', function(){
    /* 用户没提，是截图看出来的：新加的四个类页有几页没有右上角按钮，
       而 .viewhead 是 space-between —— 两块时标题被顶到最右边。
       这类「只有部分页面才歪」的问题，肉眼看当前页很难发现，
       所以按「有按钮 / 无按钮」两类各取样本量一次。 */
    var keep = (document.querySelector('.page.active') || {}).id;
    function centerGap(id){
      var v = document.getElementById('view-' + id);
      if(!v) return { ok:false, why:'页不存在' };
      var wasShown = v.classList.contains('show');
      if(!wasShown){ go('home'); openView(id); }
      var b = v.querySelector('.viewhead > b');
      var head = v.querySelector('.viewhead');
      if(!b || !head) return { ok:false, why:'无标题' };
      var gr = head.getBoundingClientRect(), br = b.getBoundingClientRect();
      var gap = Math.abs((br.left + br.right) / 2 - (gr.left + gr.right) / 2);
      if(!wasShown) closeView(id);
      return { ok: gap <= 8, gap: Math.round(gap) };
    }
    var noBtn = centerGap('study');     /* 无右上角按钮 */
    var withBtn = centerGap('memory');  /* 有右上角「+」 */
    if(keep && keep !== 'page-me') go(keep.replace('page-', ''));
    return { ok: noBtn.ok && withBtn.ok,
      info: '无按钮页偏移=' + noBtn.gap + 'px · 有按钮页偏移=' + withBtn.gap + 'px（各应 ≤8px）' };
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
  T('专注条的入口齐全（收起 / 展开 / 点按 / 应用形态 / 绑定拖动）', function(){
    var need = ['fbCollapse', 'fbExpand', 'fbTap', 'fbApply', 'fbBindDrag', 'fbSetShape', 'fbRelayout'];
    var missing = need.filter(function(k){ return typeof window[k] !== 'function'; });
    /* 旧的三段式入口必须已经消失，不然说明那套「第几下才全屏」又回来了 */
    var gone = typeof window.fbClick === 'undefined' && typeof window.fbToggleShape === 'undefined';
    return { ok: missing.length === 0 && gone,
      info: '缺=' + (missing.join(',') || '无') + ' · 旧三段式入口已清除=' + gone };
  });
  T('节假日入口在「专注与学习」页，不在完整课表页', function(){
    /* 2026-10-19：节假日原先在「我的」页里，重构后随「学期与节假日」整节
       搬进「专注与学习」。判据改为在那一页里找，仍然不许出现在完整课表页
       —— 后者是「看课表」，不该长出改设置的东西。 */
    go('me');
    var xj = document.getElementById('view-study');
    var inStudy = xj && /节假日模式/.test(xj.textContent) && /节假日设置/.test(xj.textContent);
    var mePage = document.getElementById('page-me');
    var notOnMe = mePage && !/节假日模式/.test(mePage.textContent);
    openSchedule();
    var sched = document.getElementById('view-schedule');
    var inSched = sched && /节假日模式/.test(sched.textContent);
    closeView('schedule');
    return { ok: !!inStudy && !!notOnMe && !inSched,
      info: '专注与学习页=' + !!inStudy + ' 我的页已移走=' + !!notOnMe + ' 课表页仍有=' + !!inSched };
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
  T('曾丢分支的弹层能真正渲染出内容', function(){
    /* 'cam'（拍照给 AI 的确认弹层）已删除：拍照/相册改成直接唤起系统相机，
       图片直接用胶囊附件带走，不再经过确认弹层。
       'chathist' 也移出这份名单：历史会话从底部弹层改成了左侧抽屉，
       它的行为在「历史对话侧栏」那条里量。 */
    var cases = [
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

  /* ================= 历史对话侧栏 ================= */
  T('历史侧栏：老数据能迁移，点一条会先存当前，长按菜单可收藏/归档/删除', function(){
    var keep = JSON.stringify({ h:S.chatHistory, m:msgs, c:S.curChatId });
    var d = document.getElementById('histDrawer'), scrim = document.getElementById('histScrim');
    var list = document.getElementById('histList');
    if(!d || !list) return { ok:false, info:'找不到 #histDrawer / #histList' };
    try{
      /* 老格式：只有 {title,when,msgs}，没有 id / ts / fav */
      S.chatHistory = [
        { title:'老会话甲', when:'周一', msgs:[{r:'me',t:'a'},{r:'ai',t:'b'}] },
        { title:'老会话乙', when:'周二', msgs:[{r:'me',t:'c'}] }
      ];
      var migrated = migrateChatHistory();
      var hasIds = S.chatHistory.every(function(h){ return h.id != null && h.ts != null; });

      openHistDrawer();
      var opened = d.classList.contains('show') && scrim.classList.contains('show');
      var cards = [].slice.call(list.querySelectorAll('.hist-card'));

      /* 点一条 = 切过去，且「手上这段」先被归档（不丢当前对话） */
      msgs = [{r:'ai',t:'系统开场'},{r:'me',t:'正在写的'},{r:'ai',t:'答'}];
      S.curChatId = '';
      cards[0].click();
      var switched = msgs.some(function(m){ return m.t === 'a'; });
      var curSaved = (S.chatHistory || []).some(function(h){ return h.title === '正在写的'; });
      var drawerClosed = !d.classList.contains('show');

      /* 收藏 → 置顶 + 出现在「收藏」筛选里 */
      var topId = S.chatHistory[0].id;
      favChatSession(topId);
      var starred = !!histById(topId).fav;
      setHistFilter('fav');
      var favOnly = [].slice.call(list.querySelectorAll('.hist-card')).length === 1;

      /* 归档 → 从「全部」里消失，「已归档」里能看到，且可恢复 */
      setHistFilter('all');
      var beforeArch = list.querySelectorAll('.hist-card').length;
      archiveChatSession(topId);
      var afterArch = list.querySelectorAll('.hist-card').length;
      setHistFilter('arch');
      var inArch = list.querySelectorAll('.hist-card').length === 1;
      archiveChatSession(topId);
      setHistFilter('all');
      var restored = list.querySelectorAll('.hist-card').length === beforeArch;

      /* 长按菜单：页面侧断言是同步跑的，setTimeout 在忙等里不会触发，
         所以这里直接调 histActions 验菜单内容，
         「手势真的绑上了 + 480ms 阈值」交给下面那条源码守卫。 */
      var c0 = list.querySelector('.hist-card');
      var hid = c0.getAttribute('data-hid');
      histActions(hid, {x:120, y:400});
      var mm = document.getElementById('msgMenu');
      var menuTxt = (mm.textContent || '').replace(/\s+/g,' ');
      var menuOk = mm.classList.contains('show')
        && menuTxt.indexOf('收藏') >= 0 && menuTxt.indexOf('归档') >= 0 && menuTxt.indexOf('删除') >= 0;
      closeMsgMenu();

      /* 删除走确认弹层，删完回到侧栏而不是关掉它 */
      var n0 = (S.chatHistory || []).length;
      delChatSession(S.chatHistory.findIndex(function(h){ return String(h.id) === String(topId); }));
      var n1 = (S.chatHistory || []).length;
      var backToDrawer = d.classList.contains('show');

      return {
        ok: migrated && hasIds && opened && cards.length === 2 && switched && curSaved
          && drawerClosed && starred && favOnly && afterArch === beforeArch - 1
          && inArch && restored && menuOk && n1 === n0 - 1 && backToDrawer,
        info: '迁移=' + migrated + '/有id=' + hasIds + ' · 列表 ' + cards.length + ' 条 · 点开切换=' + switched
          + ' · 当前已存=' + curSaved + ' · 选完收栏=' + drawerClosed
          + ' · 收藏置顶=' + (starred && favOnly) + ' · 归档' + beforeArch + '→' + afterArch + '/可恢复=' + restored
          + ' · 长按菜单=' + menuOk + ' · 删除 ' + n0 + '→' + n1 + ' 回侧栏=' + backToDrawer
      };
    } finally {
      var o = JSON.parse(keep);
      S.chatHistory = o.h; msgs = o.m; S.curChatId = o.c;
      histFilter = 'all'; save(); closeHistDrawer(); closeMsgMenu();
    }
  });

  /* 顶部那两块（小径头像行 + 「已接上…」状态条）是皮肤里的黑块来源，整块删掉；
     但删元素最容易留雷：还写着 #chatModel / #aiAvatar 的渲染函数会在切页时抛异常。 */
  T('对话页顶部两块已删除，且没有遗留代码引用它们', function(){
    var gone = !document.getElementById('chatAiBar') && !document.getElementById('chatAiName')
      && !document.getElementById('chatModel') && !document.querySelector('#page-chat .chat-head');
    var btns = !!document.querySelector('#page-chat .chat-top .icon-btn[onclick="openHistDrawer()"]')
      && !!document.querySelector('#page-chat .chat-top .icon-btn[onclick="startNewChat()"]');
    var raw = document.documentElement.innerHTML;
    /* 允许出现在注释里，不许还有活的 DOM 引用 */
    var live = /getElementById\('(chatModel|chatAiName|aiAvatar)'\)\s*\.\s*(textContent|innerHTML|style)/.test(raw);
    var noThrow = true;
    try{ renderChatAiBar(); renderProfile(); }catch(e){ noThrow = e; }
    /* openSheet('chathist') 保留成重定向：老调用点不能弹出一张空白 sheet */
    openSheet('chathist');
    var redirected = document.getElementById('histDrawer').classList.contains('show')
      && !document.getElementById('mask').classList.contains('show');
    closeHistDrawer();
    return {
      ok: gone && btns && !live && noThrow === true && redirected,
      info: '元素已删=' + gone + ' · 两颗按钮=' + btns + ' · 无活引用=' + !live
        + ' · 渲染不抛=' + (noThrow === true ? true : String(noThrow)) + ' · 旧kind转侧栏=' + redirected
    };
  });

  /* ================= 本轮真机反馈：几何与交互 ================= */

  /* 分段控件的「椭圆滑块和外框没对齐」：皮肤给 .seg 加了 1px 边框，
     而滑块是相对 padding box 定位的，于是上留 3px、下只留 1px。
     这条量的是**真实四个方向的间隙**，不是样式字符串。 */
  /* 分段控件的「椭圆滑块和外框没对齐」：皮肤给 .seg 加了 1px 边框，
     而滑块是相对 padding box 定位的，于是上留 3px、下只留 1px。
     这条量的是**真实四个方向的间隙**，不是样式字符串。
     两档控件（主题）没有「中间那格」可量，几何部分并到下面那条异步断言里。 */
  T('分段控件：滑块在轨道里上下左右四边间隙相等（真机踩过：外框和滑块不齐）', function(){
    var seg = document.getElementById('themeSeg'), th = document.getElementById('segThumb');
    if(!seg || !th) return { ok:false, info:'找不到 #themeSeg / #segThumb' };
    function gaps(){
      var a = seg.getBoundingClientRect(), b = th.getBoundingClientRect();
      return { top: Math.round(b.top - a.top), bottom: Math.round(a.bottom - b.bottom),
        left: Math.round(b.left - a.left), right: Math.round(a.right - b.right) };
    }
    var off = gaps();
    S.uiTheme = 'pro'; applyLook();
    var on = gaps();
    S.uiTheme = 'classic'; applyLook();
    var even = function(g){ return g.top === g.bottom && g.left === g.right && g.top >= 2 && g.top <= 4; };
    return {
      ok: even(off) && even(on),
      info: '经典 上' + off.top + '/下' + off.bottom + '/左' + off.left + '/右' + off.right
        + ' · 皮肤 上' + on.top + '/下' + on.bottom + '/左' + on.left + '/右' + on.right
    };
  });

  /* 悬浮底栏原来只有图标变色，「认不出当前在哪一页」。
     滑块是一颗 .tabbar::after，位置由 go() 写的 --tab-i 决定。
     带 transition，所以每次切完要等一下再读（TA 是异步断言）。 */
  await TA('底栏选中滑块：三档各自到位，且切页时 --tab-i 跟着走', async function(){
    var bar = document.querySelector('.tabbar');
    if(!bar) return { ok:false, info:'找不到 .tabbar' };
    var keep = S.uiTheme;
    var prev = (document.querySelector('.page.active') || {}).id || 'page-home';
    S.uiTheme = 'pro'; applyLook();
    function pseudo(){ return getComputedStyle(bar, '::after'); }
    function step(){
      var t = pseudo().transform;
      var m = /matrix\(([^)]*)\)/.exec(t);
      return { raw: t, x: m ? parseFloat(m[1].split(',')[4]) : (t === 'none' ? 0 : NaN) };
    }
    async function at(tab){
      go(tab);
      /* 滑块走的是带回弹的曲线（ease-spring），会先冲过头再落回来；
         420ms 时它还在收尾，读到 -0.14 这种值。等足 700ms 再量。 */
      await sleep(700);
      var s = step();
      return { x: s.x, raw: s.raw, i: bar.style.getPropertyValue('--tab-i'),
        w: parseFloat(pseudo().width) };
    }
    var h = await at('home'), c = await at('chat'), m2 = await at('me');
    await at('home');
    go(prev.replace('page-', ''));
    S.uiTheme = keep; applyLook();
    var shown = h.w > 40;
    /* 一格 = 滑块自身宽度（translateX 用百分比）。
       ⚠️ 别写死像素阈值：2026-10-23 dock 从「铺满 406px」收成「居中 292px」，
       一格从 135 变 92，写死 100 的那版就假失败了。这里按实测格宽推导：
       第二档 ≈ 2 格、第三档 ≈ 1 格，允许 2px 误差（百分比 translate 会有小数）。 */
    var cell = h.w;
    var moved = Math.abs(h.x) < 1 && Math.abs(c.x - cell) <= 2 && Math.abs(m2.x - cell * 2) <= 2;
    return {
      ok: shown && moved && h.i === '0' && c.i === '1' && m2.i === '2',
      info: '滑块宽=' + h.w.toFixed(0) + ' · 位移 ' + h.x + '→' + c.x + '→' + m2.x
        + '（每格应 ' + cell.toFixed(0) + '） · --tab-i ' + h.i + '/' + c.i + '/' + m2.i
    };
  });

  /* 2026-10-23：底栏收窄（Pro dock 68→56、经典 74→66）+ 胶囊液化。
     这条锁三个「改尺寸时最容易悄悄坏」的点：
     ① 胶囊矮了之后不能压住文字 —— 44px 对 20px 图标 + 10px 字是能包住的；
     ② **左右余量必须比拉伸量大** —— 满拉伸每边扩 (宽 × 0.20 / 2)，
        原来 10px 余量实测溢出 4px，顶出 dock 的圆角外面；
     ③ --pill-in 必须真的定义在 .tabbar 上。只写 var(--pill-in,10px) 这种 fallback
        的话，JS 的 getComputedStyle 读到空串 → 回落 6 → 拖动换算和渲染差 4px。 */
  /* 2026-10-23 用户反馈三条：
     ① 外圈圆角不够圆润 ② 侧边到胶囊的距离和上下不一致 —— 其实是同一件事：
     外框和胶囊不是同心圆弧，缝就不是等宽的。判据不是"圆角看起来多少度"，
     而是**四边留白相等 + 外框圆角 = 胶囊圆角 + 留白**（同心条件）。
     ③ Classic 档也要能设背景图，且不该再显示玻璃档那套标识。 */
  /* 2026-10-23：平板端重构。
     用户三条要求：
     ① UI Pro 的平板也改成「悬浮侧栏」（Classic 保持原样）；
     ② 侧边加**只读**小组件栏，与导航同侧但占另一端（导航是椭圆、组件是圆角方形）；
     ③ 「平板布局」设置从「专注与学习」挪到「外观」，并把左/右与顶/中/底改成滑块。
     这条锁几何关系，不锁像素值 —— 换机型不用改。 */
  T('侧边小组件可自定义：勾了就一定显示（没数据也只是 0，不消失）', function(){
    var keep = S.sideWidgets, keepDays = S.days, keepExams = S.exams, keepTodos = S.todos;
    var root = document.documentElement;
    var keepCls = root.className, keepTheme = S.uiTheme;
    try{
      /* ⚠️ 必须先变成「平板 + Pro」：navw-on 只在那种状态下才加，
         否则 #sidewig 根本不渲染，测出来永远是 0 块（第一版就这么假失败）。 */
      root.classList.add('layout-tablet');
      setUiTheme('pro');
      /* ① 全部清空数据 —— 这是用户实测"只显示一个"的现场。
         勾了 3 个就必须出 3 块（值可以是 0 / —），不能因为没数据就整块消失。
         否则用户会以为功能坏了。 */
      S.days = {}; S.exams = []; S.todos = []; S.mistakes = [];
      S.sideWidgets = ['exam', 'focus', 'todo'];
      renderSideWidgets();
      var box = document.getElementById('sidewig');
      var n1 = box.children.length;

      /* ② 七项全开 → 必须 7 块，且顺序按候选表（不是勾选顺序） */
      S.sideWidgets = ['pomo','streak','exam','focus','todo','review','week'];
      renderSideWidgets();
      var n2 = box.children.length;
      var order = [].slice.call(box.querySelectorAll('.k')).map(function(e){ return e.textContent; });
      var orderOk = order[0] === '最近截止' && order[6] === '今日番茄';

      /* ③ 不认识的 id 要过滤掉（版本回退 / 手改存档） */
      S.sideWidgets = ['exam', 'nope', 'zzz'];
      var picked = sideWidgetPick();
      var filtered = picked.length === 1 && picked[0] === 'exam';

      /* ④ 选择器芯片的选中态要跟数据一致 */
      S.sideWidgets = ['focus', 'review'];
      renderSideWidgetPicker();
      var chips = document.querySelectorAll('#sidePickList .swpick');
      var onChips = document.querySelectorAll('#sidePickList .swpick.on').length;
      var pickSync = chips.length === SIDE_WIDGETS.length && onChips === 2;

      return {
        ok: n1 === 3 && n2 === 7 && orderOk && filtered && pickSync,
        info: '空数据 3 项 → 出 ' + n1 + ' 块 · 全开 7 块=' + n2
          + ' 顺序对=' + orderOk + ' · 脏 id 过滤=' + filtered
          + ' · 芯片 ' + chips.length + ' 个/选中 ' + onChips
      };
    } finally {
      S.sideWidgets = keep; S.days = keepDays; S.exams = keepExams; S.todos = keepTodos;
      root.className = keepCls; S.uiTheme = keepTheme;
      try{ applyLook(); renderSideWidgets(); }catch(e){}
    }
  });

  T('平板 Pro 输入行是悬浮的：外层容器无边框、无底色、无圆角', function(){
    var root = document.documentElement;
    var keep = { cls: root.className, theme: S.uiTheme };
    var prev = (document.querySelector('.page.active') || {}).id || 'page-home';
    var c = document.querySelector('#page-chat .composer');
    var inp = document.getElementById('chatInput');
    if(!c || !inp) return { ok:false, info:'缺 composer / chatInput' };
    try{
      root.classList.add('layout-tablet');
      setUiTheme('pro');
      go('chat');
      var cs = getComputedStyle(c);
      /* 外层容器必须是"看不见的"——用户报的"外面还有方框"就是它有 border + 底色。 */
      var outerGone = parseFloat(cs.borderTopWidth) === 0
        && parseFloat(cs.borderTopLeftRadius) === 0
        && (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent')
        && (cs.boxShadow === 'none' || cs.boxShadow === '');
      var ics = getComputedStyle(inp);
      var inputPill = parseFloat(ics.borderTopLeftRadius) > 0
        && parseFloat(ics.borderTopWidth) > 0;
      var innerH = Math.round(inp.getBoundingClientRect().height);
      /* Classic 平板必须**保持原来的方块**（它有边框和底色），不能被这次改动带走 */
      setUiTheme('classic');
      var ccs = getComputedStyle(c);
      var classicKept = parseFloat(ccs.borderTopWidth) > 0
        && parseFloat(ccs.borderTopLeftRadius) > 0;
      return {
        ok: outerGone && inputPill && classicKept,
        info: 'Pro 外层无框=' + outerGone + '（border ' + cs.borderTopWidth
          + ' / radius ' + cs.borderTopLeftRadius + '）· 输入胶囊=' + inputPill
          + '（radius ' + ics.borderTopLeftRadius + ' 高 ' + innerH + '）· Classic 保留方块=' + classicKept
      };
    } finally {
      root.className = keep.cls;
      S.uiTheme = keep.theme; applyLook();
      try{ go(prev.replace('page-', '')); }catch(e){}
    }
  });

  /* ===== BUGFIX-01：全屏遮罩残留 与 键盘弹层空块（2026-10-25）=====
     这两个是独立的功能 bug，与安全审计无关。断言按 audit/BUGFIX-01 第 3 节写。 */

  await TA('BUG-1：取消裁图后，迟到的 onload 不该重新打开遮罩', async function(){
    /* 这是 BUG-1 的**根因**复现：t0 选图 → t1 用户取消 → t2 解码完成才 onload。
       修复前 onload 是无条件 add('show')，#cropMask（z-95）就永久盖住整页。 */
    var m = document.getElementById('cropMask');
    var img = document.getElementById('cropImg');
    var keep = CROP;
    try{
      openCropper({ src:'data:image/png;base64,iVBORw0KGgo=', onApply:function(){} });
      var cb = img.onload;          /* 抓住这一代的回调 */
      closeCropper();               /* 用户点了取消 */
      if(cb) cb.call(img);          /* 解码这时才完成 */

      /* ★ 必须在**同一帧**读：晚一步的话，healStuckLayers 的兜底会把残留清掉，
         于是「令牌没生效」也会 PASS —— 那正是假通过。
         这里要验的是「回调**本身**有没有把遮罩打开」，不是「最终有没有被兜住」。 */
      var shownSync = m.classList.contains('show');

      await sleep(80);
      var shownAfter = m.classList.contains('show');
      return { ok: !shownSync && !shownAfter,
               info: '回调瞬间=' + shownSync + ' 80ms后=' + shownAfter + ' CROP=' + !!CROP };
    } finally {
      CROP = keep; m.classList.remove('show');
    }
  });

  T('BUG-1：残留的裁图遮罩能被自愈清掉', function(){
    var m = document.getElementById('cropMask');
    var keep = CROP;
    try{
      CROP = null;                  /* 业务状态是「没在裁」 */
      m.classList.add('show');      /* 但 DOM 还开着 = 脏 */
      healStuckLayers();
      var still = m.classList.contains('show');
      return { ok: !still, info: 'stillShown=' + still };
    } finally { CROP = keep; }
  });

  T('BUG-1：所有全屏层隐藏时都不吃指针事件', function(){
    /* 结构性保证：即使将来某条异步路径又写回 display，
       只要 .show 不在，就不该挡住点击。 */
    var bad = [];
    ['cropMask','mask','pickMask','noteFull','inkFull','onboard'].forEach(function(id){
      var el = document.getElementById(id);
      if(!el) return;
      if(el.classList.contains('show')) return;      /* 开着的时候本来就该吃事件 */
      var cs = getComputedStyle(el);
      if(cs.display !== 'none' && cs.pointerEvents !== 'none') bad.push(id + ':' + cs.pointerEvents);
    });
    return { ok: bad.length === 0, info: bad.join(' | ') || '全部安全' };
  });

  await TA('BUG-1：注入残留后，二级页中心点必须命中页面自己', async function(){
    /* 用户描述「内容看得见、点任何东西都没反应」—— 这条直接量「点到的是谁」。 */
    var views = ['todos','notes','schedule','skills'];
    var bad = [];
    var keep = CROP;
    for(var i = 0; i < views.length; i++){
      var id = views[i];
      CROP = null;
      document.getElementById('cropMask').classList.add('show');   /* 人为制造残留 */
      openView(id);
      await sleep(420);
      var v = document.getElementById('view-' + id);
      var hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      var ok = !!(v && hit && v.contains(hit));
      if(!ok) bad.push(id + '→' + (hit ? (hit.id || String(hit.className).slice(0, 14)) : 'null'));
      closeView(id);
      await sleep(320);
    }
    CROP = keep;
    return { ok: bad.length === 0, info: '被挡=' + (bad.join(',') || '无') };
  });

  T('BUG-1：返回键认得裁图层（先关裁图，不误关下面的二级页）', function(){
    var m = document.getElementById('cropMask');
    var keep = CROP;
    try{
      openView('theme');
      CROP = { aspect:null };
      m.classList.add('show');
      var layer = currentLayer();
      var handled = androidBack();
      var cropGone = !m.classList.contains('show');
      /* 二级页必须还在：否则用户按一次返回会连跳两层 */
      var viewStill = (document.getElementById('view-theme') || {}).classList.contains('show');
      return { ok: layer === 'crop' && handled === true && cropGone && viewStill,
               info: 'layer=' + layer + ' 裁图已关=' + cropGone + ' 页还在=' + !!viewStill };
    } finally {
      CROP = keep; m.classList.remove('show');
      try{ closeView('theme'); }catch(e){}
    }
  });

  await TA('BUG-2：键盘收起后 --vh 必须回到整屏（resetVH 硬复位）', async function(){
    var full = Math.round(window.innerHeight);
    var keepMax = _vhMax, keepFirst = _vhFirst;
    try{
      /* 模拟键盘态：--vh 被写成小值，且基准记住了整屏 */
      document.documentElement.classList.add('kb-open');
      document.documentElement.style.setProperty('--vh', (full - 300) + 'px');
      _vhMax = full;
      /* 模拟收起 */
      document.documentElement.classList.remove('kb-open');
      resetVH();
      await sleep(120);
      var vh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vh'));
      return { ok: Math.abs(vh - full) <= 2, info: 'vh=' + vh + ' innerHeight=' + full };
    } finally {
      _vhMax = keepMax; _vhFirst = keepFirst;
      document.documentElement.classList.remove('kb-open');
    }
  });

  T('BUG-2：kb-need-pad 只在「容器没跟着缩」时才让位', function(){
    /* 这条守的是那个很容易做错的地方：
       正常 adjustResize 机型上 #phone 已经缩了，再让一次就是抬两遍。 */
    var root = document.documentElement;
    var keepCls = root.className;
    var m = document.getElementById('mask');
    try{
      root.classList.remove('kb-need-pad');
      var before = getComputedStyle(m).bottom;
      root.classList.add('kb-need-pad');
      root.style.setProperty('--kb-height', '300px');
      var after = getComputedStyle(m).bottom;
      /* 没标记时 bottom 应为 0（正常铺满）；有标记才抬 300 */
      var ok = (parseFloat(before) === 0) && (Math.round(parseFloat(after)) === 300);
      return { ok: ok, info: '无标记bottom=' + before + ' 有标记bottom=' + after };
    } finally {
      root.className = keepCls;
      root.style.removeProperty('--kb-height');
    }
  });

  /* ===== 审计 P0 安全断言（2026-10-24）=====
     审计报告的结论是：这 4 条 XSS「代码路径一直存在，只是没人验证」。
     所以回归断言比修复本身更值钱 —— 它们能防止以后有人又把内容拼回 innerHTML。
     每条都是「注入恶意内容 → 断言它没执行」。 */
  await TA('安全：笔记正文不执行脚本', async function(){
    var keep = S.notes;
    window.__xss1 = 0;
    try{
      S.notes = [{ id:'t1', title:'t', mode:'text', at:Date.now(),
        body:'<img src=x onerror="window.__xss1=1"><b>ok</b>' }];
      noteOpen('t1');
      await sleep(400);
      /* 除了「没执行」，还要确认净化没有把内容整个丢掉（<b> 应该还在） */
      var body = (S.notes[0] || {}).body || '';
      var keptBold = document.getElementById('notePreview')
        ? /<b>/.test(document.getElementById('notePreview').innerHTML) : true;
      return { ok: window.__xss1 === 0 && keptBold,
               info: 'executed=' + window.__xss1 + ' 粗体保留=' + keptBold };
    } finally { S.notes = keep; }
  });

  await TA('安全：笔记列表的 id 与 inkPng 不注入', async function(){
    var keep = S.notes;
    window.__xss2 = 0;
    try{
      S.notes = [{ id:"n');window.__xss2=1;//", title:'t', mode:'ink', at:Date.now(),
        body:'x', inkPng:'x" onerror="window.__xss2=2' }];
      /* 上一条断言 noteOpen() 过，笔记页可能还停在「编辑某篇」的内部态，
         直接 openView('notes') 不会重画列表。先退回列表层再进。 */
      try{ noteBackAction(); }catch(e){}
      try{ noteBack(); }catch(e){}
      openView('notes');
      try{ renderNotes(); }catch(e){}
      await sleep(450);
      /* id 应被 safeId 拒掉并重建，不能带着引号进 DOM */
      var card = document.querySelector('#noteGrid .n-card');
      var attr = card ? (card.getAttribute('data-note') || '') : '';
      /* ⚠️ 判据必须要求「卡片真的存在」。第一版把「取不到卡片」写成 'NO_CARD'，
         而那个字符串正好符合正则 —— 于是「卡片压根没渲染」也会 PASS。
         这是假通过，必须堵掉：先要求 card 非空。
         （另注：这个文件里的注释不许出现反引号，会把模板字符串当场截断。） */
      /* 额外要求「data-note 非空」：空 id 会让卡片点不动，
         那是另一个坑（拒掉坏 id 之后必须重建，不能留空）。 */
      var clean = !!card && !!attr && /^[A-Za-z0-9_-]+$/.test(attr);
      var gridH = (document.getElementById('noteGrid') || {}).innerHTML || '';
      return { ok: window.__xss2 === 0 && clean,
               info: 'executed=' + window.__xss2 + ' 卡片=' + !!card
                 + ' data-note=' + JSON.stringify(attr)
                 + ' grid=' + JSON.stringify(gridH.slice(0, 60)) };
    } finally { S.notes = keep; try{ closeView('notes'); }catch(e){} }
  });

  await TA('安全：聊天历史不执行脚本', async function(){
    var keepH = S.chatHistory, keepMsgs = msgs;
    window.__xss3 = 0;
    try{
      S.chatHistory = [{ id:'c1', title:'t', when:'', ts:Date.now(), fav:false, archived:false,
        msgs:[{ r:'ai', t:'<img src=x onerror="window.__xss3=1">', src:[] }] }];
      loadChatSession('c1');
      await sleep(400);
      return { ok: window.__xss3 === 0, info: 'executed=' + window.__xss3 };
    } finally { S.chatHistory = keepH; msgs = keepMsgs; }
  });

  await TA('安全：历史菜单不再用 eval 执行字符串', async function(){
    var keepH = S.chatHistory;
    window.__xss4 = 0;
    try{
      S.chatHistory = [{ id:"x');window.__xss4=1;//", title:'t', when:'', ts:Date.now(),
        msgs:[{r:'ai',t:'hi',src:[]}], fav:false, archived:false }];
      histActions(S.chatHistory[0].id, { x:10, y:10 });
      await sleep(200);
      var row = [].slice.call(document.querySelectorAll('#msgMenu .actrow'))
        .filter(function(e){ return /收藏/.test(e.textContent); })[0];
      if(row){ row.click(); await sleep(250); }
      return { ok: window.__xss4 === 0, info: 'executed=' + window.__xss4 + ' 菜单行=' + !!row };
    } finally { S.chatHistory = keepH; try{ closeMsgMenu(); }catch(e){} }
  });

  T('安全：markdown 渲染器仍然转义尖括号（对照组）', function(){
    /* 这条守的是「chatMsgHtml 走 sanitize 之后，正常 markdown 不该被打坏」的边界：
       bare text 里的 <img> 必须变成 &lt;img&gt;，而不是真的标签。 */
    var h = renderAiText('<img src=x onerror=1>');
    return { ok: h.indexOf('<img') < 0 && h.indexOf('&lt;img') >= 0, info: h.slice(0, 70) };
  });

  T('安全：恢复备份拒绝非法 schema，且整包拒绝', function(){
    function mk(data){ return { app:'学径', kind:'xuejing-backup', group:'study', version:1, data:data }; }
    var bad = validateRestore(mk({ courses:'not-an-object' }));
    var badTodos = validateRestore(mk({ todos:'nope' }));
    var badAvatar = validateRestore(mk({ avatar:'data:image/svg+xml,<svg onload=1>' }));
    var empty = validateRestore(mk({}));
    var good = validateRestore(mk({ nick:'小明', notes:[{ id:'n1', body:'<b>x</b>', title:'t' }] }));
    return {
      /* 「整包拒绝」= 返回 ok:false（调用方据此不做任何写入） */
      ok: bad.ok === false && badTodos.ok === false && badAvatar.ok === false
        && empty.ok === false && good.ok === true,
      info: '课表字符串=' + bad.ok + ' 待办字符串=' + badTodos.ok
        + ' SVG头像=' + badAvatar.ok + ' 空包=' + empty.ok + ' 正常包=' + good.ok
    };
  });

  T('安全：备份默认不含 API Key', function(){
    var keepKey = S.apiKey, keepAcc = S.providerAcc, keepMemo = S.keyMemo;
    try{
      S.apiKey = 'sk-AUDIT-SECRET-1';
      S.providerAcc = { deepseek: { key:'sk-AUDIT-SECRET-2', baseUrl:'https://api.deepseek.com' } };
      S.keyMemo = { deepseek: 'sk-AUDIT-SECRET-3' };
      var ai = buildBackup('ai', false);
      var full = buildBackup('full', false);
      var withKey = buildBackup('ai', true);
      var leak = function(s){ return s.indexOf('sk-AUDIT-SECRET') >= 0; };
      var coverChannelsEscape = leak(ai) || leak(full);
      return {
        ok: !coverChannelsEscape && leak(withKey) && /\.deepseek\.com/.test(ai),
        info: '默认ai泄漏=' + leak(ai) + ' 默认full泄漏=' + leak(full)
          + ' 显式导出含密钥=' + leak(withKey) + ' 渠道地址保留=' + /\.deepseek\.com/.test(ai)
      };
    } finally { S.apiKey = keepKey; S.providerAcc = keepAcc; S.keyMemo = keepMemo; }
  });

  T('顶栏按钮：所有二级页的返回/新建都是同一尺寸，且图标统一', function(){
    /* 用户报「待办页上方的返回和新建按钮一个扁了一个图标不居中」。
       根因有两条，都是「只调了一半」：
         ① .viewhead > .icon-btn:first-child 只写了 width:30px，高度还是 34 —— 返回键变扁；
            而右侧用 min-width:30px，宽度其实仍是 34 —— 两个键尺寸不同。
         ② 图标是字符 ‹ 和 ＋：‹ 排版宽 5.52px 且字形靠左、＋ 是全角（16px 而 ASCII + 只有 11.87），
            字号一样但视觉大小差很多，flex 居中居的是字符盒 → 看着偏左。
       现在统一 30×30，图标改用同一套 SVG（伪元素 + mask）。
       这条要覆盖**所有**顶栏，因为笔记页有 3 个按钮、错题/课表页有 2 个 ——
       只写 :last-child 时第三个及以后仍是 34（实测就是这么漏的）。 */
    var bad = [], heads = 0;
    document.querySelectorAll('.view .viewhead').forEach(function(h){
      var btns = [].slice.call(h.querySelectorAll('.icon-btn'));
      if(btns.length < 2) return;
      heads++;
      var dims = btns.map(function(b){
        var r = b.getBoundingClientRect();
        return Math.round(r.width) + 'x' + Math.round(r.height);
      });
      var allSame = dims.every(function(d){ return d === dims[0]; });
      /* 字符图标的按钮必须真的被伪元素接管（font-size:0 + 有 mask-image） */
      var iconOk = btns.every(function(b){
        if(b.classList.contains('has-svg')) return true;   /* 自带 svg，不归这条管 */
        var s = getComputedStyle(b, '::before');
        var mi = s.maskImage || s.webkitMaskImage || 'none';
        return parseFloat(getComputedStyle(b).fontSize) === 0
          && /url\(/.test(mi);
      });
      if(!allSame || !iconOk){
        bad.push(h.closest('.view').id + ':' + dims.join('/')
          + (allSame ? '' : ' 尺寸不一') + (iconOk ? '' : ' 图标未接管'));
      }
    });
    return {
      ok: heads > 0 && bad.length === 0,
      info: '检查 ' + heads + ' 个顶栏 · 不合格 ' + bad.length
        + (bad.length ? '：' + bad.slice(0, 4).join(' | ') : '')
    };
  });

  await TA('点击自愈：五种残留层注入后，二级页内容仍然可点', async function(){
    /* 用户反复报「三个主页进二级页之后，里面再开的弹窗点不动」。
       我在无头环境跑了几十轮组合没能稳定复现 —— 它是竞态。
       所以守护方式不是"复现那一次"，而是**注入残留、断言能自愈**：
       这五种残留各自都足以让整页点不动（关掉 healStuckLayers 时全部 ok=false）。
       注意：这条测的是防护本身，不是某个具体 bug 的成因。 */
    var keep = S.uiTheme;
    var prev = (document.querySelector('.page.active') || {}).id || 'page-home';
    var results = [];
    try{
      var injects = [
        ['mask',        function(){ var m=document.getElementById('mask'); m.classList.add('show'); m.style.opacity='1'; }],
        ['pickMask',    function(){ document.getElementById('pickMask').classList.add('show'); }],
        ['sheet 悬空',  function(){ document.getElementById('mask').classList.remove('show');
                                     document.getElementById('sheet').style.transform='translateY(30%)'; }],
        ['双 view',     function(){ document.getElementById('view-ai').classList.add('show'); }],
        ['抽屉 scrim',  function(){ document.getElementById('histScrim').classList.add('show'); }]
      ];
      /* 每个场景之间必须留足时间：进页有 220ms 淡入 + 位置过渡，
         不等就量 getBoundingClientRect 会拿到过渡中的旧位置 ——
         那样测出来的 false 是量早了，不是防护失效。 */
      for(var i = 0; i < injects.length; i++){
        var pair = injects[i];
        pair[1]();
        openView('theme');
        await sleep(320);
        var v = document.querySelector('.view.show');
        /* 只挑**内容区**里的可点元素：页头的返回按钮在桌面模式下
           可能被顶栏压住（.viewhead 是固定高），拿它当判据会假失败。 */
        var el = v && v.querySelector('.viewbody .segI, .viewbody .li[onclick], .viewbody .li.tap, .viewbody .switch');
        var ok = false;
        if(el){
          var r = el.getBoundingClientRect();
          var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          ok = !!(hit && (hit === el || el.contains(hit) || hit.contains(el)));
        }
        var rr = el ? el.getBoundingClientRect() : null;
        var hh = rr ? document.elementFromPoint(rr.left + rr.width/2, rr.top + rr.height/2) : null;
        results.push(pair[0] + '=' + ok);
        closeView('theme');
        await sleep(480);
      }
      var allOk = results.every(function(s){ return /=(true)$/.test(s); });
      return { ok: allOk, info: results.join(' · ') };
    } finally {
      S.uiTheme = keep; applyLook();
      try{ healStuckLayers(); }catch(e){}
      try{ go(prev.replace('page-', '')); }catch(e){}
    }
  });

  T('平板布局设置在外观页（不在专注与学习），且都是滑块不是几个 badge', function(){
    var inTheme = !!document.querySelector('#view-theme #tabletNavList');
    var inStudy = !!document.querySelector('#view-study #tabletNavList');
    /* 三组都必须是 .seg（有滑块），不是一堆 .badge ——
       badge 没有选中态，用户点了看不出当前选的是哪个。 */
    var segs = ['navSideSeg','navAlignSeg','navWidgetSeg'].map(function(id){
      return !!document.getElementById(id);
    });
    var thumbs = ['navSideThumb','navAlignThumb','navWidgetThumb'].map(function(id){
      return !!document.getElementById(id);
    });
    /* 旧的 badge 做法不该残留（会和新滑块重复出现两套入口） */
    var oldBadges = document.querySelectorAll('#tabletNavList .badge').length;
    return {
      ok: inTheme && !inStudy && segs.every(Boolean) && thumbs.every(Boolean)
        && oldBadges === 0,
      info: '在外观页=' + inTheme + ' 仍在专注页=' + inStudy
        + ' 三组滑块=' + segs.join('/') + ' 滑块头=' + thumbs.join('/')
        + ' 残留旧 badge=' + oldBadges
    };
  });

  await TA('平板：Pro 悬浮侧栏与导航分居两端，组件只读且不重叠', async function(){
    var root = document.documentElement;
    var keep = { cls: root.className, theme: S.uiTheme };
    var prev = (document.querySelector('.page.active') || {}).id || 'page-home';
    var bar = document.querySelector('.tabbar');
    var wig = document.getElementById('sidewig');
    if(!bar || !wig) return { ok:false, info:'缺 .tabbar 或 #sidewig' };
    try{
      /* 自测跑在手机视口，平板布局不会自己生效 —— 手动打类。
         （真机由 JS 的布局判定打，这里只验"已是平板"之后的几何）
         ⚠️ 还必须把**视口高度撑到平板尺寸**：.tabbar 与 #sidewig 在同一个 grid
         单元里各占一端，行高不够时两端会互相压进来（实测手机 700px 高时
         导航 210 + 组件 202 放不下，重叠 30px）。这不是布局错，是视口错。
         所以给 #phone 一个平板高度再量，量完恢复。 */
      root.classList.add('layout-tablet');
      var phoneEl = document.getElementById('phone');
      var keepPhoneH = phoneEl ? phoneEl.style.height : '';
      if(phoneEl) phoneEl.style.height = '1180px';
      setUiTheme('pro');
      setNavSide('left');
      /* 组件要靠 navw-on 才会 display:flex，显式打开一次，
         免得受前面用例留下的 localStorage 影响（顺序耦合） */
      setNavWidgets(true);
      await sleep(260);
      var cs = getComputedStyle(bar);
      var floating = parseFloat(cs.marginTop) > 0
        && parseFloat(cs.marginLeft) > 0
        && parseFloat(cs.borderTopLeftRadius) >= 20;
      /* 演示：
         · wig 的 display 必须是 flex，pointer-events 必须 none（只读）
         · 三者不能重叠：tabbar 与 sidewig 上下分开 */
      var pe = getComputedStyle(wig).pointerEvents;
      var shown = getComputedStyle(wig).display === 'flex';
      var clickable = [].slice.call(wig.querySelectorAll('*')).some(function(el){
        return el.hasAttribute('onclick') || el.tagName === 'A' || el.tagName === 'BUTTON';
      });

      function rects(){
        var a = bar.getBoundingClientRect(), b = wig.getBoundingClientRect();
        return { a: a, b: b,
          overlap: !(a.bottom <= b.top + 1 || b.bottom <= a.top + 1) };
      }
      var topR = rects();
      var dbg = 'tab[' + Math.round(topR.a.top) + ',' + Math.round(topR.a.bottom) + '] '
        + 'wig[' + Math.round(topR.b.top) + ',' + Math.round(topR.b.bottom) + ']'
        + ' alignSelfTab=' + getComputedStyle(bar).alignSelf
        + ' alignSelfWig=' + getComputedStyle(wig).alignSelf
        + ' cards=' + wig.children.length;
      /* 导航贴底 → 组件必须跑到它上面 */
      setNavAlign('bottom');
      await sleep(220);
      var botR = rects();
      var swapped = botR.b.top < topR.a.top + 1;

      /* Classic 档：侧栏回到"贴边整列"，组件整块不显示 */
      setNavAlign('top');
      await sleep(120);
      setUiTheme('classic');
      await sleep(220);
      var cMargin = parseFloat(getComputedStyle(bar).marginTop);
      var classicFlat = Math.abs(cMargin) < 1
        && getComputedStyle(wig).display === 'none';

      setUiTheme('pro');
      await sleep(150);
      return {
        ok: floating && shown && pe === 'none' && !clickable
          && !topR.overlap && !botR.overlap && swapped && classicFlat,
        info: 'Pro 悬浮=' + floating + '（margin ' + cs.marginTop + '/圆角 '
          + cs.borderTopLeftRadius + '）· 组件显示=' + shown + ' 只读=' + (pe === 'none')
          + ' 无点击元素=' + !clickable
          + ' · 顶对齐时重叠=' + topR.overlap + ' 底对齐时重叠=' + botR.overlap
          + ' 两端对调=' + swapped + ' · Classic 回到贴边=' + classicFlat
          + ' · ' + dbg
      };
    } finally {
      if(phoneEl) phoneEl.style.height = keepPhoneH;
      root.className = keep.cls;
      S.uiTheme = keep.theme; applyLook();
      try{ go(prev.replace('page-', '')); }catch(e){}
    }
  });

  await TA('底栏：外框与胶囊同心（四边留白相等 + 圆角 = 胶囊圆角 + 留白）', async function(){
    var bar = document.querySelector('.tabbar');
    if(!bar) return { ok:false, info:'找不到 .tabbar' };
    var keep = S.uiTheme;
    var prev = (document.querySelector('.page.active') || {}).id || 'page-home';
    try{
      S.uiTheme = 'pro'; applyLook();
      await sleep(150);
      var cs = getComputedStyle(bar);
      var af = getComputedStyle(bar, '::after');
      var bw = parseFloat(cs.borderLeftWidth) || 0;
      var padL = parseFloat(cs.paddingLeft) || 0;
      var padT = parseFloat(cs.paddingTop) || 0;
      var pillH = parseFloat(af.height);
      var dockH = bar.getBoundingClientRect().height;
      /* 上留白 = 内容框高度 − 胶囊高，再 / 2（胶囊是 top:50% + margin-top 居中的）。
         ⚠️ 这里只能算到「内容框内」的留白，不含 border；所以侧留白也只能取 padding，
         不能加 border —— 两边口径必须一致（第一版一边加边框一边没加，差 1px 假失败）。 */
      var contentH = dockH - bw * 2 - padT * 2;
      var topGap = (contentH - pillH) / 2;
      /* 侧留白 = padding（胶囊的 left 取的是同一个值；border 是外框自己的线，不算缝） */
      var sideGap = padL;
      var rOuter = parseFloat(cs.borderTopLeftRadius);
      var rPill = parseFloat(af.borderTopLeftRadius);
      var gapsMatch = Math.abs(sideGap - topGap) <= 0.6;
      var concentric = Math.abs(rOuter - (rPill + topGap)) <= 0.6;
      /* 胶囊要是真 pill：圆角 = 半高 */
      var isPill = Math.abs(rPill - pillH / 2) <= 0.6;
      return {
        ok: gapsMatch && concentric && isPill,
        info: '侧留白 ' + sideGap.toFixed(1) + 'px / 上留白 ' + topGap.toFixed(1)
          + 'px（应相等）· 外框圆角 ' + rOuter + ' = 胶囊 ' + rPill + ' + 留白 '
          + topGap.toFixed(1) + '（同心=' + concentric + '）· 胶囊圆角=半高=' + isPill
      };
    } finally {
      S.uiTheme = keep; applyLook();
      go(prev.replace('page-', ''));
    }
  });

  await TA('主题页：Classic 档能设背景图，且不显示玻璃档那套标识', async function(){
    var keep = S.uiTheme;
    var prev = (document.querySelector('.page.active') || {}).id || 'page-home';
    function vis(id){
      var e = document.getElementById(id);
      if(!e) return null;
      return getComputedStyle(e).display !== 'none' && e.offsetParent !== null;
    }
    try{
      setUiTheme('classic');
      openView('theme');
      await sleep(240);
      /* 玻璃档的那一套（列表 / 标题 / 描边 / 说明段）都该收起来 ——
         只收列表不收标题会留一个空分组，只收标题不收说明会讲一个不存在的功能。 */
      var classic = {
        glassH2: vis('glassH2'), glassLi: vis('glassLi'),
        edgeLi: vis('edgeLi'), note: vis('uiProNote'), bgLi: vis('bgLi')
      };
      var classicOk = classic.bgLi === true
        && classic.glassH2 === false && classic.glassLi === false
        && classic.edgeLi === false && classic.note === false;
      /* 背景图在 CLASSIC 下必须真的生效（不是只显示入口）：
         基础样式里有 html.has-bg .phone 那一份，跟上皮肤的两份是两条独立链路。 */
      var bgWas = S.bgImage;
      S.bgImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      applyLook();
      await sleep(80);
      var phone = document.getElementById('phone');
      var bgImg = getComputedStyle(phone).backgroundImage || '';
      var classicBgWorks = document.documentElement.classList.contains('has-bg')
        && /url\(/.test(bgImg);
      S.bgImage = bgWas; applyLook();
      await sleep(60);
      closeView('theme');
      /* closeView 有 320ms 退场 + 父页返回，紧接着 openView 会被「同一时刻只允许
         一层」那条规则吃掉（新页开了、旧页还在退），读到的还是上一轮的状态。
         等它彻底收干净再开 —— 实测不等时 Pro 段全 false。 */
      await sleep(460);

      /* ⚠️ **直接写 S.uiTheme 不会更新显隐**：显隐写在 renderUiTheme() 里，
         而真机上走的是 setUiTheme()（它内部 applyLook + renderUiTheme 一起调）。
         测试里只调 applyLook 会得到"类对了、设置项没刷新"的中间态 ——
         第一版就是这样误判成显隐逻辑坏了。要么调 setUiTheme，要么两个都调。 */
      setUiTheme('pro');
      await sleep(120);
      openView('theme');
      await sleep(260);
      var proVals = {
        glassH2: vis('glassH2'), glassLi: vis('glassLi'),
        edgeLi: vis('edgeLi'), note: vis('uiProNote'), bgLi: vis('bgLi')
      };
      var proOk = proVals.glassH2 === true && proVals.glassLi === true
        && proVals.edgeLi === true && proVals.note === true && proVals.bgLi === true;
      closeView('theme');
      return {
        ok: classicOk && classicBgWorks && proOk,
        info: 'Classic: 背景图入口=' + classic.bgLi + ' 玻璃标题/列表/描边/说明='
          + [classic.glassH2, classic.glassLi, classic.edgeLi, classic.note].join('/')
          + ' 背景图真的生效=' + classicBgWorks
          + ' · Pro: ' + ['标题','列表','描边','说明','背景图'].map(function(k,i){
              return k + '=' + proVals[['glassH2','glassLi','edgeLi','note','bgLi'][i]];
            }).join(' ')
      };
    } finally {
      S.uiTheme = keep; applyLook();
      try{ closeView('theme'); }catch(e){}
      go(prev.replace('page-', ''));
    }
  });

  await TA('底栏：尺寸收紧，胶囊拉伸时不顶出 dock', async function(){
    var bar = document.querySelector('.tabbar');
    if(!bar) return { ok:false, info:'找不到 .tabbar' };
    var keep = S.uiTheme;
    var prev = (document.querySelector('.page.active') || {}).id || 'page-home';
    try{
      S.uiTheme = 'pro'; applyLook();
      await sleep(150);
      var r = bar.getBoundingClientRect();
      var af = getComputedStyle(bar, '::after');
      var pillH = parseFloat(af.height);
      var pillW = parseFloat(af.width);
      var padIn = parseFloat(getComputedStyle(bar).getPropertyValue('--pill-in'));
      var radius = parseFloat(af.borderTopLeftRadius);
      var proH = Math.round(r.height);
      /* ② 不溢出只能靠**真的走一遍手势**来验 —— 上限是 JS 按「余量 ÷ 胶囊宽」算的，
         断言在外面重算一遍公式等于什么都没测。这里派发 pointer 事件模拟一次快速
         拖动，每帧读 transform 矩阵，把胶囊实际左右边界换算出来。
         ⚠️ 屏幕越宽胶囊越宽，同样的比例扩得越多，所以必须按实际几何量，
         不能用一个固定像素数（写死 0.20 的那版在宽视口下会溢出 9px）。 */
      var rect = bar.getBoundingClientRect();
      var cy = rect.top + rect.height / 2;
      function pev(type, x){
        return new PointerEvent(type, {
          bubbles:true, cancelable:true, clientX:x, clientY:cy,
          pointerId:1, pointerType:'touch', button:0, buttons:1
        });
      }
      var x0 = rect.left + 30;
      var over = 0, maxSxSeen = 1;
      function probe(){
        var af2 = getComputedStyle(bar, '::after');
        var mm = /matrix\(([^)]*)\)/.exec(af2.transform);
        var arr = mm ? mm[1].split(',').map(parseFloat) : [1, 0, 0, 1, 0, 0];
        var sx = arr[0], tx = arr[4];
        var pw2 = parseFloat(af2.width), pl = parseFloat(af2.left);
        if(sx > maxSxSeen) maxSxSeen = sx;
        /* 拉伸以自身中心为轴 → 左右各扩 pw2*(sx-1)/2 */
        var half = pw2 * sx / 2;
        var l = pl + tx + pw2 / 2 - half;
        var rr = pl + tx + pw2 / 2 + half;
        over = Math.max(over, -l, rr - rect.width);
      }
      try{
        bar.dispatchEvent(pev('pointerdown', x0));
        /* ⚠️ 必须**扫到两端**：中段离左右边太远，怎么拉都不会越界 ——
           危险区在 idx≈0 和 idx≈2，那里胶囊中心贴着 dock 内边距。
           只在中段游走的版本测出来恒为 0，等于什么都没验（第一版就是这样）。 */
        for(var k = 1; k <= 12; k++){
          bar.dispatchEvent(pev('pointermove', x0 + (rect.right - x0) * (k / 12)));
          probe();
        }
        for(var k2 = 1; k2 <= 12; k2++){
          bar.dispatchEvent(pev('pointermove', rect.right - (rect.right - x0) * (k2 / 12)));
          probe();
        }
        bar.dispatchEvent(pev('pointerup', x0));
      }catch(e){ over = 999; }
      await sleep(80);
      bar.style.setProperty('--pill-sx', '1');
      S.uiTheme = 'classic'; applyLook();
      await sleep(150);
      var classicH = Math.round(bar.getBoundingClientRect().height);
      /* 横向是这一轮的重点：dock 不能再「铺满」，必须比屏宽窄出可见的留白。
         用「dock 宽 / 屏宽」判定，不写死像素 —— 换机型也不用改。
         0.86 这个上限的意思是至少留 14% 的边（左右各 7%）。 */
      var ratio = r.width / window.innerWidth;
      /* 「不铺满」的判据是**左右都有可量到的留白**，不是占比区间：
         dock 现在是定宽（3×92 + 2×8 + 2），宽屏上占比自然很小 ——
         写成「不得小于 45%」会把定宽在宽屏下的正确行为判成错（实测 39% 时误报）。 */
      var sideGap = (window.innerWidth - r.width) / 2;
      var narrow = sideGap >= 20;
      /* 三格要等分且格宽够放「22px 图标 + 四字标签」，太窄会挤 */
      var cellW = (r.width - padIn * 2) / 3;
      var cellOk = cellW >= 76;
      return {
        ok: proH >= 62 && proH <= 74
          && classicH >= 70 && classicH <= 82
          && pillH >= 46 && pillH <= 56
          && Math.abs(radius - pillH / 2) <= 1
          && isFinite(padIn) && padIn >= 6
          && narrow && cellOk
          && over <= 0.5
          /* 只查「不越界」是不够的：把拉伸整段删掉也满足不越界。
             峰值必须真的起来（>1.05），这条才抓得住「液体感被改没了」。 */
          && maxSxSeen >= 1.05,
        info: 'dock ' + Math.round(r.width) + '×' + proH + 'px（占屏 '
          + (ratio * 100).toFixed(0) + '%，左右各留 ' + sideGap.toFixed(0)
          + 'px）· 格宽 ' + cellW.toFixed(0)
          + 'px · 经典 ' + classicH + 'px · 胶囊 ' + pillH + 'px/圆角 ' + radius
          + ' · 余量 ' + padIn + 'px · 拖动峰值 sx=' + maxSxSeen.toFixed(2)
          + ' · 越界 ' + over.toFixed(1) + 'px'
      };
    } finally {
      bar.style.setProperty('--pill-sx', '1');
      S.uiTheme = keep; applyLook();
      go(prev.replace('page-', ''));
    }
  });

  /* 加号菜单里「换个模型」点了没反应：applyModelPick 结尾会 openSheet('modelroles')，
     快速切换也把它带上了 —— 菜单一收，整页弹层又盖上来。 */
  T('加号菜单快速切模型：真的换掉，且不弹「模型与渠道」整页', function(){
    var keep = JSON.stringify({ p:S.provider, r:S.roles, m:S.models, pm:S.providerModels, acc:S.providerAcc, url:S.baseUrl, key:S.apiKey });
    var prev = (document.querySelector('.page.active') || {}).id || 'page-home';
    try{
      S.provider = 'deepseek'; S.baseUrl = 'https://x.test/v1'; S.apiKey = 'k';
      S.providerAcc = {}; S.roles = { chat:{ p:'', m:'d-a', fx:false } };
      S.providerModels = { deepseek:['d-a','d-b'] };
      S.models = { chat:'d-a' };
      go('chat');
      plusModelMenu();
      var box = document.getElementById('plusMenu');
      var rows = [].slice.call(box.querySelectorAll('.actrow'));
      var opened = box.classList.contains('show') && rows.length >= 2;
      var maskBefore = document.getElementById('mask').classList.contains('show');
      rows[1].click();
      var now = roleCreds('chat').model;
      var maskAfter = document.getElementById('mask').classList.contains('show');
      var menuGone = !box.classList.contains('show');
      return {
        ok: opened && !maskBefore && now === 'd-b' && !maskAfter && menuGone,
        info: '菜单开了=' + opened + '（' + rows.length + ' 档）· 切换后模型=' + now
          + ' · 点后没弹整页=' + !maskAfter + ' · 菜单已收=' + menuGone
      };
    } finally {
      var o = JSON.parse(keep);
      S.provider=o.p; S.roles=o.r; S.models=o.m; S.providerModels=o.pm;
      S.providerAcc=o.acc; S.baseUrl=o.url; S.apiKey=o.key;
      closePlusMenu(); applyLook(); save();
      /* 切走过的页要还回去：后面还有依赖「当前在 me 页」的量测 */
      go(prev.replace('page-', ''));
      try{ renderChatAiBar(); renderModels(); }catch(e){}
    }
  });

  /* 输入行：加号 / 全屏 / 发送三颗按钮比输入框矮一截，真机上看着就是
     「三个小东西围着一个大框」。皮肤里统一成 44×44。 */
  T('对话输入行：两颗按钮与输入框同高，全屏图标是输入框内的图标', function(){
    /* 契约在 2026-10-17 变了：全屏输入不再是并排的第三颗按钮，
       而是输入框右侧的一个纯图标（无底色、无描边、垂直居中）。
       所以这里钉的是「两颗真按钮同高」+「那个图标确实在输入框里面且是平的」。 */
    var keep = S.uiTheme;
    var prev = (document.querySelector('.page.active') || {}).id || 'page-home';
    S.uiTheme = 'pro'; applyLook(); go('chat');
    var inp = document.getElementById('chatInput');
    var btns = [].slice.call(document.querySelectorAll('#page-chat .composer > .icon-btn'));
    var fs = document.querySelector('#page-chat .fwrap .fs-in');
    var ih = inp ? Math.round(inp.getBoundingClientRect().height) : 0;
    var hs = btns.map(function(b){ return Math.round(b.getBoundingClientRect().height); });
    var ir = inp ? inp.getBoundingClientRect() : null;
    var fr = fs ? fs.getBoundingClientRect() : null;
    var fsBg = fs ? getComputedStyle(fs).backgroundColor : '-';
    go(prev.replace('page-', ''));
    S.uiTheme = keep; applyLook();
    if(!inp || btns.length !== 2 || !fs || !ir || !fr){
      return { ok:false, info:'输入行元素不齐（按钮 ' + btns.length + ' 颗，图标=' + !!fs + '）' };
    }
    var same = hs.every(function(x){ return Math.abs(x - ih) <= 2; });
    var inBox = fs.parentElement && fs.parentElement.classList.contains('fwrap');
    var flat = (fsBg === 'rgba(0, 0, 0, 0)' || fsBg === 'transparent');
    var noBorder = parseFloat(getComputedStyle(fs).borderTopWidth) === 0;
    var centered = Math.abs((fr.top + fr.height / 2) - (ir.top + ir.height / 2)) <= 2;
    var inside = fr.left >= ir.left && fr.right <= ir.right + 1;
    return {
      ok: same && inBox && flat && noBorder && centered && inside,
      info: '输入框 ' + ih + 'px · 按钮 ' + hs.join('/') + 'px · 图标在输入框内=' + inBox
        + ' · 无底色=' + flat + ' · 无描边=' + noBorder
        + ' · 垂直居中=' + centered + ' · 在框内=' + inside
    };
  });

  /* 全局背景图：开关、遮罩档位、清除三件事都要落在 html 的行内样式上 */
  T('全局背景图：设置后挂 url 与遮罩，脏值不生效，清除后回到主题底色', function(){
    var keepImg = S.bgImage, keepDim = S.bgDim;
    var r = document.documentElement;
    try{
      var fake = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
      S.bgImage = fake; S.bgDim = 'heavy'; applyLook();
      var on = r.classList.contains('has-bg');
      var photo = r.style.getPropertyValue('--bg-photo');
      var scrim = parseFloat(r.style.getPropertyValue('--scrim'));
      S.bgImage = 'not-an-image'; applyLook();
      var dirtyOff = !r.classList.contains('has-bg');
      S.bgImage = fake; S.bgDim = 'light'; applyLook();
      var lightScrim = parseFloat(r.style.getPropertyValue('--scrim'));
      bgClear();
      var cleared = !r.classList.contains('has-bg')
        && r.style.getPropertyValue('--bg-photo') === 'none' && S.bgImage === '';
      return {
        ok: on && /data:image\/jpeg/.test(photo) && scrim > lightScrim && dirtyOff && cleared,
        info: '挂上=' + on + ' · 遮罩 重' + scrim + '>轻' + lightScrim
          + ' · 脏值不生效=' + dirtyOff + ' · 清除=' + cleared
      };
    } finally {
      S.bgImage = keepImg; S.bgDim = keepDim; applyLook();
    }
  });

  /* 裁切层是异步的（等 img.onload），所以用 TA。
     量的是「选区不许跑出图片」+「应用后真的产出一张 JPEG」。 */
  await TA('图片裁切：选区被夹在图片内，锁比例生效，应用后产出 JPEG', async function(){
    var cv = document.createElement('canvas');
    cv.width = 400; cv.height = 300;
    var g = cv.getContext('2d');
    g.fillStyle = '#334455'; g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#ee0055'; g.fillRect(100, 50, 120, 120);
    var src = cv.toDataURL('image/png');
    var got = null;
    openCropper({ src: src, aspect: null, maxSide: 200, quality: 0.9,
      onApply: function(url, w, h){ got = { url:url, w:w, h:h }; } });
    var t0 = Date.now();
    while(Date.now() - t0 < 2500 && !document.getElementById('cropMask').classList.contains('show'))
      await sleep(50);
    var img = document.getElementById('cropImg'), box = document.getElementById('cropBox');
    if(!CROP) return { ok:false, info:'裁切层没打开' };
    var ir = img.getBoundingClientRect(), br = box.getBoundingClientRect();
    var inside = br.left >= ir.left - 1 && br.right <= ir.right + 1
      && br.top >= ir.top - 1 && br.bottom <= ir.bottom + 1;
    cropSetBox(-500, -500, 9999, 9999);
    var clamped = CROP.box.x === 0 && CROP.box.y === 0
      && CROP.box.w <= ir.width + 1 && CROP.box.h <= ir.height + 1;
    var ratioFree = CROP.box.w / CROP.box.h;
    cropApply();
    var okOut = !!got && /^data:image\/jpeg;base64,/.test(got.url)
      && Math.abs(got.w / got.h - ratioFree) < 0.06;
    /* 锁 2:1（头像那档是 1:1，同一套代码） */
    closeCropper();
    openCropper({ src: src, aspect: 2, maxSide: 100, quality: 0.9, onApply: function(){} });
    var t1 = Date.now();
    while(Date.now() - t1 < 2500 && !(CROP && CROP.box)) await sleep(50);
    var ratio2 = CROP ? (CROP.box.w / CROP.box.h) : 0;
    closeCropper();
    return {
      ok: inside && clamped && okOut && Math.abs(ratio2 - 2) < 0.02,
      info: '选区在图内=' + inside + ' · 越界被夹回=' + clamped
        + ' · 产出=' + (got ? got.w + '×' + got.h : 'null')
        + ' · 锁 2:1 实际=' + ratio2.toFixed(2)
    };
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
    /* 清单只放「必须存在且真被用到」的图标。
       terminal 已随陪伴模式一起删掉（它只被陪伴的调试日志用过）——
       留在这张表里会让断言要求一个不该存在的图标。 */
    var need = ['globe', 'align', 'layout', 'dynamic', 'wand', 'key', 'heart', 'smile',
                'coin', 'target', 'pressure', 'chip', 'book', 'database',
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
    var want = { '联网搜索': 'globe', '导航栏位置': 'align', '灵动岛上岛': 'dynamic',
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
      window.__pending = { day:dA, c:cA };
      window.snoozeAlert();
      var base = pops;
      for(var j=0;j<3;j++) window.onNativeClassAlert('start', '自测·重复课A');
      var afterSnooze = pops - base;

      // ③ 对照组：另一节课仍能正常弹
      var beforeB = pops;
      window.onNativeClassAlert('start', '自测·对照课B');
      var poppedB = pops - beforeB;

      // ④ 点了「开始上课并记录专注」之后，这节也不该再弹
      window.__pending = { day:dA, c:cB };
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
      window.__pending = null;
      delete S.classes[cid(dA, cB)];
      delete S.classes[cid(dA, cA)];
    }
  });

  // 字号调节：换档要真的改变「读的字」的计算字号，且图标/间距不能跟着变。
  //  这里量真实计算值，不扫源码 —— 令牌没接上时变量会被解析成默认值，量出来就是没变。
  T('字号：四档切换真的改变正文计算字号（图标/间距不动）', function(){
    var snapFs = S.fontScale;
    var root = document.documentElement;
    /* 样本页从「我的」换成「专注与学习」：前者重构后只剩入口卡（没有 .li），
       而这一条要量的正是列表行的正文。搬动后要跟着走，别让断言指向空地儿。 */
    var host = 'view-study';
    var body = document.getElementById(host);
    // 取一个用 --fs-body 的元素做样本：列表主标题
    var probe = document.querySelector('#' + host + ' .li .tx b');
    if(!body || !probe) return { ok:false, info:'找不到 #' + host + ' 或 .li .tx b 样本' };

    function measure(at){
      S.fontScale = at; applyLook();
      return {
        body: parseFloat(getComputedStyle(probe).fontSize) || 0,
        htmlAttr: root.dataset.fs || '',
        // 图标/间距的对照：拿一个不参与字号的尺寸（列表图标容器宽）
        icon: parseFloat(getComputedStyle(document.querySelector('#' + host + ' .li .ic')).width) || 0
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

  /* ---------- 专注系统重构（v0.2.4）----------
     真机踩过的坑：通知栏启动的专注正常走完归零，学径却因为杀后台记录不到，
     时间全白费。重构后计时权威移到原生，跑完的结果进「待记账队列」，
     页面不管什么时候打开都能补记回来。下面两条钉住这条链路真的通。 */

  // 原生跑完一轮番茄（25 分钟）→ 页面打开后要能补记，并且回执给原生
  T('杀后台后原生跑完的专注，打开能补记回来', function(){
    if(typeof syncFocusFromNative !== 'function') return { ok:false, info:'缺 syncFocusFromNative' };
    var oldN = NATIVE, oldApp = isApp, oldDays = JSON.stringify(S.days), oldCls = JSON.stringify(S.classes);
    var acked = null;
    try{
      isApp = true;
      /* 假桥：待记账队列里躺着一条「跑了 25 分钟的番茄」。
         时间戳用「刚刚」而不是写死的 2023 —— 真实场景就是通知栏跑完、App 被杀、
         用户回来打开，endedAt 必然是刚才。写死的旧日期会被按天补记逻辑归到那一天去。
         ack 之后队列要真的清空 —— 模拟原生 FocusStore.ack 的行为，
         这样才测得出「来回切前后台会不会把同一轮记两次」。 */
      var tNow = Date.now();
      var pending = [{id:'1700000000000', label:'自由专注', courseId:'', mode:'work',
                      dir:'down', totalSecs:1500, secs:1500,
                      startAt:tNow - 1500000, endedAt:tNow - 60000, reason:'natural'}];
      NATIVE = {
        focusState: function(){
          return JSON.stringify({hasSession:false, running:false, pending:pending});
        },
        focusAck: function(ids){
          acked = ids;
          try{
            var drop = JSON.parse(ids || '[]').map(String);
            pending = pending.filter(function(x){ return drop.indexOf(String(x.id)) < 0; });
          }catch(e){}
        }
      };
      var before = todayMin();
      syncFocusFromNative();
      var grew = todayMin() - before;
      var ackOk = !!acked && String(acked).indexOf('1700000000000') >= 0;
      /* 第二次：队列已空，不能再多记一分 */
      var mid = todayMin();
      syncFocusFromNative();
      var grew2 = todayMin() - mid;
      var idempotent = Math.abs(grew2) < 0.001;
      return {
        ok: Math.abs(grew - 25) < 0.01 && ackOk && idempotent,
        info: '补记 ' + grew.toFixed(2) + ' 分钟（期望 25）· 已回执=' + ackOk
          + ' · 二次同步再记=' + grew2.toFixed(2) + '（期望 0，幂等）'
      };
    } finally {
      NATIVE = oldN; isApp = oldApp;
      try{ S.days = JSON.parse(oldDays); S.classes = JSON.parse(oldCls); save(); }catch(e){}
    }
  });

  // 跨天的补记必须记到「那一轮结束的那天」，不能全塞进今天
  // （真机场景：通知栏跑完一轮 → App 被杀 → 第二天才打开，今天会凭空多 25 分钟，
  //   今日/本周/连续打卡三口径一起虚高）
  T('跨天补记记到结束那天，不记到今天', function(){
    if(typeof syncFocusFromNative !== 'function') return { ok:false, info:'缺 syncFocusFromNative' };
    var oldN = NATIVE, oldApp = isApp, oldDays = JSON.stringify(S.days);
    try{
      isApp = true;
      var yD = new Date(); yD.setDate(yD.getDate() - 1);
      var yKey = dayKey(yD), tKey = todayKey();
      var ended = yD.getTime();
      var pending = [{id:'xj-crossday-1', label:'自由专注', courseId:'', mode:'work',
                      dir:'down', totalSecs:1500, secs:1500,
                      startAt:ended - 1500000, endedAt:ended, reason:'natural'}];
      NATIVE = {
        focusState: function(){ return JSON.stringify({hasSession:false, running:false, pending:pending}); },
        focusAck: function(ids){
          try{
            var drop = JSON.parse(ids || '[]').map(String);
            pending = pending.filter(function(x){ return drop.indexOf(String(x.id)) < 0; });
          }catch(e){}
        }
      };
      var before = todayMin(), beforeY = dayMin(yKey);
      syncFocusFromNative();
      var grewToday = todayMin() - before;
      var grewY = dayMin(yKey) - beforeY;
      return {
        ok: Math.abs(grewToday) < 0.001 && Math.abs(grewY - 25) < 0.01,
        info: '今天多了=' + grewToday.toFixed(2) + '（期望 0） · 昨天多了=' + grewY.toFixed(2)
          + '（期望 25，键 ' + yKey + '）'
      };
    } finally {
      NATIVE = oldN; isApp = oldApp;
      try{ S.days = JSON.parse(oldDays); save(); }catch(e){}
    }
  });

  // 课程专注要记到那门课头上（S.classes[id].min 累加），且状态变 done
  T('课程专注补记会累加到对应课程', function(){
    if(typeof syncFocusFromNative !== 'function') return { ok:false, info:'缺 syncFocusFromNative' };
    var oldN = NATIVE, oldApp = isApp, oldDays = JSON.stringify(S.days), oldCls = JSON.stringify(S.classes);
    var cid0 = '__test_course__';
    try{
      isApp = true;
      NATIVE = {
        focusState: function(){
          return JSON.stringify({
            hasSession:false, running:false,
            pending:[{id:'1700000000001', label:'高等数学', courseId:cid0, mode:'work',
                      dir:'down', totalSecs:3000, secs:1800,
                      startAt:1700000000000, endedAt:1700001800000, reason:'natural'}]
          });
        },
        focusAck: function(){}
      };
      S.classes[cid0] = {status:'ongoing', min: 10};
      syncFocusFromNative();
      var rec = S.classes[cid0] || {};
      /* 10 分钟已有 + 30 分钟本次 = 40 */
      var minOk = rec.min === 40;
      var stOk = rec.status === 'done';
      return {
        ok: minOk && stOk,
        info: 'min=' + rec.min + '（期望 40）· status=' + rec.status + '（期望 done）'
      };
    } finally {
      NATIVE = oldN; isApp = oldApp;
      try{ S.days = JSON.parse(oldDays); S.classes = JSON.parse(oldCls); save(); }catch(e){}
    }
  });

  // 倒计时必须按 endsAt 推算：改 endsAt 就立刻改变剩余，而不是靠帧数慢慢减
  T('倒计时按绝对时间戳推算（不是逐帧自减）', function(){
    var f = S.focus;
    var snap = {on:f.on, dir:f.dir, secs:f.secs, endsAt:f.endsAt, total:f.total, courseId:f.courseId};
    try{
      f.on = true; f.paused = false; f.dir = 'down';
      f.total = 1500; f.secs = 1500;
      focusAnchor();
      var anchored = f.endsAt > Date.now();
      /* 把结束时刻往前拨 20 分钟，剩余就该立刻少 20 分钟 —— 自减做不到这点 */
      f.endsAt -= 20 * 60 * 1000;
      var now = Date.now();
      var remain = Math.max(0, (f.endsAt - now) / 1000);
      var near20 = Math.abs(remain - (1500 - 1200)) < 2;
      return {
        ok: anchored && near20,
        info: '钉了endsAt=' + anchored + ' · 拨后剩余≈' + remain.toFixed(0) + 's（期望≈300s）'
      };
    } finally {
      f.on = snap.on; f.dir = snap.dir; f.secs = snap.secs;
      f.endsAt = snap.endsAt; f.total = snap.total; f.courseId = snap.courseId;
    }
  });

  // 已经在课中的课不能再预约（哪怕只剩一分钟下课）
  T('课中的课不能再预约（剩 1 分钟也不行）', function(){
    if(typeof canBookCourse !== 'function') return { ok:false, info:'缺 canBookCourse' };
    var nowM = toMin(nowHM());
    var inClass = {t: fmtHM(nowM - 10) + '-' + fmtHM(nowM + 1), n:'马上要下课'};
    var upcoming = {t: fmtHM(nowM + 30) + '-' + fmtHM(nowM + 90), n:'还没开始'};
    var a = canBookCourse(todayI, inClass);
    var b = canBookCourse(todayI, upcoming);
    return {
      ok: a === false && b === true,
      info: '剩1分钟下课可预约=' + a + '（期望 false）· 30分钟后才上课可预约=' + b + '（期望 true）'
    };
  });

  // ============ 课表 · 补课 / 停课（overrides）============
  function ovSnap(){
    return JSON.stringify({
      ov: S.overrides || [], cur: S.courses,
      ts: S.termStart
    });
  }
  function ovRestore(s){
    var o = JSON.parse(s);
    S.overrides = o.ov; S.courses = o.cur; S.termStart = o.ts;
    save();
  }
  /* 「周六补双周周一的课」全链路：AI 工具落 overrides，dayInfo 当天真的多出课 */
  T('补课：addMakeup 落 overrides，目标日期当天多出课且带「补」语义', function(){
    if(typeof runOneTool !== 'function') return { ok:false, info:'缺 runOneTool' };
    var snap = ovSnap();
    try{
      /* 固定学期起点 = 本周一 → 今天在第 1 周（奇）；「双周」的课在第 2 周的周六 */
      var mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
      function dk(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
      S.termStart = dk(mon);
      S.courses[0] = [{ t:'08:00-09:40', n:'高等数学', loc:'教三305', w:'even', c:1 }];
      var sat = new Date(mon); sat.setDate(sat.getDate() + 12); /* 第 2 周周六 */
      var satKey = dk(sat);
      var out = String(runOneTool('addMakeup', { date: satKey, from: 0, w: 'even' }) || '');
      var satIdx = (sat.getDay() + 6) % 7;
      var wno2 = 2;
      var info = dayInfo(satIdx, wno2);
      var got = info.courses.filter(function(c){ return c.n === '高等数学' && c.__ov; });
      var week1 = dayInfo(satIdx, 1);   /* 第 1 周的周六不该有 */
      var ok = S.overrides.length === 1 && got.length === 1
        && got[0].t === '08:00-09:40' && week1.courses.length === 0
        && out.indexOf('补课') >= 0;
      return { ok: ok,
        info: 'overrides=' + S.overrides.length + ' · 第2周周六多出=' + got.length
          + ' · 第1周周六=' + week1.courses.length + '（期望0）· 回执含「补课」=' + (out.indexOf('补课') >= 0) };
    } finally { ovRestore(snap); }
  });
  /* 停课：cancel 后该课当天消失，且契约把 overrides 推给原生 */
  T('停课：cancelCourseOnce 后当天该课消失，原生契约带上 overrides', function(){
    if(typeof runOneTool !== 'function') return { ok:false, info:'缺 runOneTool' };
    var snap = ovSnap();
    var captured = null, oldN = NATIVE;
    try{
      var mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
      function dk2(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
      S.termStart = dk2(mon);
      var wed = new Date(mon); wed.setDate(wed.getDate() + 2);
      var wedKey = dk2(wed);
      S.courses[2] = [{ t:'10:00-11:40', n:'大学英语', loc:'', w:'all', c:0 }];
      runOneTool('cancelCourseOnce', { date: wedKey, name: '大学英语' });
      var got = dayInfo(2, 1).courses.filter(function(c){ return c.n === '大学英语'; });
      NATIVE = { setSchedule: function(j){ captured = j; }, setPrefs: function(){} };
      pushScheduleToNative();
      var p = null; try{ p = JSON.parse(captured); }catch(e){}
      return {
        ok: got.length === 0 && S.overrides.length === 1 && !!p && Array.isArray(p.overrides) && p.overrides.length === 1,
        info: '周三该课剩=' + got.length + '（期望0）· overrides 落库=' + S.overrides.length
          + ' · 契约推送=' + (p && p.overrides ? p.overrides.length + ' 条' : '无')
      };
    } finally { ovRestore(snap); NATIVE = oldN; }
  });

  // ============ 笔记重构 ============
  T('笔记列表默认双列卡片，含搜索框与文件夹 chips', function(){
    if(typeof openNotes !== 'function') return { ok:false, info:'缺 openNotes' };
    var snap = ovSnap(); var snapN = JSON.stringify(S.notes);
    try{
      S.notes = [
        { id:'na', title:'第一篇', body:'正文内容，用来验证预览', at:Date.now(), folder:'' },
        { id:'nb', title:'第二篇', body:'手写预览', at:Date.now(), folder:'' }
      ];
      save();
      noteMode = 'list'; noteCurId = null;
      openNotes();
      var g = document.querySelector('#notesBody .note-grid');
      var cards = document.querySelectorAll('#notesBody .n-card');
      var cols = g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0;
      var hasSearch = !!document.getElementById('noteSearchIn');
      var hasChips = !!document.querySelector('#notesBody .nb-chip');
      return { ok: cols === 2 && cards.length === 2 && hasSearch && hasChips,
        info: '网格列数=' + cols + '（期望2）· 卡片数=' + cards.length
          + ' · 搜索框=' + hasSearch + ' · chips=' + hasChips };
    } finally {
      S.notes = JSON.parse(snapN); ovRestore(snap); noteMode='list'; noteCurId=null;
    }
  });
  T('文件夹：创建 → 移动 → chip 过滤只看该文件夹', function(){
    if(typeof noteFolderAdd !== 'function') return { ok:false, info:'缺 noteFolderAdd' };
    var snap = ovSnap(); var snapN = JSON.stringify(S.notes);
    try{
      S.notes = [{ id:'nf1', title:'要移动的', body:'', at:Date.now(), folder:'' }];
      S.noteFolders = [];
      save();
      /* 建文件夹：模拟输入后调用 */
      document.body.insertAdjacentHTML('beforeend', '<input id="nfName" style="display:none">');
      document.getElementById('nfName').value = '期末复习';
      noteFolderAdd();
      var created = noteFoldersAll().indexOf('期末复习') >= 0;
      var createdCleanup = document.getElementById('nfName'); if(createdCleanup) createdCleanup.remove();
      /* 移动 */
      noteCurId = 'nf1';
      noteMoveTo('期末复习');
      var moved = notesAll()[0].folder === '期末复习';
      /* 过滤 */
      noteFolder = '期末复习';
      var got = noteFiltered().length;
      noteFolder = '__none__';
      var none = noteFiltered().length;
      return { ok: created && moved && got === 1 && none === 0,
        info: '建夹=' + created + ' · 移动=' + moved + ' · 该夹可见=' + got + ' · 未分类可见=' + none + '（期望0）' };
    } finally {
      S.notes = JSON.parse(snapN); ovRestore(snap);
      noteFolder = ''; noteQ = ''; noteCurId = null;
    }
  });
  T('搜索：命中标题或正文，大小写不敏感', function(){
    var snapN = JSON.stringify(S.notes);
    try{
      S.notes = [
        { id:'sq1', title:'线性代数笔记', body:'行列式', at:Date.now(), folder:'' },
        { id:'sq2', title:'英语单词', body:' Helmholtz ', at:Date.now(), folder:'' }
      ];
      noteQ = 'helm';
      var a = noteFiltered().length;
      noteQ = '线性代数';
      var b = noteFiltered().length;
      return { ok: a === 1 && b === 1,
        info: 'helm 命中=' + a + ' · 线性代数命中=' + b };
    } finally { S.notes = JSON.parse(snapN); noteQ = ''; }
  });
  T('新建弹层有「文字 / 手写」两个入口', function(){
    openSheet('notenew');
    var h = document.getElementById('sheet') ? document.getElementById('sheet').innerHTML : '';
    var ok = h.indexOf('文字笔记') >= 0 && h.indexOf('手写笔记') >= 0;
    closeSheet();
    return { ok: ok, info: '文字入口=' + (h.indexOf('文字笔记') >= 0) + ' · 手写入口=' + (h.indexOf('手写笔记') >= 0) };
  });
  T('手写底栏不遮挡画布（stage 底边 ≤ 工具栏顶边）', function(){
    var snapN = JSON.stringify(S.notes);
    try{
      S.notes = [{ id:'ik1', title:'手写', body:'', at:Date.now(), folder:'', mode:'ink' }];
      save(); noteCurId = 'ik1'; noteMode = 'edit'; renderNotes();
      inkEnterFull();   /* 里面同步跑了一次 inkFit，布局即刻有效 */
      var st = document.getElementById('inkStage'), bar = document.getElementById('inkBar');
      var full = document.getElementById('inkFull');
      var shown = full && full.classList.contains('show');
      var sr = st.getBoundingClientRect(), br = bar.getBoundingClientRect();
      var noCover = br.top >= sr.bottom - 1;
      var hasMore = !!document.getElementById('inkMoreBtn');
      inkExitFull();
      return { ok: shown && noCover && hasMore,
        info: '打开=' + shown + ' · stage底=' + Math.round(sr.bottom) + ' · bar顶=' + Math.round(br.top)
          + ' · 不遮挡=' + noCover + ' · 更多按钮=' + hasMore };
    } finally { S.notes = JSON.parse(snapN); noteMode = 'list'; noteCurId = null; }
  });
  T('每支笔的墨色独立（改铅笔不影响马克笔）', function(){
    var old = JSON.stringify(noteInk.brush);
    try{
      inkDark = false;
      inkSetColorSlot('#e11d48');          /* 当前是 pencil */
      var pen = noteInk.brush.pencil.colorLight;
      var marker = noteInk.brush.marker.colorLight;
      var ok = pen === '#e11d48' && marker !== '#e11d48';
      return { ok: ok, info: '铅笔=' + pen + ' · 马克笔=' + marker + '（两者必须不同）' };
    } finally { noteInk.brush = JSON.parse(old); saveInkPrefs(); }
  });
  T('文字笔记有 AI 加工入口与「日期·字数」行', function(){
    var snapN = JSON.stringify(S.notes);
    try{
      S.notes = [{ id:'ait1', title:'AI', body:'<div>一段测试正文</div>', at:Date.now(), folder:'' }];
      save(); noteCurId = 'ait1'; noteMode = 'edit'; renderNotes();
      noteFullEnter();
      var meta = document.getElementById('noteMeta');
      var metaOk = meta && /年.{1,3}月.{1,3}日/.test(meta.textContent) && /字/.test(meta.textContent);
      var aiBtn = document.querySelector('#noteBarFull .ntb.ai');
      var cnt = noteBodyText().length;
      noteFullClose();
      return { ok: !!aiBtn && metaOk && cnt >= 6,
        info: 'AI按钮=' + !!aiBtn + ' · 日期字数行=' + !!metaOk + '（「' + (meta ? meta.textContent : '') + '」）· 正文字数=' + cnt };
    } finally { S.notes = JSON.parse(snapN); noteMode = 'list'; noteCurId = null; }
  });

  // ============ 笔记：单双列 + 选区样式（v0.2.6）============
  T('笔记列表可切单/双列，且真的改变网格列数', function(){
    var snapN = JSON.stringify(S.notes), snapCols = S.noteCols;
    try{
      S.notes = [
        { id:'c1', title:'甲', body:'一', at:Date.now(), folder:'' },
        { id:'c2', title:'乙', body:'二', at:Date.now(), folder:'' }
      ];
      S.noteCols = 2; noteMode = 'list'; noteCurId = null; renderNotes();
      function cols(){
        var g = document.querySelector('.note-grid');
        return g ? getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length : -1;
      }
      var two = cols();
      var attrTwo = document.querySelector('.note-grid').getAttribute('data-cols');
      noteToggleCols();
      var one = cols();
      var attrOne = document.querySelector('.note-grid').getAttribute('data-cols');
      var btnIcon = (document.getElementById('noteColsBtn') || {}).innerHTML || '';
      noteToggleCols();
      var back = cols();
      var persisted = S.noteCols === 2;
      return {
        ok: two === 2 && one === 1 && back === 2 && attrTwo === '2' && attrOne === '1' && persisted,
        info: '双列=' + two + '（期望2）· 切后=' + one + '（期望1）· 切回=' + back + ' · data-cols='
          + attrTwo + '/' + attrOne + ' · 按钮有图标=' + (btnIcon.length > 10) + ' · 已落盘=' + persisted
      };
    } finally {
      S.notes = JSON.parse(snapN); S.noteCols = snapCols;
      noteMode = 'list'; noteCurId = null; renderNotes();
    }
  });
  // 用户的原话：「文字笔记的字体大小和样式等仅对长按选中的文字生效」。
  // 以前的 A−/A+ 改的是 bd.style.fontSize（整篇），这里量的是：动了选区之后，
  // 只有选区被包了 span，正文基准字号**一点没变**。
  T('字号只作用在选中的那段文字，正文基准不变', function(){
    var snapN = JSON.stringify(S.notes);
    try{
      S.notes = [{ id:'fs1', title:'字号', body:'定积分的性质线性性', at:Date.now(), folder:'' }];
      save(); noteCurId = 'fs1'; noteMode = 'edit'; renderNotes();
      noteFullEnter();
      var bd = document.getElementById('noteBody');
      var base0 = getComputedStyle(bd).fontSize;
      var tn = bd.firstChild;
      var rng = document.createRange(); rng.setStart(tn, 0); rng.setEnd(tn, 3);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
      noteSyncSel();
      var chip0 = document.getElementById('ntbSize').textContent;
      noteStepFs(1);
      var spans = bd.querySelectorAll('span[style*="font-size"]');
      var inner = spans.length ? spans[0].style.fontSize : 'none';
      var base1 = getComputedStyle(bd).fontSize;
      /* 未选中时再点一次：不许改任何东西，且要提示 */
      sel.removeAllRanges();
      noteStepFs(1);
      var after = bd.querySelectorAll('span[style*="font-size"]').length;
      var base2 = getComputedStyle(bd).fontSize;
      var ok = spans.length === 1 && parseFloat(inner) > parseFloat(base0)
            && base0 === base1 && base1 === base2 && after === 1;
      noteFullClose();
      return {
        ok: ok,
        info: '选中chip=' + chip0 + ' · 套span=' + spans.length + ' · 段内=' + inner
          + ' · 基准 改前/改后/空选后=' + base0 + '/' + base1 + '/' + base2 + ' · 空选未新增span=' + (after === 1)
      };
    } finally { S.notes = JSON.parse(snapN); noteMode = 'list'; noteCurId = null; }
  });
  T('手写工具栏图标齐全且都能画出内容（不是空路径）', function(){
    var keys = ['pencil','marker','brush','eraserStroke','eraserArea','fit','undo','redo','sliders'];
    var empty = keys.filter(function(k){
      var s = icSvg(k, 19);
      return !s || s.indexOf('<path') < 0 && s.indexOf('<rect') < 0 && s.indexOf('<circle') < 0;
    });
    /* 三支笔必须长得不一样 —— 复制粘贴把 pencil 的路径抄给 marker 是真实会犯的错 */
    var same = (icSvg('pencil',19) === icSvg('marker',19))
            || (icSvg('marker',19) === icSvg('brush',19))
            || (icSvg('pencil',19) === icSvg('brush',19));
    return {
      ok: empty.length === 0 && !same,
      info: '缺图形的键=' + (empty.length ? empty.join(',') : '无') + ' · 三支笔图形重复=' + same
    };
  });

  // 用户报的 bug：笔记编辑页里按返回（或侧滑）直接掉回主页，跳过了预览列表。
  // 笔记是**三级**的：全屏编辑器 → 编辑页 → 列表 → 退出笔记。这里把三级都量一遍。
  T('笔记返回是三级：编辑页返回回列表，不直接退出笔记', function(){
    var snapN = JSON.stringify(S.notes), snapMode = noteMode, snapCur = noteCurId;
    function viewShown(){ var v = document.getElementById('view-notes'); return !!(v && v.classList.contains('show')); }
    function fullShown(id){ var e = document.getElementById(id); return !!(e && e.classList.contains('show')); }
    try{
      S.notes = [{ id:'bk1', title:'返回测试', body:'正文一段', at:Date.now(), folder:'' }];
      save();
      noteMode = 'list'; noteCurId = null; openNotes();
      var opened = viewShown() && noteMode === 'list';

      /* ① 编辑页按返回 → 回列表，笔记页**仍然开着**（这就是被跳过的那一层） */
      noteOpen('bk1');
      var inEdit = viewShown() && noteMode === 'edit';
      var h1 = androidBack();
      var backToList = h1 === true && viewShown() && noteMode === 'list';

      /* ② 列表再返回 → 这一步才该关掉笔记页 */
      var h2 = androidBack();
      var closed = h2 === true && !viewShown();

      /* ③ 全屏文字编辑器里返回 → 关编辑器，但留在编辑页（不是直接回主页） */
      openNotes(); noteOpen('bk1'); noteFullEnter();
      var editorOpen = fullShown('noteFull');
      var h3 = androidBack();
      var editorGone = !fullShown('noteFull');
      var stillInEdit = viewShown() && noteMode === 'edit';

      /* ④ 全屏手写里返回 → 关手写，仍在编辑页 */
      noteSetMode('ink'); inkEnterFull();
      var inkOpen = fullShown('inkFull');
      var h4 = androidBack();
      var inkGone = !fullShown('inkFull');
      var stillInEdit2 = viewShown() && noteMode === 'edit';

      return {
        ok: opened && inEdit && backToList && closed
          && editorOpen && editorGone && stillInEdit
          && inkOpen && inkGone && stillInEdit2,
        info: '① 打开=' + opened + ' 进编辑=' + inEdit + ' 返回回列表=' + backToList
          + ' · ② 列表再返回关页=' + closed
          + ' · ③ 全屏文字 开=' + editorOpen + ' 返回关掉=' + editorGone + ' 留在编辑页=' + stillInEdit
          + ' · ④ 全屏手写 开=' + inkOpen + ' 返回关掉=' + inkGone + ' 留在编辑页=' + stillInEdit2
      };
    } finally {
      S.notes = JSON.parse(snapN); save();
      try{ noteMode = 'edit'; noteCurId = 'bk1'; }catch(e){}
      try{ noteFullClose(); }catch(e){}
      try{ closeView('notes'); }catch(e){}
      noteMode = snapMode; noteCurId = snapCur;
      try{ renderNotes(); }catch(e){}
    }
  });

  // ============ 灵动岛（v0.2.7）：两列排版 + 分项开关 ============
  T('灵动岛设置页：两列预览、分项开关真的改状态并推给原生', function(){
    var snapP = JSON.stringify(S.prefs);
    var keepNative = (typeof NATIVE !== 'undefined') ? NATIVE : null;
    var keepApp = (typeof isApp !== 'undefined') ? isApp : false;
    try{
      isApp = true;
      var onCalls = [], cfgCalls = [];
      NATIVE = {
        setIslandOn: function(v){ onCalls.push(String(v)); },
        setIslandPrefs: function(j){ cfgCalls.push(String(j)); },
        testNotify: function(){}
      };
      S.prefs.islandOn = true; S.prefs.islandStart = true;
      S.prefs.islandEnd = true; S.prefs.islandStay = true;
      S.prefs.islandElems = ['course','place','countdown'];
      noteMode = 'list'; noteCurId = null;
      openView('island');
      var host = document.getElementById('islandBody');
      if(!host) return { ok:false, info:'缺 #islandBody' };

      /* 两个预览：上面是上课提醒（右列分钟），下面是专注（右列 MM:SS）。
         以前下面是「上课中」，用户要求换成专注预览 —— 两种右列格式不一样，
         所以分开断言，别用一个正则通吃。 */
      var pills = host.querySelectorAll('.isl-pill');
      var rightOk = pills.length === 2;
      if(rightOk){
        var c1 = pills[0].querySelector('.ip-r'), n1 = pills[0].querySelector('.ip-l b');
        var c2 = pills[1].querySelector('.ip-r'), n2 = pills[1].querySelector('.ip-l b');
        rightOk = !!c1 && !!n1 && /分钟/.test(c1.textContent)
               && !!c2 && !!n2 && /^\d{1,2}:\d{2}$/.test(c2.textContent.trim())
               && n1.textContent.indexOf('数据结构') >= 0
               && n2.textContent.indexOf('专注') >= 0;
      }
      /* 关掉「倒计时」元素：预览右列必须消失（不能留着骗人） */
      islandToggleElem('countdown');
      var noRight = !host.querySelector('.isl-pill .ip-r');
      var cfg1 = {};
      try{ cfg1 = JSON.parse(cfgCalls[cfgCalls.length - 1]); }catch(e){}
      /* 关掉「地点」：左列副文本也必须消失。
         第一版这里写反了（sub 无条件初始化，if 里赋同一个值），
         截图才发现预览一直在显示地点 —— 所以这条一起量。 */
      islandToggleElem('place');
      var noSub = !host.querySelector('.isl-pill .ip-l small');
      islandToggleElem('place'); islandToggleElem('countdown');
      /* 关「上课期间常驻」：JSON 里 stay 必须真变 false */
      islandToggle('islandStay');
      var cfg2 = {};
      try{ cfg2 = JSON.parse(cfgCalls[cfgCalls.length - 1]); }catch(e){}
      /* 关「专注计时上岛」：focus 必须真变 false（以前专注上岛不可配） */
      islandToggle('islandFocus');
      var cfgF = {};
      try{ cfgF = JSON.parse(cfgCalls[cfgCalls.length - 1]); }catch(e){}
      islandToggle('islandFocus');
      /* 切岛屿形态：len 必须跟着变（0 短岛 / 1 标准 / 2 完整） */
      islandSetForm(0);
      var cfgL1 = {};
      try{ cfgL1 = JSON.parse(cfgCalls[cfgCalls.length - 1]); }catch(e){}
      var shortPill = host.querySelector('.isl-pill.short');
      var shortNoSub = !!shortPill && !shortPill.querySelector('.ip-l small')
        && !!shortPill.querySelector('.isl-ring') && !!shortPill.querySelector('.ip-r');
      islandSetForm(2);
      var cfgL2 = {};
      try{ cfgL2 = JSON.parse(cfgCalls[cfgCalls.length - 1]); }catch(e){}
      var fullBar = !!host.querySelector('.isl-bar');
      islandSetForm(1);
      /* 切停留时长：stayMin 必须跟着变，与形态互不影响 */
      islandSetStay(30);
      var cfgT1 = {};
      try{ cfgT1 = JSON.parse(cfgCalls[cfgCalls.length - 1]); }catch(e){}
      islandSetStay(10);
      /* 元素自定义是折叠的：默认收起，点标题行才展开 */
      var fold = document.getElementById('islFold');
      var foldClosed = fold && !fold.classList.contains('open');
      islandToggleFold();
      var foldOpen = fold && fold.classList.contains('open');
      islandToggleFold();
      var foldClosedAgain = fold && !fold.classList.contains('open');
      /* 关总开关：既要通知原生收回，也要把 on 一起推过去 */
      islandToggle('islandOn');
      var cfg3 = {};
      try{ cfg3 = JSON.parse(cfgCalls[cfgCalls.length - 1]); }catch(e){}
      var badge = (document.getElementById('islandBadge') || {}).textContent || '';
      islandToggle('islandOn');
      var ok = rightOk && noRight && noSub
        && cfg1.elems && cfg1.elems.indexOf('countdown') < 0
        && cfg2.stay === false && cfgF.focus === false
        && cfgL1.len === 0 && cfgL2.len === 2
        && cfgT1.stayMin === 30
        && shortPill && shortNoSub && fullBar
        && foldClosed && foldOpen && foldClosedAgain
        && cfg3.on === false
        && onCalls.indexOf('0') >= 0 && badge === '已关';
      return {
        ok: ok,
        info: '两列预览=' + rightOk + ' · 关倒计时后右列消失=' + noRight
          + ' · 关地点后副文本消失=' + noSub
          + ' · elems同步=' + (cfg1.elems ? cfg1.elems.join('|') : 'x')
          + ' · stay=false=' + (cfg2.stay === false)
          + ' · 专注可关=' + (cfgF.focus === false)
          + ' · 形态len=' + cfgL1.len + '/' + cfgL2.len + ' · 停留stayMin=' + cfgT1.stayMin
          + ' · 短岛极窄+环=' + shortNoSub + ' · 完整档横条=' + fullBar
          + ' · 折叠 收/开/收=' + foldClosed + '/' + foldOpen + '/' + foldClosedAgain
          + ' · on=false=' + (cfg3.on === false)
          + ' · 通知原生收回=' + (onCalls.indexOf('0') >= 0)
          + ' · 角标=' + badge
      };
    } finally {
      S.prefs = JSON.parse(snapP); save();
      NATIVE = keepNative; isApp = keepApp;
      try{ closeView('island'); }catch(e){}
    }
  });
  // 真机踩过的排版事故：停留时长的三档被压成 56px 宽，「标准」竖排成两行
  //（图上看着像乱码）。原因是 .seg 是 .li 的 flex 子项、不写 flex 时基准宽
  // 取内容宽，而档位又是 flex:1。这里把「够宽 + 不换行」钉死。
  T('分段控件够宽、档位不竖排（真机踩过：「标准」被挤成两行）', function(){
    var snapP = JSON.stringify(S.prefs);
    var keepApp = (typeof isApp !== 'undefined') ? isApp : false;
    try{
      isApp = true;
      /* 量的是布局，不是动画的某一帧：进场动画里 .view 带着 scale，
         getBoundingClientRect 会返回缩放后的值（204 vs 真正的 200），
         于是「档位有没有竖排」被 0.6px 的增益判成竖排。先关动效再量。 */
      document.documentElement.classList.add('no-motion');
      NATIVE = { setIslandOn: function(){}, setIslandPrefs: function(){}, testNotify: function(){} };
      noteMode = 'list'; noteCurId = null;
      openView('island');
      var segs = ['islandFormSeg', 'islandStaySeg'].map(function(id){
        var s = document.getElementById(id);
        if(!s) return { id:id, ok:false, info:'找不到 #' + id };
        var sr = s.getBoundingClientRect();
        var th = s.querySelector('.segThumb');
        var tR = th ? th.getBoundingClientRect() : null;
        var ovY = tR ? Math.round((sr.top - tR.top) + (tR.bottom - sr.bottom)) : 999;
        var ovX = tR ? Math.round((sr.left - tR.left) + (tR.right - sr.right)) : 999;
        var items = [].map.call(s.querySelectorAll('.segI'), function(x){
          var r = x.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), t: x.textContent.trim() };
        });
        return { id:id, ok: sr.width >= 150
            && items.filter(function(i){ return i.h > 32; }).length === 0
            && items.filter(function(i){ return i.w < 44; }).length === 0
            && !!tR && ovY === -6 && ovX <= -2 && Math.round(tR.height) === Math.round(sr.height) - 6,
          info: Math.round(sr.width) + 'px / ' + items.map(function(i){ return i.t; }).join(' ') };
      });
      var seg = segs[0].id ? document.getElementById('islandFormSeg') : null;
      var segW = seg ? seg.getBoundingClientRect().width : 0;
      var rowW = seg && seg.closest('.li') ? seg.closest('.li').getBoundingClientRect().width : 0;
      /* 也钉一下「正文大小」那处：它是同一个 .seg 组件，一起量才放心 */
      closeView('island');
      go('me');
      var fs = document.getElementById('fsSeg');
      var fsItems = fs ? [].map.call(fs.querySelectorAll('.segI'), function(x){
        return Math.round(x.getBoundingClientRect().width);
      }) : [];
      if(keepApp && keepApp !== true) go('me');
      var ok = segs.every(function(s){ return s.ok; })
            && segW >= 150 && rowW > segW && fsItems.length === 4
            && fsItems.every(function(w){ return w >= 60; });
      return {
        ok: ok,
        info: segs.map(function(s){ return s.id + ' ' + s.info; }).join(' | ')
          + ' · 形态seg 宽=' + Math.round(segW) + '（父行 ' + Math.round(rowW) + '）'
          + ' · 正文大小各档宽=' + (fsItems.join('/') || '量不到')
      };
    } finally {
      document.documentElement.classList.remove('no-motion');
      S.prefs = JSON.parse(snapP); save();
      isApp = keepApp;
      try{ closeView('island'); }catch(e){}
      try{ renderNotes(); }catch(e){}
    }
  });

  // 一级：所有二级页都必须登记进 SUBVIEWS（真机踩过：陪伴页侧滑直接退桌面）。
  // 不写死名单 —— 直接拿 DOM 里 class="view" 的元素对账，以后新增页面漏登记会自动被抓。
  T('架构守卫：每个 .view 都登记进 SUBVIEWS（返回层认得它）', function(){
    var domIds = [].map.call(document.querySelectorAll('.view'), function(v){
      return (v.id || '').replace(/^view-/, '');
    }).filter(Boolean);
    var missing = domIds.filter(function(id){ return SUBVIEWS.indexOf(id) < 0; });
    var ghost = SUBVIEWS.filter(function(id){ return domIds.indexOf(id) < 0; });
    return {
      ok: missing.length === 0 && ghost.length === 0,
      info: 'DOM 二级页=' + domIds.length + ' · 未登记=' + (missing.join(',') || '无')
        + ' · 名单里查无此页=' + (ghost.join(',') || '无')
    };
  });

  // AI 档案 / 行程上下文里不能出现 undefined —— 字段名写错时不报错，
  // 只是把「undefined（未完成）」喂给模型，等于静默丢掉一整行上下文。
  T('架构守卫：给 AI 的档案里没有 undefined 字段', function(){
    var before = JSON.stringify(S.tasks);
    try{
      S.tasks[taskKey(todayI)] = [{h:'09:00', t:'测试验证字段', s:'', done:false, pomo:1, mins:25}];
      var p = profileBlock();
      var ctx = dayContext ? dayContext(todayI) : '';
      var bad = /undefined/.test(p) || /undefined/.test(ctx);
      var hit = '';
      if(bad){
        var line = (p + '\n' + ctx).split('\n').filter(function(l){ return l.indexOf('undefined') >= 0; })[0] || '';
        hit = line.slice(0, 60);
      }
      return { ok: !bad, info: bad ? ('出现 undefined：' + hit) : '档案与当日上下文都干净' };
    } finally {
      S.tasks = JSON.parse(before); save();
    }
  });

  // 备份清单必须覆盖所有会持久化的状态键。
  // 这条是真踩过坑才加的：providerAcc / customProviders / roles / 定价 这些后加的键
  // 没人记得补进 BACKUP_KEYS，换机就静默丢一半配置。
  T('架构守卫：每个持久化状态键都在备份清单里', function(){
    /* 故意不备份的键：跑一轮就变的会话态、启动标记、纯派生缓存、诊断信息 */
    var SKIP = {schema:1, onboarded:1, focus:1, holLastErr:1, __holFlat:1,
                sysHolidays:1, holidays:1, summaryTried:1};
    var covered = {};
    BACKUP_KEYS.study.concat(BACKUP_KEYS.ai).forEach(function(k){ covered[k] = 1; });
    var leaked = Object.keys(S).filter(function(k){ return !covered[k] && !SKIP[k]; });
    var dup = BACKUP_KEYS.study.filter(function(k){ return BACKUP_KEYS.ai.indexOf(k) >= 0; });
    return {
      ok: leaked.length === 0 && dup.length === 0,
      info: '状态键 ' + Object.keys(S).length + ' 个 · 备份清单 '
        + Object.keys(covered).length + ' 个 · 没覆盖=' + (leaked.join(',') || '无')
        + ' · 两组重复=' + (dup.join(',') || '无')
    };
  });

  // 全屏文字笔记的「完成」按钮：高亮摆在那儿却没人绑定，点了没反应（真机踩过同类）。
  T('全屏笔记的「完成」按钮真的能退出', function(){
    var b = document.getElementById('noteDoneBtn');
    if(!b) return { ok:false, info:'找不到 #noteDoneBtn' };
    var bound = typeof b.onclick === 'function' || !!b.getAttribute('onclick');
    var before = document.getElementById('noteFull').classList.contains('show');
    document.getElementById('noteFull').classList.add('show');
    b.click();
    var closed = !document.getElementById('noteFull').classList.contains('show');
    if(before) document.getElementById('noteFull').classList.add('show');
    return { ok: bound && closed, info: '有绑定=' + bound + ' · 点一下真的关了=' + closed };
  });

  // 跨零点：todayI 是启动时快照的，页面整夜开着不重算就会把昨天当今天。
  T('跨零点后 initClock 会把「今天」重算回来', function(){
    var real = todayIdx();
    var oldSel = selIdx, oldI = todayI;
    try{
      todayI = (real + 6) % 7;          /* 假装是昨天启动的 */
      selIdx = todayI;
      initClock();
      var fixed = (todayI === real);
      var selFollowed = (selIdx === real);  /* 原来停在今天，换日后该跟着走 */
      return { ok: fixed && selFollowed,
        info: '重算后 todayI=' + todayI + '（期望 ' + real + '） · selIdx 跟上=' + selFollowed };
    } finally {
      todayI = oldI; selIdx = oldSel;
    }
  });

  // 手写防抖的**行为**验证（不只是源码形状）：矢量立刻进笔记，位图要等冲盘
  T('手写落盘：调用了先存矢量，位图在 inkFlushSave 才导出', function(){
    if(typeof inkSaveToNote !== 'function' || typeof inkFlushSave !== 'function')
      return { ok:false, info:'缺 inkSaveToNote / inkFlushSave' };
    var oldNotes = JSON.stringify(S.notes), oldOn = inkOn, oldCur = noteCurId, oldItems = inkItems;
    try{
      S.notes = [{ id:'xj-ink-1', title:'自测', body:'', ink:'', inkItems:[], at:1 }];
      noteCurId = 'xj-ink-1'; inkOn = true; inkDark = false; inkBgImage = null;
      /* 无头环境里全屏画布没被 prep 过就是 0×0，toDataURL 只会得到空串 ——
         先给个真实尺寸，让「位图有没有导出」这个判据有意义。 */
      var cv0 = inkCanvasEl();
      if(!cv0) return { ok:false, info:'找不到手写画布元素' };
      cv0.width = 300; cv0.height = 420;
      var g0 = cv0.getContext('2d');
      g0.fillStyle = '#111111'; g0.fillRect(10, 10, 60, 60);
      inkItems = [{ kind:'stroke', tool:'pencil', color:'#111111', alpha:1, size:6, prs:false,
                   pts:[{x:12,y:14,p:.6},{x:60,y:88,p:.6},{x:120,y:40,p:.6}] }];
      inkSaveToNote();
      var n1 = noteById('xj-ink-1');
      var vecNow = !!(n1.inkItems && n1.inkItems.length === 1);
      var bmpBefore = n1.ink;
      inkFlushSave();
      var bmpAfter = noteById('xj-ink-1').ink;
      /* 冲完必须把待发状态清干净，否则再调一次会把同一份再写一遍 */
      var pendingClean = !inkSaveTimer && !inkPending;
      return {
        ok: vecNow && !bmpBefore && /^data:image\/png/.test(String(bmpAfter)) && pendingClean,
        info: '矢量立刻入笔记=' + vecNow
          + ' · 防抖窗口内位图=' + (bmpBefore ? '已导出（不该）' : '空')
          + ' · 冲盘后位图=' + String(bmpAfter).slice(0, 16) + '(len ' + String(bmpAfter).length + ')'
          + ' · 待发状态已清=' + pendingClean
      };
    } finally {
      S.notes = JSON.parse(oldNotes);
      inkOn = oldOn; noteCurId = oldCur; inkItems = oldItems;
      if(inkSaveTimer){ clearTimeout(inkSaveTimer); inkSaveTimer = null; }
      inkPending = null;
      try{ save(); }catch(e){}
    }
  });

  // 专注条：一条一个动作（整条=进专注页 / 收起=折小块 / 小块=展回整条），
  // 并盯住这几件真机踩过或一眼能看出的事：拖动跟手、松手吸附、越界回收、
  // 暂停在小块上也要看得出来、结束后复位，以及不再有「第几下才全屏」那种状态。
  T('专注条：整条进专注页 / 收起成小块 / 小块展回 / 拖动吸附不越界', function(){
    var el = document.getElementById('focusBar');
    if(!el) return { ok:false, info:'找不到 #focusBar' };
    var oldFocus = JSON.stringify(S.focus), oldShape = S.fbShape, oldPos = JSON.stringify(S.fbPos);
    var oldView = document.getElementById('view-focus').classList.contains('show');
    function tap(x, y){
      el.dispatchEvent(new PointerEvent('pointerdown', {pointerId:7, clientX:x, clientY:y, bubbles:true}));
      el.dispatchEvent(new PointerEvent('pointerup', {pointerId:7, clientX:x, clientY:y, bubbles:true}));
    }
    function dragTo(dx, dy){
      var r0 = el.getBoundingClientRect();
      var x0 = r0.left + r0.width / 2, y0 = r0.top + r0.height / 2;
      el.dispatchEvent(new PointerEvent('pointerdown', {pointerId:8, clientX:x0, clientY:y0, bubbles:true}));
      el.dispatchEvent(new PointerEvent('pointermove', {pointerId:8, clientX:x0 + dx, clientY:y0 + dy, bubbles:true}));
      el.dispatchEvent(new PointerEvent('pointerup', {pointerId:8, clientX:x0 + dx, clientY:y0 + dy, bubbles:true}));
    }
    try{
      S.focus = JSON.parse(JSON.stringify(DEFAULT.focus));
      S.focus.on = true; S.focus.label = '自测专注'; S.focus.mode = 'work';
      S.focus.dir = 'down'; S.focus.total = 1500; S.focus.secs = 1500;
      fbState = 'bar'; fbPos = null; S.fbPos = null; S.fbShape = null;
      el.classList.remove('dragging', 'fb-morph');
      renderFocus();
      var shown = el.classList.contains('show');
      var st0 = getComputedStyle(el);
      /* 显隐与形变都要有过渡：以前只有进场一条 animation，收起等于 display:none 硬切 */
      var hasTransition = parseFloat(st0.transitionDuration.split(',')[0]) > 0.05;
      var r1 = el.getBoundingClientRect();
      tap(r1.left + 30, r1.top + 20);
      var openedView = document.getElementById('view-focus').classList.contains('show');
      document.getElementById('view-focus').classList.remove('show');

      /* 收起 → 小块：当场就该是 pill，并用 left/top 定位（可拖） */
      document.getElementById('fbCollapse').dispatchEvent(new Event('click', {bubbles:true}));
      var isPill = el.classList.contains('pill');
      var positioned = !!el.style.left && !!el.style.top;
      var pw = Math.round(el.getBoundingClientRect().width);

      /* 往左上角死命拖：必须被夹回视口，并吸附到左边缘（14px） */
      dragTo(-4000, -4000);
      var r2 = el.getBoundingClientRect();
      var inside = r2.left >= 0 && r2.top >= 0
        && r2.right <= window.innerWidth + 1 && r2.bottom <= window.innerHeight + 1;
      /* 吸附是「写 left=14 + 让 transition 过去」，同帧读 rect 还在半路上，
         所以断言看真正写进去的定位值（吸附结果），rect 只用来判没越界。 */
      var snapped = Math.abs(parseFloat(el.style.left) - 14) <= 1;
      var savedPos = !!(S.fbPos && S.fbPos.x >= 0);

      /* 暂停状态要在两种形态都看得出来（以前 pill 把 pulse 整颗 display:none） */
      S.focus.paused = true; renderFocus();
      var pausedClass = el.classList.contains('paused');
      var pst = getComputedStyle(el.querySelector('.pulse'));
      var pulseVisibleInPill = pst.display !== 'none';
      var pulseFrozen = pst.animationName === 'none';
      el.classList.remove('pill');            /* 下面量整条形态，先把 class 摆正 */
      S.focus.paused = false;

      /* 点小块 → 展回整条：不该顺手把全屏页也打开，内联定位要清掉 */
      fbSetShape('pill');
      fbPos = { x: 14, y: Math.round(r2.top) };
      fbApply();
      var wasPill = el.classList.contains('pill');
      var r3 = el.getBoundingClientRect();
      tap(r3.left + 20, r3.top + 20);
      var backToBar = !el.classList.contains('pill');
      var inlineCleared = !el.style.left && !el.style.top;
      var viewStillClosed = !document.getElementById('view-focus').classList.contains('show');

      /* 一轮结束：隐藏 + 形态与位置复位（走真实的 stopFocus，别只翻标志） */
      S.focus.on = true; S.focus.total = 1500; S.focus.secs = 1500; renderFocus();
      stopFocus();
      var hidden = !el.classList.contains('show');
      var reset = fbState === 'bar' && fbPos === null && !S.fbPos && !S.fbShape
        && wasPill && backToBar !== undefined;

      return {
        ok: shown && hasTransition && openedView && isPill && positioned && pw <= 120
          && inside && snapped && savedPos && pausedClass && pulseVisibleInPill && pulseFrozen
          && wasPill && backToBar && inlineCleared && viewStillClosed && hidden && reset,
        info: '可见=' + shown + ' · 有过渡=' + hasTransition + ' · 点整条进全屏=' + openedView
          + ' · 收起成小块=' + (isPill && positioned) + '(宽' + pw + ')'
          + ' · 拖出被夹回=' + inside + ' · 吸附左边缘=' + snapped + ' · 位置已存=' + savedPos
          + ' · 暂停可见=' + (pausedClass && pulseVisibleInPill) + ' · pulse静止=' + pulseFrozen
          + ' · 点小块展回=' + (wasPill && backToBar && inlineCleared && viewStillClosed)
          + ' · 结束隐藏=' + hidden + ' · 复位=' + reset
      };
    } finally {
      S.focus = JSON.parse(oldFocus); S.fbShape = oldShape;
      S.fbPos = oldPos ? JSON.parse(oldPos) : null;
      fbState = 'bar'; fbPos = null;
      el.classList.remove('pill', 'paused', 'dragging', 'fb-morph');
      el.style.left = ''; el.style.top = ''; el.style.right = ''; el.style.bottom = '';
      try{
        document.getElementById('view-focus').classList.toggle('show', oldView);
        renderFocus(); save();
      }catch(e){}
    }
  });

  // 教学周口径：termStart 必须落在周一，否则同一个显示周里周一/周二与周三~周日
  // 会差一个周次，单双周课整整错一天（真机表现为「双周的课今天没上」）。
  T('教学周与自然周同一切口：开学日是周一，且整周周次一致', function(){
    var iso = S.termStart;
    if(!iso) return { ok:false, info:'termStart 为空' };
    var d = isoToDate(iso);
    var isMonday = d.getDay() === 1;
    /* 课表网格那一行 7 天（周一~周日）算出来的周次必须全相等 */
    var wnos = [];
    for(var i = 0; i < 7; i++){
      var dd = new Date(dayKeyOfWeek(i));
      wnos.push(weekNo(dd));
    }
    var same = wnos.every(function(w){ return w === wnos[0]; });
    /* 归一函数本身要能把任意日期拉回周一（老数据迁移与手动设置都走它） */
    var shift = mondayOfIso('2026-09-02');           /* 2026-09-02 是周三 */
    var shifted = shift === '2026-08-31';
    /* 模拟老数据：非周一的 termStart 必须被启动迁移拉平 */
    var oldTs = S.termStart, changed = false;
    try{
      S.termStart = '2026-09-02';
      changed = normalizeTermStart();
      var after = S.termStart;
      var d2 = isoToDate(after);
      return {
        ok: isMonday && same && shifted && changed && after === '2026-08-31' && d2.getDay() === 1,
        info: '当前开学日是周一=' + isMonday + '(' + iso + ')'
          + ' · 整周周次一致=' + same + '(' + wnos.join('/') + ')'
          + ' · 周三归一到周一=' + shifted + '(' + shift + ')'
          + ' · 老数据可被拉平=' + (changed && after === '2026-08-31')
      };
    } finally { S.termStart = oldTs; }
  });

  // 课程状态 / 预约的键必须带日期：旧格式（只有星期）会让「跳过」永久生效、
  // 让「已专注」跨周累计、让一条预约每周都自动开一次专注。
  T('课程键带日期：跳过只影响当天，旧格式键能被迁移', function(){
    var oldCls = JSON.stringify(S.classes), oldBook = JSON.stringify(S.bookings);
    var oldCourses = JSON.stringify(S.courses[0]), oldI = todayI;
    try{
      /* ① 同一门课在两个日期上必须是两个键 */
      S.courses[0] = [{ n:'自测·键', t:'08:00-09:40', loc:'', c:'#888', w:'all' }];
      todayI = 0;
      var kToday = cid(0, S.courses[0][0]);
      var kOther = 'd' + dkAdd(todayKey(), 1) + '-08:00-09:40-自测·键';
      var dated = /^d\d{4}-\d{2}-\d{2}-/.test(kToday) && kToday !== kOther;

      /* ② 喂一份旧格式数据，跑迁移 */
      var lastWeek = Date.now() - 9 * 86400000;
      S.classes = { 'd0-08:00-09:40-自测·键': { status:'ongoing', min:12 },
                    'd1-08:00-09:40-旧课': { status:'done', min:40 },
                    'd3-10:00-09:40-旧课2': { status:'skipped' } };
      S.bookings = { 'd0-08:00-09:40-自测·键': { day:0, t:'08:00-09:40', n:'自测·键', at:lastWeek },
                     'd1-10:00-10:40-旧预约': { day:1, t:'10:00-10:40', n:'旧预约', at:Date.now() } };
      migrateClassKeys();
      var clsKeys = Object.keys(S.classes);
      var clsOk = clsKeys.length === 1 && clsKeys[0] === kToday
        && S.classes[kToday].status === 'ongoing' && S.classes[kToday].min === 12;
      var bookKeys = Object.keys(S.bookings);
      /* 上周创建的预约作废；本周的补上 date */
      var bookOk = bookKeys.length === 1 && /^d\d{4}-\d{2}-\d{2}-/.test(bookKeys[0])
        && !!S.bookings[bookKeys[0]].date;

      /* ③ 新键下「跳过」不会波及另一个日期 */
      S.classes = {}; S.classes[kToday] = { status:'skipped' };
      var stillFresh = !(S.classes[kOther] && S.classes[kOther].status === 'skipped');

      return {
        ok: dated && clsOk && bookOk && stillFresh,
        info: '键带日期且按天分开=' + dated + '(' + kToday + ')'
          + ' · ongoing 搬到今天 / 历史丢弃=' + clsOk + '(' + clsKeys.join(',') + ')'
          + ' · 过期预约作废 + 补 date=' + bookOk + '(' + bookKeys.join(',') + ')'
          + ' · 跳过不波及别日=' + stillFresh
      };
    } finally {
      S.classes = JSON.parse(oldCls); S.bookings = JSON.parse(oldBook);
      S.courses[0] = JSON.parse(oldCourses); todayI = oldI;
      try{ save(); }catch(e){}
    }
  });

  // AI 请求要带 id：超时兜底放开队列后，上一条**迟到的回包**必须按 id 丢掉，
  // 否则它会交给此刻占坑的那条任务 —— 表现是「问 A 答 B」。
  T('AI 请求带 id：迟到的回包与增量都不会喂给下一条任务', function(){
    var oldPend = AI_PENDING, oldWait = AI_WAITING.slice(), oldApp = isApp, oldN = NATIVE;
    var oldKey = S.apiKey, oldUrl = S.baseUrl, oldProv = S.provider, oldStream = S.stream;
    try{
      isApp = true; S.provider = 'deepseek'; S.apiKey = 'k'; S.stream = false;
      S.baseUrl = 'https://api.deepseek.com/v1';
      AI_WAITING.length = 0; AI_PENDING = null;
      var sentIds = [], gotA = [], gotB = [], deltaB = 0;
      NATIVE = { aiPost: function(u, k, body, id){ sentIds.push(String(id)); return true; } };
      aiRequest({ model: 'm', messages: [] }, function(ok, p){ gotA.push(p); });
      var jobA = AI_PENDING; AI_PENDING = null;          /* 模拟 A 超时被作废 */
      aiRequest({ model: 'm', messages: [] }, function(ok, p){ gotB.push(p); },
        function(){ deltaB++; });
      var jobB = AI_PENDING;
      var idA = jobA && jobA.id, idB = jobB && jobB.id;
      var distinctIds = !!idA && !!idB && idA !== idB && sentIds.length === 2
        && String(sentIds[0]) === String(idA);

      /* A 迟到的整包与增量：都不许落到 B 头上 */
      window.onAiResult(String(idA), true, 'A的迟到答案');
      window.onAiStreamDelta(String(idA), 'c', 'A的迟到增量');
      var dropped = gotB.length === 0 && deltaB === 0 && AI_PENDING === jobB;
      /* B 自己的回包：正常交付 */
      window.onAiResult(String(idB), true, 'B的答案');
      var delivered = gotB.length === 1 && gotB[0] === 'B的答案' && AI_PENDING === null;
      /* 旧签名（没有 id）仍要能用，别把兼容路径打断 */
      aiRequest({ model: 'm', messages: [] }, function(ok, p){ gotB.push(p); });
      window.onAiResult(true, '无id答案');
      var legacyOk = gotB[gotB.length - 1] === '无id答案';
      return {
        ok: distinctIds && dropped && delivered && legacyOk,
        info: '两条任务id不同且已透传=' + distinctIds + '(' + idA + '/' + idB + ')'
          + ' · 迟到包与增量被丢=' + dropped + ' · 本任务正常交付=' + delivered
          + ' · 旧签名兼容=' + legacyOk
      };
    } finally {
      AI_PENDING = oldPend; AI_WAITING = oldWait; isApp = oldApp; NATIVE = oldN;
      S.apiKey = oldKey; S.baseUrl = oldUrl; S.provider = oldProv; S.stream = oldStream;
    }
  });

  // 渠道绑定的两种语义：跟随当前渠道 / 固定在某渠道。
  // 以前 roles[k].p 一律被填成「当时碰巧的当前渠道」，等于每个功能都被悄悄固定 ——
  // 切了渠道之后设置页显示新渠道、实际还在调旧渠道，两边各说各话。
  T('渠道绑定：跟随的跟着切，固定的钉住不动，老数据能正确归类', function(){
    var keep = JSON.stringify({p:S.provider, r:S.roles, m:S.models, pm:S.providerModels, acc:S.providerAcc});
    try{
      S.provider = 'deepseek';
      S.providerAcc = {deepseek:{url:'https://d.invalid/v1', key:'k-d'},
                       zhipu:{url:'https://z.invalid/v4', key:'k-z'}};
      S.providerModels = {deepseek:['d-fast','d-pro'], zhipu:['z-vision']};
      /* ① 跟随：模型名跟着渠道走 */
      S.roles = {plan:{p:'', m:'', fx:false}};
      S.models = {chat:'d-fast', plan:'d-fast', summarize:'d-fast', vision:'d-fast', tts:''};
      var followBefore = roleCreds('plan');
      setProvider('zhipu');
      var followAfter = roleCreds('plan');
      var follows = followBefore.provider === 'deepseek' && followAfter.provider === 'zhipu'
        && followAfter.url.indexOf('z.invalid') >= 0 && followAfter.key === 'k-z';

      /* ② 固定：切全局渠道不影响它 */
      S.provider = 'deepseek';
      S.roles = {vision:{p:'zhipu', m:'z-vision', fx:true}};
      var v1 = roleCreds('vision');
      setProvider('zhipu');
      var v2 = roleCreds('vision');
      var pinned = v1.provider === 'zhipu' && v2.provider === 'zhipu'
        && v2.model === 'z-vision' && roleFixed('vision');

      /* ③ 老数据归类：p 恰好等于当时渠道 → 判为跟随；p 是别家 → 判为固定 */
      S.provider = 'deepseek';
      S.roles = {summarize:{p:'deepseek', m:'d-pro'}, chat:{p:'zhipu', m:'z-vision'}};
      rolesCfg();
      var legacy = roleFixed('summarize') === false && roleFixed('chat') === true;

      /* ④ 标签要能把两种语义写出来，否则用户看不出手上的是哪一种 */
      S.roles = {chat:{p:'zhipu', m:'z-vision', fx:true}};
      S.models = {chat:'d-fast'};
      var lblFixed = modelLabel('chat');
      S.roles = {chat:{p:'', m:'', fx:false}};
      S.models = {chat:'d-fast'};
      var lblFollow = modelLabel('chat');
      var labelled = /固定/.test(lblFixed) && !/固定/.test(lblFollow);

      return {
        ok: follows && pinned && legacy && labelled,
        info: '跟随会切渠道=' + follows + ' · 固定钉住不动=' + pinned
          + ' · 老数据归类正确=' + legacy + ' · 标签区分两种=' + labelled
          + '（' + lblFollow + ' / ' + lblFixed + '）'
      };
    } finally {
      var o = JSON.parse(keep);
      S.provider = o.p; S.roles = o.r; S.models = o.m;
      S.providerModels = o.pm; S.providerAcc = o.acc;
      try{ save(); renderModels(); renderAiEntry(); }catch(e){}
    }
  });

  // 主题皮肤：整份皮肤的选择器都挂在 html.ui-pro 下，
  // 「选经典 = 这份 CSS 等于不存在」是前提，必须用真实 computed style 证明。
  // v5 起是「通透 / 磨砂」两档，另外钉两件真机踩过的事：
  //   ① 全屏 .view 不许挂 backdrop-filter（全屏模糊 + 内容滚动 = 狂闪）；
  //   ② 描边开关要真的能关掉上沿亮边与细描边。
  await TA('主题：Classic 无皮肤、通透/磨砂分得开、描边可关、全屏层不挂模糊', async function(){
    var card = document.querySelector('.card') || document.querySelector('.list');
    var tile = document.querySelector('.g-tile');
    var view = document.getElementById('view-notes');
    var seg = document.getElementById('glassSeg');
    if(!card || !tile || !view || !seg) return { ok:false, info:'缺 .card/.g-tile/#view-notes/#glassSeg' };
    var oldTheme = S.uiTheme, oldGlass = S.uiGlass, oldEdge = S.uiEdge;
    function bf(el){ var s = getComputedStyle(el); return s.backdropFilter || s.webkitBackdropFilter || 'none'; }
    function radius(){ return getComputedStyle(card).borderTopLeftRadius; }
    function blurPx(el){ var m = /blur\((\d+(?:\.\d+)?)px/.exec(bf(el)); return m ? parseFloat(m[1]) : 0; }
    function alpha(el){ var p = getComputedStyle(el).backgroundColor.split(','); return parseFloat(p[p.length-1].replace(')','')); }
    /* Chrome 把 computed box-shadow 序列化成「颜色 偏移 inset」，不是作者顺序的
       「inset 偏移 颜色」—— 按后者写的正则永远匹配不上。 */
    function hairline(el){ return /rgba\(255, 255, 255[^)]*\) 0px 1px 0px 0px inset/.test(getComputedStyle(el).boxShadow || ''); }
    /* 描边关掉时边框**宽度还在**（1px），只是颜色变透明 —— 量颜色不是量宽度。 */
    function edgeVisible(el){
      var c = getComputedStyle(el).borderTopColor;
      var m = /rgba\(\d+, \d+, \d+, ([\d.]+)\)/.exec(c);
      if(m) return parseFloat(m[1]) > 0.01;
      return c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)';
    }
    try{
      setUiPro(false);
      var offClass = !document.documentElement.classList.contains('ui-pro');
      var offRadius = radius();
      /* 玻璃档 / 描边必须在 Classic 下收起。
         ⚠️ bgLi（背景图）**不在此列**：它是全局外观，Classic 也支持
         （2026-10-23 用户明确要求经典档也能设图）。它有自己的一条断言。 */
      var rowsHidden = ['glassLi','edgeLi','glassH2','uiProNote'].every(function(id){
        var el = document.getElementById(id);
        return el && getComputedStyle(el).display === 'none';
      });

      setUiPro(true);
      var onClass = document.documentElement.classList.contains('ui-pro');
      var onRadius = radius();
      var skinned = offRadius !== onRadius;
      /* 「模糊没了」是上一轮的事故：内容面必须真的有模糊 */
      var contentFrosted = blurPx(card) > 0 && blurPx(tile) > 0;
      /* 全屏层不许挂模糊（闪烁源） */
      var viewFlat = bf(view) === 'none';

      setUiGlass('clear');
      var cb = blurPx(card), ca = alpha(card);
      setUiGlass('frost');
      var fb = blurPx(card), fa = alpha(card);
      var apart = fb > cb && fa > ca;

      /* ⚠️ 必须等过渡跑完再读：.g-tile 的 border-color 在皮肤里有 130ms 的过渡
         （transform / background / border-color 三条），切完描边立刻读拿到的还是旧值
         —— 这条断言以前是「靠运气绿」的，实测过 --glass-line 已经是 transparent、
         读到的 border 还是 rgba(23,26,38,.07)。上面同一句的 setUiGlass 之所以没事，
         是因为 .card 上没有 background 过渡（那条过渡只在 .g-tile/.course 上）。 */
      setUiEdge(true);
      await sleep(240);
      var edgeOn = hairline(tile) && edgeVisible(tile);
      setUiEdge(false);
      await sleep(240);
      var edgeOff = !hairline(tile) && !edgeVisible(tile);
      setUiEdge(true);

      var rowsShown = ['glassLi','edgeLi','bgLi'].every(function(id){
        var el = document.getElementById(id);
        return el && getComputedStyle(el).display !== 'none';
      });

      return {
        ok: offClass && onClass && skinned && rowsHidden && contentFrosted && viewFlat
          && apart && edgeOn && edgeOff && rowsShown,
        info: '经典=无类/' + offRadius + ' · Pro=有类/' + onRadius
          + ' · 经典下三行收起=' + rowsHidden + ' · Pro 下展开=' + rowsShown
          + ' · 内容面有模糊=' + contentFrosted + '（' + blurPx(card) + 'px）'
          + ' · 全屏层无模糊=' + viewFlat
          + ' · 通透→磨砂 模糊 ' + cb + '→' + fb + 'px、底色 α ' + ca + '→' + fa
          + ' · 描边开/关=' + edgeOn + '/' + edgeOff
      };
    } finally {
      S.uiTheme = oldTheme; S.uiGlass = oldGlass; S.uiEdge = oldEdge;
      applyLook(); renderUiTheme(); save();
    }
  });

  /* 真机第三轮的三条「玻璃没上」+ 一条「专注页不一样」。
     这三条都必须量 computed style，看 CSS 源码是看不出层叠结果的：
     ① 只把 background 换成半透明、不挂 backdrop-filter = 透明塑料，不是玻璃
        （用户：气泡 / 加号 / 全屏 / 输入框「透明而非模糊」）；
     ② 皮肤选择器比基础的 .qsw.on 多一层类 → 权重更高，把开启态的品牌色盖掉了
        （用户：深度思考/联网搜索「开启和关闭很难分得清」）。这类坑是结构性的，
        所以量「on 和 off 两种底色不相等」而不是量「on 等于某个色」；
     ③ 二级页铺一层灰纱、主页面铺光晕 → 专注页永远比别人闷。
        量两个元素的 background-image 计算值是否同一份。 */
  await TA('对话页与专注页：气泡/输入行是玻璃、开关分得清、专注页背景模糊', async function(){
    var keep = { t: S.uiTheme, g: S.uiGlass, e: S.uiEdge };
    var phone = document.querySelector('.phone');
    var fv = document.getElementById('view-focus');
    var notes = document.getElementById('view-notes');
    var msgs = document.getElementById('msgs');
    var sws = document.getElementById('chatSwitches');
    var inp = document.getElementById('chatInput');
    var cbtn = document.querySelector('.composer .icon-btn');
    if(!phone || !fv || !notes || !msgs || !sws || !inp || !cbtn)
      return { ok:false, info:'缺 .phone/#view-focus/#view-notes/#msgs/#chatSwitches/输入行' };
    function bf(el){ var s = getComputedStyle(el); return s.backdropFilter || s.webkitBackdropFilter || 'none'; }
    function blurPx(el){ var m = /blur\((\d+(?:\.\d+)?)px/.exec(bf(el)); return m ? parseFloat(m[1]) : 0; }
    function probe(box, cls, html){
      var d = document.createElement('div');
      d.className = cls; d.innerHTML = html || '';
      box.appendChild(d); return d;
    }
    try{
      setUiPro(true); setUiGlass('frost');
      /* ① 玻璃：气泡 / 输入框 / 三颗按钮 / 专注页两块面 */
      var ai = probe(msgs, 'msg ai', '<div class="bubble">x</div>').firstChild;
      var aiBlur = blurPx(ai);
      var inpBlur = blurPx(inp), btnBlur = blurPx(cbtn);
      var segs = probe(fv.querySelector('.viewbody') || fv, 'segs');
      var fs = probe(fv.querySelector('.viewbody') || fv, 'focusstats');
      var segsBlur = blurPx(segs), fsBlur = blurPx(fs);
      /* ② 战术开关：开 / 关两态底色必须不同，且开启态是不透明的品牌色 */
      var off = probe(sws, 'qsw'), on = probe(sws, 'qsw on');
      var cOff = getComputedStyle(off).backgroundColor;
      var cOn = getComputedStyle(on).backgroundColor;
      var swApart = cOff !== cOn;
      /* 开启态要「实」：算出来的底色不许带小数 alpha（半透明的品牌色压在照片上会发灰） */
      var swOnOpaque = !/, ?0?\.\d+\)$/.test(cOn);
      /* ③ 底色分工（2026-10-19 第三次修正，前两次都对错了方向）：
         **二级页和专注页都铺半透明纱 --view-veil**，模糊由 .scrim 兄弟层提供。
         专注页真正的坑不在 CSS 而在 JS：它走 openView('focus') 的专用分支，
         那里漏了 body.view-open → .scrim 不显示 → 纱下面透出的是**没糊过**的
         主页面，观感就是「半透明但没有模糊」。所以这条要同时钉三件事：
         ① 专注页铺纱；② 打开专注页后 body 带 view-open；③ .scrim 真的在模糊。
         只查底色的话，v0.3.28 的状态（铺了纱、没开 scrim）会假通过。 */
      var fvBg = getComputedStyle(fv);
      /* 纱 = 半透明底；专注页和普通二级页都该是纱 */
      function isVeil(c){ return /rgba\([^)]*,\s*0?\.\d+\)/.test(c); }
      var fvVeiled = isVeil(fvBg.backgroundColor) && fvBg.backgroundImage === 'none';
      var viewVeiled = isVeil(
        getComputedStyle(document.querySelector('.view:not(#view-focus)')).backgroundColor);
      /* 关键：打开专注页一遍，看 scrim 有没有真的亮起来（这才是「背景模糊」） */
      var focusScrimOk = false, focusScrimInfo = '(未测)';
      try{
        var beforeShow = document.getElementById('view-focus').classList.contains('show');
        openView('focus');
        await sleep(420);
        var sc = document.getElementById('scrim');
        var scC = getComputedStyle(sc);
        var scB = scC.backdropFilter || scC.webkitBackdropFilter || 'none';
        focusScrimOk = document.body.classList.contains('view-open')
          && parseFloat(scC.opacity) > .9 && /blur\(/.test(scB);
        focusScrimInfo = 'view-open=' + document.body.classList.contains('view-open')
          + ' opacity=' + scC.opacity + ' blur=' + (scB === 'none' ? 'none' : 'yes');
        if(!beforeShow){ closeView('focus'); await sleep(700); }
      }catch(e){ focusScrimInfo = 'err ' + e.message; }
      var vp = notes.querySelector('.vpanel');
      var panelFlat = !vp || (bf(vp) === 'none');
      var panelClear = !vp || getComputedStyle(vp).backgroundColor === 'rgba(0, 0, 0, 0)';
      /* ④ 切页进场：2026-10-17 起**两档都不再有 CSS animation**。
         原来是「Pro 收掉、经典保留 fade」—— 可是 fade 只说明"换了一张图"，没有方向感；
         现在统一由 MOTION 用弹簧位移驱动 go() 的进场。
         所以这条守卫改钉两件事：① CSS 层两档都是 none（玻璃面做动画会拖慢模糊）；
         ② MOTION 真的接线了 —— 否则"两边都没有动画"也会假通过。 */
      var animPro = getComputedStyle(document.getElementById('page-home')).animationName;
      setUiPro(false);
      var animClassic = getComputedStyle(document.getElementById('page-home')).animationName;
      setUiPro(true);
      var motionWired = !!(window.MOTION && typeof MOTION.enter === 'function'
        && typeof MOTION.leave === 'function')
        && /MOTION\.enter\(\s*el/.test(String(go));
      /* ⑤ 专注页进场不许再用「位移 + 缩放」，要和别的二级页同一语言 */
      var fvAnim = getComputedStyle(fv).animationName;
      var focusFades = fvAnim === 'none' || /Pro/.test(fvAnim);
      ai.parentNode.remove(); segs.remove(); fs.remove(); off.remove(); on.remove();
      return {
        ok: aiBlur > 0 && inpBlur > 0 && btnBlur > 0 && segsBlur > 0 && fsBlur > 0
          && swApart && swOnOpaque && fvVeiled && viewVeiled && focusScrimOk
          && panelFlat && panelClear
          && animPro === 'none' && animClassic === 'none' && motionWired && focusFades,
        info: '气泡 ' + aiBlur + 'px · 输入框 ' + inpBlur + 'px · 按钮 ' + btnBlur + 'px'
          + ' · 模式条/统计 ' + segsBlur + '/' + fsBlur + 'px'
          + ' · 开关底色 关=' + cOff + ' 开=' + cOn
          + ' · 专注页纱=' + fvVeiled + ' · 二级页纱=' + viewVeiled
          + ' · 专注页背景模糊=' + focusScrimInfo
          + ' · vpanel 无模糊/透明=' + panelFlat + '/' + panelClear
          + ' · 切页CSS动画 Pro=' + animPro + ' 经典=' + animClassic
          + ' · MOTION接线=' + motionWired
          + ' · 专注页进场=' + fvAnim
      };
    } finally {
      S.uiTheme = keep.t; S.uiGlass = keep.g; S.uiEdge = keep.e;
      applyLook(); renderUiTheme(); save();
    }
  });

  /* 真机 v0.3.0：自定义背景图后，「AI 行程规划 / 本周学习总结 / 今日课程空白页」
     和课表·笔记·待办·专注四大页的二级页面**没有模糊** —— 背景图直接从内容面底下透出来，
     和主页面「底纹上飘着几张糊卡片」完全是两种东西。
     根因是结构性的：这批面（.plan/.stat/.empty/.sched-day/.actlist/.n-card/.note-body）
     基础样式都是 background:var(--card)，皮肤把 --card 改成了半透明，
     但皮肤第 3 节只给 .card/.list/.g-tile/.course/.week .day 挂了 backdrop-filter，
     这批类只在第 3 节末尾补了 border-color/圆角 —— 于是「半透明 + 无模糊」= 透明塑料片。
     v5.1 又把手机端 .vpanel 的整块模糊撤掉了（为了和主页面同底），
     结果二级页里没有任何一层提供模糊。
     ⚠️ 修法只能加在**页内表面**上：全屏 .view 挂模糊是上一轮「狂闪」的成因（防闪第①条），
        内容面叠 background-image 高光是「磁贴变空白」的成因（防闪第②条）。
     ⚠️ .sched-day.today / .segs .s.on 这类「用 background 表达状态」的面，
        基础态必须走 :not()，否则皮肤权重压过去会把状态洗掉（结构错误①）。 */
  T('皮肤：行程规划/总结/空状态/课表日/笔记卡这些内容面也是玻璃', function(){
    var keep = { t: S.uiTheme, g: S.uiGlass };
    function bf(el){ var s = getComputedStyle(el); return s.backdropFilter || s.webkitBackdropFilter || 'none'; }
    function bgOf(el){ return getComputedStyle(el).backgroundColor; }
    function probe(box, cls){
      var d = document.createElement('div');
      d.className = cls; box.appendChild(d);
      return d;
    }
    var home = document.getElementById('page-home');
    var fv = document.getElementById('view-focus');
    var sch = document.getElementById('view-schedule');
    var notes = document.getElementById('view-notes');
    try{
      setUiPro(true); setUiGlass('clear');
      /* 参照物：主页面上「已经是对的」两档玻璃 */
      var eBig = probe(home, 'card');    var bigRef = bf(eBig);
      var eSmall = probe(home, 'course'); var smallRef = bf(eSmall);
      var faces = [
        {cls:'plan',      box:home,  ref:bigRef},
        {cls:'empty',     box:home,  ref:bigRef},
        {cls:'actlist',   box:fv,    ref:bigRef},
        {cls:'note-body', box:notes, ref:bigRef},
        {cls:'stat',      box:home,  ref:smallRef},
        {cls:'sched-day', box:sch,   ref:smallRef},
        {cls:'n-card',    box:notes, ref:smallRef}
      ];
      var made = faces.map(function(f){
        var el = probe(f.box, f.cls);
        /* 半透底色（玻璃的前提）：rgba 且 alpha < 1 */
        var bg = bgOf(el);
        var glassy = /rgba\([^)]*, ?0?\.\d+\)$/.test(bg);
        return { el: el, cls: f.cls, blur: bf(el), glassy: glassy,
          rightTier: bf(el) === f.ref && bf(el) !== 'none' };
      });
      var bad = made.filter(function(x){ return !x.rightTier || !x.glassy; });
      /* 今天那条日不许被洗成普通日（.today 用 background 表达状态） */
      var d1 = probe(sch, 'sched-day'), d2 = probe(sch, 'sched-day today');
      var todayKept = bgOf(d1) !== bgOf(d2);
      /* 成本闸数据：只算「真的在屏上占地方」的元素，且要在探针拆掉之后量。
         当年磁贴画不出内容就是同屏数量失控，所以这个数字必须一直看得见。 */
      made.forEach(function(x){ x.el.remove(); });
      d1.remove(); d2.remove(); eBig.remove(); eSmall.remove();
      var inView = [].slice.call(document.querySelectorAll('html.ui-pro *'))
        .filter(function(e){
          if(bf(e) === 'none') return false;
          var r = e.getBoundingClientRect();
          if(!r.width || !r.height) return false;
          if(r.bottom < 0 || r.top > window.innerHeight) return false;
          return e.offsetParent !== null || getComputedStyle(e).position === 'fixed';
        }).length;
      return { ok: !bad.length && todayKept,
        info: '大半径档=' + bigRef.replace(/^(blur\([^)]+\)\s*)?/, '') + ' 小半径档=' + smallRef
          + ' | 不达标=' + (bad.length ? bad.map(function(x){ return x.cls + '(' + x.blur + ')'; }).join(',') : '无')
          + ' | 单张面同档=' + made.filter(function(x){ return x.cls === 'plan'; })[0].rightTier
          + ' · 今天态未被洗=' + todayKept + ' · 视口内模糊元素=' + inView,
        detail: made.map(function(x){ return x.cls + '=' + x.blur + '/' + (x.glassy ? '半透' : '实色'); }).join(' ')
      };
    } finally {
      S.uiTheme = keep.t; S.uiGlass = keep.g; applyLook(); renderUiTheme(); save();
    }
  });

  /* ===== 皮肤巡检：不再靠点名 =====
     用户从 v0.2.x 起连着四轮报「这一页没模糊」：气泡/输入行（v5.1）、
     专注页两块面（v5.1）、行程规划/总结/空状态/课表/笔记（v5.2）。
     每一轮都是「补被点到的那几个类」，下一屏又冒出新的 —— 因为规则其实是结构性的：
     **皮肤把 --card 改成了半透明，凡是只吃令牌、没挂 backdrop-filter 的面就都是透明塑料片。**
     所以这条不按类名断言，而是把每个页面扫一遍：
     视口内、真的占地方（≥40×40）、底色是半透明（0.02<α<0.9）、却没挂模糊 —— 就是违规。
     例外只有整屏压色层（.scrim）：给它挂模糊正是防闪第①条禁的东西。 */
  T('皮肤巡检：UI Pro 下不存在「半透明却没挂模糊」的内容面', function(){
    var keep = { t: S.uiTheme, g: S.uiGlass };
    var ALLOW = ['scrim', 'view', 'view-focus'];
    /* view / view-focus 白名单（2026-10-18）：手机端二级页的底改成半透明纱
       --view-veil，它的模糊**有意**不挂在自己身上，而是由下面那层 .scrim
       兄弟提供 —— ① .view 挂全屏 backdrop-filter 会闪（防闪第①条）；
       ② 四大功能的 clip-path 展开动画会把 .view 提升成合成层，挂了也会瞎。
       #view-focus 用的是 ID，巡检按 className 分组抓不到它，所以要连 id 一起放行。 */
    function bf(el){ var s = getComputedStyle(el); return s.backdropFilter || s.webkitBackdropFilter || 'none'; }
    function scan(where){
      var bad = [];
      [].slice.call(document.querySelectorAll('*')).forEach(function(e){
        if(bf(e) !== 'none') return;
        var c = getComputedStyle(e);
        if(c.opacity === '0' || c.visibility === 'hidden' || c.display === 'none') return;
        var m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(c.backgroundColor);
        if(!m) return;
        var al = parseFloat(m[4]);
        if(al >= 0.9 || al <= 0.02) return;   /* α≥0.9 已经是实心面，糊不糊看不出来 */
        var r = e.getBoundingClientRect();
        if(r.width < 40 || r.height < 40) return;
        if(r.bottom < 0 || r.top > window.innerHeight) return;
        if(e.offsetParent === null && c.position !== 'fixed') return;
        var cls = (typeof e.className === 'string' ? e.className : e.tagName) || '(no class)';
        var top = cls.split(/\s+/)[0];
        if(ALLOW.indexOf(top) >= 0 || ALLOW.indexOf(cls) >= 0 || ALLOW.indexOf(e.id) >= 0) return;
        bad.push({ cls: top, where: where, alpha: al });
      });
      return bad;
    }
    /* 同一类只报一次（跨页面），附上第一次出现在哪一屏 */
    function dedupe(list){
      var seen = {};
      return list.filter(function(x){ if(seen[x.cls]) return false; seen[x.cls] = 1; return true; })
        .map(function(x){ return x.cls + '@' + x.where + ' α=' + x.alpha; });
    }
    function hideViews(){
      [].slice.call(document.querySelectorAll('.view.show'))
        .forEach(function(v){ v.classList.remove('show'); });
      try{ closeHistDrawer && closeHistDrawer(); }catch(e){}
    }
    try{
      setUiPro(true); setUiGlass('clear');
      var out = [];
      ['home', 'chat', 'me'].forEach(function(p){ hideViews(); go(p); out = out.concat(scan(p)); });
      ['schedule', 'notes', 'todos', 'focus', 'theme', 'about', 'aihub', 'ai', 'skills']
        .forEach(function(v){ hideViews(); go('home'); openView(v); out = out.concat(scan(v)); });
      hideViews(); go('chat');
      try{ openHistDrawer(); }catch(e){}
      out = out.concat(scan('hist'));
      hideViews();
      go('home');
      var uniq = dedupe(out);
      return { ok: !uniq.length,
        info: uniq.length ? '半透无糊 ' + uniq.length + ' 类：' + uniq.slice(0, 14).join(' | ')
          : '无（已扫 3 个主页面 + 9 个二级页 + 历史侧栏）' };
    } finally {
      S.uiTheme = keep.t; S.uiGlass = keep.g; applyLook(); renderUiTheme(); save();
    }
  });

  /* ===== 分隔线两件事（真机 v0.3.1 用户报）=====
     ① 关掉「高光描边」把列表分隔线一起弄没了 ——
        描边开关写的是 --glass-line:transparent，而这个令牌同时被 .li 的 border-bottom 在用。
        「卡片那一圈描边」和「行与行之间的分隔线」是两种东西，必须两个令牌。
     ② 「AI 对我的称呼」输入框与「AI 的头像」之间、「学期起始日」与「节假日模式」之间没有线 ——
        成因是一个写法：标题行下面跟一条放输入框的「续行」，续行上写 style="border:0"，
        于是把这一项**收尾**的那条线也删了（全应用 5 处这个写法，用户报的是其中 2 处）。
     ⚠️ 所以这条不按类名/位置点名，整屏扫：
        凡是 .list 里的 .li，只要下面还跟一条 .li、且没标 .jn（与下一条同属一项），
        就必须有一条看得见的下边框。 */
  T('皮肤巡检：列表行的收尾分隔线都在，描边关掉也不许把分隔线带走', function(){
    var keep = { t: S.uiTheme, e: S.uiEdge, g: S.uiGlass };
    function lineOf(el){
      var c = getComputedStyle(el);
      var w = parseFloat(c.borderBottomWidth) || 0;
      var m = /rgba?\(([^)]*)\)/.exec(c.borderBottomColor);
      var al = 1;
      if(m){ var p = m[1].split(','); if(p.length > 3) al = parseFloat(p[3]); }
      return { w: w, al: al, vis: w >= 1 && al > 0.02 };
    }
    function scan(where, seen){
      var bad = [];
      [].slice.call(document.querySelectorAll('.list .li')).forEach(function(e){
        if(seen.indexOf(e) >= 0) return;
        seen.push(e);
        if(e.classList.contains('nob')) return;                /* 声明过「本行不画线」 */
        var nx = e.nextElementSibling;
        while(nx && !nx.classList.contains('li')) nx = nx.nextElementSibling;
        if(!nx) return;                                        /* 本组最后一条：不需要收尾线 */
        if(!lineOf(e).vis) bad.push(where + ' «' + (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 12)
          + '» w=' + lineOf(e).w + ' α=' + lineOf(e).al);
      });
      return bad;
    }
    function hideViews(){
      [].slice.call(document.querySelectorAll('.view.show'))
        .forEach(function(v){ v.classList.remove('show'); });
    }
    /* 用户点名的两处：这两条「续行」下面紧跟着另一条 .li，必须有线 */
    function rowByTitle(txt){
      return [].slice.call(document.querySelectorAll('.list .li')).filter(function(e){
        return (e.textContent || '').indexOf(txt) >= 0;
      })[0];
    }
    function lineBefore(txt){
      /* 标题行的**下一条**（放输入框的那条续行）要有收尾线 ——
         量错元素会一路走到本组最后一条，那条本来就该有线，等于没测。 */
      var t = rowByTitle(txt);
      if(!t) return { found: false, vis: false };
      var nx = t.nextElementSibling;
      while(nx && (!nx.classList || !nx.classList.contains('li'))) nx = nx.nextElementSibling;
      if(!nx) return { found: false, vis: false };
      return { found: true, vis: lineOf(nx).vis };
    }
    try{
      var out = [], seen = [];
      /* 经典档先扫一遍：这一条不该只在皮肤下成立 */
      setUiPro(false);
      /* 我的页的列表已经拆进四个类页（2026-10-19），这里跟着扫二级页。
         用 show 让它有布局（.view 不 show 时整块不可见，量出来全是 0）。 */
      ['home', 'chat'].forEach(function(p){ hideViews(); go(p); out = out.concat(scan('classic:' + p, seen)); });
      ['xj', 'me', 'study', 'data'].forEach(function(v){
        hideViews(); go('home'); openView(v); out = out.concat(scan('classic:' + v, seen));
      });
      ['schedule', 'notes', 'todos', 'focus', 'theme', 'about', 'aihub', 'ai', 'skills']
        .forEach(function(v){ hideViews(); go('home'); openView(v); out = out.concat(scan('classic:' + v, seen)); });
      /* Pro + 描边关：分隔线必须还在，高光必须没了 */
      setUiPro(true); setUiEdge(false);
      hideViews(); go('home'); openView('xj');
      out = out.concat(scan('pro-edgeoff:xj', seen));
      /* 取一条「描边开着时有线」的正常行做对照，别拿故意没线的行去量 */
      setUiEdge(true);
      var rows = [].slice.call(document.querySelectorAll('#view-xj .list .li')).filter(function(e){
        var n = e.nextElementSibling; while(n && !n.classList.contains('li')) n = n.nextElementSibling;
        return !!n && lineOf(e).vis;
      });
      var probe = rows[0];
      var dividerOn = !!probe && lineOf(probe).vis;
      setUiEdge(false);
      var dividerAlive = !!probe && lineOf(probe).vis;
      /* 描边关掉时卡片上沿那道高光要没（这是这个开关唯一该管的事）。
         Chrome 把 box-shadow 序列化成「颜色 偏移 模糊 扩散 inset」，顺序和源码不一样，
         所以不解析单个色值，直接比两态的整串是否变了。 */
      var shadowOff = probe ? (getComputedStyle(probe.closest('.list') || probe).boxShadow || '') : '';
      setUiEdge(true);
      var shadowOn = probe ? (getComputedStyle(probe.closest('.list') || probe).boxShadow || '') : '';
      var hairChanged = !!shadowOff && shadowOff !== shadowOn && /inset/.test(shadowOn);
      /* 用户点名的两处 */
      hideViews(); go('home'); openView('ai');
      var callLine = lineBefore('AI 对我的称呼');
      hideViews(); go('home'); openView('study');
      var termLine = lineBefore('学期起始日');
      hideViews(); go('home');
      return { ok: !out.length && dividerAlive && dividerOn && hairChanged
          && callLine.found && callLine.vis && termLine.found && termLine.vis,
        info: '缺收尾线 ' + out.length + ' 处'
          + (out.length ? '：' + out.slice(0, 12).join(' | ') : '')
          + ' · 描边 开/关 分隔线=' + dividerOn + '/' + dividerAlive + ' 高光变了样=' + hairChanged
          + ' · 「AI 对我的称呼」→「AI 的头像」有线=' + callLine.vis
          + ' · 「学期起始日」→「节假日模式」有线=' + termLine.vis };
    } finally {
      S.uiTheme = keep.t; S.uiEdge = keep.e; S.uiGlass = keep.g;
      applyLook(); renderUiTheme(); save();
    }
  });

  /* 「我切不回经典主题了」：上一版点的是 setUiPro(!S.uiPro)，
     而 S.uiPro 这个键早已被 migrateUiTheme() 删掉 —— !undefined 恒为 true，
     于是永远只在「开」这一侧打转。这条走**真实点击**做 classic→pro→classic 往返，
     并要求类、选中格、滑块三者都跟着走，防止再把控件和状态解耦。
     ⚠️ 必须是异步断言：.segThumb 的 transform 带 .28s 过渡，
     同步读 getComputedStyle 拿到的还是**过渡起点**（踩过：量出来两态都是 335px，
     看着像「滑块不动」，其实是我读太早）。等过渡落定再量几何。
     ⚠️ 两档控件没有「中间格」，所以不能像明暗那样量 left===right，
     改成量「选左格贴左 3px、选右格贴右 3px」，上下两个方向仍要相等。 */
  await TA('主题滑块：点 UI Classic / UI Pro 双向可切，类·选中格·滑块都跟着走', async function(){
    var keep = S.uiTheme;
    var seg = document.getElementById('uiThemeSeg');
    var th = document.getElementById('uiThemeThumb');
    var pro = seg && seg.querySelector('.segI[data-v="pro"]');
    var cls = seg && seg.querySelector('.segI[data-v="classic"]');
    if(!seg || !th || !pro || !cls) return { ok:false, info:'缺 #uiThemeSeg / #uiThemeThumb 或两格选项' };
    function gaps(){
      var a = seg.getBoundingClientRect(), b = th.getBoundingClientRect();
      return { top: Math.round(b.top - a.top), bottom: Math.round(a.bottom - b.bottom),
        left: Math.round(b.left - a.left), right: Math.round(a.right - b.right) };
    }
    /* 等滑块真正停稳再量。
       原来固定 sleep(420)，但 segThumb 的过渡是 280ms、且**从主线程空闲才开始**：
       前面用例若留下动画，过渡会推迟启动，420ms 就量到中间位置 ——
       这条用例因此间歇失败（重跑就好）。轮询到连续两帧位置相同才算稳。 */
    async function settled(){
      /* 先让过渡真正启动。
         原来上来就轮询：点击后同一帧里 style 已经改了，但 transition 还没开始跑，
         连续两次读到的都是**起点**，于是被判定"已稳定"直接返回 ——
         量到的就是"经典态滑块还在右边"（左 338 而不是 3）。
         先等两个动画帧，再开始比较。 */
      await sleep(90);
      var as = (th.getAnimations && th.getAnimations()) || [];
      if(as.length){
        await Promise.race([
          Promise.all(as.map(function(a){ return a.finished.catch(function(){}); })),
          sleep(900)
        ]);
      }
      var last = null, t0 = Date.now();
      while(Date.now() - t0 < 1200){
        var r = th.getBoundingClientRect();
        var sig = Math.round(r.left) + '|' + Math.round(r.top) + '|' + Math.round(r.width);
        if(sig === last) return true;
        last = sig;
        await sleep(45);
      }
      return false;
    }
    try{
      S.uiTheme = 'classic'; applyLook(); renderUiTheme();
      await settled();
      cls.click();                       /* 已经在经典：应无副作用 */
      var noOp = S.uiTheme === 'classic';
      pro.click();
      var toPro = S.uiTheme === 'pro' && document.documentElement.classList.contains('ui-pro');
      await settled();
      var gp = gaps();
      var proOn = !!seg.querySelector('.segI[data-v="pro"].on');
      cls.click();
      var backClassic = S.uiTheme === 'classic'
        && !document.documentElement.classList.contains('ui-pro');
      await settled();
      var gc = gaps();
      var clsOn = !!seg.querySelector('.segI[data-v="classic"].on');
      var moved = gp.left !== gc.left;
      /* 上下相等 + 各自贴边 3px（轨道 padding 就是 3px） */
      var geom = gp.top === gp.bottom && gc.top === gc.bottom
        && gp.top >= 2 && gp.top <= 4
        && Math.abs(gc.left - 3) <= 1 && Math.abs(gp.right - 3) <= 1;
      /* beta 角标：要在（皮肤关掉的）经典态也看得见，且不许把轨道撑高、
         也不许把档位文字挤成两行 —— .segI 是 nowrap + flex 居中，
         上标一旦参与行高，38px 的轨道就装不下，滑块几何跟着歪。 */
      var beta = pro.querySelector('.beta');
      var betaTxt = !!beta && beta.textContent.trim().toLowerCase() === 'beta';
      var trackH = Math.round(seg.getBoundingClientRect().height);
      var betaShown = !!beta && getComputedStyle(beta).display !== 'none'
        && parseFloat(getComputedStyle(beta).fontSize) < 12;
      var noWrap = pro.scrollWidth <= pro.clientWidth + 1;
      S.uiTheme = 'classic'; applyLook();
      var shownInClassic = !!beta && beta.getBoundingClientRect().width > 1;
      return {
        ok: noOp && toPro && backClassic && proOn && clsOn && moved && geom
          && betaTxt && betaShown && noWrap && shownInClassic && trackH === 38,
        info: '重复点同档=' + noOp + ' · 切到 Pro=' + toPro + ' · 切回经典=' + backClassic
          + ' · 选中格 ' + clsOn + '/' + proOn
          + ' · 经典态 左' + gc.left + '/上' + gc.top + '·Pro 态 右' + gp.right + '/上' + gp.top
          + ' · 滑块位移=' + moved
          + ' · beta=' + betaTxt + '/' + betaShown + '/经典可见=' + shownInClassic
          + ' · 轨道高=' + trackH + ' · 不换行=' + noWrap
      };
    } finally {
      S.uiTheme = keep; applyLook(); renderUiTheme(); save();
    }
  });

  /* ================= 本地文件解析器 =================
     样本是 Node 侧真造出来的 ZIP+XML（tools/filefix.mjs），页面拿到的是字节，
     不是「我以为解析器能吃的字符串」。 */
  function b64u(s){ var b = atob(s), u = new Uint8Array(b.length); for(var i=0;i<b.length;i++) u[i] = b.charCodeAt(i); return u; }
  function FIX(){ return window.__FIX__ || {}; }

  await TA('解析 docx：段落按顺序、表格拼成一行、实体还原', async function(){
    var r = await parseOfficeFile('数据结构.docx', b64u(FIX().docx));
    if(!r.ok) return { ok:false, info:'解析失败：' + r.err };
    var t = r.text;
    var order = t.indexOf('数据结构第 3 章') >= 0 && t.indexOf('数据结构第 3 章') < t.indexOf('课后习题');
    var merged = t.indexOf('线性表与链表的比较') >= 0;   /* 同段多个 run 要拼成一句 */
    var table = t.indexOf('查找方式 | 复杂度') >= 0 && t.indexOf('折半查找 | O(log n)') >= 0;
    var ent = t.indexOf('<标记> 与 & 符号') >= 0;
    var keep = t.indexOf('  课后习题 12、13、14') >= 0;   /* xml:space=preserve 的空格 */
    var drawing = t.indexOf('图 3-2 折半查找判定树') >= 0;
    return { ok: merged && order && table && ent && keep && drawing && r.fmt === 'docx',
      info: 'fmt=' + r.fmt + ' · 段数=' + r.parts.length + ' · 合并 run=' + merged
        + ' · 表格行=' + table + ' · 实体=' + ent + ' · 保留空格=' + keep + ' · 顺序=' + order };
  });

  await TA('解析 docx：stored（未压缩）条目也要能读', async function(){
    var r = await parseOfficeFile('a.docx', b64u(FIX().docxStored));
    return { ok: r.ok && r.text.indexOf('折半查找') >= 0,
      info: 'ok=' + r.ok + ' · ' + (r.ok ? (r.text.length + ' 字') : r.err) };
  });

  await TA('解析 xlsx：共享字符串查表、内联字符串、表名进标签、空行跳过', async function(){
    var r = await parseOfficeFile('成绩.xlsx', b64u(FIX().xlsx));
    if(!r.ok) return { ok:false, info:'解析失败：' + r.err };
    var t = r.text;
    var shared = t.indexOf('姓名 | 学号') >= 0 && t.indexOf('张三 | 20250101') >= 0;
    var inline = t.indexOf('富文本 | 内联') >= 0;
    var sheets = t.indexOf('平时成绩') >= 0 && t.indexOf('考勤') >= 0;
    var emptyRowSkipped = t.indexOf('| 20250102 |') < 0 && t.indexOf('李四 | 20250102') >= 0;
    return { ok: shared && inline && sheets && emptyRowSkipped,
      info: '共享表=' + shared + ' · 内联/富文本=' + inline + ' · 两张表名=' + sheets
        + ' · 空单元格不留尾巴=' + emptyRowSkipped };
  });

  await TA('解析 pptx：逐页成段并标页码', async function(){
    var r = await parseOfficeFile('复习.pptx', b64u(FIX().pptx));
    if(!r.ok) return { ok:false, info:'解析失败：' + r.err };
    var t = r.text;
    var p1 = t.indexOf('第 1 页') >= 0 && t.indexOf('操作系统概述') >= 0;
    var p2 = t.indexOf('死锁的四个必要条件') >= 0;
    var runs = t.indexOf('进程与线程的区别') >= 0;
    var labeled = r.parts.every(function(x){ return /^第 \d+ 页/.test(x.label); });
    return { ok: p1 && p2 && runs && labeled,
      info: '页码标签=' + p1 + ' · 两页都在=' + p2 + ' · 同段拼 run=' + runs + ' · 每段带页=' + labeled };
  });

  await TA('解析失败要如实报错，不许静默交出空文本', async function(){
    var empty = await parseOfficeFile('a.docx', b64u(FIX().emptyZip));
    var img = await parseOfficeFile('scan.docx', b64u(FIX().imgOnlyDocx));
    var junk = await parseOfficeFile('a.docx', new Uint8Array([1,2,3,4,5,6,7,8]));
    var ok = (!empty.ok) && (!img.ok) && (!junk.ok)
      && !!empty.err && !!img.err && !!junk.ok === false
      && /图片|没有/.test(img.err) && /损坏|压缩包/.test(junk.err);
    return { ok: ok, info: '空包="' + empty.err + '" · 纯图片="' + img.err
      + '" · 垃圾字节="' + junk.err + '"' };
  });

  T('编码嗅探：GBK 不再乱码、BOM 与 UTF-16 都能读', function(){
    var gbk = decodeTextSmart(new Uint8Array(FIX().gbkBytes));
    var bom = decodeTextSmart(new Uint8Array(FIX().utf8Bom));
    var u16 = decodeTextSmart(new TextEncoder().encode('进程调度'));
    var plain = decodeTextSmart(new TextEncoder().encode('普通 UTF-8 文本'));
    return { ok: gbk === '中文' && bom === '带 BOM 的文本' && u16 === '进程调度' && plain === '普通 UTF-8 文本',
      info: 'GBK→"' + gbk + '" · BOM→"' + bom + '" · UTF-16→"' + u16 + '" · UTF-8→"' + plain + '"' };
  });

  await TA('长文件按提问选段：命中段 + 第 1 段一定带上，并说明没带全文', async function(){
    var r = await parseOfficeFile('长文档.docx', b64u(FIX().longDocx));
    if(!r.ok) return { ok:false, info:'解析失败：' + r.err };
    var all = r.parts.length;
    var pk = pickParts(r.parts, '牛顿冷却定律是什么', 3000);
    var body = pk.parts.map(function(p){ return p.text; }).join('\n');
    var hasHit = body.indexOf('牛顿冷却定律') >= 0;
    var hasFirst = body.indexOf('第 1 节') >= 0;
    var trimmed = pk.parts.length < all;
    var asc = pk.parts.every(function(p, i){ return i === 0 || p.text < pk.parts[i].text; })
      || pk.parts.map(function(p){ return p.text.slice(2, 6); }).join(',') === pk.parts.map(function(p){ return p.text.slice(2, 6); }).sort().join(',');
    /* 没提问时不许「乱挑」：按原顺序给开头，并标 matched=false */
    var pk2 = pickParts(r.parts, '', 3000);
    var head = pk2.matched === false && pk2.parts[0].text.indexOf('第 1 节') >= 0;
    return { ok: all > 3 && hasHit && hasFirst && trimmed && head,
      info: '总段=' + all + ' · 选中=' + pk.parts.length + ' · 含命中段=' + hasHit
        + ' · 含第1段=' + hasFirst + ' · 无提问走开头=' + head };
  });

  await TA('走真实入口：选一个 docx → 胶囊出现段数、发出去的消息带选段说明', async function(){
    var keepTheme = S.uiTheme, keepAttach = ATTACH.slice();
    try{
      clearAttach();
      var f = new File([b64u(FIX().docx)], '数据结构第3章.docx',
        { type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      onChatFile(f);
      var waited = 0;
      while(waited < 4000 && !(ATTACH.length && !ATTACH[0].busy)){ await sleep(120); waited += 120; }
      var a = ATTACH[0];
      if(!a || a.busy) return { ok:false, info:'附件没解析完（等了 ' + waited + 'ms）' };
      var chip = (document.querySelector('.attach .an small') || {}).textContent || '';
      var payload = attachPayload('折半查找的复杂度是多少');
      var ok = a.kind === 'text' && a.fmt === 'docx' && (a.parts || []).length >= 1
        && /DOCX/.test(chip) && payload.text.indexOf('折半查找') >= 0
        && payload.text.indexOf('数据结构第 3 章') >= 0;
      return { ok: ok, info: '胶囊="' + chip + '" · 段=' + (a.parts||[]).length
        + ' · 载荷含表格行=' + (payload.text.indexOf('折半查找 | O(log n)') >= 0)
        + ' · 载荷长=' + payload.text.length };
    } finally {
      ATTACH = keepAttach; attachRow(); S.uiTheme = keepTheme; applyLook();
    }
  });

  T('老格式 .doc 明确告知另存为，不假装在读', function(){
    var keep = ATTACH.slice();
    try{
      clearAttach();
      onChatFile(new File([1,2,3,4], '旧教案.doc'));
      var txt = (document.getElementById('sheet') || {}).textContent || '';
      var ok = ATTACH.length === 0 && /另存为/.test(txt) && /docx/.test(txt);
      closeSheet();
      return { ok: ok, info: '附件数=' + ATTACH.length + ' · 提示含「另存为」=' + /另存为/.test(txt) };
    } finally { ATTACH = keep; attachRow(); closeSheet(); }
  });

  T('架构：解析器所需的函数都在', function(){
    var fns = ['zipIndex','zipEntryBytes','zipText','decodeTextSmart','docxUnits','xlsxUnits',
      'xlsxSheetNames','pptxUnits','packUnits','parseOfficeFile','queryTerms','pickParts',
      'readFileSmart','pickOfficeAttach','attachFmtLabel'];
    var missing = fns.filter(function(n){ return typeof window[n] !== 'function'; });
    return { ok: !missing.length, info: '缺函数=' + (missing.join(',') || '0') };
  });

  /* ============================================================
     资料库（RAG）
     ------------------------------------------------------------
     正文在 App 私有目录（原生 DocStore），浏览器自测里走 localStorage 回退。
     所以这组断言既测**编码/检索这些纯函数**，也测**入库到检索的真实链路**，
     最后单独去 Java 源码对账桥与回调名 —— 名字对不上就是静默失败
     （本项目 onHttpGet / __onHttpGet 踩过一次）。
     ============================================================ */

  T('资料库：分段编码往返不丢字、分隔符不进正文', function(){
    var parts = [
      {label:'第 1 段（第 1/3 段）', text:'线性代数的核心是矩阵与向量空间。'},
      /* 故意塞控制字符与换行到标签里：真机上表格行的 label 是「表1（第 2/3 段）」，
         而正文里常有 \n。编码后正文必须原样回来。 */
      {label:'表1\n（第 2/3 段）', text:'姓名 | 成绩\n张三 | 92'},
      {label:'第 3 段', text:'行\u001e列\u001d里也有\u0007怪字符'}
    ];
    var enc = docEncodeBody(parts);
    var back = docDecodeBody(enc);
    var okCount = back.length === 3;
    var same0 = back[0] && back[0].text === parts[0].text;
    var same1 = back[1] && back[1].text === parts[1].text
      && back[1].label.indexOf('\n') < 0;   // 标签里的换行被压成空格
    /* 正文里的 BEL(\u0007) 是控制字符，必须被清掉；而 RS(\u001e) 本身就是
       分段符 —— docCleanText 的排除区间故意跳过了它（\u001e 不在被清范围里），
       所以正文自己带的 RS 会留下来。这里断言的是**清掉了该清的**，
       同时段没被正文里的 RS 切开（noBleed 那条）。 */
    var cleaned = back[2] && back[2].text.indexOf('\u0007') < 0
      && back[2].text.indexOf('\u001d') < 0;
    var noBleed = enc.split(DOC_SEP).length === 3;   // 正文里的 RS 没把段切开
    return { ok: okCount && same0 && same1 && cleaned && noBleed,
      info: '段数=' + back.length + ' · 首段一致=' + same0 + ' · 表格段一致=' + same1
        + ' · 控制字符已清=' + cleaned + ' · 段没被正文切开=' + noBleed };
  });

  /* 检索：只认问题里真出现的词，且必须按原段落顺序还回去。
     这里直接喂 DOC_BODY，绕开存储 —— 测的是打分与挑选，不是 IO。 */
  T('资料库检索：只带命中的段、按原顺序、不编造来源', function(){
    var keepDocs = S.docs, keepBody = DOC_BODY, keepCtx = S.docCtx;
    try{
      S.docs = [
        {id:'dt1', name:'数据结构讲义.docx', fmt:'docx', chars:60, parts:3, at:1000, on:true},
        {id:'dt2', name:'操作系统复习.txt', fmt:'txt', chars:40, parts:2, at:2000, on:true},
        {id:'dt3', name:'关掉的资料.txt', fmt:'txt', chars:20, parts:1, at:3000, on:false}
      ];
      DOC_BODY = {
        dt1:[
          {label:'第1段', text:'第一章 绪论，讲算法复杂度与渐进记号。'},
          {label:'第2段', text:'折半查找要求序列有序，时间复杂度是 O(log n)。'},
          {label:'第3段', text:'希尔排序的增量序列会影响实际性能。'}
        ],
        dt2:[
          {label:'第1段', text:'进程调度算法包括先来先服务与时间片轮转。'},
          {label:'第2段', text:'折半查找在操作系统目录里也能用，但这不是重点。'}
        ],
        dt3:[{label:'第1段', text:'折半查找 折半查找 折半查找 折半查找'}]
      };
      S.docCtx = {on:true, budget:2400, top:4};
      var r = docsRetrieve('折半查找的时间复杂度');
      if(!r) return {ok:false, info:'该命中的时候返回了 null'};
      var hitBoth = r.text.indexOf('O(log n)') >= 0 && r.text.indexOf('目录里也能用') >= 0;
      /* ⚠️ 这条是**阈值**的守卫，不是措辞检查：
         「进程调度算法包括先来先服务与时间片轮转」里的「时间」会被 2-gram 命中，
         第一版按「命中词数」计分时它排进了结果里（真机效果 = 答非所问）。 */
      var noFalsePositive = r.text.indexOf('时间片轮转') < 0;
      /* 关掉的那份里「折半查找」出现 4 次，分数最高 —— 不许因为它分高就带进来 */
      var offExcluded = r.text.indexOf('关掉的资料') < 0;
      /* 同一份文档内必须按原段落顺序排回去。⚠️ 不能拿「未命中段的文字」做参照 ——
         它被正确排除了，indexOf 是 -1，比较恒为假（第一版就这么写错的）。 */
      var asc = true, last = -1, curDoc = '';
      var re = /〔《([^》]+)》第(\d+)段〕/g, mm;
      while((mm = re.exec(r.text))){
        var num = parseInt(mm[2], 10);
        if(mm[1] !== curDoc){ curDoc = mm[1]; last = -1; }
        if(num <= last){ asc = false; break; }
        last = num;
      }
      var keysOff = (function(){
        var c = docCtxCfg(); c.on = false;
        var x = docsRetrieve('折半查找');
        c.on = true;
        return x === null;
      })();
      var noTerms = docsRetrieve('') === null;
      return { ok: hitBoth && noFalsePositive && offExcluded && asc && keysOff && noTerms,
        info: '两份都命中=' + hitBoth + ' · 假阳性（时间片轮转）被挡住=' + noFalsePositive
          + ' · 关掉的资料被排除=' + offExcluded + ' · 段内顺序正确=' + asc
          + ' · 总开关关掉返回 null=' + keysOff + ' · 空问题不检索=' + noTerms
          + ' · 入选 ' + r.count + ' 段' };
    } finally {
      S.docs = keepDocs; DOC_BODY = keepBody; S.docCtx = keepCtx;
    }
  });

  /* 走真实入口：onDocFiles → 解析 → 落盘 → 索引 → 检索能捞到 → 删除清干净。
     这条是本轮的主链路，中间的每一段都可能静默失败，所以要端到端测。 */
  await TA('资料库：上传 txt 走完整链路（入库→检索命中→删除清空）', async function(){
    var keepDocs = S.docs, keepBody = DOC_BODY, keepCtx = S.docCtx;
    try{
      S.docs = []; DOC_BODY = {}; S.docCtx = {on:true, budget:2400, top:4};
      var body = '第三章 动态规划\n'
        + '动态规划适合处理有重叠子问题和最优子结构的问题。\n'
        + '背包问题是最经典的一维动态规划例子，状态转移方程要写清楚。\n'
        + '区间 DP 的常见套路是先枚举区间长度。\n';
      onDocFiles({ files:[new File([body], '算法笔记.txt', {type:'text/plain'})], value:'' });
      var waited = 0;
      while(waited < 6000 && !S.docs.length){ await sleep(120); waited += 120; }
      if(!S.docs.length) return {ok:false, info:'入库超时（等了 ' + waited + 'ms）'};
      var d = S.docs[0];
      var metaOk = d && d.name === '算法笔记.txt' && d.parts >= 1 && d.chars > 20 && d.on === true;

      /* 正文要能被读回来（原生存文件 / 浏览器存 localStorage） */
      var loaded = await new Promise(function(res){
        docStoreLoad(d.id, function(ok, payload){ res(ok ? docDecodeBody(payload) : null); });
      });
      var readBack = !!(loaded && loaded.length && loaded[0].text.indexOf('动态规划') >= 0);

      /* 检索：命中关键词，且不把无关的段算进来 */
      var r = docsRetrieve('背包问题的状态转移方程');
      var hit = !!(r && r.text.indexOf('背包问题') >= 0 && r.names[0] === '算法笔记.txt');

      /* 来源标注：气泡上要能看出读的是哪一份 */
      var entry = document.getElementById('docBadge');

      /* 删除：索引与正文一起清 */
      docDel(d.id);
      var gone = S.docs.length === 0 && !DOC_BODY[d.id];
      var afterDel = await new Promise(function(res){
        docStoreLoad(d.id, function(ok){ res(!ok); });
      });
      /* 我的页入口的角标同步 —— 不刷的话删完了还显示「1 份」 */
      var badgeOk = !entry || entry.textContent.indexOf('0') === 0;
      return { ok: metaOk && readBack && hit && gone && afterDel && badgeOk,
        info: '索引=' + (d ? (d.name + '/' + d.parts + '段/' + d.chars + '字') : 'null')
          + ' · 正文能读回=' + readBack + ' · 检索命中=' + hit
          + ' · 删除后索引与缓存清空=' + gone + ' · 磁盘文件也删了=' + afterDel
          + ' · 角标同步=' + badgeOk };
    } finally {
      S.docs = keepDocs; DOC_BODY = keepBody; S.docCtx = keepCtx;
      try{ renderDocs(); docsSyncEntry(); renderChatSwitches(); }catch(e){}
    }
  });

  /* 页面与入口：空库、有库两种状态都要能渲染；三个入口（我的页/对话页/二级页）都得在。
     少了任一个，用户就有一条路走不到。 */
  await TA('资料库：二级页与两个入口都在，空库与有库都能渲染', async function(){
    var keepDocs = S.docs, keepBody = DOC_BODY;
    try{
      var viewOk = !!document.getElementById('view-docs')
        && !!document.getElementById('docsBody')
        && !!document.getElementById('docFile')
        && SUBVIEWS.indexOf('docs') >= 0;
      var meEntry = !!document.getElementById('docBadge');

      S.docs = []; DOC_BODY = {};
      renderDocs();
      var emptyHtml = (document.getElementById('docsBody') || {}).innerHTML || '';
      var emptyOk = /还没有资料/.test(emptyHtml) && /上传第一份/.test(emptyHtml);

      S.docs = [{id:'dv1', name:'高数上册.pdf', fmt:'pdf', chars:1200, parts:5, at:Date.now(), on:true}];
      DOC_BODY = { dv1:[{label:'第1段', text:'极限的定义与性质。'}] };
      renderDocs();
      var listHtml = (document.getElementById('docsBody') || {}).innerHTML || '';
      var listOk = /高数上册\.pdf/.test(listHtml) && /PDF · 5 段/.test(listHtml);

      /* 详情：点开要能看到分段正文（用户上传后最想确认的就是「AI 到底读到了什么」） */
      docOpen('dv1');
      var detailHtml = (document.getElementById('docsBody') || {}).innerHTML || '';
      var detailOk = /极限的定义与性质/.test(detailHtml) && /返回列表/.test(detailHtml);
      docBack();

      /* 对话页开关：有资料才出现，且显示份数 */
      S.docCtx = {on:true, budget:2400, top:4};
      renderChatSwitches();
      var swHtml = (document.getElementById('chatSwitches') || {}).innerHTML || '';
      var swOk = /资料库 1/.test(swHtml) && /qsw on/.test(swHtml);
      S.docs = [];
      renderChatSwitches();
      var swGone = (document.getElementById('chatSwitches') || {}).innerHTML.indexOf('资料库') < 0;
      return { ok: viewOk && meEntry && emptyOk && listOk && detailOk && swOk && swGone,
        info: '页面与 SUBVIEWS=' + viewOk + ' · 我的页入口=' + meEntry
          + ' · 空态=' + emptyOk + ' · 列表=' + listOk + ' · 详情分段=' + detailOk
          + ' · 对话页开关带份数=' + swOk + ' · 空库时开关隐藏=' + swGone };
    } finally {
      S.docs = keepDocs; DOC_BODY = keepBody; S.docCtx = {on:true, budget:2400, top:4};
      try{ renderDocs(); docsSyncEntry(); renderChatSwitches(); }catch(e){}
    }
  });

  /* 发送链路：资料片段要进 sendText（模型看得见），但气泡上只留用户的话 + 摘要。
     这两件事必须同时成立 —— 只做前者是上一版「附件正文糊在自己气泡里」的复发。 */
  await TA('资料库：检索片段进请求、不进气泡', async function(){
    var keepDocs = S.docs, keepBody = DOC_BODY, keepMsgs = msgs.slice(), keepCtx = S.docCtx;
    var sent = null;
    var origAiText = window.aiText;
    try{
      S.docs = [{id:'ds1', name:'线代讲义.docx', fmt:'docx', chars:80, parts:2, at:1, on:true}];
      DOC_BODY = { ds1:[
        {label:'第1段', text:'特征值与特征向量的定义：Ax=λx。'},
        {label:'第2段', text:'相似矩阵有相同的特征多项式。'}
      ]};
      S.docCtx = {on:true, budget:2400, top:4};
      S.apiKey = S.apiKey || 'sk-test';
      /* 把模型调用截住，拿到真正要发出去的 turns —— 不去真发请求 */
      window.aiText = function(role, turns, cb, opts){
        sent = turns;
        setTimeout(function(){ cb(true, '好的', {reasoning:'', finish:'stop'}); }, 0);
      };
      msgs = [];
      document.getElementById('chatInput').value = '特征值怎么求';
      send();
      var waited = 0;
      while(waited < 3000 && !sent){ await sleep(100); waited += 100; }
      /* 再等 AI 那条消息落进 msgs —— 请求发出去了不等于回调已经跑完，
         不等的话来源标注（它在回调里才 push）永远是空的。 */
      var w2 = 0;
      while(w2 < 3000 && !msgs.some(function(m){ return m.r === 'ai'; })){ await sleep(80); w2 += 80; }
      var last = sent && sent[sent.length - 1];
      var asked = last && typeof last.content === 'string' ? last.content : '';
      var inRequest = asked.indexOf('Ax=λx') >= 0 && asked.indexOf('【资料库片段】') >= 0
        && asked.indexOf('线代讲义.docx') >= 0;
      /* 气泡：只有用户那句话，不含资料正文 */
      var meMsg = msgs.filter(function(m){ return m.r === 'me'; }).pop() || {};
      var bubbleClean = (meMsg.t || '').indexOf('Ax=λx') < 0 && meMsg.t === '特征值怎么求';
      /* 但 sendText 里必须有 —— 重新生成与追问都从它取 */
      var stored = (meMsg.sendText || '').indexOf('Ax=λx') >= 0;
      /* 来源标注要写明哪一份 */
      var aiMsg = msgs.filter(function(m){ return m.r === 'ai'; }).pop() || {};
      var srcOk = (aiMsg.src || []).some(function(s){ return s.indexOf('线代讲义.docx') >= 0; });
      return { ok: inRequest && bubbleClean && stored && srcOk,
        info: '片段进请求=' + inRequest + ' · 气泡干净=' + bubbleClean
          + ' · sendText 留档=' + stored + ' · 来源标注带文件名=' + srcOk };
    } finally {
      window.aiText = origAiText;
      S.docs = keepDocs; DOC_BODY = keepBody; S.docCtx = keepCtx;
      msgs = keepMsgs; document.getElementById('chatInput').value = '';
      try{ renderMsgs(); renderChatSwitches(); }catch(e){}
    }
  });


  /* 真机：UI Pro 下呼出键盘后「输入框太高」——浮空一截。
     根因是皮肤给 .screen 垫了 96px 给悬浮底栏让位，而基础样式在键盘弹起时
     把底栏整条 display:none 收掉了，让位高度却还留着。经典档没这段 padding，
     所以只在 UI Pro 复现 —— 断言必须把「键盘弹起」这个状态真的挂上类再量。 */
  T('键盘弹起时收掉底栏让位高度：输入框贴着键盘，不再浮空', function(){
    var sc = document.querySelector('.screen');
    var r = document.documentElement;
    if(!sc) return { ok:false, info:'缺 .screen' };
    if(r.classList.contains('layout-tablet')) return { ok:false, info:'自测视口是平板布局，量不到手机端的 dock 让位' };
    var keep = S.uiTheme;
    try{
      S.uiTheme = 'pro'; applyLook();
      r.classList.remove('kb-open');
      var dockRoom = parseFloat(getComputedStyle(sc).paddingBottom);
      r.classList.add('kb-open');
      var kbRoom = parseFloat(getComputedStyle(sc).paddingBottom);
      r.classList.remove('kb-open');
      S.uiTheme = 'classic'; applyLook();
      r.classList.add('kb-open');
      var classicRoom = parseFloat(getComputedStyle(sc).paddingBottom);
      r.classList.remove('kb-open');
      /* 判据不写死数字：要测的是「留白够不够底栏用」，不是「是不是 96」。
         dock 高度与它自身的下边距一起量，改尺寸时这条断言不用跟着改
         （2026-10-23 底栏从 68 收到 56，写死 90 的那版就假失败了）。 */
      var bar = document.querySelector('.tabbar');
      var barH = bar ? bar.getBoundingClientRect().height : 0;
      var need = barH + 8;
      return {
        ok: dockRoom >= need && kbRoom === 0 && classicRoom < 20,
        info: 'Pro 有底栏时 ' + dockRoom + 'px（dock ' + Math.round(barH) + 'px + 8 起算）'
          + ' · 键盘弹起 ' + kbRoom + 'px · 经典档 ' + classicRoom + 'px'
      };
    } finally {
      r.classList.remove('kb-open');
      S.uiTheme = keep; applyLook();
    }
  });

  /* 2026-10-18：四大卡片的返回必须和打开走同一套几何 —— 裁切窗口收缩。
     退回「整体缩放」的后果是 430×886 缩到 192×113（纵向 0.13 倍），
     整页被夯成一条横带；逐帧数值见 tools/motion_tile.mjs。 */
  await TA('动效：卡片返回走裁切窗口（无整体缩放），窗口向内收', async function(){
    var tile = document.querySelector('#page-home .g-tile');
    if(!tile) return { ok:false, info:'找不到首页卡片' };
    if(!MOTION.clipOk) return { ok:true, info:'本内核不支持 inset round，走 collapse 兜底（跳过）' };
    var tr = tile.getBoundingClientRect();
    tile.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, cancelable:true,
      pointerId:71, pointerType:'touch', isPrimary:true, clientX:tr.left+6, clientY:tr.top+6 }));
    openView('schedule');
    await sleep(760);
    var v = document.getElementById('view-schedule');
    var showed = v.classList.contains('show');
    closeView('schedule');
    await sleep(120);
    var st = getComputedStyle(v);
    var m = String(st.transform).match(/matrix\(([^)]+)\)/);
    var arr = m ? m[1].split(',').map(parseFloat) : [1,0,0,1,0,0];
    var nums = (String(st.clipPath).match(/-?[\d.]+/g) || []).map(Number);
    /* top / left 已经离开 0 就说明窗口在向内收（而不是整块缩放） */
    var shrunk = nums.length >= 4 && nums[0] > 2 && nums[3] > 2;
    var noScale = Math.abs(arr[0] - 1) < 0.02 && Math.abs(arr[3] - 1) < 0.02;
    await sleep(520);
    var closed = !v.classList.contains('show');
    return {
      ok: showed && shrunk && noScale && closed,
      info: '打开=' + showed + ' · 120ms clip=' + (nums.length ? nums.slice(0,4).join(',') : 'none')
        + ' · scale=' + arr[0].toFixed(3) + '/' + arr[3].toFixed(3) + ' · 关闭=' + closed
    };
  });

  /* 2026-10-18：我的页按压只要缩放，不要任何遮罩（用户明确要求）。
     单行卡缩整卡（.li-zoom），多行卡缩那一行（.press-on）；两者都不许挂 .li-press，
     也不许有 .press-on 的 brightness（那也是遮罩的一种）。 */
  T('按压：设置类页只缩不放遮罩，别处遮罩仍在', function(){
    /* 2026-10-19 我的页重构：列表从 #page-me 搬到了四个类页里。
       规则本身没变（单行卡缩整卡、多行卡缩那一行、都不上遮罩），
       只是取样点跟着搬 —— 否则这条会「因为找不到卡片」而假失败。 */
    var act = document.querySelector('.page.active');
    var keepTab = act ? act.id : 'page-home';
    var lists = [].slice.call(document.querySelectorAll('#view-xj .list, #view-study .list'));
    var one = lists.filter(function(l){ return l.querySelectorAll('.li.tap').length === 1; })[0];
    var many = lists.filter(function(l){ return l.querySelectorAll('.li.tap').length > 1; })[0];
    if(!one || !many) return { ok:false, info:'设置类页没找到单行/多行卡片（找到 ' + lists.length + ' 张卡）' };
    function down(li, pid){
      var r = li.getBoundingClientRect();
      li.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, cancelable:true,
        pointerId:pid, pointerType:'touch', isPrimary:true, clientX:r.left+20, clientY:r.top+8 }));
    }
    function up(li, pid){
      li.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, pointerId:pid, pointerType:'touch' }));
    }
    var li1 = one.querySelector('.li.tap');
    down(li1, 72);
    var s1 = {
      zoom: /\bli-zoom\b/.test(one.className),
      mask: /\bli-press\b/.test(one.className) || /999px/.test(getComputedStyle(one).boxShadow),
      dim: getComputedStyle(li1).filter !== 'none'
    };
    up(li1, 72);
    var li2 = many.querySelectorAll('.li.tap')[1];
    down(li2, 73);
    var s2 = {
      scale: /\bpress-on\b/.test(li2.className),
      mask: /\bli-press\b/.test(li2.className) || /999px/.test(getComputedStyle(li2).boxShadow),
      dim: getComputedStyle(li2).filter !== 'none'
    };
    up(li2, 73);
    if(keepTab) go(keepTab.replace('page-', ''));
    return {
      ok: s1.zoom && !s1.mask && !s1.dim && s2.scale && !s2.mask && !s2.dim,
      info: '单行卡 缩=' + s1.zoom + ' 遮罩=' + s1.mask + ' 变暗=' + s1.dim
        + ' · 多行卡 缩=' + s2.scale + ' 遮罩=' + s2.mask + ' 变暗=' + s2.dim
    };
  });

  /* 2026-10-18：全屏点击关闭层（弹层遮罩 / 抽屉遮幕 / 选择器遮罩）不能有按压反馈。
     它们带 onclick（点空白关闭），旧逻辑会把 .press-on 加在它们身上 ——
     scale .972 让整块缩进去、四周露出底下的页面，brightness 再把整块压暗；
     真机就是「按住空白部分遮罩缩放穿帮」。 */
  T('按压：全屏关闭层不缩不变暗，弹层与抽屉里的空白也不触发', function(){
    function down(el, pid){
      if(!el) return { err:'缺元素' };
      var r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, cancelable:true,
        pointerId:pid, pointerType:'touch', isPrimary:true,
        clientX:Math.max(1, r.left + 12), clientY:Math.max(1, r.top + 12) }));
      var host = el.closest('.mask,.drawer-scrim,.pickmask') || el;
      var c = getComputedStyle(host);
      var out = { cls:host.className, scale:c.scale, filter:c.filter };
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, pointerId:pid, pointerType:'touch' }));
      return out;
    }
    function bad(x){
      if(x.err) return true;
      return /press-on/.test(x.cls) || x.filter !== 'none'
        || (x.scale !== 'none' && parseFloat(x.scale) < 0.999);
    }
    var act = document.querySelector('.page.active');
    var keepId = act ? act.id : 'page-home';
    go('home');
    var m = document.getElementById('mask');
    m.classList.add('show');
    var a = down(m, 81);                          /* 遮罩本身 */
    var b = down(document.getElementById('sheet'), 82);   /* 弹层里的空白（冒泡到 mask） */
    m.classList.remove('show');
    var s = document.getElementById('histScrim');
    s.classList.add('show');
    var c = down(s, 83);                          /* 抽屉遮幕 */
    s.classList.remove('show');
    go(keepId.replace('page-', ''));
    return {
      ok: !bad(a) && !bad(b) && !bad(c),
      info: '遮罩 ' + a.scale + '/' + a.filter + ' · 弹层空白 ' + b.scale + '/' + b.filter
        + ' · 遮幕 ' + c.scale + '/' + c.filter
    };
  });

  /* 遮挡层＝模糊，不是压暗。压暗 .32 会把上层那圈半透明白玻璃一起拖灰，
     真机看到的就是整块灰蒙蒙 —— 用户两张截图就是来投诉这个。 */
  T('遮挡层：模糊生效且底色 ≤0.2（不再靠压暗分层）', function(){
    var m = document.getElementById('mask');
    var c = getComputedStyle(m);
    var bf = c.backdropFilter || c.webkitBackdropFilter || 'none';
    var alpha = 1;
    var mm = String(c.backgroundColor).match(/rgba?\(([^)]+)\)/);
    if(mm){ var p = mm[1].split(',').map(parseFloat); alpha = p.length > 3 ? p[3] : 1; }
    return { ok: /blur\(/.test(bf) && alpha <= 0.2, info: 'blur=' + bf + ' · 底色 alpha=' + alpha };
  });

  /* 2026-10-18：周条的「无课」类原来叫 empty，和空状态块 .empty 撞名 ——
     Pro 皮肤给 .empty 挂了 background:var(--glass)，而周末必然没课、必然带 empty，
     于是选中周六时 .day.sel 的品牌渐变被玻璃底整条盖掉（白底白字）。
     同时「没课」不能用品牌色表达：那会让 Classic 的周末常驻一层蓝。 */
  T('周条：选中（即使没课）必须是品牌渐变，没课的其他格不许偏蓝', function(){
    var keepSel = selIdx, keepTheme = S.uiTheme;
    var out = [];
    try{
      var idx = -1;
      for(var i = 0; i < 7; i++){ if(!coursesAt(i).length){ idx = i; break; } }
      if(idx < 0) idx = 5;
      ['classic', 'pro'].forEach(function(th){
        try{ S.uiTheme = th; applyLook(); }catch(e){}
        pickDay(idx);
        var cells = [].slice.call(document.querySelectorAll('#week .day'));
        var sel = cells[idx], c = getComputedStyle(sel);
        var grad = /linear-gradient/.test(c.backgroundImage);
        var bf = c.backdropFilter || c.webkitBackdropFilter || 'none';
        var bad = [];
        /* 「偏蓝」不能只看 b-r：中性深灰 rgba(23,26,38,.03) 的 b 也比 r 大 15。
           判据分两支：色相明显偏蓝（b 比 r/g 都高 60 以上），或实色且带一点蓝调的高亮底
           —— 后者正是 --brand-soft 这种「品牌浅底」，也是回归时会出现的形态。 */
        function isBrandish(css){
          var m = String(css).match(/[\d.]+/g);
          if(!m) return false;
          var v = m.map(Number), r = v[0], g = v[1], b = v[2], a = v.length > 3 ? v[3] : 1;
          var hue = (b - r >= 60 && b - g >= 60);
          var pale = (a >= .8 && b - r >= 10 && (r + g + b) / 3 > 180);
          return hue || pale;
        }
        cells.forEach(function(d, k){
          if(k === idx || d.classList.contains('other')) return;
          if(!d.classList.contains('no-course')) return;
          var bg = getComputedStyle(d).backgroundColor;
          if(isBrandish(bg)) bad.push(k + ':' + bg);
        });
        out.push(th + ' 渐变=' + grad + ' blur=' + (bf === 'none' ? 'none' : '有')
          + ' 没课偏蓝=' + (bad.join(' ') || '无'));
        if(!grad || bf !== 'none' || bad.length) out.bad = true;
      });
    } finally {
      S.uiTheme = keepTheme; applyLook(); pickDay(keepSel);
    }
    return { ok: !out.bad, info: out.join(' · ') };
  });

  /* 2026-10-18：切页「先出半透明底、约一秒后才补上模糊」—— 连续三版都猜错了方向：
       v0.3.23 以为是"底色太薄"，加了 240ms 的 .warming 实底        → 用户反馈"更明显"
       v0.3.24 以为是"display:none 销毁了纹理"，改成三页常驻渲染    → 没治好且更糟
       v0.3.25 以为是"模糊半径太贵"，磨砂档 46px 降到 18px          → 零效果
     真正的根因（tools/blur_time_probe.mjs 实测）：go() 给 .page 打的那条 transform
     进场动画期间，Chromium 把 .page 提升成独立合成层，页内每个 backdrop-filter 的
     backdrop root 随之变成 .page 自己；光晕画在 .phone 上、不在这个 root 里，
     玻璃于是采到**空底** —— 整段动画期间字面意义上没有模糊。
     实测条纹底的行均值标准差：动画期间 31.3（= 强制 backdrop-filter:none 的 31.31），
     动画结束 5.50；把位移抹成 0 仍然 31.31（只要 transform 在被动画就会提升合成层）。
     所以下面盯三件事：tab 用 display 切换（别退回常驻）；磨砂档半径不许涨回去；
     玻璃皮肤下切页不许再给 .page 打位移动画（Classic 没有玻璃，动画要保住）。 */
  T('切页与模糊：tab 用 display 切换，磨砂档半径 ≤20px（成本上限）', function(){
    var keepTheme = S.uiTheme, keepGlass = S.uiGlass;
    try{
      S.uiTheme = 'pro'; applyLook();
      var pages = [].slice.call(document.querySelectorAll('.page'));
      var byDisplay = pages.filter(function(p){ return getComputedStyle(p).display === 'none'; }).length >= 1;
      var onlyOneShown = pages.filter(function(p){ return getComputedStyle(p).display !== 'none'; }).length === 1;
      S.uiGlass = 'frost'; applyLook();
      var card = document.querySelector('.card') || document.querySelector('.list');
      var m = /blur\((\d+(?:\.\d+)?)px/.exec(getComputedStyle(card).backdropFilter || '');
      var px = m ? parseFloat(m[1]) : 999;
      return {
        ok: byDisplay && onlyOneShown && px <= 20,
        info: '有 display:none 的页=' + byDisplay + ' · 同时只显示一页=' + onlyOneShown
          + ' · 磨砂档 --blur=' + px + 'px（上限 20）'
      };
    } finally {
      S.uiTheme = keepTheme; S.uiGlass = keepGlass; applyLook();
    }
  });

  /* 行为断言（不做源码字符串匹配，真的切一次页看动画是什么）：
     玻璃皮肤下 go() 的横滑必须走 **left 通道**（MOTION.slideX）——
     关键帧里一旦出现 transform 或 opacity，.page 就会被提升成合成层，
     页内所有 backdrop-filter 的 backdrop root 随之变成 .page 自己，
     光晕画在 .phone 上不在里面，整段动画期间玻璃没有模糊（2026-10-18 实测）。
     Classic 没有玻璃面，走 transform 的 enter()，两边各自对号。 */
  await TA('切页与模糊：玻璃皮肤横滑只走 left（Classic 仍走 transform）', async function(){
    var keepTheme = S.uiTheme;
    try{
      go('home');
      S.uiTheme = 'pro'; applyLook();
      await sleep(80);
      var liPro = document.querySelector('#page-home .list') || document.querySelector('.list');
      var bfPro = getComputedStyle(liPro).backdropFilter || getComputedStyle(liPro).webkitBackdropFilter || 'none';
      /* 数之前先清场：前面那些断言也调过 go('me')，残留动画会被一起数进来 */
      function cancelAll(){
        document.getElementById('page-me').getAnimations().forEach(function(a){
          try { a.cancel(); } catch (e) {}
        });
      }
      cancelAll();
      go('me');
      var aPro = document.getElementById('page-me').getAnimations();
      S.uiTheme = 'classic'; applyLook();
      await sleep(80);
      go('home'); cancelAll(); go('me');
      var aCls = document.getElementById('page-me').getAnimations();
      function props(list){
        return list.map(function(a){
          var kf = [];
          try { kf = Object.keys((a.effect && a.effect.getKeyframes && a.effect.getKeyframes()[0]) || {}); } catch (e) {}
          return kf.filter(function(k){ return k !== 'offset' && k !== 'computedOffset' && k !== 'easing' && k !== 'composite'; }).join('+');
        }).join(' , ');
      }
      var pPro = props(aPro), pCls = props(aCls);
      var okPro = aPro.length === 1 && pPro === 'left';
      var okCls = aCls.length >= 1 && pCls.indexOf('transform') >= 0;
      return {
        ok: okPro && okCls,
        info: '玻璃生效=' + (bfPro !== 'none')
          + ' · Pro 动画数=' + aPro.length + ' 属性=[' + pPro + ']（应 1 个、只动 left）'
          + ' · Classic 动画数=' + aCls.length + ' 属性=[' + pCls + ']（应含 transform）'
      };
    } finally {
      S.uiTheme = keepTheme; applyLook();
    }
  });

  /* 二级页的状态栏适配（2026-10-18 v0.3.31）。
     真机症状：「顶部没有避让，而且会有留空」。
     几何上"让开状态栏"有两种做法，只有一种是沉浸的：
       ✗ top:var(--sb-inset) —— 页面从状态栏下面才开始，顶部那条露出主页面 = 留空；
       ✓ top:0 + padding-top:var(--sb-inset) —— 页面画到状态栏底下，内容避开。
     顺带钉死：全屏层（#noteFull/#inkFull）是 fixed;inset:0，也必须自己让位，
     否则顶栏压在系统图标后面、返回键点不到。 */
  await TA('二级页：状态栏沉浸式（画到屏顶 + 内容让位），全屏层也让位', async function(){
    var keep = document.documentElement.className;
    try{
      var sb = 34;   /* 用一个非默认值，避免"刚好等于 0 所以通过" */
      document.documentElement.classList.add('app-mode');
      window.__setInsets(sb, 16);
      await sleep(120);
      go('home');
      openView('schedule');
      await sleep(420);
      /* ⚠️ 桌面预览里 syncInsets() 会用 env(safe-area-inset-top) 把 --sb-inset 冲回 0，
         而浏览器里那个值恒为 0。它在闭包里（赋一个同名函数只是新建了全局，
         绑在 resize 上的还是原来那个 —— 实测无效），所以不靠打桩：
         **测量前再写一次**。这条测的是「CSS 是否尊重 --sb-inset」，
         不是「原生值会不会被别的监听器覆盖」，后者在真机上走的是 isApp 分支。 */
      window.__setInsets(sb, 16);
      await sleep(30);
      var v = document.getElementById('view-schedule');
      var vr = v.getBoundingClientRect();
      var cs = getComputedStyle(v);
      var head = v.querySelector('.viewhead').getBoundingClientRect();
      /* ① 页面本身要贴到屏幕最顶（沉浸），不是从状态栏下面开始 */
      var viewAtTop = Math.abs(vr.top) < 1;
      /* ② 顶栏内容要落在状态栏以下 */
      var headClears = head.top >= sb - 1;
      /* ③ 顶栏与状态栏之间不许留空：差值要小（<= 4px） */
      var gap = head.top - sb;
      var noGap = Math.abs(gap) <= 4;
      /* ④ 真机上二级页铺满，圆角归零（圆角会削掉顶部两角、露出主页面） */
      var radZero = parseFloat(cs.borderTopLeftRadius) === 0;
      closeView('schedule');
      await sleep(600);
      /* ⑤ 全屏层自己让位。
         ⚠️ 关页之后还要再写一次：closeView 会触发 syncBack 等一串收尾，
         其中任何一处跑到 syncInsets() 都会把 --sb-inset 冲回 0（桌面预览下 env() 恒为 0）。
         实测这就是本条的 flaky 来源 —— 连跑四次里第一次报「全屏层让位=0px/0px」，
         而顶栏那几项都是对的（它们在上面那次重写之后就读了）。 */
      window.__setInsets(sb, 16);
      await sleep(30);
      var nf = getComputedStyle(document.getElementById('noteFull'));
      var ik = getComputedStyle(document.getElementById('inkFull'));
      var fixedClears = parseFloat(nf.paddingTop) === sb && parseFloat(ik.paddingTop) === sb;
      return {
        ok: viewAtTop && headClears && noGap && radZero && fixedClears,
        info: 'view.top=' + Math.round(vr.top) + '（应 0，画到屏顶）'
          + ' · 顶栏.tb=' + Math.round(head.top) + '（应 ≥' + sb + '）'
          + ' · 间隙=' + Math.round(gap) + '（应 ≤4）'
          + ' · 圆角=' + cs.borderTopLeftRadius + '（应 0）'
          + ' · 全屏层让位=' + nf.paddingTop + '/' + ik.paddingTop
      };
    } finally {
      document.documentElement.className = keep;
      window.__setInsets(0, 0);
      try{ closeView('schedule'); }catch(e){}
      applyLook();
    }
  });

  /* 键盘收起后底部抬高（2026-10-18 v0.3.32）。
     真机症状：打开一次待办的输入框（它会自动 focus）之后，弹层整体上浮、底部空一条。
     根因：键盘弹起时 .phone 按可用高度缩小（对），但 --vh 的"基准"被写成整屏、
       值却被写成小高度；键盘收起后「高度 > 基准」永远不成立 → --vh 永久卡在小值。
     断言直接复刻那个状态机：模拟一次开合，检查 --vh 是否回到视口高度。 */
  await TA('键盘开合：--vh 必须回到视口高度（否则底部会留一条）', async function(){
    var root = document.documentElement;
    var keepVh = root.style.getPropertyValue('--vh');
    if(typeof setVHRecheck !== 'function') return { ok: false, info: 'setVHRecheck 不存在' };
    try{
      /* 模拟键盘弹起：标 kb-open，高度按"被键盘压小"写 */
      var full = window.innerHeight;
      root.classList.add('kb-open');
      root.style.setProperty('--vh', Math.round(full * 0.6) + 'px');
      await sleep(30);
      /* 键盘收起 */
      root.classList.remove('kb-open');
      setVHRecheck();
      await sleep(900);          /* 等复查窗口走完（0/80/200/400/700） */
      /* 基准取**复查结束后**的真实视口，不是测试开始时那个 ——
         --vh 的定义就是「当前视口高度」，而在无头窗口里跑别的断言时
         innerHeight 可能已经变过（本轮就因为前面多跑了一条异步断言而偶发红灯）。
         卡死在不等于当前视口的值上照样会被这条抓住。 */
      var now = window.innerHeight;
      var got = parseInt(getComputedStyle(root).getPropertyValue('--vh'), 10);
      var ok = Math.abs(got - now) <= 1;
      return {
        ok: ok,
        info: '视口=' + now + 'px（开始 ' + full + 'px）· --vh=' + got + 'px'
          + (ok ? '' : ' ← 卡在被键盘压小的值上了')
      };
    } finally {
      root.classList.remove('kb-open');
      if(keepVh) root.style.setProperty('--vh', keepVh);
      setVHRecheck();
    }
  });

  /* ------------------------------------------------------------
     底部留白：真机「打开一次输入框后底部空一条」的第二个入口
     ------------------------------------------------------------
     上一版只处理了「键盘开→收」这条路径。真机上还有一条更隐蔽的：
     被杀进程前停在输入框里 → 冷启动时 innerHeight 可能还带着键盘占掉的高度，
     而 kb-open 类**不落盘**（会话态），于是走进「键盘已收起」分支，
     把这个偏小的值当成整屏写进 --vh，并在 h > _vhMax 里把它当基准守住。
     结果就是用户什么都没做，底部凭空空一条。
     断言要钉的是「首帧不立基准」这个机制本身，以及它的自愈。 */
  await TA('底部留白：首帧量到偏小的高度也会自己长回整屏', async function(){
    var root = document.documentElement;
    var keepVh = root.style.getPropertyValue('--vh');
    var keepFirst = (typeof _vhFirst !== 'undefined') ? _vhFirst : null;
    var keepMax = (typeof _vhMax !== 'undefined') ? _vhMax : null;
    try{
      /* 造出「首帧偏小」：清基准、把首帧标记打开、把 --vh 写成 60% */
      var full = window.innerHeight;
      _vhMax = 0;
      _vhFirst = true;
      root.style.setProperty('--vh', Math.round(full * 0.6) + 'px');
      /* 首帧：setVH 应该写值但**不立基准**，并自己触发一次 recheck */
      setVH();
      var noBaseline = (_vhMax === 0);
      await sleep(900);   /* 等 recheck 的多点取样走完 */
      var now = window.innerHeight;
      var got = parseInt(getComputedStyle(root).getPropertyValue('--vh'), 10);
      var healed = Math.abs(got - now) <= 1;
      /* .phone 的高度必须跟视口一致（否则底部空一条） */
      var ph = document.getElementById('phone');
      var phH = ph ? Math.round(ph.getBoundingClientRect().height) : -1;
      var phOk = Math.abs(phH - now) <= 1;
      return { ok: noBaseline && healed && phOk,
        info: '首帧未立基准=' + noBaseline + ' · --vh 自愈到 ' + got + 'px（视口 ' + now + '）'
          + ' · .phone 高 ' + phH + 'px' };
    } finally {
      root.classList.remove('kb-open');
      if(keepVh) root.style.setProperty('--vh', keepVh);
      if(keepFirst !== null) _vhFirst = keepFirst;
      if(keepMax !== null) _vhMax = keepMax;
      setVHRecheck();
    }
  });

  /* ------------------------------------------------------------
     真机模式（app-mode）的 .phone 高度不许依赖 --vh
     ------------------------------------------------------------
     ★ 这条是本轮最重要的教训换来的：之前所有键盘探针都是直接开
     http://.../index.html 测的，**没带 ?app=1** —— 那走的是桌面模式
     （.phone 高度是 820px 固定 / 窄屏媒体查询），根本没进 app-mode 那条规则。
     于是「--vh 写坏会怎样」这件事一直没被测到，改了两轮都不对。
     现在的结构保证是：app-mode 下 .phone 高度走百分比链路（html/body 100%），
     与 --vh 完全解耦 —— 原生 setPadding 不产生 resize 事件、
     --vh 晚了或错了，都不影响 .phone 贴合视口。
     断言直接钉这个解耦：把 --vh 写成 120px，.phone 必须仍等于视口高度。 */
  await TA('真机模式：app-mode 下 .phone 高度与 --vh 解耦（写坏也不塌）', async function(){
    var root = document.documentElement;
    var keepVh = root.style.getPropertyValue('--vh');
    var hadApp = root.classList.contains('app-mode');
    try{
      root.classList.add('app-mode');
      await sleep(120);
      var ph = document.getElementById('phone');
      if(!ph) return { ok: false, info: '缺 #phone' };
      var inner0 = window.innerHeight;
      var h0 = Math.round(ph.getBoundingClientRect().height);
      var baseOk = Math.abs(h0 - inner0) <= 1;

      /* 把 --vh 写到荒唐值：旧写法会让 .phone 直接塌成 120px */
      root.style.setProperty('--vh', '120px');
      await sleep(160);
      var h1 = Math.round(ph.getBoundingClientRect().height);
      var gap1 = Math.round(window.innerHeight - ph.getBoundingClientRect().bottom);
      var immune = Math.abs(h1 - inner0) <= 1 && Math.abs(gap1) <= 1;

      /* 再验一次「底部没有露白」：.phone 底边要贴住视口底边 */
      var pr = ph.getBoundingClientRect();
      var noGap = Math.abs(pr.bottom - window.innerHeight) <= 1;
      return { ok: baseOk && immune && noGap,
        info: 'app-mode 高度=视口(' + h0 + '/' + inner0 + ')=' + baseOk
          + ' · --vh 写 120px 后仍 ' + h1 + 'px=' + immune
          + ' · 底边贴齐=' + noGap };
    } finally {
      root.classList.remove('app-mode');
      if(!hadApp) root.classList.remove('app-mode');
      if(keepVh) root.style.setProperty('--vh', keepVh);
      else root.style.removeProperty('--vh');
      setVHRecheck();
      await sleep(60);
    }
  });

  /* ------------------------------------------------------------
     幽灵层：真机「点进专注页之后另外三页点什么都没反应」
     ------------------------------------------------------------
     机制：某个 .view 已经不该显示，但仍吃指针事件 —— 底栏在它上层所以还能切页，
     切过去的页面被这层看不见的东西挡住。
     断言钉两层：
       ① CSS：.view:not(.show) 的 pointer-events 必须是 none 且带 !important ——
          结构性保证，不依赖任何一处 JS 收尾是否漏了；
       ② JS 自愈：内联 style 被写脏时会被清掉。
     反向验证：把 ① 的 !important 去掉 / 把 ② 的清理删掉，各自必须报红。 */
  await TA('幽灵层：不显示的二级页绝不吃点击，且脏内联会被自愈', async function(){
    var v = document.getElementById('view-focus');
    if(!v) return { ok: false, info: '缺 #view-focus' };
    var ok = true, parts = [];
    try{
      /* ① 结构性：内联式强制 auto 也压不住 */
      v.classList.remove('show');
      v.style.pointerEvents = 'auto';
      v.style.opacity = '1';
      await sleep(60);
      var peNow = getComputedStyle(v).pointerEvents;
      var structural = (peNow === 'none');
      parts.push('内联 auto 也压住=' + structural);
      ok = ok && structural;

      /* ② 自愈：等它把脏内联清干净（有 900ms 的退场保护窗口，等久一点） */
      await sleep(1400);
      var dirtyLeft = v.style.opacity !== '' || v.style.transform !== ''
        || v.style.clipPath !== '' || v.style.willChange !== '';
      var cleaned = !dirtyLeft;
      parts.push('脏内联被清=' + cleaned);
      ok = ok && cleaned;

      /* ③ 退场保护：刚关过的页在窗口内**不能**被清（否则退场动画被砍断） */
      _viewClosingAt['focus'] = Date.now();
      v.style.opacity = '1';
      await sleep(300);
      var protectedNow = (v.style.opacity === '1');
      parts.push('退场窗口内不清=' + protectedNow);
      ok = ok && protectedNow;
      /* 收尾：把假时间戳与脏值清掉，别影响后面的断言 */
      delete _viewClosingAt['focus'];
      v.style.opacity = '';
      v.style.pointerEvents = '';
      return { ok: ok, info: parts.join(' · ') };
    } finally {
      try{
        delete _viewClosingAt['focus'];
        v.classList.remove('show');
        v.style.pointerEvents = '';
        v.style.opacity = '';
        v.style.transform = '';
        v.style.clipPath = '';
        v.style.willChange = '';
      }catch(e){}
    }
  });

  /* ============================================================
     搭档
     ------------------------------------------------------------
     最容易静默出错的是**独立记忆的隔离**：memItems() 改了容器，
     但如果某个写路径还直接碰 S.memory.items，就会变成「界面显示搭档的、
     新记忆写进全局」—— 用户看到的是「聊了一晚上什么都没记住」。
     所以这里不只测 UI，还要测「写入落在哪」和「切换后读的是哪一套」。
     ============================================================ */

  T('搭档：memItems 按搭档隔离记忆，切换后读写都跟着换', function(){
    var keepP = S.partners, keepId = S.partnerId, keepMem = S.memory;
    try{
      S.memory = {on:true, auto:true, items:[
        {id:'g1', text:'全局记忆：数学是弱项', cat:'study', at:1, src:'manual'}
      ]};
      S.partners = [
        {id:'pa', name:'老陈', desc:'毒舌高数助教', prompt:'说话短，直接指出错误',
         avatar:'', memOn:true, mem:[
           {id:'a1', text:'老陈记住：喜欢先看例题', cat:'pref', at:2, src:'auto'}
         ], at:100},
        {id:'pb', name:'阿远', desc:'', prompt:'', avatar:'', memOn:false, mem:[], at:200}
      ];

      /* ① 没选搭档 → 全局 */
      S.partnerId = '';
      var g = memItems();
      var useGlobal = g.length === 1 && g[0].id === 'g1' && !ptMemOn();

      /* ② 选开独立记忆的搭档 → 它自己的那套（不是拷贝，是真引用） */
      S.partnerId = 'pa';
      var a = memItems();
      var usePartner = a.length === 1 && a[0].id === 'a1' && ptMemOn() && ptMemScope() === 'partner';
      var isRef = a === S.partners[0].mem;   // 必须是同一个数组对象

      /* ③ 写入要落在搭档那边，全局不能被污染（这条是关键） */
      var r1 = memAdd('老陈新记的：周三有课', 'study', 'auto');
      var wrotePartner = r1 === 'added'
        && S.partners[0].mem.length === 2
        && S.memory.items.length === 1
        && S.memory.items[0].id === 'g1';

      /* ④ 选关掉独立记忆的搭档 → 回落全局 */
      S.partnerId = 'pb';
      var b = memItems();
      var fallbackGlobal = b.length === 1 && b[0].id === 'g1' && !ptMemOn();

      /* ⑤ 删除要删对地方 */
      S.partnerId = 'pa';
      memDel('a1');
      var delOk = S.partners[0].mem.length === 1 && S.partners[0].mem[0].id !== 'a1'
        && S.memory.items.length === 1;

      /* ⑥ 清空只清当前那套 */
      memClear();
      var clearOk = S.partners[0].mem.length === 0 && S.memory.items.length === 1;

      /* ⑦ 搭档被删掉 → 必须退回默认，不许停在一个悬空 id 上 */
      S.partners = S.partners.filter(function(x){ return x.id !== 'pa'; });
      var orphan = ptCur() === null && memItems().length === 1;

      return { ok: useGlobal && usePartner && isRef && wrotePartner && fallbackGlobal
          && delOk && clearOk && orphan,
        info: '默认读全局=' + useGlobal + ' · 独立读自己=' + usePartner
          + ' · 返回真引用=' + isRef + ' · 写入不污染全局=' + wrotePartner
          + ' · 关掉后回落全局=' + fallbackGlobal + ' · 删除删对地方=' + delOk
          + ' · 清空只清当前=' + clearOk + ' · 搭档删除后退回默认=' + orphan };
    } finally {
      S.partners = keepP; S.partnerId = keepId; S.memory = keepMem;
      try{ renderMemory(); renderPartners(); }catch(e){}
    }
  });

  T('搭档：系统提示词前置身份段、名字跟着换、不盖掉用户的 systemPrompt', function(){
    var keepP = S.partners, keepId = S.partnerId, keepSys = S.systemPrompt, keepName = S.aiName;
    try{
      S.aiName = '小径';
      S.systemPrompt = '硬规矩：不要用 emoji。';
      S.partners = [{id:'pa', name:'老陈', desc:'毒舌高数助教',
        prompt:'说话短，遇到算错的步骤直接指出来', avatar:'', memOn:false, mem:[]}];

      /* 没选搭档：与之前逐字一致 */
      S.partnerId = '';
      var noPn = activeSysPrompt() === '硬规矩：不要用 emoji。';
      var noName = profileBlock().indexOf('【你的名字】小径') >= 0;

      /* 选了搭档：身份段在最前，用户的硬规矩还在后面 */
      S.partnerId = 'pa';
      var sys = activeSysPrompt();
      var hasIdentity = sys.indexOf('【你的身份】你叫「老陈」') >= 0
        && sys.indexOf('毒舌高数助教') >= 0
        && sys.indexOf('说话短，遇到算错的步骤直接指出来') >= 0;
      var keepsUser = sys.indexOf('硬规矩：不要用 emoji。') >= 0;
      var identityFirst = sys.indexOf('【你的身份】') < sys.indexOf('硬规矩');
      /* 边界那条必须有：否则角色扮演会拿去编造课表 */
      var hasBoundary = sys.indexOf('不许为了贴合角色而编造或隐瞒') >= 0;
      /* 档案里的名字必须跟着换，否则提示词里出现两个名字打架 */
      var prof = profileBlock();
      var nameSwapped = prof.indexOf('【你的名字】老陈') >= 0
        && prof.indexOf('【你的名字】小径') < 0;
      /* 学习档案不能因为换人就消失 */
      var keepsProfile = prof.indexOf('【今日课表】') >= 0 || prof.indexOf('【课表】') >= 0;

      return { ok: noPn && noName && hasIdentity && keepsUser && identityFirst
          && hasBoundary && nameSwapped && keepsProfile,
        info: '无搭档时零改动=' + noPn + '/' + noName + ' · 身份段=' + hasIdentity
          + ' · 用户硬规矩保留=' + keepsUser + ' · 身份段在前=' + identityFirst
          + ' · 有防编造边界=' + hasBoundary + ' · 档案名字跟着换=' + nameSwapped
          + ' · 学习档案仍在=' + keepsProfile };
    } finally {
      S.partners = keepP; S.partnerId = keepId; S.systemPrompt = keepSys; S.aiName = keepName;
    }
  });

  /* 头像的两个身份不能混：
       在场者（气泡/打字）→ 搭档的图；代表者（我的页设置项）→ 全局的图。
     混了的表现是「点进设置改 AI 头像，改了没反应」。 */
  T('搭档：在场者头像用搭档的，设置项仍显示全局头像', function(){
    var keepP = S.partners, keepId = S.partnerId, keepAv = S.aiAvatar;
    try{
      var D1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      var D2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      S.aiAvatar = D1;
      S.partners = [{id:'pa', name:'老陈', desc:'', prompt:'', avatar:D2, memOn:false, mem:[]}];

      S.partnerId = 'pa';
      var actorIsPartner = aiActorAvatarSrc() === D2;
      var settingsIsGlobal = aiAvatarSrc() === D1;   // 设置项那一项读的必须是它

      /* 搭档没设图 → 在场者回落全局，不能空白 */
      S.partners[0].avatar = '';
      var actorFallsBack = aiActorAvatarSrc() === D1;

      S.partnerId = '';
      var noPartnerGlobal = aiActorAvatarSrc() === D1;

      return { ok: actorIsPartner && settingsIsGlobal && actorFallsBack && noPartnerGlobal,
        info: '气泡头像=搭档的=' + actorIsPartner + ' · 设置项仍是全局=' + settingsIsGlobal
          + ' · 搭档无图回落全局=' + actorFallsBack + ' · 未选搭档用全局=' + noPartnerGlobal };
    } finally {
      S.partners = keepP; S.partnerId = keepId;
      if(keepAv) S.aiAvatar = keepAv; else delete S.aiAvatar;
    }
  });

  /* 搭档必须屏蔽「回复风格」，但**不能**连带把「回复长度」也压掉 ——
     这两项在同一行拼进系统提示，很容易一刀切删过头：
       · 风格描述「你是谁、怎么说话」→ 与搭档的 prompt 直接冲突，必须不发；
       · 长度描述「这次写多长」→ 和人设无关，压掉只会让回答莫名变短。
     还要防一种更隐蔽的漏：只屏蔽了注入、没拦 setReplyStyle 工具，
     模型在搭档对话里被要求换风格时会把**全局**设置改掉，
     用户切回默认小径发现语气变了却找不到原因。 */
  T('搭档：屏蔽回复风格注入，但保留回复长度、也不许工具偷偷改全局', function(){
    var keepP = S.partners, keepId = S.partnerId, keepStyle = S.prefs.replyStyle;
    try{
      S.partners = [{id:'pa', name:'老陈', desc:'', prompt:'说话短，直接指出错误',
        avatar:'', memOn:false, mem:[]}];

      /* ① 没搭档：风格与长度都在（原有行为不能变） */
      S.partnerId = '';
      S.prefs.replyStyle = 'tsundere';
      var plain = styleBlock();
      var keepBoth = plain.indexOf('【回复风格】') >= 0 && plain.indexOf('【回复长度】') >= 0
        && plain.indexOf('傲娇大小姐') >= 0;

      /* ② 有搭档：风格消失，长度还在 */
      S.partnerId = 'pa';
      var withP = styleBlock();
      var noStyle = withP.indexOf('【回复风格】') < 0
        && withP.indexOf('傲娇大小姐') < 0
        && withP.indexOf('苏格拉底') < 0;
      var keepLen = withP.indexOf('【回复长度】') >= 0;

      /* ③ 整个 sysPrompt 里也不许漏出风格（styleBlock 之外可能在别处拼过） */
      S.prefs.replyLength = 'long';
      var full = sysPrompt(false);
      var cleanSys = full.indexOf('【回复风格】') < 0 && full.indexOf('傲娇大小姐') < 0;
      /* 搭档自己的设定必须在 */
      var hasPartner = full.indexOf('【你的身份】你叫「老陈」') >= 0;

      /* ④ 工具层面：setReplyStyle 不许生效，且要说清原因 */
      var tip = runOneTool('setReplyStyle', {k:'ceo'});
      var toolBlocked = S.prefs.replyStyle === 'tsundere'
        && !!tip && tip.indexOf('搭档') >= 0;

      /* ⑤ 切回默认：风格立刻回来（存着的值没被破坏） */
      S.partnerId = '';
      var backOk = styleBlock().indexOf('傲娇大小姐') >= 0 && S.prefs.replyStyle === 'tsundere';

      return { ok: keepBoth && noStyle && keepLen && cleanSys && hasPartner && toolBlocked && backOk,
        info: '无搭档时风格+长度都在=' + keepBoth
          + ' · 有搭档时风格消失=' + noStyle + ' · 长度保留=' + keepLen
          + ' · 整个提示词无风格残留=' + cleanSys + ' · 搭档设定仍在=' + hasPartner
          + ' · 工具被拦且说明原因=' + toolBlocked + ' · 切回后风格恢复=' + backOk };
    } finally {
      S.partners = keepP; S.partnerId = keepId; S.prefs.replyStyle = keepStyle;
      S.prefs.replyLength = 'medium';
    }
  });

  /* 页面 + 两个入口 + 表单 + 菜单：任何一条断了用户就走不到那条路 */
  await TA('搭档：二级页、我的页入口、加号菜单快捷应用都能走通', async function(){
    var keepP = S.partners, keepId = S.partnerId;
    try{
      S.partners = []; S.partnerId = '';
      var viewOk = !!document.getElementById('view-partners')
        && !!document.getElementById('ptBody')
        && !!document.getElementById('ptAvatarFile')
        && SUBVIEWS.indexOf('partners') >= 0;
      var meEntry = !!document.getElementById('ptBadge') && !!document.getElementById('ptHint');

      /* 空态：必须先给「默认小径」这一条路，否则建了搭档就回不去 */
      renderPartners();
      var emptyHtml = (document.getElementById('ptBody') || {}).innerHTML || '';
      var emptyOk = /还没有自建搭档/.test(emptyHtml) && /默认/.test(emptyHtml);

      /* 表单：五个可编辑项都在 */
      ptNew();
      await sleep(120);
      var sheetTxt = (document.getElementById('sheet') || {}).innerHTML || '';
      var formOk = /ptNameIn/.test(sheetTxt) && /ptDescIn/.test(sheetTxt)
        && /ptPromptIn/.test(sheetTxt) && /ptFormAv/.test(sheetTxt)
        && /独立记忆/.test(sheetTxt) && /保存/.test(sheetTxt);

      /* 真填一遍并保存 —— 走完整链路，不直接 push 数据 */
      document.getElementById('ptNameIn').value = '老陈';
      document.getElementById('ptDescIn').value = '毒舌高数助教';
      document.getElementById('ptPromptIn').value = '说话短，直接指出错误';
      ptToggleDraftMem(document.querySelector('#sheet .switch'));
      ptSaveForm();
      await sleep(150);
      var saved = S.partners.length === 1 && S.partners[0].name === '老陈'
        && S.partners[0].desc === '毒舌高数助教'
        && S.partners[0].prompt === '说话短，直接指出错误'
        && S.partners[0].memOn === true && S.partners[0].avatar === '';
      /* 新建即启用：用户来这里就是为了用它 */
      var autoActive = S.partnerId === S.partners[0].id;

      var html = (document.getElementById('ptBody') || {}).innerHTML || '';
      var listOk = /老陈/.test(html) && /独立记忆 0 条/.test(html) && /当前/.test(html);

      /* 加号菜单：要有搭档这一项，点开列出默认 + 每个搭档 + 新建 */
      var menu = document.getElementById('plusMenu');
      togglePlusMenu();
      await sleep(80);
      var plusHas = ((menu || {}).innerHTML || '').indexOf('搭档') >= 0;
      closePlusMenu();
      plusPartnerMenu();
      await sleep(80);
      var rows = menu ? menu.querySelectorAll('.actrow').length : 0;
      var pmTxt = (menu || {}).innerHTML || '';
      var pmOk = rows === 3 && /老陈/.test(pmTxt) && /新建搭档/.test(pmTxt) && /默认/.test(pmTxt);

      /* 快捷切换：从菜单点「默认」要真的换回来 */
      applyPartner('');
      var switched = S.partnerId === '' && ptCur() === null;

      return { ok: viewOk && meEntry && emptyOk && formOk && saved && autoActive
          && listOk && plusHas && pmOk && switched,
        info: '页面与SUBVIEWS=' + viewOk + ' · 我的页入口=' + meEntry + ' · 空态=' + emptyOk
          + ' · 表单五项齐=' + formOk + ' · 保存写入正确=' + saved + ' · 新建即启用=' + autoActive
          + ' · 列表渲染=' + listOk + ' · 加号含搭档=' + plusHas
          + ' · 搭档菜单(' + rows + '行)=' + pmOk + ' · 快捷切回默认=' + switched };
    } finally {
      closeSheet(); closePlusMenu();
      S.partners = keepP; S.partnerId = keepId;
      try{ renderPartners(); renderPartnerHint(); }catch(e){}
    }
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
html = html.replace(/<\/body>/, '\n<script>\nwindow.__ASSERTSRC__ = ' + JSON.stringify(ASSERTS) + ';\nwindow.__EXPECT_VER__ = ' + JSON.stringify(EXPECT_VER) + ';\nwindow.__FIX__ = ' + JSON.stringify(fileFixtures()) + ';\n</script>\n</body>');
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

  // J) 专注系统重构（v0.2.4）：真机踩过「通知栏跑完的专注，统计里是 0m」。
  //    三件事必须同时成立，缺一个就会退回到老问题上：
  //      · 页面倒计时按 endsAt 推算（进程死了不至于蒸发）
  //      · 原生跑完要落盘（以前只改一条通知，从不告诉页面）
  //      · 页面有拉取通道 + 回执（否则补记了又会被重复记）
  try {
    const page3 = fs.readFileSync(SRC, 'utf8');
    const strip3 = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const js = strip3(page3);
    const J = f => fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main',
      'java', 'com', 'xuejing', 'app', f), 'utf8');

    /* ① 页面：不再逐帧自减，且重启不再无条件抹掉存档 */
    const stillDecrement = /S\.focus\.secs\s*-=\s*dt/.test(js);
    const tickByStamp = /S\.focus\.endsAt\s*\?\s*Math\.max\(0,\s*\(S\.focus\.endsAt\s*-\s*now\)/.test(js);
    const hasAnchor = /function focusAnchor\(\)/.test(js);
    const wipesFocus = /S\.focus\s*=\s*deepMerge\(DEFAULT\.focus,\s*\{\}\)/.test(js);

    /* ② 原生：三条结束路径都要落盘；拉/回执桥接要在 */
    const fsrv = J('FocusService.java');
    const store = J('FocusStore.java');
    const bridge = J('NativeBridge.java');
    const finishes = /FocusStore\.finish\(app, FocusStore\.R_NATURAL\)/.test(fsrv)
                  && /FocusStore\.finish\(c, FocusStore\.R_MANUAL\)/.test(fsrv);
    const hasStore = /class FocusStore/.test(store);
    const persistOk = /putString\(K_CUR/.test(store) && /putString\(K_PENDING/.test(store);
    const pullsState = /public String focusState\(\)/.test(bridge);
    const acks = /public void focusAck\(/.test(bridge);

    /* ③ 预约：由原生闹钟真正触发（落盘），不是只发一条通知 */
    const recv = J('ClassAlarmReceiver.java');
    const bookTriggers = /FocusService\.start\(context, name,/.test(recv);
    /* ④ 取消预约必须推给原生，否则它存的还是旧的 bookings，到点照样拉起专注 */
    const cancelPushes = /delete S\.bookings\[id\][\s\S]{0,240}?pushScheduleToNative\(\)/.test(js);
    /* ⑤ 预约要有边界判定，且按钮与 bookClass 共用同一个口 */
    const hasCanBook = /function canBookCourse\(/.test(js);
    const btnUsesIt = /canBookCourse\(selIdx, c\)/.test(js);

    results.push({
      name: '架构守卫：专注计时权威在原生（真机踩过：杀后台时间白费）',
      ok: !stillDecrement && tickByStamp && hasAnchor && !wipesFocus
          && hasStore && persistOk && finishes && pullsState && acks
          && bookTriggers && cancelPushes && hasCanBook && btnUsesIt,
      info: `页面仍自减=${stillDecrement} · tick按时间戳=${tickByStamp} · 有focusAnchor=${hasAnchor}`
        + ` · 重启抹存档=${wipesFocus} · FocusStore=${hasStore} · 落盘=${persistOk}`
        + ` · 结束落盘=${finishes} · focusState=${pullsState} · focusAck=${acks}`
        + ` · 预约闹钟触发=${bookTriggers} · 取消推原生=${cancelPushes}`
        + ` · 预约边界口=${hasCanBook} · 按钮复用=${btnUsesIt}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：专注计时权威', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // K) 笔刷说明只写「这支笔做出来是什么效果」，不解释「它为什么叫这个名字」。
  //    原来的铅笔说明结尾挂着「…像铅笔。」——名字就在标题上，再说一遍是废话。
  //    这条盯住它别再回来。
  try {
    const raw = fs.readFileSync(SRC, 'utf8');
    const js2 = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const m = /var INK_BRUSH\s*=\s*\{([\s\S]*?)\n\};/.exec(js2);
    const block = m ? m[1] : '';
    const selfRef = /像铅笔|像马克笔|像毛笔|真马克笔也是|就是铅笔/.test(block);
    const hasHints = ['pencil', 'marker', 'brush'].every(function (k) {
      return new RegExp(k + '\\s*:\\s*\\{[\\s\\S]*?hint:').test(block);
    });
    results.push({
      name: '架构守卫：笔刷说明不写同义反复（「像铅笔」这类）',
      ok: !!block && !selfRef && hasHints,
      info: `找到 INK_BRUSH=${!!block} · 同义反复=${selfRef} · 三支笔都有 hint=${hasHints}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：笔刷说明', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // M) 灵动岛（v0.2.7）：真机踩过「微缩岛左边只剩一个图标、文字全在右边」。
  //    四件事必须同时成立，缺一个就退回老排版或退化成没人刷新的死数字：
  //      · 用 RemoteViews 自定义两列（island_pill.xml）
  //      · 文案单点在 pill()，通知标题/RemoteViews/MIUI JSON 四处共用
  //      · 倒计时由 60 秒刷新闹钟推进，且只排到 endAt（有界，不是无界轮询）
  //      · 课前/上课中是同一条通知的两种相位（同 ID），不拆两条
  try {
    /* J() 只在上一个 try 块里定义过，这里自己起一个（别图省事复用别人的作用域） */
    const J = f => fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main',
      'java', 'com', 'xuejing', 'app', f), 'utf8');
    const isl = J('Island.java');
    const nfy = J('Notify.java');
    const recv = J('IslandActionReceiver.java');
    const layout = fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main',
      'res', 'layout', 'island_pill.xml'), 'utf8');
    const customView = /setCustomContentView\(/.test(isl)
      && /new RemoteViews\(/.test(isl);
    const twoCols = /islandName/.test(layout) && /islandCountdown/.test(layout)
      && /android:layout_weight="1"/.test(layout);
    const singlePill = /static Pill pill\(/.test(isl)
      && /buildPill\([\s\S]{0,400}?Pill p/.test(isl)
      && /miuiParamV2\(title, text, accent, pill\)/.test(isl);
    /* v0.2.9：改成原生 Chronometer 计时。MIUI 的 timerInfo 真机上不跳秒
       （官方模板库没给字段表），所以走 AOSP 的 setChronometer + setCountDown。
       每分钟重发保留为兜底（enableFloat=false，不会因此反复展开）。 */
    const boundedRefresh = /scheduleRefresh\(/.test(isl)
      && /put\("enableFloat", false\)/.test(isl);
    const sameId = /showClass\(c, Island.ID_CLASS_START,\s*\n\s*course \+ \(Island\.elTime \? \(" " \+ startHM\) : ""\),\s*\n\s*place, true, endAt, endAt, true\)/.test(nfy);
    const refreshWired = /Island\.A_REFRESH\.equals\(a\)/.test(recv)
      && /Island\.refresh\(context\)/.test(recv);
    /* 小岛必须用官方认可的组件名。v0.2.7 塞的是 imageTextInfoLeft —— 那是
       **大岛 A 区**的组件名，小岛不认，系统直接忽略，于是只剩一个图标。
       v0.2.9 按用户要求改用 combinePicInfo（中心图标 + 外圈环形进度 = 倒计时环）。 */
    const contractSrc = fs.readFileSync(path.join(root, 'tools', 'island_contract_test.mjs'), 'utf8');
    const smallHasText = /put\("combinePicInfo"/.test(isl)
      && /put\("progressInfo"/.test(isl)
      && /put\("progress", pct\)/.test(isl)
      && !/smallArea\.put\("imageTextInfoLeft"/.test(isl)
      && /smallIslandArea/.test(contractSrc);
    /* 三个分项开关必须在 Notify 里真的分流，不能只在设置页摆着 */
    const cfgUsed = /Island\.cfgStart/.test(nfy) && /Island\.cfgEnd/.test(nfy)
      && /Island\.cfgStay/.test(nfy);
    /* 专注岛必须**复用**同一套两列排版（pillViews），不能自己另写一套 ——
       两种动态两种风格，等于没设计过。而且专注以前不可配上岛，这个开关是新加的。 */
    const focusShares = /Island\.cfgFocus/.test(nfy)
      && /Island\.pillViews\(c, Island\.ICON_TIMER, p, Island\.ACCENT, running\)/.test(nfy)
      && /static Pill pillTimer\(/.test(isl);
    /* 停留时长档必须被用上，且走对字段。
       官方：timeout 单位是**分钟**（默认 720），岛的停留时长是
       param_island.islandTimeout，单位**秒**（默认 3600）。
       v0.2.7 把秒塞进 timeout，等于把 5 分钟写成 300 分钟 —— 岛赖着不走。 */
    const lenUsed = /Island\.stayMillis\(\)/.test(nfy)
      && /put\("islandTimeout", \(int\) Math\.max\(60, stayMillis\(\) \/ 1000L\)\)/.test(isl)
      && /put\("timeout", 720\)/.test(isl);

    /* v0.2.8 新增守卫 A：enableFloat 的语义。
       官方定义 islandFirstFloat=首次出现是否展开、enableFloat=**更新时**是否展开。
       v0.2.7 两个都写 true → 每秒刷新一次通知 = 每秒强制展开一次，
       用户真机反馈「岛反复弹开，没法正常用」。 */
    const floatRight = /put\("islandFirstFloat", true\)/.test(isl)
      && /put\("enableFloat", false\)/.test(isl)
      && !/put\("enableFloat", true\)/.test(isl);

    /* v0.2.9 守卫 B：倒计时必须走**原生** Chronometer。
       真机实测 MIUI 的 timerInfo 不跳秒（官方模板库只给了名字、没给字段表），
       所以改用 AOSP 的 RemoteViews.setChronometer + setCountDown，
       布局里承载它的控件也必须从 TextView 换成 Chronometer。 */
    const timerSys = /rv\.setChronometer\(R\.id\.islandCountdown/.test(isl)
      && /setInt\(R\.id\.islandCountdown, "setCountDown", 1\)/.test(isl)
      && /<Chronometer/.test(layout)
      && /setChronometerCountDown\(true\)/.test(nfy)
      && /put\("sameWidthDigitInfo", digit\)/.test(isl);
    const focusJ = J('FocusService.java');
    /* 每秒重发保留为兜底（Chronometer 之外的第二条腿），但总时长必须一起传下去，
       否则进度环/进度条拿不到分母，永远画不出来。 */
    const totalWired = /private static\s+(?:volatile\s+)?int sTotal = 0/.test(focusJ)
      && /totalSecs/.test(focusJ)
      && /Notify\.buildFocus\(c, sLabel, remainSecs\(\), true, sTotal\)/.test(focusJ);

    /* v0.2.9 守卫 D：短岛语义。cfgLen 是岛屿形态（0/1/2），
       停留时长另立 stayMin —— 两者混成一个字段就是 v0.2.8 的错。 */
    const shortOk = /shortMode = cfgLen == 0/.test(isl)
      && /if \(o\.has\("stayMin"\)\)/.test(isl)
      && /shortMode \? "" : sub/.test(isl)
      && /nameOnly\(\)/.test(isl);

    /* v0.2.8 新增守卫 C：picInfo.pic 里写的只是 key，
       系统还要去 miui.focus.pics Bundle 取图。以前只写 key 从不放图，
       取不到就回退应用默认图标 —— 排版看着「像只剩图标」。 */
    const picsOk = /putBundle\("miui\.focus\.pics", pics\)/.test(isl)
      && /putParcelable\(K_PIC, Icon\.createWithResource/.test(isl)
      && /put\("pic", K_PIC\)/.test(isl);

    results.push({
      name: '架构守卫：岛更新不强制展开（真机踩过：每秒弹开一次）',
      ok: floatRight && timerSys && totalWired && picsOk,
      info: `enableFloat=false=${floatRight} · 原生Chronometer=${timerSys}`
        + ` · 总时长已接线=${totalWired} · picsBundle可取图=${picsOk}`
    });

    results.push({
      name: '架构守卫：短岛形态与停留时长分离（真机踩过：理解错需求）',
      ok: shortOk && lenUsed,
      info: `形态/时长已拆开=${shortOk} · 停留时长走islandTimeout=${lenUsed}`
    });

    results.push({
      name: '架构守卫：微缩岛两列排版与小岛组件合法性（真机踩过：只剩图标）',
      ok: customView && twoCols && singlePill && boundedRefresh && sameId
        && refreshWired && cfgUsed && smallHasText && focusShares && lenUsed,
      info: `自定义两列=${customView && twoCols} · 文案单点=${singlePill}`
        + ` · 已排有界刷新=${boundedRefresh} · 同ID两相位=${sameId}`
        + ` · 刷新已接线=${refreshWired} · 三个开关分流=${cfgUsed}`
        + ` · 小岛用right组件=${smallHasText}`
        + ` · 专注复用同一套排版=${focusShares} · 时长档生效=${lenUsed}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：微缩岛排版', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // L) 笔记的返回必须是三级（真机踩过：编辑页按返回直接掉回主页）。
  //    两条一起盯：头部箭头不许直接 closeView，androidBack 必须把 notes 交给 noteBackAction。
  try {
    const rawHtml = fs.readFileSync(SRC, 'utf8');
    const headBackOk = /onclick="noteBackAction\(\)"/.test(rawHtml);
    const headBackWrong = /onclick="closeView\('notes'\)"/.test(rawHtml);
    const js3 = rawHtml.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const backBranch = /if\s*\(\s*L === 'notes'\s*\)\s*\{\s*return noteBackAction\(\)/.test(js3);
    const hasAction = /function noteBackAction\s*\(/.test(js3);
    results.push({
      name: '架构守卫：笔记返回三级（头部箭头与返回键都走同一个口）',
      ok: headBackOk && !headBackWrong && backBranch && hasAction,
      info: `头部走 noteBackAction=${headBackOk} · 头部仍用 closeView=${headBackWrong}`
        + ` · androidBack 有 notes 分支=${backBranch} · 有 noteBackAction=${hasAction}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：笔记返回三级', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // N) 原生侧的三类「不报错但功能没了」——这次通读抓出来的，全部钉住不许回来：
  //    ① 上课提醒：上了岛才不发通知；机型不支持、分项开关关掉、时间解析失败
  //       这三种情况都必须退回普通通知（以前是直接 return，通知分支永远走不到）
  //    ② PDF 转图：成功路径的 err 本来就是 null，却被交给会 s.length() 的 jsString
  //       —— 在 pdf-preview 工作线程上抛 NPE，没人接，整个 App 闪退
  //    ③ 课表闹钟：只校验小时，分钟 -1 会被 lenient 的 Calendar 回拨成上一分钟
  try {
    const J2 = f => fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main',
      'java', 'com', 'xuejing', 'app', f), 'utf8');
    const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const nfy2 = strip(J2('Notify.java'));
    const pdf2 = strip(J2('PdfPreview.java'));
    const rem2 = strip(J2('ReminderScheduler.java'));
    const ma2 = strip(J2('MainActivity.java'));
    const isl2 = strip(J2('Island.java'));

    /* ① 分流函数存在、且判了机型支持；三条静默路径都不许再裸 return */
    const islandFallback = /islandClassOnIsland/.test(nfy2)
      && /Island\.supported\(\)/.test(nfy2)
      && !/if \(!Island\.cfgStart\) return;/.test(nfy2)
      && !/if \(!okTime\) return;/.test(nfy2)
      && !/if \(!Island\.cfgEnd\) \{ Island\.hide\(c, Island\.ID_CLASS_START\); return; \}/.test(nfy2);
    /* ② err 为 null 要写成 JS 的 null；jsString 自己也要兜住 null */
    const pdfNull = /r\.err == null \? "null"/.test(pdf2)
      && !/r\.more \? "null" : MainActivity\.jsString\(r\.err\)/.test(pdf2)
      && /if \(s == null\) return "\\"\\"";/.test(ma2);
    /* ③ 两处排程（常规课表 + 补课）都要把分钟兜住 */
    const minuteGuard = (rem2.match(/if \(sm < 0\) sm = 0;/g) || []).length === 2
      && (rem2.match(/sm > 59 \|\| em > 59/g) || []).length === 2;
    /* ④ 桥线程不许直接改 View / 拉起权限框 */
    const mainThread = /void applyDarkMode[\s\S]{0,200}?runOnUiThread/.test(ma2)
      && /void askNotificationPermission[\s\S]{0,200}?runOnUiThread/.test(ma2);
    /* ⑤ 语音合成的 mp3 不能用 file:// 交给 WebView（targetSdk 30+ 默认禁止文件访问），
          要走 FileProvider，并且清单侧要有对应的 cache 路径 */
    const ttsUri = !/callbackTts\(true, "file:\/\/"/.test(ma2)
      && /FileProvider\.getUriForFile\(this,\s*getPackageName\(\) \+ "\.fileprovider", out\)/.test(ma2)
      && /<cache-path name="tts" path="tts\/" \/>/.test(
        fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main', 'res', 'xml', 'file_paths.xml'), 'utf8'));
    /* ⑥ 岛的下岛/刷新闹钟：am.set() 不抛异常，原来的 catch 兜底等于死代码 */
    const alarmIdle = !/am\.set\(AlarmManager\.RTC_WAKEUP/.test(isl2)
      && /setAndAllowWhileIdle\(AlarmManager\.RTC_WAKEUP, at, pi\)/.test(isl2);

    results.push({
      name: '架构守卫：原生静默失效五连（提醒退路 / PDF 转图 / 闹钟分钟 / 桥线程 / TTS 播放）',
      ok: islandFallback && pdfNull && minuteGuard && mainThread && ttsUri && alarmIdle,
      info: `提醒能退回通知=${islandFallback} · PDF 空值不炸=${pdfNull}`
        + ` · 分钟兜底两处=${minuteGuard} · UI与权限回主线程=${mainThread}`
        + ` · 语音走content://=${ttsUri} · 岛闹钟豁免Doze=${alarmIdle}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：原生静默失效五连', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // O) 手写落盘：矢量立即进内存，位图导出与整库写盘防抖。
  //    盯四件事，少一件就退回「每抬一笔卡一次」或者「切笔记丢笔迹」：
  //      · inkSaveToNote 只存快照 + 排防抖，不再自己调 inkExportPng/save
  //      · 快照必须带笔记 id 与 items（防抖窗口里切笔记会写错对象）
  //      · 退出全屏 / 点保存 / 换笔记 / 切后台 都强制冲一次
  //      · 清空要取消还没冲的防抖（否则旧快照会把笔迹写回来）
  try {
    const raw = fs.readFileSync(SRC, 'utf8');
    const js = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const sched = (js.match(/function inkSaveToNote\(\)[\s\S]*?\n\}/) || [''])[0];
    const cheapSchedule = /setTimeout\(inkFlushSave/.test(sched)
      && !/inkExportPng\(\)/.test(sched) && !/\bsave\(\)/.test(sched);
    const snapshot = /inkPending = \{\s*id: noteCurId, items: inkItems\.map\(inkStrip\)/.test(js);
    const forced = /function inkExitFull\(\)[\s\S]{0,120}?inkFlushSave\(\)/.test(js)
      && /function inkSaveOnly\(\)\{ inkFlushSave\(\)/.test(js)
      && /function inkLoadFromNote\(\)[\s\S]{0,160}?inkFlushSave\(\)/.test(js)
      && /pagehide[\s\S]{0,120}?inkFlushSave\(\)/.test(js);
    const clearCancels = /function inkClear\(\)[\s\S]{0,220}?clearTimeout\(inkSaveTimer\)/.test(js);
    results.push({
      name: '架构守卫：手写落盘防抖（不再每抬一笔导一次位图）',
      ok: cheapSchedule && snapshot && forced && clearCancels,
      info: `调度便宜=${cheapSchedule} · 快照带归属=${snapshot}`
        + ` · 关键路径强制冲=${forced} · 清空取消防抖=${clearCancels}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：手写落盘防抖', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // P) 专注条的拖动不许再占用 window 上的永久非被动监听（真机滚动掉帧的经典来源），
  //    也不许把「第几下才全屏」那种靠记忆的状态机带回来。
  try {
    const raw = fs.readFileSync(SRC, 'utf8');
    const js = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const drag = (js.match(/function fbBindDrag\(\)[\s\S]*?\n\}/) || [''])[0];
    const noWindowHooks = !/window\.addEventListener\(['"](?:touchmove|mousemove|mouseup|touchend)['"]/.test(drag);
    const pointerBased = /pointerdown/.test(drag) && /pointermove/.test(drag)
      && /pointerup/.test(drag) && /setPointerCapture/.test(drag);
    const noLeakFlag = !/var fbFromPill/.test(js);
    /* 形态切换要当场生效（自测同帧可断言），不能靠 setTimeout 分两段 */
    const shapeSync = /function fbSetShape\(next\)\{[\s\S]{0,400}?fbState = next;[\s\S]{0,400}?fbApply\(\);/.test(js)
      && !/function fbSetShape\(next\)\{[\s\S]{0,400}?setTimeout\(/.test(js);
    /* 展开回整条必须清掉内联定位 —— 留着就是「专注条浮在屏幕中间盖住内容」 */
    const barDocked = /function fbApply\(\)[\s\S]{0,900}?el\.style\.left = ''; el\.style\.top = '';/.test(js);
    /* 显隐与形变走 transition，不许退回 display:none 硬切 */
    const styled = /\.focusbar\{[^}]*transition:opacity/s.test(raw)
      && !/\.focusbar\.show\{display:flex/.test(raw);
    results.push({
      name: '架构守卫：专注条（Pointer Events 拖动 / 同步换形态 / 整条回底部 / 有过渡）',
      ok: !!drag && noWindowHooks && pointerBased && noLeakFlag && shapeSync && barDocked && styled,
      info: `不占全局监听=${noWindowHooks} · Pointer Events=${pointerBased}`
        + ` · 三段式标志已清除=${noLeakFlag} · 换形态同步=${shapeSync}`
        + ` · 整条回底部布局=${barDocked} · 显隐走transition=${styled}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：专注条', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // Q) 两条「结构就是契约」的守卫：
  //    ① DEFAULT 里不许有同名键 —— 对象字面量后写的赢，前一份是静默的死配置
  //       （v0.2.9 之前 prefs 就被写了两遍，改上面那份完全看不出效果）。
  //    ② 预约课的正点闹钟必须走精确档（setAlarmClock）：Android 12+ 后台启动前台服务受限，
  //       官方只给精确闹钟豁免；落到非精确档就意味着「约了却从来没自动开始过」。
  try {
    const raw = fs.readFileSync(SRC, 'utf8');
    const js = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const defBlock = (js.match(/var DEFAULT = \{[\s\S]*?\n\};/) || [''])[0];
    const topKeys = [...defBlock.matchAll(/^ {2}([A-Za-z_$][\w$]*)\s*:/gm)].map(x => x[1]);
    /* 匹配不到就是守卫自己坏了：宁可报错，也不许它默默为真 */
    if (topKeys.length < 20) throw new Error('DEFAULT 块没匹配到（顶层键 ' + topKeys.length + ' 个）');
    const dup = topKeys.filter((k, i) => topKeys.indexOf(k) !== i);

    const remSrc = fs.readFileSync(path.join(root, 'android', 'app', 'src', 'main',
      'java', 'com', 'xuejing', 'app', 'ReminderScheduler.java'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const urgentTier = /boolean urgent/.test(remSrc)
      && /setAlarmClock\(new AlarmManager\.AlarmClockInfo/.test(remSrc);
    const bookedWired = /set\(c, am, codeBegin, startAt, true, name, detail, 0, w,\s*\n?\s*isBookedIn/.test(remSrc);
    /* 匹配判据只许有一份：bookedCourseId 与 isBookedIn 都走 bookedKeyHits */
    const singleMatcher = /bookedKeyHits\(k, name, time\)/.test(remSrc)
      && !/k\.contains\(name\) && \(time == null/.test(remSrc);

    results.push({
      name: '架构守卫：DEFAULT 无同名键 + 预约闹钟走精确档',
      ok: dup.length === 0 && urgentTier && bookedWired && singleMatcher,
      info: `DEFAULT 顶层键 ${topKeys.length} 个 · 重复=${(dup.join(',') || '无')}`
        + ` · urgent 档存在=${urgentTier} · 预约课已接上=${bookedWired}`
        + ` · 匹配判据单份=${singleMatcher}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：DEFAULT 同名键 / 精确闹钟', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  // R) UI Pro 皮肤的结构契约。皮肤本体只有一份真相：tools/pro-ui/pro-skin.css，
  //    index.html 里那段由 tools/pro-ui/sync.mjs 同步 —— 拷贝一定会漂移，所以盯三件事：
  //    ① 两份内容一致（改了源文件忘了同步 = 打包出去的还是旧皮肤）；
  //    ② 每一条选择器都被 html.ui-pro 圈住（漏一条，没开开关的用户界面就被改掉了）；
  //    ③ 开关与两档强度都真的接在 applyLook 上（皮肤靠类生效，JS 不挂类就是死代码）。
  try {
    const raw = fs.readFileSync(SRC, 'utf8');
    const HEAD = '/* ==== UI Pro 皮肤 · 由 tools/pro-ui/sync.mjs 从 pro-skin.css 同步，勿手改此段 ==== */';
    const TAIL = '/* ==== UI Pro 皮肤 结束 ==== */';
    const i = raw.indexOf(HEAD), j = raw.indexOf(TAIL);
    if (i < 0 || j < 0) throw new Error('index.html 里找不到皮肤段（被误删了？）');
    const inlined = raw.slice(i, j + TAIL.length).replace(/\r\n/g, '\n');
    const src = fs.readFileSync(path.join(root, 'tools', 'pro-ui', 'pro-skin.css'), 'utf8')
      .replace(/\r\n/g, '\n').trimEnd();
    const same = inlined === HEAD + '\n' + src + '\n' + TAIL;

    /* 逐条选择器查门禁：取每个 { 之前的文本，逗号拆开，每段都要含 html.ui-pro。
       @ 开头的是 at-rule 前导（@media / @supports / @keyframes），不是选择器。 */
    const css = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const ungated = [];
    let count = 0;
    for (const m of css.matchAll(/([^{}]+)\{/g)) {
      const prelude = m[1].replace(/\s+/g, ' ').trim();
      if (!prelude || prelude.startsWith('@')) continue;
      /* 前导里可能残留上一条规则的收尾文本，只取最后一段候选选择器 */
      const cand = prelude.split('}').pop().trim();
      /* @keyframes 的步进名（from / to / 50%）不是选择器，别当漏门禁 */
      if (!cand || /^(from|to|[\d.]+%)$/.test(cand)) continue;
      count++;
      cand.split(',').forEach(s => {
        const sel = s.trim();
        if (sel && !/\bhtml\.ui-pro/.test(sel)) ungated.push(sel);
      });
    }
    /* 匹配不到规则 = 守卫自己坏了，宁可报错也不许它默默为真 */
    if (count < 40) throw new Error('皮肤选择器只扫出 ' + count + ' 条，正则可能失效');

    const js = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const wired = /classList\.toggle\('ui-pro', pro\)/.test(js)
      && /dataset\.edge = S\.uiEdge === false \? 'off' : 'on'/.test(js)
      && /dataset\.glass = S\.uiGlass === 'frost' \? 'frost' : 'clear'/.test(js)
      && !/--blur-n/.test(js);
    const inDefault = /^ {2}uiTheme: 'classic',/m.test(js) && /^ {2}uiEdge: true,/m.test(js)
      && /^ {2}uiGlass: 'clear',/m.test(js);
    const rows = /id="uiThemeSeg"/.test(raw) && /id="uiThemeThumb"/.test(raw)
      && /id="uiEdgeSw"/.test(raw) && /id="glassSeg"/.test(raw) && /id="view-theme"/.test(raw);
    /* 主题入口不许再写「旧布尔取反」：S.uiPro 这个键已被迁移删掉，
       !undefined 恒为 true → 只能开不能关（真机报「切不回经典」）。
       ⚠️ 只剥 HTML 注释，不剥 /* *\/：这条规则的成因就写在 HTML 注释里，
       连着注释查会把「解释自己为什么这么写」当成违规（riseIn 那条踩过同一个坑）。
       而 JS 块注释不能顺手一起剥 —— 这个文件里 /* 与 *\/ 的数量对不上
       （字符串里也有），非贪婪配对会吃掉大片正常代码，守卫就永远匹配不到东西了。 */
    const code = raw.replace(/<!--[\s\S]*?-->/g, '');
    const noInvertedOldKey = !/setUiPro\(\s*!S\.uiPro\s*\)/.test(code)
      && /setUiTheme\('classic'\)/.test(code) && /setUiTheme\('pro'\)/.test(code);
    /* 玻璃档/描边/背景三行默认收起：没开 Pro 却给一行改了没反应的设置，比不给更糟 */
    const rowHiddenByDefault = /id="edgeLi"[^>]*display:none/.test(raw)
      && /id="glassLi"[^>]*display:none/.test(raw);
    /* 通透/磨砂 × 明暗 = 四段令牌块，少一段就会有一档在某个主题下失效 */
    const fourBlocks = (src.match(/data-glass="(clear|frost)"/g) || []).length >= 4;
    /* 色散高光（--rim）随玻璃档一起砍掉了，别再溜回来 */
    const noRim = !/--rim/.test(src);
    /* 皮肤改的是令牌而不是点名类名：--card 必须在皮肤里被重新定义 */
    const cardToken = /--card:rgba\(/.test(src);

    /* ===== 防闪三件事（v5 真机「狂闪」之后加的）=====
       ① 全屏 .view 不许挂 backdrop-filter；
       ② 内容面不许叠 background-image 高光（背景图 + 模糊 + 圆角裁剪三者叠加会丢层/重绘）；
       ③ 不许有入场动画（列表每次重渲染都会重放，看着就是刷一下闪一下）。 */
    const viewRule = css.match(/([^{}]*\b\.view\b[^{}]*)\{([^{}]*)\}/g) || [];
    const viewNoBlur = viewRule
      .filter(r => /^\s*(html\.ui-pro[^{}]*\.view|html\.ui-pro #view-focus)/.test(r.trim()))
      .every(r => !/backdrop-filter/.test(r));
    const contentSheen = [];
    for(const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
      const sel = m[1].replace(/\s+/g, ' ').trim();
      if(!/\bhtml\.ui-pro/.test(sel)) continue;
      if(!/\.(card|list|g-tile|course|day)(?![\w-])/.test(sel)) continue;
      if(/background-image/.test(m[2])) contentSheen.push(sel.slice(0, 40));
    }
    /* 注释里说明「去掉了 riseIn」本身不算违规，所以查去注释后的 css */
    const noRise = !/@keyframes\s+riseIn/.test(css) && !/riseIn/.test(css);
    /* ④ 二级页的底必须和 .phone 用同一份令牌：一处写死灰纱、一处写光晕，
          就是「专注页和别人不一样」的成因（真机连报三轮）。 */
    const viewBase = [];
    for(const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
      const sel = m[1].replace(/\s+/g, ' ').trim();
      if(!/html\.ui-pro[^{}]*\b\.view\b|html\.ui-pro[^{}]*#view-focus/.test(sel)) continue;
      /* 只管「铺底」的规则：进场动画那条（animation:fvInPro）不该被算进来 */
      if(!/[{;]\s*background\s*:/.test(m[2])) continue;
      if(!/--base-bg(-photo)?\b/.test(m[2])) viewBase.push(sel.slice(0, 44));
    }
    /* ⑤ 手机端 .vpanel 不许是整块玻璃：整页糊一张，结构就和主页面不同了 */
    const panelFlat = /html\.ui-pro:not\(\.layout-tablet\)\s*\.vpanel\s*\{[^{}]*backdrop-filter:none/.test(css);
    /* ⑥ 状态用 :not() 让开：皮肤的基础态规则一旦压过 .on/:active，
          开与关就长一个样（真机：深度思考/联网搜索分不清）。 */
    const stateGuards = /html\.ui-pro \.qswrow \.qsw:not\(\.on\)/.test(css)
      && /html\.ui-pro \.quickwrap \.quick:not\(:active\)/.test(css)
      && /html\.ui-pro \.qswrow \.qsw\.on/.test(css);

    results.push({
      name: '架构守卫：主题皮肤（两档令牌 / 门禁 / 防闪三件事）',
      ok: same && !ungated.length && wired && inDefault && rows && rowHiddenByDefault
        && fourBlocks && noRim && cardToken && viewNoBlur
        && contentSheen.length === 0 && noRise && noInvertedOldKey
        && viewBase.length === 0 && panelFlat && stateGuards,
      info: `皮肤与源文件一致=${same} · 选择器 ${count} 条未门禁=${ungated.length ? ungated.slice(0, 3).join(' | ') : 0}`
        + ` · applyLook 已接=${wired} · DEFAULT 有键=${inDefault} · 主题页控件齐=${rows}`
        + ` · 主题入口不许取反旧键=${noInvertedOldKey}`
        + ` · 三行默认收起=${rowHiddenByDefault} · 四段玻璃令牌=${fourBlocks}`
        + ` · 色散已移除=${noRim} · --card 已令牌化=${cardToken}`
        + ` · 全屏层无模糊=${viewNoBlur} · 内容面叠高光的规则=${contentSheen.length ? contentSheen.join(' | ') : 0}`
        + ` · 无入场动画=${noRise} · 二级页没铺自己那份底的规则=${viewBase.length ? viewBase.join(' | ') : 0}`
        + ` · 手机端 vpanel 整块模糊已关=${panelFlat} · 状态用 :not() 让开=${stateGuards}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：主题皮肤', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  /* 架构守卫：本地文件解析器必须零依赖、且每条失败路径都给人话。
     查的是**源码文件**而不是页面 DOM —— 断言里写着的模式串自己就在 DOM 里，
     在页内查自己等于自己给自己判红（第一版就踩过）。 */
  try {
    const raw = fs.readFileSync(SRC, 'utf8');
    const code = raw.replace(/<!--[\s\S]*?-->/g, '');
    const ext = /<script[^>]+src\s*=\s*["']https?:\/\//i.test(code);
    /* 查**调用形状**而不是库名：库名会出现在我们自己写的注释里
       （附件系统那段就写着「没有 pdf.js」，按名字查等于给自己判红）。 */
    const libs = ['JSZip\\s*\\(', 'XLSX\\.read', 'mammoth\\.', 'unzipper\\.', 'AdmZip', 'pdfjsLib', 'word-extractor']
      .filter(n => new RegExp(n).test(code));
    const a = code.indexOf('async function parseOfficeFile');
    const b = code.indexOf('/* ---------- 按问题选段');
    if (a < 0 || b < a) throw new Error('找不到 parseOfficeFile 的函数体，守卫失效');
    const body = code.slice(a, b);
    const fails = (body.match(/return \{ok:false/g) || []).length;
    const withErr = (body.match(/return \{ok:false[^}]*err/g) || []).length;
    results.push({
      name: '架构守卫：本地文件解析器（零依赖 / 失败必带人话）',
      ok: !ext && !libs.length && fails > 0 && fails === withErr,
      info: `外链脚本=${ext} · 第三方解析库=${libs.length ? libs.join(',') : 0}`
        + ` · 解析器失败分支 ${fails} 条，带说明的 ${withErr} 条`
    });
  } catch (e) {
    results.push({ name: '架构守卫：本地文件解析器', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  /* 架构守卫：记忆的写路径不许绕过 memItems()。
     这条盯的是「以后有人加第五个写记忆的地方，又直接写 S.memory.items」——
     那会让独立记忆半坏（读新、写旧），且没有任何报错。 */
  try {
    const raw = fs.readFileSync(SRC, 'utf8');
    /* 剥掉块注释再查 —— 规则本身写在注释里，连着注释查会自己判红（riseIn 那条踩过） */
    const js = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    /* 允许出现 S.memory.items 的地方：memItems() 自己的实现、备份提示文案 */
    const lines = js.split('\n');
    const bad = [];
    lines.forEach((ln, i) => {
      if (!/S\.memory\.items/.test(ln)) return;
      /* memItems() 内部两行是容器初始化，是合法的那一处 */
      if (/if\(!Array\.isArray\(S\.memory\.items\)\)/.test(ln)) return;
      if (/return S\.memory\.items;/.test(ln)) return;
      /* 备份恢复后统计条数的 toast，只读不写 */
      if (/toast\(/.test(ln) && /S\.memory\.items\.length/.test(ln)) return;
      bad.push((i + 1) + ': ' + ln.trim().slice(0, 70));
    });
    const routed = /function memItems\(\)\{[\s\S]{0,400}?ptMemOn\(\)[\s\S]{0,200}?ptMemItems\(\)/
      .test(js);
    /* 四个写口都必须走 store/arr（memItems 的返回值） */
    const addOk = /var store = memItems\(\)/.test(js);
    const delOk = /function memDel\(id\)\{[\s\S]{0,120}?var store = memItems\(\)/.test(js);
    const clrOk = /function memClear\(\)\{[\s\S]{0,120}?var store = memItems\(\)/.test(js);
    const trimOk = /function memTrim\(\)\{[\s\S]{0,120}?var arr = memItems\(\)/.test(js);

    results.push({
      name: '架构守卫：记忆读写全走 memItems（否则独立记忆会半坏）',
      ok: !bad.length && routed && addOk && delOk && clrOk && trimOk,
      info: `绕过入口的写=${bad.length ? bad.slice(0, 3).join(' | ') : 0}`
        + ` · memItems 已按搭档路由=${routed}`
        + ` · 增/删/清/裁剪都走入口=${addOk}/${delOk}/${clrOk}/${trimOk}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：记忆读写全走 memItems', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  /* 架构守卫：断言必须都写在页内模板里。
     这一条来自本轮的教训：往 domtest 里加断言时，把块插到了
     「return JSON.stringify(R)」之后 —— 那段是 String.raw 模板块的结束位置，
     写在外面的 T(...) 根本不执行，但**自测照样全绿**，只是总数从 221 变回 216。
     最坏的一种静默失败：新增的守卫一条没跑，而结果看起来是"通过"。
     判据：模板内 T/TA 的调用数要等于文件里 T/TA 出现的总数（架构守卫用
     results.push，不在此列）。两边不一致就说明有断言掉在模板外面。 */
  try {
    const raw = fs.readFileSync(path.join(root, 'tools', 'domtest.mjs'), 'utf8');
    const tplStart = raw.indexOf('const ASSERTS = String.raw`');
    if (tplStart < 0) throw new Error('找不到 ASSERTS 模板');
    const tplEnd = raw.indexOf('return JSON.stringify(R);', tplStart);
    if (tplEnd < 0) throw new Error('找不到模板收尾');
    const inside = raw.slice(tplStart, tplEnd);
    const outside = raw.slice(tplEnd);
    /* 先剥注释再数 —— 解释这条规则的注释里就写着「T(...)」，
       连注释一起数会把自己判红（资料库那条守卫踩过同一个坑）。 */
    const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    /* 数调用形状。正则用拼接构造，别让源码里出现字面的「T(」——
       那一条会被自己数进去（这条守卫已经因为这个自我误报过两次）。 */
    const pat = new RegExp('(?:^|[^A-Za-z0-9_$.])' + 'T' + '(?:A)?\\s*\\(', 'g');
    const countT = s => ((strip(s).match(pat) || []).length);
    const inN = countT(inside), outN = countT(outside);
    /* ⚠️ 关于「模板体里不能出现反引号」：2026-10-22 一天踩了三次
       （注释里写 markdown 围栏、代码块围栏、注释里引用函数名）。
       曾想加一条守卫在这里数反引号，**实测无效**：反引号一出现，
       String.raw 模板当场截断，整个文件解析失败 —— 守卫根本跑不到。
       所以这条只能靠写的时候注意：**断言体（含注释）里一律不要写反引号**，
       需要围栏就用 String.fromCharCode(96) 拼。坏处是它会以 SyntaxError 的
       形式当场炸出来（响亮但难看），不会静默。 */
    /* 模板外一个 T/TA 都不该有。
       ⚠️ 这条守卫只覆盖「T( / TA( 写到了模板外」这一类 ——
       也就是本轮真踩的那一类（插到了 return JSON.stringify(R) 之后）。
       另一种绕过（模板外直接 results.push({ok:true})）源码形状与架构守卫
       完全一样，机器分不出来，只能靠人：写新断言一律用 T/TA，别手搓 results.push。 */
    results.push({
      name: '架构守卫：断言不许写在页内模板之外（否则静默不执行）',
      ok: outN === 0 && inN >= 200,
      info: `模板内 T/TA=${inN} · 模板外=${outN}`
        + (outN ? ' ← 这些断言不会被执行，自测会"假绿"' : '')
    });
  } catch (e) {
    results.push({ name: '架构守卫：断言都在模板内', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  /* 架构守卫：陪伴模式不许回来。
     它是早期的测试功能（写死两个角色 + 好感度 + 独立聊天页），
     v0.3.35 已整体移除，正式版不含任何相关内容。这条守卫的作用是：
     以后谁想「把那个功能捡回来」，或者从旧备份/旧分支里合错了代码，
     自测会立刻指出是哪一块回来了。
     查的是**源码文件**（页面 DOM 里查不到被删掉的 id，只能查文件）。 */
  try {
    const raw = fs.readFileSync(SRC, 'utf8');
    /* 只剥 HTML 注释里的说明文字，不剥 JS 注释 —— 这一节的说明本身会提到
       「陪伴模式」四个字，剥了注释反而查不出真残留。所以改成查**标识符**，
       不查中文词：中文只会出现在界面文案与注释里，标识符才代表活代码。 */
    const marks = {
      '代码块 COMPANIONS': /var COMPANIONS\s*=/,
      '好感度 AFF_LEVELS': /var AFF_LEVELS\s*=/,
      '状态入口 cpState()': /function cpState\s*\(/,
      '检索表 companionPrompt': /function companionPrompt\s*\(/,
      '页面 view-companion': /id="view-companion"/,
      '页面 view-cpchat': /id="view-cpchat"/,
      '样式 .cp-card': /\.cp-card\{/,
      '样式 #view-cpchat': /#view-cpchat/,
      '情景手机壳 .phone-shell': /\.phone-shell\{/,
      '弹层 cpsettings': /'cpsettings'/,
      '备份键 companion': /'companion'/,
      '好感度协议 companionScore': /companionScore/
    };
    const back = Object.keys(marks).filter(k => marks[k].test(raw));
    /* 同时确认删除后该有的东西还在（避免为了通过而粗暴删掉整块） */
    const alive = /function openPartners\s*\(/.test(raw) && /function addFocusMin\s*\(/.test(raw)
      && /function sysPrompt\s*\(/.test(raw) && /function openDocs\s*\(/.test(raw);
    results.push({
      name: '架构守卫：陪伴模式已彻底移除且不许回归',
      ok: back.length === 0 && alive,
      info: back.length ? ('仍然存在：' + back.join('、')) : '残留 0 处'
        + ` · 搭档/专注/提示词/资料库都还在=${alive}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：陪伴模式已移除', ok: false, info: 'THREW: ' + (e && e.message) });
  }

  let fail = 0;
  for (const t of results) {
    if (!t.ok) fail++;
    console.log((t.ok ? 'PASS  ' : 'FAIL  ') + t.name + (t.info ? '\n        ' + t.info : ''));
  }
  console.log('\n-- 页面运行期错误 --');
  console.log(events.length ? events.slice(0, 20).join('\n') : 'none');
  /* 架构守卫：资料库的存储桥。
     正文落在 App 私有目录（页面在 file:// 源下没有 IndexedDB，localStorage 只有 5MB），
     所以这条路跨了语言 —— 三件事必须机器对账，靠肉眼一定会漏：
       ① 页面 nat() 调的方法名 ⊆ NativeBridge 里 @JavascriptInterface 的方法名；
       ② 原生回调名 window.onDocStore 与 callbackDocStore 拼的字符串**逐字相同**；
       ③ 页面侧有对应的分发函数真接上了（有名字没人接 = 静默失败）。
     再加两条安全/健壮性：id 必须过白名单（防 ../ 越权），写入必须走临时文件再改名。 */
  try {
    const bridge = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/xuejing/app/NativeBridge.java'), 'utf8');
    const main = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/xuejing/app/MainActivity.java'), 'utf8');
    const store = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/xuejing/app/DocStore.java'), 'utf8');
    const page = fs.readFileSync(SRC, 'utf8');

    /* ① 桥方法名。只取 @JavascriptInterface 紧跟的那个 public 方法。 */
    const declared = new Set();
    for (const m of bridge.matchAll(/@JavascriptInterface\s+public\s+\w+\s+(\w+)\s*\(/g)) declared.add(m[1]);
    const docBridges = ['docSave', 'docLoad', 'docDel', 'docClear', 'docStat', 'docDump'];
    const missingBridge = docBridges.filter(n => !declared.has(n));
    /* 页面侧真的调了它们（否则 Java 里写了也是死代码） */
    const notCalled = docBridges.filter(n => !new RegExp("nat\\(\\s*'" + n + "'").test(page));

    /* ② 回调名对账：原生拼的字符串 ↔ 页面登记的名字，必须逐字相同。
       这条能抓住「改了一边忘了另一边」—— 而那类错误是完全静默的。 */
    const cbInJava = /window\.onDocStore/.test(main);
    const cbInPage = /window\.onDocStore\s*=\s*function/.test(page);
    /* ③ 页面侧按 id 派发的机制真的在（有名字没人接 = 回调石沉大海） */
    const fireWired = /var DOC_WAIT = \{\}/.test(page) && /function docFire\(/.test(page)
      && /docOnCb\(id, cb\)/.test(page);

    /* ④ DocStore 的两条硬要求 */
    /* id 白名单：只放行字母数字与 _ -，其余一律拒 —— 否则 id 传成 "../xxx"
       就能写到私有目录外面去（这个 id 有一部分来自文件名） */
    const safeId = /boolean safeId\(String id\)/.test(store)
      && /ch == '_' \|\| ch == '-'/.test(store);
    const tmpThenRename = /\.tmp/.test(store) && /renameTo\(f\)/.test(store);
    /* 大文件读要有上限：不能让一份被写坏的文件把内存吃穿 */
    const readCap = /MAX_READ/.test(store) && /Math\.min\(/.test(store);

    results.push({
      name: '架构守卫：资料库存储桥（跨语言对账 + 路径白名单 + 临时文件）',
      ok: !missingBridge.length && !notCalled.length && cbInJava && cbInPage
        && fireWired && safeId && tmpThenRename && readCap,
      info: `桥方法缺=${missingBridge.join(',') || 0} · 页面没调=${notCalled.join(',') || 0}`
        + ` · 原生回调名=${cbInJava} · 页面接收=${cbInPage} · 按id派发=${fireWired}`
        + ` · id白名单=${safeId} · 临时文件再改名=${tmpThenRename} · 读上限=${readCap}`
    });
  } catch (e) {
    results.push({ name: '架构守卫：资料库存储桥', ok: false, info: 'THREW: ' + (e && e.message) });
  }



  console.log('\n' + (fail ? fail + ' 项失败' : '全部通过') + ' / 共 ' + results.length + ' 项');
  cleanup();
  process.exit(fail ? 2 : 0);
} catch (e) {
  console.log('HARNESS ERROR: ' + (e && e.stack || e));
  cleanup();
  process.exit(3);
}
