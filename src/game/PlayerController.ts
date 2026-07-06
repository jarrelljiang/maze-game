import * as THREE from 'three';
import { Character } from './Character';
import { PLAYER_EYE_HEIGHT, PLAYER_RADIUS } from './constants';
import type { Maze } from './Maze';
import type { CollisionSystem } from './CollisionSystem';
import type { WorldPoint } from '../types';

interface PlayerControllerOptions {
  onReset: () => void;
  onToggleRoute: () => void;
  onToggleAutoNavigate: () => void;
}

export class PlayerController {
  public readonly rig = new THREE.Object3D();

  public readonly character = new Character();

  private readonly velocity = new THREE.Vector2();

  private readonly keys = new Set<string>();

  private readonly cameraTarget = new THREE.Vector3();

  private readonly smoothedCameraTarget = new THREE.Vector3();

  private readonly desiredCameraPosition = new THREE.Vector3();

  private readonly fittedCameraPosition = new THREE.Vector3();

  private readonly autoPath: THREE.Vector2[] = [];

  private autoPathIndex = 0;

  private autoNavigating = false;

  private cameraDistanceFactor = 1;

  private startCameraPullIn = 0;

  // 当前用于渲染相机的 yaw；鼠标输入会即时写入，避免停手后仍有惯性。
  private cameraYaw = 0;

  // 自动寻路等非鼠标控制源使用目标 yaw；鼠标视角不通过它制造延迟。
  private cameraYawTarget = 0;

  private readonly lookAtTarget = new THREE.Vector3();

  private totalDistance = 0;

  private sensitivity = 1;

  private enabled = false;

  private pointerLocked = false;

  private mouseLookActive = false;

  /** 建立第三人称角色控制器，并注册键鼠事件。 */
  constructor(
    public readonly camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement,
    private readonly collision: CollisionSystem,
    private readonly options: PlayerControllerOptions,
  ) {
    this.rig.name = 'player-rig';
    this.rig.position.y = 0;
    this.registerEvents();
  }

  /** 启用移动和视角控制。 */
  enable(): void {
    this.enabled = true;
  }

  /** 禁用控制并清空当前移动状态。 */
  disable(): void {
    this.enabled = false;
    this.mouseLookActive = false;
    this.keys.clear();
    this.velocity.set(0, 0);
  }

  /** 请求浏览器锁定鼠标，必须由用户点击触发。 */
  lockPointer(): void {
    this.domElement.requestPointerLock();
  }

  /** 主动释放鼠标锁定。 */
  unlockPointer(): void {
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
    this.mouseLookActive = false;
  }

  /** 设置鼠标灵敏度倍率。 */
  setSensitivity(value: number): void {
    this.sensitivity = THREE.MathUtils.clamp(value, 0.35, 2.3);
  }

  /** 重置玩家到指定位置和朝向。 */
  reset(position: { x: number; z: number }, yaw = Math.PI, maze?: Maze): void {
    this.rig.position.set(position.x, 0, position.z);
    this.rig.rotation.y = yaw;
    this.cameraYaw = yaw;
    this.cameraYawTarget = yaw;
    this.cameraDistanceFactor = 0.52;
    this.startCameraPullIn = 1;
    this.velocity.set(0, 0);
    this.stopAutoNavigate();
    this.totalDistance = 0;
    this.character.update(0, this.rig.position, this.rig.rotation.y, 0, false);
    this.updateCamera(maze, true);
  }

  /** 更新移动、阻尼、碰撞、角色动画和跟随相机。 */
  update(delta: number, maze: Maze, speedMultiplier: number): void {
    if (!this.enabled || !this.pointerLocked) {
      this.velocity.multiplyScalar(Math.exp(-delta * 8));
      this.character.update(delta, this.rig.position, this.rig.rotation.y, this.velocity.length(), false);
      this.updateCamera(maze, false, delta);
      return;
    }

    if (this.autoNavigating) {
      this.updateAutoNavigation(delta, maze, speedMultiplier);
      return;
    }

    const input = this.getInputVector(delta);
    const isSprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const maxSpeed = (isSprinting ? 7.0 : 4.35) * speedMultiplier;
    const accel = 24;

    if (input.lengthSq() > 0) {
      input.normalize().multiplyScalar(accel * delta);
      this.velocity.add(input);
      this.velocity.clampLength(0, maxSpeed);
    } else {
      this.velocity.multiplyScalar(Math.exp(-delta * 7.5));
    }

    const deltaX = this.velocity.x * delta;
    const deltaZ = this.velocity.y * delta;
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
    this.character.update(delta, this.rig.position, this.rig.rotation.y, horizontalSpeed, isSprinting);
    this.updateCamera(maze, false, delta);
  }

