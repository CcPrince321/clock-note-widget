// B 站粉丝数据服务（主进程专用）
// 网络只请求 bilibili.com 域名；SESSDATA 与缓存只写本机 userData 目录，绝不上传、绝不进仓库
const https = require('https');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const STAT_URL = 'https://member.bilibili.com/x/web/index/stat';       // 创作中心：每日涨粉/掉粉（T+1）
const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';        // 校验登录态 + 取 UID
const RELATION_URL = 'https://api.bilibili.com/x/relation/stat?vmid=';  // 公开接口：实时粉丝总数

let configFile = null;
let cacheFile = null;
let config = { sessdata: '', mid: null };
let cache = emptyCache();
let onUpdated = null; // 数据更新回调（推送到粉丝窗口）

function emptyCache() {
  return {
    updatedAt: 0, date: '', follow: 0, unfollow: 0, totalFans: 0,
    todayDate: '', todayBaseline: null, todayNet: 0, error: '',
  };
}

function init(userDataDir, updatedCallback) {
  configFile = path.join(userDataDir, 'fans-config.json');
  cacheFile = path.join(userDataDir, 'fans-cache.json');
  onUpdated = updatedCallback;
  try {
    const c = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (c && typeof c === 'object') config = c;
  } catch { /* 首次运行，无配置文件 */ }
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c && typeof c === 'object') cache = { ...emptyCache(), ...c };
  } catch { /* 无缓存用默认值 */ }
  if (typeof config.sessdata !== 'string') config.sessdata = '';
  if (!config.mid) config.mid = null;
}

function saveJSON(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('[fans] 写入本地文件失败:', file, err.message);
  }
}

// 注意：绝不把完整 SESSDATA 回传给渲染层
function getConfig() {
  return {
    hasSessdata: !!config.sessdata,
    sessdataMask: config.sessdata
      ? config.sessdata.slice(0, 4) + '****' + config.sessdata.slice(-4)
      : '',
    mid: config.mid || null,
  };
}

function saveConfig(sessdata) {
  config.sessdata = String(sessdata || '').trim();
  config.mid = null; // 换凭证后重新解析 UID
  saveJSON(configFile, config);
  cache = emptyCache(); // 清空旧缓存，避免显示上一个账号的数据
  saveJSON(cacheFile, cache);
}

function clearConfig() {
  config = { sessdata: '', mid: null };
  saveJSON(configFile, config);
  cache = emptyCache();
  saveJSON(cacheFile, cache);
}

function getCache() {
  return { ...cache, ...getConfig() };
}

function requestJSON(url, cookie) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://member.bilibili.com/',
      'Origin': 'https://member.bilibili.com',
    };
    if (cookie) headers.Cookie = 'SESSDATA=' + cookie;
    const req = https.get(url, { headers, timeout: 12000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('响应不是合法 JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('请求超时（12 秒）')));
    req.on('error', reject);
  });
}

function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}

// 从近 30 天数据里取最新一个有数据的日期（key 形如 20261121）
function latestDay(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const keys = Object.keys(obj).filter((k) => /^\d{8}$/.test(k)).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

async function ensureMid() {
  if (config.mid) return config.mid;
  const nav = await requestJSON(NAV_URL, config.sessdata);
  if (nav.code !== 0 || !nav.data || !nav.data.mid) {
    throw new Error('SESSDATA 无效或已过期（请重新粘贴）');
  }
  config.mid = nav.data.mid;
  saveJSON(configFile, config);
  return config.mid;
}

async function refresh() {
  if (!config.sessdata) {
    cache = emptyCache();
    cache.error = '尚未配置 SESSDATA';
    cache.updatedAt = Date.now();
    saveJSON(cacheFile, cache);
    notify();
    return getCache();
  }

  const errors = [];
  let mid = null;
  try {
    mid = await ensureMid();
  } catch (err) {
    errors.push(err.message || '登录态校验失败');
  }

  if (mid) {
    // 1) 创作中心：每日涨粉 / 掉粉（T+1，次日中午更新）
    try {
      const stat = await requestJSON(STAT_URL, config.sessdata);
      if (stat.code === -101) throw new Error('SESSDATA 无效或已过期');
      if (stat.code !== 0 || !stat.data) throw new Error('创作中心返回异常：' + (stat.message || stat.code));
      const thirty = stat.data.fan_recent_thirty || {};
      const date = latestDay(thirty.follow) || latestDay(thirty.unfollow) || '';
      cache.date = date;
      cache.follow = date && thirty.follow ? Number(thirty.follow[date]) || 0 : 0;
      cache.unfollow = date && thirty.unfollow ? Number(thirty.unfollow[date]) || 0 : 0;
      const total = Number(stat.data.total_fans) || 0;
      if (total) cache.totalFans = total;
    } catch (err) {
      errors.push('每日分项：' + (err.message || '获取失败'));
    }

    // 2) 公开接口：实时粉丝总数 -> 本地累计「今日净变化」（基线当天有效，跨重启保留）
    try {
      const rel = await requestJSON(RELATION_URL + mid);
      if (rel.code === 0 && rel.data && Number.isFinite(rel.data.follower)) {
        const follower = rel.data.follower;
        const tk = todayKey();
        if (cache.todayDate !== tk || cache.todayBaseline === null) {
          cache.todayDate = tk;
          cache.todayBaseline = follower;
        }
        cache.todayNet = follower - cache.todayBaseline;
        if (!cache.totalFans) cache.totalFans = follower;
      } else {
        errors.push('粉丝总数：接口返回异常');
      }
    } catch (err) {
      errors.push('粉丝总数：' + (err.message || '获取失败'));
    }
  }

  cache.error = errors.join('；');
  cache.updatedAt = Date.now();
  saveJSON(cacheFile, cache);
  notify();
  return getCache();
}

function notify() {
  if (onUpdated) onUpdated(getCache());
}

function startTimers() {
  // 每 10 分钟刷新一次（创作中心 T+1 数据 + 今日净增采样）
  setInterval(() => { refresh().catch(() => {}); }, 10 * 60 * 1000);
}

module.exports = { init, saveConfig, clearConfig, getCache, refresh, startTimers };
