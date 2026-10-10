package com.xuejing.app;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

/**
 * 专注计时前台服务。
 *
 * 存在的唯一理由：页面是 WebView，计时靠 JS 的 setInterval 驱动。
 * 一旦进程被系统回收，计时就断了。挂一个前台服务能把进程钉住，
 * 保证专注期间计时不丢、通知不倒计时错乱。
 *
 * ── 为什么这里要自己每秒刷新（v1.1.0）─────────────────────────────
 * 上岛之后，岛上的主显示位是**通知标题**，系统不会把 chronometer 渲染成胶囊里的数字，
 * 所以「专注计时在岛上不显示倒计时」的根因不是没给 chronometer，而是**标题里没有数字**。
 * 解法只能是让标题自己带着倒计时，那就得有人定期覆盖更新 —— 就是这个服务。
 *
 * ── v0.2.4 重构：计时权威移到原生 ──────────────────────────────────
 * 以前这里的全部状态是 static 字段且不落盘，计时走完只改一条通知、从不告诉页面，
 * 于是「通知栏跑完的专注，学径里统计是 0m」。
 *
 * 现在的分工：
 *   FocusStore（SharedPreferences）= 真相，进程死了也在；
 *   这里的 static 字段           = 内存缓存，只为了每秒算剩余时间不必读盘。
 * 规矩是**状态变更时先写盘再改缓存**，反过来会丢会话。
 *
 * 服务被杀后系统会用 null intent 重启（START_STICKY），这时不是重开一轮，
 * 而是把存档里没走完的会话接着跑 —— 所以 onStartCommand 里有恢复分支。
 *
 * ── 为什么结束时要通知页面 ──────────────────────────────────────────
 * 通知页面只是**加速**：Activity 还活着时立刻让统计 +1。
 * 页面没活也无所谓 —— 结果已经进了 FocusStore 的待记账队列，
 * 下次打开 App 时页面会自己拉（focusState）并补记。两条路都通向同一个结果。
 */
public class FocusService extends Service {

    private static final String EXTRA_ACTION = "action";
    private static final String EXTRA_LABEL = "label";
    private static final String EXTRA_SECS = "secs";

    private static final String A_START = "start";
    private static final String A_STOP = "stop";

    /** 页面每次开始/暂停都会重新下发这两个值，所以静态缓存足够用 */
    private static String sLabel = "自由专注";
    private static int sSecs = 1500;
    /** 计时是否在走；开关「灵动岛上岛」后要靠它决定要不要重发通知 */
    private static boolean sRunning = false;
    /** 走到什么时候结束（运行中有效） */
    private static long sEndAt = 0L;
    /** 本轮是不是正计时（dir=up）：正计时没有终点，不能做自然结束判定 */
    private static boolean sUp = false;

    private static final Handler H = new Handler(Looper.getMainLooper());
    private static Runnable sTick = null;
    private static int sLastShown = -1;

    /** 当前剩余秒数：运行中按结束时刻算，暂停时用最后一次算出来的冻结值 */
    static int remainSecs() {
        if (!sRunning) return Math.max(0, sSecs);
        long ms = sEndAt - System.currentTimeMillis();
        return (int) Math.max(0, (ms + 999) / 1000);
    }

    /** 上岛开关变了：把正在跑的计时通知重发一次，岛标志才会跟着更新 */
    static void refresh(Context c) {
        if (!sRunning) return;
        sLastShown = -1;
        post(c, Notify.buildFocus(c, sLabel, remainSecs(), true));
        startTick(c);
    }

