import { DIFFICULTIES } from './constants';
import type { Difficulty } from '../types';

export class UIManager {
  /** 将毫秒格式化为 HUD 和结算界面使用的时间。 */
  static formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  /** 返回中文难度名称。 */
  static difficultyLabel(difficulty: Difficulty): string {
    return DIFFICULTIES[difficulty].label;
  }

  /** 根据当前难度返回下一档难度。 */
  static nextDifficulty(difficulty: Difficulty): Difficulty {
    if (difficulty === 'easy') {
      return 'normal';
    }
    if (difficulty === 'normal') {
      return 'hard';
    }
    return 'hard';
  }
}
