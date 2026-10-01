package com.xuejing.app;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.ref.WeakReference;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 学径 · 壳工程
 *
 * 主体是一个铺满可用区域的 WebView，加载 assets/index.html?app=1。
 * 页面本身就是完整实现，壳负责五件事：
 *   1. 安全区与系统栏 —— 导航栏保持透明沉浸，页面侧用 --nav-inset 抬高内容
 *   2. 返回手势 —— 同步判定页内是否还有可返回的层，并把预测性返回的手势进度喂给页面
 *   3. 文件选择 —— WebView 默认不响应 <input type="file">，必须自己接
 *   4. 系统能力 —— 通知、精确闹钟、前台服务，通过 NativeBridge 暴露给页面
 *   5. 网络代理 —— 页面是 file:// 加载的，跨域会被拦，模型列表拉取由原生代劳
 */
public class MainActivity extends AppCompatActivity {

    /* 部分服务商对无 UA 的请求会直接拒（含硅基流动），统一用一个像浏览器的 UA */
    private static final String USER_AGENT =
            "Mozilla/5.0 (Linux; Android 14; XueJing) AppleWebKit/537.36 Mobile Safari/537.36";

    private WebView web;
    private FrameLayout root;

    /* 页面同步过来的「最上层是什么」。返回手势拿它做同步判定，
       关键点在于：不能等 JS 异步回答再决定退不退，那样手势早已完成、应用已经退出了 */
    private volatile String layer = "root";

    /* 「再按一次退出」的两次点击窗口 */
    private static final long ROOT_BACK_WINDOW = 2000L;
    private long lastRootBack = 0L;

    /* 备份导出：等用户在系统文件选择器里挑好位置后，才把内容写进去 */
    private ActivityResultLauncher<String> createDocLauncher;
    private String pendingBackupName;
    private String pendingBackupText;

    /* 笔记导出：文字与图片各一个 launcher —— CreateDocument 的 MIME 在注册时就固定了，
       它决定系统给出的默认扩展名，所以 .txt 和 .png 没法共用一个。
       真正的内容统一放 pendingDocBytes（图片是二进制，用字符串传会踩编码坑）。 */
    private ActivityResultLauncher<String> createTextLauncher;
    private ActivityResultLauncher<String> createImageLauncher;
    private String pendingDocName;
    private byte[] pendingDocBytes;
    /* 分享图片的临时文件名计数：同名文件边写边被别的应用读，会读到半张图 */
    private int shareSeq = 0;

    /* 页面推过来的课表与设置，用于排上课提醒 */
    String scheduleJson = "";
    String prefsJson = "";

    private boolean darkMode = false;
    /** 页面设置里的「灵动岛上岛」开关 */
    volatile boolean islandOn = true;

    void setIslandEnabled(boolean on) {
        islandOn = on;
        Notify.islandExtrasOn = on;
        if (on) {
            /* 打开：让正在跑的计时通知立刻带上岛标志 */
            FocusService.refresh(this);
        } else {
            /* 关掉：把还占着岛的通知收回来，只留常驻的计时通知 */
            Island.hideAll(this);
            FocusService.refresh(this);
        }
    }

