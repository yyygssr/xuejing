package com.xuejing.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 上课 / 下课闹钟触发。
 * 1. 发一条系统通知（锁屏、后台也能看到）
 * 2. 如果 App 正在前台，把事件转给页面，直接弹出应用内的提醒卡
 * 3. 重排下一周的同一节课
 */
public class ClassAlarmReceiver extends BroadcastReceiver {

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

            // App 活着就让页面直接弹应用内的提醒卡
            MainActivity.forwardNativeAlert(isStart ? "start" : "end", name, detail);
        }

        // 这一节已经触发过了（或本周不匹配），把闹钟重排到下一周
        try {
            ReminderScheduler.rescheduleFromStore(context);
        } catch (Throwable ignored) { }
    }
}
