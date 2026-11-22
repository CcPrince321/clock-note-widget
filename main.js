const { app, BrowserWindow, Tray, Menu, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const fansService = require('./fans-service');

// ---------- 常量 ----------
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
const ICON_PATH = path.join(__dirname, 'assets', 'tray.png');

// 三个窗口定义：完全独立创建、独立保存位置，互不影响
const WINDOW_DEFS = {
  clock: { width: 320, height: 200, file: 'clock.html', resizable: false, offset: { x: 80, y: 80 } },
  note: { width: 360, height: 480, file: 'note.html', resizable: true, offset: { x: 440, y: 80 } },
  fans: { width: 300, height: 260, file: 'fans.html', resizable: false, offset: { x: 80, y: 300 } },
};

let clockWindow = null;
let noteWindow = null;
let fansWindow = null;
let tray = null;
let saveTimer = null;

function getWindow(key) {
  if (key === 'clock') return clockWindow;
  if (key === 'note') return noteWindow;
  if (key === 'fans') return fansWindow;
  return null;
}
function allWindows() {
  return [clockWindow, noteWindow, fansWindow];
}

// 全局设置（置顶、透明度），持久化在 window-state.json 的 settings 字段
const OPACITY_LEVELS = [1.0, 0.9, 0.8, 0.7, 0.6];
let settings = { alwaysOnTop: true, opacity: 1.0 };

function loadSettings() {
  const s = loadState().settings;
  if (s && typeof s === 'object') {
    if (typeof s.alwaysOnTop === 'boolean') settings.alwaysOnTop = s.alwaysOnTop;
    if (OPACITY_LEVELS.includes(s.opacity)) settings.opacity = s.opacity;
  }
}

// ---------- 状态存取（纯本地 JSON） ----------
function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE(), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveState() {
  const state = { settings };
  for (const key of Object.keys(WINDOW_DEFS)) {
    const win = getWindow(key);
    if (win && !win.isDestroyed()) {
      const b = win.getBounds();
      state[key] = { x: b.x, y: b.y, width: b.width, height: b.height };
    }
  }
  try {
    fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
    fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('保存窗口位置失败:', err);
  }
}

// 防抖 500ms 保存（窗口移动过程中不频繁写盘）
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveState();
  }, 500);
}

// ---------- 屏幕范围校验 ----------
// 要求窗口在某个显示器工作区内至少留有 40px 可见区域，否则视为越界
function isWithinScreens(b) {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    return (
      b.x + b.width > wa.x + 40 &&
      b.x < wa.x + wa.width - 40 &&
      b.y + b.height > wa.y + 40 &&
      b.y < wa.y + wa.height - 40
    );
  });
}

function resolveBounds(key, def) {
  const saved = loadState()[key];
  if (
    saved &&
    Number.isFinite(saved.x) &&
    Number.isFinite(saved.y) &&
    isWithinScreens(saved)
  ) {
    return {
      x: saved.x,
      y: saved.y,
      width: Math.min(Math.max(saved.width || def.width, 200), 2400),
      height: Math.min(Math.max(saved.height || def.height, 120), 2400),
    };
  }
  // 越界或无记录：回到主屏可见区域
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    x: wa.x + def.offset.x,
    y: wa.y + def.offset.y,
    width: def.width,
    height: def.height,
  };
}

// ---------- 窗口创建 ----------
function createWidgetWindow(key, def) {
  const bounds = resolveBounds(key, def);
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,             // 无边框
    transparent: true,        // 透明
    backgroundColor: '#00000000',
    alwaysOnTop: settings.alwaysOnTop, // 置顶（可在托盘切换）
    opacity: settings.opacity,          // 透明度（可在托盘调节）
    skipTaskbar: true,        // 不占任务栏
    resizable: def.resizable,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile(path.join(__dirname, def.file));

  // 恢复/显示：ready-to-show 时再显示，避免闪白
  win.once('ready-to-show', () => win.show());

  // 关闭窗口不退出程序，仅隐藏（退出只能走托盘菜单）
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  // 位置变化 -> 防抖保存
  win.on('move', scheduleSave);
  win.on('moved', scheduleSave);
  win.on('resize', scheduleSave);

  // 窗口显隐时刷新托盘菜单文案
  win.on('show', refreshTrayMenu);
  win.on('hide', refreshTrayMenu);

  return win;
}

