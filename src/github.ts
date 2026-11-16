import { languageColor } from './theme';

export interface Repo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  stars: number;
  forks: number;
  language: string | null;
  topics: string[];
  archived: boolean;
  fork: boolean;
  createdAt: string;
  pushedAt: string;
  updatedAt: string;
  size: number;
  isGhost: boolean;
  ghostReason: 'archived' | 'stale' | null;
}

export interface Profile {
  login: string;
  name: string;
  avatarUrl: string;
  bio: string | null;
  followers: number;
  following: number;
  publicRepos: number;
  htmlUrl: string;
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: Date;
}

export interface TownStats {
  totalNonFork: number;
  active: number;
  ghost: number;
  archived: number;
  stale: number;
  stars: number;
  hidden: number;
}

export interface TownData {
  profile: Profile;
  repos: Repo[];
  stats: TownStats;
  rateLimit: RateLimitInfo | null;
  fetchedAt: number;
}

export type GitHubErrorCode =
  | 'not-found'
  | 'rate-limit'
  | 'unauthorized'
  | 'network'
  | 'http'
  | 'empty';

export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly resetAt: Date | null;
  readonly status: number | null;

  constructor(
    code: GitHubErrorCode,
    message: string,
    options: { resetAt?: Date | null; status?: number | null } = {},
  ) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.resetAt = options.resetAt ?? null;
    this.status = options.status ?? null;
  }
}

const API = 'https://api.github.com';
/** A repository with no push for this many days moves to the ghost town. */
export const GHOST_AFTER_DAYS = 90;
const MAX_PAGES = 5;
const MAX_ACTIVE = 150;
const MAX_GHOST = 150;

interface RawRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics?: string[];
  archived: boolean;
  fork: boolean;
  created_at: string;
  pushed_at: string | null;
  updated_at: string;
  size: number;
}

interface RawProfile {
  login: string;
  name: string | null;
  avatar_url: string;
  bio: string | null;
  followers: number;
  following: number;
  public_repos: number;
  html_url: string;
}

