# ClockNoteWidget — 时钟 + 便签 桌面小组件

Windows 桌面小工具，包含**两个完全独立的窗口**：

- **时钟窗口**：时:分（可选秒）+ 日期星期，每秒刷新，12/24 小时制可切换
- **便签窗口**：多条便签的新建/编辑/删除/颜色切换，输入自动保存（防抖 500ms），重启恢复

两个窗口各拖各的、各记各的位置，互不影响。无边框、半透明、可置顶、不占任务栏，托盘常驻。

> 数据只存本地（`%APPDATA%/clock-note-widget/` 下的 JSON 与 localStorage 文件），不联网、无账号、无云同步、无遥测。

## 运行（开发模式）

需要 Node.js（建议 18+）：

```bash
npm install --registry=https://registry.npmmirror.com --cache ./.npm-cache
# 若 electron 二进制下载失败，手动补一次：
cd node_modules/electron && ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node install.js && cd ../..
npm start
```

## 日常使用

| 操作 | 方式 |
|---|---|
| 移动窗口 | 按住窗口顶部 36px 拖动条空白处拖动（按钮、输入框、便签正文不会触发拖动） |
| 隐藏单个窗口 | 窗口右上角「✕」（只是隐藏，托盘可再唤回） |
| 显示/隐藏/退出 | 右键（或左键）任务栏托盘蓝色圆点图标 |
| 置顶开关 | 托盘菜单 → 「始终置顶」 |
| 透明度 | 托盘菜单 → 「透明度」（60% ~ 100%，对所有窗口生效） |

**关闭窗口 ≠ 退出程序**。退出只能通过托盘菜单 → 「退出」。

## 数据与位置记忆

- 窗口位置：两个窗口分别保存 x/y 到 `window-state.json`，重启还原；越界（如换显示器后坐标在屏幕外）自动回到主屏可见区域
- 时钟偏好（12/24 制、秒显隐）与便签内容、颜色：存在各窗口的 localStorage
- 全部为本地文件，删除 `%APPDATA%/clock-note-widget/` 即可彻底清空数据

## Windows 打包步骤

用 electron-builder 生成安装包（NSIS 安装版）和免安装 portable 版：

```bash
# 1. 安装打包工具（一次性）
npm install --save-dev electron-builder --registry=https://registry.npmmirror.com --cache ./.npm-cache

# 2. 打包（x64，输出到 dist/ 目录）
npm run dist
```

构建配置已写在 `package.json` 的 `build` 字段。产物：

- `dist/ClockNoteWidget Setup 0.4.0.exe` — 安装版，可选安装目录、创建开始菜单快捷方式
- `dist/ClockNoteWidget 0.4.0.exe` — 单文件便携版，双击即用

> 打包时 electron-builder 需下载 Electron 发行包，国内网络建议设置环境变量：
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（Windows PowerShell: `$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"`）

## 开机自启说明

本项目未内置自启开关（避免静默写注册表），如需开机启动，任选其一：

**方法 1：启动文件夹（推荐，免安装版同样适用）**

1. `Win + R` 输入 `shell:startup` 回车，打开当前用户启动文件夹
2. 把应用快捷方式放进去：
   - 安装版：右键开始菜单里的 ClockNoteWidget → 打开文件位置 → 右键快捷方式 → 复制，粘贴到启动文件夹
   - 便携版：右键 `ClockNoteWidget 0.4.0.exe` → 显示更多选项 → 发送到 → 桌面快捷方式，再把桌面快捷方式剪切到启动文件夹

**方法 2：任务管理器**

任务管理器 → 启动应用 → 找到 ClockNoteWidget（安装版才会出现在这里）→ 右键启用。

取消自启：从启动文件夹删除对应快捷方式即可。

## 项目结构

```
clock-note-widget/
├── main.js            # 主进程：双窗口、托盘、位置记忆、置顶/透明度
├── clock.html         # 时钟窗口页面
├── note.html          # 便签窗口页面
├── assets/tray.png    # 托盘图标
├── scripts/make-icon.js  # 本地生成托盘图标（无联网）
└── package.json       # 运行/打包配置
```

## 已知限制

- 无边框透明窗口在个别旧显卡驱动/远程桌面下可能显示黑底（Electron 已知问题）
- 便签删除为单击即删、无确认；无单条便签置顶、无时间戳
- 时钟无时区/字号设置
- 运行中拔掉副屏不会实时迁移窗口，重启后自动修正
