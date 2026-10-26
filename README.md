# 学径

> **本项目已归档，不再维护。** 最终版本 **v1.0.0**（MIT 协议）。
> 代码与安装包会继续保留，可自由下载、使用、修改。

> 书山有径而学海无涯，循此学径，读万卷书，行万里路。

一个**本地优先**的 Android 学习管理应用：课表、专注计时、上课提醒、待办、笔记、AI 对话与行程规划。
没有服务端，数据只存在你自己的手机上。

**XueJing** is a local-first Android study companion — timetable, focus timer, class reminders,
todos, notes, and optional AI chat / planning. There is no backend; everything stays on your device.

> **关于代码来源**
> 本项目的主要代码由 AI 编写。如果您对于 AI 生成的代码不信任或不满意，可以选择拒绝使用该应用。
> 目前本应用的开发仅由我一人提出意见和建议，实际实现均交由 AI 完成。
> 因此出现一定 bug 和部分功能的不完善是难以避免的问题，如果对您的使用造成影响请见谅。

---

## 功能

- **课表**：手动录入 / 对话式录入 / 识图导入；单双周、课程优先级、完整课表宫格与列表
- **专注**：番茄钟与上课专注，前台服务计时，可收起成可拖动的悬浮块，一键进专注页
- **提醒**：课前系统通知、精确闹钟、上课静音；重启后自动重排
- **节假日**：读**系统日历**的法定节假日，放假当天的课自动隐藏；支持按日期范围手动增删
- **AI**：自带多渠道（DeepSeek / 硅基流动 / 智谱 GLM / 通义千问 / 任意 OpenAI 兼容），可新增提供商
  - 每个渠道独立的 Base URL、API Key、可用模型名单（拉取后自行增删）
  - 各功能（对话、总结、规划、识图、播报）可分别绑定不同渠道与模型
  - 每渠道 × 每模型单独定价，支持**峰谷两套价**，自动统计 Token 与花费
- **记忆与技能**：对话中自动沉淀长期记忆，可手动增删
- **备份**：学习数据与 AI 配置分成两份导出，换机时不把 API Key 一起带走

## 构建

需要 Android Studio（或命令行 Android SDK）+ JDK 17。

```bash
git clone https://github.com/yyygssr/xuejing.git
cd xuejing/android
./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

`index.html` 是完整的应用实现（单文件 WebView 壳工程），构建时会自动同步进
`android/app/src/main/assets/`（见 `syncPrototype` 任务），改完原型直接打包即可。

### 打 release 包

签名信息**不进仓库**。在 `android/local.properties` 里补上（这个文件已被 `.gitignore` 排除）：

```properties
sdk.dir=/path/to/Android/Sdk
storeFile=xuejing.jks
storePassword=***
keyAlias=xuejing
keyPassword=***
```

然后：

```bash
./gradlew assembleRelease
```

没配签名也能正常出 debug 包，不会因为缺私钥而卡住。

## 项目结构

```
index.html            应用本体（页面 + 样式 + 脚本都在这一个文件里）
android/              安卓壳：WebView、通知、闹钟、前台服务、原生桥
  app/src/main/java/com/xuejing/app/
    MainActivity.java     壳的主体：WebView、返回手势、文件选择、网络代理
    NativeBridge.java     页面 → 原生的唯一通道
    FocusService.java     专注计时前台服务
    FocusStore.java       专注会话落盘：杀后台后仍能补记
    ClassAlarmReceiver.java 课前提醒
  app/src/main/assets/    构建时由 syncPrototype 写入 index.html
tools/                自测脚本（见下）
图标设计/              图标生成脚本与导出的各尺寸图标
技术框架.md            设计与架构笔记
CHANGELOG.md          更新日志
```

## 自测

`tools/domtest.mjs` 用无头 Edge + DevTools 协议加载真实页面、点真实入口、做命中测试
（不是正则匹配字符串），跑完会列出每条断言：

```bash
node tools/domtest.mjs
```

断言覆盖返回层级、提供商增删模型、峰谷计费、节假日区间与补课/停课、专注重启补记与
预约边界、笔记的单双列与选区样式、手写底栏不遮画布、弹层渲染完备性、清空数据确认等
（条数一直在涨，这里不写死，跑一次看输出就行）。改完界面建议先跑一遍再打包。

`tools/audit.mjs` 是配套的架构守卫：对账「页面推给原生的字段」与「原生实际读取的字段」，
防止两边悄悄分叉。domtest 会一并跑它。

## 隐私

完整政策在应用内「关于 → 隐私政策」，这里只说要点：

- **学径没有服务器。** 课表、待办、笔记、专注记录、设置只存在本机。
- **不用 AI 时完全离线。** 手动录课表、番茄钟、上课提醒、节假日都不联网。
- **用 AI 时，内容会发给你自己配的服务商。** 你填了谁家的 Key，对话内容与学习档案摘要就发给谁家，
  怎么用、留多久由该服务商的政策决定。配置前请自行了解并选择可信的服务商。
- **API Key 只存本机**，仅用于向你填的那个地址鉴权。
- **日历只读**，用于知道哪天放假、隐藏当天的课，不会修改你的日历。
- 不收集通讯录、短信、位置、设备识别码或任何用户画像数据。

## 开源协议

本项目采用 [MIT License](LICENSE) 发布。

```
学径 / XueJing
Copyright (c) 2026 yyygssr

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```

简单说：**你可以拿去做任何事** —— 商用、闭源、修改、再发布，都不需要经过同意，
只需保留上面的版权声明。

> **历史说明**：v0.4.x 及更早版本以 AGPL-3.0 发布，该授权不可撤销；
> 自 v1.0.0 起改为 MIT。如果你使用的是旧版本，仍适用当时的 AGPL-3.0。

## 贡献

欢迎提 Issue 和 PR。改完界面请先跑 `node tools/domtest.mjs` 确认没跑偏。

如果你遇到 bug 或对项目有任何建议，请直接提交 Issue，所有建议都会帮助学径变得更有用更懂你。
