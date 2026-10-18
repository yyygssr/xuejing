// 反向对照：把「这一轮修掉的每个坏味道」用一段注入的 <style> 放回去，
// 看新加的 computed-style 断言是不是真的会红 —— 只看不改真相文件，跑完自动还原。
// 用法：node tools/pro-ui/neg.mjs <case>      （然后自己跑 node tools/domtest.mjs）
// 还原：node tools/pro-ui/neg.mjs restore
//
// ⚠️ 注入写在 </head> 前的一段独立 <style> 里，不碰皮肤那段同步块，
//    这样「皮肤与源文件一致」这条守卫保持为真，红的就只能是我关心的那条表现断言。
import fs from 'fs';
const SRC = 'index.html';
const BAK = 'index.html.negbak';
const HEAD = '</head>';
const cases = {
  blur: 'html.ui-pro .msg.ai .bubble,html.ui-pro #chatInput,html.ui-pro .composer .icon-btn,'
      + 'html.ui-pro .segs,html.ui-pro .focusstats{backdrop-filter:none!important'
      + ';-webkit-backdrop-filter:none!important}',
  qsw: 'html.ui-pro .qswrow .qsw{background:var(--glass-strong)!important}',
  base: 'html.ui-pro #view-focus,html.ui-pro .view{background:rgba(var(--scrim-rgb),.58)!important}',
  anim: 'html.ui-pro .page{animation:fade .22s ease!important}',
  panel: 'html.ui-pro:not(.layout-tablet) .vpanel{background:var(--glass)!important;'
       + 'backdrop-filter:var(--blur)!important;-webkit-backdrop-filter:var(--blur)!important}',
  /* v0.3.0 真机第四轮：二级页那批面「半透明但不糊」 */
  faces: 'html.ui-pro .actlist,html.ui-pro .plan,html.ui-pro .empty,html.ui-pro .note-body,'
       + 'html.ui-pro .stat,html.ui-pro .n-card,html.ui-pro .sched-day:not(.today)'
       + '{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
  /* 皮肤同权重排在基础样式之后 → 「今天」的品牌浅底被玻璃洗掉 */
  today: 'html.ui-pro .sched-day{background:var(--glass)!important}',
  /* 把某一条玻璃面撤掉模糊 → 「皮肤巡检」这条整屏扫的守卫应该红（不靠点名） */
  ghost: 'html.ui-pro .btn.ghost{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
  /* 分隔线重新共用描边令牌 → 关掉高光描边时列表线一起没（v0.3.1 用户报） */
  edgediv: 'html.ui-pro .li,html.ui-pro .viewhead{border-bottom-color:var(--glass-line)!important}',
  /* 回到「续行写 border:0」的旧写法 → 用户点名的两处应该红 */
  nob: 'html.ui-pro .li.up,html.ui-pro .list .li.up{border-bottom:0!important}',
};
/* JS 侧的反面对照：函数都是全局 function 声明，后置脚本可以整体换掉。
   用来证明「解析器的断言是真的在量行为」，而不是碰巧为真。 */
const jsCases = {
  // 编码嗅探退回「只认 UTF-8」→ GBK 那条应该红
  enc: 'decodeTextSmart=function(u8){try{return new TextDecoder("utf-8",{fatal:true}).decode(u8)}catch(e){return ""}};',
  // 打包时段落跨表不分段 → xlsx「两张表名都在」应该红
  parts: 'packUnits=function(units,base){var ps=[],cur="",lab="";for(var i=0;i<units.length;i++){'
       + 'var u=units[i];if(cur&&(cur.length+u.text.length+1)>1100){ps.push({label:lab||base,text:cur});cur="";lab="";}'
       + 'if(!lab)lab=u.label||base||"段";cur=cur?cur+"\\n"+u.text:u.text;}if(cur)ps.push({label:lab||base,text:cur});'
       + 'ps.forEach(function(p,k){p.label=p.label+"（第 "+(k+1)+"/"+ps.length+" 段）"});return ps;};',
  // 失败分支不给说明 → 「如实报错」那条应该红
  silent: 'parseOfficeFile=async function(){return {ok:false};};',
  // ZIP 目录读不出来 → Office 三条全红
  zip: 'zipIndex=function(){return null;};',
  // 键盘弹起时的让位收掉规则被拿掉 → 「输入框贴着键盘」应该红
  kb: 'document.head.insertAdjacentHTML("beforeend",'
    + '"<style>html.ui-pro.kb-open:not(.layout-tablet) .screen,'
    + 'html.ui-pro.app-mode.kb-open:not(.layout-tablet) .screen{padding-bottom:96px!important}</style>");',
  /* 回到「菜单行的点击照样冒泡到点空白收起」→ 换个模型一点就消失 */
  menu: "bindMenuRows=function(box,items){if(!box)return;box.__menuItems=items;"
    + "if(box.__menuBound)return;box.__menuBound=1;"
    + "box.addEventListener('click',function(e){"
    + "var row=e.target&&e.target.closest?e.target.closest('.actrow'):null;if(!row)return;"
    + "var it=(box.__menuItems||[])[Number(row.getAttribute('data-mi'))];if(!it||!it.run)return;"
    + "try{(0,eval)(String(it.run))}catch(err){}})};",
  /* 把附件正文重新塞回气泡（= 拆分之前的写法） */
  leak: "attachBrief=function(){return ATTACH.length?'\\n'+(ATTACH[0].text||''):'';};",
  /* 历史与重新生成不再取 sendText → 追问/重生成都看不见文件 */
  sendtext: 'msgSendText=function(m){return (m&&m.t)||"";};',
};
if (process.argv[2] === 'restore') {
  if (!fs.existsSync(BAK)) { console.log('没有备份，无需还原'); process.exit(0); }
  fs.copyFileSync(BAK, SRC);
  fs.unlinkSync(BAK);
  console.log('已还原 index.html');
  process.exit(0);
}
const key = process.argv[2];
const css = cases[key], js = jsCases[key];
if (!css && !js) { console.log('unknown case：' + key); process.exit(9); }
const raw = fs.readFileSync(SRC, 'utf8');
if (raw.includes('反向对照注入')) { console.log('已有注入，先跑 restore'); process.exit(8); }
fs.copyFileSync(SRC, BAK);
const inj = css
  ? '<style>/* 反向对照注入 */' + css + '</style>\n' + HEAD
  : /* 放在 </body> 前：必须晚于应用自己的脚本，才能覆盖那些全局函数声明 */
    '<script>/* 反向对照注入 */' + js + '</scr' + 'ipt>\n</body>';
const out = css ? raw.replace(HEAD, inj) : raw.replace('</body>', inj);
if (out === raw) { console.log('注入锚点丢失'); fs.unlinkSync(BAK); process.exit(7); }
fs.writeFileSync(SRC, out);
console.log('已注入违规：' + key);