// ---------- 页面请求调整自身窗口尺寸（内容变化时自动适配，避免被裁切） ----------
ipcMain.on('widget:resize', (e, payload) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return;
  const width = Math.round(Number(payload && payload.width));
  const height = Math.round(Number(payload && payload.height));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  const b = win.getBounds();
  if (b.width === width && b.height === height) return; // 尺寸没变就不动，避免无谓的重排
  win.setBounds({
    x: b.x,
    y: b.y,
    width: Math.min(Math.max(width, 160), 1200),
    height: Math.min(Math.max(height, 100), 1200),
  });
});

// ---------- B 站粉丝窗口 IPC（凭证只在主进程落地，绝不回传完整值） ----------
ipcMain.handle('fans:get-state', () => fansService.getCache());
ipcMain.handle('fans:set-sessdata', async (_e, value) => {
  fansService.saveConfig(value);
  return await fansService.refresh();
});
ipcMain.handle('fans:clear', () => {
  fansService.clearConfig();
  return fansService.getCache();
});
ipcMain.handle('fans:refresh', async () => await fansService.refresh());

function pushFansUpdate(data) {
  if (fansWindow && !fansWindow.isDestroyed()) {
    fansWindow.webContents.send('fans:updated', data);
  }
}

// ---------- 托盘 ----------
function buildTrayMenu() {
  const labels = { clock: '时钟窗口', note: '便签窗口', fans: 'B站粉丝窗口' };
  const items = Object.keys(WINDOW_DEFS).map((key) => {
    const win = getWindow(key);
    const visible = win && win.isVisible();
    return {
      label: (visible ? '隐藏' : '显示') + labels[key],
      click: () => toggleWindow(key),
    };
  });
  return Menu.buildFromTemplate([
    ...items,
    { type: 'separator' },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: (item) => {
        settings.alwaysOnTop = item.checked;
        applyAlwaysOnTop();
        saveState();
      },
    },
    {
      label: '透明度',
      submenu: OPACITY_LEVELS.map((v) => ({
        label: Math.round(v * 100) + '%',
        type: 'radio',
        checked: settings.opacity === v,
        click: () => {
          settings.opacity = v;
          applyOpacity();
          saveState();
        },
      })),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ]);
}

function applyAlwaysOnTop() {
  for (const win of allWindows()) {
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  }
}

function applyOpacity() {
  for (const win of allWindows()) {
    if (win && !win.isDestroyed()) win.setOpacity(settings.opacity);
  }
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function toggleWindow(key) {
  const win = getWindow(key);
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
  }
}

function createTray() {
  tray = new Tray(ICON_PATH);
  tray.setToolTip('时钟 + 便签 + B站粉丝');
  tray.setContextMenu(buildTrayMenu());
  // Windows 上左键点击托盘也弹出菜单
  tray.on('click', () => tray.popUpContextMenu());
}

// ---------- 应用生命周期 ----------
// 单实例锁：重复启动时唤起已有实例的窗口，而不是再开一套进程（避免托盘图标与数据写入冲突）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 用户再次双击 exe：把三个窗口都显示出来
    for (const win of allWindows()) {
      if (win && !win.isDestroyed()) win.show();
    }
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.local.clock-note-widget'); // 任务管理器/通知里显示正确应用名
  loadSettings();
  clockWindow = createWidgetWindow('clock', WINDOW_DEFS.clock);
  noteWindow = createWidgetWindow('note', WINDOW_DEFS.note);
  fansWindow = createWidgetWindow('fans', WINDOW_DEFS.fans);
  // 窗口创建后再统一应用透明度（BrowserWindow 构造参数不含 opacity 的兼容写法）
  applyOpacity();
  createTray();

  // B 站粉丝数据服务：凭证与缓存只写本机 userData；仅在用户配置 SESSDATA 后才联网
  fansService.init(app.getPath('userData'), pushFansUpdate);
  fansWindow.webContents.on('did-finish-load', () => {
    if (!fansWindow.isDestroyed()) {
      fansWindow.webContents.send('fans:updated', fansService.getCache());
    }
  });
  fansService.refresh().catch(() => {}); // 启动拉一次（未配置则只标记待配置，不发网络请求）
  fansService.startTimers();             // 每 10 分钟自动刷新
});

// 所有关闭都被拦截为 hide，不会真正触发这里；留作兜底，避免托盘应用被误退
app.on('window-all-closed', () => {
  // 保持运行（托盘常驻）
});

app.on('before-quit', () => {
  app.isQuitting = true;
  saveState(); // 退出前落盘三个窗口的位置
});

app.on('quit', () => {
  if (saveTimer) clearTimeout(saveTimer);
});
