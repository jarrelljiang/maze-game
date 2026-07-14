const THREE = require('./vendor/three');

const CELL_SIZE = 4;
const WALL_HEIGHT = 3.65;
const PLAYER_RADIUS = 0.48;
const PLAYER_EYE_HEIGHT = 1.55;
// 右侧拖动视角的水平灵敏度，移动端需要比鼠标拖动更直接。
const CAMERA_TOUCH_SENSITIVITY = 0.012;
// 自动寻路使用明显更高的移动速度，减少等待时间。
const AUTO_NAVIGATION_SPEED = 20;
// 玩家把摇杆推到外圈时的最大奔跑速度。
const PLAYER_RUN_SPEED = 10;
// 手动移动从静止加速到最大速度所使用的线性加速度。
const PLAYER_ACCELERATION = 18;

const DIFFICULTIES = {
  easy: { label: '简单', size: 17, braidChance: 0.1, speedMultiplier: 1.02 },
  normal: { label: '普通', size: 21, braidChance: 0.04, speedMultiplier: 1 },
  hard: { label: '困难', size: 25, braidChance: 0, speedMultiplier: 0.96 },
};

const DIRECTIONS = [
  { row: -2, col: 0 },
  { row: 2, col: 0 },
  { row: 0, col: -2 },
  { row: 0, col: 2 },
];

/** 创建微信小游戏兼容的 2D 画布，用于 HUD 和程序化贴图。 */
function create2DCanvas(width, height) {
  if (typeof wx !== 'undefined' && wx.createOffscreenCanvas) {
    const canvas = wx.createOffscreenCanvas({ type: '2d', width, height });
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  const canvas = typeof wx !== 'undefined' ? wx.createCanvas() : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** 获取微信小游戏真正显示到屏幕上的主画布。 */
function getMainCanvas(preferredCanvas) {
  if (preferredCanvas) return preferredCanvas;
  if (typeof wx === 'undefined') {
    return document.createElement('canvas');
  }
  const globalScope = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  if (globalScope.canvas) return globalScope.canvas;
  if (globalThis.canvas) return globalThis.canvas;
  if (typeof canvas !== 'undefined') return canvas;
  return wx.createCanvas();
}

/** 将角度约束到 -PI 到 PI，避免长时间旋转后插值异常。 */
function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** 角度插值走最短路径。 */
function lerpAngle(current, target, factor) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * factor;
}

/** 伪随机数，保证迷宫可以通过 seed 复现。 */
class Random {
  /** 使用固定种子初始化随机序列。 */
  constructor(seed) {
    this.state = seed >>> 0;
  }

  /** 返回 0 到 1 的随机数。 */
  next() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0xffffffff;
  }

  /** 返回 [min, max) 的整数。 */
  int(min, max) {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** 原地打乱数组。 */
  shuffle(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

/** 处理圆形玩家和迷宫墙体的网格碰撞。 */
class CollisionSystem {
  /** 判断玩家圆形胶囊是否能占据目标位置。 */
  canOccupy(maze, x, z, radius) {
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

  /** 分轴移动，撞墙时允许贴墙滑动。 */
  moveWithCollision(maze, currentX, currentZ, deltaX, deltaZ, radius) {
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

  /** 判断圆形边界是否碰到指定墙格。 */
  circleTouchesCell(maze, x, z, radius, row, col) {
    const center = maze.gridToWorld({ row, col });
    const half = CELL_SIZE / 2;
    const closestX = Math.max(center.x - half, Math.min(x, center.x + half));
    const closestZ = Math.max(center.z - half, Math.min(z, center.z + half));
    const dx = x - closestX;
    const dz = z - closestZ;
    return dx * dx + dz * dz < radius * radius;
  }
}

/** 创建微信小游戏端所需的程序化材质。 */
class MiniAssets {
  /** 构造迷宫墙体材质。 */
  createWallMaterial() {
    const texture = this.createSandstoneTexture();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.92,
      metalness: 0,
      color: 0xf2bd58,
    });
  }

  /** 构造沙地材质。 */
  createFloorMaterial(size) {
    const texture = this.createSandTexture();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(size * 0.65, size * 0.65);
    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.96,
      metalness: 0,
      color: 0xf3cd88,
    });
  }

  /** 构造发光传送门材质。 */
  createPortalMaterial() {
    return new THREE.MeshBasicMaterial({
      color: 0xffd86e,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  /** 创建砂岩砖块 DataTexture。 */
  createSandstoneTexture() {
    const width = 128;
    const height = 128;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const brickY = Math.floor(y / 20);
        const offset = brickY % 2 === 0 ? 0 : 18;
        const mortar = y % 20 < 2 || ((x + offset) % 36) < 2;
        const noise = ((x * 17 + y * 31 + ((x * y) % 19)) % 23) - 11;
        const index = (y * width + x) * 4;
        data[index] = mortar ? 86 : 206 + noise;
        data[index + 1] = mortar ? 55 : 154 + noise;
        data[index + 2] = mortar ? 27 : 74 + noise * 0.5;
        data[index + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  /** 创建沙地 DataTexture。 */
  createSandTexture() {
    const width = 128;
    const height = 128;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const ripple = Math.sin((x + y * 0.35) * 0.16) * 8;
        const grain = ((x * 13 + y * 7 + (x ^ y)) % 17) - 8;
        const index = (y * width + x) * 4;
        data[index] = 222 + ripple * 0.5 + grain;
        data[index + 1] = 181 + ripple * 0.38 + grain;
        data[index + 2] = 104 + ripple * 0.18;
        data[index + 3] = 255;
      }
    }
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
}

/** 生成二维数组迷宫并负责墙体、地面、路线提示渲染。 */
class Maze {
  /**
   * 创建指定难度和 seed 的随机迷宫。
   * @param {MiniAssets} assets 小游戏程序化材质资源。
   * @param {'easy'|'normal'|'hard'} difficulty 当前难度。
   * @param {number} seed 随机种子。
   */
  constructor(assets, difficulty = 'normal', seed = Date.now()) {
    this.assets = assets;
    this.difficulty = difficulty;
    this.config = DIFFICULTIES[difficulty];
    this.random = new Random(seed);
    this.group = new THREE.Group();
    this.group.name = 'mini-maze-root';
    this.routeGroup = undefined;
    this.routeArrows = [];
    this.routeStartKey = '';
    this.data = this.createMazeData();
    this.build();
  }

  /** 判断网格是否为墙，越界按墙处理。 */
  isWall(row, col) {
    if (row < 0 || col < 0 || row >= this.data.height || col >= this.data.width) {
      return true;
    }
    return this.data.grid[row][col] === 1;
  }

  /** 网格坐标转世界坐标中心点。 */
  gridToWorld(point) {
    return {
      x: (point.col - this.data.width / 2 + 0.5) * CELL_SIZE,
      z: (point.row - this.data.height / 2 + 0.5) * CELL_SIZE,
    };
  }

  /** 世界坐标转网格坐标。 */
  worldToGrid(x, z) {
    return {
      row: Math.floor(z / CELL_SIZE + this.data.height / 2),
      col: Math.floor(x / CELL_SIZE + this.data.width / 2),
    };
  }

  /** 返回起点世界坐标。 */
  getStartWorld() {
    return this.gridToWorld(this.data.start);
  }

  /** 返回真实出口缺口网格坐标。 */
  getExitGrid() {
    return this.data.exit;
  }

  /** 返回真实出口缺口世界坐标。 */
  getExitWorld() {
    return this.gridToWorld(this.data.exit);
  }

  /** 计算任意可行走网格到目标网格的 BFS 路径。 */
  findPath(start, end) {
    return this.findRoute(this.data.grid, start, end);
  }

  /** 设置路线提示显示状态。 */
  setRouteVisible(visible) {
    if (this.routeGroup) {
      this.routeGroup.visible = visible;
    }
  }

  /** 更新路线箭头呼吸动画。 */
  update(elapsed) {
    this.routeArrows.forEach((arrow, index) => {
      const pulse = (Math.sin(elapsed * 4.2 - index * 0.75) + 1) * 0.5;
      arrow.scale.setScalar(0.82 + pulse * 0.34);
      arrow.material.opacity = 0.52 + pulse * 0.42;
    });
  }

  /** 生成迷宫数据，起点和出口随机位于不同角落。 */
  createMazeData() {
    const size = this.config.size;
    const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => 1));
    const corners = this.createCornerPoints(size);
    const start = corners[this.random.int(0, corners.length)];
    const end = this.random.shuffle(corners.filter((corner) => corner.row !== start.row || corner.col !== start.col))[0];
    const exit = this.createExitPoint(end, size);

    const carve = (cell) => {
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

  /** 创建四个内部角落候选点。 */
  createCornerPoints(size) {
    return [
      { row: 1, col: 1 },
      { row: 1, col: size - 2 },
      { row: size - 2, col: 1 },
      { row: size - 2, col: size - 2 },
    ];
  }

  /** 根据终点角落打开相邻外墙出口。 */
  createExitPoint(end, size) {
    const candidates = [];
    if (end.row === 1) candidates.push({ row: 0, col: end.col });
    if (end.row === size - 2) candidates.push({ row: size - 1, col: end.col });
    if (end.col === 1) candidates.push({ row: end.row, col: 0 });
    if (end.col === size - 2) candidates.push({ row: end.row, col: size - 1 });
    return candidates[this.random.int(0, candidates.length)];
  }

  /** 按难度挖少量额外开孔。 */
  addLoops(grid) {
    const chance = this.config.braidChance;
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

  /** 使用 BFS 计算路线。 */
  findRoute(grid, start, end) {
    const keyOf = (point) => `${point.row}:${point.col}`;
    const queue = [start];
    const visited = new Set([keyOf(start)]);
    const parent = new Map();
    let reached = false;
    const steps = [
      { row: -1, col: 0 },
      { row: 1, col: 0 },
      { row: 0, col: -1 },
      { row: 0, col: 1 },
    ];

    while (queue.length) {
      const current = queue.shift();
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

    const route = [];
    let cursor = end;
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

  /** 构建地面、墙体和路线提示。 */
  build() {
    this.group.add(this.createFloor());
    this.createWalls();
    this.createRouteHint();
  }

  /** 创建沙地。 */
  createFloor() {
    const floorSize = (this.data.width + 8) * CELL_SIZE;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), this.assets.createFloorMaterial(this.data.width));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    return floor;
  }

  /** 按连续横向墙段渲染墙体，减少 Mesh 数量和缝隙。 */
  createWalls() {
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
          const wall = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE * length, WALL_HEIGHT, CELL_SIZE), material);
          wall.position.set(world.x, WALL_HEIGHT / 2 - 0.02, world.z);
          wall.castShadow = true;
          wall.receiveShadow = true;
          this.group.add(wall);
          runStart = -1;
        }
      }
    }
  }

  /** 创建路线提示容器，并以起点路线初始化。 */
  createRouteHint() {
    this.routeGroup = new THREE.Group();
    this.routeGroup.visible = false;
    this.group.add(this.routeGroup);
    this.updateRouteHint(this.data.start);
  }

  /**
   * 根据角色当前网格重建通往出口的路线提示。
   * @param {{row: number, col: number}} startCell 当前角色所在网格。
   */
  updateRouteHint(startCell) {
    const routeKey = `${startCell.row}:${startCell.col}`;
    if (!this.routeGroup || routeKey === this.routeStartKey) return;
    this.routeStartKey = routeKey;

    // 仅在角色跨格时释放并重建路线，避免每帧产生新几何体。
    const geometries = new Set();
    const materials = new Set();
    this.routeGroup.traverse((child) => {
      if (child.geometry) geometries.add(child.geometry);
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => materials.add(material));
      } else if (child.material) {
        materials.add(child.material);
      }
    });
    this.routeGroup.clear();
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.routeArrows = [];

    const routeCells = this.findPath(startCell, this.getExitGrid());
    if (routeCells.length < 2) return;
    const points = routeCells.map((cell) => {
      const world = this.gridToWorld(cell);
      return new THREE.Vector3(world.x, 0.12, world.z);
    });
    const routeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd76a,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const arrowMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff0a5,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const direction = new THREE.Vector3().subVectors(end, start);
      const length = direction.length();
      if (length < 0.01) continue;
      direction.normalize();
      const segment = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, length, 10), routeMaterial);
      segment.position.copy(start).add(end).multiplyScalar(0.5);
      segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      this.routeGroup.add(segment);
      if (index % 2 === 0) {
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.05, 4), arrowMaterial.clone());
        arrow.position.copy(start).lerp(end, 0.62);
        arrow.position.y = 0.22;
        arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        this.routeArrows.push(arrow);
        this.routeGroup.add(arrow);
      }
    }
  }
}

