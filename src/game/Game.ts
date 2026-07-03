import * as THREE from 'three';
import { AssetManager } from './AssetManager';
import { CollisionSystem } from './CollisionSystem';
import { DIFFICULTIES } from './constants';
import { Effects } from './Effects';
import { Maze } from './Maze';
import { PlayerController } from './PlayerController';
import type { Difficulty, GameCallbacks, HudState } from '../types';

export class Game {
  private readonly scene = new THREE.Scene();

  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 520);

  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });

  private readonly clock = new THREE.Clock();

  private readonly assets = new AssetManager();

  private readonly collision = new CollisionSystem();

  private readonly effects = new Effects(this.assets);

  private readonly player: PlayerController;

  private maze?: Maze;

  private difficulty: Difficulty = 'normal';

  private animationId = 0;

  private playing = false;

  private won = false;

  private routeVisible = false;

  private elapsedMs = 0;

  private timerBase = performance.now();

  private initialized = false;

  /** 初始化 Three.js 基础对象并绑定控制器。 */
  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: GameCallbacks,
  ) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.player = new PlayerController(this.camera, this.renderer.domElement, this.collision, {
      onReset: () => this.resetCurrentMaze(),
      onToggleRoute: () => this.toggleRoute(),
    });
    this.scene.add(this.player.rig, this.player.character.group);
    this.registerEvents();
  }

  /** 异步加载资源并启动渲染循环。 */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    await this.assets.load();
    this.setupScene();
    this.createMaze('normal');
    this.resize();
    this.loop();
  }

  /** 从开始界面进入新游戏。 */
  startNewGame(difficulty: Difficulty): void {
    this.createMaze(difficulty);
    this.elapsedMs = 0;
    this.timerBase = performance.now();
    this.won = false;
    this.playing = true;
    this.player.enable();
    this.player.lockPointer();
    this.callbacks.onResume();
  }

  /** 从暂停界面继续当前迷宫。 */
  resume(): void {
    if (this.won) {
      return;
    }
    this.timerBase = performance.now() - this.elapsedMs;
    this.playing = true;
    this.player.enable();
    this.player.lockPointer();
    this.callbacks.onResume();
  }

  /** 暂停游戏，并在需要时显示暂停层。 */
  pause(showOverlay = true): void {
    if (!this.playing || this.won) {
      return;
    }
    this.elapsedMs = performance.now() - this.timerBase;
    this.playing = false;
    this.player.disable();
    if (showOverlay) {
      this.callbacks.onPause();
    }
  }

  /** 回到当前迷宫起点，并重置计时和路线状态。 */
  resetCurrentMaze(): void {
    if (!this.maze) {
      return;
    }
    const start = this.maze.getStartWorld();
    this.player.reset(start, -Math.PI / 2);
    this.elapsedMs = 0;
    this.timerBase = performance.now();
    this.won = false;
  }

  /** 重新生成当前难度迷宫并立即开始探索。 */
  regenerateMaze(): void {
    this.startNewGame(this.difficulty);
  }

  /** 返回开始界面时停止控制并释放鼠标。 */
  returnToMenu(): void {
    this.pause(false);
    this.player.unlockPointer();
    this.player.disable();
    this.won = false;
  }

  /** 设置鼠标灵敏度。 */
  setSensitivity(value: number): void {
    this.player.setSensitivity(value);
  }

  /** 切换辅助路线提示。 */
  toggleRoute(): void {
    this.routeVisible = !this.routeVisible;
    this.maze?.setRouteVisible(this.routeVisible);
  }

  /** 销毁渲染器和事件循环。 */
  dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.maze?.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  /** 创建光照、雾和天空背景。 */
  private setupScene(): void {
    this.scene.background = new THREE.Color(0xffd79a);
    this.scene.fog = new THREE.FogExp2(0xffd89f, 0.011);
    this.scene.add(this.effects.createSkyDome());

    const hemi = new THREE.HemisphereLight(0xfff3ca, 0x8d6230, 1.7);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0bf, 3.15);
    sun.position.set(-22, 34, -18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -65;
    sun.shadow.camera.right = 65;
    sun.shadow.camera.top = 65;
    sun.shadow.camera.bottom = -65;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0xf0b15e, 0.45);
    fill.position.set(18, 8, 16);
    this.scene.add(fill);
    this.scene.add(this.effects.group);
  }

  /** 创建或替换迷宫地图和终点特效。 */
  private createMaze(difficulty: Difficulty): void {
    if (this.maze) {
      this.scene.remove(this.maze.group);
      this.maze.dispose();
    }
    this.difficulty = difficulty;
    this.routeVisible = false;
    this.maze = new Maze(difficulty, this.assets, Date.now() % 100000000);
    this.scene.add(this.maze.group);
    this.effects.rebuildForMaze(this.maze);
    this.resetCurrentMaze();
  }

  /** 注册窗口尺寸和鼠标锁定状态监听。 */
  private registerEvents(): void {
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.renderer.domElement;
      if (!locked && this.playing && !this.won) {
        this.pause(true);
      }
    });
  }

  /** 根据容器尺寸更新渲染器和相机比例。 */
  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /** requestAnimationFrame 主循环。 */
  private loop = (): void => {
    this.animationId = requestAnimationFrame(this.loop);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

    if (this.maze) {
      if (this.playing && !this.won) {
        this.elapsedMs = performance.now() - this.timerBase;
        this.player.update(delta, this.maze, DIFFICULTIES[this.difficulty].speedMultiplier);
        this.checkVictory();
      }
      this.effects.update(delta, elapsed);
      this.emitHud();
    }

    this.renderer.render(this.scene, this.camera);
  };

  /** 检查玩家是否到达出口。 */
  private checkVictory(): void {
    if (!this.maze) {
      return;
    }
    const end = this.maze.getEndWorld();
    const dx = this.player.rig.position.x - end.x;
    const dz = this.player.rig.position.z - end.z;
    if (Math.hypot(dx, dz) < 1.55) {
      this.won = true;
      this.playing = false;
      this.player.disable();
      this.player.unlockPointer();
      this.effects.playVictoryBurst();
      this.callbacks.onVictory({
        elapsedMs: this.elapsedMs,
        distance: this.player.getDistance(),
        difficulty: this.difficulty,
      });
    }
  }

  /** 推送 HUD 所需的轻量状态。 */
  private emitHud(): void {
    const state: HudState = {
      elapsedMs: this.elapsedMs,
      distance: this.player.getDistance(),
      difficulty: this.difficulty,
      heading: this.player.getHeading(),
      routeVisible: this.routeVisible,
    };
    this.callbacks.onHudUpdate(state);
  }
}
