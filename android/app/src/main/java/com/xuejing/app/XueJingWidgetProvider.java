package com.xuejing.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 桌面小组件数据与刷新（下一节 / 待办 / 专注） */
public class XueJingWidgetProvider extends AppWidgetProvider {

    static final String SP = "xuejing_widgets";
    static final String K_PAYLOAD = "payload";
    public static final String ACTION_REFRESH = "com.xuejing.app.WIDGET_REFRESH";

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent != null && ACTION_REFRESH.equals(intent.getAction())) {
            refreshAll(context);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        refreshAll(context);
    }

    static String load(Context c) {
        try {
            return c.getSharedPreferences(SP, Context.MODE_PRIVATE).getString(K_PAYLOAD, "");
        } catch (Throwable t) {
            return "";
        }
    }

    static void save(Context c, String json) {
        try {
            c.getSharedPreferences(SP, Context.MODE_PRIVATE)
                    .edit().putString(K_PAYLOAD, json == null ? "" : json).apply();
        } catch (Throwable ignored) { }
    }

    static JSONObject parse(String json) {
        try { return new JSONObject(json == null || json.isEmpty() ? "{}" : json); }
        catch (Throwable t) { return new JSONObject(); }
    }

    /** 页面推完数据后调用 */
    public static void pushAll(Context context, String json) {
        if (context == null) return;
        save(context, json);
        refreshAll(context);
    }

    static void refreshAll(Context c) {
        JSONObject o = parse(load(c));
        NextClassWidgetProvider.bind(c, o);
        TodoWidgetProvider.bind(c, o);
        FocusWidgetProvider.bind(c, o);
        Widget1x2Provider.bind(c, o);
        Widget2x2Provider.bind(c, o);
        Widget4x2Provider.bind(c, o);
    }

    static PendingIntent openApp(Context c, String tab, int req) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.setData(Uri.parse("xuejing://widget?tab=" + (tab == null ? "home" : tab)));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(c, req, i, flags);
    }
}