/** 低多边形 Q 版探险家角色。 */
class Character {
  /** 创建角色 Mesh、关节和动画状态。 */
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'mini-character';
    this.motionRoot = new THREE.Group();
    this.bodyRoot = new THREE.Group();
    this.headRoot = new THREE.Group();
    this.leftArm = new THREE.Group();
    this.rightArm = new THREE.Group();
    this.leftLeg = new THREE.Group();
    this.rightLeg = new THREE.Group();
    this.shadow = undefined;
    this.animationTime = 0;
    this.moveBlend = 0;
    this.sprintBlend = 0;
    this.build();
  }

  /**
   * 更新待机、行走和奔跑动画。
   * @param {number} delta 当前帧时间，单位为秒。
   * @param {{x: number, z: number}} position 角色世界坐标。
   * @param {number} yaw 角色水平朝向。
   * @param {number} speed 角色当前实际移动速度。
   * @param {boolean} sprinting 当前是否处于奔跑输入状态。
   */
  update(delta, position, yaw, speed, sprinting) {
    this.group.position.set(position.x, 0, position.z);
    this.group.rotation.y = yaw;
    const targetMove = THREE.MathUtils.clamp(speed / 4.5, 0, 1);
    const targetSprint = sprinting && targetMove > 0.45 ? 1 : 0;
    this.moveBlend = THREE.MathUtils.lerp(this.moveBlend, targetMove, 1 - Math.exp(-delta * 10));
    this.sprintBlend = THREE.MathUtils.lerp(this.sprintBlend, targetSprint, 1 - Math.exp(-delta * 8));

    // 动画相位连续累加，避免走路与奔跑切换时动作突然跳帧。
    const cadence = THREE.MathUtils.lerp(2.2, 7.4 + this.sprintBlend * 3.5, this.moveBlend);
    this.animationTime += delta * cadence;
    const phase = this.animationTime;
    const stride = Math.sin(phase) * (0.5 + this.sprintBlend * 0.22) * this.moveBlend;
    const stepLift = Math.abs(Math.sin(phase)) * (0.045 + this.sprintBlend * 0.025) * this.moveBlend;
    const idleBreath = Math.sin(phase * 0.72) * 0.012 * (1 - this.moveBlend);

    this.motionRoot.position.y = stepLift + idleBreath;
    this.motionRoot.rotation.x = (0.025 + this.sprintBlend * 0.075) * this.moveBlend;
    this.motionRoot.rotation.z = Math.sin(phase * 0.5) * 0.014 * (1 - this.moveBlend)
      + Math.sin(phase) * 0.018 * this.moveBlend;
    this.bodyRoot.rotation.y = Math.sin(phase) * 0.035 * this.moveBlend;
    this.headRoot.rotation.x = -this.motionRoot.rotation.x * 0.45 + stepLift * 0.24;
    this.headRoot.rotation.y = Math.sin(phase * 0.46) * 0.055 * (1 - this.moveBlend);

    this.leftLeg.rotation.x = stride;
    this.rightLeg.rotation.x = -stride;
    this.leftArm.rotation.x = -stride * 0.78 - this.sprintBlend * 0.08;
    this.rightArm.rotation.x = stride * 0.78 - this.sprintBlend * 0.08;
    this.leftArm.rotation.z = 0.16 + this.sprintBlend * 0.05;
    this.rightArm.rotation.z = -0.16 - this.sprintBlend * 0.05;
    if (this.shadow) {
      const shadowScale = 1 - stepLift * 1.8;
      this.shadow.scale.set(shadowScale, shadowScale, 1);
      this.shadow.material.opacity = 0.2 - stepLift * 0.7;
    }
  }

  /** 组合大头短身探险家几何体，并建立肩部和髋部关节。 */
  build() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xf2b66f, roughness: 0.8 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x5b321a, roughness: 0.78 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x77a9d8, roughness: 0.84 });
    const linen = new THREE.MeshStandardMaterial({ color: 0xf1dfb9, roughness: 0.9 });
    const scarf = new THREE.MeshStandardMaterial({ color: 0xc9523e, roughness: 0.82 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x654027, roughness: 0.88 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe7b84f, roughness: 0.48, metalness: 0.12 });
    const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xfff5db });
    const eyeDark = new THREE.MeshBasicMaterial({ color: 0x2b1a11 });

    this.group.add(this.motionRoot);
    this.motionRoot.add(this.bodyRoot, this.headRoot, this.leftArm, this.rightArm, this.leftLeg, this.rightLeg);

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.5, 5, 10), cloth);
    body.position.y = 0.93;
    const tunicHem = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.44, 0.38, 10), cloth);
    tunicHem.position.y = 0.66;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.032, 8, 28), boot);
    belt.position.y = 0.78;
    belt.rotation.x = Math.PI / 2;
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.055), gold);
    buckle.position.set(0, 0.78, -0.365);
    this.bodyRoot.add(body, tunicHem, belt, buckle);

    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.48, 0.2), boot);
    backpack.position.set(0, 0.92, 0.39);
    const backpackFlap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.035), gold);
    backpackFlap.position.set(0, 1.08, 0.505);
    this.bodyRoot.add(backpack, backpackFlap);

    this.headRoot.position.y = 1.58;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.57, 18, 14), skin);
    head.scale.set(1, 0.96, 0.94);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.585, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.48), hair);
    hairCap.position.y = 0.15;
    this.headRoot.add(head, hairCap);

    // 大眼睛使用眼白和瞳孔两层，第三人称远景下仍能看清表情。
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.082, 10, 8), eyeWhite);
      eye.scale.set(0.78, 1.15, 0.48);
      eye.position.set(side * 0.18, 0.035, -0.515);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.043, 8, 6), eyeDark);
      pupil.position.set(side * 0.18, 0.025, -0.562);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.025, 0.025), hair);
      brow.position.set(side * 0.18, 0.17, -0.53);
      brow.rotation.z = side * -0.08;
      this.headRoot.add(eye, pupil, brow);
    }

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin);
    nose.position.set(0, -0.04, -0.56);
    nose.scale.set(0.8, 0.65, 0.8);
    this.headRoot.add(nose);

    // 三束简化发梢强化角色轮廓，同时维持低面数。
    for (let index = -1; index <= 1; index += 1) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.27, 5), hair);
      tuft.position.set(index * 0.14, 0.55 - Math.abs(index) * 0.04, -0.13);
      tuft.rotation.x = -0.6;
      tuft.rotation.z = index * -0.18;
      this.headRoot.add(tuft);
    }

    const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 8, 28), scarf);
    scarfRing.position.y = 1.25;
    scarfRing.rotation.x = Math.PI / 2;
    this.bodyRoot.add(scarfRing);

    // 肩部与髋部作为旋转轴，避免四肢围绕自身中心僵硬摆动。
    this.leftArm.position.set(-0.43, 1.16, 0);
    this.rightArm.position.set(0.43, 1.16, 0);
    this.leftArm.rotation.z = 0.16;
    this.rightArm.rotation.z = -0.16;
    for (const arm of [this.leftArm, this.rightArm]) {
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.29, 4, 8), cloth);
      sleeve.position.y = -0.2;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), skin);
      hand.position.y = -0.48;
      arm.add(sleeve, hand);
    }

    this.leftLeg.position.set(-0.18, 0.55, 0);
    this.rightLeg.position.set(0.18, 0.55, 0);
    for (const leg of [this.leftLeg, this.rightLeg]) {
      const trouser = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.25, 4, 8), linen);
      trouser.position.y = -0.16;
      const bootShaft = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.2, 4, 8), boot);
      bootShaft.position.y = -0.39;
      const bootToe = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.16, 0.38), boot);
      bootToe.position.set(0, -0.52, -0.09);
      leg.add(trouser, bootShaft, bootToe);
    }

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 24),
      new THREE.MeshBasicMaterial({ color: 0x3b210f, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.015;
    this.group.add(this.shadow);

    this.motionRoot.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }
}

