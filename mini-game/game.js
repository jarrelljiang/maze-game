require('./src/wechat-adapter');

const { MiniMazeGame } = require('./src/MiniMazeGame');

let runtimeErrorShown = false;

/** 在真机没有控制台时，把首个启动错误直接弹到屏幕上。 */
function showRuntimeError(message) {
  if (runtimeErrorShown || typeof wx === 'undefined' || !wx.showModal) return;
  runtimeErrorShown = true;
  wx.showModal({
    title: '启动失败',
    content: String(message).slice(0, 500),
    showCancel: false,
  });
}

if (typeof wx !== 'undefined' && wx.onError) {
  wx.onError((message) => {
    console.error('[GoldenMazeMini] runtime error', message);
    showRuntimeError(message);
  });
}

/** 入口处尽早捕获主画布，避免后续模块误用非显示 Canvas。 */
function getBootCanvas() {
  if (typeof wx === 'undefined') return undefined;
  const globalScope = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  const existingCanvas = globalScope.canvas || globalThis.canvas || (typeof canvas !== 'undefined' ? canvas : undefined);
  const mainCanvas = existingCanvas || wx.createCanvas();
  try {
    globalScope.canvas = mainCanvas;
  } catch (error) {
    // 开发者工具可能把 canvas 暴露为只读字段；只要 mainCanvas 已拿到即可继续。
  }
  return mainCanvas;
}

try {
  const game = new MiniMazeGame(getBootCanvas());
  game.start();
} catch (error) {
  console.error('[GoldenMazeMini] start failed', error);
  showRuntimeError(error && error.stack ? error.stack : error);
}
