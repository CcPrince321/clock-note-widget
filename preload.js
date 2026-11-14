// 预加载脚本：向页面暴露最小能力的窗口尺寸调整接口（contextIsolation 保持开启）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetApi', {
  // 请求调整自己所在窗口的尺寸（保持左上角位置不变）
  resize: (width, height) => ipcRenderer.send('widget:resize', { width, height }),
});