/** 玩家控制器：触屏移动、相机、碰撞和自动寻路。 */
class MiniPlayerController {
  /** 创建移动端控制器。 */
  constructor(camera, collision) {
    this.camera = camera;
    this.collision = collision;
    this.rig = new THREE.Object3D();
    this.character = new Character();
    this.velocity = new THREE.Vector2();
    this.manualSpeed = 0;
    this.moveInput = { x: 0, y: 0, strength: 0 };
    this.autoPath = [];
    this.autoPathIndex = 0;
    this.autoNavigating = false;
    this.cameraYaw = 0;
    this.cameraYawTarget = 0;
    this.cameraDistanceFactor = 1;
    this.cameraDistanceGoalFactor = 1;
    this.cameraRotateHoldTime = 0;
    this.startCameraPullIn = 0;
    this.totalDistance = 0;
    this.cameraTarget = new THREE.Vector3();
    this.smoothedCameraTarget = new THREE.Vector3();
    this.lookAtTarget = new THREE.Vector3();
    this.desiredCameraPosition = new THREE.Vector3();
  }

  /** 重置玩家位置、朝向和相机。 */
  reset(position, yaw, maze) {
    this.rig.position.set(position.x, 0, position.z);
    this.rig.rotation.y = yaw;
    this.cameraYaw = yaw;
    this.cameraYawTarget = yaw;
    this.cameraDistanceFactor = 0.52;
    this.cameraDistanceGoalFactor = 0.52;
    this.startCameraPullIn = 1;
    this.totalDistance = 0;
    this.velocity.set(0, 0);
    this.manualSpeed = 0;
    this.moveInput = { x: 0, y: 0, strength: 0 };
    this.stopAutoNavigate();
    this.character.update(0, this.rig.position, yaw, 0, false);
    this.updateCamera(maze, true, 1 / 60);
  }

  /** 设置摇杆移动输入。 */
  setMoveInput(x, y, strength) {
    this.moveInput.x = x;
    this.moveInput.y = y;
    this.moveInput.strength = strength;
    if (strength > 0.12 && this.autoNavigating) {
      this.stopAutoNavigate();
    }
  }

  /** 右侧滑动相机。 */
  rotateCamera(deltaX) {
    this.cameraYawTarget = normalizeAngle(this.cameraYawTarget - deltaX * CAMERA_TOUCH_SENSITIVITY);
    this.cameraYaw = this.cameraYawTarget;
    this.cameraRotateHoldTime = 0.18;
  }

  /** 启动自动寻路。 */
  startAutoNavigate(points) {
    this.autoPath = points.map((point) => new THREE.Vector2(point.x, point.z));
    this.autoPathIndex = 0;
    this.autoNavigating = this.autoPath.length > 1;
    this.velocity.set(0, 0);
    this.manualSpeed = 0;
  }

  /** 停止自动寻路。 */
  stopAutoNavigate() {
    this.autoNavigating = false;
    this.autoPath = [];
    this.autoPathIndex = 0;
  }

  /**
   * 更新玩家移动和相机。
   * @param {number} delta 当前帧时间，单位为秒。
   * @param {Maze} maze 当前迷宫。
   * @param {number} speedMultiplier 当前难度的移动速度倍率。
   */
  update(delta, maze, speedMultiplier = 1) {
    if (this.autoNavigating) {
      this.updateAutoNavigation(delta, maze, speedMultiplier);
    } else {
      this.updateManualMovement(delta, maze, speedMultiplier);
    }
    this.updateCamera(maze, false, delta);
  }

  /**
   * 更新手动摇杆移动。
   * @param {number} delta 当前帧时间，单位为秒。
   * @param {Maze} maze 当前迷宫。
   * @param {number} speedMultiplier 当前难度的移动速度倍率。
   */
  updateManualMovement(delta, maze, speedMultiplier) {
    const strength = this.moveInput.strength;
    const hasInput = strength > 0.12;
    const sprinting = hasInput;
    const maxSpeed = PLAYER_RUN_SPEED * speedMultiplier;

    if (hasInput) {
      const yaw = this.cameraYawTarget;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const forward = this.moveInput.y;
      const side = this.moveInput.x;
      const input = new THREE.Vector2(
        -sin * forward + cos * side,
        -cos * forward - sin * side,
      ).normalize();
      const targetYaw = Math.atan2(-input.x, -input.y);
      this.rig.rotation.y = lerpAngle(this.rig.rotation.y, targetYaw, 1 - Math.exp(-delta * 8));
      this.manualSpeed = Math.min(
        maxSpeed,
        this.manualSpeed + PLAYER_ACCELERATION * speedMultiplier * delta,
      );
      this.velocity.copy(input).multiplyScalar(this.manualSpeed);
    } else {
      this.manualSpeed = 0;
      this.velocity.set(0, 0);
    }

    this.applyMovement(delta, maze, sprinting);
  }

