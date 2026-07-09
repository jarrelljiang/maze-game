/** 为 Three.js 补齐微信小游戏环境里缺失的最小浏览器接口。 */
function installWechatAdapter() {
  if (typeof wx === 'undefined') return;
  const globalScope = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  const noop = () => {};
  const documentFallback = {
    createElement: () => wx.createCanvas(),
    createElementNS: () => wx.createCanvas(),
    addEventListener: noop,
    removeEventListener: noop,
  };

  safeInstallGlobal(globalScope, 'window', globalScope);
  safeInstallGlobal(globalScope, 'navigator', { userAgent: 'WeChat MiniGame' });
  safeInstallGlobal(globalScope, 'document', documentFallback);
  safeInstallGlobal(globalScope, 'requestAnimationFrame', (callback) => setTimeout(() => callback(Date.now()), 16));
  safeInstallGlobal(globalScope, 'cancelAnimationFrame', (id) => clearTimeout(id));
}

/** 只在全局属性缺失时补齐，避免覆盖开发者工具里只读的 window/document getter。 */
function safeInstallGlobal(target, key, value) {
  try {
    if (typeof target[key] !== 'undefined') return;
  } catch (error) {
    // 少数运行时读取 getter 也可能抛错，继续尝试安装兜底值。
  }

  try {
    Object.defineProperty(target, key, {
      configurable: true,
      writable: true,
      value,
    });
  } catch (error) {
    try {
      target[key] = value;
    } catch (assignError) {
      // 开发者工具可能提供只读同名属性；已有运行时对象可继续被 Three.js 使用。
    }
  }
}

installWechatAdapter();
