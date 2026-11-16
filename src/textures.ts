import * as THREE from 'three';
import { mulberry32 } from './theme';

function createCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable');
  return { canvas, ctx };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function toTexture(
  canvas: HTMLCanvasElement,
  anisotropy: number,
  colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace,
): THREE.Texture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

export interface WindowTextures {
  facade: THREE.Texture;
  glow: THREE.Texture;
  ghostGlow: THREE.Texture;
}

/**
 * A tileable facade: pale walls with dark windows. The facade is tinted per
 * building by the material color, while lit windows glow through the
 * separate emissive map.
 */
export function createWindowTextures(anisotropy: number): WindowTextures {
  const size = 256;
  const cols = 4;
  const rows = 5;
  const cellW = size / cols;
  const cellH = size / rows;

  const facadeCanvas = createCanvas(size, size);
  const glowCanvas = createCanvas(size, size);
  const ghostCanvas = createCanvas(size, size);
  const f = facadeCanvas.ctx;
  const g = glowCanvas.ctx;
  const gh = ghostCanvas.ctx;

  f.fillStyle = '#eceae4';
  f.fillRect(0, 0, size, size);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, size, size);
  gh.fillStyle = '#000000';
  gh.fillRect(0, 0, size, size);

  const rand = mulberry32(0x9e3779b9);
  f.globalAlpha = 0.05;
  for (let i = 0; i < 90; i += 1) {
    f.fillStyle = rand() > 0.5 ? '#000000' : '#ffffff';
    f.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 10 + rand() * 40);
  }
  f.globalAlpha = 1;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const w = 27;
      const h = 19;
      const x = col * cellW + (cellW - w) / 2;
      const y = row * cellH + (cellH - h) / 2 - 1;
      const lit = rand() < 0.38;
      const ghostLit = rand() < 0.11;

      f.fillStyle = lit ? '#8f9296' : '#262a32';
      roundRect(f, x, y, w, h, 1.5);
      f.fill();

      f.fillStyle = 'rgba(255,255,255,0.18)';
      f.fillRect(x + 1, y + 1, w - 2, 1.5);
      f.fillStyle = 'rgba(0,0,0,0.2)';
      f.fillRect(x - 1, y + h + 1.5, w + 2, 2);

      if (lit) {
        const glow = g.createLinearGradient(0, y, 0, y + h);
        glow.addColorStop(0, '#fff6d7');
        glow.addColorStop(0.55, '#ffd596');
        glow.addColorStop(1, '#f2a35b');
        g.save();
        g.shadowColor = 'rgba(255, 196, 120, 0.9)';
        g.shadowBlur = 7;
        g.fillStyle = glow;
        roundRect(g, x + 1, y + 1, w - 2, h - 2, 2);
        g.fill();
        g.restore();
        g.fillStyle = 'rgba(98, 58, 24, 0.4)';
        g.fillRect(x + w / 2 - 1, y + 2, 2, h - 4);
      }

      if (ghostLit) {
        gh.save();
        gh.shadowColor = 'rgba(108, 255, 192, 0.65)';
        gh.shadowBlur = 6;
        gh.globalAlpha = 0.75;
        gh.fillStyle = '#7dffc4';
        roundRect(gh, x + 2, y + 2, w - 4, h - 4, 2);
        gh.fill();
        gh.restore();
      }
    }
  }

  return {
    facade: toTexture(facadeCanvas.canvas, anisotropy),
    glow: toTexture(glowCanvas.canvas, anisotropy),
    ghostGlow: toTexture(ghostCanvas.canvas, anisotropy),
  };
}

export interface SignTexture {
  texture: THREE.Texture;
  aspect: number;
}

export function createSignTexture(options: {
  eyebrow: string;
  title: string;
  subtitle: string;
  accent: string;
  ghost?: boolean;
  anisotropy: number;
}): SignTexture {
  const width = 1024;
  const height = 512;
  const { canvas, ctx } = createCanvas(width, height);
  const accent = options.accent;

  ctx.clearRect(0, 0, width, height);
  roundRect(ctx, 20, 20, width - 40, height - 40, 44);
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, options.ghost ? '#111a16' : '#14121f');
  bg.addColorStop(1, options.ghost ? '#0a120e' : '#0b0a13');
  ctx.fillStyle = bg;
  ctx.fill();

  ctx.lineWidth = 6;
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.85;
  roundRect(ctx, 26, 26, width - 52, height - 52, 38);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, 38, 38, width - 76, height - 76, 30);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.95;
  ctx.font = '600 30px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(options.eyebrow.toUpperCase(), width / 2, 108);
  ctx.globalAlpha = 1;

  let titleSize = 104;
  const title = options.title;
  ctx.font = `800 ${titleSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  while (ctx.measureText(title).width > width - 140 && titleSize > 44) {
    titleSize -= 4;
    ctx.font = `800 ${titleSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  }
  ctx.fillStyle = '#f6f2ea';
  ctx.fillText(title, width / 2, 232);

  ctx.fillStyle = accent;
  roundRect(ctx, width / 2 - 120, 302, 240, 6, 3);
  ctx.fill();

  ctx.font = '400 34px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#b9b4c7';
  ctx.fillText(options.subtitle, width / 2, 372);

  ctx.font = '400 24px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.fillText(options.ghost ? 'abandoned repository district' : 'github town', width / 2, 444);

  return { texture: toTexture(canvas, options.anisotropy), aspect: width / height };
}

