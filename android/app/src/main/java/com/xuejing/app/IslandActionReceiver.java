package com.xuejing.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 岛卡片的「关闭」按钮与自动下岛闹钟共用的接收器。
 *
 * 两件事走同一条路：点关闭 → 立刻下岛；闹钟到点 → 兜底下岛。
 * 上岛通知是常驻的（否则系统不会把它提升为 Live Updates），
 * 所以必须给用户一个出口，也要防「岛一直占着下不来」。
 */
public class IslandActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        int id = intent.getIntExtra(Island.K_ID, -1);
        if (id <= 0) return;
        Island.hide(context, id);
    }
}
