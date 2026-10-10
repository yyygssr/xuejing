package com.xuejing.app;

import android.webkit.JavascriptInterface;

import org.json.JSONObject;

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

    /**
     * 开始专注（v0.2.4：计时权威在原生，参数变三个）。
     *
     * @param opts JSON：{courseId, mode:work|short|long, dir:down|up}，可空。
     *             mode 决定这一轮记不记番茄数，courseId 决定要不要累加到课程上 ——
     *             两个值必须随会话一起落盘，否则页面下次打开补记时不知道该记到哪。
     *
     * 加参数要两边一起改：页面侧 nat('startFocus', label, secs, opts) 必须传满四个。
     */
    @JavascriptInterface
    public void startFocus(String label, String secs, String opts) {
        String courseId = "", mode = "work", dir = "down";
        try {
            if (opts != null && !opts.trim().isEmpty()) {
                JSONObject o = new JSONObject(opts);
                courseId = o.optString("courseId", "");
                String m = o.optString("mode", "work");
                if ("work".equals(m) || "short".equals(m) || "long".equals(m)) mode = m;
                if ("up".equals(o.optString("dir", "down"))) dir = "up";
            }
        } catch (Throwable ignored) { }
        FocusService.start(act, label, NativeBridge.parseInt(secs, 1500), courseId, mode, dir);
    }

    @JavascriptInterface
    public void pauseFocus() {
        FocusService.pause(act);
    }

    /** 从暂停恢复 */
    @JavascriptInterface
    public void resumeFocus() {
        FocusService.resume(act);
    }

    /** 延长当前这一轮（秒）：结束时刻一起往后推，否则通知上的倒计时不会变 */
    @JavascriptInterface
    public void extendFocus(String secs) {
        FocusStore.extend(act, NativeBridge.parseInt(secs, 0));
    }

    @JavascriptInterface
    public void stopFocus() {
        FocusService.stop(act);
    }

    /** 结束但不记账（提醒卡上的「结束不记录」） */
    @JavascriptInterface
    public void discardFocus() {
        FocusService.discard(act);
    }

    /**
     * 拉专注状态快照 —— 原生 → 页面**唯一**的批量通道（v0.2.4 新增）。
     *
     * 页面启动时、回到前台时各调一次：
     *   · hasSession / running / paused / endAt —— 恢复 UI 并接着倒计时；
     *   · pending[] —— 已经跑完但还没记账的轮次，页面补记后调 focusAck 回执。
     *
     * 秒级倒计时不走这里（太费电）：页面拿到 endAt 后自己按时间戳推算。
     */
    @JavascriptInterface
    public String focusState() {
        return FocusStore.stateJson(act);
    }

    /**
     * 待记账记录的消费回执：传 id 数组 JSON，按 id 幂等。
     * 页面必须先真的写进统计再 ack —— 反过来会永久丢一轮专注。
     */
    @JavascriptInterface
    public void focusAck(String idsJson) {
        FocusStore.ack(act, idsJson);
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
     * 设备与 WebView 信息（JSON），供「关于 → 运行日志」生成问题报告。
     * 用户提 Issue 时最缺的就是环境信息：机型、系统版本、WebView 版本。
     * 全部由原生给出 —— 页面里 navigator.userAgent 拿不到内核真实版本。
     */
    @JavascriptInterface
    public String deviceInfo() {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"model\":").append(MainActivity.jsString(
                        String.valueOf(android.os.Build.MANUFACTURER) + " "
                                + String.valueOf(android.os.Build.MODEL)))
          .append(",\"android\":").append(MainActivity.jsString(
                        String.valueOf(android.os.Build.VERSION.RELEASE)))
          .append(",\"sdk\":").append(android.os.Build.VERSION.SDK_INT)
          .append(",\"abi\":").append(MainActivity.jsString(
                        String.valueOf(android.os.Build.SUPPORTED_ABIS != null
                                && android.os.Build.SUPPORTED_ABIS.length > 0
                                ? android.os.Build.SUPPORTED_ABIS[0] : "?")))
          .append(",\"webview\":").append(MainActivity.jsString(act.webviewVersion()))
          .append("}");
        return sb.toString();
    }

    /**
     * PDF 逐页转成图片，结果由 window.onPdfPreview({pages, more, err}) 接收。
     *
     * 走这条路而不是在前端解析，是因为：① 视觉模型的接口只收图片，
     * 不收 PDF 二进制；② 本项目零外部依赖（没有 pdf.js），
     * 而系统自带的 PdfRenderer（API 21+）就能做，不需要引库。
     *
     * 故意不声明成同步返回：渲染一页可能要几百毫秒，
     * 同步会卡住 WebView 的 JS 线程（页面会假死一瞬）。
     */
    @JavascriptInterface
    public void pdfPreview(final String b64, final int maxPages) {
        if (!PdfPreview.supported()) {
            sendPdfResult(new PdfPreview.Result(null, false,
                    "这台设备的系统版本太老（Android 5.0 以下），做不了 PDF 转图"));
            return;
        }
        PdfPreview.render(act, b64, maxPages, new PdfPreview.Callback() {
            @Override
            public void onDone(final PdfPreview.Result r) {
                sendPdfResult(r);
            }
        });
    }

    private void sendPdfResult(final PdfPreview.Result r) {
        final String js = "window.onPdfPreview && window.onPdfPreview("
                + PdfPreview.toJsArgs(r) + ")";
        MainActivity.execOnMain(act, js);
    }

    /** 精确闹钟授权状态（JSON）：sdk / canExact。
     * 没有这个授权时，排下去的课表提醒会退化成系统的宽窗口非精确闹钟，
     * 在 Doze 里可能晚十几分钟 —— 用户感受到的就是「到时间提醒不及时」。
     */
    @JavascriptInterface
    public String exactAlarmState() {
        return "{\"sdk\":" + android.os.Build.VERSION.SDK_INT
                + ",\"canExact\":" + ReminderScheduler.canExact(act) + "}";
    }

    /* ================= 语音播报（系统 TTS） =================
       页面原来的 speechSynthesis 在 Android WebView 上不可靠：音色列表异步才到、
       失败不回调。现在改走原生 TextToSpeech，失败原因由这里如实回吐。 */

    /**
     * 启动引擎初始化。**一律返回 1**（去建引擎），结果由 window.onTtsEvent 回报。
     *
     * <p>曾经在这里用 {@code queryIntentServices(TTS_SERVICE)} 先判「有没有引擎」，
     * 空的就直接告诉用户「系统里没有安装任何语音引擎」。结果在小米手机上被系统骗了 ——
     * 明明有「系统语音引擎」，但 Android 11+ 的包可见性过滤让它查不到（除非在
     * AndroidManifest 的 {@code <queries>} 里声明 TTS_SERVICE，已补）。
     * 而且厂商 ROM 对这个查询还有各种偏差。
     *
     * <p>结论：<strong>唯一可信的判据是 TextToSpeech 构造后的 onInit 回调</strong>。
     * 所以这里不再预判，直接建引擎，让 onInit 说真话。
     */
    @JavascriptInterface
    public int ttsInit() {
        final Tts t = Tts.get(act);
        t.init(new Tts.InitCB() {
            @Override
            public void onResult(final boolean ok, final String engine, final String error) {
                final String js = "window.onTtsEvent && window.onTtsEvent({t:"
                        + MainActivity.jsString(ok ? "ready" : "error")
                        + ",id:'',d:" + MainActivity.jsString(ok ? engine : error) + "})";
                MainActivity.execOnMain(act, js);
            }
        });
        return 1;
    }

    /**
     * 本机**可见**的 TTS 引擎列表（JSON 数组，元素是引擎包名）。
     * 纯诊断用：出问题时能分清「一个都看不到」（可见性/ROM 问题）和
     * 「能看到但初始化失败」（引擎本身坏了）—— 这两种的解法完全不同。
     */
    @JavascriptInterface
    public String ttsEngines() {
        return Tts.visibleEnginesJson(act);
    }

    /** 朗读。返回空串 = 已提交；返回非空 = 失败原因（直接显示给用户，别再吞掉）。 */
    @JavascriptInterface
    public String ttsSpeak(String text, String voiceId, float rate, float pitch) {
        return Tts.get(act).speak(text, voiceId, rate, pitch);
    }

    @JavascriptInterface
    public void ttsStop() {
        Tts.get(act).stop();
    }

    /** 音色列表 JSON 数组（引擎未就绪时是空数组） */
    @JavascriptInterface
    public String ttsVoices() {
        return Tts.get(act).voicesJson();
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

    /** 导出纯文本（笔记的「导出为文字」）：与备份同一条路，MIME 换成 text/plain */
    @JavascriptInterface
    public void saveText(String name, String text) {
        act.saveText(name, text);
    }

    /** 导出图片（笔记的「导出为图片」）：页面传 dataURL，原生剥前缀解码后写盘 */
    @JavascriptInterface
    public void saveImage(String name, String dataUrl) {
        act.saveImage(name, dataUrl);
    }

    /** 系统分享纯文本 */
    @JavascriptInterface
    public void shareText(String text) {
        act.shareText(text);
    }

    /** 系统分享图片（写进 cache/share，再经 FileProvider 交给分享面板） */
    @JavascriptInterface
    public void shareImage(String name, String dataUrl) {
        act.shareImage(name, dataUrl);
    }

    static int parseInt(String s, int def) {
        try {
            return Integer.parseInt(String.valueOf(s).trim());
        } catch (Exception e) {
            return def;
        }
    }
}
