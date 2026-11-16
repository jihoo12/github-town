import './style.css';
import { fetchTown, GitHubError, type TownData } from './github';
import { DEMO_TOWN } from './demo';
import { buildTown, computeLayout } from './town';
import { TownWorld } from './world';
import * as ui from './ui';

const TOKEN_KEY = 'github-town:token';
const USER_KEY = 'github-town:user';
const CACHE_PREFIX = 'github-town:cache:';
const CACHE_TTL = 10 * 60 * 1000;

const world = new TownWorld(ui.els.stage);

let currentUser = '';
let controller: AbortController | null = null;

world.onHover = (info) => {
  if (info) {
    ui.showTooltip(info.repo, info.clientX, info.clientY);
  } else {
    ui.hideTooltip();
  }
};

world.onSelect = (repo) => {
  window.open(repo.htmlUrl, '_blank', 'noopener,noreferrer');
};

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, quota). The town still works.
  }
}

function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

function getToken(): string {
  return storageGet(TOKEN_KEY) ?? '';
}

function updateTokenButton(): void {
  ui.els.tokenButton.classList.toggle('has-token', Boolean(getToken()));
  ui.els.tokenButton.title = getToken()
    ? 'GitHub 토큰 설정됨 — 클릭해서 변경'
    : 'GitHub 토큰 설정';
}

function cacheKey(user: string): string {
  return `${CACHE_PREFIX}${user.toLowerCase()}`;
}

function readCache(user: string): TownData | null {
  const raw = storageGet(cacheKey(user));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { at: number; data: TownData };
    if (!parsed.at || Date.now() - parsed.at > CACHE_TTL) {
      storageRemove(cacheKey(user));
      return null;
    }
    const data = parsed.data;
    if (data.rateLimit && typeof data.rateLimit.resetAt === 'string') {
      data.rateLimit.resetAt = new Date(data.rateLimit.resetAt);
    }
    return data;
  } catch {
    storageRemove(cacheKey(user));
    return null;
  }
}

function writeCache(data: TownData): void {
  try {
    storageSet(
      cacheKey(data.profile.login),
      JSON.stringify({ at: Date.now(), data }),
    );
  } catch {
    // Quota exceeded — ignore.
  }
}