  /** 返回玩家累计移动距离。 */
  getDistance(): number {
    return this.totalDistance;
  }

  /** 返回当前罗盘方向。 */
  getHeading(): string {
    const yaw = ((this.rig.rotation.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const headings = ['N', 'W', 'S', 'E'];
    return headings[Math.round(yaw / (Math.PI / 2)) % 4];
  }

  /** 检查浏览器是否处于当前画布的鼠标锁定状态。 */
  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  /** 启动自动寻路，路径点使用世界坐标并由控制器逐点跟随。 */
  startAutoNavigate(points: WorldPoint[]): void {
    this.autoPath.length = 0;
    points.forEach((point) => this.autoPath.push(new THREE.Vector2(point.x, point.z)));
    this.autoPathIndex = this.findNearestPathIndex();
    this.autoNavigating = this.autoPath.length > 1;
    this.velocity.set(0, 0);
  }

  /** 停止自动寻路并保留玩家当前位置。 */
  stopAutoNavigate(): void {
    this.autoNavigating = false;
    this.autoPath.length = 0;
    this.autoPathIndex = 0;
  }

  /** 返回当前是否正在由自动寻路驱动角色移动。 */
  isAutoNavigating(): boolean {
    return this.autoNavigating;
  }

  /** 监听键盘、鼠标左键拖拽和 Pointer Lock 状态变化。 */
  private registerEvents(): void {
    window.addEventListener('keydown', (event) => {
      if (!this.enabled) {
        return;
      }
      if (this.isControlKey(event.code)) {
        event.preventDefault();
      }
      if (event.code === 'KeyR') {
        this.options.onReset();
        return;
      }
      if (event.code === 'KeyM') {
        this.options.onToggleRoute();
        return;
      }
      if (event.code === 'KeyF') {
        this.options.onToggleAutoNavigate();
        return;
      }
      if (this.autoNavigating && this.isMovementKey(event.code)) {
        this.stopAutoNavigate();
      }
      this.keys.add(event.code);
    });

    window.addEventListener('keyup', (event) => {
      if (this.isControlKey(event.code)) {
        event.preventDefault();
      }
      this.keys.delete(event.code);
    });

    this.domElement.addEventListener('mousedown', (event) => {
      if (!this.enabled || event.button !== 0) {
        return;
      }
      event.preventDefault();
      this.mouseLookActive = true;
      if (!this.pointerLocked) {
        this.lockPointer();
      }
    });

    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) {
        this.mouseLookActive = false;
      }
    });

    document.addEventListener('mousemove', (event) => {
      if (!this.enabled || !this.pointerLocked || !this.mouseLookActive) {
        return;
      }
      const lookSpeed = 0.0022 * this.sensitivity;
      const safeMovementX = THREE.MathUtils.clamp(event.movementX, -80, 80);
      this.cameraYawTarget = this.normalizeAngle(this.cameraYawTarget - safeMovementX * lookSpeed);
      this.cameraYaw = this.cameraYawTarget;
      if (!this.hasMovementInput()) {
        this.rig.rotation.y = this.cameraYawTarget;
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.domElement;
      if (!this.pointerLocked) {
        this.mouseLookActive = false;
      }
    });

    window.addEventListener('blur', () => {
      this.mouseLookActive = false;
      this.keys.clear();
    });
  }

