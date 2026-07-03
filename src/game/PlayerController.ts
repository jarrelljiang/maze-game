import * as THREE from 'three';
import { Character } from './Character';
import { PLAYER_EYE_HEIGHT, PLAYER_RADIUS } from './constants';
import type { Maze } from './Maze';
import type { CollisionSystem } from './CollisionSystem';

interface PlayerControllerOptions {
  onReset: () => void;
  onToggleRoute: () => void;
}

export class PlayerController {
  public readonly rig = new THREE.Object3D();

  public readonly character = new Character();

  private readonly velocity = new THREE.Vector2();

  private readonly keys = new Set<string>();

  private readonly cameraTarget = new THREE.Vector3();

  private readonly desiredCameraPosition = new THREE.Vector3();

  private readonly fittedCameraPosition = new THREE.Vector3();

  private totalDistance = 0;

  private sensitivity = 1;

  private enabled = false;

  private pointerLocked = false;

  private mouseLookActive = false;

  private cameraPitch = 0.18;

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
  reset(position: { x: number; z: number }, yaw = Math.PI): void {
    this.rig.position.set(position.x, 0, position.z);
    this.rig.rotation.y = yaw;
    this.cameraPitch = 0.18;
    this.velocity.set(0, 0);
    this.totalDistance = 0;
    this.character.update(0, this.rig.position, this.rig.rotation.y, 0, false);
    this.updateCamera(undefined, true);
  }

  /** 更新移动、阻尼、碰撞、角色动画和跟随相机。 */
  update(delta: number, maze: Maze, speedMultiplier: number): void {
    if (!this.enabled || !this.pointerLocked) {
      this.velocity.multiplyScalar(Math.exp(-delta * 8));
      this.character.update(delta, this.rig.position, this.rig.rotation.y, this.velocity.length(), false);
      this.updateCamera(maze);
      return;
    }

    const input = this.getInputVector();
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

    this.rig.position.x = moved.x;
    this.rig.position.z = moved.z;
    this.totalDistance += Math.hypot(actualDx, actualDz);

    const horizontalSpeed = Math.hypot(actualDx, actualDz) / Math.max(delta, 0.0001);
    this.character.update(delta, this.rig.position, this.rig.rotation.y, horizontalSpeed, isSprinting);
    this.updateCamera(maze);
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
      this.rig.rotation.y -= event.movementX * lookSpeed;
      this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + event.movementY * lookSpeed, -0.36, 0.68);
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

  /** 将键盘输入转换成角色朝向下的世界空间水平移动向量。 */
  private getInputVector(): THREE.Vector2 {
    const forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const side = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const yaw = this.rig.rotation.y;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);

    return new THREE.Vector2(
      -sin * forward + cos * side,
      -cos * forward - sin * side,
    );
  }

  /** 更新角色背后的相机位置，并在靠墙时把相机推近。 */
  private updateCamera(maze?: Maze, snap = false): void {
    const yaw = this.rig.rotation.y;
    const distance = 6.2;
    const horizontalDistance = Math.cos(this.cameraPitch) * distance;
    this.cameraTarget.set(this.rig.position.x, PLAYER_EYE_HEIGHT * 0.7, this.rig.position.z);
    this.desiredCameraPosition.set(
      this.rig.position.x + Math.sin(yaw) * horizontalDistance,
      this.cameraTarget.y + 1.35 + Math.sin(this.cameraPitch) * distance,
      this.rig.position.z + Math.cos(yaw) * horizontalDistance,
    );

    if (maze) {
      this.fitCameraToMaze(maze);
    } else {
      this.fittedCameraPosition.copy(this.desiredCameraPosition);
    }

    if (snap) {
      this.camera.position.copy(this.fittedCameraPosition);
    } else {
      this.camera.position.lerp(this.fittedCameraPosition, 0.22);
    }
    this.camera.lookAt(this.cameraTarget);
  }

  /** 沿角色到相机的方向采样，避免相机进入墙体。 */
  private fitCameraToMaze(maze: Maze): void {
    this.fittedCameraPosition.copy(this.desiredCameraPosition);
    for (let t = 1; t >= 0.42; t -= 0.08) {
      this.fittedCameraPosition.lerpVectors(this.cameraTarget, this.desiredCameraPosition, t);
      if (this.collision.canOccupy(maze, this.fittedCameraPosition.x, this.fittedCameraPosition.z, 0.26)) {
        return;
      }
    }
    this.fittedCameraPosition.lerpVectors(this.cameraTarget, this.desiredCameraPosition, 0.42);
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
      'KeyR',
    ].includes(code);
  }
}
