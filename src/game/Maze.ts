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

  private wallMeshes: THREE.Mesh[] = [];

  private routeGroup?: THREE.Group;

  private readonly routeArrows: THREE.Mesh[] = [];

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

  /** 返回边界出口缺口的网格坐标。 */
  getExitGrid(): GridPoint {
    return this.data.exit;
  }

  /** 返回边界出口缺口的世界坐标，用于光圈、胜利判定和俯瞰图统一定位。 */
  getExitWorld(): WorldPoint {
    return this.gridToWorld(this.getExitGrid());
  }

  /** 计算任意可行走网格到目标网格的最短路径，供自动寻路使用。 */
  findPath(start: GridPoint, end: GridPoint): GridPoint[] {
    return this.findRoute(this.data.grid, start, end);
  }

  /** 控制辅助路线显示，默认由 UI 保持隐藏。 */
  setRouteVisible(visible: boolean): void {
    if (this.routeGroup) {
      this.routeGroup.visible = visible;
    }
  }

  /** 更新路线箭头的流动动画。 */
  update(elapsed: number): void {
    this.routeArrows.forEach((arrow, index) => {
      const pulse = (Math.sin(elapsed * 4.2 - index * 0.75) + 1) * 0.5;
      arrow.scale.setScalar(0.82 + pulse * 0.34);
      const material = arrow.material as THREE.MeshBasicMaterial;
      material.opacity = 0.52 + pulse * 0.42;
    });
  }

  /** 释放迷宫相关 GPU 资源，重新生成地图时调用。 */
  dispose(): void {
    this.group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
    });
    this.wallMeshes = [];
    this.routeGroup = undefined;
    this.routeArrows.length = 0;
  }

  /** 以 DFS 回溯生成可达迷宫，并用少量开孔控制难度。 */
  private createMazeData(): MazeData {
    const size = DIFFICULTIES[this.difficulty].size;
    const grid: MazeCell[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => 1 as MazeCell));
    const corners = this.createCornerPoints(size);
    const start = corners[this.random.int(0, corners.length)];
    const end = this.random.shuffle(corners.filter((corner) => corner.row !== start.row || corner.col !== start.col))[0];
    const exit = this.createExitPoint(end, size);

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
    // 入口保留在迷宫内部，外围边界保持实体墙，只有出口侧开洞。
    grid[exit.row][exit.col] = 0;
    this.addLoops(grid);
    grid[start.row][start.col] = 'S';
    grid[end.row][end.col] = 'E';

    return {
      grid,
      width: size,
      height: size,
      start,
      end,
      exit,
      solution: this.findRoute(grid, start, end),
    };
  }

  /** 创建四个内部角落候选点，保持点位都落在 DFS 可雕刻的奇数网格上。 */
  private createCornerPoints(size: number): GridPoint[] {
    return [
      { row: 1, col: 1 },
      { row: 1, col: size - 2 },
      { row: size - 2, col: 1 },
      { row: size - 2, col: size - 2 },
    ];
  }

  /** 根据终点所在角落随机打开相邻外墙，形成贴近该角落的出口缺口。 */
  private createExitPoint(end: GridPoint, size: number): GridPoint {
    const candidates: GridPoint[] = [];
    if (end.row === 1) {
      candidates.push({ row: 0, col: end.col });
    }
    if (end.row === size - 2) {
      candidates.push({ row: size - 1, col: end.col });
    }
    if (end.col === 1) {
      candidates.push({ row: end.row, col: 0 });
    }
    if (end.col === size - 2) {
      candidates.push({ row: end.row, col: size - 1 });
    }
    return candidates[this.random.int(0, candidates.length)];
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
    let reached = false;
    const steps = [
      { row: -1, col: 0 },
      { row: 1, col: 0 },
      { row: 0, col: -1 },
      { row: 0, col: 1 },
    ];

    while (queue.length) {
      const current = queue.shift()!;
      if (current.row === end.row && current.col === end.col) {
        reached = true;
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

    if (!reached) {
      return [];
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
    this.createRouteHint();
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

  /** 按连续墙段生成 Mesh，减少每格墙体之间的视觉拼接。 */
  private createWalls(): void {
    this.wallMeshes = [];
    const material = this.assets.createWallMaterial();

    for (let row = 0; row < this.data.height; row += 1) {
      let runStart = -1;
      for (let col = 0; col < this.data.width; col += 1) {
        const isWall = this.data.grid[row][col] === 1;
        if (isWall && runStart === -1) {
          runStart = col;
        }
        if ((!isWall || col === this.data.width - 1) && runStart !== -1) {
          const runEnd = isWall && col === this.data.width - 1 ? col : col - 1;
          const length = runEnd - runStart + 1;
          const centerCol = runStart + (length - 1) / 2;
          const world = this.gridToWorld({ row, col: centerCol });
          const geometry = this.createWallRunGeometry(CELL_SIZE * length);
          const wall = new THREE.Mesh(geometry, material);
          wall.name = `sandstone-wall-run-${row}-${runStart}`;
          wall.position.set(world.x, WALL_HEIGHT / 2 - 0.02, world.z);
          wall.castShadow = true;
          wall.receiveShadow = true;
          this.wallMeshes.push(wall);
          this.group.add(wall);
          runStart = -1;
        }
      }
    }
  }

  /** 为连续墙段重写 UV，让砖纹沿墙长重复而不是被拉伸。 */
  private createWallRunGeometry(length: number): THREE.BoxGeometry {
    const geometry = new THREE.BoxGeometry(length, WALL_HEIGHT, CELL_SIZE);
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const uvs = geometry.getAttribute('uv') as THREE.BufferAttribute;

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      const nx = Math.abs(normals.getX(index));
      const ny = Math.abs(normals.getY(index));
      const nz = Math.abs(normals.getZ(index));

      if (ny > nx && ny > nz) {
        uvs.setXY(index, x / CELL_SIZE, z / CELL_SIZE);
      } else if (nz > nx) {
        uvs.setXY(index, x / CELL_SIZE, y / WALL_HEIGHT);
      } else {
        uvs.setXY(index, z / CELL_SIZE, y / WALL_HEIGHT);
      }
    }
    uvs.needsUpdate = true;
    return geometry;
  }

  /** 创建更醒目的粗路线和方向箭头，按 M 切换显示。 */
  private createRouteHint(): void {
    const routeCells = [...this.data.solution, this.getExitGrid()];
    const points = routeCells.map((cell) => {
      const world = this.gridToWorld(cell);
      return new THREE.Vector3(world.x, 0.12, world.z);
    });
    const routeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd76a,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const arrowMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff0a5,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.routeGroup = new THREE.Group();
    this.routeGroup.name = 'route-hint';
    this.routeGroup.visible = false;
    this.routeArrows.length = 0;

    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const direction = new THREE.Vector3().subVectors(end, start);
      const length = direction.length();
      if (length < 0.01) {
        continue;
      }
      direction.normalize();
      const segment = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, length, 12), routeMaterial);
      segment.position.copy(start).add(end).multiplyScalar(0.5);
      segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      this.routeGroup.add(segment);

      if (index % 2 === 0) {
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.18, 4), arrowMaterial.clone());
        arrow.position.copy(start).lerp(end, 0.62);
        arrow.position.y = 0.22;
        arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        this.routeArrows.push(arrow);
        this.routeGroup.add(arrow);
      }
    }

    this.group.add(this.routeGroup);
  }
}
