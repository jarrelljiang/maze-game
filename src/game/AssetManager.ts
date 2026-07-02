import * as THREE from 'three';

const TEXTURE_PATHS = {
  wallDiffuse: '/assets/textures/wall_sandstone_diffuse.png',
  wallRoughness: '/assets/textures/wall_sandstone_roughness.png',
  floorDiffuse: '/assets/textures/floor_sand_diffuse.png',
  portalGold: '/assets/textures/portal_gold.png',
};

export class AssetManager {
  private readonly loader = new THREE.TextureLoader();

  private readonly textures = new Map<string, THREE.Texture>();

  /** 预加载核心贴图，失败时保留程序化兜底。 */
  async load(): Promise<void> {
    await Promise.all(
      Object.entries(TEXTURE_PATHS).map(async ([key, path]) => {
        try {
          const texture = await this.loader.loadAsync(path);
          this.prepareTexture(texture);
          this.textures.set(key, texture);
        } catch {
          this.textures.set(key, this.createFallbackTexture(key));
        }
      }),
    );
  }

  /** 创建砂岩墙体材质。 */
  createWallMaterial(): THREE.MeshStandardMaterial {
    const diffuse = this.getTexture('wallDiffuse');
    const roughness = this.getTexture('wallRoughness');
    diffuse.repeat.set(1.4, 1.4);
    roughness.repeat.set(1.4, 1.4);
    return new THREE.MeshStandardMaterial({
      map: diffuse,
      roughnessMap: roughness,
      roughness: 0.9,
      metalness: 0,
      color: 0xf2c464,
    });
  }

  /** 创建沙地材质，并按地图尺寸调整平铺。 */
  createFloorMaterial(mapSize: number): THREE.MeshStandardMaterial {
    const diffuse = this.getTexture('floorDiffuse');
    diffuse.repeat.set(mapSize / 2.3, mapSize / 2.3);
    return new THREE.MeshStandardMaterial({
      map: diffuse,
      roughness: 0.96,
      metalness: 0,
      color: 0xf8d68b,
    });
  }

  /** 创建出口传送门材质。 */
  createPortalMaterial(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      map: this.getTexture('portalGold'),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xffd56c,
    });
  }

  /** 从缓存读取贴图，没有文件时即时生成兜底贴图。 */
  getTexture(key: keyof typeof TEXTURE_PATHS | string): THREE.Texture {
    if (!this.textures.has(key)) {
      this.textures.set(key, this.createFallbackTexture(key));
    }
    return this.textures.get(key)!;
  }

  /** 统一设置贴图色彩空间和平铺模式。 */
  private prepareTexture(texture: THREE.Texture): void {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  }

  /** 用 Canvas 生成兜底纹理，保证资源缺失时仍可游玩。 */
  private createFallbackTexture(key: string): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(canvas.width, canvas.height);

    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        const n = this.noise(x, y);
        if (key.includes('roughness')) {
          const v = 165 + Math.floor(n * 70);
          image.data.set([v, v, v, 255], offset);
        } else if (key.includes('floor')) {
          image.data.set([224 + n * 25, 184 + n * 20, 104 + n * 15, 255], offset);
        } else {
          image.data.set([196 + n * 40, 142 + n * 32, 58 + n * 20, 255], offset);
        }
      }
    }

    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    this.prepareTexture(texture);
    return texture;
  }

  /** 快速哈希噪声，用于本地程序化材质。 */
  private noise(x: number, y: number): number {
    const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }
}
