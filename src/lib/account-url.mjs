// Разбор того, что пользователь вводит в поле «аккаунт»: ссылку, @ник или ник.
// Возвращает платформу и нормализованный handle либо понятную ошибку.

const HOSTS = [
  { platform: 'instagram', hosts: ['instagram.com', 'www.instagram.com', 'instagr.am'] },
  { platform: 'youtube', hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'] },
  { platform: 'tiktok', hosts: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com'] },
];

const RESERVED_YOUTUBE_PATHS = new Set([
  'watch', 'shorts', 'playlist', 'results', 'feed', 'channel', 'user', 'c', 'about',
  'premium', 'gaming', 'music', 'trending', 'hashtag', 'embed', 'live',
]);

export class AccountParseError extends Error {
  constructor(message, code = 'invalid_account') {
    super(message);
    this.name = 'AccountParseError';
    this.code = code;
  }
}

function decodeSegment(value) {
  // URL.pathname отдаёт проценты вместо не-ASCII: @ТихийВлог → %D0%A2...
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // битая последовательность — оставляем как есть, её отклонит проверка
  }
}

function cleanHandle(value) {
  let handle = decodeSegment(String(value || '')).trim().replace(/^@+/, '').replace(/\/+$/, '');
  if (!handle) return '';
  // YouTube хранит в путях /@handle, а ID канала могут начинаться с UC...
  return handle;
}

export function detectPlatform(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const entry of HOSTS) {
    if (entry.hosts.some((host) => lower.includes(host))) return entry.platform;
  }
  return null;
}

function parseUrl(raw) {
  const value = raw.startsWith('http') ? raw : `https://${raw.replace(/^\/+/, '')}`;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function fromInstagram(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  if (!segments.length) throw new AccountParseError('В ссылке Instagram нет имени аккаунта.');
  const [first, second] = segments;
  const reserved = new Set(['p', 'reel', 'reels', 'stories', 'tv', 'explore', 'accounts']);
  if (reserved.has(first.toLowerCase())) {
    throw new AccountParseError(
      'Это ссылка на публикацию, а не на профиль. Укажите адрес профиля вида instagram.com/username.',
      'post_url',
    );
  }
  if (first.toLowerCase() === 'stories' && second) {
    return cleanHandle(second);
  }
  return cleanHandle(first);
}

function fromYoutube(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    throw new AccountParseError(
      'Это ссылка на видео. Укажите канал: youtube.com/@handle.',
      'video_url',
    );
  }
  if (!segments.length) {
    throw new AccountParseError('В ссылке YouTube нет канала. Укажите youtube.com/@handle.');
  }
  const [first, second] = segments;
  if (first.startsWith('@')) return cleanHandle(first);
  if ((first === 'channel' || first === 'c' || first === 'user') && second) {
    return cleanHandle(second);
  }
  if (RESERVED_YOUTUBE_PATHS.has(first.toLowerCase())) {
    throw new AccountParseError(
      'Это ссылка на видео или раздел, а не на канал. Укажите youtube.com/@handle.',
      'video_url',
    );
  }
  return cleanHandle(first);
}

function fromTiktok(url) {
  const segments = url.pathname.split('/').filter(Boolean);
  if (!segments.length) throw new AccountParseError('В ссылке TikTok нет имени аккаунта.');
  const first = segments[0];
  if (!first.startsWith('@')) {
    throw new AccountParseError(
      'Укажите профиль TikTok вида tiktok.com/@username.',
      'profile_required',
    );
  }
  return cleanHandle(first);
}

export function buildProfileUrl(platform, handle) {
  switch (platform) {
    case 'instagram': return `https://www.instagram.com/${handle}/`;
    case 'youtube': return `https://www.youtube.com/@${handle}`;
    case 'tiktok': return `https://www.tiktok.com/@${handle}`;
    default: return '';
  }
}

/**
 * @param {string} input ссылка, @ник или ник
 * @param {string} [platformHint] instagram | youtube | tiktok
 * @returns {{platform: string, handle: string, url: string}}
 */
export function parseAccountInput(input, platformHint) {
  const raw = String(input || '').trim();
  if (!raw) throw new AccountParseError('Укажите ссылку на аккаунт или @ник.');

  const looksLikeUrl = /^https?:\/\//i.test(raw) || /^[\w.-]+\.(com|ru|app|me|am)\//i.test(raw);
  const platform = detectPlatform(raw) || (platformHint ? String(platformHint).toLowerCase() : null);

  if (!platform) {
    throw new AccountParseError(
      'Не удалось определить платформу. Поддерживаются Instagram, YouTube и TikTok — вставьте ссылку на профиль.',
      'unknown_platform',
    );
  }
  if (!['instagram', 'youtube', 'tiktok'].includes(platform)) {
    throw new AccountParseError('Поддерживаются только Instagram, YouTube и TikTok.', 'unknown_platform');
  }

  let handle;
  if (looksLikeUrl) {
    const url = parseUrl(raw);
    if (!url) throw new AccountParseError('Ссылка выглядит некорректно. Проверьте адрес профиля.');
    if (platform === 'instagram') handle = fromInstagram(url);
    else if (platform === 'youtube') handle = fromYoutube(url);
    else handle = fromTiktok(url);
  } else {
    handle = cleanHandle(raw);
    if (platform === 'tiktok' && handle.startsWith('@')) handle = handle.slice(1);
  }

  if (!handle) throw new AccountParseError('Не удалось выделить имя аккаунта из ссылки.');
  // Платформы разрешают в именах буквы, цифры, точку, дефис и подчёркивание,
  // включая кириллицу (например youtube.com/@ТихийВлог). Пробелы, слэши,
  // угловые скобки и прочий мусор отклоняем.
  if (!/^[\p{L}\p{N}._\-@]+$/u.test(handle)) {
    throw new AccountParseError('Имя аккаунта содержит недопустимые символы.');
  }
  if (handle.length > 100) {
    throw new AccountParseError('Имя аккаунта слишком длинное.');
  }
  if (handle.length > 120) throw new AccountParseError('Имя аккаунта слишком длинное.');

  return { platform, handle, url: buildProfileUrl(platform, handle) };
}
