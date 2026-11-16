import type { Repo, TownData } from './github';
import { GHOST_AFTER_DAYS, summarizeLanguages } from './github';
import { applyStaticTranslations, getLocale, t } from './i18n';
import { formatCompact, formatCount, formatDate, languageColor, relativeTime } from './theme';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

export const els = {
  stage: element<HTMLDivElement>('stage'),
  searchForm: element<HTMLFormElement>('searchForm'),
  userInput: element<HTMLInputElement>('userInput'),
  buildButton: element<HTMLButtonElement>('buildButton'),
  refreshButton: element<HTMLButtonElement>('refreshButton'),
  tokenButton: element<HTMLButtonElement>('tokenButton'),
  langButton: element<HTMLButtonElement>('langButton'),

  avatar: element<HTMLImageElement>('avatar'),
  displayName: element<HTMLElement>('displayName'),
  profileLink: element<HTMLAnchorElement>('profileLink'),
  bio: element<HTMLElement>('bio'),
  statRepos: element<HTMLElement>('statRepos'),
  statStars: element<HTMLElement>('statStars'),
  statActive: element<HTMLElement>('statActive'),
  statGhost: element<HTMLElement>('statGhost'),
  langBar: element<HTMLElement>('langBar'),
  langList: element<HTMLUListElement>('langList'),
  langNote: element<HTMLElement>('langNote'),
  cutNote: element<HTMLElement>('cutNote'),

  apiStatus: element<HTMLElement>('apiStatus'),
  apiStatusText: element<HTMLElement>('apiStatusText'),
  hint: element<HTMLElement>('hint'),

  tooltip: element<HTMLElement>('tooltip'),
  ttName: element<HTMLElement>('ttName'),
  ttBadge: element<HTMLElement>('ttBadge'),
  ttDesc: element<HTMLElement>('ttDesc'),
  ttStars: element<HTMLElement>('ttStars'),
  ttLang: element<HTMLElement>('ttLang'),
  ttPushed: element<HTMLElement>('ttPushed'),

  loading: element<HTMLElement>('loading'),
  loadingTitle: element<HTMLElement>('loadingTitle'),
  loadingSub: element<HTMLElement>('loadingSub'),

  errorCard: element<HTMLElement>('errorCard'),
  errorTitle: element<HTMLElement>('errorTitle'),
  errorMessage: element<HTMLElement>('errorMessage'),
  retryButton: element<HTMLButtonElement>('retryButton'),
  demoButton: element<HTMLButtonElement>('demoButton'),
  errorTokenButton: element<HTMLButtonElement>('errorTokenButton'),

  tokenDialog: element<HTMLDialogElement>('tokenDialog'),
  tokenForm: element<HTMLFormElement>('tokenForm'),
  tokenInput: element<HTMLInputElement>('tokenInput'),
  tokenClose: element<HTMLButtonElement>('tokenClose'),
  tokenClear: element<HTMLButtonElement>('tokenClear'),

  toast: element<HTMLElement>('toast'),
};

let loadingTimer: number | null = null;
let toastTimer: number | null = null;

export function setSearchValue(value: string): void {
  els.userInput.value = value;
}

/** Re-apply every static label after a locale change. */
export function applyLocaleText(): void {
  applyStaticTranslations();
  renderGhostCutoff();
  updateLangButton();
}

export function updateLangButton(): void {
  const next = getLocale() === 'ko' ? 'en' : 'ko';
  els.langButton.textContent = next.toUpperCase();
  els.langButton.title = t('lang.switch');
  els.langButton.setAttribute('aria-label', t('lang.switch'));
}

function renderGhostCutoff(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-ghost-cutoff]')) {
    const key = node.dataset.ghostCutoff === 'ghost' ? 'legend.ghostNote' : 'legend.activeNote';
    node.textContent = t(key, { days: GHOST_AFTER_DAYS });
  }
}

export function showLoading(title: string, subtitle: string): void {
  if (loadingTimer !== null) {
    window.clearTimeout(loadingTimer);
    loadingTimer = null;
  }
  els.loading.hidden = false;
  els.loading.classList.remove('fade-out');
  els.loadingTitle.textContent = title;
  els.loadingSub.textContent = subtitle;
  els.buildButton.disabled = true;
}

export function setLoadingSubtitle(text: string): void {
  els.loadingSub.textContent = text;
}

export function hideLoading(): void {
  els.buildButton.disabled = false;
  if (els.loading.hidden) return;
  els.loading.classList.add('fade-out');
  loadingTimer = window.setTimeout(() => {
    els.loading.hidden = true;
    els.loading.classList.remove('fade-out');
    loadingTimer = null;
  }, 460);
}

export interface ErrorOptions {
  title: string;
  message: string;
  showRetry?: boolean;
  showDemo?: boolean;
  showToken?: boolean;
}

export function showError(options: ErrorOptions): void {
  els.errorCard.hidden = false;
  els.errorTitle.textContent = options.title;
  els.errorMessage.textContent = options.message;
  els.retryButton.hidden = options.showRetry === false;
  els.demoButton.hidden = options.showDemo === false;
  els.errorTokenButton.hidden = options.showToken === false;
}

export function hideError(): void {
  els.errorCard.hidden = true;
}

