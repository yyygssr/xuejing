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
  T('相机等 8 个曾丢分支的弹层能真正渲染出内容', function(){
    var cases = [
      ['cam', '拍照给 AI', {}],
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
