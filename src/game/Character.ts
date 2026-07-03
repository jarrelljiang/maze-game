import * as THREE from 'three';

interface LimbSet {
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
}

export class Character {
  public readonly group = new THREE.Group();

  private readonly body = new THREE.Group();

  private readonly head = new THREE.Group();

  private readonly cape = new THREE.Group();

  private readonly backpack = new THREE.Group();

  private readonly limbs: LimbSet;

  private readonly hairTuft = new THREE.Group();

  private animationTime = 0;

  private idleTime = 0;

  private readonly baseScale = 0.92;

  /** 创建适合沙漠迷宫风格的 Q 版 low-poly 角色。 */
  constructor() {
    this.group.name = 'chibi-explorer-character';
    this.group.scale.setScalar(this.baseScale);
    this.group.add(this.createBody(), this.createHead());
    this.limbs = this.createLimbs();
    this.group.add(this.limbs.leftArm, this.limbs.rightArm, this.limbs.leftLeg, this.limbs.rightLeg);
    this.group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  /** 更新角色位置、朝向与待机/行走/奔跑动作。 */
  update(delta: number, position: THREE.Vector3, yaw: number, horizontalSpeed: number, sprinting: boolean): void {
    this.group.position.set(position.x, 0, position.z);
    this.group.rotation.y = yaw;

    const moving = horizontalSpeed > 0.08;
    const strideRate = sprinting ? 11.5 : 8.4;
    this.animationTime = moving ? this.animationTime + delta * strideRate : this.animationTime + delta * 3.2;
    this.idleTime += delta;

    const speedRatio = THREE.MathUtils.clamp(horizontalSpeed / (sprinting ? 7 : 4.4), 0, 1);
    const stride = moving ? Math.sin(this.animationTime) * (sprinting ? 0.72 : 0.52) * speedRatio : 0;
    const counterStride = -stride;
    const bounce = moving ? Math.abs(Math.sin(this.animationTime)) * (sprinting ? 0.1 : 0.065) : Math.sin(this.idleTime * 2.0) * 0.018;
    const breathing = moving ? 0 : Math.sin(this.idleTime * 1.6) * 0.02;

    this.group.position.y = bounce;
    this.body.rotation.x = moving ? Math.sin(this.animationTime) * 0.035 * speedRatio : breathing;
    this.body.rotation.z = moving ? Math.sin(this.animationTime * 0.5) * 0.045 * speedRatio : Math.sin(this.idleTime * 1.2) * 0.012;
    this.head.rotation.x = moving ? -0.05 * speedRatio + Math.sin(this.animationTime * 2) * 0.025 : Math.sin(this.idleTime * 1.35) * 0.025;
    this.head.rotation.z = moving ? Math.sin(this.animationTime) * 0.035 * speedRatio : Math.sin(this.idleTime * 0.9) * 0.02;

    this.limbs.leftArm.rotation.x = counterStride;
    this.limbs.rightArm.rotation.x = stride;
    this.limbs.leftLeg.rotation.x = stride;
    this.limbs.rightLeg.rotation.x = counterStride;

    this.limbs.leftArm.rotation.z = 0.13;
    this.limbs.rightArm.rotation.z = -0.13;
    this.limbs.leftLeg.rotation.z = moving ? -0.025 : 0;
    this.limbs.rightLeg.rotation.z = moving ? 0.025 : 0;

    this.cape.rotation.x = 0.28 + speedRatio * 0.26 + Math.sin(this.animationTime * 1.4) * 0.045;
    this.backpack.rotation.x = Math.sin(this.animationTime * 2) * 0.035 * speedRatio;
    this.hairTuft.rotation.x = -0.18 + Math.sin(this.animationTime * 1.7) * 0.045;
  }

  /** 创建身体、披风、腰带和背包。 */
  private createBody(): THREE.Group {
    const tunic = new THREE.MeshStandardMaterial({ color: 0x8fb5df, roughness: 0.76 });
    const belt = new THREE.MeshStandardMaterial({ color: 0x7d4b24, roughness: 0.82 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xf2c55f, roughness: 0.48, metalness: 0.1 });
    const capeMaterial = new THREE.MeshStandardMaterial({ color: 0xc8593d, roughness: 0.84, side: THREE.DoubleSide });
    const packMaterial = new THREE.MeshStandardMaterial({ color: 0xb9783a, roughness: 0.84 });

    this.body.name = 'explorer-body';
    this.body.position.y = 0.86;

    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 12), tunic);
    torso.scale.set(0.92, 1.1, 0.72);

