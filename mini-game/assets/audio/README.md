# 背景音乐资源

## 文件说明

- `desert-ruins-loop.mp3`：原程序化背景音乐，保留作为备用。
- `desert-theme-cc0.mp3`：当前游戏实际使用的沙漠主题背景音乐。
- `victory-fanfare-cc0.mp3`：到达出口时播放的短胜利号角音效。

## 手动替换

游戏当前在 `mini-game/src/MiniMazeGame.js` 中加载 `assets/audio/desert-theme-cc0.mp3`。

如需恢复原程序化音乐，可以将代码中的音频路径改回：

```js
assets/audio/desert-ruins-loop.mp3
```

## 备用音乐来源与授权

- 曲名：Desert theme（原文件名 `caravan.ogg.ogg`）
- 作者：yd
- 来源：https://opengameart.org/content/desert-theme
- 授权：CC0 1.0（公共领域，无需署名）
- 授权地址：https://creativecommons.org/publicdomain/zero/1.0/

项目中的 MP3 是从作者提供的 OGG 文件转码得到的，仅转换格式，未修改音乐内容。

## 胜利音效来源与授权

- 曲名：Victory Fanfare（原文件名 `fanfare1.mp3`）
- 作者：ARoachIFoundOnMyPillow
- 来源：https://opengameart.org/content/victory-fanfare
- 授权：CC0 1.0（公共领域，无需署名）
- 授权地址：https://creativecommons.org/publicdomain/zero/1.0/
