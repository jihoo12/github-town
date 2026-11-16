import { GHOST_AFTER_DAYS, type Profile, type Repo, type TownData } from './github';

const now = Date.now();
const daysAgo = (days: number, hours = 0): string =>
  new Date(now - days * 86_400_000 - hours * 3_600_000).toISOString();

interface DemoSpec {
  id: number;
  name: string;
  description: string;
  stars: number;
  language: string;
  size: number;
  pushed: number;
  archived?: boolean;
}

const active: DemoSpec[] = [
  {
    id: 101,
    name: 'aurora-engine',
    description: 'A tiny WebGPU renderer for people who like shiny triangles.',
    stars: 4820,
    language: 'TypeScript',
    size: 8421,
    pushed: 0.2,
  },
  {
    id: 102,
    name: 'pixel-garden',
    description: 'Grow a little garden while your tests run.',
    stars: 1320,
    language: 'TypeScript',
    size: 2100,
    pushed: 1,
  },
  {
    id: 103,
    name: 'rusty-radio',
    description: 'An internet radio client that refuses to buffer.',
    stars: 640,
    language: 'Rust',
    size: 3900,
    pushed: 2,
  },
  {
    id: 104,
    name: 'nix-dots',
    description: 'My overly ambitious NixOS configuration.',
    stars: 208,
    language: 'Nix',
    size: 980,
    pushed: 3,
  },
  {
    id: 105,
    name: 'seoul-transit',
    description: 'Realtime subway arrivals in a single HTML file.',
    stars: 92,
    language: 'JavaScript',
    size: 420,
    pushed: 4,
  },
  {
    id: 106,
    name: 'paper-planes',
    description: 'Generative paper textures for the web.',
    stars: 306,
    language: 'CSS',
    size: 180,
    pushed: 5,
  },
  {
    id: 107,
    name: 'tiny-lisp',
    description: 'A Lisp interpreter that fits on one screen.',
    stars: 1240,
    language: 'C',
    size: 220,
    pushed: 6,
  },
  {
    id: 108,
    name: 'moonlit-cli',
    description: 'A calm terminal dashboard for night owls.',
    stars: 77,
    language: 'Go',
    size: 610,
    pushed: 8,
  },
  {
    id: 109,
    name: 'hanok',
    description: 'A Hanok-inspired theme for static site generators.',
    stars: 45,
    language: 'Astro',
    size: 330,
    pushed: 10,
  },
  {
    id: 110,
    name: 'sprite-forge',
    description: 'Pixel art editor with a palette from 1989.',
    stars: 512,
    language: 'Lua',
    size: 1500,
    pushed: 12,
  },
  {
    id: 111,
    name: 'buffer-pond',
    description: 'A visual debugger for streams and buffers.',
    stars: 31,
    language: 'Python',
    size: 760,
    pushed: 14,
  },
  {
    id: 112,
    name: 'glasskey',
    description: 'Beautiful keyboard shortcuts for the browser.',
    stars: 18,
    language: 'TypeScript',
    size: 240,
    pushed: 17,
  },
  {
    id: 113,
    name: 'algae',
    description: 'A tiny CSS framework that grows on you.',
    stars: 9,
    language: 'CSS',
    size: 95,
    pushed: 20,
  },
  {
    id: 114,
    name: 'hanji-press',
    description: 'Markdown to printable paper, with love.',
    stars: 3,
    language: 'Shell',
    size: 60,
    pushed: 26,
  },
];

const stale: DemoSpec[] = [
  {
    id: 201,
    name: 'old-blog',
    description: 'A blog engine from 2019. It still builds, somehow.',
    stars: 64,
    language: 'Ruby',
    size: 1200,
    pushed: 128,
  },
  {
    id: 202,
    name: 'raycast-experiments',
    description: 'Weekend raytracing experiments in Rust.',
    stars: 210,
    language: 'Rust',
    size: 2400,
    pushed: 172,
  },
  {
    id: 203,
    name: 'todo-universe',
    description: 'Every to-do app needs a universe, right?',
    stars: 14,
    language: 'JavaScript',
    size: 380,
    pushed: 244,
  },
  {
    id: 204,
    name: 'robot-arm',
    description: 'Inverse kinematics for a cardboard robot arm.',
    stars: 38,
    language: 'C++',
    size: 560,
    pushed: 328,
  },
  {
    id: 205,
    name: 'definitely-done',
    description: 'A game about finishing side projects. Ironic.',
    stars: 6,
    language: 'GDScript',
    size: 900,
    pushed: 520,
  },
];

const archived: DemoSpec[] = [
  {
    id: 301,
    name: 'v1-website',
    description: 'The first version of my personal site.',
    stars: 12,
    language: 'HTML',
    size: 120,
    pushed: 640,
    archived: true,
  },
  {
    id: 302,
    name: 'crypto-ticker',
    description: 'A 2017 crypto ticker. Please do not run this.',
    stars: 4,
    language: 'JavaScript',
    size: 140,
    pushed: 900,
    archived: true,
  },
  {
    id: 303,
    name: 'learn-elm',
    description: 'Learning Elm, one counter at a time.',
    stars: 2,
    language: 'Elm',
    size: 70,
    pushed: 1400,
    archived: true,
  },
];

function toRepo(spec: DemoSpec, index: number): Repo {
  const pushedAt = daysAgo(spec.pushed);
  return {
    id: spec.id,
    name: spec.name,
    fullName: `demo/${spec.name}`,
    description: spec.description,
    htmlUrl: 'https://github.com/',
    stars: spec.stars,
    forks: Math.round(spec.stars * 0.07) + (index % 5),
    language: spec.language,
    topics: [],
    archived: spec.archived ?? false,
    fork: false,
    createdAt: daysAgo(1200 - index * 13),
    pushedAt,
    updatedAt: pushedAt,
    size: spec.size,
    isGhost: (spec.archived ?? false) || spec.pushed > GHOST_AFTER_DAYS,
    ghostReason: spec.archived
      ? 'archived'
      : spec.pushed > GHOST_AFTER_DAYS
        ? 'stale'
        : null,
  };
}

const repos = [...active, ...stale, ...archived].map(toRepo);

export const DEMO_TOWN: TownData = {
  profile: {
    login: 'demo',
    name: 'Demo Town',
    avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4',
    bio: 'A little demo town for when the API is shy.',
    followers: 128,
    following: 42,
    publicRepos: repos.length,
    htmlUrl: 'https://github.com/',
  } satisfies Profile,
  repos,
  stats: {
    totalNonFork: repos.length,
    active: active.length,
    ghost: stale.length + archived.length,
    archived: archived.length,
    stale: stale.length,
    stars: repos.reduce((sum, repo) => sum + repo.stars, 0),
    hidden: 0,
  },
  rateLimit: null,
  fetchedAt: Date.now(),
};
