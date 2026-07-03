<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { Game } from './game/Game';
import { UIManager } from './game/UIManager';
import type { Difficulty, HudState, VictoryStats } from './types';

type OverlayState = 'start' | 'playing' | 'pause' | 'victory';

const gameRoot = ref<HTMLElement | null>(null);
const overlay = ref<OverlayState>('start');
const selectedDifficulty = ref<Difficulty>('normal');
const sensitivity = ref(1);
const loading = ref(true);
const guideVisible = ref(false);
const victory = ref<VictoryStats | null>(null);
let guideTimer = 0;
let game: Game | null = null;

const hud = reactive<HudState>({
  elapsedMs: 0,
  distance: 0,
  difficulty: 'normal',
  heading: 'N',
  routeVisible: false,
});

const difficultyOptions: Difficulty[] = ['easy', 'normal', 'hard'];

const hudTime = computed(() => UIManager.formatTime(hud.elapsedMs));
const difficultyLabel = computed(() => UIManager.difficultyLabel(hud.difficulty));
const victoryTime = computed(() => (victory.value ? UIManager.formatTime(victory.value.elapsedMs) : '00:00'));
const victoryDifficulty = computed(() => (victory.value ? UIManager.difficultyLabel(victory.value.difficulty) : '普通'));

/** 显示短暂操作提示，引导首次探索。 */
function showGuide(): void {
  guideVisible.value = true;
  window.clearTimeout(guideTimer);
  guideTimer = window.setTimeout(() => {
    guideVisible.value = false;
  }, 3000);
}

/** 从开始界面或胜利界面启动一局新迷宫。 */
function startGame(difficulty = selectedDifficulty.value): void {
  if (!game || loading.value) {
    return;
  }
  selectedDifficulty.value = difficulty;
  victory.value = null;
  overlay.value = 'playing';
  game.startNewGame(difficulty);
  showGuide();
}

/** 从暂停层继续当前游戏。 */
function continueGame(): void {
  if (!game) {
    return;
  }
  overlay.value = 'playing';
  game.resume();
  showGuide();
}

/** 重置当前地图中的玩家位置。 */
function resetPosition(): void {
  game?.resetCurrentMaze();
  continueGame();
}

/** 重新生成当前难度的迷宫。 */
function regenerateMaze(): void {
  if (!game) {
    return;
  }
  overlay.value = 'playing';
  game.regenerateMaze();
  showGuide();
}

/** 回到开始界面并停止当前控制。 */
function backToStart(): void {
  game?.returnToMenu();
  overlay.value = 'start';
  victory.value = null;
}

/** 胜利后提高一档难度，最高保持困难。 */
function raiseDifficulty(): void {
  const next = UIManager.nextDifficulty(victory.value?.difficulty ?? selectedDifficulty.value);
  startGame(next);
}

watch(sensitivity, (value) => {
  game?.setSensitivity(value);
});

onMounted(async () => {
  if (!gameRoot.value) {
    return;
  }
  game = new Game(gameRoot.value, {
    onHudUpdate: (state) => Object.assign(hud, state),
    onPause: () => {
      if (overlay.value === 'playing') {
        overlay.value = 'pause';
      }
    },
    onResume: () => {
      overlay.value = 'playing';
    },
    onVictory: (stats) => {
      victory.value = stats;
      overlay.value = 'victory';
    },
  });
  await game.initialize();
  game.setSensitivity(sensitivity.value);
  loading.value = false;
});

onBeforeUnmount(() => {
  window.clearTimeout(guideTimer);
  game?.dispose();
});
</script>

<template>
  <main class="game-shell">
    <section ref="gameRoot" class="game-stage" aria-label="黄金迷宫 3D 游戏画面"></section>

    <div v-if="overlay === 'playing'" class="hud" aria-live="polite">
      <div class="hud-panel hud-left">
        <span class="hud-kicker">TIME</span>
        <strong>{{ hudTime }}</strong>
        <span>{{ hud.distance.toFixed(1) }} m</span>
      </div>
      <div class="hud-panel hud-right">
        <span class="hud-kicker">DIFFICULTY</span>
        <strong>{{ difficultyLabel }}</strong>
        <span>{{ hud.heading }} · {{ hud.routeVisible ? '路线已显示' : '路线隐藏' }}</span>
      </div>
      <div class="crosshair" aria-hidden="true"></div>
      <div v-if="guideVisible" class="guide-toast">
        <strong>按住鼠标左键拖动视角</strong>
        <span>WASD / 方向键移动角色，Shift 奔跑，M 路线提示，R 重置</span>
      </div>
    </div>

    <section v-if="overlay === 'start'" class="overlay start-overlay">
      <div class="hero-copy">
        <p class="eyebrow">SUNSTONE LABYRINTH</p>
        <h1>黄金迷宫</h1>
        <h2>迷失于沉没的迷宫</h2>
        <p>探索古老砂岩迷宫，沿着暖色阳光与远处金色光柱找到出口。</p>
      </div>

      <div class="glass-panel start-panel">
        <div class="difficulty-tabs" role="radiogroup" aria-label="难度选择">
          <button
            v-for="difficulty in difficultyOptions"
            :key="difficulty"
            class="tab-button"
            :class="{ active: selectedDifficulty === difficulty }"
            type="button"
            @click="selectedDifficulty = difficulty"
          >
            {{ UIManager.difficultyLabel(difficulty) }}
          </button>
        </div>
        <button class="primary-button" type="button" :disabled="loading" @click="startGame()">
          {{ loading ? '载入遗迹...' : '开始游戏' }}
        </button>
        <div class="control-grid">
          <span>WASD / 方向键</span><strong>移动</strong>
          <span>鼠标左键</span><strong>按住观察</strong>
          <span>Shift</span><strong>奔跑</strong>
          <span>M / R / Esc</span><strong>路线 / 重置 / 暂停</strong>
        </div>
      </div>
    </section>

    <section v-if="overlay === 'pause'" class="overlay compact-overlay">
      <div class="glass-panel menu-panel">
        <p class="eyebrow">PAUSED</p>
        <h2>探索暂停</h2>
        <button class="primary-button" type="button" @click="continueGame">继续游戏</button>
        <button class="ghost-button" type="button" @click="resetPosition">重置当前位置</button>
        <button class="ghost-button" type="button" @click="regenerateMaze">重新生成迷宫</button>
        <label class="slider-row">
          <span>鼠标灵敏度</span>
          <input v-model.number="sensitivity" type="range" min="0.45" max="1.85" step="0.05" />
          <strong>{{ sensitivity.toFixed(2) }}</strong>
        </label>
        <button class="text-button" type="button" @click="backToStart">返回开始界面</button>
      </div>
    </section>

    <section v-if="overlay === 'victory'" class="overlay compact-overlay victory-overlay">
      <div class="glass-panel menu-panel victory-panel">
        <p class="eyebrow">EXIT FOUND</p>
        <h2>You Escaped!</h2>
        <div class="result-grid">
          <span>用时</span><strong>{{ victoryTime }}</strong>
          <span>距离</span><strong>{{ victory?.distance.toFixed(1) }} m</strong>
          <span>难度</span><strong>{{ victoryDifficulty }}</strong>
        </div>
        <button class="primary-button" type="button" @click="startGame(victory?.difficulty ?? selectedDifficulty)">再来一局</button>
        <button class="ghost-button" type="button" @click="raiseDifficulty">提高难度</button>
        <button class="text-button" type="button" @click="backToStart">返回开始界面</button>
      </div>
    </section>
  </main>
</template>