    /**
     * 跳到系统「闹钟和提醒」授权页。
     * Android 12/12L（31/32）这是特殊应用权限，必须用户手动打开，否则课表提醒
     * 只能退化成宽窗口的非精确闹钟 —— Doze 里可能晚十几分钟。
     * Android 13+ 声明了 USE_EXACT_ALARM 就默认具备，这里会兜底跳到应用设置页。
     */
    void openExactAlarmSettings() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Intent i = new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                i.setData(Uri.parse("package:" + getPackageName()));
                startActivity(i);
                return;
            }
        } catch (Throwable ignored) { }
        openAppSettings();
    }

    /** 跳到本应用的系统设置页（厂商的自启动 / 后台省电策略就在这一页附近） */
    void openAppSettings() {
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Throwable ignored) { }
    }

    /* 键盘相关：页面侧据此收掉底栏、调整落点，见 applyInsets 的说明 */
    private int imeBottomPx = 0;   // 最近一次上报的键盘高度
    private int restHeightPx = 0;  // 键盘没弹时窗口的高度（用来算「系统帮我们缩了多少」）
    private boolean kbOpen = false;

    private ValueCallback<Uri[]> pendingFile;
    /* 拍照这条路的输出：相机应用把照片写进 pendingCameraFile，
       拍完把 pendingCameraUri 交给页面（两者同时有效才认） */
    private Uri pendingCameraUri;
    private File pendingCameraFile;
    private ActivityResultLauncher<Intent> fileLauncher;
    private ActivityResultLauncher<String> notifLauncher;
    private ActivityResultLauncher<String> calLauncher;
    /* 用户刚点了「从系统日历同步」但权限还没给：拿到权限后自动补跑这一次 */
    private String[] pendingHolidayRange;

    private static WeakReference<MainActivity> sRef = new WeakReference<>(null);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sRef = new WeakReference<>(this);

        // 系统栏画在内容之下，安全区由下面的 insets 监听统一变成 padding
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        /* Android 10+ 会给导航栏默认加一层半透明蒙版（看起来像一条灰底）。
           想真正「沉浸」就得关掉它 —— 关掉之后内容能从导航栏底下穿过去，
           系统手势条浮在内容之上，这才是我们要的观感。 */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }

        root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(0xFFF5F6FB);

        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(0xFFF5F6FB);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);      // localStorage：课程、专注记录、设置全靠它
        ws.setDatabaseEnabled(true);
        ws.setUseWideViewPort(false);
        ws.setLoadWithOverviewMode(false);
        ws.setSupportZoom(false);
        ws.setBuiltInZoomControls(false);
        ws.setDisplayZoomControls(false);
        ws.setTextZoom(100);                // 不受系统字体缩放影响，避免布局被撑破
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ws.setSafeBrowsingEnabled(false);

        web.addJavascriptInterface(new NativeBridge(this), "XueJingNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                // 单页应用，不允许跳到外部页面
                return !String.valueOf(req.getUrl()).startsWith("file://");
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                // 头像上传、拍照搜题、识图导入都走这里；不实现的话页面里点「换头像」完全没有反应
                if (pendingFile != null) {
                    pendingFile.onReceiveValue(null);
                    pendingFile = null;
                }
                pendingFile = cb;
                /* 页面写 capture=environment 的入口（拍照按钮）必须**我们自己**去唤相机：
                   WebChromeClient.FileChooserParams.createIntent() 给的是
                   ACTION_GET_CONTENT，系统把它解析成「相册 / 文件」——
                   这就是「拍照按钮还是打开相册」的根因，页面侧写 capture 完全不起作用。
                   没相机或唤起失败就退回普通选择器，不让按钮变成死键。 */
                if (params.isCaptureEnabled() && launchCamera()) return true;
                try {
                    fileLauncher.launch(params.createIntent());
                    return true;
                } catch (Throwable t) {
                    pendingFile = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    try { request.grant(request.getResources()); } catch (Throwable ignored) { }
                });
            }
        });

        root.addView(web);
        setContentView(root);

        fileLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(), result -> {
                    if (pendingFile == null) return;
                    Uri[] uris = null;
                    if (pendingCameraUri != null) {
                        /* 相机这条：照片是相机应用按 EXTRA_OUTPUT 写进我们给的文件的，
                           result.getData() 里通常什么都没有（很多 ROM 还硬回 RESULT_CANCELED），
                           所以**只看文件有没有内容**，不看 resultCode。 */
                        File f = pendingCameraFile;
                        if (f != null && f.exists() && f.length() > 0) {
                            uris = new Uri[]{ pendingCameraUri };
                        }
                        pendingCameraUri = null;
                        pendingCameraFile = null;
                    } else if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                        uris = WebChromeClient.FileChooserParams
                                .parseResult(result.getResultCode(), result.getData());
                    }
                    pendingFile.onReceiveValue(uris);
                    pendingFile = null;
                });

        trimCaptureCache();

        notifLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(), granted -> {
                    if (!granted) {
                        toast("通知权限被拒绝，上课提醒和计时通知将无法显示");
                    }
                });

        calLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(), granted -> {
                    String[] range = pendingHolidayRange;
                    pendingHolidayRange = null;
                    if (!granted) {
                        toast("没有日历权限，读不到系统节假日；可在设置里手动添加");
                        callbackHolidays(false, "缺少日历权限");
                        return;
                    }
                    if (range != null) fetchHolidays(range[0], range[1]);
                });

        // 备份导出：走系统的「新建文档」，让用户自己挑保存位置（下载 / 网盘 / 微信收藏都行）
        createDocLauncher = registerForActivityResult(
                new ActivityResultContracts.CreateDocument("application/json"),
                uri -> {
                    String text = pendingBackupText, name = pendingBackupName;
                    pendingBackupText = null;
                    pendingBackupName = null;
                    if (uri == null) return;          // 用户取消了
                    boolean ok = writeText(uri, text);
                    toast(ok ? ("已保存 " + name) : "保存失败，换个位置再试一次");
                });

        // 笔记导出：文字与图片各一条（MIME 决定系统给的默认扩展名，不能共用）
        createTextLauncher = registerForActivityResult(
                new ActivityResultContracts.CreateDocument("text/plain"),
                uri -> {
                    String name = pendingDocName;
                    byte[] data = pendingDocBytes;
                    clearPendingDoc();
                    if (uri == null) return;              // 用户取消了
                    boolean okW = writeBytes(uri, data);
                    toast(okW ? ("已保存 " + name) : "保存失败，换个位置再试一次");
                });
        createImageLauncher = registerForActivityResult(
                new ActivityResultContracts.CreateDocument("image/png"),
                uri -> {
                    String name = pendingDocName;
                    byte[] data = pendingDocBytes;
                    clearPendingDoc();
                    if (uri == null) return;
                    boolean okW = writeBytes(uri, data);
                    toast(okW ? ("已保存 " + name) : "保存失败，换个位置再试一次");
                });

        applyInsets();
        applyDarkMode(false);
        setupSystemBars();

        // app=1 触发页面的「真机模式」：手机壳铺满视口，去掉外壳与圆角
        web.loadUrl("file:///android_asset/index.html?app=1");
        web.postDelayed(this::applyWidgetTab, 400);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (!"root".equals(layer)) {
                    // 页内还有可返回的层：立即消费掉这次返回，交给页面自己关
                    lastRootBack = 0L;
                    evalJs("window.androidBack && window.androidBack()");
                    return;
                }
                /* 已经在根层。这里**故意不做**「按一次就退出」——
                   一旦页面报上来的层因为任何原因陈旧了，一次误判就会把用户直接甩回桌面，
                   代价太大、也没法自证。改成两次确认：第一下只提示，第二下才真的退出。 */
                long now = SystemClock.uptimeMillis();
                if (now - lastRootBack > ROOT_BACK_WINDOW) {
                    lastRootBack = now;
                    toast("再返回一次就退出学径");
                    return;
                }
                lastRootBack = 0L;
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }

            /* ---------- 关于预测性返回 ----------
               这里**故意不**覆写 handleOnBackStarted / Progressed / Cancelled。

               之前接过一版：系统在侧滑进行中不断把「滑了多少」喂给页面，
               页面据此实时横向位移卡片。问题是这条链路上有三个异步环节
               （手势 → 原生 → evalJs → 页面），任何一拍错位都会留下脏状态：
               快速滑完时 progress 的回调可能**先于**返回键回调到达，
               页面刚设好的 translateX 还没被清掉，屏幕上就留下一层「渐黑」；
               卡片位置、遮罩透明度也都可能停在中间态，看着就是界面发黑。

               现在二级页改用淡入淡出（见 index.html 的 .view），
               进场/退场完全由 CSS transition 自己走完，
               不再需要跟手进度 —— 也就没有「进度残留」这一类问题。
               手势本身照常由系统识别，松手后走 handleOnBackPressed 这一条路。 */
        });

        Notify.ensureChannels(this);
    }

    /**
     * 安全区处理。
     *
     * - 顶部：状态栏高度由原生吃掉（变成 root 的 padding），页面自绘的那条只当占位。
     * - 底部无键盘时**不**吃 inset：导航栏是透明沉浸的，tabbar 底色一直铺到屏幕最底，
     *   系统手势条浮在它上面；图标与文字由页面侧 --nav-inset 抬高。
     *   要是在这里把底部 inset 也吃掉，tabbar 会被顶上去、底下空出一条背景色，反而不沉浸。
     *   —— 这条只对「页面用自绘内容垫底」的情况成立，所以 padding 里不含它。
     * - 键盘弹出时**只补差额**，这是解决「一唤起键盘就抬太多」的关键：
     *   大多数 ROM 的 adjustResize 会把窗口本身缩小（WebView 跟着变矮），
     *   这时再全额加一次键盘高度的 padding，等于抬了两遍，输入框自然被顶得老高。
     *   所以 padding 只补「系统没帮忙缩掉的那部分」——
     *   正常 resize 的机型差额为 0（一点不加），不 resize 的机型才全额补上。
     *
     * 另外每次键盘开合都通知页面（window.onKb）：弹起时页面把底栏收掉，
     * 输入框直接坐在键盘上方，不用跨过整条底栏。
     */
    private void applyInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            imeBottomPx = ime.bottom;
            boolean open = ime.bottom > 0;
            v.setPadding(0, bars.top, 0, keyboardPad());
            /* bars.bottom 是**物理像素**，而 WebView 里 1 CSS px = 1 dp；
               不换算就直接塞给 CSS，1080p 机型（density ≈ 2.75~3）会把「~16dp 的手势条」
               报成 48 CSS px，底栏就会长出 30 多 px 的额外高度。换成 dp 再交出去。 */
            float density = getResources().getDisplayMetrics().density;
            int navDp = Math.round(bars.bottom / density);
            /* 键盘开着时底部区域已被键盘占满，不需要再抬高，nav-inset 归零 */
            evalJs("window.__setInsets && window.__setInsets(0," + (open ? 0 : navDp) + ")");
            if (open != kbOpen) {
                kbOpen = open;
                evalJs("window.onKb && window.onKb(" + (open ? 1 : 0) + ")");
            }
            /* 请求一次布局：让下面的全局布局监听按「最新的窗口高度」重算差额 */
            v.requestLayout();
            return WindowInsetsCompat.CONSUMED;
        });
        /* 窗口被系统 resize 之后高度才更新，所以差额必须在这一刻重算 */
        root.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            if (root == null) return;
            if (imeBottomPx <= 0) {
                if (root.getHeight() > 0) restHeightPx = root.getHeight();
                return;
            }
            int want = keyboardPad();
            if (root.getPaddingBottom() != want) {
                root.setPadding(0, root.getPaddingTop(), 0, want);
            }
        });
        ViewCompat.requestApplyInsets(root);
    }

    /**
     * 键盘需要补的底部 padding。
     *
     * restHeightPx 是「键盘没弹时窗口的高度」。键盘弹起后若窗口被系统缩小，
     * 差额 ≈ 键盘高度 —— 说明系统已经帮忙让位了，这里就不该再补（否则抬两遍）；
     * 若窗口高度纹丝不动（系统没 resize），差额为 0，才全额补上键盘高度。
     */
    private int keyboardPad() {
        if (imeBottomPx <= 0) return 0;
        int h = root.getHeight();
        /* 基准高度还没测到就先不补，等下一次布局回调再来 —— 宁可晚一帧，也不要多垫一段 */
        if (h <= 0 || restHeightPx <= 0) return 0;
        int shrink = Math.max(0, restHeightPx - h);
        return Math.max(0, imeBottomPx - shrink);
    }

    /**
     * 系统栏统一设成「常驻 + 沉浸」。
     *
     * 早先的做法是把导航栏整个藏掉（hide(navigationBars())），指望页面自绘一条
     * 假手势条顶替它。结果在 MIUI 这类系统上，那条假条和系统真手势条会同时画出来，
     * 屏幕底部出现两根横杠 —— 这就是「双小白条」的真正来源。
     *
     * 现在反过来：导航栏不藏，保持透明、关掉系统蒙版，让内容从它底下穿过去，
     * 页面侧再把内容抬高。屏幕上于是只剩系统画的那一根，而且是沉浸的。
     *
     * 注意别用 BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE —— 那是「藏起来、上滑才临时浮现」，
     * 与「常驻显示」正好相反。这里用默认行为。
     */
    private void setupSystemBars() {
        try {
            WindowInsetsControllerCompat c =
                    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);
            c.show(WindowInsetsCompat.Type.navigationBars());
            c.setAppearanceLightStatusBars(!darkMode);
            c.setAppearanceLightNavigationBars(!darkMode);
        } catch (Throwable ignored) { }
    }

    /** 页面导航后同步「最上层」，返回手势靠它决定是关页内还是退出应用 */
    /** 模型 TTS：写 cache/tts_*.mp3，成功回吐可播放路径 */
    void aiTts(final String url, final String apiKey, final String bodyJson) {
        if (url == null || url.trim().isEmpty()) {
            callbackTts(false, "");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                byte[] payload = bodyJson == null ? new byte[0]
                        : bodyJson.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                conn = (HttpURLConnection) new URL(url.trim()).openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setRequestProperty("Accept", "audio/mpeg, audio/*, application/json");
                conn.setRequestProperty("User-Agent",
                        "Mozilla/5.0 (Linux; Android 14; XueJing) AppleWebKit/537.36 Mobile Safari/537.36");
                if (apiKey != null && !apiKey.trim().isEmpty()) {
                    conn.setRequestProperty("Authorization", "Bearer " + apiKey.trim());
                }
                conn.setFixedLengthStreamingMode(payload.length);
                conn.getOutputStream().write(payload);
                int code = conn.getResponseCode();
                boolean ok = (code >= 200 && code < 300);
                if (!ok) {
                    readAll(conn.getErrorStream());
                    callbackTts(false, "");
                    return;
                }
                InputStream is = conn.getInputStream();
                java.io.File dir = new java.io.File(getCacheDir(), "tts");
                if (!dir.exists() && !dir.mkdirs()) {
                    callbackTts(false, "");
                    return;
                }
                java.io.File out = new java.io.File(dir, "tts_" + System.currentTimeMillis() + ".mp3");
                java.io.FileOutputStream fos = new java.io.FileOutputStream(out);
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) fos.write(buf, 0, n);
                fos.close();
                is.close();
                if (out.length() < 64) {
                    callbackTts(false, "");
                    return;
                }
                callbackTts(true, "file://" + out.getAbsolutePath());
            } catch (Throwable t) {
                callbackTts(false, "");
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private void callbackTts(final boolean ok, final String path) {
        final String js = "window.onTtsResult && window.onTtsResult("
                + (ok ? "true" : "false") + "," + jsString(path == null ? "" : path) + ")";
        runOnUiThread(() -> evalJs(js));
    }

    /** 页面把摘要推过来，刷新桌面小组件 */
    void updateWidgets(final String json) {
        runOnUiThread(() -> {
            try {
                XueJingWidgetProvider.pushAll(this, json == null ? "" : json);
            } catch (Throwable ignored) { }
        });
    }

    private int prevRinger = -1;

    /** 上课静音：尽量压低铃声；无权限时静默失败 */
    void setClassMute(boolean mute) {
        try {
            android.media.AudioManager am =
                    (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
            if (am == null) return;
            if (mute) {
                if (prevRinger < 0) prevRinger = am.getRingerMode();
                try {
                    am.setRingerMode(android.media.AudioManager.RINGER_MODE_VIBRATE);
                } catch (SecurityException e) {
                    am.setStreamVolume(android.media.AudioManager.STREAM_RING, 0, 0);
                    am.setStreamVolume(android.media.AudioManager.STREAM_NOTIFICATION, 0, 0);
                }
            } else {
                if (prevRinger >= 0) {
                    try { am.setRingerMode(prevRinger); } catch (Throwable ignored) { }
                    prevRinger = -1;
                } else {
                    try {
                        am.setRingerMode(android.media.AudioManager.RINGER_MODE_NORMAL);
                    } catch (Throwable ignored) { }
                }
            }
        } catch (Throwable ignored) { }
    }

    void onBackLayer(String l) {
        if (l == null || l.isEmpty()) l = "root";
        // 层变了就把「再按一次」的计时清掉，避免在别的界面按过一次之后，
        // 回到根层时第二下就意外退出了
        if (!l.equals(layer)) lastRootBack = 0L;
        layer = l;
    }

    /** 复制一段文本到系统剪贴板：file:// 页面拿不到 navigator.clipboard，只能走原生 */
    void copyText(String text) {
        if (text == null) return;
        final String t = text;
        runOnUiThread(() -> {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("学径", t));
            } catch (Throwable ignored) { }
        });
    }

    /**
     * 拉取服务商的模型列表。
     *
     * 为什么放在原生做：页面是 file:///android_asset 加载的，从它发出去的请求
     * 会带 Origin: null，服务商的网关基本都会拒（CORS 或直接 403），
     * 所以浏览器预览里压根拉不动。交给原生的 HttpURLConnection 主动请求，
     * 拿到响应体整串回吐给页面，顺手绕开了 WebView 的跨域限制。
     *
     * 结果通过 window.onModelsFetched(ok, payload) 回到页面：
     * 成功时 payload 是响应体原文，失败时是一句给人看的错误说明。
     */
    void fetchModels(final String url, final String key) {
        if (url == null || url.trim().isEmpty()) {
            callbackModels(false, "接口地址是空的");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url.trim()).openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(12000);
                conn.setReadTimeout(20000);
                conn.setRequestProperty("Accept", "application/json");
                /* 部分网关（含硅基流动）对无 UA 的请求会拒 */
                conn.setRequestProperty("User-Agent",
                        "Mozilla/5.0 (Linux; Android 14; XueJing) AppleWebKit/537.36 Mobile Safari/537.36");
                if (key != null && !key.trim().isEmpty()) {
                    conn.setRequestProperty("Authorization", "Bearer " + key.trim());
                }
                int code = conn.getResponseCode();
                boolean ok = (code >= 200 && code < 300);
                String body = readAll(ok ? conn.getInputStream() : conn.getErrorStream());
                if (ok) {
                    callbackModels(true, body);
                } else {
                    callbackModels(false, "HTTP " + code + briefServerMsg(body));
                }
            } catch (Throwable t) {
                callbackModels(false, describeNetError(t));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    /**
     * 通用的「调一次模型」入口 —— AI 对话、规划、周总结、识图导入、拍照搜题全走这一个。
     *
     * 为什么让**页面**组装请求体：不同用途的消息结构差别很大
     * （多轮对话要带历史、识图要带 image_url、规划要带 response_format），
     * 在 Java 里手写 JSON 拼装既啰嗦又容易漏转义。
     * 页面用 JSON.stringify 组装好整串，原生只做三件事：
     * 发请求、带鉴权、把响应体原样回吐。
     *
     * 为什么必须在原生发：页面是 file:///android_asset 加载的，
     * 从它发出去的请求带 Origin: null，服务商网关基本都会拒。
     *
     * 结果通过 window.onAiResult(ok, payload) 回到页面：
     * ok=true 时 payload 是响应体原文；ok=false 时是一句给人看的错误说明。
     */
    void aiPost(final String url, final String apiKey, final String bodyJson) {
        if (url == null || url.trim().isEmpty()) {
            callbackAi(false, "接口地址是空的");
            return;
        }
        if (bodyJson == null || bodyJson.trim().isEmpty()) {
            callbackAi(false, "请求体是空的");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                byte[] payload = bodyJson.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                conn = (HttpURLConnection) new URL(url.trim()).openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                /* 连接 15s：握手/解析域名够用；读 180s：推理模型（deepseek-reasoner 这类）
                   要先把思考过程写完才出正文，读超时给短了会把正常的慢回答误判成失败。 */
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(180000);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("User-Agent",
                        "Mozilla/5.0 (Linux; Android 14; XueJing) AppleWebKit/537.36 Mobile Safari/537.36");
                if (apiKey != null && !apiKey.trim().isEmpty()) {
                    conn.setRequestProperty("Authorization", "Bearer " + apiKey.trim());
                }
                conn.setFixedLengthStreamingMode(payload.length);
                conn.getOutputStream().write(payload);
                int code = conn.getResponseCode();
                boolean ok = (code >= 200 && code < 300);
                String respBody = readAll(ok ? conn.getInputStream() : conn.getErrorStream());
                if (ok) {
                    callbackAi(true, respBody);
                } else {
                    callbackAi(false, "HTTP " + code + briefServerMsg(respBody));
                }
            } catch (Throwable t) {
                callbackAi(false, describeNetError(t));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    /**
     * 流式版本：和 aiPost 同一条路，区别是把 SSE 的增量**边收边推**给页面。
     *
     * 为什么收完还要再合成一份「整包格式」的响应：
     * 页面里解析响应、取正文、判推理模型截断……那一整套逻辑只应该有一份。
     * 所以流式只当**加速通道**（让首字早点出来），结束时依旧
     * 以 window.onAiResult 交一份 {"choices":[{"message":{...}}]} 形状的响应，
     * 两条路的结果对页面来说完全一样，关掉开关也不影响任何功能。
     *
     * 增量走 window.onAiStreamDelta(kind, text)：kind = 'c' 正文 / 'r' 思考过程。
     */
    void aiPostStream(final String url, final String apiKey, final String bodyJson) {
        if (url == null || url.trim().isEmpty()) { callbackAi(false, "接口地址是空的"); return; }
        if (bodyJson == null || bodyJson.trim().isEmpty()) { callbackAi(false, "请求体是空的"); return; }
        new Thread(() -> {
            HttpURLConnection conn = null;
            StringBuilder all = new StringBuilder();      /* 非 SSE 回包时的原文兜底 */
            StringBuilder content = new StringBuilder();
            StringBuilder reasoning = new StringBuilder();
            String finish = "";
            int deltas = 0;
            try {
                byte[] payload = bodyJson.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                conn = (HttpURLConnection) new URL(url.trim()).openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                /* 读超时按「两次读到数据之间」算，流式下每来一块就重置，
                   所以给和整包一样的 180s 即可 —— 只有真正卡住才会触发。 */
                conn.setReadTimeout(180000);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setRequestProperty("Accept", "text/event-stream");
                conn.setRequestProperty("Cache-Control", "no-cache");
                conn.setRequestProperty("User-Agent", USER_AGENT);
                if (apiKey != null && !apiKey.trim().isEmpty()) {
                    conn.setRequestProperty("Authorization", "Bearer " + apiKey.trim());
                }
                conn.setFixedLengthStreamingMode(payload.length);
                conn.getOutputStream().write(payload);

                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    callbackAi(false, "HTTP " + code + briefServerMsg(readAll(conn.getErrorStream())));
                    return;
                }
                /* 不能用 readAll —— 那要等整条流结束，流式就没意义了 */
                BufferedReader rd = new BufferedReader(
                        new InputStreamReader(conn.getInputStream(), java.nio.charset.StandardCharsets.UTF_8));
                String line;
                while ((line = rd.readLine()) != null) {
                    if (line.isEmpty()) continue;
                    if (!line.startsWith("data:")) { all.append(line); continue; }
                    String data = line.substring(5).trim();
                    if (data.isEmpty()) continue;
                    if ("[DONE]".equals(data)) break;
                    try {
                        String[] d = parseDelta(data);
                        if (d == null) continue;
                        if (!d[2].isEmpty()) finish = d[2];
                        if (!d[1].isEmpty()) { reasoning.append(d[1]); emitDelta("r", d[1]); deltas++; }
                        if (!d[0].isEmpty()) { content.append(d[0]); emitDelta("c", d[0]); deltas++; }
                    } catch (Throwable ignored) { }
                }
                rd.close();

                if (deltas == 0) {
                    /* 网关没按 SSE 回（有的直接忽略 stream 参数，把整包 JSON 丢回来）：
                       原样交给页面按普通响应解析，功能不受影响。 */
                    callbackAi(true, all.toString());
                    return;
                }
                JSONObject msg = new JSONObject();
                msg.put("content", content.toString());
                msg.put("reasoning_content", reasoning.toString());
                JSONObject choice = new JSONObject();
                choice.put("message", msg);
                choice.put("finish_reason", finish.isEmpty() ? "stop" : finish);
                JSONObject out = new JSONObject();
                JSONArray choices = new JSONArray();
                choices.put(choice);
                out.put("choices", choices);
                callbackAi(true, out.toString());
            } catch (Throwable t) {
                callbackAi(false, describeNetError(t));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    /**
     * 从一条 SSE 的 data 里取出增量，返回 {正文, 思考过程, finish_reason}；没有增量时返回 null。
     *
     * 为什么不能直接用 optString：
     *   org.json 的 optString(name, fallback) 走的是 JSON.toString(opt(name))，
     *   而 JSON.toString 对「非 String 的非 null 值」会 String.valueOf() ——
     *   JSON 里的 null 在 Android 上是 JSONObject.NULL 这个**对象**，
     *   它的 toString() 恰好返回 "null"。于是 `"reasoning_content": null`
     *   会被读成字面量字符串 "null" 而不是空串。
     *   推理模型的正文分片几乎每条都带着 "reasoning_content": null（反之亦然），
     *   一屏几百个分片就是满屏 null —— 用户看到的正是「null 刷屏」。
     *   （fallback 只在字段**不存在**时生效，对显式 null 完全不生效。）
     *
     * 所以这里只认真正的字符串值：缺字段、null、数字一律当空。
     * 注意**不能**顺手把内容等于 "null" 的字符串也删掉 ——
     * 模型在讲 JSON 代码时，某个分片正好是 "null" 是完全正常的。
     */
    private static String[] parseDelta(String data) {
        JSONObject o;
        try {
            o = new JSONObject(data);
        } catch (Throwable t) {
            return null;   /* 不是 JSON 的行（心跳、注释）直接跳过 */
        }
        JSONArray arr = o.optJSONArray("choices");
        JSONObject ch = (arr != null && arr.length() > 0) ? arr.optJSONObject(0) : null;
        if (ch == null) return null;
        String fin = optText(ch, "finish_reason");
        JSONObject d = ch.optJSONObject("delta");
        if (d == null) d = ch.optJSONObject("message");   /* 有的网关流式也回 message */
        if (d == null) return fin.isEmpty() ? null : new String[]{"", "", fin};
        String r = optText(d, "reasoning_content");
        if (r.isEmpty()) r = optText(d, "reasoning");     /* OpenRouter 等叫 reasoning */
        return new String[]{optText(d, "content"), r, fin};
    }

    /** 只取真正的字符串字段；字段缺失 / JSON null / 非字符串类型一律返回空串 */
    private static String optText(JSONObject o, String key) {
        if (o == null) return "";
        Object v = o.opt(key);
        return (v instanceof String) ? (String) v : "";
    }

    /** 把一段增量推给页面（必须在 UI 线程调 evaluateJavascript） */
    private void emitDelta(final String kind, final String text) {
        if (text == null || text.isEmpty()) return;
        final String js = "window.onAiStreamDelta && window.onAiStreamDelta("
                + jsString(kind) + "," + jsString(text) + ")";
        web.post(() -> evalJs(js));
    }

    private void callbackModels(final boolean ok, final String payload) {
        String body = payload == null ? "" : payload;
        /* 错误响应可能是整页 HTML，截一下再送过去，免得日志和 toast 被刷爆 */
        if (body.length() > 400) body = body.substring(0, 400) + "…";
        final String js = "window.onModelsFetched && window.onModelsFetched("
                + (ok ? "true" : "false") + "," + jsString(body) + ")";
        runOnUiThread(() -> evalJs(js));
    }

    private void callbackAi(final boolean ok, final String payload) {
        String body = payload == null ? "" : payload;
        /* 成功时可能是完整回答（几千字），留 64KB 余量；超长截断并标注，
           免得转义后撑爆 WebView 的 JS 字符串。 */
        if (body.length() > 64000) body = body.substring(0, 64000) + "…[截断]";
        final String js = "window.onAiResult && window.onAiResult("
                + (ok ? "true" : "false") + "," + jsString(body) + ")";
        runOnUiThread(() -> evalJs(js));
    }

    /** 从错误响应里抠出 message 字段，抠不到就截一小段原文 */
    private static String briefServerMsg(String body) {
        if (body == null) return "";
        int i = body.indexOf("\"message\"");
        if (i >= 0) {
            int s = body.indexOf('"', i + 9);
            if (s >= 0) {
                int e = body.indexOf('"', s + 1);
                if (e > s) return " · " + body.substring(s + 1, Math.min(e, s + 90));
            }
        }
        String t = body.replaceAll("\\s+", " ").trim();
        return t.isEmpty() ? "" : (" · " + t.substring(0, Math.min(70, t.length())));
    }

    /** 把网络异常翻译成人话 —— 报错里带英文类名的话用户不知道该改什么 */
    private static String describeNetError(Throwable t) {
        if (t instanceof UnknownHostException) return "域名解析不了，检查一下接口地址";
        if (t instanceof SocketTimeoutException) return "连上了但一直没响应，稍后再试";
        if (t instanceof ConnectException) return "连不上服务商，检查网络或地址";
        String n = t.getClass().getSimpleName();
        if (n.contains("SSL")) return "证书校验没通过，换个地址试试";
        String m = t.getMessage();
        return (m == null || m.isEmpty()) ? n : (n + " · " + m);
    }

    /**
     * 用系统浏览器打开链接（对话里 Markdown 链接用）。
     * 只放行 http/https —— 别的 scheme（intent://、file:// 等）一律不开，
     * 避免模型输出里塞一个奇怪链接就把用户带去别的应用。
     */
    boolean openUrl(String url) {
        try {
            String u = url == null ? "" : url.trim();
            if (!u.matches("(?i)^https?://.+")) return false;
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(u));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** 通用 GET，回吐 window.onHttpGet(id, ok, body)。file:// 页面跨域要用它。 */
    void httpGet(final String id, final String url, final String referer) {
        if (url == null || url.trim().isEmpty()) {
            callbackHttpGet(id, false, "地址是空的");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url.trim()).openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(12000);
                conn.setReadTimeout(20000);
                conn.setRequestProperty("Accept", "application/json,text/html,*/*");
                conn.setRequestProperty("User-Agent",
                        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36");
                if (referer != null && !referer.isEmpty()) {
                    conn.setRequestProperty("Referer", referer);
                }
                int code = conn.getResponseCode();
                boolean ok = (code >= 200 && code < 300);
                String body = readAll(ok ? conn.getInputStream() : conn.getErrorStream());
                if (body.length() > 200000) body = body.substring(0, 200000);
                if (ok) callbackHttpGet(id, true, body);
                else callbackHttpGet(id, false, "HTTP " + code + briefServerMsg(body));
            } catch (Throwable t) {
                callbackHttpGet(id, false, describeNetError(t));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private void callbackHttpGet(final String id, final boolean ok, final String payload) {
        String body = payload == null ? "" : payload;
        if (body.length() > 180000) body = body.substring(0, 180000) + "…";
        final String js = "window.onHttpGet && window.onHttpGet("
                + jsString(id == null ? "" : id) + ","
                + (ok ? "true" : "false") + "," + jsString(body) + ")";
        runOnUiThread(() -> evalJs(js));
    }

    private static String readAll(InputStream is) throws Exception {
        if (is == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        is.close();
        return new String(bos.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
    }

    /** 拼进 JS 字符串字面量前必须转义，否则响应里的引号换行会把脚本打崩 */
    private static String jsString(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '<':  sb.append("\\u003c"); break;
                case '>':  sb.append("\\u003e"); break;
                case '&':  sb.append("\\u0026"); break;
                case '\u2028': sb.append("\\u2028"); break;
                case '\u2029': sb.append("\\u2029"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }

    /**
     * 导出备份文件。页面把 JSON 文本直接传进来（字符串跨语言没有编码坑），
     * 这里只负责让用户选位置并写盘。
     */
    void saveBackup(String name, String text) {
        if (text == null) return;
        pendingBackupName = (name == null || name.trim().isEmpty()) ? "学径-备份.json" : name.trim();
        pendingBackupText = text;
        runOnUiThread(() -> {
            try {
                createDocLauncher.launch(pendingBackupName);
            } catch (Throwable t) {
                pendingBackupText = null;
                pendingBackupName = null;
                toast("这个机型打不开文件选择器");
            }
        });
    }

    private boolean writeText(Uri uri, String text) {
        if (text == null) return false;
        java.io.OutputStream os = null;
        try {
            os = getContentResolver().openOutputStream(uri);
            if (os == null) return false;
            os.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            os.flush();
            return true;
        } catch (Throwable t) {
            return false;
        } finally {
            try { if (os != null) os.close(); } catch (Throwable ignored) { }
        }
    }

    private void clearPendingDoc() {
        pendingDocName = null;
        pendingDocBytes = null;
    }

    private boolean writeBytes(Uri uri, byte[] data) {
        if (uri == null || data == null) return false;
        java.io.OutputStream os = null;
        try {
            os = getContentResolver().openOutputStream(uri);
            if (os == null) return false;
            os.write(data);
            os.flush();
            return true;
        } catch (Throwable t) {
            return false;
        } finally {
            try { if (os != null) os.close(); } catch (Throwable ignored) { }
        }
    }

    /**
     * data:image/png;base64,xxxx → 字节数组。
     * 页面传上来的可能是 dataURL，也可能是裸 base64，两种都认。
     */
    private static byte[] decodeDataUrl(String s) {
        try {
            String t = String.valueOf(s == null ? "" : s).trim();
            int comma = t.indexOf(',');
            if (t.startsWith("data:") && comma > 0) t = t.substring(comma + 1);
            if (t.isEmpty()) return null;
            return android.util.Base64.decode(t, android.util.Base64.DEFAULT);
        } catch (Throwable e) {
            return null;
        }
    }

    /**
     * 导出纯文本（笔记的「导出为文字」）。与 saveBackup 同一条路：
     * 让用户自己挑保存位置，只是 MIME 换成 text/plain，扩展名才是 .txt。
     */
    void saveText(String name, String text) {
        if (text == null) return;
        pendingDocName = (name == null || name.trim().isEmpty()) ? "学径-笔记.txt" : name.trim();
        pendingDocBytes = text.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        runOnUiThread(() -> {
            try {
                createTextLauncher.launch(pendingDocName);
            } catch (Throwable t) {
                clearPendingDoc();
                toast("这个机型打不开文件选择器");
            }
        });
    }

    /**
     * 导出图片（笔记的「导出为图片」）。页面给的是 dataURL，这里剥前缀解码写盘。
     * 为什么不让页面直接传二进制：@JavascriptInterface 只可靠地传 String，
     * 一整张图的 base64 走字符串反而是最不容易出错的方式。
     */
    void saveImage(String name, String dataUrl) {
        byte[] bin = decodeDataUrl(dataUrl);
        if (bin == null || bin.length == 0) {
            toast("图片是空的，没东西可存");
            return;
        }
        pendingDocName = (name == null || name.trim().isEmpty()) ? "学径-笔记.png" : name.trim();
        pendingDocBytes = bin;
        runOnUiThread(() -> {
            try {
                createImageLauncher.launch(pendingDocName);
            } catch (Throwable t) {
                clearPendingDoc();
                toast("这个机型打不开文件选择器");
            }
        });
    }

    /** 系统分享纯文本（笔记的「分享文字」）—— 分享面板里发到哪儿由用户决定 */
    void shareText(String text) {
        if (text == null || text.trim().isEmpty()) {
            toast("内容是空的");
            return;
        }
        final String body = text;
        runOnUiThread(() -> {
            try {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_SUBJECT, "学径笔记");
                i.putExtra(Intent.EXTRA_TEXT, body);
                startActivity(Intent.createChooser(i, "分享笔记"));
            } catch (Throwable e) {
                toast("这台设备上没有可分享的应用");
            }
        });
    }

    /**
     * 系统分享图片（笔记的「分享图片」）。
     * 写进私有 cache/share 再经 FileProvider 交出去 —— 不需要任何存储权限，
     * 也不用把 FileProvider 的可暴露范围开大（file_paths.xml 只开了这一个子目录）。
     */
    void shareImage(String name, String dataUrl) {
        byte[] bin = decodeDataUrl(dataUrl);
        if (bin == null || bin.length == 0) {
            toast("图片是空的，没东西可分享");
            return;
        }
        final String fn = (name == null || name.trim().isEmpty()) ? "学径-笔记.png" : name.trim();
        runOnUiThread(() -> {
            try {
                File dir = new File(getCacheDir(), "share");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, "s" + (++shareSeq) + "-" + fn);
                java.io.FileOutputStream fo = new java.io.FileOutputStream(f);
                fo.write(bin);
                fo.close();
                Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", f);
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("image/png");
                i.putExtra(Intent.EXTRA_STREAM, uri);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(i, "分享笔记"));
            } catch (Throwable e) {
                toast("分享失败了，可以先导出成图片再发");
            }
        });
    }

    /** 深色模式：同步系统栏图标颜色，避免白底白字 */
    void applyDarkMode(boolean dark) {
        darkMode = dark;
        int bg = dark ? 0xFF0E1017 : 0xFFF5F6FB;
        if (root != null) root.setBackgroundColor(bg);
        if (web != null) web.setBackgroundColor(bg);
        try {
            WindowInsetsControllerCompat c =
                    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            c.setAppearanceLightStatusBars(!dark);
            c.setAppearanceLightNavigationBars(!dark);
        } catch (Throwable ignored) { }
    }

    /**
     * 唤起系统相机，把照片写到我们自己的 cache 目录里。
     *
     * 为什么必须自己拼 Intent：页面的拍照入口写的是 capture=environment，
     * 但 WebView 的 FileChooserParams.createIntent() 只会给出
     * ACTION_GET_CONTENT —— 系统把它解析成「相册 / 文件」，页面侧怎么改都没用。
     *
     * 用 FileProvider 的 content:// 代替 file://：
     *   · API 24 起 file:// 出应用会直接 FileUriExposedException；
     *   · cache 目录 + content URI 不需要任何存储权限（API 26~36 通吃）。
     * ACTION_IMAGE_CAPTURE 本身不需要 CAMERA 权限，所以清单里刻意不申请 ——
     * 一旦申请了，反而必须弹权限框，用户拒了拍照就彻底用不了。
     */
    private boolean launchCamera() {
        try {
            File dir = new File(getCacheDir(), "capture");
            if (!dir.exists() && !dir.mkdirs()) return false;
            /* 每次换新文件名：同名文件会被某些相机的「重拍」直接覆盖，
               FileProvider 也可能把它当成同一张 */
            File f = new File(dir, "shot_" + System.currentTimeMillis() + ".jpg");
            Uri out = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", f);
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, out);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            pendingCameraFile = f;
            pendingCameraUri = out;
            fileLauncher.launch(i);
            return true;
        } catch (Throwable t) {
            pendingCameraUri = null;
            pendingCameraFile = null;
            return false;              /* 没有相机应用：退回普通选择器 */
        }
    }

    /** 拍照缓存只留最近一天，别让 cache 目录越攒越多 */
    private void trimCaptureCache() {
        try {
            File dir = new File(getCacheDir(), "capture");
            File[] fs = dir.listFiles();
            if (fs == null) return;
            long cut = System.currentTimeMillis() - 24L * 3600 * 1000;
            for (File f : fs) {
                if (f.isFile() && f.lastModified() < cut) f.delete();
            }
        } catch (Throwable ignored) { }
    }

    void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                    != PackageManager.PERMISSION_GRANTED) {
                notifLauncher.launch("android.permission.POST_NOTIFICATIONS");
                return;
            }
        }
        askPromotedPermission();
    }

    /**
     * Android 15+ 的上岛运行时权限。
     * 不申请的话，通知能发出来、但系统不会把它提升成 Live Updates ——
     * 用户看到的就是一条普通常驻通知，还以为是上岛坏了。
     */
    void askPromotedPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return;
        try {
            if (checkSelfPermission("android.permission.POST_PROMOTED_NOTIFICATIONS")
                    != PackageManager.PERMISSION_GRANTED) {
                notifLauncher.launch("android.permission.POST_PROMOTED_NOTIFICATIONS");
            }
        } catch (Throwable ignored) {
            /* 少数 ROM 没这个权限定义，跳过即可，不影响普通通知 */
        }
    }

    /**
     * 从系统日历读节假日。
     *
     * 课表是按「星期几」排的，放假是按「具体日期」放的，所以必须落到日期判断。
     * 各家 ROM 的节假日数据都在日历里（MIUI/鸿蒙/原生都自带「中国节假日」这类日历），
     * 自己维护一份名单既容易过时也容易跟系统对不上 —— 所以直接读日历：
     *   1. 先扫一遍日历表，名字里带「节假日 / 法定 / holiday」的算高置信；
     *   2. 再按时间范围扫全天事件，标题命中节假日关键词的也算；
     *   3. 全天事件的 dtstart 存的是 UTC 零点，必须用 UTC 格式化才拿得到正确日期。
     * 结果通过 window.onHolidaysFetched(ok, payload) 回页面。
     */
    void fetchHolidays(final String start, final String end) {
        if (checkSelfPermission("android.permission.READ_CALENDAR")
                != PackageManager.PERMISSION_GRANTED) {
            pendingHolidayRange = new String[]{start == null ? "" : start, end == null ? "" : end};
            calLauncher.launch("android.permission.READ_CALENDAR");
            return;
        }
        new Thread(() -> {
            Cursor cur = null;
            try {
                java.text.SimpleDateFormat fmtUtc =
                        new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US);
                fmtUtc.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                java.text.SimpleDateFormat fmtLocal =
                        new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US);
                fmtLocal.setTimeZone(java.util.TimeZone.getDefault());

                java.util.HashSet<Integer> holidayCalIds = new java.util.HashSet<>();
                int calCount = 0;
                cur = getContentResolver().query(
                        android.provider.CalendarContract.Calendars.CONTENT_URI,
                        new String[]{
                                android.provider.CalendarContract.Calendars._ID,
                                android.provider.CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
                                android.provider.CalendarContract.Calendars.NAME,
                                android.provider.CalendarContract.Calendars.ACCOUNT_NAME
                        }, null, null, null);
                if (cur != null) {
                    while (cur.moveToNext()) {
                        calCount++;
                        int id = cur.getInt(0);
                        String blob = safe(cur.getString(1)) + " " + safe(cur.getString(2))
                                + " " + safe(cur.getString(3));
                        if (looksLikeHolidayCalendar(blob)) holidayCalIds.add(id);
                    }
                    cur.close();
                    cur = null;
                }

                long t0 = parseDayMillis(start, true);
                long t1 = parseDayMillis(end, false);

                java.util.ArrayList<String> ranges = new java.util.ArrayList<>();
                int evCount = 0, matched = 0;
                cur = getContentResolver().query(
                        android.provider.CalendarContract.Events.CONTENT_URI,
                        new String[]{
                                android.provider.CalendarContract.Events.TITLE,
                                android.provider.CalendarContract.Events.DTSTART,
                                android.provider.CalendarContract.Events.DTEND,
                                android.provider.CalendarContract.Events.ALL_DAY,
                                android.provider.CalendarContract.Events.CALENDAR_ID
                        },
                        android.provider.CalendarContract.Events.DTSTART + " < ? AND ("
                                + android.provider.CalendarContract.Events.DTEND + " > ? OR "
                                + android.provider.CalendarContract.Events.DTEND + " IS NULL)",
                        new String[]{String.valueOf(t1), String.valueOf(t0)},
                        android.provider.CalendarContract.Events.DTSTART + " ASC");
                if (cur != null) {
                    while (cur.moveToNext()) {
                        String title = safe(cur.getString(0));
                        long dtStart = cur.isNull(1) ? 0L : cur.getLong(1);
                        long dtEnd = cur.isNull(2) ? 0L : cur.getLong(2);
                        boolean allDay = !cur.isNull(3) && cur.getInt(3) == 1;
                        int calId = cur.isNull(4) ? -1 : cur.getInt(4);
                        if (dtStart <= 0) continue;
                        evCount++;
                        /* 关键：不能只认全天事件。
                           国产机的节假日日历常把放假放在「定时事件」里（0 点起的也有），
                           一刀切掉 allDay=0 就永远读不到。 */
                        boolean trusted = holidayCalIds.contains(calId)
                                || looksLikeHolidayTitle(title);
                        if (!trusted) continue;
                        matched++;
                        /* 全天事件存 UTC 零点；定时事件是真实时刻，要用本地时区取日期。
                           dtend 对全天是「结束日零点」（不含），减 1ms 得到最后一天。 */
                        java.text.SimpleDateFormat fmt = allDay ? fmtUtc : fmtLocal;
                        String from = fmt.format(new java.util.Date(dtStart));
                        String to = fmt.format(new java.util.Date(
                                dtEnd > dtStart ? (dtEnd - 1) : dtStart));
                        if (to.compareTo(start) < 0 || from.compareTo(end) > 0) continue;
                        ranges.add("{\"from\":" + jsString(from)
                                + ",\"to\":" + jsString(to)
                                + ",\"name\":" + jsString(title) + "}");
                    }
                    cur.close();
                    cur = null;
                }

                StringBuilder sb = new StringBuilder();
                for (int k = 0; k < ranges.size(); k++) {
                    if (k > 0) sb.append(',');
                    sb.append(ranges.get(k));
                }
                /* 诊断信息一并回吐：扫到几个日历、几条事件、命中几条 ——
                   用户说「取不到」时，日志里能直接看出是没权限、没日历还是没命中。 */
                String payload = "{\"ranges\":[" + sb + "],\"cals\":" + calCount
                        + ",\"calHoliday\":" + holidayCalIds.size()
                        + ",\"events\":" + evCount
                        + ",\"matched\":" + matched + "}";
                android.util.Log.i("XueJing", "节假日扫描：日历 " + calCount + " 个（节假日类 "
                        + holidayCalIds.size() + "），事件 " + evCount + " 条，命中 " + matched + " 条");
                callbackHolidays(true, payload);
            } catch (Throwable t) {
                callbackHolidays(false, "读日历失败：" + t.getClass().getSimpleName()
                        + " / " + String.valueOf(t.getMessage()));
            } finally {
                if (cur != null) {
                    try { cur.close(); } catch (Throwable ignored) { }
                }
            }
        }).start();
    }

    private static String safe(String s) { return s == null ? "" : s; }

    private static boolean looksLikeHolidayCalendar(String blob) {
        String s = blob == null ? "" : blob.toLowerCase(java.util.Locale.US);
        return s.contains("节假日") || s.contains("法定") || s.contains("放假")
                || s.contains("holiday") || s.contains("休") || s.contains("假")
                || s.contains("china") || s.contains("cn");
    }

    private static boolean looksLikeHolidayTitle(String title) {
        if (title == null || title.isEmpty()) return false;
        String[] keys = {"元旦", "春节", "除夕", "正月", "元宵", "清明", "劳动", "五一",
                "端午", "七夕", "中秋", "国庆", "重阳", "腊八", "小年",
                "放假", "调休", "长假", "假期", "休"};
        for (String k : keys) if (title.contains(k)) return true;
        return false;
    }

    /** yyyy-MM-dd → UTC 毫秒。isStart 取当天零点，否则取次日零点（当上界） */
    private static long parseDayMillis(String day, boolean isStart) {
        if (day == null || day.length() < 10) {
            return System.currentTimeMillis();
        }
        try {
            java.text.SimpleDateFormat sdf =
                    new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US);
            sdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            long t = sdf.parse(day.substring(0, 10)).getTime();
            return isStart ? t : (t + 86400000L);
        } catch (Throwable ignored) {
            return System.currentTimeMillis();
        }
    }

    private void callbackHolidays(final boolean ok, final String payload) {
        String body = payload == null ? "[]" : payload;
        if (body.length() > 20000) body = body.substring(0, 20000) + "]";
        final String js = "window.onHolidaysFetched && window.onHolidaysFetched("
                + (ok ? "true" : "false") + "," + jsString(body) + ")";
        runOnUiThread(() -> evalJs(js));
    }

    private void evalJs(String js) {
        if (web == null) return;
        try { web.evaluateJavascript(js, null); } catch (Throwable ignored) { }
    }

    private void toast(final String msg) {
        runOnUiThread(() -> {
            try {
                android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_LONG).show();
            } catch (Throwable ignored) { }
        });
    }

    /** 闹钟触发时把事件转给页面（页面在前台时会直接弹应用内提醒卡） */
    static void forwardNativeAlert(final String kind) {
        forwardNativeAlert(kind, null, null);
    }

    static void forwardNativeAlert(final String kind, final String name, final String detail) {
        final MainActivity a = sRef.get();
        if (a == null) return;
        final String js = "window.onNativeClassAlert && window.onNativeClassAlert("
                + jsString(kind == null ? "start" : kind) + ","
                + jsString(name == null ? "" : name) + ","
                + jsString(detail == null ? "" : detail) + ")";
        a.runOnUiThread(() -> a.evalJs(js));
    }

    @Override
    protected void onNewIntent(@NonNull Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyWidgetTab();
    }

    /** 桌面小组件跳转：xuejing://widget?tab=schedule|notes|todos|chat|home */
    void applyWidgetTab() {
        try {
            Intent it = getIntent();
            if (it == null) return;
            Uri data = it.getData();
            if (data == null) return;
            String tab = data.getQueryParameter("tab");
            if (tab == null || tab.isEmpty()) return;
            if ("notes".equals(tab)) {
                evalJs("window.openNotes && window.openNotes()");
            } else if ("todos".equals(tab)) {
                evalJs("window.openTodos && window.openTodos()");
            } else if ("schedule".equals(tab)) {
                evalJs("window.openSchedule && window.openSchedule()");
            } else if ("chat".equals(tab)) {
                evalJs("window.go && window.go('chat')");
            } else {
                evalJs("window.go && window.go('home')");
            }
            it.setData(null);
        } catch (Throwable ignored) { }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        // 回到前台时重排一次提醒，避免长时间未打开后闹钟已经过期
        try { ReminderScheduler.rescheduleFromStore(this); } catch (Throwable ignored) { }
        ViewCompat.requestApplyInsets(root);
        setupSystemBars();
    }

    /* 从后台回来、弹完键盘、锁屏解锁之后，系统都可能把系统栏的外观改回去，这里再assert一次 */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) setupSystemBars();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onDestroy() {
        if (isFinishing()) {
            // 页面没了，计时也就无从推进，别留一条倒计时错乱的通知
            try { FocusService.stop(this); } catch (Throwable ignored) { }
        }
        if (web != null) {
            web.destroy();
            web = null;
        }
        if (sRef.get() == this) sRef = new WeakReference<>(null);
        super.onDestroy();
    }
}