  /** 自动寻路时沿路径点移动，并让相机平滑转向当前前进方向。 */
  private updateAutoNavigation(delta: number, maze: Maze, speedMultiplier: number): void {
    const target = this.getCurrentAutoTarget();
    if (!target) {
      this.stopAutoNavigate();
      this.velocity.multiplyScalar(Math.exp(-delta * 8));
      this.character.update(delta, this.rig.position, this.rig.rotation.y, 0, false);
      this.updateCamera(maze, false, delta);
      return;
    }

    const toTarget = new THREE.Vector2(target.x - this.rig.position.x, target.y - this.rig.position.z);
    if (toTarget.length() < 0.22 && this.autoPathIndex < this.autoPath.length - 1) {
      this.autoPathIndex += 1;
      this.updateAutoNavigation(delta, maze, speedMultiplier);
      return;
    }
    if (toTarget.length() < 0.26 && this.autoPathIndex >= this.autoPath.length - 1) {
      this.stopAutoNavigate();
      this.velocity.set(0, 0);
      this.character.update(delta, this.rig.position, this.rig.rotation.y, 0, false);
      this.updateCamera(maze, false, delta);
      return;
    }

    const remainingDistance = toTarget.length();
    const direction = toTarget.normalize();
    const targetYaw = Math.atan2(-direction.x, -direction.y);
    this.rig.rotation.y = this.lerpAngle(this.rig.rotation.y, targetYaw, 1 - Math.exp(-delta * 9));
    this.cameraYawTarget = this.normalizeAngle(this.lerpAngle(this.cameraYawTarget, targetYaw, 1 - Math.exp(-delta * 4.8)));
    const autoSpeed = 4.8 * speedMultiplier;
    const stepDistance = Math.min(autoSpeed * delta, remainingDistance);
    this.velocity.set(direction.x * autoSpeed, direction.y * autoSpeed);

    const deltaX = direction.x * stepDistance;
    const deltaZ = direction.y * stepDistance;
    const moved = this.collision.moveWithCollision(maze, this.rig.position.x, this.rig.position.z, deltaX, deltaZ, PLAYER_RADIUS);
    const actualDx = moved.x - this.rig.position.x;
    const actualDz = moved.z - this.rig.position.z;
    const actualDistance = Math.hypot(actualDx, actualDz);

    this.rig.position.x = moved.x;
    this.rig.position.z = moved.z;
    this.totalDistance += actualDistance;
    this.startCameraPullIn = Math.max(0, this.startCameraPullIn - delta * 1.65);

    const horizontalSpeed = actualDistance / Math.max(delta, 0.0001);
    this.character.update(delta, this.rig.position, this.rig.rotation.y, horizontalSpeed, false);
    this.updateCamera(maze, false, delta);
  }

  /** 返回当前自动寻路目标点。 */
  private getCurrentAutoTarget(): THREE.Vector2 | undefined {
    return this.autoPath[this.autoPathIndex];
  }

  /** 自动寻路启动时从最接近玩家当前位置的路径点开始，减少回头贴格子的情况。 */
  private findNearestPathIndex(): number {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    this.autoPath.forEach((point, index) => {
      const distance = point.distanceToSquared(new THREE.Vector2(this.rig.position.x, this.rig.position.z));
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    });
    return bestIndex;
  }

  /** 将键盘输入转换成相机朝向下的世界空间水平移动向量，并让角色转向移动方向。 */
  private getInputVector(delta: number): THREE.Vector2 {
    const forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const side = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const yaw = this.cameraYawTarget;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);

