/**
 * Tiny two-language dictionary. It is a leaf module on purpose: everything else
 * can import it without creating cycles.
 */

export type Locale = 'ko' | 'en';

const ko = {
  'app.title': 'GitHub Town — 리포지토리로 짓는 3D 도시',
  'app.description':
    'GitHub 사용자의 리포지토리를 3D 도시로 지어보세요. 오래된 리포지토리는 고스트 타운이 됩니다.',
  'brand.subtitle': '리포지토리로 짓는 도시',
  'search.aria': 'GitHub 사용자 이름',
  'search.build': '마을 짓기',
  'action.refresh': '새로고침',
  'lang.switch': 'Switch to English',
  'token.button': 'GitHub 토큰 설정',
  'token.buttonActive': 'GitHub 토큰 설정됨 — 클릭해서 변경',
  'panel.current': 'CURRENT TOWN',
  'panel.stageAria': '3D로 표현된 GitHub 마을',
  'panel.profileAria': '현재 마을 정보',
  'panel.legendAria': '범례',
  'panel.live': '라이브 데이터',
  'stats.repos': '리포지토리',
  'stats.stars': '별',
  'stats.active': '활성',
  'stats.ghost': '고스트',
  'stats.reposTitle': '포크를 제외한 리포지토리 {count}개',
  'stats.starsTitle': '스타 {count}개',
  'stats.activeTitle': '최근 {days}일 안에 푸시한 리포지토리 {count}개',
  'stats.ghostTitle': '잊힌 리포지토리 {count}개',
  'profile.avatarAlt': '{name}의 아바타',
  'bio.empty': '아직 소개가 없습니다.',
  'bio.placeholder': 'GitHub 사용자를 입력하면 리포지토리가 도시가 됩니다.',
  'lang.heading': '언어',
  'lang.note': '{count}개 언어',
  'lang.none': '언어 없음',
  'lang.other': '기타',
  'cut.note': '공간 제한으로 {count}개 리포지토리는 표시하지 않았습니다.',
  'legend.active': '활성 리포지토리',
  'legend.activeNote': '최근 {days}일 안에 푸시',
  'legend.ghost': '고스트 타운',
  'legend.ghostNote': '{days}일 넘게 잊힌 리포지토리',
  'legend.tomb': '묘비',
  'legend.tombNote': '아카이브된 리포지토리',
  'legend.height': '건물 높이 = 스타 수',
  'legend.color': '건물 색 = 주 언어',
  'hint.text':
    'WASD 이동 · Shift 달리기 · Space 점프 · 건물을 조준하고 클릭하면 GitHub로 이동 · Esc로 커서 해제',
  'hint.touch': '왼쪽 아래 스틱으로 이동 · 드래그로 둘러보기 · 건물을 탭하면 GitHub로 이동',
  'hint.start': '클릭해서 마을 걷기',
  'api.demo': '데모 데이터',
  'api.live': 'GitHub API · live',
  'api.remaining': 'GitHub API {remaining}/{limit}',
  'api.snapshot': '스냅샷 · {when}',
  'tooltip.open': 'GitHub에서 열기',
  'tooltip.noLanguage': '언어 없음',
  'tooltip.pushed': '{when} 푸시',
  'loading.title': '첫 마을을 짓는 중…',
  'loading.build': '마을을 짓는 중…',
  'progress.profile': '프로필을 불러오는 중…',
  'progress.repos': '리포지토리 {count}개 불러오는 중…',
  'progress.building': '도시를 짓는 중…',
  'error.retry': '다시 시도',
  'error.demo': '@jihoo12 마을 보기',
  'error.token': '토큰 추가',
  'error.notFoundTitle': '@{user}님을 찾을 수 없어요',
  'error.notFoundBody':
    'GitHub 사용자 이름의 철자를 확인해 주세요.\n비공개 프로필이거나 존재하지 않는 계정일 수 있습니다.',
  'error.rateTitle': 'GitHub API 한도에 걸렸어요',
  'error.resetSoon': '곧',
  'error.rateBody':
    '호출 한도를 모두 사용했습니다. {time}에 다시 채워집니다.\n토큰을 추가하면 시간당 5,000번까지 사용할 수 있어요.',
  'error.authTitle': '토큰을 확인해 주세요',
  'error.authBody':
    '저장된 토큰이 만료되었거나 권한이 없습니다.\n토큰을 다시 설정하거나 삭제한 뒤 시도해 주세요.',
  'error.networkTitle': 'GitHub에 연결하지 못했어요',
  'error.networkBody':
    '네트워크 연결을 확인한 뒤 다시 시도해 주세요.\n이 브라우저에서 api.github.com에 접근할 수 없을 수도 있습니다.',
  'error.emptyTitle': '사용자 이름이 필요해요',
  'error.emptyBody': 'github.com/ 뒤에 오는 사용자 이름을 입력해 주세요.',
  'error.httpTitle': '마을을 짓지 못했어요',
  'error.httpBody': 'GitHub API 오류 ({status})',
  'error.unknownTitle': '예상치 못한 문제가 생겼어요',
  'error.emptyTownTitle': '지을 마을이 없어요',
  'error.emptyTownBody':
    '포크를 제외한 공개 리포지토리가 없습니다.\n다른 사용자를 검색하거나 데모 타운을 둘러보세요.',
  'dialog.title': '호출 한도를 늘려보세요',
  'dialog.copy':
    '토큰 없이도 마을을 지을 수 있지만, GitHub API는 시간당 60번만 호출을 허용합니다. Personal access token을 넣으면 5,000번까지 늘어납니다.',
  'dialog.label': 'Personal access token',
  'dialog.placeholder': 'github_pat_… 또는 ghp_…',
  'dialog.fine':
    '토큰은 이 브라우저의 localStorage에만 저장되며, 서버로 전송되지 않습니다. 공개 리포지토리만 읽는다면 추가 권한은 필요 없습니다.',
  'dialog.clear': '토큰 삭제',
  'dialog.save': '저장하고 새로고침',
  'dialog.close': '닫기',
  'toast.tokenSaved': '토큰을 저장했어요. 새로고침합니다.',
  'toast.tokenRemoved': '토큰을 삭제했어요.',
  'toast.fallbackRate': 'API 한도를 다 써서 @{user} 대신 @{fallback}의 마을(매일 갱신)을 보여드려요.',
  'toast.fallbackNetwork': 'GitHub에 연결할 수 없어 @{user} 대신 @{fallback}의 마을(매일 갱신)을 보여드려요.',
  'rel.today': '오늘',
  'rel.yesterday': '어제',
  'rel.days': '{n}일 전',
  'rel.weeks': '{n}주 전',
  'rel.months': '{n}개월 전',
  'rel.year': '1년 전',
  'rel.years': '{n}년 전',
  'rel.unknown': '알 수 없음',
} as const;