export interface LabelTexture {
  texture: THREE.Texture;
  aspect: number;
}

export function createLabelTexture(
  name: string,
  meta: string,
  accent: string,
  anisotropy: number,
): LabelTexture {
  const width = 512;
  const height = 128;
  const { canvas, ctx } = createCanvas(width, height);

  ctx.clearRect(0, 0, width, height);
  roundRect(ctx, 6, 10, width - 12, height - 20, 26);
  ctx.fillStyle = 'rgba(13, 12, 20, 0.88)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, 6, 10, width - 12, height - 20, 26);
  ctx.stroke();

  ctx.fillStyle = accent;
  roundRect(ctx, 20, 34, 8, height - 68, 4);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  let nameSize = 40;
  ctx.font = `700 ${nameSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  while (ctx.measureText(name).width > 350 && nameSize > 22) {
    nameSize -= 2;
    ctx.font = `700 ${nameSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  }
  ctx.fillStyle = '#f4f1ec';
  ctx.fillText(name, 46, 54);

  ctx.font = '400 24px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#a29db2';
  ctx.fillText(meta, 46, 94);

  return { texture: toTexture(canvas, anisotropy), aspect: width / height };
}

export function createGlowTexture(anisotropy: number, softness = 0.42): THREE.Texture {
  const size = 128;
  const { canvas, ctx } = createCanvas(size, size);
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(softness, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

export function createGroundTexture(
  kind: 'grass' | 'asphalt' | 'dirt',
  anisotropy: number,
): THREE.Texture {
  const size = 256;
  const { canvas, ctx } = createCanvas(size, size);
  const rand = mulberry32(kind === 'grass' ? 11 : kind === 'asphalt' ? 23 : 37);

  const base =
    kind === 'grass' ? '#3a5848' : kind === 'asphalt' ? '#40434b' : '#342e3c';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  if (kind === 'grass') {
    for (let i = 0; i < 2200; i += 1) {
      const shade = rand();
      ctx.fillStyle =
        shade > 0.7
          ? 'rgba(118, 158, 122, 0.32)'
          : shade > 0.35
            ? 'rgba(66, 100, 80, 0.45)'
            : 'rgba(20, 34, 27, 0.4)';
      const x = rand() * size;
      const y = rand() * size;
      ctx.fillRect(x, y, 1 + rand() * 1.5, 1 + rand() * 3.5);
    }
  } else if (kind === 'asphalt') {
    for (let i = 0; i < 2600; i += 1) {
      const shade = rand();
      ctx.fillStyle =
        shade > 0.6
          ? 'rgba(108, 112, 126, 0.32)'
          : 'rgba(18, 19, 24, 0.3)';
      ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
    }
    ctx.strokeStyle = 'rgba(12,13,17,0.28)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i += 1) {
      ctx.beginPath();
      let x = rand() * size;
      let y = rand() * size;
      ctx.moveTo(x, y);
      for (let s = 0; s < 5; s += 1) {
        x += (rand() - 0.5) * 26;
        y += (rand() - 0.5) * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 1400; i += 1) {
      const shade = rand();
      ctx.fillStyle =
        shade > 0.75
          ? 'rgba(82, 76, 94, 0.35)'
          : 'rgba(14, 12, 18, 0.4)';
      const r = rand() * 2.4;
      ctx.beginPath();
      ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(10,9,14,0.35)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 6; i += 1) {
      ctx.beginPath();
      let x = rand() * size;
      let y = rand() * size;
      ctx.moveTo(x, y);
      for (let s = 0; s < 4; s += 1) {
        x += (rand() - 0.5) * 40;
        y += (rand() - 0.5) * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  return toTexture(canvas, anisotropy);
}

export function createFogTexture(anisotropy: number): THREE.Texture {
  const width = 256;
  const height = 256;
  const { canvas, ctx } = createCanvas(width, height);
  const rand = mulberry32(71);
  for (let i = 0; i < 26; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const r = 28 + rand() * 60;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  // Fade the patch to nothing at its borders so a single plane can sit over
  // the ghost town without showing a rectangular seam.
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(
    width / 2,
    height / 2,
    width * 0.06,
    width / 2,
    height / 2,
    width * 0.5,
  );
  mask.addColorStop(0, 'rgba(0, 0, 0, 1)');
  mask.addColorStop(0.55, 'rgba(0, 0, 0, 0.72)');
  mask.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}
