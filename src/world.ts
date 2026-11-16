import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { OrgSummary, Repo } from './github';
import { STREET_Y, WORLD_SCALE, type BuiltTown, type BuildingHandle, type Obstacle } from './town';
import { clamp } from './theme';

export interface HoverInfo {
  repo: Repo;
  clientX: number;
  clientY: number;
}

export interface OrgHoverInfo {
  org: OrgSummary;
  clientX: number;
  clientY: number;
}

interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const WALK_SPEED = 6.5;
const RUN_SPEED = 17;
const PLAYER_RADIUS = 0.45;
const JUMP_SPEED = 5.4;
const GRAVITY = 17;
const LOOK_SENSITIVITY = 0.0021;
const DRAG_SENSITIVITY = 0.0042;
const PICK_DISTANCE = 320;
/** Org islands float far off beside the town, so they can be aimed at from further away. */
const ORG_PICK_DISTANCE = 2500;
/** Longest distance moved per collision sub-step, so fast runs cannot tunnel through poles. */
const MAX_STEP = 0.15;

function isTyping(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
}

/**
 * Renders the town and lets the viewer walk through it in first person:
 * click to capture the mouse, WASD / arrow keys to walk, Shift to run, Space
 * to jump. On touch screens, drag to look and use the on-screen stick to walk.
 */
export class TownWorld {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly startedAt = performance.now();
  private lastFrame = performance.now();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly hoverRing: THREE.Mesh;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly joystickEl: HTMLElement | null;
  private readonly joystickKnob: HTMLElement | null;

  private town: BuiltTown | null = null;
  private hovered: BuildingHandle | null = null;
  private hoveredOrg: OrgSummary | null = null;
  private pickTargets: THREE.Object3D[] = [];
  private hoveredClient = { clientX: 0, clientY: 0 };
  private resizeObserver: ResizeObserver;

  private yaw = 0;
  private pitch = 0;
  private readonly velocity = new THREE.Vector3();
  private jumpOffset = 0;
  private verticalSpeed = 0;
  private eyeY = STREET_Y + 1.7;
  private readonly keys = new Set<string>();
  private colliders: Collider[] = [];
  private obstacles: Obstacle[] = [];
  private walkBounds: BuiltTown['walkBounds'] | null = null;
  private locked = false;
  private drag: { id: number; x: number; y: number; moved: boolean; type: string } | null = null;
  private stick: { id: number; x: number; y: number } | null = null;
  private readonly stickVector = new THREE.Vector2();

