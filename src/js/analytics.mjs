/**
 * Аналитика: события складываются в очередь и уходят в счётчик только после
 * согласия на cookie. Провайдер не выбран заказчиком (ТЗ, п. 17.8), поэтому
 * здесь один интерфейс и два адаптера — Яндекс.Метрика и GA4. Чтобы включить,
 * задайте analytics в src/content/site.mjs.
 */
const CONSENT_KEY = 'cookie-consent';
const queue = [];
let provider = null;
let ready = false;

export function readConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    return raw === 'all' || raw === 'necessary' ? raw : null;
  } catch {
    return null;
  }
}

export function saveConsent(value) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    /* приватный режим: баннер покажется в следующий раз */
  }
  if (value === 'all') {
    ready = true;
    flush();
    document.dispatchEvent(new CustomEvent('consent:granted'));
  } else {
    ready = false;
    queue.length = 0;
    document.dispatchEvent(new CustomEvent('consent:denied'));
  }
}

function push(event, params) {
  const payload = {
    event,
    page_path: location.pathname + location.hash,
    utm: utmParams(),
    ...params,
  };
  queue.push(payload);
  if (ready) flush();
}

let flushing = false;
function flush() {
  if (!queue.length || flushing) return;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  for (const item of batch) {
    try {
      if (provider?.type === 'metrika' && typeof window.ym === 'function') {
        window.ym(provider.id, 'reachGoal', item.event, item);
      } else if (provider?.type === 'ga4' && typeof window.gtag === 'function') {
        window.gtag('event', item.event, item);
      }
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(item);
    } catch {
      /* счётчик недоступен — событие уже отправлено в dataLayer */
    }
  }
  flushing = false;
}

export function utmParams() {
  const params = new URLSearchParams(location.search);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  const out = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  return out;
}

export function track(event, params = {}) {
  if (!event) return;
  push(event, params);
}

function loadMetrika(id) {
  /* eslint-disable */
  ;(function (m, e, t, r, i, k, a) {
    m[i] =
      m[i] ||
      function () {
        (m[i].a = m[i].a || []).push(arguments);
      };
    m[i].l = 1 * new Date();
    for (var j = 0; j < document.scripts.length; j++) {
      if (document.scripts[j].src === r) return;
    }
    ((k = e.createElement(t)), (a = e.getElementsByTagName(t)[0]), (k.async = 1), (k.src = r), a.parentNode.insertBefore(k, a));
  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
  /* eslint-enable */
  window.ym(id, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
}

function loadGa4(id) {
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', id, { anonymize_ip: true });
}

function initProvider(config) {
  if (!config || !config.id) return;
  if (config.type === 'metrika') loadMetrika(config.id);
  else if (config.type === 'ga4') loadGa4(config.id);
  provider = config;
}

let bound = false;

/** Клики по телефону и мессенджерам + глубина прокрутки + аккордеон. */
export function bindTracking(config) {
  if (bound) {
    // Повторный вызов (например, после согласия на cookie) только досылает
    // накопленные события — обработчики не дублируются.
    ready = readConsent() === 'all';
    flush();
    return;
  }
  bound = true;
  initProvider(config);
  const consent = readConsent();
  ready = consent === 'all';

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-track]');
    if (!target) return;
    const params = { place: target.dataset.place || 'unknown' };
    if (target.dataset.track === 'messenger_click') {
      params.messenger = /wa\.me|whatsapp/i.test(target.href) ? 'whatsapp' : 'telegram';
    }
    track(target.dataset.track, params);
  });

  const seen = new Set();
  const onScroll = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 0) return;
    const ratio = (window.scrollY / max) * 100;
    for (const threshold of [50, 90]) {
      if (ratio >= threshold && !seen.has(threshold)) {
        seen.add(threshold);
        track(`scroll_${threshold}`);
      }
    }
    if (seen.size === 2) window.removeEventListener('scroll', onScroll);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  document.addEventListener('consent:granted', flush);
}
