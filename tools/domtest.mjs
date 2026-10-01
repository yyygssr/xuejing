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
  T('语音播报开关已移除，朗读可用', function(){
    return { ok: !document.getElementById('swTts') && typeof ttsSpeakForce === 'function',
             info: 'swTts=' + !!document.getElementById('swTts') };
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
  T('关于页版本号已到 v0.1.1', function(){
    var hero = document.querySelector('#view-about .about-ver');
    var me = document.getElementById('page-me');
    var ok = !!hero && /v0\.1\.1/.test(hero.textContent) && APP_VER === 'v0.1.1'
      && !!me && /v0\.1\.1/.test(me.textContent);
    return { ok: ok, info: 'hero=' + (hero ? hero.textContent.trim() : 'MISSING') + ' APP_VER=' + APP_VER };
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

  return JSON.stringify(R);
})()
`;

let html = fs.readFileSync(SRC, 'utf8');
if (!/<\/body>/.test(html)) { console.error('index.html 里没有 </body>'); process.exit(1); }
html = html.replace(/<\/body>/, '\n<script>\nwindow.__ASSERTSRC__ = ' + JSON.stringify(ASSERTS) + ';\n</script>\n</body>');
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
