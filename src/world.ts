import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Repo } from './github';
import type { BuiltTown, BuildingHandle } from './town';
import { clamp } from './theme';

export interface HoverInfo {
  repo: Repo;
  clientX: number;
  clientY: number;
}

export class TownWorld {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly startedAt = performance.now();
  private lastFrame = performance.now();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly hoverRing: THREE.Mesh;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;

  private town: BuiltTown | null = null;
  private hovered: BuildingHandle | null = null;
  private intro: { from: THREE.Vector3; to: THREE.Vector3; started: number } | null = null;
  private lastInteraction = performance.now();
  private pointerDown: { x: number; y: number } | null = null;
  private hoveredClient = { clientX: 0, clientY: 0 };
  private resizeObserver: ResizeObserver;

  onHover: ((info: HoverInfo | null) => void) | null = null;
  onSelect: ((repo: Repo) => void) | null = null;

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.renderer.domElement.className = 'webgl';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x1b1530, 0.0017);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 4000);
    this.camera.position.set(120, 100, 150);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = 22;
    this.controls.maxDistance = 620;
    this.controls.minPolarAngle = 0.16;
    this.controls.maxPolarAngle = 1.46;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.24;
    this.controls.target.set(0, 2, 0);

    // ------------------------------------------------------------------- sky --
    const skyGeometry = new THREE.SphereGeometry(1800, 40, 24);
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color('#1a1440') },
        horizonColor: { value: new THREE.Color('#6a3352') },
        bottomColor: { value: new THREE.Color('#0d0a1a') },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          vec3 color = mix(horizonColor, topColor, smoothstep(0.0, 0.62, h));
          color = mix(bottomColor, color, smoothstep(-0.2, 0.02, h));
          float band = exp(-pow((h - 0.015) * 11.0, 2.0));
          color += vec3(0.4, 0.15, 0.07) * band * 0.7;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    sky.frustumCulled = false;
    this.scene.add(sky);

    const starCount = 2600;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const radius = 1250 + Math.random() * 450;
      const azimuth = Math.random() * Math.PI * 2;
      const elevation = Math.random() * Math.PI - Math.PI / 2;
      starPositions[i * 3] = Math.cos(azimuth) * Math.cos(elevation) * radius;
      starPositions[i * 3 + 1] = Math.sin(elevation) * radius;
      starPositions[i * 3 + 2] = Math.sin(azimuth) * Math.cos(elevation) * radius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({
      color: 0xc9d4ff,
      size: 2.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    this.scene.add(new THREE.Points(starGeometry, starMaterial));

    const brightPositions = new Float32Array(110 * 3);
    for (let i = 0; i < 110; i += 1) {
      const radius = 1250 + Math.random() * 450;
      const azimuth = Math.random() * Math.PI * 2;
      const elevation = Math.random() * Math.PI - Math.PI / 2;
      brightPositions[i * 3] = Math.cos(azimuth) * Math.cos(elevation) * radius;
      brightPositions[i * 3 + 1] = Math.sin(elevation) * radius;
      brightPositions[i * 3 + 2] = Math.sin(azimuth) * Math.cos(elevation) * radius;
    }
    const brightGeometry = new THREE.BufferGeometry();
    brightGeometry.setAttribute('position', new THREE.BufferAttribute(brightPositions, 3));
    const brightMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 3.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    this.scene.add(new THREE.Points(brightGeometry, brightMaterial));

    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(33, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff0d6, fog: false, toneMapped: false }),
    );
    moon.position.set(-1240, -300, -760);
    this.scene.add(moon);

    const moonGlowTexture = (() => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255,240,214,0.9)');
        gradient.addColorStop(0.35, 'rgba(255,214,170,0.32)');
        gradient.addColorStop(1, 'rgba(255,214,170,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    })();
    const moonGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: moonGlowTexture,
        color: 0xffd6aa,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      }),
    );
    moonGlow.scale.setScalar(360);
    moonGlow.position.copy(moon.position);
    this.scene.add(moonGlow);

    const nebulae = [
      { position: new THREE.Vector3(-1050, -360, -820), color: 0x7f5cff, scale: 900, opacity: 0.09 },
      { position: new THREE.Vector3(580, -420, -1120), color: 0x2f8f9c, scale: 720, opacity: 0.07 },
      { position: new THREE.Vector3(-60, -520, -1280), color: 0xb06a9a, scale: 1050, opacity: 0.055 },
    ];
    for (const nebula of nebulae) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: moonGlowTexture,
          color: nebula.color,
          transparent: true,
          opacity: nebula.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
          fog: false,
        }),
      );
      sprite.scale.setScalar(nebula.scale);
      sprite.position.copy(nebula.position);
      this.scene.add(sprite);
    }

    // ---------------------------------------------------------------- lights --
    const hemisphere = new THREE.HemisphereLight(0x9db3ff, 0x35283c, 0.95);
    this.scene.add(hemisphere);

    this.keyLight = new THREE.DirectionalLight(0xffc69a, 3.1);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.03;
    this.keyLight.shadow.camera.near = 1;
    this.keyLight.shadow.camera.far = 800;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    const rimLight = new THREE.DirectionalLight(0x6f8aff, 0.75);
    rimLight.position.set(140, 90, -160);
    this.scene.add(rimLight);

    this.fillLight = new THREE.DirectionalLight(0xa9c0ff, 0.85);
    this.fillLight.position.set(120, 80, 170);
    this.scene.add(this.fillLight);
    this.scene.add(this.fillLight.target);

    const ambient = new THREE.AmbientLight(0x3c3456, 0.72);
    this.scene.add(ambient);

    // ------------------------------------------------------------- hover ring --
    this.hoverRing = new THREE.Mesh(
      new THREE.RingGeometry(0.88, 1.08, 56),
      new THREE.MeshBasicMaterial({
        color: 0xffd7a1,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.visible = false;
    this.hoverRing.renderOrder = 4;
    this.scene.add(this.hoverRing);

    // ----------------------------------------------------------------- post --
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.44, 0.55, 0.9);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointerup', this.handlePointerUp);
    this.renderer.domElement.addEventListener('pointerleave', this.handlePointerLeave);
    this.renderer.domElement.addEventListener('wheel', this.handleInteraction, { passive: true });
    this.controls.addEventListener('start', this.handleInteraction);
    this.renderer.domElement.style.cursor = 'grab';

    requestAnimationFrame(this.animate);
  }

  setTown(town: BuiltTown): void {
    this.clearTown();
    this.town = town;
    this.scene.add(town.group);

    const { target, radius } = town.view;
    const aspect = this.camera.aspect;
    const distance =
      Math.max(town.layout.island.w, town.layout.island.d) *
      (aspect < 0.7 ? 1.78 : aspect < 0.9 ? 1.58 : aspect < 1.3 ? 1.18 : 1.06);
    const direction = new THREE.Vector3(0.62, 0.72, 1).normalize();
    const end = target.clone().add(direction.clone().multiplyScalar(distance));
    end.y = Math.max(end.y, 28);
    const from = target.clone().add(direction.clone().multiplyScalar(distance * 1.3));
    from.y += 32;

    this.controls.target.copy(target);
    this.controls.target.y = 2.5;
    this.controls.minDistance = Math.max(18, radius * 0.32);
    this.controls.maxDistance = Math.max(160, radius * 3.4);
    this.camera.position.copy(from);
    this.controls.update();
    this.intro = { from, to: end, started: performance.now() };
    this.lastInteraction = performance.now();

    const shadowRadius = Math.max(town.layout.island.w, town.layout.island.d) * 1.05;
    this.keyLight.position.copy(target).add(new THREE.Vector3(-90, 160, 100));
    this.keyLight.target.position.copy(target);
    this.keyLight.target.updateMatrixWorld();
    this.fillLight.position.copy(target).add(new THREE.Vector3(150, 95, 190));
    this.fillLight.target.position.copy(target);
    this.fillLight.target.updateMatrixWorld();
    this.keyLight.shadow.camera.left = -shadowRadius;
    this.keyLight.shadow.camera.right = shadowRadius;
    this.keyLight.shadow.camera.top = shadowRadius;
    this.keyLight.shadow.camera.bottom = -shadowRadius;
    this.keyLight.shadow.camera.updateProjectionMatrix();

    this.scene.fog = new THREE.FogExp2(0x1b1530, 0.55 / (distance * 2.3));
    this.clearHover();
  }

  private clearTown(): void {
    if (!this.town) return;
    this.scene.remove(this.town.group);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.town.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      const materialList = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : [];
      for (const material of materialList) {
        materials.add(material);
        for (const key of ['map', 'emissiveMap', 'alphaMap'] as const) {
          const texture = (material as unknown as Record<string, unknown>)[key];
          if (texture instanceof THREE.Texture) textures.add(texture);
        }
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    this.town = null;
    this.hovered = null;
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  private handleInteraction = (): void => {
    this.lastInteraction = performance.now();
    this.intro = null;
  };

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
    this.lastInteraction = performance.now();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (event.target !== this.renderer.domElement) {
      this.clearHover();
      return;
    }
    this.hoveredClient = { clientX: event.clientX, clientY: event.clientY };
    if (!this.town) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      this.clearHover();
      return;
    }
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.town.pickables, false);
    const hit = hits[0];
    const handle = hit?.object.userData.buildingHandle as BuildingHandle | undefined;
    if (handle) {
      if (handle !== this.hovered) {
        this.hovered = handle;
        this.onHover?.({ repo: handle.repo, ...this.hoveredClient });
      } else {
        this.onHover?.({ repo: handle.repo, ...this.hoveredClient });
      }
      this.renderer.domElement.style.cursor = 'pointer';
    } else {
      this.clearHover();
    }
  };

  private handlePointerLeave = (): void => {
    this.clearHover();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    if (this.hovered) this.onSelect?.(this.hovered.repo);
  };

  private clearHover(): void {
    if (this.hovered) {
      this.hovered = null;
      this.onHover?.(null);
    }
    this.hoverRing.visible = false;
    this.renderer.domElement.style.cursor = 'grab';
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const now = performance.now();
    const delta = Math.min((now - this.lastFrame) / 1000, 0.05);
    const elapsed = (now - this.startedAt) / 1000;
    this.lastFrame = now;

    if (this.intro) {
      const t = clamp((now - this.intro.started) / 2100, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this.intro.from, this.intro.to, eased);
      if (t >= 1) this.intro = null;
    }

    const idle = now - this.lastInteraction > 11000;
    this.controls.autoRotate = !this.intro && idle && !this.hovered;
    this.controls.update();

    if (this.town) {
      this.town.tick(elapsed);

      for (const building of this.town.buildings) {
        const lift = building === this.hovered ? 0.55 : 0;
        const targetY = building.baseY + lift;
        building.group.position.y +=
          (targetY - building.group.position.y) * Math.min(1, delta * 11);
      }

      if (this.hovered) {
        const handle = this.hovered;
        this.hoverRing.visible = true;
        this.hoverRing.position.set(
          handle.group.position.x,
          Math.max(0.42, handle.baseY + 0.32),
          handle.group.position.z,
        );
        const scale =
          Math.max(1.1, handle.footprint * 0.82) *
          (1 + Math.sin(elapsed * 3.4) * 0.045);
        this.hoverRing.scale.setScalar(scale);
      }
    }

    this.composer.render();
  }
}
