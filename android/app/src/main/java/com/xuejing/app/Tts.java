package com.xuejing.app;

import android.content.Context;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 系统语音合成（android.speech.tts.TextToSpeech）。
 *
 * <p>为什么不用 WebView 的 {@code speechSynthesis}：
 * <ul>
 *   <li>它的 {@code getVoices()} 首次调用<strong>同步返回空数组</strong>，要等
 *       {@code voiceschanged} 事件才有内容。页面拿不到事件就永远选不到音色。</li>
 *   <li>设备没装 TTS 引擎时 {@code speak()} <strong>静默失败</strong>，不抛错、不回调 ——
 *       用户只看到「没声音」，完全不知道原因。</li>
 *   <li>它在不同 WebView 版本与厂商 ROM 上行为不一致，属于不可控路径。</li>
 * </ul>
 *
 * <p>原生 TextToSpeech 是 Android 上真正可控的那条路：能枚举音色、能拿到初始化结果、
 * 能回报每次朗读的开始/完成/失败。页面侧改成「原生为主、WebView 兜底」，
 * 并且每条失败都把原因告诉用户，不再静默。
 *
 * <p>生命周期：单例，随 Application 存活。{@code shutdown()} 只在进程结束时才需要，
 * 这里不主动调 —— 朗读是低频操作，反复重建引擎反而更慢更容易失败。
 */
public class Tts {

    private static Tts inst;

    private final Context appCtx;
    private TextToSpeech tts;
    private boolean inited = false;
    private boolean ready = false;
    private int initSeq = 0;              // 防止过期回调把状态改回去
    private String lastError = "";

    /** 主动 stop() 时，用来把 onDone 区分成「被停掉」而不是「读完」 */
    private boolean stopping = false;

    public interface InitCB {
        void onResult(boolean ok, String engine, String error);
    }

    private InitCB initCB;

    private Tts(Context c) {
        this.appCtx = c.getApplicationContext();
    }

    public static synchronized Tts get(Context c) {
        if (inst == null) inst = new Tts(c);
        return inst;
    }

    /**
     * 本机「可见」的 TTS 引擎包名列表（JSON 数组）。
     *
     * <p><b>只用于诊断</b>，不要拿它当「有没有引擎」的判据 ——
     * Android 11+ 的包可见性过滤、以及各家 ROM 的实现差异，都可能让它返回空
     * 而引擎其实可用（项目里就踩过：小米明明装了系统语音引擎，这里却返回空）。
     * 真正的判据只有 {@link #init} 的 onInit 回调。
     */
    public static String visibleEnginesJson(Context c) {
        List<String> out = new ArrayList<>();
        try {
            java.util.List<android.content.pm.ResolveInfo> rs = c.getPackageManager()
                    .queryIntentServices(
                            new android.content.Intent("android.intent.action.TTS_SERVICE"), 0);
            if (rs != null) {
                for (android.content.pm.ResolveInfo ri : rs) {
                    if (ri != null && ri.serviceInfo != null
                            && !out.contains(ri.serviceInfo.packageName)) {
                        out.add(ri.serviceInfo.packageName);
                    }
                }
            }
        } catch (Throwable ignored) { }
        List<String> quoted = new ArrayList<>();
        for (String s : out) quoted.add(MainActivity.jsString(s));
        return "[" + String.join(",", quoted) + "]";
    }

