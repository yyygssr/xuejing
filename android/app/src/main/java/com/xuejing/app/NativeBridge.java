package com.xuejing.app;

import android.webkit.JavascriptInterface;

/**
 * 页面 → 原生的唯一通道。
 *
 * 两条约定：
 * 1. @JavascriptInterface 的形参只可靠地支持 String（跨语言传 boolean / number
 *    容易踩隐式转换的坑），所以页面侧统一把参数转成字符串再传进来。
 * 2. 方法名与「页面侧 nat() 的调用名字」一一对应 —— nat() 会按实际参数个数调用，
 *    所以这里的签名必须和调用处传的参数个数一致，加参数要两边一起改。
 */
public class NativeBridge {

    private final MainActivity act;

    NativeBridge(MainActivity activity) {
        this.act = activity;
    }

    /** 页面每次导航都同步一次「还有没有可返回的层」；返回手势靠它做同步判定 */
    @JavascriptInterface
    public void setBackLayer(String layer) {
        act.onBackLayer(layer);
    }

    /** 设置项（JSON），用于重排上课提醒 */
    @JavascriptInterface
    public void setPrefs(String json) {
        act.prefsJson = json;
        ReminderScheduler.reschedule(act, act.scheduleJson, json);
    }

    /** 课表（JSON），用于安排上课 / 下课提醒 */
    @JavascriptInterface
    public void setSchedule(String json) {
        act.scheduleJson = json;
        ReminderScheduler.reschedule(act, json, act.prefsJson);
    }

    /** 开始专注：通知栏用系统 chronometer 自己走，所以只要给一次时长 */
    @JavascriptInterface
    public void startFocus(String label, String secs) {
        FocusService.start(act, label, NativeBridge.parseInt(secs, 1500));
    }

    @JavascriptInterface
    public void pauseFocus() {
        FocusService.pause(act);
    }

    @JavascriptInterface
    public void stopFocus() {
        FocusService.stop(act);
    }

    @JavascriptInterface
    public void testNotify() {
        Notify.test(act);
    }

    @JavascriptInterface
    public void requestNotifPermission() {
        act.askNotificationPermission();
    }

    @JavascriptInterface
    public void setDarkMode(String dark) {
        act.applyDarkMode("1".equals(dark));
    }

    /** 是否启用厂商「上岛」extras（小米焦点 / OPPO 实况窗标记） */
    @JavascriptInterface
    public void setIslandOn(String on) {
        act.setIslandEnabled("1".equals(on));
    }

    /** 机型名，便于页面展示「上岛」在当前设备上的支持情况 */
    @JavascriptInterface
    public String vendorName() {
        return Notify.vendorName();
    }

    /**
     * 上岛能力状态（JSON）：sdk / supported / granted / vendor。
     * 设置页据此告诉用户「这机器到底能不能上岛」，避免开关开了却看不到效果
     * 还以为是坏了 —— Android 15 以下本来就不会上岛。
     */
    @JavascriptInterface
    public String islandState() {
        return Island.state(act);
    }

    /**
     * 精确闹钟授权状态（JSON）：sdk / canExact。
     * 没有这个授权时，排下去的课表提醒会退化成系统的宽窗口非精确闹钟，
     * 在 Doze 里可能晚十几分钟 —— 用户感受到的就是「到时间提醒不及时」。
     */
    @JavascriptInterface
    public String exactAlarmState() {
        return "{\"sdk\":" + android.os.Build.VERSION.SDK_INT
                + ",\"canExact\":" + ReminderScheduler.canExact(act) + "}";
    }

    /** 跳到系统「闹钟和提醒」授权页（Android 12/12L 必须用户手动开） */
    @JavascriptInterface
    public void requestExactAlarm() {
        act.openExactAlarmSettings();
    }

    /** 跳到本应用的系统设置页（厂商自启动 / 后台省电策略都在这一页附近） */
    @JavascriptInterface
    public void openAppSettings() {
        act.openAppSettings();
    }

    /**
     * 拉取服务商的模型列表（/models）。
     * 结果异步回到页面的 window.onModelsFetched(ok, payload)。
     * 放原生做的原因见 MainActivity#fetchModels —— 一句话：file:// 页面跨域会被拦。
     */
    @JavascriptInterface
    public void fetchModels(String url, String key) {
        act.fetchModels(url, key);
    }

    /**
     * 读系统日历里的法定节假日。start/end 形如 2026-01-01。
     * 结果通过 window.onHolidaysFetched(ok, payload) 回页面，
     * payload 是 JSON 数组 [{"date":"2026-10-01","name":"国庆节"}, ...]。
     */
    @JavascriptInterface
    public void fetchHolidays(String start, String end) {
        act.fetchHolidays(start, end);
    }

    /**
     * 通用模型调用入口。页面把完整请求体（JSON 字符串）组装好传进来，
     * 原生发 POST 并把响应体原样回吐到 window.onAiResult(ok, payload)。
     */
    @JavascriptInterface
    public void aiPost(String url, String apiKey, String bodyJson) {
        act.aiPost(url, apiKey, bodyJson);
    }

    /**
     * 流式版本（SSE）。增量通过 window.onAiStreamDelta(kind, text) 边收边推，
     * 结束时仍以 window.onAiResult(ok, payload) 回一份**和整包格式相同**的响应 ——
     * 页面侧解析逻辑只保持一份，流式只是让首字早点出来的加速通道。
     */
    @JavascriptInterface
    public void aiPostStream(String url, String apiKey, String bodyJson) {
        act.aiPostStream(url, apiKey, bodyJson);
    }

    /**
     * 通用 GET（小爱课表等跨域抓取）。结果回 window.onHttpGet(id, ok, body)。
     */
    @JavascriptInterface
    public void httpGet(String id, String url, String referer) {
        act.httpGet(id == null ? "" : id, url, referer);
    }

    /** 上课专注期间尝试静音 / 恢复（1=静音 0=恢复） */
    @JavascriptInterface
    public void setClassMute(String on) {
        act.setClassMute("1".equals(on));
    }

    /** 刷新桌面小组件（下一节课 / 待办 / 专注） */
    @JavascriptInterface
    public void updateWidgets(String json) {
        act.updateWidgets(json);
    }

    /** 模型 TTS：POST 后把音频写到 cache，回吐 file:// 路径 */
    @JavascriptInterface
    public void aiTts(String url, String apiKey, String bodyJson) {
        act.aiTts(url, apiKey, bodyJson);
    }

    /** 复制文本到系统剪贴板（日志面板的「复制全部」用） */
    @JavascriptInterface
    public void copyText(String text) {
        act.copyText(text);
    }

    /** 用系统浏览器打开 http(s) 链接（对话里 Markdown 链接用）。返回是否成功。 */
    @JavascriptInterface
    public boolean openUrl(String url) {
        return act.openUrl(url);
    }

    /**
     * 导出备份。页面把 JSON 文本整串传进来，原生用「新建文档」让用户挑保存位置。
     * WebView 里 &lt;a download&gt; + blob 是下载不下来的，只能走这条路。
     */
    @JavascriptInterface
    public void saveBackup(String name, String text) {
        act.saveBackup(name, text);
    }

    static int parseInt(String s, int def) {
        try {
            return Integer.parseInt(String.valueOf(s).trim());
        } catch (Exception e) {
            return def;
        }
    }
}
