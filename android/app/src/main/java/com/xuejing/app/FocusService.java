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
 * 计时基准取**结束时刻的时间戳**（sEndAt）而不是每秒自减：
 * 进程被冻结、CPU 睡一会儿再醒来时，算出来的剩余时间依然是对的，
 * 不会像自减那样越走越慢。
 *
 * 剩余时间的口径：页面在开始/暂停时把秒数传下来，中途不再同步。
 * 所以对外只提供两个动作（开始 / 暂停），暂停时由本服务自己算出冻结值。
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

    static void start(Context c, String label, int secs) {
        sLabel = (label == null || label.trim().isEmpty()) ? "自由专注" : label.trim();
        sSecs = Math.max(1, secs);
        sRunning = true;
        sEndAt = System.currentTimeMillis() + sSecs * 1000L;
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

    static void pause(Context c) {
        int remain = remainSecs();
        sRunning = false;
        sSecs = Math.max(0, remain);
        sEndAt = 0L;
        stopTick();
        post(c, Notify.buildFocus(c, sLabel, sSecs, false));
    }

    static void stop(Context c) {
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
                int remain = remainSecs();
                if (remain <= 0) {
                    /* 到点了：把最后一条改写成「专注完成」，然后停掉刷新 */
                    post(app, Notify.buildFocus(app, sLabel, 0, false));
                    sRunning = false;
                    sSecs = 0;
                    sTick = null;
                    return;
                }
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
        String action = intent == null ? A_START : intent.getStringExtra(EXTRA_ACTION);
        if (action == null) action = A_START;

        if (A_STOP.equals(action)) {
            stop(this);
            return START_NOT_STICKY;
        }

        sRunning = true;

        String label = intent != null ? intent.getStringExtra(EXTRA_LABEL) : sLabel;
        int secs = intent != null ? intent.getIntExtra(EXTRA_SECS, sSecs) : sSecs;
        if (label != null && !label.trim().isEmpty()) sLabel = label;
        if (secs > 0) {
            sSecs = secs;
            sEndAt = System.currentTimeMillis() + secs * 1000L;
        }

        Notification n = Notify.buildFocus(this, sLabel, remainSecs(), true);
        try {
            // 只有 Android 14+ 需要（也必须）声明类型；低版本用不带类型的重载更稳
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(Notify.ID_FOCUS, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(Notify.ID_FOCUS, n);
            }
        } catch (Throwable t) {
            /* 前台服务被系统拒绝（缺权限 / 厂商限制）：退化成普通常驻通知，功能不受影响 */
            fallbackNotify(this, n);
            stopSelf();
            return START_NOT_STICKY;
        }
        sLastShown = remainSecs();
        startTick(this);
        return START_STICKY;
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
