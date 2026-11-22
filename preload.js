// 预加载脚本：向页面暴露最小能力接口（contextIsolation 保持开启）
const { contextBridge, ipcRenderer } = require('electron');

// 通用：页面请求调整自己所在窗口的尺寸（保持左上角位置不变）
contextBridge.exposeInMainWorld('widgetApi', {
  resize: (width, height) => ipcRenderer.send('widget:resize', { width, height }),
});

// B 站粉丝窗口专用：状态读取 / 凭证管理 / 手动刷新 / 主进程推送
contextBridge.exposeInMainWorld('fansApi', {
  getState: () => ipcRenderer.invoke('fans:get-state'),
  setSessdata: (value) => ipcRenderer.invoke('fans:set-sessdata', value),
  clear: () => ipcRenderer.invoke('fans:clear'),
  refresh: () => ipcRenderer.invoke('fans:refresh'),
  onUpdated: (callback) => {
    ipcRenderer.on('fans:updated', (_event, data) => callback(data));
  },
});