    const input = new THREE.Vector2(
      -sin * forward + cos * side,
      -cos * forward - sin * side,
    );
    if (input.lengthSq() > 0.0001) {
      const targetYaw = Math.atan2(-input.x, -input.y);
      const turnSpeed = 1 - Math.exp(-delta * 7.5);
      this.rig.rotation.y = this.lerpAngle(this.rig.rotation.y, targetYaw, turnSpeed);
      return input.normalize();
    }
    return input;
  }

  /** 更新角色背后的相机位置，并在靠墙时把相机推近。 */
  private updateCamera(maze?: Maze, snap = false, delta = 1 / 60): void {
    if (snap) {
      this.cameraYawTarget = this.normalizeAngle(this.rig.rotation.y);
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

    let targetFactor = 1;
    if (maze) {
      targetFactor = this.getCameraDistanceFactor(maze, yaw);
    }
    targetFactor *= this.getStartCameraFactor();
    this.cameraDistanceFactor = this.updateCameraDistanceFactor(targetFactor, snap, delta);
    const fittedHorizontalDistance = Math.cos(fixedPitch) * distance * this.cameraDistanceFactor;
    this.desiredCameraPosition.set(
      this.smoothedCameraTarget.x + Math.sin(yaw) * fittedHorizontalDistance,
      this.smoothedCameraTarget.y + 1.35 + Math.sin(fixedPitch) * distance,
      this.smoothedCameraTarget.z + Math.cos(yaw) * fittedHorizontalDistance,
    );
    this.fittedCameraPosition.copy(this.desiredCameraPosition);

    this.camera.position.copy(this.fittedCameraPosition);
    this.camera.lookAt(this.lookAtTarget);
  }

  /** 沿角色到相机的方向采样，避免相机进入墙体。 */
  private getCameraDistanceFactor(maze: Maze, yaw: number): number {
    for (let factor = 1; factor >= 0.34; factor -= 0.025) {
      if (this.canPlaceCameraAlongView(maze, yaw, factor)) {
        return factor;
      }
    }
    return 0.34;
  }

  /** 平滑更新相机避障距离，靠墙时避免距离因采样边界来回跳。 */
  private updateCameraDistanceFactor(targetFactor: number, snap: boolean, delta: number): number {
    if (snap) {
      return targetFactor;
    }
    const maxShrink = delta * 5.8;
    const maxExpand = delta * 1.85;
    const diff = targetFactor - this.cameraDistanceFactor;
    const maxStep = diff < 0 ? maxShrink : maxExpand;
    return this.cameraDistanceFactor + THREE.MathUtils.clamp(diff, -maxStep, maxStep);
  }

  /** 检查相机目标点以及视线段是否都在可通行空间内，减少贴墙转身时的穿墙闪动。 */
  private canPlaceCameraAlongView(maze: Maze, yaw: number, factor: number): boolean {
    const horizontalDistance = Math.cos(0.22) * 6.2 * factor;
    const offsetX = Math.sin(yaw) * horizontalDistance;
    const offsetZ = Math.cos(yaw) * horizontalDistance;
    const sampleCount = 5;

    for (let index = 2; index <= sampleCount; index += 1) {
      const t = index / sampleCount;
      const x = this.smoothedCameraTarget.x + offsetX * t;
      const z = this.smoothedCameraTarget.z + offsetZ * t;
      if (!this.collision.canOccupy(maze, x, z, 0.12)) {
        return false;
      }
    }
    return true;
  }

  /** 返回开局临时拉近倍率，玩家开始移动后逐步恢复正常跟随距离。 */
  private getStartCameraFactor(): number {
    return THREE.MathUtils.lerp(1, 0.52, this.startCameraPullIn);
  }

  /** 角度插值走最短路径，避免角色转身跨过 PI 时突然跳变。 */
  private lerpAngle(current: number, target: number, factor: number): number {
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + delta * factor;
  }

  /** 将角度约束到 -PI 到 PI，避免长时间旋转后插值数值过大。 */
  private normalizeAngle(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  /** 判断角色是否正在接收移动输入，用于避免鼠标视角和转身输入相互抢控制权。 */
  private hasMovementInput(): boolean {
    return this.getMovementKeys().some((code) => this.keys.has(code));
  }

  /** 判断指定按键是否是手动移动键，用于中断自动寻路。 */
  private isMovementKey(code: string): boolean {
    return this.getMovementKeys().includes(code);
  }

  /** 返回所有手动移动按键。 */
  private getMovementKeys(): string[] {
    return [
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ];
  }

  /** 判断按键是否属于游戏控制键，需要阻止浏览器默认滚动。 */
  private isControlKey(code: string): boolean {
    return [
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'ShiftLeft',
      'ShiftRight',
      'KeyM',
      'KeyF',
      'KeyR',
    ].includes(code);
  }
}