function authHeaders(token: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function rateLimitFrom(response: Response): RateLimitInfo | null {
  const remaining = response.headers.get('x-ratelimit-remaining');
  const limit = response.headers.get('x-ratelimit-limit');
  const reset = response.headers.get('x-ratelimit-reset');
  if (remaining === null || limit === null || reset === null) return null;
  return {
    remaining: Number(remaining),
    limit: Number(limit),
    resetAt: new Date(Number(reset) * 1000),
  };
}

async function request(url: string, headers: HeadersInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch {
    throw new GitHubError(
      'network',
      'GitHub API에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요.',
    );
  }

  if (response.ok) return response;

  if (response.status === 404) {
    throw new GitHubError('not-found', '해당 GitHub 사용자를 찾을 수 없습니다.', {
      status: 404,
    });
  }

  if (response.status === 401) {
    throw new GitHubError(
      'unauthorized',
      '토큰이 유효하지 않습니다. Personal access token을 확인해 주세요.',
      { status: 401 },
    );
  }

  if (response.status === 403 || response.status === 429) {
    const info = rateLimitFrom(response);
    if (response.headers.get('x-ratelimit-remaining') === '0') {
      throw new GitHubError(
        'rate-limit',
        'GitHub API 호출 한도를 모두 사용했습니다.',
        { resetAt: info?.resetAt ?? null, status: response.status },
      );
    }
    throw new GitHubError(
      'rate-limit',
      'GitHub이 요청을 잠시 제한했습니다. 잠시 후 다시 시도해 주세요.',
      { resetAt: info?.resetAt ?? null, status: response.status },
    );
  }

  throw new GitHubError('http', `GitHub API 오류 (${response.status})`, {
    status: response.status,
  });
}

function mapProfile(raw: RawProfile): Profile {
  return {
    login: raw.login,
    name: raw.name?.trim() || raw.login,
    avatarUrl: raw.avatar_url,
    bio: raw.bio,
    followers: raw.followers,
    following: raw.following,
    publicRepos: raw.public_repos,
    htmlUrl: raw.html_url,
  };
}

function mapRepo(raw: RawRepo): Repo {
  const cutoff = Date.now() - GHOST_AFTER_DAYS * 86_400_000;
  const pushedAt = raw.pushed_at ?? raw.updated_at;
  const isStale = Date.parse(pushedAt) < cutoff;
  const ghostReason: Repo['ghostReason'] = raw.archived
    ? 'archived'
    : isStale
      ? 'stale'
      : null;

  return {
    id: raw.id,
    name: raw.name,
    fullName: raw.full_name,
    description: raw.description,
    htmlUrl: raw.html_url,
    stars: raw.stargazers_count,
    forks: raw.forks_count,
    language: raw.language,
    topics: raw.topics ?? [],
    archived: raw.archived,
    fork: raw.fork,
    createdAt: raw.created_at,
    pushedAt,
    updatedAt: raw.updated_at,
    size: raw.size,
    isGhost: ghostReason !== null,
    ghostReason,
  };
}

export interface FetchOptions {
  token: string | null;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export async function fetchTown(username: string, options: FetchOptions): Promise<TownData> {
  const { token, onProgress, signal } = options;
  const user = username.trim().replace(/^@/, '');
  if (!user) {
    throw new GitHubError('empty', 'GitHub 사용자 이름을 입력해 주세요.');
  }

  const headers = authHeaders(token);
  const encoded = encodeURIComponent(user);
  onProgress?.('프로필을 불러오는 중…');

  const profileUrl = `${API}/users/${encoded}`;
  const reposUrl = (page: number) =>
    `${API}/users/${encoded}/repos?per_page=100&page=${page}&sort=updated&direction=desc`;

  const [profileResponse, firstResponse] = await Promise.all([
    request(profileUrl, headers),
    request(reposUrl(1), headers),
  ]);

  const [profileRaw, firstRepos] = (await Promise.all([
    profileResponse.json(),
    firstResponse.json(),
  ])) as [RawProfile, RawRepo[]];

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const rawRepos: RawRepo[] = [...firstRepos];
  const rateLimit = rateLimitFrom(firstResponse);

  if (firstRepos.length === 100) {
    for (let page = 2; page <= MAX_PAGES; page += 1) {
      onProgress?.(`리포지토리 ${rawRepos.length}개 불러오는 중…`);
      const response = await request(reposUrl(page), headers);
      const batch = (await response.json()) as RawRepo[];
      rawRepos.push(...batch);
      if (batch.length < 100) break;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    }
  }

  onProgress?.('도시를 짓는 중…');

  const allRepos = rawRepos
    .filter((repo) => !repo.fork)
    .map(mapRepo)
    .sort((a, b) => b.stars - a.stars || Date.parse(b.pushedAt) - Date.parse(a.pushedAt));

  const active = allRepos.filter((repo) => !repo.isGhost);
  const ghost = allRepos.filter((repo) => repo.isGhost);
  const archived = ghost.filter((repo) => repo.ghostReason === 'archived');
  const stale = ghost.filter((repo) => repo.ghostReason === 'stale');

  const keptActive = active.slice(0, MAX_ACTIVE);
  const keptGhost = ghost.slice(0, MAX_GHOST);
  const kept = new Set([...keptActive, ...keptGhost].map((repo) => repo.id));
  const repos = allRepos.filter((repo) => kept.has(repo.id));

  const stats: TownStats = {
    totalNonFork: allRepos.length,
    active: active.length,
    ghost: ghost.length,
    archived: archived.length,
    stale: stale.length,
    stars: allRepos.reduce((sum, repo) => sum + repo.stars, 0),
    hidden: allRepos.length - repos.length,
  };

  return {
    profile: mapProfile(profileRaw),
    repos,
    stats,
    rateLimit,
    fetchedAt: Date.now(),
  };
}

export interface LanguageStat {
  language: string;
  count: number;
  color: string;
  percent: number;
}

export function summarizeLanguages(repos: Repo[]): LanguageStat[] {
  const counts = new Map<string, number>();
  for (const repo of repos) {
    if (!repo.language) continue;
    counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0) || 1;
  return [...counts.entries()]
    .map(([language, count]) => ({
      language,
      count,
      color: languageColor(language),
      percent: (count / total) * 100,
    }))
    .sort((a, b) => b.count - a.count);
}
