export type Difficulty = 'easy' | 'normal' | 'hard';

export type MazeCell = 0 | 1 | 'S' | 'E';

export interface DifficultyConfig {
  label: string;
  size: number;
  braidChance: number;
  speedMultiplier: number;
}

export interface MazeData {
  grid: MazeCell[][];
  width: number;
  height: number;
  start: GridPoint;
  end: GridPoint;
  solution: GridPoint[];
}

export interface GridPoint {
  row: number;
  col: number;
}

export interface WorldPoint {
  x: number;
  z: number;
}

export interface HudState {
  elapsedMs: number;
  distance: number;
  difficulty: Difficulty;
  heading: string;
  routeVisible: boolean;
}

export interface VictoryStats {
  elapsedMs: number;
  distance: number;
  difficulty: Difficulty;
}

export interface GameCallbacks {
  onHudUpdate: (state: HudState) => void;
  onPause: () => void;
  onResume: () => void;
  onVictory: (stats: VictoryStats) => void;
}
