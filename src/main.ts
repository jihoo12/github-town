import './style.css';
import { fetchTown, GitHubError, type TownData } from './github';
import { DEMO_TOWN } from './demo';
import { detectLocale, getLocale, setLocale, t, type Locale } from './i18n';
import { buildTown, computeLayout } from './town';
import { TownWorld } from './world';
import * as ui from './ui';

const TOKEN_KEY = 'github-town:token';
const USER_KEY = 'github-town:user';
const CACHE_PREFIX = 'github-town:cache:';
const CACHE_TTL = 10 * 60 * 1000;
/** Shown by default, and the town to fall back to when the GitHub API is out of reach. */
const DEFAULT_USER = 'jihoo12';

const world = new TownWorld(ui.els.stage);

let currentUser = '';
let currentData: TownData | null = null;
let lastErrorView: (() => void) | null = null;
let controller: AbortController | null = null;
/** The user whose town we left to visit one of their organizations. */
let returnTo: string | null = null;

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

world.onHoverOrg = (info) => {
  if (info) {
    ui.showOrgTooltip(info.org, info.clientX, info.clientY);
  } else {
    ui.hideTooltip();
  }
};

world.onSelectOrg = (org) => visitOrg(org.login);

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
    ? t('token.buttonActive')
    : t('token.button');
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

/**
 * Towns pre-fetched by the deploy workflow (dist/snapshots/<user>.json).
 * Missing for most users, and absent in dev; any failure just returns null.
 */
