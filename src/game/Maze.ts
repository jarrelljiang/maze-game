import * as THREE from 'three';
import { CELL_SIZE, WALL_HEIGHT } from './constants';
import { Random } from './Random';
import type { Difficulty, GridPoint, MazeCell, MazeData, WorldPoint } from '../types';
import { DIFFICULTIES } from './constants';
import type { AssetManager } from './AssetManager';

const DIRECTIONS: GridPoint[] = [
  { row: -2, col: 0 },
  { row: 2, col: 0 },
  { row: 0, col: -2 },
  { row: 0, col: 2 },
];

export class Maze {
  public data: MazeData;

  public readonly group = new THREE.Group();

  private wallMesh?: THREE.InstancedMesh;

  private routeLine?: THREE.Line;

  private readonly random: Random;

  /** 生成迷宫数据并创建对应的 Three.js 对象容器。 */
  constructor(
    private readonly difficulty: Difficulty,
    private readonly assets: AssetManager,
    seed = Date.now(),
  ) {
    this.random = new Random(seed);
    this.data = this.createMazeData();
    this.group.name = 'maze-root';
    this.build();
  }

  /** 判断指定网格是否是墙体，越界也按墙处理。 */
  isWall(row: number, col: number): boolean {
    if (row < 0 || col < 0 || row >= this.data.height || col >= this.data.width) {
      return true;
    }
    return this.data.grid[row][col] === 1;
  }

  /** 将网格坐标转换为世界坐标中心点。 */
  gridToWorld(point: GridPoint): WorldPoint {
    return {
      x: (point.col - this.data.width / 2 + 0.5) * CELL_SIZE,
      z: (point.row - this.data.height / 2 + 0.5) * CELL_SIZE,
    };
  }

  /** 将世界坐标转换为所在网格坐标。 */
  worldToGrid(x: number, z: number): GridPoint {
    return {
      row: Math.floor(z / CELL_SIZE + this.data.height / 2),
      col: Math.floor(x / CELL_SIZE + this.data.width / 2),
    };
  }

  /** 返回起点的世界坐标。 */
  getStartWorld(): WorldPoint {
    return this.gridToWorld(this.data.start);
  }

  /** 返回终点的世界坐标。 */
  getEndWorld(): WorldPoint {
    return this.gridToWorld(this.data.end);
  }

  /** 控制辅助路线显示，默认由 UI 保持隐藏。 */
  setRouteVisible(visible: boolean): void {
    if (this.routeLine) {
      this.routeLine.visible = visible;
    }
  }