    const beltMesh = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.09, 0.48), belt);
    beltMesh.position.y = -0.12;

    const amulet = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), gold);
    amulet.position.set(0, 0.18, -0.29);
    amulet.rotation.z = Math.PI / 4;

    this.cape.name = 'short-cape';
    this.cape.position.set(0, 0.18, 0.31);
    const capeMesh = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.68, 4, 1, true), capeMaterial);
    capeMesh.scale.set(0.9, 1, 0.34);
    capeMesh.rotation.x = Math.PI;
    capeMesh.position.y = -0.28;
    this.cape.add(capeMesh);

    this.backpack.name = 'tiny-backpack';
    this.backpack.position.set(0, 0.02, 0.38);
    const backpackMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.4, 0.16), packMaterial);
    backpackMesh.geometry.translate(0, 0, 0.07);
    this.backpack.add(backpackMesh);

    this.body.add(torso, beltMesh, amulet, this.cape, this.backpack);
    return this.body;
  }

  /** 创建大头、五官、发型和沙漠护目镜。 */
  private createHead(): THREE.Group {
    const skin = new THREE.MeshStandardMaterial({ color: 0xffd47a, roughness: 0.62 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x7a3f20, roughness: 0.78 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x2f241a, roughness: 0.45 });
    const scarf = new THREE.MeshStandardMaterial({ color: 0xd85a42, roughness: 0.78 });
    const goggles = new THREE.MeshStandardMaterial({ color: 0xf3cf72, roughness: 0.35, metalness: 0.12 });

    this.head.name = 'explorer-head';
    this.head.position.y = 1.44;

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), skin);
    headMesh.scale.set(1.0, 1.05, 0.94);

    const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), eye);
    leftEye.scale.set(1, 1.25, 0.42);
    leftEye.position.set(-0.13, 0.04, -0.37);

    const rightEye = leftEye.clone();
    rightEye.position.x = 0.13;

    const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.035, 8, 32), scarf);
    scarfRing.position.y = -0.39;
    scarfRing.rotation.x = Math.PI / 2;
    scarfRing.scale.z = 0.72;

    const goggleBand = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.018, 8, 32), goggles);
    goggleBand.position.set(0, 0.18, -0.04);
    goggleBand.rotation.x = Math.PI / 2;
    goggleBand.scale.z = 0.62;

    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.43, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.46), hair);
    hairCap.scale.set(1.02, 0.52, 0.95);
    hairCap.position.y = 0.18;
    hairCap.rotation.x = -0.08;

    this.hairTuft.name = 'signature-hair-tuft';
    this.hairTuft.position.set(0.03, 0.43, -0.12);
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 6), hair);
    tuft.position.y = 0.12;
    tuft.rotation.set(-0.65, 0.15, -0.18);
    this.hairTuft.add(tuft);

    this.head.add(headMesh, leftEye, rightEye, scarfRing, goggleBand, hairCap, this.hairTuft);
    return this.head;
  }

  /** 创建四肢和靴子，分组枢轴用于自然摆动。 */
  private createLimbs(): LimbSet {
    const sleeve = new THREE.MeshStandardMaterial({ color: 0xf2e3c2, roughness: 0.8 });
    const glove = new THREE.MeshStandardMaterial({ color: 0xb56b39, roughness: 0.82 });
    const pants = new THREE.MeshStandardMaterial({ color: 0xead0a1, roughness: 0.82 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x8c3f2a, roughness: 0.86 });

    const leftArm = this.createArm(-0.34, sleeve, glove);
    const rightArm = this.createArm(0.34, sleeve, glove);
    const leftLeg = this.createLeg(-0.17, pants, boot);
    const rightLeg = this.createLeg(0.17, pants, boot);

    return { leftArm, rightArm, leftLeg, rightLeg };
  }

  /** 创建单条手臂，正面朝向为 -Z。 */
  private createArm(x: number, sleeve: THREE.Material, glove: THREE.Material): THREE.Group {
    const arm = new THREE.Group();
    arm.name = x < 0 ? 'left-arm' : 'right-arm';
    arm.position.set(x, 1.02, -0.02);

    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.34, 4, 8), sleeve);
    upper.position.y = -0.22;
    upper.rotation.z = x < 0 ? -0.18 : 0.18;

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), glove);
    hand.position.set(x < 0 ? -0.04 : 0.04, -0.43, -0.02);

    arm.add(upper, hand);
    return arm;
  }

  /** 创建单条腿和小靴子，腿部枢轴位于髋部。 */
  private createLeg(x: number, pants: THREE.Material, boot: THREE.Material): THREE.Group {
    const leg = new THREE.Group();
    leg.name = x < 0 ? 'left-leg' : 'right-leg';
    leg.position.set(x, 0.54, 0);

    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 4, 8), pants);
    thigh.position.y = -0.22;

    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 8), boot);
    foot.scale.set(1.15, 0.55, 1.55);
    foot.position.set(0, -0.44, -0.06);

    leg.add(thigh, foot);
    return leg;
  }
}
