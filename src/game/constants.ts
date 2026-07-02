import type { Difficulty, DifficultyConfig } from '../types';

export const CELL_SIZE = 4;
export const WALL_HEIGHT = 3.65;
export const PLAYER_RADIUS = 0.72;
export const PLAYER_EYE_HEIGHT = 1.55;

export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: {
    label: '简单',
    size: 17,
    braidChance: 0.1,
    speedMultiplier: 1.02,
  },
  normal: {
    label: '普通',
    size: 21,
    braidChance: 0.04,
    speedMultiplier: 1,
  },
  hard: {
    label: '困难',
    size: 25,
    braidChance: 0,
    speedMultiplier: 0.96,
  },
};