    /**
     * 开一轮专注。
     *
     * 先落盘再起服务 —— 顺序不能反：服务起来了但存档还没写，
     * 进程恰好在这一瞬被杀，这轮专注就凭空消失了。
     */
    static void start(Context c, String label, int secs, String courseId, String mode, String dir) {
        JSONObject s = FocusStore.open(c, label, courseId, mode, dir, secs);
        sLabel = s.optString("label", "自由专注");
        sSecs = Math.max(1, secs);
        sRunning = true;
        sUp = "up".equals(dir);
        sEndAt = s.optLong("endAt", 0L);
        /* 正计时没有终点，给个兜底值，免得 remainSecs 算出负数 */
        if (sEndAt <= 0) sEndAt = System.currentTimeMillis() + sSecs * 1000L;
        Intent i = new Intent(c, FocusService.class);
        i.putExtra(EXTRA_ACTION, A_START)
         .putExtra(EXTRA_LABEL, sLabel)
         .putExtra(EXTRA_SECS, sSecs);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i);
            else c.startService(i);
        } catch (Throwable ignored) {
            /* 后台启动前台服务受限时不强求，退化成普通通知 */
            fallbackNotify(c, Notify.buildFocus(c, sLabel, sSecs, true));
            startTick(c);
        }
    }

    /** 便捷重载：没有课程绑定 / 模式信息时（预约上课、外部调用）走这个 */
    static void start(Context c, String label, int secs) {
        start(c, label, secs, "", "work", "down");
    }

    static void pause(Context c) {
        int remain = remainSecs();
        FocusStore.pause(c);
        sRunning = false;
        sSecs = Math.max(0, remain);
        sEndAt = 0L;
        stopTick();
        post(c, Notify.buildFocus(c, sLabel, sSecs, false));
        MainActivity.forwardFocusEvent("pause");
    }

    /** 从暂停恢复：把结束时刻往后推「暂停了多久」，否则暂停会白白吃掉倒计时 */
    static void resume(Context c) {
        FocusStore.resume(c);
        JSONObject cur = FocusStore.current(c);
        if (cur == null) return;
        sRunning = true;
        sUp = "up".equals(cur.optString("dir"));
        sEndAt = cur.optLong("endAt", 0L);
        if (sEndAt <= 0) sEndAt = System.currentTimeMillis() + Math.max(0, sSecs) * 1000L;
        sSecs = Math.max(0, (int) ((sEndAt - System.currentTimeMillis()) / 1000L));
        sLastShown = -1;
        post(c, Notify.buildFocus(c, sLabel, remainSecs(), true));
        startTick(c);
        MainActivity.forwardFocusEvent("resume");
    }

    /** 手动结束：正常记账 */
    static void stop(Context c) {
        FocusStore.finish(c, FocusStore.R_MANUAL);
        halt(c);
        MainActivity.forwardFocusEvent("end");
    }

    /** 结束但不记账（用户在提醒卡上点了「结束不记录」） */
    static void discard(Context c) {
        FocusStore.finish(c, FocusStore.R_DISCARD);
        halt(c);
        MainActivity.forwardFocusEvent("discard");
    }

    /** 收尾：停计时、撤通知、清缓存。不碰存档（finish 已经处理过） */
    private static void halt(Context c) {
        sRunning = false;
        sEndAt = 0L;
        stopTick();
        try {
            c.stopService(new Intent(c, FocusService.class));
        } catch (Throwable ignored) { }
        try {
            NotificationManagerCompat.from(c).cancel(Notify.ID_FOCUS);
        } catch (Throwable ignored) { }
    }

    private static void post(Context c, Notification n) {
        try {
            NotificationManagerCompat.from(c).notify(Notify.ID_FOCUS, n);
        } catch (Throwable ignored) { }
    }

    private static void fallbackNotify(Context c, Notification n) {
        try {
            Notify.ensureChannels(c);
            post(c, n);
        } catch (Throwable ignored) { }
    }

    /* ---------- 每秒刷新标题里的倒计时 ---------- */

    private static void startTick(final Context c) {
        if (sTick != null) return;
        final Context app = c.getApplicationContext();
        sTick = new Runnable() {
            @Override public void run() {
                if (!sRunning) { sTick = null; return; }
                /*
                 * 正计时（dir=up）没有终点：remainSecs() 对它恒返回 0，
                 * 不拦住的话第一秒就会被误判成「走完」。
                 * 目前页面已经不再产生 up 会话（上课专注 v1.1.0 起改成倒计时），
                 * 这里是防御性的 —— 哪天重新启用正计时也不会立刻炸。
                 */
                int remain = 0;
                if (!sUp) {
                    remain = remainSecs();
                    if (remain <= 0) {
                        /* 到点了：把最后一条改写成「专注完成」，然后停掉刷新 */
                        post(app, Notify.buildFocus(app, sLabel, 0, false));
                        sRunning = false;
                        sSecs = 0;
                        sTick = null;
                        /* 走完的这一轮要记账 —— 结果进待记账队列，页面下次打开时补上 */
                        FocusStore.finish(app, FocusStore.R_NATURAL);
                        MainActivity.forwardFocusEvent("end");
                        return;
                    }
                }
                /* 留「服务还活着」的证据：服务真被杀时，结算只算到这里，不虚增 */
                FocusStore.alive(app);
                if (remain != sLastShown) {
                    sLastShown = remain;
                    post(app, Notify.buildFocus(app, sLabel, remain, true));
                }
                H.postDelayed(this, 1000);
            }
        };
        H.postDelayed(sTick, 1000);
    }

    private static void stopTick() {
        if (sTick != null) H.removeCallbacks(sTick);
        sTick = null;
        sLastShown = -1;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notify.ensureChannels(this);

        /* 服务被杀后系统会用 null intent 重启（START_STICKY）。
           这不是新的一轮，要把存档里没走完的会话接着跑。 */
        if (intent == null) {
            JSONObject cur = FocusStore.current(this);
            if (cur == null || !FocusStore.ST_RUNNING.equals(cur.optString("state"))) {
                stopSelf();
                return START_NOT_STICKY;
            }
            sLabel = cur.optString("label", "自由专注");
            sSecs = cur.optInt("totalSecs", 1500);
            sUp = "up".equals(cur.optString("dir"));
            sEndAt = cur.optLong("endAt", 0L);
            /* 倒计时必须有终点；正计时允许 endAt=0（它本来就没有终点） */
            if (sEndAt <= 0 && !sUp) { stopSelf(); return START_NOT_STICKY; }
            sRunning = true;
            sLastShown = -1;
            if (!raiseForeground(Notify.buildFocus(this, sLabel, remainSecs(), true))) {
                stopSelf();
                return START_NOT_STICKY;
            }
            startTick(this);
            return START_STICKY;
        }

        String action = intent.getStringExtra(EXTRA_ACTION);
        if (action == null) action = A_START;
        if (A_STOP.equals(action)) {
            stop(this);
            return START_NOT_STICKY;
        }

        String label = intent.getStringExtra(EXTRA_LABEL);
        int secs = intent.getIntExtra(EXTRA_SECS, sSecs);
        if (label != null && !label.trim().isEmpty()) sLabel = label;
        /*
         * 注意：这里不再自己算 sEndAt。
         * 会话是 start() 里 FocusStore.open() 建的，endAt 以存档为准 ——
         * 自己再算一遍就有两个真相来源，服务重启后会算出一个不一样的终点。
         */
        JSONObject cur = FocusStore.current(this);
        if (cur != null) {
            sEndAt = cur.optLong("endAt", 0L);
            sSecs = cur.optInt("totalSecs", secs);
        } else if (secs > 0) {
            /* 存档意外丢失（极端情况）：退化成旧行为，至少通知还能走 */
            sSecs = secs;
            sEndAt = System.currentTimeMillis() + secs * 1000L;
        }
        sRunning = true;

        if (!raiseForeground(Notify.buildFocus(this, sLabel, remainSecs(), true))) {
            stopSelf();
            return START_NOT_STICKY;
        }
        sLastShown = remainSecs();
        startTick(this);
        return START_STICKY;
    }

    /** 提前台；被系统拒绝时退化成普通常驻通知并返回 false */
    private boolean raiseForeground(Notification n) {
        try {
            // 只有 Android 14+ 需要（也必须）声明类型；低版本用不带类型的重载更稳
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(Notify.ID_FOCUS, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(Notify.ID_FOCUS, n);
            }
            return true;
        } catch (Throwable t) {
            /* 前台服务被系统拒绝（缺权限 / 厂商限制）：退化成普通常驻通知，功能不受影响 */
            fallbackNotify(this, n);
            return false;
        }
    }

    @Override
    public void onDestroy() {
        stopTick();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Throwable ignored) { }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