export function renderTown(data: TownData): void {
  const { profile, stats } = data;

  renderGhostCutoff();

  els.avatar.style.visibility = '';
  els.avatar.src = profile.avatarUrl;
  els.avatar.alt = t('profile.avatarAlt', { name: profile.name });
  els.avatar.onerror = () => {
    els.avatar.onerror = null;
    els.avatar.style.visibility = 'hidden';
  };

  els.displayName.textContent = profile.name || profile.login;
  els.profileLink.textContent = `@${profile.login}`;
  els.profileLink.href = profile.htmlUrl;
  els.bio.textContent = profile.bio?.trim() || t('bio.empty');

  els.statRepos.textContent = formatCount(stats.totalNonFork);
  els.statRepos.title = t('stats.reposTitle', { count: formatCount(stats.totalNonFork) });
  els.statStars.textContent = formatCompact(stats.stars);
  els.statStars.title = t('stats.starsTitle', { count: formatCount(stats.stars) });
  els.statActive.textContent = formatCount(stats.active);
  els.statActive.title = t('stats.activeTitle', {
    count: formatCount(stats.active),
    days: GHOST_AFTER_DAYS,
  });
  els.statGhost.textContent = formatCount(stats.ghost);
  els.statGhost.title = t('stats.ghostTitle', { count: formatCount(stats.ghost) });

  const languages = summarizeLanguages(data.repos).filter(
    (stat) => stat.language !== null,
  );
  const top = languages.slice(0, 5);
  const rest = languages.slice(5);
  const restCount = rest.reduce((sum, stat) => sum + stat.count, 0);
  const restPercent = rest.reduce((sum, stat) => sum + stat.percent, 0);

  els.langBar.replaceChildren();
  for (const stat of top) {
    const segment = document.createElement('span');
    segment.style.width = `${Math.max(stat.percent, 1.6)}%`;
    segment.style.backgroundColor = stat.color;
    segment.title = `${stat.language} · ${formatCount(stat.count)}`;
    els.langBar.append(segment);
  }
  if (restCount > 0) {
    const segment = document.createElement('span');
    segment.style.width = `${Math.max(restPercent, 1.6)}%`;
    segment.style.backgroundColor = '#4f4a5e';
    segment.title = `${t('lang.other')} · ${formatCount(restCount)}`;
    els.langBar.append(segment);
  }

  els.langList.replaceChildren();
  for (const stat of top) {
    const item = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.backgroundColor = stat.color;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = stat.language;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = formatCount(stat.count);
    item.append(dot, name, count);
    els.langList.append(item);
  }
  if (rest.length > 0) {
    const item = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.backgroundColor = '#4f4a5e';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = t('lang.other');
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = formatCount(restCount);
    item.append(dot, name, count);
    els.langList.append(item);
  }

  els.langNote.textContent = languages.length
    ? t('lang.note', { count: languages.length })
    : t('lang.none');

  if (stats.hidden > 0) {
    els.cutNote.hidden = false;
    els.cutNote.textContent = t('cut.note', { count: formatCount(stats.hidden) });
  } else {
    els.cutNote.hidden = true;
  }

  els.apiStatus.classList.remove('warning', 'demo');
  if (data.profile.login === 'demo') {
    els.apiStatus.classList.add('demo');
    els.apiStatusText.textContent = t('api.demo');
  } else if (data.snapshot) {
    els.apiStatusText.textContent = t('api.snapshot', {
      when: relativeTime(new Date(data.fetchedAt).toISOString()),
    });
  } else if (data.rateLimit) {
    const { remaining, limit } = data.rateLimit;
    els.apiStatusText.textContent = t('api.remaining', { remaining, limit });
    if (remaining < 10) els.apiStatus.classList.add('warning');
  } else {
    els.apiStatusText.textContent = t('api.live');
  }
}

export function showTooltip(repo: Repo, clientX: number, clientY: number): void {
  const accent = languageColor(repo.language);
  els.tooltip.style.setProperty('--accent', accent);
  els.ttName.textContent = repo.name;

  els.ttBadge.className = 'tooltip-badge';
  if (repo.archived) {
    els.ttBadge.textContent = 'ARCHIVED';
    els.ttBadge.classList.add('archived');
  } else if (repo.isGhost) {
    els.ttBadge.textContent = 'GHOST';
    els.ttBadge.classList.add('ghost');
  } else {
    els.ttBadge.textContent = 'ACTIVE';
  }

  els.ttDesc.textContent = repo.description?.trim() ?? '';
  els.ttStars.textContent = `★ ${formatCount(repo.stars)}`;
  els.ttStars.className = 'stars';
  els.ttLang.textContent = repo.language ?? t('tooltip.noLanguage');
  els.ttPushed.textContent = t('tooltip.pushed', { when: relativeTime(repo.pushedAt) });
  els.ttPushed.title = formatDate(repo.pushedAt);

  els.tooltip.classList.add('visible');
  els.tooltip.setAttribute('aria-hidden', 'false');

  const rect = els.tooltip.getBoundingClientRect();
  const margin = 14;
  let left = clientX + 18;
  let top = clientY + 18;
  if (left + rect.width > window.innerWidth - margin) {
    left = clientX - rect.width - 18;
  }
  if (top + rect.height > window.innerHeight - margin) {
    top = clientY - rect.height - 18;
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));

  els.tooltip.style.left = `${left}px`;
  els.tooltip.style.top = `${top}px`;
}

export function hideTooltip(): void {
  els.tooltip.classList.remove('visible');
  els.tooltip.setAttribute('aria-hidden', 'true');
}

export function openTokenDialog(token: string): void {
  els.tokenInput.value = token;
  if (!els.tokenDialog.open) els.tokenDialog.showModal();
  window.setTimeout(() => els.tokenInput.focus(), 60);
}

export function closeTokenDialog(): void {
  if (els.tokenDialog.open) els.tokenDialog.close();
}

export function toast(message: string, duration = 3200): void {
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove('visible');
    toastTimer = null;
  }, duration);
}
