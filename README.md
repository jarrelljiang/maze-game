# 黄金迷宫

一个基于 Vite + Vue 3 + TypeScript + Three.js 的第一人称 3D 迷宫游戏。场景风格为明亮温暖的金黄色沙漠遗迹，包含可重复生成迷宫、第一人称鼠标视角、键盘移动、碰撞检测、出口胜利判定和完整 UI。

## 启动

```bash
pnpm install
pnpm run dev
```

如果 Windows 环境提示 pnpm junction / untrusted mount point，可临时使用：

```powershell
$env:PNPM_CONFIG_NODE_LINKER="hoisted"; pnpm install
$env:PNPM_CONFIG_NODE_LINKER="hoisted"; pnpm run dev
```

如需重新生成本地贴图资源：

```bash
pnpm run generate:textures
```

生成的贴图位于 `public/assets/textures/`。

## 操作

- `W` / `↑`：前进
- `S` / `↓`：后退
- `A` / `←`：左移
- `D` / `→`：右移
- `Shift`：短暂加速
- `M`：显示 / 隐藏辅助路线
- `R`：重置到当前迷宫起点
- `Esc`：释放鼠标并暂停
- 鼠标移动：调整视角

## 功能

- 默认第一人称相机，点击开始后启用 Pointer Lock。
- DFS 回溯生成 `S / E / 0 / 1` 二维数组迷宫，并保证起点到终点可达。
- 简单、普通、困难三档难度，对应不同地图尺寸和开孔程度。
- 网格碰撞检测，按 X/Z 分轴移动以支持贴墙滑动。
- InstancedMesh 批量渲染砂岩墙体，支持阴影、雾效、暖色天空和终点光效。
- HUD、开始界面、暂停界面和胜利弹窗均为金色遗迹主题。
- 资源文件缺失时，运行时会生成 Canvas 兜底纹理，确保项目仍可运行。
