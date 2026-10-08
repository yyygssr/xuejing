package com.xuejing.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 上课 / 下课闹钟触发。
 * 1. 发一条系统通知（锁屏、后台也能看到）
 * 2. 如果 App 正在前台，把事件转给页面，直接弹出应用内的提醒卡
 * 3. 重排下一周的同一节课
 *
 * ⚠️ 第 3 步「重排」不是无条件做的 —— 见 onReceive 末尾的说明。
 *    无条件重排会把「课前提醒」这条闹钟自己重新武装到 2 秒后，页面卡片被反复弹出。
 */
public class ClassAlarmReceiver extends BroadcastReceiver {

    /** 同一节同一类提醒的最小间隔，挡住系统重投 / 重排竞态导致的短时间重复触发 */
    private static final long DEDUP_MS = 60_000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        boolean isStart = intent.getBooleanExtra("isStart", true);
        String name = intent.getStringExtra("name");
        String detail = intent.getStringExtra("detail");
        int before = intent.getIntExtra("before", 5);
        String w = intent.getStringExtra("w");

        /* 单/双周、指定周次在**触发时**判断，不在排程时判断。
           排程时过滤的旧写法会让「双周课」在单周那天一个闹钟都不排，
           而下一次排程要等用户重开 App —— 表现就是这门课根本不提醒。
           现在闹钟每周照排，不匹配的这一周静默跳过（下面仍会重排下周）。 */
        boolean thisWeek = ReminderScheduler.weekMatchesNow(context, w == null ? "all" : w);
        /* 节假日同理，在**触发时**判断：放假日静默跳过（下面仍会重排下一周）。
           与页面 dayInfo() 的规则必须一致 —— 历史上页面改了、这里没改，
           结果放假照常弹通知。改任何一边都要看另一边，tools/audit.mjs 会做字段对账。 */
        boolean skipHoliday = ReminderScheduler.isHolidayNow(context);
        if (thisWeek && !skipHoliday) {
            /* before==0 表示正点「上课」闹钟；>0 是课前提醒 */
            if (isStart && before <= 0) {
                String timeOnly = detail == null ? "" : detail.split("·")[0].trim();
                if (ReminderScheduler.isBooked(context, name, timeOnly)) {
                    try {
                        FocusService.start(context, name,
                                ReminderScheduler.durationSecs(timeOnly));
                    } catch (Throwable ignored) { }
                }
            }
            if (before > 0 || !isStart) {
                Notify.showClass(context, isStart,
                        (name == null || name.isEmpty()) ? "课程" : name,
                        detail == null ? "" : detail,
                        Math.max(1, before));
            } else if (isStart) {
                /* 正点上课也给一条轻量通知，确认自动专注已触发 */
                Notify.showClass(context, true,
                        (name == null || name.isEmpty()) ? "课程" : name,
                        detail == null ? "" : detail, 0);
            }

            // App 活着就让页面直接弹应用内的提醒卡（同一次事件只弹一次）
            if (!firedRecently(context, isStart, name, detail)) {
                markFired(context, isStart, name, detail);
                MainActivity.forwardNativeAlert(isStart ? "start" : "end", name, detail);
            }
        }

        /* 把闹钟重排到下一次。
           ⚠️ 只在「正点上课」和「下课」这两条触发后重排，**课前提醒(codeStart)触发后不重排**。
           原因：课前提醒的触发时刻是 start - before。此刻 startAt 仍 > now，
           nextOccurrence() 就会照样返回「今天这个时刻」；重排时若又走一遍
           「窗口已过就补发」的老逻辑，就会把它自己排到 2 秒后 —— 于是每 2 秒响一次，
           一直响到正点。现在窗口已过一律不补发（见 ReminderScheduler），
           这里再补一道：课前提醒触发后干脆不重排，交给随后的正点闹钟去推进下一周。
           正点/下课触发时 startAt <= now，nextOccurrence 自然顺延 7 天，不会自噬。 */
        if (!isStart || before <= 0) {
            try {
                ReminderScheduler.rescheduleFromStore(context);
            } catch (Throwable ignored) { }
        }
    }

    /* ---------- 已触发去重 ----------
       系统在「精确闹钟 + 允许待机唤醒」下可能重投；重排竞态也可能让同一节在
       同一分钟内被触发两次。这里按「节 + 类别」记一个时间戳，60 秒内只放行一次。 */
    private static final String SP = "xuejing_reminders";
    private static final String K_FIRED = "fired";

    private static String firedKey(boolean isStart, String name, String detail) {
        return (isStart ? "S|" : "E|") + (name == null ? "" : name) + "|" + (detail == null ? "" : detail);
    }

    private static boolean firedRecently(Context c, boolean isStart, String name, String detail) {
        try {
            android.content.SharedPreferences sp = c.getSharedPreferences(SP, Context.MODE_PRIVATE);
            long last = sp.getLong(K_FIRED + "|" + firedKey(isStart, name, detail), 0L);
            return last > 0 && (System.currentTimeMillis() - last) < DEDUP_MS;
        } catch (Throwable t) {
            return false;
        }
    }

    private static void markFired(Context c, boolean isStart, String name, String detail) {
        try {
            android.content.SharedPreferences sp = c.getSharedPreferences(SP, Context.MODE_PRIVATE);
            sp.edit().putLong(K_FIRED + "|" + firedKey(isStart, name, detail),
                    System.currentTimeMillis()).apply();
        } catch (Throwable ignored) { }
    }
}
