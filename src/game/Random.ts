export class Random {
  private state: number;

  /** 使用固定种子创建可重复的伪随机序列。 */
  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** 返回 0 到 1 之间的稳定随机数。 */
  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0xffffffff;
  }

  /** 返回指定范围内的随机整数，包含 min，不包含 max。 */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** 原地打乱数组，保持迷宫生成可复现。 */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}
