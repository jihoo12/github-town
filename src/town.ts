import * as THREE from 'three';
import type { OrgSummary, Repo, TownData } from './github';
import {
  clamp,
  formatCompact,
  hashString,
  languageColor,
  mulberry32,
} from './theme';
import {
  createFogTexture,
  createGlowTexture,
  createGroundTexture,
  createLabelTexture,
  createSignTexture,
  createWindowTextures,
} from './textures';

/**
 * The town is modelled in "design units" and the whole group is scaled up by
 * WORLD_SCALE, so 1 world unit = 1 metre for the first-person walker: cars are
 * ~4.5 m long, street lamps ~10 m tall and the tallest towers approach 100 m.
 */
export const WORLD_SCALE = 3;
/** Eye height of the walker, in world metres above the street. */
export const EYE_HEIGHT = 1.7;
export const STREET_Y = 0.18 * WORLD_SCALE;

const ACTIVE_CELL = 10.6;
const ACTIVE_MARGIN = 6;
const RUINS_MARGIN = 4;
const CEMETERY_CELL = 1.6;
const CEMETERY_GAP = 5;
const ISLAND_MARGIN = 16;
const GROUND_Y = 0.18;
const GHOST_GROUND_Y = 0.14;

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface GridSection extends Rect {
  cols: number;
  rows: number;
  cell: number;
}

export interface PlacedRepo {
  repo: Repo;
  x: number;
  z: number;
  kind: 'building' | 'tombstone';
}

export interface TownLayout {
  placed: PlacedRepo[];
  active: GridSection | null;
  /** Union of the ruins and the cemetery: where the ghost atmosphere lives. */
  ghost: Rect | null;
  ruins: GridSection | null;
  cemetery: GridSection | null;
  /** Paved street grid: the living town plus the ruins that continue it. */
  streets: Rect | null;
  island: Rect;
  counts: {
    active: number;
    stale: number;
    archived: number;
    ghost: number;
  };
}

export interface BuildingHandle {
  group: THREE.Group;
  repo: Repo;
  baseY: number;
  footprint: number;
  kind: 'building' | 'tombstone';
}

export interface BuiltTown {
  group: THREE.Group;
  /** Building and tombstone meshes: aimable, and solid for the walker. */
  pickables: THREE.Mesh[];
  /** Meshes of the floating organization islands (userData.org). Not solid. */
  orgPickables: THREE.Mesh[];
  buildings: BuildingHandle[];
  layout: TownLayout;
  tick: (elapsed: number) => void;
  /** Everything below is in world (scaled) units. */
  view: {
    target: THREE.Vector3;
    radius: number;
  };
  spawn: {
    position: THREE.Vector3;
    yaw: number;
  };
  /** Walkable area: the island top, inset from its edge, with rounded corners. */
  walkBounds: Rect & { cornerRadius: number };
  /** Static round obstacles (poles, trunks, sign posts) in world units. */
  obstacles: Obstacle[];
  /** Moving obstacles (cars) at the current tick, in world units. */
  movingObstacles: () => Obstacle[];
}

export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

function byStars(a: Repo, b: Repo): number {
  return b.stars - a.stars || Date.parse(b.pushedAt) - Date.parse(a.pushedAt);
}

function byRecentPush(a: Repo, b: Repo): number {
  return Date.parse(b.pushedAt) - Date.parse(a.pushedAt) || b.stars - a.stars;
}

function makeGridSection(
  count: number,
  cell: number,
  margin: number,
  ratio: number,
): { cols: number; rows: number; w: number; d: number; cell: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count) * ratio)));
  const rows = Math.max(1, Math.ceil(count / cols));
  return {
    cols,
    rows,
    w: cols * cell + margin * 2,
    d: rows * cell + margin * 2,
    cell,
  };
}

function gridPositions(cols: number, rows: number, cell: number): { x: number; z: number }[] {
  const positions: { x: number; z: number; dist: number; angle: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = (col - (cols - 1) / 2) * cell;
      const z = (row - (rows - 1) / 2) * cell;
      const angle = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
      positions.push({ x, z, dist: Math.hypot(x, z), angle });
    }
  }
  return positions
    .sort((a, b) => a.dist - b.dist || a.angle - b.angle)
    .map(({ x, z }) => ({ x, z }));
}

function unionRect(rects: (Rect | null)[]): Rect | null {
  const list = rects.filter((rect): rect is Rect => Boolean(rect));
  if (!list.length) return null;
  const minX = Math.min(...list.map((rect) => rect.x - rect.w / 2));
  const maxX = Math.max(...list.map((rect) => rect.x + rect.w / 2));
  const minZ = Math.min(...list.map((rect) => rect.z - rect.d / 2));
  const maxZ = Math.max(...list.map((rect) => rect.z + rect.d / 2));
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ };
}

export function computeLayout(repos: Repo[]): TownLayout {
  const activeRepos = repos.filter((repo) => !repo.isGhost).sort(byStars);
  const ghostRepos = repos.filter((repo) => repo.isGhost);
  // Most recently abandoned first, so decay deepens the further you walk west.
  const staleRepos = ghostRepos.filter((repo) => repo.ghostReason === 'stale').sort(byRecentPush);
  const archivedRepos = ghostRepos.filter((repo) => repo.ghostReason === 'archived').sort(byStars);

  const placed: PlacedRepo[] = [];

  let active: GridSection | null = null;
  if (activeRepos.length) {
    active = { ...makeGridSection(activeRepos.length, ACTIVE_CELL, ACTIVE_MARGIN, 1.45), x: 0, z: 0 };
    const positions = gridPositions(active.cols, active.rows, active.cell);
    activeRepos.forEach((repo, index) => {
      const position = positions[index];
      if (position) placed.push({ repo, x: position.x, z: position.z, kind: 'building' });
    });
  }

  // The ruins are not a separate town: they continue the living street grid
  // to the west on the same blocks, so the cross streets run straight through.
  let ruins: GridSection | null = null;
  if (staleRepos.length) {
    if (active) {
      let rows = Math.max(active.rows, Math.ceil(Math.sqrt(staleRepos.length / 1.3)));
      if ((rows - active.rows) % 2 !== 0) rows += 1;
      const cols = Math.ceil(staleRepos.length / rows);
      const w = cols * ACTIVE_CELL + RUINS_MARGIN * 2;
      ruins = {
        cols,
        rows,
        cell: ACTIVE_CELL,
        w,
        d: rows * ACTIVE_CELL + RUINS_MARGIN * 2,
        x: active.x - active.w / 2 - w / 2,
        z: active.z,
      };
      const rowOrder = Array.from({ length: rows }, (_, row) => row).sort(
        (a, b) => Math.abs(a - (rows - 1) / 2) - Math.abs(b - (rows - 1) / 2) || a - b,
      );
      let index = 0;
      for (let col = 0; col < cols; col += 1) {
        const x = ruins.x + (cols / 2 - col - 0.5) * ACTIVE_CELL;
        for (const row of rowOrder) {
          const repo = staleRepos[index];
          index += 1;
          if (!repo) break;
          placed.push({ repo, x, z: ruins.z + (row - (rows - 1) / 2) * ACTIVE_CELL, kind: 'building' });
        }
      }
    } else {
      ruins = { ...makeGridSection(staleRepos.length, ACTIVE_CELL, RUINS_MARGIN, 1.45), x: 0, z: 0 };
      const positions = gridPositions(ruins.cols, ruins.rows, ruins.cell);
      staleRepos.forEach((repo, index) => {
        const position = positions[index];
        if (position) placed.push({ repo, x: position.x, z: position.z, kind: 'building' });
      });
    }
  }

  let cemetery: GridSection | null = null;
  if (archivedRepos.length) {
    const grid = makeGridSection(archivedRepos.length, CEMETERY_CELL, 3, 1.1);
    const westEdge = unionRect([active, ruins]);
    const x = westEdge ? westEdge.x - westEdge.w / 2 - CEMETERY_GAP - grid.w / 2 : 0;
    cemetery = { ...grid, x, z: 0 };
    const positions = gridPositions(grid.cols, grid.rows, grid.cell);
    archivedRepos.forEach((repo, index) => {
      const position = positions[index];
      if (position) placed.push({ repo, x: x + position.x, z: position.z, kind: 'tombstone' });
    });
  }

  const ghost = unionRect([ruins, cemetery]);
  const streets = unionRect([active, ruins]);
  const bounds = unionRect([active, ruins, cemetery]) ?? { x: 0, z: 0, w: 20, d: 20 };
  const island: Rect = {
    x: bounds.x,
    z: bounds.z,
    w: bounds.w + ISLAND_MARGIN * 2,
    d: bounds.d + ISLAND_MARGIN * 2,
  };

  return {
    placed,
    active,
    ghost,
    ruins,
    cemetery,
    streets,
    island,
    counts: {
      active: activeRepos.length,
      stale: staleRepos.length,
      archived: archivedRepos.length,
      ghost: ghostRepos.length,
    },
  };
}

