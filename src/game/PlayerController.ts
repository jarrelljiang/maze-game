import * as THREE from 'three';
import { PLAYER_EYE_HEIGHT, PLAYER_RADIUS } from './constants';
import type { Maze } from './Maze';
import type { CollisionSystem } from './CollisionSystem';

interface PlayerControllerOptions {
  onReset: () => void;
  onToggleRoute: () => void;
}

export class PlayerController {
  public readonly rig = new THREE.Object3D();

  public readonly avatar = new THREE.Group();

  private readonly pitch = new THREE.Object3D();

  private readonly velocity = new THREE.Vector2();

  private readonly keys = new Set<string>();

  private bobTime = 0;

  private totalDistance = 0;

  private sensitivity = 1;

  private enabled = false;

  private pointerLocked = false;

  /** 建立第一人称相机控制器，并注册键鼠事件。 */
  constructor(
    public readonly camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement,
    private readonly collision: CollisionSystem,
    private readonly options: PlayerControllerOptions,
  ) {
    this.pitch.add(camera);
    this.rig.add(this.pitch);
    this.rig.position.y = PLAYER_EYE_HEIGHT;
    this.createAvatar();
    this.registerEvents();
  }

  /** 启用移动和视角控制。 */
  enable(): void {
    this.enabled = true;
  }

  /** 禁用控制并清空当前移动状态。 */
  disable(): void {
    this.enabled = false;
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
  }

  /** 设置鼠标灵敏度倍率。 */
  setSensitivity(value: number): void {
    this.sensitivity = THREE.MathUtils.clamp(value, 0.35, 2.3);
  }

  /** 重置玩家到指定位置和朝向。 */
  reset(position: { x: number; z: number }, yaw = Math.PI): void {
    this.rig.position.set(position.x, PLAYER_EYE_HEIGHT, position.z);
    this.rig.rotation.y = yaw;
    this.pitch.rotation.x = 0;
    this.velocity.set(0, 0);
    this.bobTime = 0;
    this.totalDistance = 0;
    this.updateAvatar();
  }

  /** 更新移动、阻尼、碰撞和轻微头部晃动。 */
  update(delta: number, maze: Maze, speedMultiplier: number): void {
    if (!this.enabled || !this.pointerLocked) {
      this.velocity.multiplyScalar(Math.exp(-delta * 8));
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

    const moving = Math.hypot(actualDx, actualDz) > 0.001;
    this.bobTime = moving ? this.bobTime + delta * 8.5 : this.bobTime * 0.9;
    const bob = moving ? Math.sin(this.bobTime) * 0.025 + Math.sin(this.bobTime * 0.5) * 0.012 : 0;
    this.rig.position.y = PLAYER_EYE_HEIGHT + bob;
    this.updateAvatar();
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

  /** 监听键盘、鼠标移动和 Pointer Lock 状态变化。 */
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

    document.addEventListener('mousemove', (event) => {
      if (!this.enabled || !this.pointerLocked) {
        return;
      }
      const lookSpeed = 0.0022 * this.sensitivity;
      this.rig.rotation.y -= event.movementX * lookSpeed;
      this.pitch.rotation.x = THREE.MathUtils.clamp(this.pitch.rotation.x - event.movementY * lookSpeed, -1.48, 1.48);
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.domElement;
    });
  }

  /** 将键盘输入转换成世界空间水平移动向量。 */
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

  /** 创建低多边形 Q 版角色身体，用于阴影、低头可见身体和胜利镜头。 */
  private createAvatar(): void {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x6e78ff, roughness: 0.72 });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xffdc62, roughness: 0.6 });
    const bootMaterial = new THREE.MeshStandardMaterial({ color: 0x8d2d21, roughness: 0.8 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), bodyMaterial);
    body.name = 'chibi-body';
    body.scale.set(1, 0.9, 0.78);
    body.position.y = 0.68;
    body.castShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16), skinMaterial);
    head.name = 'chibi-head';
    head.position.y = 1.08;
    head.castShadow = true;

    const leftFoot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), bootMaterial);
    leftFoot.name = 'left-foot';
    leftFoot.scale.set(1.25, 0.55, 1.6);
    leftFoot.position.set(-0.16, 0.18, -0.07);
    leftFoot.castShadow = true;

    const rightFoot = leftFoot.clone();
    rightFoot.name = 'right-foot';
    rightFoot.position.x = 0.16;

    this.avatar.add(body, head, leftFoot, rightFoot);
    this.avatar.name = 'player-chibi';
    this.updateAvatar();
  }

  /** 同步第三人称可见角色模型位置，避免影响第一人称相机。 */
  private updateAvatar(): void {
    this.avatar.position.set(this.rig.position.x, 0, this.rig.position.z);
    this.avatar.rotation.y = this.rig.rotation.y + Math.PI;
  }
}
