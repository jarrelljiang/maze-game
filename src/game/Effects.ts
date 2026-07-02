import * as THREE from 'three';
import type { AssetManager } from './AssetManager';
import type { Maze } from './Maze';
import { CELL_SIZE } from './constants';

export class Effects {
  public readonly group = new THREE.Group();

  private portal = new THREE.Group();

  private portalLight?: THREE.PointLight;

  private particles?: THREE.Points;

  private burstTime = 0;

  private readonly particlePositions = new Float32Array(120 * 3);

  /** 创建出口、沙尘粒子和天空辅助效果。 */
  constructor(private readonly assets: AssetManager) {
    this.group.name = 'effects-root';
  }

  /** 根据当前迷宫重建终点传送门和环境粒子。 */
  rebuildForMaze(maze: Maze): void {
    this.group.clear();
    this.portal = this.createPortal(maze);
    this.particles = this.createSandParticles(maze);
    this.group.add(this.portal);
    this.group.add(this.particles);
  }

  /** 每帧更新传送门呼吸、粒子漂浮和胜利爆发。 */
  update(delta: number, elapsed: number): void {
    this.portal.rotation.y = Math.sin(elapsed * 0.55) * 0.08;
    this.portal.position.y = 0.08 + Math.sin(elapsed * 1.4) * 0.045;

    if (this.portalLight) {
      const burst = Math.max(0, 1 - this.burstTime);
      this.portalLight.intensity = 2.2 + Math.sin(elapsed * 2.4) * 0.35 + burst * 5;
    }

    if (this.particles) {
      const positions = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i += 1) {
        const y = positions.getY(i) + delta * (0.1 + (i % 7) * 0.013);
        positions.setY(i, y > 2.2 ? 0.04 : y);
      }
      positions.needsUpdate = true;
    }

    if (this.burstTime > 0) {
      this.burstTime = Math.max(0, this.burstTime - delta);
    }
  }

  /** 触发胜利时的金色光效增强。 */
  playVictoryBurst(): void {
    this.burstTime = 1;
    this.portal.scale.setScalar(1.25);
    window.setTimeout(() => this.portal.scale.setScalar(1), 520);
  }

  /** 创建暖色天空穹顶。 */
  createSkyDome(): THREE.Mesh {
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
    const sky = new THREE.Mesh(geometry, material);
    sky.name = 'warm-sky-dome';
    return sky;
  }

  /** 创建终点符文门、光柱和点光源。 */
  private createPortal(maze: Maze): THREE.Group {
    const end = maze.getEndWorld();
    const group = new THREE.Group();
    group.name = 'gold-portal';
    group.position.set(end.x, 0.08, end.z);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 12, 64), new THREE.MeshStandardMaterial({
      color: 0xffc857,
      emissive: 0xffa726,
      emissiveIntensity: 1.4,
      roughness: 0.35,
      metalness: 0.15,
    }));
    ring.position.y = 1.55;
    ring.rotation.x = Math.PI / 2;

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), this.assets.createPortalMaterial());
    plane.position.y = 1.55;
    plane.rotation.y = Math.PI;

    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.05, 3.5, 32, 1, true), new THREE.MeshBasicMaterial({
      color: 0xffd97a,
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    column.position.y = 1.75;

    this.portalLight = new THREE.PointLight(0xffca62, 2.4, CELL_SIZE * 5, 1.4);
    this.portalLight.position.set(0, 1.7, 0);
    group.add(column, ring, plane, this.portalLight);
    return group;
  }

  /** 创建少量沙尘粒子，增强沙漠空气感。 */
  private createSandParticles(maze: Maze): THREE.Points {
    const extent = maze.data.width * CELL_SIZE * 0.45;
    for (let i = 0; i < this.particlePositions.length; i += 3) {
      this.particlePositions[i] = (Math.random() * 2 - 1) * extent;
      this.particlePositions[i + 1] = Math.random() * 1.6 + 0.1;
      this.particlePositions[i + 2] = (Math.random() * 2 - 1) * extent;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffd991,
      size: 0.035,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const particles = new THREE.Points(geometry, material);
    particles.name = 'sand-dust';
    return particles;
  }
}