  /**
   * 更新自动寻路移动。
   * @param {number} delta 当前帧时间，单位为秒。
   * @param {Maze} maze 当前迷宫。
   * @param {number} speedMultiplier 当前难度的移动速度倍率。
   */
  updateAutoNavigation(delta, maze, speedMultiplier) {
    const target = this.autoPath[this.autoPathIndex];
    if (!target) {
      this.stopAutoNavigate();
      this.velocity.set(0, 0);
      this.character.update(delta, this.rig.position, this.rig.rotation.y, 0, false);
      return;
    }
    const toTarget = new THREE.Vector2(target.x - this.rig.position.x, target.y - this.rig.position.z);
    if (toTarget.length() < 0.25 && this.autoPathIndex < this.autoPath.length - 1) {
      this.autoPathIndex += 1;
      return;
    }
    if (toTarget.length() < 0.3 && this.autoPathIndex >= this.autoPath.length - 1) {
      this.stopAutoNavigate();
      return;
    }
    const remaining = toTarget.length();
    const direction = toTarget.normalize();
    const targetYaw = Math.atan2(-direction.x, -direction.y);
    this.rig.rotation.y = lerpAngle(this.rig.rotation.y, targetYaw, 1 - Math.exp(-delta * 9));
    this.cameraYawTarget = normalizeAngle(lerpAngle(this.cameraYawTarget, targetYaw, 1 - Math.exp(-delta * 4.8)));
    const speed = AUTO_NAVIGATION_SPEED * speedMultiplier;
    const step = Math.min(speed * delta, remaining);
    this.velocity.set(direction.x * speed, direction.y * speed);
    this.applyMovement(delta, maze, true, direction.x * step, direction.y * step);
  }

  /** 应用移动和碰撞。 */
  applyMovement(delta, maze, sprinting, forcedDx, forcedDz) {
    const deltaX = forcedDx ?? this.velocity.x * delta;
    const deltaZ = forcedDz ?? this.velocity.y * delta;
    const moved = this.collision.moveWithCollision(maze, this.rig.position.x, this.rig.position.z, deltaX, deltaZ, PLAYER_RADIUS);
    const actualDx = moved.x - this.rig.position.x;
    const actualDz = moved.z - this.rig.position.z;
    const actualDistance = Math.hypot(actualDx, actualDz);
    this.rig.position.x = moved.x;
    this.rig.position.z = moved.z;
    this.totalDistance += actualDistance;
    if (actualDistance > 0.001) {
      this.startCameraPullIn = Math.max(0, this.startCameraPullIn - delta * 1.65);
    }
    const horizontalSpeed = actualDistance / Math.max(delta, 0.0001);
    this.character.update(delta, this.rig.position, this.rig.rotation.y, horizontalSpeed, sprinting);
  }

  /** 更新第三人称相机位置。 */
  updateCamera(maze, snap, delta) {
    if (snap) {
      this.cameraYawTarget = normalizeAngle(this.rig.rotation.y);
      this.cameraYaw = this.cameraYawTarget;
    } else {
      this.cameraYaw = this.cameraYawTarget;
    }
    const yaw = this.cameraYaw;
    const distance = 6.2;
    const fixedPitch = 0.22;
    this.cameraTarget.set(this.rig.position.x, PLAYER_EYE_HEIGHT * 0.7, this.rig.position.z);
    if (snap) {
      this.smoothedCameraTarget.copy(this.cameraTarget);
      this.lookAtTarget.copy(this.cameraTarget);
    } else {
      this.smoothedCameraTarget.lerp(this.cameraTarget, 1 - Math.exp(-delta * 12));
      this.lookAtTarget.lerp(this.smoothedCameraTarget, 1 - Math.exp(-delta * 14));
    }

    const targetFactor = this.getCameraDistanceFactor(maze, yaw) * this.getStartCameraFactor();
    this.cameraDistanceFactor = this.updateCameraDistanceFactor(targetFactor, snap, delta);
    const horizontalDistance = Math.cos(fixedPitch) * distance * this.cameraDistanceFactor;
    this.desiredCameraPosition.set(
      this.smoothedCameraTarget.x + Math.sin(yaw) * horizontalDistance,
      this.smoothedCameraTarget.y + 1.35 + Math.sin(fixedPitch) * distance,
      this.smoothedCameraTarget.z + Math.cos(yaw) * horizontalDistance,
    );
    this.camera.position.copy(this.desiredCameraPosition);
    this.camera.lookAt(this.lookAtTarget);
  }

  /** 计算当前方向下安全相机距离。 */
  getCameraDistanceFactor(maze, yaw) {
    for (let factor = 1; factor >= 0.34; factor -= 0.025) {
      if (this.canPlaceCameraAlongView(maze, yaw, factor)) {
        return factor;
      }
    }
    return 0.34;
  }

  /** 平滑更新避障距离，转视角时放慢拉远。 */
  updateCameraDistanceFactor(targetFactor, snap, delta) {
    if (snap) {
      this.cameraDistanceGoalFactor = targetFactor;
      this.cameraRotateHoldTime = 0;
      return targetFactor;
    }
    this.cameraRotateHoldTime = Math.max(0, this.cameraRotateHoldTime - delta);
    if (targetFactor < this.cameraDistanceFactor - 0.035) {
      this.cameraDistanceGoalFactor = targetFactor;
    } else if (targetFactor > this.cameraDistanceGoalFactor) {
      const expandRate = this.cameraRotateHoldTime > 0 ? 0.18 : 1.05;
      this.cameraDistanceGoalFactor = THREE.MathUtils.lerp(this.cameraDistanceGoalFactor, targetFactor, 1 - Math.exp(-delta * expandRate));
    } else {
      this.cameraDistanceGoalFactor = THREE.MathUtils.lerp(this.cameraDistanceGoalFactor, targetFactor, 1 - Math.exp(-delta * 2.4));
    }
    const diff = this.cameraDistanceGoalFactor - this.cameraDistanceFactor;
    const maxShrink = delta * (diff < -0.22 ? 5.6 : 2.8);
    const maxExpand = delta * (this.cameraRotateHoldTime > 0 ? 0.18 : 0.72);
    return this.cameraDistanceFactor + THREE.MathUtils.clamp(diff, -maxShrink, maxExpand);
  }

  /** 检查相机视线段是否处于通道内。 */
  canPlaceCameraAlongView(maze, yaw, factor) {
    const horizontalDistance = Math.cos(0.22) * 6.2 * factor;
    const offsetX = Math.sin(yaw) * horizontalDistance;
    const offsetZ = Math.cos(yaw) * horizontalDistance;
    for (let index = 2; index <= 5; index += 1) {
      const t = index / 5;
      const x = this.smoothedCameraTarget.x + offsetX * t;
      const z = this.smoothedCameraTarget.z + offsetZ * t;
      if (!this.collision.canOccupy(maze, x, z, 0.12)) {
        return false;
      }
    }
    return true;
  }

  /** 返回开局临时拉近倍率。 */
  getStartCameraFactor() {
    return THREE.MathUtils.lerp(1, 0.52, this.startCameraPullIn);
  }
}

/** 传送门、粒子和天空效果。 */
class Effects {
  /** 创建效果根节点。 */
  constructor(assets) {
    this.assets = assets;
    this.group = new THREE.Group();
    this.portal = new THREE.Group();
    this.portalLight = undefined;
    this.burstTime = 0;
  }