export type MessageKey = keyof typeof ko;

const en: Record<MessageKey, string> = {
  'app.title': 'GitHub Town — turn repositories into a 3D city',
  'app.description':
    "Build a GitHub user's repositories into a 3D city. Neglected repositories drift into the ghost town.",
  'brand.subtitle': 'repositories as a city',
  'search.aria': 'GitHub username',
  'search.build': 'Build town',
  'action.refresh': 'Refresh',
  'lang.switch': '한국어로 보기',
  'token.button': 'GitHub token settings',
  'token.buttonActive': 'GitHub token set — click to change',
  'panel.current': 'CURRENT TOWN',
  'panel.stageAria': 'GitHub town rendered in 3D',
  'panel.profileAria': 'Current town',
  'panel.legendAria': 'Legend',
  'panel.live': 'Live data',
  'stats.repos': 'repos',
  'stats.stars': 'stars',
  'stats.active': 'active',
  'stats.ghost': 'ghost',
  'stats.reposTitle': '{count} non-fork repositories',
  'stats.starsTitle': '{count} stars',
  'stats.activeTitle': '{count} repositories pushed in the last {days} days',
  'stats.ghostTitle': '{count} abandoned repositories',
  'profile.avatarAlt': '{name} avatar',
  'bio.empty': 'No bio yet.',
  'bio.placeholder': 'Enter a GitHub username and their repositories become a city.',
  'lang.heading': 'Languages',
  'lang.note': '{count} languages',
  'lang.none': 'No language',
  'lang.other': 'Other',
  'cut.note': '{count} repositories are hidden to keep the town readable.',
  'legend.active': 'Active repositories',
  'legend.activeNote': 'Pushed within {days} days',
  'legend.ghost': 'Ghost town',
  'legend.ghostNote': 'No push for over {days} days',
  'legend.tomb': 'Tombstone',
  'legend.tombNote': 'Archived repositories',
  'legend.height': 'Height = stars',
  'legend.color': 'Color = main language',
  'hint.text':
    'WASD to walk · Shift to run · Space to jump · aim at a building and click to open GitHub · Esc releases the mouse',
  'hint.touch': 'Move with the stick · drag to look around · tap a building to open GitHub',
  'hint.start': 'Click to walk the town',
  'api.demo': 'Demo data',
  'api.live': 'GitHub API · live',
  'api.remaining': 'GitHub API {remaining}/{limit}',
  'api.snapshot': 'Snapshot · {when}',
  'tooltip.open': 'Open on GitHub',
  'tooltip.noLanguage': 'No language',
  'tooltip.pushed': 'pushed {when}',
  'loading.title': 'Building your first town…',
  'loading.build': 'Building the town…',
  'progress.profile': 'Loading profile…',
  'progress.repos': 'Loading repositories ({count})…',
  'progress.building': 'Building the town…',
  'error.retry': 'Try again',
  'error.demo': "See @jihoo12's town",
  'error.token': 'Add token',
  'error.notFoundTitle': 'Could not find @{user}',
  'error.notFoundBody':
    'Check the spelling of the GitHub username.\nThe profile may be private or may not exist.',
  'error.rateTitle': 'GitHub API limit reached',
  'error.resetSoon': 'soon',
  'error.rateBody':
    'The hourly quota is used up. It refills at {time}.\nAdd a token to get 5,000 calls per hour.',
  'error.authTitle': 'Check your token',
  'error.authBody':
    'The saved token is expired or lacks permission.\nSet a new token or remove it and try again.',
  'error.networkTitle': 'Could not reach GitHub',
  'error.networkBody':
    'Check your network connection and try again.\nThis browser may not be able to reach api.github.com.',
  'error.emptyTitle': 'A username is required',
  'error.emptyBody': 'Enter the username that follows github.com/.',
  'error.httpTitle': 'Could not build the town',
  'error.httpBody': 'GitHub API error ({status})',
  'error.unknownTitle': 'Something unexpected happened',
  'error.emptyTownTitle': 'Nothing to build',
  'error.emptyTownBody':
    'There are no public non-fork repositories.\nTry another user or look around the demo town.',
  'dialog.title': 'Raise your rate limit',
  'dialog.copy':
    'You can build a town without a token, but GitHub only allows 60 API calls per hour. A personal access token raises that to 5,000.',
  'dialog.label': 'Personal access token',
  'dialog.placeholder': 'github_pat_… or ghp_…',
  'dialog.fine':
    "The token is stored only in this browser's localStorage and never sent to any server. Reading public repositories needs no extra scopes.",
  'dialog.clear': 'Remove token',
  'dialog.save': 'Save and reload',
  'dialog.close': 'Close',
  'toast.tokenSaved': 'Token saved. Reloading.',
  'toast.tokenRemoved': 'Token removed.',
  'toast.fallbackRate': "API limit reached, so here is @{fallback}'s town (updated daily) instead of @{user}.",
  'toast.fallbackNetwork': "Could not reach GitHub, so here is @{fallback}'s town (updated daily) instead of @{user}.",
  'rel.today': 'today',
  'rel.yesterday': 'yesterday',
  'rel.days': '{n}d ago',
  'rel.weeks': '{n}w ago',
  'rel.months': '{n}mo ago',
  'rel.year': '1y ago',
  'rel.years': '{n}y ago',
  'rel.unknown': 'unknown',
};

const dictionaries: Record<Locale, Record<MessageKey, string>> = { ko, en };

const STORAGE_KEY = 'github-town:lang';

let locale: Locale = 'ko';

export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'ko' || value === 'en';
}

export function detectLocale(search = window.location.search): Locale {
  const fromUrl = new URLSearchParams(search).get('lang');
  if (isLocale(fromUrl)) return fromUrl;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage can be unavailable; fall through to the browser language.
  }
  return (navigator.language ?? '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale): void {
  locale = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore storage failures.
  }
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template = dictionaries[locale][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Fill every element carrying a `data-i18n*` attribute and the document head. */
export function applyStaticTranslations(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n;
    if (key) node.textContent = t(key as MessageKey);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((node) => {
    const key = node.dataset.i18nPlaceholder;
    if (key) node.placeholder = t(key as MessageKey);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((node) => {
    const key = node.dataset.i18nTitle;
    if (key) node.title = t(key as MessageKey);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((node) => {
    const key = node.dataset.i18nAria;
    if (key) node.setAttribute('aria-label', t(key as MessageKey));
  });
  document.title = t('app.title');
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', t('app.description'));
}