function tintBuildingColor(repo: Repo, ghost: boolean): THREE.Color {
  const color = new THREE.Color(languageColor(repo.language));
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  if (ghost) {
    color.setHSL(hsl.h, Math.min(hsl.s, 0.12), 0.14 + Math.min(hsl.l, 0.6) * 0.04);
  } else {
    color.setHSL(
      hsl.h,
      clamp(hsl.s, 0.3, 0.62),
      clamp(hsl.l, 0.44, 0.6),
    );
  }
  return color;
}

function facadeGeometry(
  width: number,
  height: number,
  depth: number,
  offsetU: number,
  offsetV: number,
): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  // One texture tile holds 4x5 windows; size it so a floor is ~3.5 m tall.
  const tileW = 4.8;
  const tileH = 5.9;
  const faceSizes = [
    { u: depth, v: height },
    { u: depth, v: height },
    { u: width, v: depth },
    { u: width, v: depth },
    { u: width, v: height },
    { u: width, v: height },
  ];
  for (let face = 0; face < 6; face += 1) {
    const size = faceSizes[face];
    if (!size) continue;
    const repeatU = Math.max(1, Math.round(size.u / tileW));
    const repeatV = Math.max(1, Math.round(size.v / tileH));
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const index = face * 4 + vertex;
      uv.setXY(
        index,
        offsetU + uv.getX(index) * repeatU,
        offsetV + uv.getY(index) * repeatV,
      );
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

function roundedRectShape(width: number, depth: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -depth / 2;
  const r = Math.min(radius, width / 2, depth / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + depth - r);
  shape.quadraticCurveTo(x + width, y + depth, x + width - r, y + depth);
  shape.lineTo(x + r, y + depth);
  shape.quadraticCurveTo(x, y + depth, x, y + depth - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  shape.closePath();
  return shape;
}

function pointInRect(x: number, z: number, rect: Rect, expand = 0): boolean {
  return (
    x > rect.x - rect.w / 2 - expand &&
    x < rect.x + rect.w / 2 + expand &&
    z > rect.z - rect.d / 2 - expand &&
    z < rect.z + rect.d / 2 + expand
  );
}

function makeRoundedPath(width: number, depth: number, radius: number): THREE.CatmullRomCurve3 {
  const hw = width / 2;
  const hd = depth / 2;
  const r = Math.min(radius, hw * 0.8, hd * 0.8);
  const points = [
    new THREE.Vector3(hw - r, 0, hd),
    new THREE.Vector3(-hw + r, 0, hd),
    new THREE.Vector3(-hw, 0, hd - r),
    new THREE.Vector3(-hw, 0, -hd + r),
    new THREE.Vector3(-hw + r, 0, -hd),
    new THREE.Vector3(hw - r, 0, -hd),
    new THREE.Vector3(hw, 0, -hd + r),
    new THREE.Vector3(hw, 0, hd - r),
  ];
  return new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.15);
}

export function buildTown(
  layout: TownLayout,
  data: TownData,
  maxAnisotropy: number,
): BuiltTown {
  const group = new THREE.Group();
  group.name = 'github-town';

  const anisotropy = Math.min(8, maxAnisotropy);
  const windowTextures = createWindowTextures(anisotropy);
  const glowTexture = createGlowTexture(anisotropy);
  const fogTexture = createFogTexture(anisotropy);
  const grassTexture = createGroundTexture('grass', anisotropy);
  const asphaltTexture = createGroundTexture('asphalt', anisotropy);
  const dirtTexture = createGroundTexture('dirt', anisotropy);

  const pickables: THREE.Mesh[] = [];
  const buildings: BuildingHandle[] = [];
  const tips: { mesh: THREE.Mesh; phase: number }[] = [];
  const wisps: {
    sprite: THREE.Sprite;
    baseX: number;
    baseY: number;
    baseZ: number;
    phase: number;
    speed: number;
    amp: number;
    opacity: number;
  }[] = [];
  const ghostLights: { light: THREE.PointLight; base: number; phase: number }[] = [];
  const floaters: { object: THREE.Object3D; baseY: number; phase: number; amp: number; spin: number }[] = [];
  const cars: {
    object: THREE.Group;
    phase: number;
    speed: number;
    curve: THREE.CatmullRomCurve3;
  }[] = [];
  const pulses: {
    material: THREE.Material & { opacity: number };
    baseOpacity: number;
    phase: number;
    rate: number;
  }[] = [];

  const sideMaterials = new Map<string, THREE.MeshStandardMaterial>();
  const ghostMaterials = new Map<string, THREE.MeshStandardMaterial>();
  const pyramidMaterials = new Map<string, THREE.MeshStandardMaterial>();
  const accentMaterials = new Map<string, THREE.MeshBasicMaterial>();

  const flatRoofMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2b34,
    roughness: 0.92,
    metalness: 0.05,
  });
  const doorMaterial = new THREE.MeshStandardMaterial({
    color: 0x12131a,
    emissive: 0xffb56b,
    emissiveIntensity: 0.9,
    roughness: 0.7,
  });
  const woodMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a2c25,
    roughness: 1,
  });
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: 0x6a6674,
    roughness: 0.96,
    emissive: 0x39463f,
    emissiveIntensity: 0.1,
  });
  const darkStoneMaterial = new THREE.MeshStandardMaterial({
    color: 0x39343f,
    roughness: 1,
  });

  function getSideMaterial(color: THREE.Color, ghost: boolean): THREE.MeshStandardMaterial {
    const key = color.getHexString();
    const cache = ghost ? ghostMaterials : sideMaterials;
    const cached = cache.get(key);
    if (cached) return cached;
    const material = new THREE.MeshStandardMaterial({
      color: color.clone(),
      map: windowTextures.facade,
      emissiveMap: ghost ? windowTextures.ghostGlow : windowTextures.glow,
      emissive: ghost ? 0x59d99f : 0xffcf97,
      emissiveIntensity: ghost ? 0.42 : 1.18,
      roughness: ghost ? 1 : 0.78,
      metalness: ghost ? 0 : 0.08,
    });
    cache.set(key, material);
    return material;
  }

  function getPyramidMaterial(color: THREE.Color): THREE.MeshStandardMaterial {
    const key = color.getHexString();
    const cached = pyramidMaterials.get(key);
    if (cached) return cached;
    const roofColor = color.clone().multiplyScalar(0.6);
    const material = new THREE.MeshStandardMaterial({
      color: roofColor,
      roughness: 0.88,
      flatShading: true,
    });
    pyramidMaterials.set(key, material);
    return material;
  }

  function getAccentMaterial(color: string): THREE.MeshBasicMaterial {
    const cached = accentMaterials.get(color);
    if (cached) return cached;
    const material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    accentMaterials.set(color, material);
    return material;
  }

  function addBuilding(repo: Repo, x: number, z: number): void {
    const rng = mulberry32(repo.id ^ hashString(repo.name));
    const ghost = repo.isGhost;

    const starHeight = Math.log2(repo.stars + 2) * 2.3;
    const sizeBoost = clamp(Math.sqrt(repo.size) / 15, 0, 2.1);
    let height = 3.6 + starHeight + sizeBoost * 0.6 + rng() * 2.2;
    height = Math.min(height, ghost ? 15 : 32);
    if (ghost) height *= 0.72;
    height = Math.max(2.6, height);

    const base = 2.6 + sizeBoost;
    const width = clamp(base * (0.86 + rng() * 0.4), 2.5, 6);
    const depth = clamp(base * (0.86 + rng() * 0.4), 2.5, 6);

    const color = tintBuildingColor(repo, ghost);
    const sideMaterial = getSideMaterial(color, ghost);
    const building = new THREE.Group();
    building.position.set(x, ghost ? GHOST_GROUND_Y : GROUND_Y, z);
    if (ghost) {
      building.rotation.z = (rng() - 0.5) * 0.1;
      building.rotation.x = (rng() - 0.5) * 0.055;
    }

    const handle: BuildingHandle = {
      group: building,
      repo,
      baseY: building.position.y,
      footprint: Math.max(width, depth),
      kind: 'building',
    };

    const materialArray = [
      sideMaterial,
      sideMaterial,
      flatRoofMaterial,
      flatRoofMaterial,
      sideMaterial,
      sideMaterial,
    ];

    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(width + 1.3, 0.14, depth + 1.3),
      getSidewalkMaterial(),
    );
    pad.position.y = -0.06;
    pad.receiveShadow = true;
    building.add(pad);

    const addTier = (
      tierWidth: number,
      tierDepth: number,
      tierHeight: number,
      bottom: number,
    ): void => {
      const geometry = facadeGeometry(
        tierWidth,
        tierHeight,
        tierDepth,
        rng() * 3,
        rng() * 3,
      );
      const mesh = new THREE.Mesh(geometry, materialArray);
      mesh.position.y = bottom + tierHeight / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.buildingHandle = handle;
      building.add(mesh);
      pickables.push(mesh);
    };

    let topHeight = height;

    if (!ghost && height > 15.5) {
      const lowerHeight = height * 0.68;
      const upperHeight = height - lowerHeight;
      addTier(width, depth, lowerHeight, 0);
      addTier(width * 0.68, depth * 0.68, upperHeight, lowerHeight);
      const lowerParapet = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.28, 0.28, depth + 0.28),
        flatRoofMaterial,
      );
      lowerParapet.position.y = lowerHeight;
      lowerParapet.castShadow = true;
      building.add(lowerParapet);
    } else {
      addTier(width, depth, height, 0);
    }

    if (!ghost && height > 15.5) {
      topHeight = height;
    }

    if (ghost) {
      // A leaning beam against the ruin makes the damage legible at a glance.
      if (rng() > 0.55) {
        const beam = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, height * 0.55, 0.16),
          woodMaterial,
        );
        beam.position.set(width / 2 + 0.15, height * 0.22, (rng() - 0.5) * depth * 0.5);
        beam.rotation.z = 0.45 + rng() * 0.2;
        building.add(beam);
      }
    } else {
      if (height < 9.5 && rng() > 0.35) {
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(1, 1, 4),
          getPyramidMaterial(color),
        );
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(width * 0.82, 2 + rng() * 0.9, depth * 0.82);
        roof.position.y = height + roof.scale.y / 2;
        roof.castShadow = true;
        building.add(roof);
        topHeight = height + roof.scale.y;
      } else {
        const parapet = new THREE.Mesh(
          new THREE.BoxGeometry(width + 0.28, 0.32, depth + 0.28),
          flatRoofMaterial,
        );
        parapet.position.y = height + 0.16;
        parapet.castShadow = true;
        building.add(parapet);

        if (rng() > 0.45) {
          const unit = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.28, 0.9, depth * 0.28),
            flatRoofMaterial,
          );
          unit.position.set(
            (rng() - 0.5) * width * 0.4,
            height + 0.75,
            (rng() - 0.5) * depth * 0.4,
          );
          unit.castShadow = true;
          building.add(unit);
        }
      }

      const door = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(width * 0.34, 1.5), 1.35, 0.2),
        doorMaterial,
      );
      door.position.set(0, 0.68, depth / 2 + 0.11);
      building.add(door);

      const accent = getAccentMaterial(languageColor(repo.language));
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(width * 0.46, 2.1), 0.1, 0.42),
        accent,
      );
      awning.position.set(0, 1.55, depth / 2 + 0.22);
      building.add(awning);

      if ((height > 14 || repo.stars > 2000) && rng() > 0.25) {
        const mastHeight = 2.2 + rng() * 2.2;
        const mast = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.08, mastHeight, 5),
          darkStoneMaterial,
        );
        mast.position.y = topHeight + mastHeight / 2;
        building.add(mast);

        const tip = new THREE.Mesh(
          new THREE.SphereGeometry(0.19, 8, 8),
          getAccentMaterial('#ffd9a0'),
        );
        tip.position.y = topHeight + mastHeight;
        building.add(tip);
        tips.push({ mesh: tip, phase: rng() * Math.PI * 2 });
      }
    }

    group.add(building);
    buildings.push(handle);
  }

  function addTombstone(repo: Repo, x: number, z: number): void {
    const rng = mulberry32(repo.id ^ 0x7f4a7c15);
    const monument = new THREE.Group();
    monument.position.set(x, 0.11, z);
    monument.rotation.y = (rng() - 0.5) * 0.35;
    // ~1.6 m tall once the world is scaled: a headstone you walk between.
    monument.scale.setScalar(0.3);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.35, 0.18, 0.55),
      darkStoneMaterial,
    );
    base.position.y = 0.09;
    base.receiveShadow = true;
    monument.add(base);

    const shape = new THREE.Shape();
    shape.moveTo(-0.5, 0);
    shape.lineTo(0.5, 0);
    shape.lineTo(0.5, 1.05);
    shape.quadraticCurveTo(0.5, 1.62, 0, 1.62);
    shape.quadraticCurveTo(-0.5, 1.62, -0.5, 1.05);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.22,
      bevelEnabled: true,
      bevelSize: 0.04,
      bevelThickness: 0.04,
      bevelSegments: 1,
      curveSegments: 6,
    });
    geometry.translate(0, 0, -0.11);

    const stone = new THREE.Mesh(geometry, stoneMaterial);
    stone.position.y = 0.16;
    stone.castShadow = true;
    stone.receiveShadow = true;
    monument.add(stone);

    if (rng() > 0.55) {
      const crossV = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.52, 0.02),
        darkStoneMaterial,
      );
      crossV.position.set(0, 0.94, 0.12);
      monument.add(crossV);
      const crossH = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.06, 0.02),
        darkStoneMaterial,
      );
      crossH.position.set(0, 1.02, 0.12);
      monument.add(crossH);
    }

    const handle: BuildingHandle = {
      group: monument,
      repo,
      baseY: monument.position.y,
      footprint: 0.4,
      kind: 'tombstone',
    };
    stone.userData.buildingHandle = handle;
    pickables.push(stone);

    if (rng() > 0.8) {
      monument.rotation.z = 0.22;
    }

    group.add(monument);
    buildings.push(handle);
  }

  // ---------------------------------------------------------------- island --
  const islandGeometry = new THREE.ExtrudeGeometry(
    roundedRectShape(layout.island.w, layout.island.d, 22),
    {
      depth: 8,
      bevelEnabled: true,
      bevelThickness: 1.4,
      bevelSize: 2,
      bevelSegments: 2,
      curveSegments: 14,
    },
  );
  islandGeometry.rotateX(-Math.PI / 2);
  islandGeometry.computeBoundingBox();
  const islandTop = islandGeometry.boundingBox?.max.y ?? 0;
  islandGeometry.translate(0, -islandTop, 0);
  grassTexture.repeat.set(0.075, 0.075);
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: grassTexture,
    roughness: 1,
  });
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0x3b3347,
    roughness: 1,
    flatShading: true,
    emissive: 0x1c1630,
    emissiveIntensity: 0.5,
  });
  const island = new THREE.Mesh(islandGeometry, [grassMaterial, rockMaterial]);
  island.position.set(layout.island.x, 0, layout.island.z);
  island.receiveShadow = true;
  group.add(island);

  // Hanging rocks underneath the floating island.
  const rockGeometry = new THREE.IcosahedronGeometry(1, 0);
  const underRockCount = 9;
  for (let i = 0; i < underRockCount; i += 1) {
    const rock = new THREE.Mesh(rockGeometry, rockMaterial);
    const scale = 3 + Math.random() * 8;
    rock.scale.set(scale * (0.7 + Math.random() * 0.6), scale, scale * (0.7 + Math.random() * 0.6));
    rock.position.set(
      layout.island.x + (Math.random() - 0.5) * layout.island.w * 0.65,
      -10 - Math.random() * 15,
      layout.island.z + (Math.random() - 0.5) * layout.island.d * 0.65,
    );
    rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    group.add(rock);
  }

  // Small rocks floating around the island.
  for (let i = 0; i < 6; i += 1) {
    const rock = new THREE.Mesh(rockGeometry, rockMaterial);
    const scale = 1.2 + Math.random() * 3;
    rock.scale.setScalar(scale);
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.max(layout.island.w, layout.island.d) * (0.55 + Math.random() * 0.3);
    rock.position.set(
      layout.island.x + Math.cos(angle) * distance,
      6 + Math.random() * 30,
      layout.island.z + Math.sin(angle) * distance,
    );
    rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    group.add(rock);
    floaters.push({
      object: rock,
      baseY: rock.position.y,
      phase: Math.random() * Math.PI * 2,
      amp: 0.8 + Math.random() * 1.8,
      spin: (Math.random() - 0.5) * 0.08,
    });
  }

  const S = WORLD_SCALE;
  /** Collected in design units; converted to world units on return. */
  const obstacles: Obstacle[] = [];
  const home = layout.active ?? layout.ruins ?? layout.cemetery ?? layout.island;
  const spawnX = home.x;
  const spawnZ = home.z + home.d / 2 + 11;
  /** Point lights do not inherit the group scale, so scale range and power here. */
  const pointLight = (color: THREE.ColorRepresentation, intensity: number, distance: number) =>
    new THREE.PointLight(color, intensity * S * S, distance * S, 2);
  const avenueX = layout.active && layout.ruins ? layout.active.x - layout.active.w / 2 : null;
  const inRuins = (x: number): boolean =>
    !layout.active || (avenueX !== null && x < avenueX);

  // ----------------------------------------------------------------- plates --
  if (layout.streets) {
    const streets = layout.streets;
    asphaltTexture.repeat.set(streets.w / 9, streets.d / 9);
    const plateMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: asphaltTexture,
      roughness: 0.98,
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(streets.w, streets.d), plateMaterial);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(streets.x, 0.045, streets.z);
    plate.receiveShadow = true;
    group.add(plate);

    const curbMaterial = new THREE.MeshStandardMaterial({ color: 0x636776, roughness: 1 });
    const curbHeight = 0.3;
    const curbs = [
      { w: streets.w + 0.5, d: 0.5, x: streets.x, z: streets.z - streets.d / 2 },
      { w: streets.w + 0.5, d: 0.5, x: streets.x, z: streets.z + streets.d / 2 },
      { w: 0.5, d: streets.d + 0.5, x: streets.x - streets.w / 2, z: streets.z },
      { w: 0.5, d: streets.d + 0.5, x: streets.x + streets.w / 2, z: streets.z },
    ];
    for (const curb of curbs) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(curb.w, curbHeight, curb.d),
        curbMaterial,
      );
      mesh.position.set(curb.x, curbHeight / 2, curb.z);
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    // Lane markings: crisp in the living town, worn away in the ruins.
    const dashGeometry = new THREE.PlaneGeometry(1, 1);
    dashGeometry.rotateX(-Math.PI / 2);
    const dummy = new THREE.Object3D();
    const dashRng = mulberry32(0x51ed);
    const liveDashes: THREE.Matrix4[] = [];
    const wornDashes: THREE.Matrix4[] = [];
    const pushDash = (x: number, z: number, alongX: boolean, target: THREE.Matrix4[]): void => {
      dummy.position.set(x, 0.07, z);
      dummy.rotation.set(0, alongX ? Math.PI / 2 : 0, 0);
      dummy.scale.set(0.13, 1, 1.05);
      dummy.updateMatrix();
      target.push(dummy.matrix.clone());
    };
    const addGridDashes = (section: GridSection, target: THREE.Matrix4[], skip: number): void => {
      const spanZ = section.rows * section.cell;
      const spanX = section.cols * section.cell;
      for (let col = 1; col < section.cols; col += 1) {
        const x = section.x + (col - section.cols / 2) * section.cell;
        for (let z = -spanZ / 2 + 1; z < spanZ / 2; z += 2.6) {
          if (dashRng() < skip) continue;
          pushDash(x, section.z + z, false, target);
        }
      }
      for (let row = 1; row < section.rows; row += 1) {
        const z = section.z + (row - section.rows / 2) * section.cell;
        for (let x = -spanX / 2 + 1; x < spanX / 2; x += 2.6) {
          if (dashRng() < skip) continue;
          pushDash(section.x + x, z, true, target);
        }
      }
    };
    if (layout.active) addGridDashes(layout.active, liveDashes, 0);
    if (layout.ruins) addGridDashes(layout.ruins, wornDashes, 0.45);
    if (avenueX !== null) {
      for (let z = -streets.d / 2 + 2; z < streets.d / 2 - 1; z += 2.6) {
        pushDash(avenueX, streets.z + z, false, dashRng() < 0.5 ? liveDashes : wornDashes);
      }
    }
    for (const [matrices, opacity] of [
      [liveDashes, 0.52],
      [wornDashes, 0.16],
    ] as const) {
      if (!matrices.length) continue;
      const dashMesh = new THREE.InstancedMesh(
        dashGeometry,
        new THREE.MeshBasicMaterial({
          color: 0xd3d6df,
          transparent: true,
          opacity,
          toneMapped: false,
        }),
        matrices.length,
      );
      matrices.forEach((matrix, index) => dashMesh.setMatrixAt(index, matrix));
      dashMesh.instanceMatrix.needsUpdate = true;
      group.add(dashMesh);
    }
  }

  if (layout.ghost) {
    // Dirt creeps over the asphalt and fades out toward the living town, so
    // there is no seam: the streets just get dustier the further west you go.
    const ghost = layout.ghost;
    const eastReach = layout.active ? 14 : 4;
    const dirtW = ghost.w + 4 + eastReach;
    const dirtD = ghost.d + 8;
    const dirtX = ghost.x - ghost.w / 2 - 4 + dirtW / 2;
    const alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = 256;
    alphaCanvas.height = 256;
    const alphaCtx = alphaCanvas.getContext('2d');
    if (alphaCtx) {
      const fadeStart = layout.active ? 1 - (eastReach + ghost.w * 0.35) / dirtW : 0.92;
      const across = alphaCtx.createLinearGradient(0, 0, 256, 0);
      across.addColorStop(0, '#000');
      across.addColorStop(0.06, '#fff');
      across.addColorStop(Math.max(0.07, fadeStart), '#fff');
      across.addColorStop(1, '#000');
      alphaCtx.fillStyle = across;
      alphaCtx.fillRect(0, 0, 256, 256);
      alphaCtx.globalCompositeOperation = 'multiply';
      const down = alphaCtx.createLinearGradient(0, 0, 0, 256);
      down.addColorStop(0, '#000');
      down.addColorStop(0.1, '#fff');
      down.addColorStop(0.9, '#fff');
      down.addColorStop(1, '#000');
      alphaCtx.fillStyle = down;
      alphaCtx.fillRect(0, 0, 256, 256);
    }
    const alphaMap = new THREE.CanvasTexture(alphaCanvas);
    dirtTexture.repeat.set(dirtW / 8, dirtD / 8);
    const dirtMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: dirtTexture,
      alphaMap,
      transparent: true,
      depthWrite: false,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const dirt = new THREE.Mesh(new THREE.PlaneGeometry(dirtW, dirtD), dirtMaterial);
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.set(dirtX, 0.06, ghost.z);
    dirt.receiveShadow = true;
    group.add(dirt);
  }

  // -------------------------------------------------------------- buildings --
  const sidewalks = new Map<string, THREE.MeshStandardMaterial>();
  function getSidewalkMaterial(): THREE.MeshStandardMaterial {
    const key = 'sidewalk';
    const cached = sidewalks.get(key);
    if (cached) return cached;
    const material = new THREE.MeshStandardMaterial({ color: 0x727684, roughness: 1 });
    sidewalks.set(key, material);
    return material;
  }

  for (const placed of layout.placed) {
    if (placed.kind === 'tombstone') {
      addTombstone(placed.repo, placed.x, placed.z);
      continue;
    }
    addBuilding(placed.repo, placed.x, placed.z);
  }

  // ----------------------------------------------------------------- street --
  const lampBulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffdfae, toneMapped: false });
  const deadBulbMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.5 });
  let lampLightBudget = 4;

  function addLamp(
    x: number,
    z: number,
    color: string,
    glowColor: string,
    withLight: boolean,
  ): void {
    // Street lights in the abandoned blocks stay switched off.
    const dead = inRuins(x);
    if (!clearOfCars(x, z)) return;
    const lamp = new THREE.Group();
    lamp.position.set(x, 0.18, z);
    obstacles.push({ x, z, r: 0.12 });
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.1, 3.3, 6),
      darkStoneMaterial,
    );
    pole.position.y = 1.65;
    lamp.add(pole);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 8, 8),
      dead ? deadBulbMaterial : lampBulbMaterial,
    );
    bulb.position.y = 3.35;
    lamp.add(bulb);
    if (dead) {
      lamp.rotation.z = (Math.random() - 0.5) * 0.12;
      group.add(lamp);
      return;
    }
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: glowColor,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.6,
      }),
    );
    glow.scale.setScalar(1.7);
    glow.position.y = 3.35;
    lamp.add(glow);
    group.add(lamp);

    if (withLight && lampLightBudget > 0) {
      lampLightBudget -= 1;
      const light = pointLight(new THREE.Color(color), 7, 20);
      light.position.set(x, 3.3, z);
      group.add(light);
    }
  }

  // The cars' loop around the living town. Built before the lamps so lamps can
  // stay out of the lane.
  const carCurve = layout.active
    ? makeRoundedPath(layout.active.w - 7, layout.active.d - 7, 7)
    : null;
  const carLane = carCurve ? carCurve.getSpacedPoints(600) : [];
  /** Car half-width (0.75) + pole radius + a little air. */
  const LANE_CLEARANCE = 1.2;
  const clearOfCars = (x: number, z: number): boolean => {
    if (!layout.active) return true;
    const localX = x - layout.active.x;
    const localZ = z - layout.active.z;
    return carLane.every((point) => Math.hypot(point.x - localX, point.z - localZ) > LANE_CLEARANCE);
  };

  if (layout.streets) {
    const streets = layout.streets;
    // Lamps stand on the curb side of the ring road; the cars' lane runs
    // ~2.5-4.3 units in from the edge.
    const inset = 1.3;
    const left = streets.x - streets.w / 2 + inset;
    const right = streets.x + streets.w / 2 - inset;
    const front = streets.z + streets.d / 2 - inset;
    const back = streets.z - streets.d / 2 + inset;
    let lampIndex = 0;
    for (let x = left + 4; x < right - 3; x += 12.5) {
      addLamp(x, front, '#ffcf97', '#ffb877', lampIndex % 4 === 0);
      addLamp(x, back, '#ffcf97', '#ffb877', lampIndex % 4 === 1);
      lampIndex += 1;
    }
    for (let z = back + 5; z < front - 4; z += 12.5) {
      addLamp(left, z, '#ffcf97', '#ffb877', lampIndex % 4 === 2);
      addLamp(right, z, '#ffcf97', '#ffb877', lampIndex % 4 === 3);
      lampIndex += 1;
    }
  }

  if (layout.active) {
    const active = layout.active;

    // A couple of cars circling the block.
    const carColors = [0xe8eaf2, 0xff6b6b, 0x6ee7ff];
    const curve = carCurve!;
    carColors.forEach((colorValue, index) => {
      const car = new THREE.Group();
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: colorValue,
        roughness: 0.38,
        metalness: 0.3,
      });
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 0.9), bodyMaterial);
      body.position.y = 0.36;
      body.castShadow = true;
      car.add(body);
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(0.82, 0.34, 0.78),
        new THREE.MeshStandardMaterial({
          color: 0x191b26,
          roughness: 0.25,
          metalness: 0.4,
        }),
      );
      cabin.position.set(0, 0.7, -0.04);
      car.add(cabin);
      const wheelGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.13, 8);
      wheelGeometry.rotateZ(Math.PI / 2);
      const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x121219, roughness: 0.9 });
      for (const offsetX of [-0.5, 0.5]) {
        for (const offsetZ of [-0.32, 0.32]) {
          const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
          wheel.position.set(offsetX, 0.02, offsetZ);
          car.add(wheel);
        }
      }
      const headlightMaterial = new THREE.MeshBasicMaterial({
        color: 0xfff2cc,
        toneMapped: false,
      });
      for (const offsetX of [-0.42, 0.42]) {
        const light = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 6, 6),
          headlightMaterial,
        );
        light.position.set(offsetX, 0.34, 0.46);
        car.add(light);
      }
      const tailMaterial = new THREE.MeshBasicMaterial({
        color: 0xff4d5e,
        toneMapped: false,
      });
      for (const offsetX of [-0.42, 0.42]) {
        const tail = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), tailMaterial);
        tail.position.set(offsetX, 0.34, -0.47);
        car.add(tail);
      }
      car.position.y = 0.16;
      group.add(car);
      cars.push({
        object: car,
        phase: index / carColors.length + Math.random() * 0.08,
        speed: 0.018 + index * 0.0035,
        curve,
      });
    });

    // Fireflies over the living town.
    const fireflyPositions = new Float32Array(36 * 3);
    for (let i = 0; i < 36; i += 1) {
      fireflyPositions[i * 3] = active.x + (Math.random() - 0.5) * active.w * 0.9;
      fireflyPositions[i * 3 + 1] = 1 + Math.random() * 9;
      fireflyPositions[i * 3 + 2] = active.z + (Math.random() - 0.5) * active.d * 0.9;
    }
    const fireflyGeometry = new THREE.BufferGeometry();
    fireflyGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(fireflyPositions, 3),
    );
    const fireflyMaterial = new THREE.PointsMaterial({
      color: 0xffd9a0,
      // Point size ignores the group scale, so give it in world units.
      size: 0.2 * S,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: glowTexture,
    });
    const fireflies = new THREE.Points(fireflyGeometry, fireflyMaterial);
    group.add(fireflies);
    pulses.push({ material: fireflyMaterial, baseOpacity: 0.5, phase: 0, rate: 0.5 });
  }

  // -------------------------------------------------------------- ghost town --
  if (layout.ghost) {
    const ghost = layout.ghost;

    // Ground mist and drifting spirits.
    const mistMaterial = new THREE.MeshBasicMaterial({
      map: fogTexture,
      color: 0x62ffbc,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 2; i += 1) {
      // Oversized and soft-edged, so the mist thins out into the living streets.
      const mist = new THREE.Mesh(
        new THREE.PlaneGeometry(ghost.w * 1.35, ghost.d * 1.35),
        mistMaterial,
      );
      mist.rotation.x = -Math.PI / 2;
      mist.rotation.z = i * 0.7;
      mist.position.set(ghost.x, 0.55 + i * 0.9, ghost.z);
      group.add(mist);
    }
    pulses.push({ material: mistMaterial, baseOpacity: 0.1, phase: 0, rate: 0.3 });

    for (let i = 0; i < 20; i += 1) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture,
          color: i % 3 === 0 ? 0xa9ffe0 : 0x62ffbc,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const baseX = ghost.x + (Math.random() - 0.5) * ghost.w * 0.9;
      const baseZ = ghost.z + (Math.random() - 0.5) * ghost.d * 0.9;
      const baseY = 1.2 + Math.random() * 5.5;
      sprite.position.set(baseX, baseY, baseZ);
      sprite.scale.setScalar(1.2 + Math.random() * 3.4);
      group.add(sprite);
      wisps.push({
        sprite,
        baseX,
        baseY,
        baseZ,
        phase: Math.random() * Math.PI * 2,
        speed: 0.35 + Math.random() * 0.45,
        amp: 0.35 + Math.random() * 0.9,
        opacity: 0.12 + Math.random() * 0.16,
      });
    }

    // A pair of sickly street lights.
    // Placed on street corners so they never end up inside a ruin.
    const lampArea = layout.ruins ?? ghost;
    const lampHalfW = layout.ruins ? (layout.ruins.cols * layout.ruins.cell) / 2 : ghost.w / 2 - 2;
    const lampHalfD = layout.ruins ? (layout.ruins.rows * layout.ruins.cell) / 2 : ghost.d / 2 - 2;
    const ghostLampSpots = [
      { x: lampArea.x + lampHalfW, z: lampArea.z + lampHalfD },
      { x: lampArea.x - lampHalfW, z: lampArea.z - lampHalfD },
    ];
    ghostLampSpots.forEach((spot, index) => {
      const lamp = new THREE.Group();
      lamp.position.set(spot.x, 0.16, spot.z);
      obstacles.push({ x: spot.x, z: spot.z, r: 0.13 });
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.11, 3.1, 5),
        darkStoneMaterial,
      );
      pole.position.y = 1.55;
      pole.rotation.z = 0.08 + index * 0.05;
      lamp.add(pole);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 7, 7),
        new THREE.MeshBasicMaterial({ color: 0x8dffc8, toneMapped: false }),
      );
      bulb.position.set(0.25, 3.0, 0);
      lamp.add(bulb);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture,
          color: 0x6fffc0,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      glow.scale.setScalar(2.4);
      glow.position.copy(bulb.position);
      lamp.add(glow);
      group.add(lamp);

      const light = pointLight(0x6fffc0, index === 0 ? 9 : 4, 24);
      light.position.set(spot.x + 0.25, 3.0, spot.z);
      group.add(light);
      ghostLights.push({ light, base: light.intensity, phase: index * 2.4 });
    });

    // Rubble scattered around the ruins.
    const rubbleGeometry = new THREE.DodecahedronGeometry(0.42, 0);
    const rubbleMaterial = new THREE.MeshStandardMaterial({
      color: 0x3c3742,
      roughness: 1,
      flatShading: true,
    });
    const rubbleCount = Math.min(90, 24 + layout.counts.stale * 2);
    const rubble = new THREE.InstancedMesh(rubbleGeometry, rubbleMaterial, rubbleCount);
    const rubbleDummy = new THREE.Object3D();
    for (let i = 0; i < rubbleCount; i += 1) {
      rubbleDummy.position.set(
        ghost.x + (Math.random() - 0.5) * ghost.w * 1.02,
        0.2,
        ghost.z + (Math.random() - 0.5) * ghost.d * 1.02,
      );
      rubbleDummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const scale = 0.4 + Math.random() * 1.15;
      rubbleDummy.scale.set(scale, scale * (0.5 + Math.random() * 0.6), scale);
      rubbleDummy.updateMatrix();
      rubble.setMatrixAt(i, rubbleDummy.matrix);
    }
    rubble.instanceMatrix.needsUpdate = true;
    rubble.castShadow = true;
    group.add(rubble);

    // Dead trees in and around the ghost town, kept out of the ruins themselves.
    const ruinSpots = layout.placed.filter((spot) => spot.repo.isGhost && spot.kind === 'building');
    let treeAttempts = 0;
    for (let i = 0; i < 9 && treeAttempts < 200; treeAttempts += 1) {
      const treeX = ghost.x + (Math.random() - 0.5) * ghost.w * 1.1;
      const treeZ = ghost.z + (Math.random() - 0.5) * ghost.d * 1.1;
      if (ruinSpots.some((spot) => Math.abs(spot.x - treeX) < 4.4 && Math.abs(spot.z - treeZ) < 4.4)) {
        continue;
      }
      i += 1;
      const tree = new THREE.Group();
      const height = 2 + Math.random() * 2.4;
      tree.position.set(treeX, 0.1, treeZ);
      obstacles.push({ x: treeX, z: treeZ, r: 0.22 });
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.22, height, 5),
        woodMaterial,
      );
      trunk.position.y = height / 2;
      trunk.rotation.z = (Math.random() - 0.5) * 0.18;
      tree.add(trunk);
      for (let branchIndex = 0; branchIndex < 3; branchIndex += 1) {
        const branch = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.07, 1.1 + Math.random() * 0.6, 4),
          woodMaterial,
        );
        branch.position.y = height * (0.55 + branchIndex * 0.12);
        branch.rotation.z = (branchIndex % 2 === 0 ? 1 : -1) * (0.65 + Math.random() * 0.4);
        branch.rotation.y = Math.random() * Math.PI;
        tree.add(branch);
      }
      group.add(tree);
    }
  }

  // ------------------------------------------------------------------ trees --
  const exclusionRects: Rect[] = [];
  if (layout.streets) exclusionRects.push(layout.streets);
  if (layout.cemetery) exclusionRects.push(layout.cemetery);

  const treePositions: { x: number; z: number; scale: number; tint: number }[] = [];
  const treeTarget = clamp(
    Math.round((layout.island.w * layout.island.d - 6000) / 210),
    16,
    150,
  );
  let attempts = 0;
  while (treePositions.length < treeTarget && attempts < treeTarget * 40) {
    attempts += 1;
    const x = layout.island.x + (Math.random() - 0.5) * (layout.island.w - 14);
    const z = layout.island.z + (Math.random() - 0.5) * (layout.island.d - 14);
    if (exclusionRects.some((rect) => pointInRect(x, z, rect, 3))) continue;
    if (treePositions.some((tree) => Math.hypot(tree.x - x, tree.z - z) < 3.2)) continue;
    // Keep the opening view clear.
    if (Math.hypot(x - spawnX, z - spawnZ) < 7) continue;
    const scale = 0.75 + Math.random() * 0.9;
    treePositions.push({ x, z, scale, tint: Math.random() });
    obstacles.push({ x, z, r: 0.21 * scale });
  }

  if (treePositions.length) {
    const trunkGeometry = new THREE.CylinderGeometry(0.13, 0.21, 1.5, 5);
    const foliageGeometry = new THREE.ConeGeometry(1, 2.2, 6);
    const topGeometry = new THREE.ConeGeometry(0.68, 1.5, 6);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x2b211d, roughness: 1 });
    const foliageMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      flatShading: true,
    });
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treePositions.length);
    const foliage = new THREE.InstancedMesh(
      foliageGeometry,
      foliageMaterial,
      treePositions.length,
    );
    const foliageTops = new THREE.InstancedMesh(
      topGeometry,
      foliageMaterial,
      treePositions.length,
    );
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const greens = ['#3e7f5f', '#4a8a63', '#356f56', '#4f8a64', '#5c8149'];
    treePositions.forEach((tree, index) => {
      dummy.position.set(tree.x, 0.18 + tree.scale * 0.75, tree.z);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.setScalar(tree.scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(index, dummy.matrix);

      dummy.position.set(tree.x, 0.18 + tree.scale * 2.15, tree.z);
      dummy.scale.set(tree.scale * (0.85 + tree.tint * 0.4), tree.scale, tree.scale * (0.85 + tree.tint * 0.4));
      dummy.updateMatrix();
      foliage.setMatrixAt(index, dummy.matrix);
      color.set(greens[Math.floor(tree.tint * greens.length)] ?? greens[0]!);
      foliage.setColorAt(index, color);

      dummy.position.set(tree.x, 0.18 + tree.scale * 3.1, tree.z);
      dummy.scale.set(tree.scale * 0.9, tree.scale * 0.95, tree.scale * 0.9);
      dummy.updateMatrix();
      foliageTops.setMatrixAt(index, dummy.matrix);
      foliageTops.setColorAt(index, color);
    });
    trunks.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    foliageTops.instanceMatrix.needsUpdate = true;
    if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
    if (foliageTops.instanceColor) foliageTops.instanceColor.needsUpdate = true;
    trunks.castShadow = true;
    foliage.castShadow = true;
    foliageTops.castShadow = true;
    group.add(trunks, foliage, foliageTops);
  }

  // ------------------------------------------------------------------ signs --
  function addSign(
    x: number,
    z: number,
    textureOptions: {
      eyebrow: string;
      title: string;
      subtitle: string;
      accent: string;
      ghost?: boolean;
    },
    tilt = 0,
    width = 14,
  ): void {
    const { texture, aspect } = createSignTexture({
      ...textureOptions,
      anisotropy,
    });
    const sign = new THREE.Group();
    sign.position.set(x, 0.18, z);
    sign.rotation.z = tilt;
    // Roadside-billboard size at street level rather than a sky-high banner.
    sign.scale.setScalar(0.6);

    const panelHeight = width / aspect;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(width, panelHeight),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    panel.position.y = 3.2 + panelHeight / 2;
    sign.add(panel);
    // Back board so the sign has a physical edge from behind.
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.99, panelHeight * 0.99, 0.18),
      woodMaterial,
    );
    backing.position.set(0, panel.position.y, -0.13);
    sign.add(backing);

    const postGeometry = new THREE.CylinderGeometry(0.17, 0.22, 3.4, 6);
    for (const offset of [-width * 0.32, width * 0.32]) {
      const post = new THREE.Mesh(postGeometry, woodMaterial);
      post.position.set(offset, 1.7, 0);
      obstacles.push({ x: x + offset * sign.scale.x, z, r: 0.22 * sign.scale.x });
      post.castShadow = true;
      sign.add(post);
    }
    group.add(sign);
  }

  const stars = data.repos.reduce((sum, repo) => sum + repo.stars, 0);
  if (layout.active) {
    addSign(
      layout.active.x + layout.active.w * 0.24,
      layout.active.z + layout.active.d / 2 + 5.5,
      {
        eyebrow: 'github town',
        title: `@${data.profile.login}`,
        subtitle: `${layout.counts.active} lived-in repos · ${formatCompact(stars)} stars`,
        accent: '#8fb3ff',
      },
    );
  }
  // Labels for the most famous buildings in the living town.
  if (layout.active) {
    const famous = layout.placed
      .filter((placed) => placed.kind === 'building' && !placed.repo.isGhost)
      .sort((a, b) => b.repo.stars - a.repo.stars)
      .slice(0, 4);
    for (const placed of famous) {
      const handle = buildings.find((candidate) => candidate.repo.id === placed.repo.id);
      const topY = handle
        ? handle.group.position.y +
          Math.max(
            ...handle.group.children.map((child) => {
              if (!(child instanceof THREE.Mesh)) return 0;
              child.geometry.computeBoundingBox();
              const box = child.geometry.boundingBox;
              return box ? box.max.y + child.position.y : 0;
            }),
          )
        : 6;
      const label = createLabelTexture(
        placed.repo.name,
        `${formatCompact(placed.repo.stars)} stars · ${placed.repo.language ?? 'no language'}`,
        languageColor(placed.repo.language),
        anisotropy,
      );
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: label.texture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          opacity: 0.94,
        }),
      );
      const labelWidth = 8;
      sprite.scale.set(labelWidth, labelWidth / label.aspect, 1);
      sprite.position.set(placed.x, topY + 2.1, placed.z);
      group.add(sprite);
    }
  }

  const tick = (elapsed: number): void => {
    for (const car of cars) {
      const t = (car.phase + elapsed * car.speed) % 1;
      const position = car.curve.getPointAt(t);
      const tangent = car.curve.getTangentAt(t);
      car.object.position.set(position.x, 0.16, position.z);
      car.object.rotation.y = Math.atan2(tangent.x, tangent.z);
    }

    for (const tip of tips) {
      const pulse = 0.75 + Math.sin(elapsed * 2.1 + tip.phase) * 0.25;
      tip.mesh.scale.setScalar(pulse);
    }

    for (const wisp of wisps) {
      const material = wisp.sprite.material as THREE.SpriteMaterial;
      wisp.sprite.position.y =
        wisp.baseY + Math.sin(elapsed * wisp.speed + wisp.phase) * wisp.amp;
      wisp.sprite.position.x =
        wisp.baseX + Math.sin(elapsed * wisp.speed * 0.37 + wisp.phase) * wisp.amp * 1.4;
      material.opacity =
        wisp.opacity * (0.55 + 0.45 * Math.sin(elapsed * wisp.speed * 1.6 + wisp.phase));
    }

    for (const ghostLight of ghostLights) {
      ghostLight.light.intensity =
        ghostLight.base *
        (0.45 + 0.55 * Math.abs(Math.sin(elapsed * 1.7 + ghostLight.phase)));
    }

    for (const floater of floaters) {
      floater.object.position.y =
        floater.baseY + Math.sin(elapsed * 0.32 + floater.phase) * floater.amp;
      floater.object.rotation.y += floater.spin * 0.016;
    }

    for (const pulse of pulses) {
      pulse.material.opacity =
        pulse.baseOpacity * (0.8 + 0.2 * Math.sin(elapsed * pulse.rate + pulse.phase));
    }
  };

  // ------------------------------------------------------------ org islands --
  // Each public organization floats beside the town as a small island with a
  // few buildings. Aiming at one and clicking travels to that org's town.
  const orgPickables: THREE.Mesh[] = [];
  const orgList = (data.orgs ?? []).slice(0, 12);
  if (orgList.length) {
    const orgGrassMaterial = new THREE.MeshStandardMaterial({
      color: 0x4c8462,
      roughness: 1,
      flatShading: true,
    });
    // Hang them in the sky the walker faces at spawn: above the far half of
    // the town, at least ~95 units ahead and higher than the tallest tower
    // (32 units), so they sit ~24 degrees above the horizon in the first view.
    const rowZ = Math.min(layout.island.z - layout.island.d * 0.15, spawnZ - 95);
    const spacing = 34;
    orgList.forEach((org: OrgSummary, index) => {
      const rng = mulberry32(hashString(org.login));
      const islet = new THREE.Group();
      const baseY = 40 + rng() * 6;
      islet.position.set(
        spawnX + (index - (orgList.length - 1) / 2) * spacing,
        baseY,
        rowZ + (rng() - 0.5) * 14,
      );
      const markPickable = (mesh: THREE.Mesh): void => {
        mesh.userData.org = org;
        orgPickables.push(mesh);
      };

      const size = 7 + Math.min(org.repoCount ?? 6, 30) * 0.18;
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(size, size * 0.92, 1.4, 9),
        orgGrassMaterial,
      );
      top.position.y = -0.7;
      top.receiveShadow = true;
      islet.add(top);
      markPickable(top);

      const rock = new THREE.Mesh(new THREE.ConeGeometry(size * 0.92, size * 1.3, 9), rockMaterial);
      rock.rotation.x = Math.PI;
      rock.position.y = -1.4 - size * 0.65;
      islet.add(rock);
      markPickable(rock);

      const hue = rng();
      const buildingCount = clamp(org.repoCount ?? 5, 3, 9);
      for (let i = 0; i < buildingCount; i += 1) {
        const width = 1.5 + rng() * 1.1;
        const depth = 1.5 + rng() * 1.1;
        const height = 2.4 + rng() * 5.5;
        const color = new THREE.Color().setHSL((hue + rng() * 0.18) % 1, 0.45, 0.55);
        const building = new THREE.Mesh(
          facadeGeometry(width, height, depth, rng() * 3, rng() * 3),
          getSideMaterial(color, false),
        );
        const spot = rng() * Math.PI * 2;
        const reach = Math.sqrt(rng()) * size * 0.6;
        building.position.set(Math.cos(spot) * reach, height / 2, Math.sin(spot) * reach);
        building.castShadow = true;
        islet.add(building);
        markPickable(building);
      }

      const accent = `#${new THREE.Color().setHSL(hue, 0.7, 0.72).getHexString()}`;
      const label = createLabelTexture(
        org.login,
        org.repoCount !== undefined
          ? `organization · ${org.repoCount} repos · click to visit`
          : 'organization · click to visit',
        accent,
        anisotropy,
      );
      const sign = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: label.texture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          fog: false,
        }),
      );
      const labelWidth = 18;
      sign.scale.set(labelWidth, labelWidth / label.aspect, 1);
      sign.position.y = 12.5;
      islet.add(sign);

      group.add(islet);
      floaters.push({
        object: islet,
        baseY,
        phase: rng() * Math.PI * 2,
        amp: 0.9,
        spin: (rng() - 0.5) * 0.03,
      });
    });
  }

  group.scale.setScalar(S);

  // Start just outside the main street, facing into town.
  const spawn = {
    position: new THREE.Vector3(spawnX * S, 0.1 * S + EYE_HEIGHT, spawnZ * S),
    yaw: 0,
  };
  // A car body is 1.5 (local x) by 0.9 (local z, its heading) design units:
  // two circles side by side across the heading cover it.
  const movingObstacles = (): Obstacle[] =>
    cars.flatMap((car) => {
      const { x, z } = car.object.position;
      const heading = car.object.rotation.y;
      const dx = Math.cos(heading) * 0.38;
      const dz = -Math.sin(heading) * 0.38;
      return [
        { x: (x + dx) * S, z: (z + dz) * S, r: 0.5 * S },
        { x: (x - dx) * S, z: (z - dz) * S, r: 0.5 * S },
      ];
    });
  const walkInset = 7;
  return {
    group,
    pickables,
    orgPickables,
    buildings,
    layout,
    tick,
    view: {
      target: new THREE.Vector3(layout.island.x * S, 0, layout.island.z * S),
      radius: (Math.max(layout.island.w, layout.island.d) / 2) * S,
    },
    spawn,
    walkBounds: {
      x: layout.island.x * S,
      z: layout.island.z * S,
      w: (layout.island.w - walkInset * 2) * S,
      d: (layout.island.d - walkInset * 2) * S,
      // The island outline uses a 22-unit corner radius.
      cornerRadius: (22 - walkInset) * S,
    },
    obstacles: obstacles.map((o) => ({ x: o.x * S, z: o.z * S, r: o.r * S })),
    movingObstacles,
  };
}