  /** 释放迷宫相关 GPU 资源，重新生成地图时调用。 */
  dispose(): void {
    this.group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
    });
    this.wallMesh = undefined;
    this.routeLine = undefined;
  }

  /** 以 DFS 回溯生成可达迷宫，并用少量开孔控制难度。 */
  private createMazeData(): MazeData {
    const size = DIFFICULTIES[this.difficulty].size;
    const grid: MazeCell[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => 1 as MazeCell));
    const start = { row: 1, col: 1 };
    const end = { row: size - 2, col: size - 2 };

    const carve = (cell: GridPoint): void => {
      grid[cell.row][cell.col] = 0;
      for (const direction of this.random.shuffle([...DIRECTIONS])) {
        const next = { row: cell.row + direction.row, col: cell.col + direction.col };
        if (next.row <= 0 || next.col <= 0 || next.row >= size - 1 || next.col >= size - 1) {
          continue;
        }
        if (grid[next.row][next.col] === 1) {
          grid[cell.row + direction.row / 2][cell.col + direction.col / 2] = 0;
          carve(next);
        }
      }
    };

    carve(start);
    grid[start.row][0] = 0;
    grid[end.row][size - 1] = 0;
    this.addLoops(grid);
    grid[start.row][start.col] = 'S';
    grid[end.row][end.col] = 'E';

    return {
      grid,
      width: size,
      height: size,
      start,
      end,
      solution: this.findRoute(grid, start, end),
    };
  }

  /** 根据难度挖掉少量死胡同边墙，让低难度更少折返。 */
  private addLoops(grid: MazeCell[][]): void {
    const chance = DIFFICULTIES[this.difficulty].braidChance;
    if (chance <= 0) {
      return;
    }

    for (let row = 1; row < grid.length - 1; row += 1) {
      for (let col = 1; col < grid[row].length - 1; col += 1) {
        if (grid[row][col] !== 0 || this.random.next() > chance) {
          continue;
        }
        const candidates = [
          { row: row - 1, col },
          { row: row + 1, col },
          { row, col: col - 1 },
          { row, col: col + 1 },
        ].filter((point) => point.row > 0 && point.col > 0 && point.row < grid.length - 1 && point.col < grid.length - 1 && grid[point.row][point.col] === 1);
        const choice = candidates[this.random.int(0, candidates.length || 1)];
        if (choice) {
          grid[choice.row][choice.col] = 0;
        }
      }
    }
  }

  /** 用 BFS 计算起点到终点的路线，用于可选路线提示。 */
  private findRoute(grid: MazeCell[][], start: GridPoint, end: GridPoint): GridPoint[] {
    const queue: GridPoint[] = [start];
    const keyOf = (point: GridPoint) => `${point.row}:${point.col}`;
    const visited = new Set<string>([keyOf(start)]);
    const parent = new Map<string, GridPoint>();
    const steps = [
      { row: -1, col: 0 },
      { row: 1, col: 0 },
      { row: 0, col: -1 },
      { row: 0, col: 1 },
    ];

    while (queue.length) {
      const current = queue.shift()!;
      if (current.row === end.row && current.col === end.col) {
        break;
      }
      for (const step of steps) {
        const next = { row: current.row + step.row, col: current.col + step.col };
        const key = keyOf(next);
        if (visited.has(key) || grid[next.row]?.[next.col] === 1 || grid[next.row]?.[next.col] === undefined) {
          continue;
        }
        visited.add(key);
        parent.set(key, current);
        queue.push(next);
      }
    }

    const route: GridPoint[] = [];
    let cursor: GridPoint | undefined = end;
    while (cursor) {
      route.push(cursor);
      cursor = parent.get(keyOf(cursor));
      if (cursor && cursor.row === start.row && cursor.col === start.col) {
        route.push(start);
        break;
      }
    }
    return route.reverse();
  }

  /** 创建地面、墙体和辅助路线的渲染对象。 */
  private build(): void {
    this.group.clear();
    this.group.add(this.createFloor());
    this.createWalls();
    this.createRouteLine();
  }

  /** 创建大面积沙地平面。 */
  private createFloor(): THREE.Mesh {
    const floorSize = (this.data.width + 8) * CELL_SIZE;
    const geometry = new THREE.PlaneGeometry(floorSize, floorSize, 1, 1);
    const material = this.assets.createFloorMaterial(this.data.width);
    const floor = new THREE.Mesh(geometry, material);
    floor.name = 'sand-floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    return floor;
  }

  /** 使用 InstancedMesh 批量绘制墙体，避免大量独立 Mesh。 */
  private createWalls(): void {
    const wallCells: GridPoint[] = [];
    for (let row = 0; row < this.data.height; row += 1) {
      for (let col = 0; col < this.data.width; col += 1) {
        if (this.data.grid[row][col] === 1) {
          wallCells.push({ row, col });
        }
      }
    }

    const geometry = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
    const material = this.assets.createWallMaterial();
    this.wallMesh = new THREE.InstancedMesh(geometry, material, wallCells.length);
    this.wallMesh.name = 'sandstone-walls';
    this.wallMesh.castShadow = true;
    this.wallMesh.receiveShadow = true;

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    wallCells.forEach((cell, index) => {
      const world = this.gridToWorld(cell);
      const heightScale = 0.94 + this.random.next() * 0.11;
      matrix.compose(
        new THREE.Vector3(world.x, (WALL_HEIGHT * heightScale) / 2 - 0.02, world.z),
        new THREE.Quaternion(),
        new THREE.Vector3(1, heightScale, 1),
      );
      this.wallMesh!.setMatrixAt(index, matrix);
      color.setHSL(0.105 + this.random.next() * 0.025, 0.48, 0.55 + this.random.next() * 0.08);
      this.wallMesh!.setColorAt(index, color);
    });
    this.wallMesh.instanceMatrix.needsUpdate = true;
    this.wallMesh.instanceColor!.needsUpdate = true;
    this.group.add(this.wallMesh);
  }

  /** 创建低矮发光路线线条，按 M 切换显示。 */
  private createRouteLine(): void {
    const points = this.data.solution.map((cell) => {
      const world = this.gridToWorld(cell);
      return new THREE.Vector3(world.x, 0.06, world.z);
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xffd76a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.routeLine = new THREE.Line(geometry, material);
    this.routeLine.name = 'route-hint';
    this.routeLine.visible = false;
    this.group.add(this.routeLine);
  }
}
