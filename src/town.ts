import * as THREE from 'three';
import type { Repo, TownData } from './github';
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

const ACTIVE_CELL = 10.6;
const ACTIVE_MARGIN = 6;
const GHOST_CELL = 6.6;
const GHOST_MARGIN = 4;
const CEMETERY_CELL = 2.9;
const TOWN_GAP = 18;
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
  ghost: GridSection | null;
  ruins: GridSection | null;
  cemetery: GridSection | null;
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
  pickables: THREE.Mesh[];
  buildings: BuildingHandle[];
  layout: TownLayout;
  tick: (elapsed: number) => void;
  view: {
    target: THREE.Vector3;
    radius: number;
  };
}

function byStars(a: Repo, b: Repo): number {
  return b.stars - a.stars || Date.parse(b.pushedAt) - Date.parse(a.pushedAt);
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

export function computeLayout(repos: Repo[]): TownLayout {
  const activeRepos = repos.filter((repo) => !repo.isGhost).sort(byStars);
  const ghostRepos = repos.filter((repo) => repo.isGhost);
  const staleRepos = ghostRepos.filter((repo) => repo.ghostReason === 'stale').sort(byStars);
  const archivedRepos = ghostRepos.filter((repo) => repo.ghostReason === 'archived').sort(byStars);

  const activeGrid = activeRepos.length
    ? makeGridSection(activeRepos.length, ACTIVE_CELL, ACTIVE_MARGIN, 1.45)
    : null;
  const active: GridSection | null = activeGrid
    ? { ...activeGrid, x: 0, z: 0 }
    : null;

  const ruinsGrid = staleRepos.length
    ? makeGridSection(staleRepos.length, GHOST_CELL, GHOST_MARGIN, 1.55)
    : null;
  const cemeteryGrid = archivedRepos.length
    ? makeGridSection(archivedRepos.length, CEMETERY_CELL, 4, 1.5)
    : null;

  const bothGhost = Boolean(ruinsGrid && cemeteryGrid);
  const contentDepth =
    (ruinsGrid?.d ?? 0) + (cemeteryGrid?.d ?? 0) + (bothGhost ? 6 : 0);
  const ghostW = Math.max(ruinsGrid?.w ?? 0, cemeteryGrid?.w ?? 0, 13) + 6;
  const ghostD = contentDepth + 6;

  const ghostX = active
    ? -(active.w / 2 + TOWN_GAP + ghostW / 2)
    : 0;

  let ghost: GridSection | null = null;
  let ruins: GridSection | null = null;
  let cemetery: GridSection | null = null;

  if (ruinsGrid || cemeteryGrid) {
    ghost = { x: ghostX, z: 0, w: ghostW, d: ghostD, cols: 0, rows: 0, cell: 0 };

    if (ruinsGrid) {
      ruins = {
        ...ruinsGrid,
        x: ghostX,
        z: ghostD / 2 - 3 - ruinsGrid.d / 2,
      };
    }
    if (cemeteryGrid) {
      cemetery = {
        ...cemeteryGrid,
        x: ghostX,
        z: -ghostD / 2 + 3 + cemeteryGrid.d / 2,
      };
    }
  }

  const placed: PlacedRepo[] = [];

  if (active) {
    const positions = gridPositions(active.cols, active.rows, active.cell);
    activeRepos.forEach((repo, index) => {
      const position = positions[index];
      if (!position) return;
      placed.push({ repo, x: position.x, z: active.z + position.z, kind: 'building' });
    });
  }

  if (ruins && staleRepos.length) {
    const positions = gridPositions(ruins.cols, ruins.rows, ruins.cell);
    staleRepos.forEach((repo, index) => {
      const position = positions[index];
      if (!position) return;
      placed.push({
        repo,
        x: ruins!.x + position.x,
        z: ruins!.z + position.z,
        kind: 'building',
      });
    });
  }

  if (cemetery && archivedRepos.length) {
    const positions = gridPositions(cemetery.cols, cemetery.rows, cemetery.cell);
    archivedRepos.forEach((repo, index) => {
      const position = positions[index];
      if (!position) return;
      placed.push({
        repo,
        x: cemetery!.x + position.x,
        z: cemetery!.z + position.z,
        kind: 'tombstone',
      });
    });
  }

  let minX = 0;
  let maxX = 0;
  let minZ = 0;
  let maxZ = 0;
  let hasBounds = false;
  const include = (rect: Rect): void => {
    if (!hasBounds) {
      minX = rect.x - rect.w / 2;
      maxX = rect.x + rect.w / 2;
      minZ = rect.z - rect.d / 2;
      maxZ = rect.z + rect.d / 2;
      hasBounds = true;
      return;
    }
    minX = Math.min(minX, rect.x - rect.w / 2);
    maxX = Math.max(maxX, rect.x + rect.w / 2);
    minZ = Math.min(minZ, rect.z - rect.d / 2);
    maxZ = Math.max(maxZ, rect.z + rect.d / 2);
  };
  if (active) include(active);
  if (ghost) include(ghost);

  const island: Rect = {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    w: maxX - minX + ISLAND_MARGIN * 2,
    d: maxZ - minZ + ISLAND_MARGIN * 2,
  };

  return {
    placed,
    active,
    ghost,
    ruins,
    cemetery,
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
    color.setHSL(hsl.h, Math.min(hsl.s, 0.12), 0.11 + Math.min(hsl.l, 0.6) * 0.04);
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
  const tileW = 8.5;
  const tileH = 12.5;
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
      emissiveIntensity: ghost ? 0.26 : 1.18,
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

    const starHeight = Math.log2(repo.stars + 2) * 1.9;
    const sizeBoost = clamp(Math.sqrt(repo.size) / 15, 0, 2.1);
    let height = 3.4 + starHeight + sizeBoost * 0.5 + rng() * 1.8;
    height = Math.min(height, ghost ? 13.5 : 24);
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
    monument.scale.setScalar(1.6);

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
      footprint: 1.4,
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

  // ----------------------------------------------------------------- plates --
  if (layout.active) {
    const active = layout.active;
    asphaltTexture.repeat.set(active.w / 9, active.d / 9);
    const plateMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: asphaltTexture,
      roughness: 0.98,
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(active.w, active.d), plateMaterial);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(active.x, 0.045, active.z);
    plate.receiveShadow = true;
    group.add(plate);

    // Curbs frame the town and keep the eye inside the grid.
    const curbMaterial = new THREE.MeshStandardMaterial({ color: 0x636776, roughness: 1 });
    const curbHeight = 0.3;
    const curbs = [
      { w: active.w + 0.5, d: 0.5, x: active.x, z: active.z - active.d / 2 },
      { w: active.w + 0.5, d: 0.5, x: active.x, z: active.z + active.d / 2 },
      { w: 0.5, d: active.d + 0.5, x: active.x - active.w / 2, z: active.z },
      { w: 0.5, d: active.d + 0.5, x: active.x + active.w / 2, z: active.z },
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

    // Lane markings.
    const dashGeometry = new THREE.PlaneGeometry(1, 1);
    dashGeometry.rotateX(-Math.PI / 2);
    const dashMaterial = new THREE.MeshBasicMaterial({
      color: 0xd3d6df,
      transparent: true,
      opacity: 0.52,
      toneMapped: false,
    });
    const dashes: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    const lineSpanZ = (active.rows - 1) * active.cell + active.cell;
    const lineSpanX = (active.cols - 1) * active.cell + active.cell;
    for (let col = 1; col < active.cols; col += 1) {
      const x = active.x + (col - active.cols / 2) * active.cell;
      for (let z = -lineSpanZ / 2 + 1; z < lineSpanZ / 2; z += 2.6) {
        dummy.position.set(x, 0.07, active.z + z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.13, 1, 1.05);
        dummy.updateMatrix();
        dashes.push(dummy.matrix.clone());
      }
    }
    for (let row = 1; row < active.rows; row += 1) {
      const z = active.z + (row - active.rows / 2) * active.cell;
      for (let x = -lineSpanX / 2 + 1; x < lineSpanX / 2; x += 2.6) {
        dummy.position.set(active.x + x, 0.07, z);
        dummy.rotation.set(0, Math.PI / 2, 0);
        dummy.scale.set(0.13, 1, 1.05);
        dummy.updateMatrix();
        dashes.push(dummy.matrix.clone());
      }
    }
    const dashMesh = new THREE.InstancedMesh(dashGeometry, dashMaterial, dashes.length);
    dashes.forEach((matrix, index) => dashMesh.setMatrixAt(index, matrix));
    dashMesh.instanceMatrix.needsUpdate = true;
    group.add(dashMesh);
  }

  if (layout.ghost) {
    const ghost = layout.ghost;
    dirtTexture.repeat.set(ghost.w / 8, ghost.d / 8);
    const plateMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: dirtTexture,
      roughness: 1,
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(ghost.w, ghost.d), plateMaterial);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(ghost.x, 0.04, ghost.z);
    plate.receiveShadow = true;
    group.add(plate);
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
  let lampLightBudget = 3;

  function addLamp(
    x: number,
    z: number,
    color: string,
    glowColor: string,
    withLight: boolean,
  ): void {
    const lamp = new THREE.Group();
    lamp.position.set(x, 0.18, z);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.1, 3.3, 6),
      darkStoneMaterial,
    );
    pole.position.y = 1.65;
    lamp.add(pole);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 8, 8),
      lampBulbMaterial,
    );
    bulb.position.y = 3.35;
    lamp.add(bulb);
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
      const light = new THREE.PointLight(new THREE.Color(color), 7, 20, 2);
      light.position.set(x, 3.3, z);
      group.add(light);
    }
  }

  if (layout.active) {
    const active = layout.active;
    const inset = 3.2;
    const left = active.x - active.w / 2 + inset;
    const right = active.x + active.w / 2 - inset;
    const front = active.z + active.d / 2 - inset;
    const back = active.z - active.d / 2 + inset;
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

    // A couple of cars circling the block.
    const carColors = [0xe8eaf2, 0xff6b6b, 0x6ee7ff];
    const curve = makeRoundedPath(active.w - 7, active.d - 7, 7);
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
      size: 0.2,
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

    // Fence along the border facing the living town.
    const fenceX = ghost.x + ghost.w / 2 + 2.2;
    const fenceStart = ghost.z - ghost.d / 2 + 4;
    const fenceEnd = ghost.z + ghost.d / 2 - 4;
    const postGeometry = new THREE.BoxGeometry(0.2, 2.3, 0.2);
    const railGeometry = new THREE.BoxGeometry(2.4, 0.09, 0.07);
    const posts: { x: number; z: number; tilt: number; height: number }[] = [];
    for (let z = fenceStart; z <= fenceEnd; z += 2.4) {
      if (Math.random() < 0.14) continue;
      posts.push({
        x: fenceX + (Math.random() - 0.5) * 0.25,
        z,
        tilt: (Math.random() - 0.5) * 0.25,
        height: 0.8 + Math.random() * 0.35,
      });
    }
    posts.forEach((post, index) => {
      const mesh = new THREE.Mesh(postGeometry, woodMaterial);
      mesh.position.set(post.x, 1.15 * post.height, post.z);
      mesh.rotation.z = post.tilt;
      mesh.scale.y = post.height;
      group.add(mesh);

      const next = posts[index + 1];
      if (next && Math.abs(next.z - post.z) < 3) {
        for (const railY of [0.95, 1.75]) {
          if (Math.random() < 0.18) continue;
          const rail = new THREE.Mesh(railGeometry, woodMaterial);
          rail.position.set(
            (post.x + next.x) / 2,
            railY * post.height,
            (post.z + next.z) / 2,
          );
          rail.rotation.z = (post.tilt + next.tilt) / 2;
          rail.rotation.y = Math.PI / 2;
          rail.scale.x = Math.abs(next.z - post.z) / 2.4;
          group.add(rail);
        }
      }
    });

    // Ground mist and drifting spirits.
    fogTexture.repeat.set(1.6, 1.6);
    const mistMaterial = new THREE.MeshBasicMaterial({
      map: fogTexture,
      color: 0x62ffbc,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 2; i += 1) {
      const mist = new THREE.Mesh(
        new THREE.PlaneGeometry(ghost.w * 1.02, ghost.d * 1.02),
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
    const ghostLampSpots = [
      { x: ghost.x + ghost.w * 0.3, z: ghost.z + ghost.d * 0.32 },
      { x: ghost.x - ghost.w * 0.24, z: ghost.z - ghost.d * 0.3 },
    ];
    ghostLampSpots.forEach((spot, index) => {
      const lamp = new THREE.Group();
      lamp.position.set(spot.x, 0.16, spot.z);
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

      const light = new THREE.PointLight(0x6fffc0, index === 0 ? 9 : 4, 24, 2);
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

    // Dead trees in and around the ghost town.
    for (let i = 0; i < 9; i += 1) {
      const tree = new THREE.Group();
      const height = 2 + Math.random() * 2.4;
      tree.position.set(
        ghost.x + (Math.random() - 0.5) * ghost.w * 1.1,
        0.1,
        ghost.z + (Math.random() - 0.5) * ghost.d * 1.1,
      );
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
  if (layout.active) exclusionRects.push(layout.active);
  if (layout.ghost) exclusionRects.push(layout.ghost);

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
    treePositions.push({
      x,
      z,
      scale: 0.75 + Math.random() * 0.9,
      tint: Math.random(),
    });
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
  if (layout.ghost) {
    addSign(
      layout.ghost.x,
      layout.ghost.z + layout.ghost.d / 2 + 5.5,
      {
        eyebrow: 'do not enter',
        title: 'GHOST TOWN',
        subtitle: `${layout.counts.stale} stale · ${layout.counts.archived} archived`,
        accent: '#6dffb4',
        ghost: true,
      },
      -0.035,
      12,
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

  const radius = Math.max(layout.island.w, layout.island.d) / 2;
  return {
    group,
    pickables,
    buildings,
    layout,
    tick,
    view: {
      target: new THREE.Vector3(layout.island.x, 0, layout.island.z),
      radius,
    },
  };
}