  onHover: ((info: HoverInfo | null) => void) | null = null;
  onSelect: ((repo: Repo) => void) | null = null;
  onHoverOrg: ((info: OrgHoverInfo | null) => void) | null = null;
  onSelectOrg: ((org: OrgSummary) => void) | null = null;

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
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x1b1530, 0.002);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 4000);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, 300, 400);

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
    // High enough to be seen from street level.
    moon.position.set(-1240, 320, -760);
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
      { position: new THREE.Vector3(-1050, 360, -820), color: 0x7f5cff, scale: 900, opacity: 0.09 },
      { position: new THREE.Vector3(580, 300, -1120), color: 0x2f8f9c, scale: 720, opacity: 0.07 },
      { position: new THREE.Vector3(-60, 520, -1280), color: 0xb06a9a, scale: 1050, opacity: 0.055 },
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

    const canvas = this.renderer.domElement;
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('pointerlockchange', this.handleLockChange);
    canvas.style.cursor = 'crosshair';

    this.joystickEl = document.getElementById('joystick');
    this.joystickKnob = this.joystickEl?.querySelector<HTMLElement>('.joystick-knob') ?? null;
    this.joystickEl?.addEventListener('pointerdown', this.handleStickDown);

    requestAnimationFrame(this.animate);
  }

  setTown(town: BuiltTown): void {
    this.clearTown();
    this.town = town;
    this.scene.add(town.group);

    town.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.colliders = town.pickables.map((mesh) => {
      box.setFromObject(mesh);
      return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
    });
    this.obstacles = town.obstacles;
    this.walkBounds = town.walkBounds;
    this.pickTargets = [...town.pickables, ...town.orgPickables];

    const { target } = town.view;
    const islandSpan = Math.max(town.layout.island.w, town.layout.island.d) * WORLD_SCALE;

    // Start on foot at street level, facing into town.
    this.eyeY = town.spawn.position.y;
    this.yaw = town.spawn.yaw;
    this.pitch = 0.06;
    this.jumpOffset = 0;
    this.verticalSpeed = 0;
    this.velocity.set(0, 0, 0);
    this.camera.position.copy(town.spawn.position);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    const shadowRadius = islandSpan * 0.6;
    const keyOffset = new THREE.Vector3(-90, 160, 100).multiplyScalar(WORLD_SCALE);
    this.keyLight.position.copy(target).add(keyOffset);
    this.keyLight.target.position.copy(target);
    this.keyLight.target.updateMatrixWorld();
    this.fillLight.position.copy(target).add(new THREE.Vector3(150, 95, 190).multiplyScalar(WORLD_SCALE));
    this.fillLight.target.position.copy(target);
    this.fillLight.target.updateMatrixWorld();
    this.keyLight.shadow.camera.left = -shadowRadius;
    this.keyLight.shadow.camera.right = shadowRadius;
    this.keyLight.shadow.camera.top = shadowRadius;
    this.keyLight.shadow.camera.bottom = -shadowRadius;
    this.keyLight.shadow.camera.far = keyOffset.length() + shadowRadius * 2;
    this.keyLight.shadow.camera.updateProjectionMatrix();

    this.scene.fog = new THREE.FogExp2(0x1b1530, clamp(1.05 / islandSpan, 0.0011, 0.004));
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
    this.hoveredOrg = null;
    this.pickTargets = [];
    this.colliders = [];
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  // ------------------------------------------------------------------ input --

  private requestLock(): void {
    const canvas = this.renderer.domElement;
    if (!('requestPointerLock' in canvas)) return;
    try {
      const result = canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // Pointer lock can be refused (iframes, permissions). Drag-to-look still works.
    }
  }

  private handleLockChange = (): void => {
    this.locked = document.pointerLockElement === this.renderer.domElement;
    document.body.classList.toggle('fp-locked', this.locked);
    if (!this.locked) this.keys.clear();
    this.clearHover();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (isTyping() || event.metaKey || event.ctrlKey || event.altKey) return;
    const movementKeys = [
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Space', 'ShiftLeft', 'ShiftRight',
    ];
    if (!movementKeys.includes(event.code)) return;
    if (!this.town) return;
    event.preventDefault();
    this.keys.add(event.code);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private look(dx: number, dy: number, sensitivity: number): void {
    this.yaw -= dx * sensitivity;
    this.pitch = clamp(this.pitch - dy * sensitivity, -1.45, 1.45);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.target !== this.renderer.domElement) return;
    if (this.locked) return;
    if (this.drag) return;
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      type: event.pointerType,
    };
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.locked) {
      this.look(event.movementX, event.movementY, LOOK_SENSITIVITY);
      return;
    }

    if (this.stick && event.pointerId === this.stick.id) {
      this.updateStick(event.clientX, event.clientY);
      return;
    }

    if (this.drag && event.pointerId === this.drag.id) {
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) > 6) this.drag.moved = true;
      if (this.drag.moved) {
        this.look(dx, dy, DRAG_SENSITIVITY);
        this.drag.x = event.clientX;
        this.drag.y = event.clientY;
        this.clearHover();
      }
      return;
    }

    if (event.target !== this.renderer.domElement) {
      this.clearHover();
      return;
    }
    if (event.pointerType === 'mouse') this.pickAt(event.clientX, event.clientY);
  };

  private handlePointerLeave = (): void => {
    if (!this.locked) this.clearHover();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.stick && event.pointerId === this.stick.id) {
      this.releaseStick();
      return;
    }

    if (this.locked) {
      if (event.button === 0) this.selectHovered();
      return;
    }

    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    this.drag = null;
    if (drag.moved || event.target !== this.renderer.domElement) return;

    if (drag.type === 'mouse') {
      // A plain click on the scene captures the mouse for walking.
      this.requestLock();
      return;
    }
    // Touch: a tap opens whatever building is under the finger.
    this.pickAt(event.clientX, event.clientY);
    this.selectHovered();
  };

  private handleStickDown = (event: PointerEvent): void => {
    if (!this.joystickEl) return;
    event.preventDefault();
    const rect = this.joystickEl.getBoundingClientRect();
    this.stick = {
      id: event.pointerId,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    this.joystickEl.setPointerCapture?.(event.pointerId);
    this.updateStick(event.clientX, event.clientY);
  };

  private updateStick(clientX: number, clientY: number): void {
    if (!this.stick || !this.joystickEl) return;
    const radius = this.joystickEl.clientWidth / 2;
    let dx = (clientX - this.stick.x) / radius;
    let dy = (clientY - this.stick.y) / radius;
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    this.stickVector.set(dx, dy);
    if (this.joystickKnob) {
      this.joystickKnob.style.transform = `translate(${dx * radius * 0.55}px, ${dy * radius * 0.55}px)`;
    }
  }

  private releaseStick(): void {
    this.stick = null;
    this.stickVector.set(0, 0);
    if (this.joystickKnob) this.joystickKnob.style.transform = '';
  }

  // ---------------------------------------------------------------- picking --

  private pickAt(clientX: number, clientY: number): void {
    if (!this.town) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      this.clearHover();
      return;
    }
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.pick(clientX, clientY);
  }

  /** Raycast along `this.pointer` (NDC) and report the building it hits. */
  private selectHovered(): void {
    if (this.hovered) this.onSelect?.(this.hovered.repo);
    else if (this.hoveredOrg) this.onSelectOrg?.(this.hoveredOrg);
  }

  /** Raycast along `this.pointer` (NDC) and report the building or org island it hits. */
  private pick(clientX: number, clientY: number): void {
    if (!this.town) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.far = ORG_PICK_DISTANCE;
    const hit = this.raycaster.intersectObjects(this.pickTargets, false)[0];
    const org = hit?.object.userData.org as OrgSummary | undefined;
    const handle =
      hit && hit.distance <= PICK_DISTANCE
        ? (hit.object.userData.buildingHandle as BuildingHandle | undefined)
        : undefined;

    if (org) {
      // While aiming with the crosshair the tooltip does not move; skip redundant updates.
      if (org === this.hoveredOrg && this.locked) return;
      this.clearBuildingHover();
      this.hoveredOrg = org;
      this.hoveredClient = { clientX, clientY };
      this.onHoverOrg?.({ org, ...this.hoveredClient });
      if (!this.locked) this.renderer.domElement.style.cursor = 'pointer';
    } else if (handle) {
      if (handle === this.hovered && this.locked) return;
      this.clearOrgHover();
      this.hovered = handle;
      this.hoveredClient = { clientX, clientY };
      this.onHover?.({ repo: handle.repo, ...this.hoveredClient });
      if (!this.locked) this.renderer.domElement.style.cursor = 'pointer';
    } else {
      this.clearHover();
    }
  }

  private clearBuildingHover(): void {
    if (this.hovered) {
      this.hovered = null;
      this.onHover?.(null);
    }
    this.hoverRing.visible = false;
  }

  private clearOrgHover(): void {
    if (this.hoveredOrg) {
      this.hoveredOrg = null;
      this.onHoverOrg?.(null);
    }
  }

  private clearHover(): void {
    this.clearBuildingHover();
    this.clearOrgHover();
    this.renderer.domElement.style.cursor = 'crosshair';
  }

  // --------------------------------------------------------------- movement --

  /**
   * Push a circle of PLAYER_RADIUS out of every building box, pole, trunk and
   * car it overlaps, then keep it on the island. Pushing along the contact
   * normal (closest point on the box) lets the walker slide around corners.
   */
  private resolve(point: { x: number; z: number }, moving: Obstacle[]): void {
    const r = PLAYER_RADIUS;
    for (let pass = 0; pass < 3; pass += 1) {
      let pushed = false;
      for (const box of this.colliders) {
        if (
          point.x <= box.minX - r ||
          point.x >= box.maxX + r ||
          point.z <= box.minZ - r ||
          point.z >= box.maxZ + r
        ) {
          continue;
        }
        const closestX = clamp(point.x, box.minX, box.maxX);
        const closestZ = clamp(point.z, box.minZ, box.maxZ);
        const dx = point.x - closestX;
        const dz = point.z - closestZ;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq >= r * r) continue;
        pushed = true;
        if (distanceSq > 1e-10) {
          const distance = Math.sqrt(distanceSq);
          point.x += (dx / distance) * (r - distance);
          point.z += (dz / distance) * (r - distance);
        } else {
          // Centre is inside the box: leave by the nearest face.
          const exits = [
            { d: point.x - box.minX, x: box.minX - r, z: point.z },
            { d: box.maxX - point.x, x: box.maxX + r, z: point.z },
            { d: point.z - box.minZ, x: point.x, z: box.minZ - r },
            { d: box.maxZ - point.z, x: point.x, z: box.maxZ + r },
          ].sort((a, b) => a.d - b.d);
          point.x = exits[0]!.x;
          point.z = exits[0]!.z;
        }
      }
      for (const list of [this.obstacles, moving]) {
        for (const obstacle of list) {
          const minDistance = r + obstacle.r;
          const dx = point.x - obstacle.x;
          const dz = point.z - obstacle.z;
          if (Math.abs(dx) >= minDistance || Math.abs(dz) >= minDistance) continue;
          const distanceSq = dx * dx + dz * dz;
          if (distanceSq >= minDistance * minDistance) continue;
          pushed = true;
          const distance = Math.sqrt(distanceSq) || 1e-5;
          const nx = distanceSq > 1e-10 ? dx / distance : 1;
          const nz = distanceSq > 1e-10 ? dz / distance : 0;
          point.x = obstacle.x + nx * minDistance;
          point.z = obstacle.z + nz * minDistance;
        }
      }
      if (!pushed) break;
    }
    this.keepOnIsland(point);
  }

  private keepOnIsland(point: { x: number; z: number }): void {
    const bounds = this.walkBounds;
    if (!bounds) return;
    const halfW = bounds.w / 2;
    const halfD = bounds.d / 2;
    point.x = clamp(point.x, bounds.x - halfW, bounds.x + halfW);
    point.z = clamp(point.z, bounds.z - halfD, bounds.z + halfD);
    // Rounded corners, matching the island outline.
    const corner = Math.min(bounds.cornerRadius, halfW, halfD);
    const offsetX = point.x - bounds.x;
    const offsetZ = point.z - bounds.z;
    const qx = Math.abs(offsetX) - (halfW - corner);
    const qz = Math.abs(offsetZ) - (halfD - corner);
    if (qx > 0 && qz > 0) {
      const distance = Math.hypot(qx, qz);
      if (distance > corner) {
        const scale = corner / distance;
        point.x = bounds.x + Math.sign(offsetX) * (halfW - corner + qx * scale);
        point.z = bounds.z + Math.sign(offsetZ) * (halfD - corner + qz * scale);
      }
    }
  }

  private walk(delta: number): void {
    const forwardInput =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) -
      this.stickVector.y;
    const strafeInput =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) +
      this.stickVector.x;
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const stickPush = Math.hypot(this.stickVector.x, this.stickVector.y);
    const speed = running || stickPush > 0.92 ? RUN_SPEED : WALK_SPEED;

    const wish = new THREE.Vector3(
      -Math.sin(this.yaw) * forwardInput + Math.cos(this.yaw) * strafeInput,
      0,
      -Math.cos(this.yaw) * forwardInput - Math.sin(this.yaw) * strafeInput,
    );
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(speed);
    this.velocity.lerp(wish, 1 - Math.exp(-delta * 9));

    const position = this.camera.position;
    const moving = this.town?.movingObstacles() ?? [];
    const next = { x: position.x, z: position.z };
    const travelX = this.velocity.x * delta;
    const travelZ = this.velocity.z * delta;
    const steps = Math.max(1, Math.ceil(Math.hypot(travelX, travelZ) / MAX_STEP));
    // Always resolve at least once, so a passing car shoves a standing walker aside.
    for (let step = 0; step < steps; step += 1) {
      next.x += travelX / steps;
      next.z += travelZ / steps;
      this.resolve(next, moving);
    }
    // Kill velocity into walls so the walker slides instead of sticking.
    if (delta > 0) {
      this.velocity.x = (next.x - position.x) / delta;
      this.velocity.z = (next.z - position.z) / delta;
    }

    if (this.keys.has('Space') && this.jumpOffset <= 0) {
      this.verticalSpeed = JUMP_SPEED;
    }
    if (this.jumpOffset > 0 || this.verticalSpeed > 0) {
      this.verticalSpeed -= GRAVITY * delta;
      this.jumpOffset = Math.max(0, this.jumpOffset + this.verticalSpeed * delta);
      if (this.jumpOffset === 0) this.verticalSpeed = 0;
    }

    const bob = Math.hypot(this.velocity.x, this.velocity.z) > 0.5 && this.jumpOffset === 0
      ? Math.sin(performance.now() / 1000 * (running ? 13 : 9)) * (running ? 0.05 : 0.03)
      : 0;
    position.set(next.x, this.eyeY + this.jumpOffset + bob, next.z);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const now = performance.now();
    const delta = Math.min((now - this.lastFrame) / 1000, 0.05);
    const elapsed = (now - this.startedAt) / 1000;
    this.lastFrame = now;

    if (this.town) {
      this.walk(delta);
      if (this.locked) {
        // Aim with the crosshair in the middle of the screen.
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.set(0, 0);
        this.pick(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
    }

    if (this.town) {
      this.town.tick(elapsed);

      if (this.hovered) {
        const handle = this.hovered;
        const position = handle.group.getWorldPosition(new THREE.Vector3());
        this.hoverRing.visible = true;
        this.hoverRing.position.set(position.x, STREET_Y + 0.12, position.z);
        const scale =
          Math.max(0.5, handle.footprint * 0.82) *
          WORLD_SCALE *
          (1 + Math.sin(elapsed * 3.4) * 0.045);
        this.hoverRing.scale.setScalar(scale);
      }
    }

    this.composer.render();
  };
}