  /** 创建天空穹顶。 */
  createSkyDome() {
    const geometry = new THREE.SphereGeometry(360, 32, 16);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0xbdd8ff) },
        horizonColor: { value: new THREE.Color(0xffd37a) },
        sunColor: { value: new THREE.Color(0xfff1b8) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunColor;
        void main() {
          vec3 direction = normalize(vWorldPosition);
          float h = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 color = mix(horizonColor, topColor, smoothstep(0.22, 0.92, h));
          float sun = pow(max(dot(direction, normalize(vec3(-0.35, 0.22, -0.45))), 0.0), 48.0);
          gl_FragColor = vec4(color + sunColor * sun * 0.48, 1.0);
        }
      `,
    });
    return new THREE.Mesh(geometry, material);
  }

  /** 根据迷宫重建终点光效。 */
  rebuildForMaze(maze) {
    this.group.clear();
    this.portal = this.createPortal(maze);
    this.group.add(this.portal);
  }

  /** 更新传送门呼吸效果。 */
  update(delta, elapsed) {
    this.portal.rotation.y = Math.sin(elapsed * 0.55) * 0.08;
    this.portal.position.y = 0.08 + Math.sin(elapsed * 1.4) * 0.045;
    if (this.portalLight) {
      const burst = Math.max(0, 1 - this.burstTime);
      this.portalLight.intensity = 2.2 + Math.sin(elapsed * 2.4) * 0.35 + burst * 5;
    }
    if (this.burstTime > 0) {
      this.burstTime = Math.max(0, this.burstTime - delta);
    }
  }

  /** 触发胜利爆发。 */
  playVictoryBurst() {
    this.burstTime = 1;
    this.portal.scale.setScalar(1.25);
  }

  /** 创建出口传送门。 */
  createPortal(maze) {
    const exit = maze.getExitWorld();
    const group = new THREE.Group();
    group.position.set(exit.x, 0.08, exit.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 12, 64), new THREE.MeshStandardMaterial({
      color: 0xffc857,
      emissive: 0xffa726,
      emissiveIntensity: 1.4,
      roughness: 0.35,
      metalness: 0.15,
    }));
    ring.position.y = 1.55;
    ring.rotation.x = Math.PI / 2;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.05, 3.5, 32, 1, true), this.assets.createPortalMaterial());
    column.position.y = 1.75;
    this.portalLight = new THREE.PointLight(0xffca62, 2.4, CELL_SIZE * 5, 1.4);
    this.portalLight.position.set(0, 1.7, 0);
    group.add(column, ring, this.portalLight);
    return group;
  }
}

/** 使用微信原生音频播放器循环播放沙漠遗迹氛围音乐。 */
class MiniAudio {
  /** 初始化背景音乐状态。 */
  constructor() {
    this.audio = undefined;
    this.enabled = true;
    this.pendingPlay = false;
    this.playing = false;
    this.playCheckTimer = undefined;
    this.playConfirmed = false;
    this.errorShown = false;
  }

  /**
   * 创建微信 InnerAudioContext 并配置本地循环音乐。
   * @returns {boolean} 音频播放器是否可用。
   */
  ensurePlayer() {
    if (this.audio) return true;
    if (typeof wx === 'undefined' || !wx.createInnerAudioContext) return false;
    try {
      this.audio = wx.createInnerAudioContext();
      this.audio.loop = true;
      this.audio.autoplay = false;
      this.audio.volume = 0.38;
      this.audio.obeyMuteSwitch = false;
      this.audio.onCanplay(() => {
        if (this.pendingPlay) this.audio.play();
      });
      this.audio.onPlay(() => {
        this.pendingPlay = false;
        this.playing = true;
        if (this.playCheckTimer) {
          clearTimeout(this.playCheckTimer);
          this.playCheckTimer = undefined;
        }
        if (!this.playConfirmed && wx.showToast) {
          this.playConfirmed = true;
          wx.showToast({ title: '背景音乐已开启', icon: 'none', duration: 1200 });
        }
      });
      this.audio.onPause(() => {
        this.playing = false;
      });
      this.audio.onError((error) => {
        console.error('[GoldenMazeMini] background music load failed', error);
        this.enabled = false;
        this.pendingPlay = false;
        this.playing = false;
        if (this.playCheckTimer) {
          clearTimeout(this.playCheckTimer);
          this.playCheckTimer = undefined;
        }
        if (!this.errorShown && wx.showToast) {
          this.errorShown = true;
          wx.showToast({ title: '背景音乐加载失败', icon: 'none' });
        }
      });
      // 监听器先注册再设置 src，避免本地资源过快就绪而漏掉 onCanplay。
      this.audio.src = 'assets/audio/desert-theme-cc0.mp3';
      return true;
    } catch (error) {
      console.warn('[GoldenMazeMini] background music unavailable', error);
      this.audio = undefined;
      return false;
    }
  }

  /** 在用户交互后播放或恢复背景音乐。 */
  start() {
    if (!this.enabled) return;
    this.pendingPlay = true;
    if (!this.ensurePlayer()) {
      this.enabled = false;
      this.pendingPlay = false;
      return;
    }
    try {
      this.audio.play();
      if (this.playCheckTimer) clearTimeout(this.playCheckTimer);
      this.playCheckTimer = setTimeout(() => {
        if (this.pendingPlay && !this.playing) {
          this.enabled = false;
          this.pendingPlay = false;
          if (typeof wx !== 'undefined' && wx.showToast) {
            wx.showToast({ title: '背景音乐未能播放', icon: 'none' });
          }
        }
      }, 3000);
    } catch (error) {
      console.warn('[GoldenMazeMini] background music play failed', error);
    }
  }

  /** 暂停背景音乐并保留当前播放位置。 */
  stop() {
    this.pendingPlay = false;
    this.playing = false;
    if (this.playCheckTimer) {
      clearTimeout(this.playCheckTimer);
      this.playCheckTimer = undefined;
    }
    if (this.audio) this.audio.pause();
  }

  /**
   * 切换音乐开关。
   * @returns {boolean} 切换后的启用状态。
   */
  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.start();
    } else {
      this.stop();
    }
    return this.enabled;
  }
}

/** 绘制和命中测试移动端 HUD、摇杆、按钮和俯瞰图。 */
class MiniHud {
  /** 创建 HUD overlay scene。 */
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
    this.camera.position.z = 10;
    this.buttons = [];
    this.buttonMeshes = new Map();
    this.activeButtonId = undefined;
    this.joystick = {
      active: false,
      id: undefined,
      defaultCenter: { x: 100, y: 100 },
      inputOrigin: { x: 100, y: 100 },
      center: { x: 100, y: 100 },
      knob: { x: 100, y: 100 },
      radius: 58,
    };
    this.minimapVisible = false;
    this.minimapMesh = undefined;
    this.minimapCanvas = undefined;
    this.minimapTexture = undefined;
    this.minimapFrame = 0;
    this.minimapDirty = true;
    this.joystickBase = undefined;
    this.joystickKnob = undefined;
    this.messageMesh = undefined;
    this.messageStateKey = '';
  }

  /** 更新 HUD 尺寸和按钮布局。 */
  resize(width, height) {
    this.width = width;
    this.height = height;
    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = height;
    this.camera.bottom = 0;
    this.camera.position.z = 10;
    this.camera.updateProjectionMatrix();
    this.layoutButtons();
    this.minimapDirty = true;
    this.messageStateKey = '';
    this.rebuildScene();
  }

  /** 根据横屏尺寸布局按钮。 */
  layoutButtons() {
    const right = this.width - 28;
    const midY = this.height * 0.32;
    const showDifficultyPicker = this.game.showStartMenu || this.game.won;
    const showGameplayButtons = !showDifficultyPicker;
    const difficultyWidth = 78;
    const difficultyGap = 8;
    const difficultyStartX = this.width / 2 - (difficultyWidth * 3 + difficultyGap * 2) / 2;
    const difficultyY = this.height / 2 + 4;
    this.joystick.defaultCenter = { x: 96, y: this.height - 92 };
    if (!this.joystick.active) {
      this.joystick.center = { ...this.joystick.defaultCenter };
      this.joystick.inputOrigin = { ...this.joystick.defaultCenter };
      this.joystick.knob = { ...this.joystick.center };
    }
    this.buttons = [
      { id: 'music', label: this.game.audio?.enabled ? '音乐开' : '音乐关', x: right - 82, y: 24, w: 82, h: 42, visible: showGameplayButtons },
      { id: 'map', label: '地图', x: right - 82, y: midY, w: 82, h: 42, visible: showGameplayButtons },
      { id: 'route', label: this.game.routeVisible ? '隐藏路线' : '提示', x: right - 82, y: midY + 52, w: 82, h: 42, visible: showGameplayButtons },
      { id: 'auto', label: this.game.player?.autoNavigating ? '停止寻路' : '自动寻路', x: right - 96, y: midY + 104, w: 96, h: 42, visible: showGameplayButtons },
      { id: 'difficulty-easy', label: '简单', x: difficultyStartX, y: difficultyY, w: difficultyWidth, h: 42, visible: showDifficultyPicker },
      { id: 'difficulty-normal', label: '普通', x: difficultyStartX + difficultyWidth + difficultyGap, y: difficultyY, w: difficultyWidth, h: 42, visible: showDifficultyPicker },
      { id: 'difficulty-hard', label: '困难', x: difficultyStartX + (difficultyWidth + difficultyGap) * 2, y: difficultyY, w: difficultyWidth, h: 42, visible: showDifficultyPicker },
      { id: 'start-game', label: '开始游戏', x: this.width / 2 - 56, y: difficultyY + 56, w: 112, h: 44, visible: this.game.showStartMenu },
      { id: 'restart', label: '再来一局', x: this.width / 2 - 56, y: difficultyY + 56, w: 112, h: 44, visible: this.game.won },
    ];
  }

  /** 重新创建 UI Mesh。 */
  rebuildScene() {
    this.scene.clear();
    this.buttonMeshes.clear();
    this.createJoystickMeshes();
    this.buttons.forEach((button) => {
      const mesh = this.createButtonMesh(button, false);
      this.scene.add(mesh);
      this.buttonMeshes.set(button.id, mesh);
    });
    this.createMinimapMesh();
    this.createMessageMesh();
  }

  /** 每帧更新动态 UI 状态。 */
  update() {
    this.layoutButtons();
    this.buttons.forEach((button) => {
      const mesh = this.buttonMeshes.get(button.id);
      if (mesh) {
        mesh.visible = button.visible !== false;
        const active = this.isButtonActive(button.id) || this.activeButtonId === button.id;
        const stateKey = `${button.label}:${active ? '1' : '0'}`;
        mesh.position.set(button.x + button.w / 2, this.toHudY(button.y + button.h / 2), 6);
        if (mesh.userData.stateKey !== stateKey) {
          mesh.material.map = this.createButtonTexture(button, active);
          mesh.material.needsUpdate = true;
          mesh.userData.stateKey = stateKey;
        }
      }
    });
    this.updateJoystickMeshes();
    this.updateMinimap();
    this.updateMessageMesh();
  }

  /** 处理触摸开始。 */
  handleTouchStart(touch) {
    const x = touch.clientX;
    const y = touch.clientY;
    const button = this.hitButton(x, y);
    if (button) {
      this.activeButtonId = button.id;
      return 'button';
    }
    if (this.game.showStartMenu || this.game.won) return undefined;
    if (x < this.width * 0.45 && y > this.height * 0.45) {
      this.joystick.active = true;
      this.joystick.id = touch.identifier;
      // 输入原点始终使用真实按下位置，显示中心只负责留出屏幕安全边距。
      this.joystick.inputOrigin = { x, y };
      this.joystick.center = {
        x: THREE.MathUtils.clamp(x, this.joystick.radius + 18, this.width * 0.42 - this.joystick.radius),
        y: THREE.MathUtils.clamp(y, this.height * 0.5 + this.joystick.radius, this.height - this.joystick.radius - 18),
      };
      this.joystick.knob = { ...this.joystick.center };
      this.updateJoystick(touch);
      return 'joystick';
    }
    if (x > this.width * 0.45) {
      return 'camera';
    }
    return undefined;
  }

  /** 处理触摸移动。 */
  handleTouchMove(touch) {
    if (this.joystick.active && touch.identifier === this.joystick.id) {
      this.updateJoystick(touch);
    }
  }

  /** 处理触摸结束并触发按钮。 */
  handleTouchEnd(touch) {
    if (this.joystick.active && touch.identifier === this.joystick.id) {
      this.joystick.active = false;
      this.joystick.id = undefined;
      this.joystick.center = { ...this.joystick.defaultCenter };
      this.joystick.inputOrigin = { ...this.joystick.defaultCenter };
      this.joystick.knob = { ...this.joystick.center };
      this.game.player.setMoveInput(0, 0, 0);
      return;
    }
    const button = this.buttons.find((item) => item.id === this.activeButtonId);
    if (button) {
      this.activeButtonId = undefined;
      if (this.isInside(touch.clientX, touch.clientY, button)) {
        this.game.handleButton(button.id);
      }
    } else {
      this.activeButtonId = undefined;
    }
  }

  /** 更新摇杆位置和移动向量。 */
  updateJoystick(touch) {
    const dx = touch.clientX - this.joystick.inputOrigin.x;
    const dy = touch.clientY - this.joystick.inputOrigin.y;
    const distance = Math.hypot(dx, dy);
    const directionX = distance > 0.001 ? dx / distance : 0;
    const directionY = distance > 0.001 ? dy / distance : 0;
    const knobDistance = Math.min(distance, this.joystick.radius);
    const deadZone = 0.12;
    const engaged = distance >= this.joystick.radius * deadZone;

    this.joystick.knob = {
      x: this.joystick.center.x + directionX * knobDistance,
      y: this.joystick.center.y + directionY * knobDistance,
    };

    if (!engaged) {
      this.game.player.setMoveInput(0, 0, 0);
      return;
    }

    this.game.player.setMoveInput(directionX, -directionY, 1);
  }

  /** 命中按钮。 */
  hitButton(x, y) {
    return this.buttons.find((button) => button.visible !== false && this.isInside(x, y, button));
  }

  /** 判断点是否在矩形内。 */
  isInside(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  /** 判断按钮是否处于激活态。 */
  isButtonActive(id) {
    return (id === 'map' && this.minimapVisible)
      || (id === 'route' && this.game.routeVisible)
      || (id === 'auto' && this.game.player?.autoNavigating)
      || (id === 'music' && this.game.audio?.enabled)
      || id === `difficulty-${this.game.difficulty}`;
  }

  /** 创建按钮 Mesh。 */
  createButtonMesh(button, active) {
    const geometry = new THREE.PlaneGeometry(button.w, button.h);
    const material = new THREE.MeshBasicMaterial({
      map: this.createButtonTexture(button, active),
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(button.x + button.w / 2, this.toHudY(button.y + button.h / 2), 6);
    mesh.frustumCulled = false;
    return mesh;
  }

  /** 创建按钮贴图。 */
  createButtonTexture(button, active) {
    const canvas = create2DCanvas(180, 84);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = active ? 'rgba(244,195,95,0.88)' : 'rgba(18,11,6,0.58)';
    ctx.strokeStyle = active ? 'rgba(255,241,190,0.95)' : 'rgba(244,195,95,0.72)';
    ctx.lineWidth = 3;
    this.roundRect(ctx, 6, 6, 168, 72, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = active ? '#241506' : '#ffe9aa';
    ctx.font = 'bold 25px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(button.label, 90, 43);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  /** 创建摇杆 Mesh。 */
  createJoystickMeshes() {
    const baseMat = new THREE.MeshBasicMaterial({ color: 0xf4c35f, transparent: true, opacity: 0.18, depthWrite: false, depthTest: false });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe39a, transparent: true, opacity: 0.36, depthWrite: false, depthTest: false });
    this.joystickBase = new THREE.Mesh(new THREE.CircleGeometry(this.joystick.radius, 48), baseMat);
    this.joystickKnob = new THREE.Mesh(new THREE.CircleGeometry(22, 32), ringMat);
    this.joystickBase.frustumCulled = false;
    this.joystickKnob.frustumCulled = false;
    this.scene.add(this.joystickBase, this.joystickKnob);
    this.updateJoystickMeshes();
  }

  /** 更新摇杆 Mesh。 */
  updateJoystickMeshes() {
    if (!this.joystickBase || !this.joystickKnob) return;
    const visible = !this.game.showStartMenu && !this.game.won;
    this.joystickBase.visible = visible;
    this.joystickKnob.visible = visible;
    this.joystickBase.position.set(this.joystick.center.x, this.toHudY(this.joystick.center.y), 0);
    this.joystickKnob.position.set(this.joystick.knob.x, this.toHudY(this.joystick.knob.y), 1);
    this.joystickKnob.material.opacity = this.joystick.active ? 0.78 : 0.28;
  }

  /** 创建俯瞰图 Mesh。 */
  createMinimapMesh() {
    const geometry = new THREE.PlaneGeometry(210, 210);
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false });
    this.minimapMesh = new THREE.Mesh(geometry, material);
    this.minimapMesh.position.set(126, this.toHudY(126), 2);
    this.minimapMesh.frustumCulled = false;
    this.scene.add(this.minimapMesh);
    this.minimapCanvas = create2DCanvas(256, 256);
    this.minimapTexture = new THREE.CanvasTexture(this.minimapCanvas);
    this.minimapTexture.colorSpace = THREE.SRGBColorSpace;
    this.minimapMesh.material.map = this.minimapTexture;
    this.minimapDirty = true;
  }

  /** 更新俯瞰图贴图。 */
  updateMinimap() {
    if (!this.minimapMesh) return;
    this.minimapMesh.visible = this.minimapVisible && !this.game.showStartMenu && !this.game.won;
    if (!this.minimapVisible || !this.game.maze) return;
    this.minimapFrame += 1;
    if (!this.minimapDirty && this.minimapFrame % 6 !== 0) return;
    this.minimapDirty = false;
    const canvas = this.minimapCanvas;
    const ctx = canvas.getContext('2d');
    const grid = this.game.maze.data.grid;
    const size = grid.length;
    const cell = 240 / size;
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(18,11,6,0.65)';
    this.roundRect(ctx, 0, 0, 256, 256, 12);
    ctx.fill();
    ctx.fillStyle = '#d8ad63';
    ctx.fillRect(8, 8, 240, 240);
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (grid[row][col] === 1) {
          ctx.fillStyle = '#2b190d';
          ctx.fillRect(8 + col * cell, 8 + row * cell, Math.max(1, cell - 1), Math.max(1, cell - 1));
        }
      }
    }
    const player = this.game.maze.worldToGrid(this.game.player.rig.position.x, this.game.player.rig.position.z);
    const exit = this.game.maze.getExitGrid();
    const exitX = 8 + (exit.col + 0.5) * cell;
    const exitY = 8 + (exit.row + 0.5) * cell;
    const exitSize = Math.max(6, cell * 1.45);
    ctx.fillStyle = '#4b2105';
    ctx.fillRect(exitX - exitSize / 2 - 2, exitY - exitSize / 2 - 2, exitSize + 4, exitSize + 4);
    ctx.fillStyle = '#e56f00';
    ctx.fillRect(exitX - exitSize / 2, exitY - exitSize / 2, exitSize, exitSize);
    ctx.fillStyle = '#35c8ff';
    ctx.beginPath();
    ctx.arc(8 + (player.col + 0.5) * cell, 8 + (player.row + 0.5) * cell, Math.max(3, cell * 0.45), 0, Math.PI * 2);
    ctx.fill();
    this.minimapTexture.needsUpdate = true;
  }

  /** 创建开始菜单、暂停和胜利提示弹层。 */
  createMessageMesh() {
    const geometry = new THREE.PlaneGeometry(460, 252);
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false });
    this.messageMesh = new THREE.Mesh(geometry, material);
    this.messageMesh.position.set(this.width / 2, this.toHudY(this.height / 2), 4);
    this.messageMesh.visible = false;
    this.messageMesh.frustumCulled = false;
    this.scene.add(this.messageMesh);
  }

  /** 更新暂停和胜利提示内容。 */
  updateMessageMesh() {
    if (!this.messageMesh) return;
    const stateKey = this.game.showStartMenu ? 'menu' : (this.game.won ? 'won' : (this.game.paused ? 'paused' : 'playing'));
    this.messageMesh.position.set(this.width / 2, this.toHudY(this.height / 2), 4);
    this.messageMesh.visible = stateKey !== 'playing';
    if (stateKey === this.messageStateKey) return;
    this.messageStateKey = stateKey;
    if (stateKey === 'playing') return;
    this.messageMesh.material.map = this.createMessageTexture(stateKey);
    this.messageMesh.material.needsUpdate = true;
  }

  /** 绘制状态弹层贴图。 */
  createMessageTexture(stateKey) {
    const canvas = create2DCanvas(512, 280);
    const ctx = canvas.getContext('2d');
    const won = stateKey === 'won';
    const menu = stateKey === 'menu';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(18,11,6,0.68)';
    ctx.strokeStyle = 'rgba(244,195,95,0.9)';
    ctx.lineWidth = 4;
    this.roundRect(ctx, 10, 10, 492, 260, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff2bd';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText(menu ? '黄金迷宫' : (won ? 'You Escaped!' : '已暂停'), 256, 64);
    ctx.font = '26px sans-serif';
    ctx.fillText(menu ? '选择难度' : (won ? '选择难度后再来一局' : '游戏已暂停'), 256, 118);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  /** 绘制圆角矩形路径。 */
  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 将屏幕坐标系的 y 值转换为 HUD 正交相机坐标。 */
  toHudY(screenY) {
    return this.height - screenY;
  }
}

/** 微信小游戏主运行时。 */
class MiniMazeGame {
  /** 初始化基础字段。 */
  constructor(canvas) {
    this.canvas = getMainCanvas(canvas);
    this.assets = new MiniAssets();
    this.collision = new CollisionSystem();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 520);
    this.clock = new THREE.Clock();
    this.effects = new Effects(this.assets);
    this.player = new MiniPlayerController(this.camera, this.collision);
    this.audio = new MiniAudio();
    // 小游戏默认使用普通难度，启动菜单允许切换三档难度。
    this.difficulty = 'normal';
    this.showStartMenu = true;
    this.hud = new MiniHud(this);
    this.maze = undefined;
    this.renderer = undefined;
    this.gl = undefined;
    this.animationId = 0;
    this.paused = false;
    this.won = false;
    this.routeVisible = false;
    this.cameraTouchId = undefined;
    this.lastCameraX = 0;
    this.firstFrameLogged = false;
  }

  /** 启动小游戏。 */
  start() {
    this.createRenderer();
    this.setupScene();
    this.createMaze();
    this.registerTouchEvents();
    this.registerResize();
    if (typeof wx !== 'undefined' && wx.onHide) {
      wx.onHide(() => this.audio.stop());
    }
    if (typeof wx !== 'undefined' && wx.onShow) {
      wx.onShow(() => {
        if (!this.showStartMenu) this.audio.start();
      });
    }
    if (typeof wx !== 'undefined' && wx.onAudioInterruptionBegin) {
      wx.onAudioInterruptionBegin(() => this.audio.stop());
    }
    if (typeof wx !== 'undefined' && wx.onAudioInterruptionEnd) {
      wx.onAudioInterruptionEnd(() => {
        if (!this.showStartMenu) this.audio.start();
      });
    }
    this.loop();
  }

  /** 创建 Three.js 渲染器。 */
  createRenderer() {
    const info = this.getWindowInfo();
    this.width = info.windowWidth;
    this.height = info.windowHeight;
    this.pixelRatio = Math.min(info.pixelRatio || 1, 1.5);
    this.patchCanvas(this.canvas);
    this.gl = this.createWebGLContext();
    console.log('[GoldenMazeMini] renderer init', {
      width: this.width,
      height: this.height,
      pixelRatio: this.pixelRatio,
      hasCanvas: Boolean(this.canvas),
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
    });
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      context: this.gl,
      antialias: Boolean(this.gl.getContextAttributes?.().antialias),
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.setClearColor(0xffd79a, 1);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.hud.resize(this.width, this.height);
    console.log('[GoldenMazeMini] webgl context', {
      drawingBufferWidth: this.renderer.getContext().drawingBufferWidth,
      drawingBufferHeight: this.renderer.getContext().drawingBufferHeight,
      version: this.gl.getParameter(this.gl.VERSION),
      vendor: this.gl.getParameter(this.gl.VENDOR),
      antialias: this.gl.getContextAttributes?.().antialias,
    });
  }

  /** 获取微信窗口尺寸；本地调试时保留浏览器兜底。 */
  getWindowInfo() {
    if (typeof wx !== 'undefined' && wx.getWindowInfo) return wx.getWindowInfo();
    if (typeof wx !== 'undefined' && wx.getSystemInfoSync) return wx.getSystemInfoSync();
    return {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      pixelRatio: window.devicePixelRatio || 1,
    };
  }

  /** 补齐微信 Canvas 上 Three.js 可能访问到的浏览器式方法。 */
  patchCanvas(canvas) {
    const noop = () => {};
    this.safePatchCanvasProperty(canvas, 'style', {});
    this.safePatchCanvasProperty(canvas, 'addEventListener', noop);
    this.safePatchCanvasProperty(canvas, 'removeEventListener', noop);
    this.safePatchCanvasProperty(canvas, 'getBoundingClientRect', () => ({
      left: 0,
      top: 0,
      width: this.width,
      height: this.height,
      right: this.width,
      bottom: this.height,
    }));
    this.safePatchCanvasProperty(canvas, 'ownerDocument', typeof document !== 'undefined' ? document : undefined);
    this.safePatchCanvasProperty(canvas, 'width', Math.max(1, Math.floor(this.width * this.pixelRatio)), true);
    this.safePatchCanvasProperty(canvas, 'height', Math.max(1, Math.floor(this.height * this.pixelRatio)), true);
    try {
      canvas.clientWidth = canvas.clientWidth || this.width;
      canvas.clientHeight = canvas.clientHeight || this.height;
    } catch (error) {
      // 浏览器 Canvas 的 clientWidth/clientHeight 可能是只读；微信 Canvas 通常允许补齐。
    }
  }

  /** 优先创建 WebGL1 上下文；Three.js 0.152 仍支持 WebGL1，更适合微信真机兼容。 */
  createWebGLContext() {
    const baseAttributes = {
      alpha: false,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    };
    const attempts = [
      { name: 'webgl', attributes: { ...baseAttributes, antialias: false } },
      { name: 'webgl', attributes: { ...baseAttributes, antialias: true } },
      { name: 'experimental-webgl', attributes: { ...baseAttributes, antialias: false } },
      { name: 'webgl2', attributes: { ...baseAttributes, antialias: false } },
    ];

    for (const attempt of attempts) {
      try {
        const gl = this.canvas.getContext(attempt.name, attempt.attributes);
        if (gl) {
          console.log('[GoldenMazeMini] webgl created', {
            name: attempt.name,
            antialias: attempt.attributes.antialias,
            hasTexImage3D: typeof gl.texImage3D === 'function',
          });
          return gl;
        }
      } catch (error) {
        console.warn('[GoldenMazeMini] webgl create failed', attempt.name, error);
      }
    }
    throw new Error('WebGL context creation failed on this device.');
  }

  /** 安全补齐 Canvas 属性，兼容开发者工具里的只读 getter。 */
  safePatchCanvasProperty(target, key, value, force = false) {
    try {
      if (!force && typeof target[key] !== 'undefined') return;
    } catch (error) {
      // getter 读取异常时继续尝试 defineProperty。
    }
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value,
      });
    } catch (error) {
      try {
        target[key] = value;
      } catch (assignError) {
        // 只读属性保持运行时原值，避免因为兼容补丁中断启动。
      }
    }
  }

  /** 创建场景光照、天空和角色。 */
  setupScene() {
    this.scene.background = new THREE.Color(0xffd79a);
    this.scene.fog = new THREE.FogExp2(0xffd89f, 0.011);
    this.scene.add(this.effects.createSkyDome());
    this.scene.add(new THREE.HemisphereLight(0xfff3ca, 0x8d6230, 1.55));
    const sun = new THREE.DirectionalLight(0xfff0bf, 2.7);
    sun.position.set(-22, 34, -18);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xf0b15e, 0.42);
    fill.position.set(18, 8, 16);
    this.scene.add(fill);
    this.scene.add(this.effects.group, this.player.rig, this.player.character.group);
  }

  /** 创建或重建迷宫。 */
  createMaze() {
    if (this.maze) {
      this.scene.remove(this.maze.group);
    }
    this.routeVisible = false;
    this.won = false;
    this.paused = this.showStartMenu;
    this.maze = new Maze(this.assets, this.difficulty, Date.now() % 100000000);
    this.maze.setRouteVisible(false);
    this.scene.add(this.maze.group);
    this.effects.rebuildForMaze(this.maze);
    const start = this.maze.getStartWorld();
    this.player.reset(start, this.getStartCameraYaw(), this.maze);
    this.hud.minimapDirty = true;
    this.hud.messageStateKey = '';
  }

  /** 根据起点路线选择初始相机朝向。 */
  getStartCameraYaw() {
    if (!this.maze || this.maze.data.solution.length < 2) return -Math.PI / 2;
    const start = this.maze.data.solution[0];
    const next = this.maze.data.solution[1];
    return Math.atan2(-(next.col - start.col), -(next.row - start.row));
  }

  /** 处理 HUD 按钮。 */
  handleButton(id) {
    if (id.startsWith('difficulty-')) {
      const difficulty = id.slice('difficulty-'.length);
      if (DIFFICULTIES[difficulty]) {
        this.difficulty = difficulty;
      }
      return;
    }
    if (id === 'start-game') {
      this.showStartMenu = false;
      this.createMaze();
      this.audio.start();
      return;
    }
    if (id === 'restart') {
      this.createMaze();
      this.audio.start();
      return;
    }
    if (id === 'music') {
      this.audio.toggle();
      return;
    }
    if (id === 'map') {
      this.hud.minimapVisible = !this.hud.minimapVisible;
      this.hud.minimapDirty = true;
      return;
    }
    if (id === 'route') {
      this.routeVisible = !this.routeVisible;
      if (this.routeVisible) {
        this.updateRouteHintFromPlayer();
      }
      this.maze.setRouteVisible(this.routeVisible);
      return;
    }
    if (id === 'auto') {
      this.toggleAutoNavigate();
      return;
    }
  }

  /** 切换自动寻路。 */
  toggleAutoNavigate() {
    if (!this.maze || this.paused || this.won) return;
    if (this.player.autoNavigating) {
      this.player.stopAutoNavigate();
      return;
    }
    const start = this.maze.worldToGrid(this.player.rig.position.x, this.player.rig.position.z);
    const path = this.maze.findPath(start, this.maze.getExitGrid());
    if (path.length < 2) return;
    this.player.startAutoNavigate(path.map((point) => this.maze.gridToWorld(point)));
  }

  /** 按角色当前所在网格刷新到出口的路线提示。 */
  updateRouteHintFromPlayer() {
    if (!this.maze || !this.player) return;
    const currentCell = this.maze.worldToGrid(this.player.rig.position.x, this.player.rig.position.z);
    this.maze.updateRouteHint(currentCell);
  }

  /** 注册微信触摸事件。 */
  registerTouchEvents() {
    if (typeof wx === 'undefined') return;
    wx.onTouchStart((event) => {
      for (const touch of event.changedTouches) {
        const role = this.hud.handleTouchStart(touch);
        if (role === 'camera') {
          this.cameraTouchId = touch.identifier;
          this.lastCameraX = touch.clientX;
        }
      }
    });
    wx.onTouchMove((event) => {
      for (const touch of event.changedTouches) {
        this.hud.handleTouchMove(touch);
        if (touch.identifier === this.cameraTouchId) {
          const dx = touch.clientX - this.lastCameraX;
          this.lastCameraX = touch.clientX;
          this.player.rotateCamera(dx);
        }
      }
    });
    wx.onTouchEnd((event) => {
      for (const touch of event.changedTouches) {
        this.hud.handleTouchEnd(touch);
        if (touch.identifier === this.cameraTouchId) {
          this.cameraTouchId = undefined;
        }
      }
    });
    wx.onTouchCancel((event) => {
      for (const touch of event.changedTouches) {
        this.hud.handleTouchEnd(touch);
        if (touch.identifier === this.cameraTouchId) {
          this.cameraTouchId = undefined;
        }
      }
    });
  }

  /** 注册窗口尺寸变化，适配开发者工具横屏和真机旋转。 */
  registerResize() {
    if (typeof wx === 'undefined' || !wx.onWindowResize) return;
    wx.onWindowResize((info) => {
      this.resize(info.windowWidth, info.windowHeight, info.pixelRatio || this.pixelRatio);
    });
  }

  /** 更新渲染器、主相机和 HUD 尺寸。 */
  resize(width, height, pixelRatio) {
    this.width = width;
    this.height = height;
    this.pixelRatio = Math.min(pixelRatio || this.pixelRatio || 1, 1.5);
    this.patchCanvas(this.canvas);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.hud.resize(this.width, this.height);
    this.patchCanvas(this.canvas);
  }

  /** 检查是否到达出口。 */
  checkVictory() {
    const exit = this.maze.getExitWorld();
    const dx = this.player.rig.position.x - exit.x;
    const dz = this.player.rig.position.z - exit.z;
    if (Math.hypot(dx, dz) < 1.55) {
      this.won = true;
      this.paused = true;
      this.player.stopAutoNavigate();
      this.effects.playVictoryBurst();
    }
  }

  /** 主循环。 */
  loop() {
    this.animationId = typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame(() => this.loop())
      : setTimeout(() => this.loop(), 16);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

    if (!this.paused && !this.won) {
      this.player.update(delta, this.maze, DIFFICULTIES[this.difficulty].speedMultiplier);
      if (this.routeVisible) {
        this.updateRouteHintFromPlayer();
      }
      this.checkVictory();
    }
    this.maze.update(elapsed);
    this.effects.update(delta, elapsed);
    this.hud.update();

    this.renderer.autoClear = false;
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.camera);
    this.renderer.clear(false, true, false);
    this.renderer.render(this.hud.scene, this.hud.camera);
    this.renderer.getContext().flush();
    if (!this.firstFrameLogged) {
      this.firstFrameLogged = true;
      console.log('[GoldenMazeMini] first frame rendered', {
        sceneChildren: this.scene.children.length,
        hudChildren: this.hud.scene.children.length,
        cameraPosition: this.camera.position.toArray(),
        mazeReady: Boolean(this.maze),
      });
    }
  }
}

module.exports = { MiniMazeGame };