async function readSnapshot(user: string, signal: AbortSignal): Promise<TownData | null> {
  try {
    const response = await fetch(`./snapshots/${encodeURIComponent(user.toLowerCase())}.json`, {
      signal,
      cache: 'no-cache',
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return null;
    const data = (await response.json()) as TownData;
    return data?.profile?.login && Array.isArray(data.repos) ? data : null;
  } catch {
    return null;
  }
}

function normalizeUser(input: string): string {
  let value = input.trim().replace(/^@+/, '');
  const fromUrl = value.match(/github\.com\/([^/?#\s]+)/i);
  if (fromUrl?.[1]) value = fromUrl[1];
  return value.replace(/[?#].*$/, '').replace(/\/+$/, '').trim();
}

function urlFor(user: string): string {
  const params = new URLSearchParams({ user });
  if (getLocale() !== 'ko') params.set('lang', getLocale());
  return `${window.location.pathname}?${params.toString()}`;
}

function syncUrl(user: string): void {
  try {
    // Keep the entry's state (the org visit's return target) intact.
    window.history.replaceState(window.history.state, '', urlFor(user));
  } catch {
    // Ignore URL update failures.
  }
}

/** Load another town as a new history entry, so the browser's back button returns. */
function navigateTo(user: string): void {
  try {
    // Remember where "← back" leads, so it survives back/forward navigation too.
    window.history.pushState({ returnTo }, '', urlFor(user));
  } catch {
    // Ignore URL update failures.
  }
  void loadTown(user);
}

function visitOrg(login: string): void {
  if (currentData && !currentData.profile.isOrg) returnTo = currentData.profile.login;
  navigateTo(login);
}

/** Going back to the user is a fresh visit to their town, with nothing to return to. */
function returnToUser(user: string): void {
  returnTo = null;
  navigateTo(user);
}

function updateBackTarget(): void {
  const login = currentData?.profile.login.toLowerCase();
  const showBack =
    Boolean(currentData?.profile.isOrg) && returnTo !== null && returnTo.toLowerCase() !== login;
  ui.setBackTarget(showBack ? returnTo : null);
}

function formatResetTime(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return t('error.resetSoon');
  return new Intl.DateTimeFormat(getLocale() === 'ko' ? 'ko-KR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function showEmptyTownError(): void {
  ui.showError({
    title: t('error.emptyTownTitle'),
    message: t('error.emptyTownBody'),
    showRetry: true,
    showDemo: true,
    showToken: false,
  });
}

function applyTown(data: TownData): void {
  currentData = data;
  currentUser = data.profile.login;
  lastErrorView = null;

  ui.hideError();
  ui.hideTooltip();
  ui.renderTown(data);
  if (!data.profile.isOrg) returnTo = null;
  updateBackTarget();
  ui.setSearchValue(data.profile.login);
  ui.hideLoading();

  const layout = computeLayout(data.repos);
  if (layout.placed.length === 0) {
    lastErrorView = showEmptyTownError;
    showEmptyTownError();
    return;
  }

  const town = buildTown(layout, data, world.maxAnisotropy);
  world.setTown(town);

  storageSet(USER_KEY, data.profile.login);
  document.title = `@${data.profile.login} · GitHub Town`;
  syncUrl(data.profile.login);
}

function showFailure(error: unknown, username: string): void {
  ui.hideLoading();
  ui.hideTooltip();

  if (error instanceof GitHubError) {
    switch (error.code) {
      case 'not-found':
        ui.showError({
          title: t('error.notFoundTitle', { user: username }),
          message: t('error.notFoundBody'),
          showRetry: true,
          showDemo: true,
          showToken: false,
        });
        return;
      case 'rate-limit':
        ui.showError({
          title: t('error.rateTitle'),
          message: t('error.rateBody', { time: formatResetTime(error.resetAt) }),
          showRetry: true,
          showDemo: true,
          showToken: true,
        });
        return;
      case 'unauthorized':
        ui.showError({
          title: t('error.authTitle'),
          message: t('error.authBody'),
          showRetry: true,
          showDemo: true,
          showToken: true,
        });
        return;
      case 'network':
        ui.showError({
          title: t('error.networkTitle'),
          message: t('error.networkBody'),
          showRetry: true,
          showDemo: true,
          showToken: false,
        });
        return;
      case 'empty':
        ui.showError({
          title: t('error.emptyTitle'),
          message: t('error.emptyBody'),
          showRetry: false,
          showDemo: true,
          showToken: false,
        });
        return;
      default:
        ui.showError({
          title: t('error.httpTitle'),
          message: t('error.httpBody', { status: error.status ?? '—' }),
          showRetry: true,
          showDemo: true,
          showToken: false,
        });
        return;
    }
  }

  ui.showError({
    title: t('error.unknownTitle'),
    message: error instanceof Error ? error.message : String(error),
    showRetry: true,
    showDemo: true,
    showToken: false,
  });
}

function handleError(error: unknown, username: string): void {
  lastErrorView = () => showFailure(error, username);
  showFailure(error, username);
}

function showMissingUsername(): void {
  lastErrorView = () => showFailure(new GitHubError('empty', ''), '');
  lastErrorView();
}

async function loadTown(rawUser: string, options: { force?: boolean } = {}): Promise<void> {
  const user = normalizeUser(rawUser);
  if (!user) {
    showMissingUsername();
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
  ui.showLoading(t('loading.build'), `github.com/${user}`);

  // A first visit (no forced refresh) prefers the build-time snapshot when one exists.
  if (!options.force) {
    const snapshot = await readSnapshot(user, localController.signal);
    if (localController.signal.aborted) return;
    if (snapshot) {
      if (controller === localController) controller = null;
      ui.els.buildButton.disabled = false;
      applyTown(snapshot);
      return;
    }
  }

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
    // Rate limited or offline: fall back to the snapshot if this user has one.
    const snapshot = await readSnapshot(user, localController.signal);
    if (snapshot && !localController.signal.aborted) {
      applyTown(snapshot);
      return;
    }
    // Out of API quota (or api.github.com unreachable) for someone else:
    // show the daily jihoo12 snapshot rather than an empty error screen.
    const outOfReach =
      error instanceof GitHubError && (error.code === 'rate-limit' || error.code === 'network');
    if (outOfReach && user.toLowerCase() !== DEFAULT_USER) {
      const fallback = await readSnapshot(DEFAULT_USER, localController.signal);
      if (fallback && !localController.signal.aborted) {
        applyTown(fallback);
        ui.toast(
          t(error.code === 'rate-limit' ? 'toast.fallbackRate' : 'toast.fallbackNetwork', {
            user,
            fallback: DEFAULT_USER,
          }),
          6500,
        );
        return;
      }
    }
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
  const target = currentUser || normalizeUser(ui.els.userInput.value) || DEFAULT_USER;
  if (target === 'demo') {
    void loadTown('demo', { force: true });
    return;
  }
  void loadTown(target, { force: true });
}

/** Switch language without refetching: re-render every dynamic label in place. */
function applyLocale(locale: Locale): void {
  setLocale(locale);
  ui.applyLocaleText();
  updateTokenButton();

  if (currentData) {
    ui.renderTown(currentData);
    updateBackTarget();
    document.title = `@${currentData.profile.login} · GitHub Town`;
    syncUrl(currentData.profile.login);
  }
  lastErrorView?.();
}

ui.els.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  returnTo = null;
  const value = ui.els.userInput.value;
  if (!normalizeUser(value)) {
    ui.els.userInput.focus();
    return;
  }
  void loadTown(value, { force: true });
});

ui.els.refreshButton.addEventListener('click', () => reloadCurrent());

ui.els.orgList.addEventListener('click', (event) => {
  const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-org]');
  if (chip?.dataset.org) visitOrg(chip.dataset.org);
});

ui.els.backButton.addEventListener('click', () => {
  const user = ui.els.backButton.dataset.user;
  if (user) returnToUser(user);
});

window.addEventListener('popstate', (event) => {
  const state = event.state as { returnTo?: string | null } | null;
  returnTo = state?.returnTo ?? null;
  const user = normalizeUser(new URLSearchParams(window.location.search).get('user') ?? '');
  if (user && user.toLowerCase() !== currentUser.toLowerCase()) void loadTown(user);
});
ui.els.tokenButton.addEventListener('click', openTokenDialog);
ui.els.errorTokenButton.addEventListener('click', openTokenDialog);
ui.els.langButton.addEventListener('click', () => {
  applyLocale(getLocale() === 'ko' ? 'en' : 'ko');
});

ui.els.retryButton.addEventListener('click', () => {
  const target = currentUser || ui.els.userInput.value || DEFAULT_USER;
  void loadTown(target, { force: true });
});

/** The error card's fallback: jihoo12's daily snapshot, or the demo town if there is none (e.g. dev). */
ui.els.demoButton.addEventListener('click', async () => {
  const snapshot = await readSnapshot(DEFAULT_USER, new AbortController().signal);
  if (snapshot) {
    applyTown(snapshot);
  } else {
    void loadTown('demo', { force: true });
  }
});

ui.els.tokenForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const token = ui.els.tokenInput.value.trim();
  if (token) {
    storageSet(TOKEN_KEY, token);
    ui.toast(t('toast.tokenSaved'));
  } else {
    storageRemove(TOKEN_KEY);
    ui.toast(t('toast.tokenRemoved'));
  }
  updateTokenButton();
  ui.closeTokenDialog();
  reloadCurrent();
});

ui.els.tokenClear.addEventListener('click', () => {
  storageRemove(TOKEN_KEY);
  updateTokenButton();
  ui.closeTokenDialog();
  ui.toast(t('toast.tokenRemoved'));
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
    if (document.pointerLockElement) document.exitPointerLock();
    ui.els.userInput.focus();
    ui.els.userInput.select();
  }
});

setLocale(detectLocale());
ui.applyLocaleText();
updateTokenButton();

const params = new URLSearchParams(window.location.search);
const initialUser =
  normalizeUser(params.get('user') ?? '') ||
  normalizeUser(storageGet(USER_KEY) ?? '') ||
  DEFAULT_USER;

ui.setSearchValue(initialUser);
void loadTown(initialUser);