    /**
     * 初始化引擎。可重复调用：已在 ready 状态时立刻回调，不重复建引擎。
     *
     * @param cb 初始化结果回调（ok / 引擎名 / 失败原因）
     */
    public synchronized void init(final InitCB cb) {
        if (ready) {
            if (cb != null) cb.onResult(true, engineName(), "");
            return;
        }
        if (tts != null) {
            /* 还在初始化中：把这次的回调挂上，等同一个结果，不要再建一个引擎 */
            if (cb != null) initCB = cb;
            return;
        }
        initCB = cb;
        final int seq = ++initSeq;
        try {
            /* 第三个参数是**引擎包名**（String），传 null = 用系统默认引擎。
               曾经这里传了 Context，编译直接失败 —— 三个参数的版本不是「多传个 context」。 */
            tts = new TextToSpeech(appCtx, new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    boolean ok = (status == TextToSpeech.SUCCESS);
                    String why = "";
                    if (!ok) {
                        /* 措辞要能直接指路。这个失败其实很常见：
                           系统里有引擎但「首选引擎」被禁用、或引擎装了没下中文语音包，
                           都会走到这里 —— 只说「没装引擎」会把人引到错误的解法上。 */
                        why = "语音引擎初始化失败（状态码 " + status + "）。"
                                + "系统里可能没有可用的 TTS 引擎，或「首选引擎」被禁用、"
                                + "或引擎装了但没下载中文语音包。请到「设置 → 系统 → 语言和输入法 → 文字转语音」"
                                + "里确认首选引擎可用并已下载中文语音包。";
                    }
                    handleInit(seq, ok, why);
                }
            }, null);
            if (tts != null) {
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { emitEvent("start", id, ""); }
                    @Override public void onDone(String id) {
                        emitEvent(stopping ? "cancel" : "done", id, "");
                        stopping = false;
                    }
                    @Override public void onError(String id) {
                        /* onError 之后不会再回调 onDone，标志位要在这里清掉 */
                        emitEvent("error", id, ttsErrorText());
                        stopping = false;
                    }
                    @Override public void onError(String id, int errorCode) {
                        emitEvent("error", id, "引擎错误码 " + errorCode + "（" + ttsErrorText() + "）");
                        stopping = false;
                    }
                });
            }
        } catch (Throwable t) {
            handleInit(seq, false, "无法创建语音引擎：" + t.getMessage());
        }
    }

    private synchronized void handleInit(int seq, boolean ok, String why) {
        if (seq != initSeq) return;            /* 过期回调，直接丢 */
        ready = ok;
        lastError = why;
        if (ok) {
            try {
                /* 中文优先；设备只装了别的语言时也能用，只是发音会怪 */
                int r = tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
                if (r == TextToSpeech.LANG_MISSING_DATA
                        || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                    tts.setLanguage(Locale.getDefault());
                }
            } catch (Throwable ignored) { }
        }
        InitCB cb = initCB;
        initCB = null;
        if (cb != null) cb.onResult(ok, engineName(), why);
    }

    private String ttsErrorText() {
        try {
            if (tts == null) return "引擎未就绪";
            int r = tts.speak("", TextToSpeech.QUEUE_FLUSH, null, "probe");
            tts.stop();
            return (r == TextToSpeech.SUCCESS) ? "" : "引擎拒绝播放（错误码 " + r + "）";
        } catch (Throwable t) {
            return "引擎异常：" + t.getMessage();
        }
    }

    public synchronized String engineName() {
        if (tts == null) return "";
        try {
            String n = tts.getDefaultEngine();
            return n == null ? "" : n;
        } catch (Throwable t) {
            return "";
        }
    }

    /**
     * 可用音色列表（JSON 数组）。字段 id / name / lang。
     * 页面拿不到原生枚举时才会退回 WebView 那条路。
     */
    public synchronized String voicesJson() {
        List<String> out = new ArrayList<>();
        try {
            if (tts != null) {
                if (android.os.Build.VERSION.SDK_INT >= 21) {
                    for (Voice v : tts.getVoices()) {
                        if (v == null) continue;
                        out.add("{\"id\":" + MainActivity.jsString(v.getName())
                                + ",\"name\":" + MainActivity.jsString(displayName(v))
                                + ",\"lang\":" + MainActivity.jsString(
                                        v.getLocale() == null ? "" : v.getLocale().toLanguageTag())
                                + "}");
                    }
                }
            }
        } catch (Throwable ignored) { }
        return "[" + String.join(",", out) + "]";
    }

    private String displayName(Voice v) {
        try {
            /* getFeatures() 返回 Set<String>，不是 Bundle —— 按 key 判断即可。
               标注「需联网 / 离线可用」比光给一串音色 id 有用得多：决定它能不能离线用。 */
            java.util.Set<String> fs = v.getFeatures();
            if (fs != null && fs.contains(TextToSpeech.Engine.KEY_FEATURE_NETWORK_SYNTHESIS)) {
                return v.getName() + "（需联网）";
            }
            if (fs != null && fs.contains(TextToSpeech.Engine.KEY_FEATURE_EMBEDDED_SYNTHESIS)) {
                return v.getName() + "（离线可用）";
            }
        } catch (Throwable ignored) { }
        return v.getName();
    }

    /**
     * 朗读。voiceId 传空表示用引擎默认音色。
     *
     * @return 错误原因；空串表示已成功提交
     */
    public synchronized String speak(String text, String voiceId, float rate, float pitch) {
        text = text == null ? "" : text.trim();
        if (text.isEmpty()) return "没有可朗读的内容";
        if (tts == null) return "语音引擎还没初始化完成";
        if (!ready) return lastError.isEmpty() ? "语音引擎不可用" : lastError;
        try {
            if (voiceId != null && !voiceId.isEmpty()
                    && android.os.Build.VERSION.SDK_INT >= 21) {
                for (Voice v : tts.getVoices()) {
                    if (v != null && voiceId.equals(v.getName())) { tts.setVoice(v); break; }
                }
            }
            /* 语速/音调都夹一下：越过区间会让部分引擎直接静默失败 */
            tts.setSpeechRate(clamp(rate, 0.3f, 2.5f, 1.0f));
            tts.setPitch(clamp(pitch, 0.4f, 2.0f, 1.0f));
            stopping = false;
            int r = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "xuejing_tts");
            if (r != TextToSpeech.SUCCESS) {
                return "引擎拒绝播放（错误码 " + r + "）。换个别音色试试，或到系统设置里重装语音引擎。";
            }
            return "";
        } catch (Throwable t) {
            return "朗读失败：" + t.getMessage();
        }
    }

    private float clamp(float v, float lo, float hi, float def) {
        if (Float.isNaN(v) || v <= 0) return def;
        return Math.max(lo, Math.min(hi, v));
    }

    public synchronized void stop() {
        try {
            stopping = true;
            if (tts != null) tts.stop();
        } catch (Throwable ignored) { }
    }

    /* 生命周期回调：告诉页面引擎出了什么事，页面据此提示用户 */
    private void emitEvent(String type, String id, String detail) {
        try {
            final String js = "window.onTtsEvent && window.onTtsEvent({t:"
                    + MainActivity.jsString(type)
                    + ",id:" + MainActivity.jsString(id == null ? "" : id)
                    + ",d:" + MainActivity.jsString(detail == null ? "" : detail) + "})";
            MainActivity.execOnMain(appCtx, js);
        } catch (Throwable ignored) { }
    }
}
