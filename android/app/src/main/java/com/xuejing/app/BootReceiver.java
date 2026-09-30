package com.xuejing.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 开机 / 应用更新后，AlarmManager 里排的闹钟会全部丢失，需要重新排一遍。
 * 课表存在 SharedPreferences 里，所以这里不依赖页面就能恢复提醒。
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a)
                || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(a)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
            try {
                Notify.ensureChannels(context);
                ReminderScheduler.rescheduleFromStore(context);
            } catch (Throwable ignored) { }
        }
    }
}
