# 学径

> 书山有径而学海无涯，循此学径，读万卷书，行万里路。

一个**本地优先**的 Android 学习管理应用：课表、专注计时、上课提醒、待办、笔记、AI 对话与行程规划。
没有服务端，数据只存在你自己的手机上。

**XueJing** is a local-first Android study companion — timetable, focus timer, class reminders,
todos, notes, and optional AI chat / planning. There is no backend; everything stays on your device.

> **关于代码来源**
> 本项目几乎所有代码都是由 AI 生成的：由人提出需求、验收效果、修方向，AI 负责写实现。
> 写在这里是为了不误导后来的贡献者 —— 如果你发现代码风格特别整齐但缺少「人味」，原因就在这儿。
> 架构取舍和需求判断仍由人负责，但具体实现、注释、文档初稿基本出自 AI 之手。

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
    ClassAlarmReceiver    课前提醒
  app/src/main/assets/    构建时由 syncPrototype 写入 index.html
tools/                自测脚本（见下）
图标设计/              图标生成脚本与导出的各尺寸图标
技术框架.md            设计与架构笔记
```

## 自测

`tools/domtest.mjs` 用无头 Edge + DevTools 协议加载真实页面、点真实入口、做命中测试
（不是正则匹配字符串），跑完会列出每条断言：

```bash
node tools/domtest.mjs
```

约 50 条断言，覆盖页面层级、三级页可见性、提供商增删模型、峰谷计费、节假日区间、
引导流程、清空数据确认等。改完界面建议先跑一遍再打包。

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

本项目采用 [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）发布。

```
学径 / XueJing
Copyright (C) 2026 烟墟

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```

**关于 AGPL 第 13 条（网络交互）**：学径本身不提供任何网络服务，用户交互都发生在本地设备上，
所以这一条目前不构成额外义务。但如果你基于本项目改出**通过网络向用户提供服务**的版本，
该条款会要求你向这些用户提供对应版本的完整源代码。

## 贡献

欢迎提 Issue 和 PR。改完界面请先跑 `node tools/domtest.mjs` 确认没跑偏。

如果你遇到 bug 或对项目有任何建议，请直接提交 Issue，所有建议都会帮助学径变得更有用更懂你。
