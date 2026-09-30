# 学径 · Android 壳工程

把 `../index.html` 这一份原型直接装进 WebView 打成 APK。页面本身就是完整实现，
壳只做四件事：**全屏、开 JS + DOM 存储、软键盘适配、返回键回传给页面**。

## 产物

```
app/build/outputs/apk/release/app-release.apk     ← 已签名，可直接安装
```

## 安装

```bash
# 手机开 USB 调试后
adb install -r app/build/outputs/apk/release/app-release.apk
```

或把 APK 传到手机上直接点击安装（需允许「安装未知来源应用」）。

## 重新构建

`index.html` 改了之后，必须重新同步到 assets，否则打进包里的还是旧版本：

```bash
cp ../index.html app/src/main/assets/index.html
```

然后构建（本机用的是 `~/.gradle` 里已缓存的 Gradle 8.14）：

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot"
./gradlew assembleRelease      # 首次运行会自动补 gradle-wrapper
```

产物：`app/build/outputs/apk/release/app-release.apk`

装到手机上想直接看效果也可以：`./gradlew installRelease`

## 关键配置

| 项 | 值 | 说明 |
| --- | --- | --- |
| 包名 | `com.xuejing.app` | |
| minSdk | 26 | Android 8.0+，为了用自适应图标（矢量，不用切 PNG） |
| targetSdk / compileSdk | 36 | |
| AGP / Gradle | 8.13.0 / 8.14 | |
| 签名 | `app/xuejing.jks`（alias `xuejing`，口令 `xuejing123`） | **仅用于本地调试分发**，上架前务必换成自己的密钥并妥善保管 |

## 几个设计取舍

**为什么是 WebView 而不是原生？** 原型已经是完整的 HTML/CSS/JS，WebView 壳能保证
「设计稿 = 真机效果」零偏差，改一版 UI 不用重新编译两套代码。等要接系统能力
（本地通知、课表日历写入、Keychain）时，再按 `技术框架.md` 里的路线做原生模块替换。

**状态栏**：`FLAG_FULLSCREEN` 隐藏了系统状态栏 —— 因为页面里自己画了一条（时间 / 5G / 电量，
时间是 JS 实时取的）。两条同时出现会很怪。底部导航栏保留系统手势条，避免全屏手势冲突。

**`index.html?app=1`**：这个参数让页面切到「真机模式」—— 去掉 390×820 的手机壳、
圆角和投影，改成铺满整个视口。在浏览器里直接打开 `index.html`（不带参数）仍是
带外壳的原型稿，方便你在电脑上给别人演示。

**返回键**：先调页面里的 `window.androidBack()`。它按顺序检查：弹层 → 上课/下课提醒卡 →
专注全屏视图 → 导入课表视图。都没开才真正退出 App。
