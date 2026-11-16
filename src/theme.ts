export const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572a5',
  Rust: '#dea584',
  Go: '#00add8',
  C: '#7f8794',
  'C++': '#f34b7d',
  'C#': '#178600',
  Java: '#b07219',
  Kotlin: '#a97bff',
  Swift: '#f05138',
  Ruby: '#a4344a',
  PHP: '#4f5d95',
  Lua: '#5a7dcc',
  HTML: '#e34c26',
  CSS: '#8b5cf6',
  SCSS: '#c6538c',
  Shell: '#89e051',
  Nix: '#7e7eff',
  Astro: '#ff5a03',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Dart: '#00b4ab',
  Elixir: '#9d6ab8',
  Haskell: '#7d6bb5',
  Zig: '#ec915c',
  Clojure: '#db5855',
  OCaml: '#3be133',
  Scala: '#c22d40',
  R: '#198ce7',
  Julia: '#a270ba',
  'Jupyter Notebook': '#da5b0b',
  'Objective-C': '#438eff',
  Assembly: '#8a6a35',
  Makefile: '#6b8f3a',
  Dockerfile: '#4f7d8c',
  HCL: '#844fba',
  PowerShell: '#4a7fc1',
  Perl: '#2f8fbf',
  TeX: '#3d6117',
  MDX: '#fcb32c',
  GDScript: '#6b8aa0',
  Solidity: '#aa6746',
  Gleam: '#ffaff3',
  WebAssembly: '#654ff0',
  Batchfile: '#a4b52f',
  'Vim Script': '#199f4b',
  'Emacs Lisp': '#a05fc0',
  'Common Lisp': '#3fb68b',
  Roff: '#b8ab86',
  Apex: '#1797c0',
  QML: '#44a51c',
  OpenSCAD: '#c9b23f',
};

export const FALLBACK_COLOR = '#8b94a7';

export function languageColor(language: string | null | undefined): string {
  if (!language) return FALLBACK_COLOR;
  return LANGUAGE_COLORS[language] ?? FALLBACK_COLOR;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatCompact(value: number): string {
  if (value < 1000) return String(value);
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '알 수 없음';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  if (days < 730) return '1년 전';
  return `${Math.floor(days / 365)}년 전`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** Deterministic 32-bit hash for names. */
export function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Small deterministic PRNG so the same repo always produces the same building. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
