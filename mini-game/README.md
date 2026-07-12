# 黄金迷宫微信小游戏版

这是 PC Web 版 `黄金迷宫` 的微信小游戏移植目录。PC 版入口仍在项目根目录，小游戏入口在本目录。

## 导入微信开发者工具

1. 进入 `mini-game` 目录执行：

   ```bash
   npm install
   ```

2. 打开微信开发者工具。
3. 选择“导入项目”。
4. 项目目录选择：

   ```txt
   D:\github\maze-game\mini-game
   ```

5. AppID 可先使用测试号 / touristappid。
6. 导入后在微信开发者工具中执行“工具 -> 构建 npm”。
7. 选择横屏模拟器预览。

当前小游戏运行时直接引用 `src/vendor/three.js`，避免微信开发者工具对 `three` npm 包入口解析失败。vendor 版本固定为 Three.js `0.152.2`，该版本仍支持 WebGL1，真机兼容性比新版 WebGL2-only 路径更稳。`npm install` 用于记录和刷新依赖来源。

界面代码在 `src/MiniMazeGame.js` 的 `MiniHud` 类中。微信小游戏不是小程序页面，没有 WXML/WXSS；这里的按钮、摇杆、地图和弹层都绘制到 Three.js 的 HUD overlay scene 上。

## 移动端操作

- 启动时可选择简单、普通、困难三档难度，默认普通。
- 左下角按下后出现动态摇杆：控制角色移动。
- 摇杆轻推：慢走。
- 摇杆正常推：行走。
- 摇杆推到底：以更高的最大速度奔跑。
- 右半屏左右滑动：水平旋转视角。
- 右上角“音乐开 / 音乐关”：切换程序化沙漠遗迹背景音乐。
- 右侧按钮：地图、路线提示、自动寻路。
- 路线提示会从角色当前位置动态更新到出口。
- 到达出口后点击“再来一局”重新生成迷宫。
- 胜利后可以重新选择难度再开始。

## 功能保留

- 第三人称角色背后视角。
- 随机生成迷宫。
- 四角随机起点和出口。
- 墙体碰撞。
- 靠墙相机自动拉近、离墙慢速拉远。
- 俯瞰图。
- 路线提示。
- 自动寻路。
- 项目内置的程序化沙漠遗迹 MP3 音乐，通过微信 `InnerAudioContext` 循环播放。
- 靠近出口自动胜利。

## 当前验证

如需重新生成背景音乐：

```bash
npm run generate:music
```

- `npm install --ignore-scripts` 已在 `mini-game/` 下通过。
- `node --check mini-game\game.js` 已通过。
- `node --check mini-game\src\MiniMazeGame.js` 已通过。
- `node --check mini-game\src\wechat-adapter.js` 已通过。
- Three.js `0.152.2` 已 vendored 到 `src/vendor/three.js`，并保留 `src/vendor/THREE-LICENSE.txt`。
- 根目录 `pnpm run build` 已通过，PC Web 端仍可构建。

## 仍需真机确认

- 微信开发者工具 npm 构建后的 Three.js 兼容性。
- iOS / Android 真机横屏安全区。
- 低端机 GPU 性能与发热。
- 触摸手感，尤其是右侧滑动视角和靠墙相机拉远。
- 微信小游戏真机环境下 OffscreenCanvas 文本纹理兼容性。
