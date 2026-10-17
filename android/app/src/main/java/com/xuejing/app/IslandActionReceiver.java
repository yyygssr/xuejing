package com.xuejing.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 岛上三种闹钟共用的接收器：关闭按钮、自动下岛、倒计时刷新。
 *
 * 三件事走同一条 Intent 分发，按 action 分流：
 *   · A_CLOSE   点「关闭」→ 立刻下岛
 *   · A_HIDE    自动下岛兜底 → 下岛（上岛通知是常驻的，不给出口会一直占着岛）
 *   · A_REFRESH 倒计时刷新 → 重算「还有 N 分钟」并覆盖同一条通知，然后排下一次
 */
public class IslandActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String a = intent.getAction();
        if (Island.A_REFRESH.equals(a)) {
            /* 刷新只管「还在岛上」的那一条：会话被清过（已下岛/已交接）就什么都不做。
               刷新是自排的，清岛之后残留的那一次必须能安全落空。 */
            Island.refresh(context);
            return;
        }
        int id = intent.getIntExtra(Island.K_ID, -1);
        if (id <= 0) return;
        Island.hide(context, id);
    }
}