function normalizeUser(input: string): string {
  let value = input.trim().replace(/^@+/, '');
  const fromUrl = value.match(/github\.com\/([^/?#\s]+)/i);
  if (fromUrl?.[1]) value = fromUrl[1];
  return value.replace(/[?#].*$/, '').replace(/\/+$/, '').trim();
}

function formatResetTime(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return '잠시 후';
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function applyTown(data: TownData): void {
  currentUser = data.profile.login;

  ui.hideError();
  ui.hideTooltip();
  ui.renderTown(data);
  ui.setSearchValue(data.profile.login);
  ui.hideLoading();

  const layout = computeLayout(data.repos);
  if (layout.placed.length === 0) {
    ui.showError({
      title: '지을 마을이 없어요',
      message:
        '포크를 제외한 공개 리포지토리가 없습니다.\n다른 사용자를 검색하거나 데모 타운을 둘러보세요.',
      showRetry: true,
      showDemo: true,
      showToken: false,
    });
    return;
  }

  const town = buildTown(layout, data, world.maxAnisotropy);
  world.setTown(town);

  storageSet(USER_KEY, data.profile.login);
  document.title = `@${data.profile.login} · GitHub Town`;
  const url = `${window.location.pathname}?user=${encodeURIComponent(data.profile.login)}`;
  try {
    window.history.replaceState(null, '', url);
  } catch {
    // Ignore URL update failures.
  }
}

function handleError(error: unknown, username: string): void {
  ui.hideLoading();
  ui.hideTooltip();

  if (error instanceof GitHubError) {
    switch (error.code) {
      case 'not-found':
        ui.showError({
          title: `@${username}님을 찾을 수 없어요`,
          message:
            'GitHub 사용자 이름의 철자를 확인해 주세요.\n비공개 프로필이거나 존재하지 않는 계정일 수 있습니다.',
          showRetry: true,
          showDemo: true,
          showToken: false,
        });
        return;
      case 'rate-limit':
        ui.showError({
          title: 'GitHub API 한도에 걸렸어요',
          message: `호출 한도를 모두 사용했습니다. ${formatResetTime(error.resetAt)}에 다시 채워집니다.\n토큰을 추가하면 시간당 5,000번까지 사용할 수 있어요.`,
          showRetry: true,
          showDemo: true,
          showToken: true,
        });
        return;
      case 'unauthorized':
        ui.showError({
          title: '토큰을 확인해 주세요',
          message:
            '저장된 토큰이 만료되었거나 권한이 없습니다.\n토큰을 다시 설정하거나 삭제한 뒤 시도해 주세요.',
          showRetry: true,
          showDemo: true,
          showToken: true,
        });
        return;
      case 'network':
        ui.showError({
          title: 'GitHub에 연결하지 못했어요',
          message:
            '네트워크 연결을 확인한 뒤 다시 시도해 주세요.\n이 브라우저에서 api.github.com에 접근할 수 없을 수도 있습니다.',
          showRetry: true,
          showDemo: true,
          showToken: false,
        });
        return;
      case 'empty':
        ui.showError({
          title: '사용자 이름이 필요해요',
          message: 'github.com/ 뒤에 오는 사용자 이름을 입력해 주세요.',
          showRetry: false,
          showDemo: true,
          showToken: false,
        });
        return;
      default:
        ui.showError({
          title: '마을을 짓지 못했어요',
          message: error.message,
          showRetry: true,
          showDemo: true,
          showToken: false,
        });
        return;
    }
  }

  ui.showError({
    title: '예상치 못한 문제가 생겼어요',
    message: error instanceof Error ? error.message : String(error),
    showRetry: true,
    showDemo: true,
    showToken: false,
  });
}

async function loadTown(rawUser: string, options: { force?: boolean } = {}): Promise<void> {
  const user = normalizeUser(rawUser);
  if (!user) {
    ui.showError({
      title: '사용자 이름이 필요해요',
      message: 'github.com/ 뒤에 오는 사용자 이름을 입력해 주세요.',
      showRetry: false,
      showDemo: true,
      showToken: false,
    });
    return;
  }

  ui.setSearchValue(user);

  if (user.toLowerCase() === 'demo') {
    applyTown(DEMO_TOWN);
    return;
  }

  if (!options.force) {
    const cached = readCache(user);
    if (cached) {
      applyTown(cached);
      return;
    }
  }

  controller?.abort();
  const localController = new AbortController();
  controller = localController;

  ui.hideError();
  ui.showLoading('마을을 짓는 중…', `github.com/${user}`);

  try {
    const data = await fetchTown(user, {
      token: getToken() || null,
      signal: localController.signal,
      onProgress: (message) => ui.setLoadingSubtitle(message),
    });
    if (localController.signal.aborted) return;
    writeCache(data);
    applyTown(data);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    handleError(error, user);
  } finally {
    if (controller === localController) controller = null;
    ui.els.buildButton.disabled = false;
  }
}

function openTokenDialog(): void {
  ui.openTokenDialog(getToken());
}

function reloadCurrent(): void {
  const target = currentUser || normalizeUser(ui.els.userInput.value) || 'jihoo12';
  if (target === 'demo') {
    void loadTown('demo', { force: true });
    return;
  }
  void loadTown(target, { force: true });
}

ui.els.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = ui.els.userInput.value;
  if (!normalizeUser(value)) {
    ui.els.userInput.focus();
    return;
  }
  void loadTown(value, { force: true });
});

ui.els.refreshButton.addEventListener('click', () => reloadCurrent());
ui.els.tokenButton.addEventListener('click', openTokenDialog);
ui.els.errorTokenButton.addEventListener('click', openTokenDialog);

ui.els.retryButton.addEventListener('click', () => {
  const target = currentUser || ui.els.userInput.value || 'jihoo12';
  void loadTown(target, { force: true });
});

ui.els.demoButton.addEventListener('click', () => {
  void loadTown('demo', { force: true });
});

ui.els.tokenForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const token = ui.els.tokenInput.value.trim();
  if (token) {
    storageSet(TOKEN_KEY, token);
    ui.toast('토큰을 저장했어요. 새로고침합니다.');
  } else {
    storageRemove(TOKEN_KEY);
    ui.toast('토큰을 삭제했어요.');
  }
  updateTokenButton();
  ui.closeTokenDialog();
  reloadCurrent();
});

ui.els.tokenClear.addEventListener('click', () => {
  storageRemove(TOKEN_KEY);
  updateTokenButton();
  ui.closeTokenDialog();
  ui.toast('토큰을 삭제했어요.');
  reloadCurrent();
});

ui.els.tokenClose.addEventListener('click', () => {
  ui.closeTokenDialog();
});

ui.els.tokenDialog.addEventListener('click', (event) => {
  if (event.target === ui.els.tokenDialog) ui.closeTokenDialog();
});

window.addEventListener('keydown', (event) => {
  const active = document.activeElement;
  const typing =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.isContentEditable);
  if (event.key === '/' && !typing) {
    event.preventDefault();
    ui.els.userInput.focus();
    ui.els.userInput.select();
  }
});

updateTokenButton();

const params = new URLSearchParams(window.location.search);
const initialUser =
  normalizeUser(params.get('user') ?? '') ||
  normalizeUser(storageGet(USER_KEY) ?? '') ||
  'jihoo12';

ui.setSearchValue(initialUser);
void loadTown(initialUser);
