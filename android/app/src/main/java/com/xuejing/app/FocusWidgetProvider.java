package com.xuejing.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 桌面：番茄专注 */
public class FocusWidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        bind(context, XueJingWidgetProvider.parse(XueJingWidgetProvider.load(context)));
    }

    static void bind(Context c, JSONObject o) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(c);
        if (mgr == null) return;
        int[] ids = mgr.getAppWidgetIds(new ComponentName(c, FocusWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        boolean run = o.optBoolean("focusRunning", false);
        String ft = o.optString("focusText", "");
        int min = o.optInt("focusMin", 0);
        int pomo = o.optInt("focusPomo", 0);
        String label = o.optString("focusLabel", "");
        RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_focus);
        rv.setTextViewText(R.id.wTitle, "专注");
        rv.setTextViewText(R.id.wName, run ? (ft.isEmpty() ? "专注中" : ft) : ("今日 " + min + "m"));
        rv.setTextViewText(R.id.wMeta, run
                ? (label.isEmpty() ? "进行中 · 点此继续" : label)
                : (pomo + " 个番茄 · 开始"));
        rv.setOnClickPendingIntent(R.id.wRoot, XueJingWidgetProvider.openApp(c, "home", 103));
        mgr.updateAppWidget(ids, rv);
    }
}
