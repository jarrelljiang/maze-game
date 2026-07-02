import { CELL_SIZE } from './constants';
import type { Maze } from './Maze';

export class CollisionSystem {
  /** 检查圆形玩家胶囊在水平面上是否能占据目标位置。 */
  canOccupy(maze: Maze, x: number, z: number, radius: number): boolean {
    const minCol = Math.floor((x - radius) / CELL_SIZE + maze.data.width / 2);
    const maxCol = Math.floor((x + radius) / CELL_SIZE + maze.data.width / 2);
    const minRow = Math.floor((z - radius) / CELL_SIZE + maze.data.height / 2);
    const maxRow = Math.floor((z + radius) / CELL_SIZE + maze.data.height / 2);

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        if (maze.isWall(row, col) && this.circleTouchesCell(maze, x, z, radius, row, col)) {
          return false;
        }
      }
    }
    return true;
  }

  /** 分轴移动，碰到墙时仍允许沿另一轴滑动。 */
  moveWithCollision(maze: Maze, currentX: number, currentZ: number, deltaX: number, deltaZ: number, radius: number): { x: number; z: number } {
    let nextX = currentX;
    let nextZ = currentZ;

    if (this.canOccupy(maze, currentX + deltaX, currentZ, radius)) {
      nextX += deltaX;
    }
    if (this.canOccupy(maze, nextX, currentZ + deltaZ, radius)) {
      nextZ += deltaZ;
    }

    return { x: nextX, z: nextZ };
  }

  /** 判断玩家圆形边界是否与某个墙格 AABB 相交。 */
  private circleTouchesCell(maze: Maze, x: number, z: number, radius: number, row: number, col: number): boolean {
    const center = maze.gridToWorld({ row, col });
    const half = CELL_SIZE / 2;
    const closestX = Math.max(center.x - half, Math.min(x, center.x + half));
    const closestZ = Math.max(center.z - half, Math.min(z, center.z + half));
    const dx = x - closestX;
    const dz = z - closestZ;
    return dx * dx + dz * dz < radius * radius;
  }
}
