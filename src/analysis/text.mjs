// Анализ содержания: темы, ключевые слова, хештеги, приёмы подачи, тональность.
//
// Всё считается локально, без внешних ML-сервисов. Это осознанный компромисс:
// сервис должен работать без API-ключей и без отправки чужого контента наружу.
// Точность приблизительная — в интерфейсе и ТЗ это ограничение названо явно.
import { normalizeWord, stemTokens, tokenize } from '../lib/stemmer.mjs';
import { isStopword } from '../lib/stopwords.mjs';

const NEGATIVE = new Set([
  'плохо', 'ужас', 'ужасно', 'ошибка', 'ошибки', 'провал', 'проблема', 'проблемы',
  'сложно', 'тяжело', 'боль', 'больно', 'страх', 'страшно', 'тревога', 'устал',
  'усталость', 'ненавижу', 'скучно', 'разочарование', 'провалил', 'неудача',
  'катастрофа', 'кошмар', 'вред', 'вредно', 'опасно', 'обман',
  'развод', 'сломалось', 'брак', 'минус', 'минусы',
  'неправильно', 'плохой', 'худший', 'слабо', 'фигня', 'жесть', 'нервы',
  'кризис', 'выгорание', 'депрессия', 'паника', 'злость', 'обида', 'раздражает',
  'bad', 'worst', 'fail', 'hard', 'problem', 'wrong', 'hate', 'angry', 'scared',
]);

const POSITIVE = new Set([
  'хорошо', 'отлично', 'класс', 'классно', 'супер', 'круто', 'люблю', 'нравится',
  'полезно', 'польза', 'легко', 'быстро', 'успех', 'успешно', 'работает',
  'результат', 'лучше', 'лучший', 'радость', 'счастье', 'вдохновение', 'красиво',
  'вкусно', 'удобно', 'кайф', 'топ', 'рекомендую', 'советую', 'победа', 'прогресс',
  'спасибо', 'благодарю', 'интересно', 'честно', 'надежно',
  'good', 'great', 'best', 'love', 'easy', 'useful', 'win', 'works', 'nice', 'happy',
]);

// Слова, которые часто встречаются в описаниях, но не описывают тему ролика.
const GENERIC = new Set([
  'виде', 'видео', 'ролик', 'ролики', 'смотри', 'смотрет', 'канал', 'подпис',
  'подписк', 'коммент', 'комментар', 'лайк', 'ссылк', 'описан', 'профил', 'шапк',
  'ссыл', 'пост', 'посты', 'контент', 'кажд', 'котор', 'которы', 'этот', 'свой',
  'свои', 'себя', 'очень', 'просто', 'можно', 'нужн', 'надо', 'будет', 'буду',
  'есть', 'был', 'была', 'были', 'быть', 'хочу', 'хочеш', 'хочешь', 'дела',
  'делат', 'делаю', 'сдела', 'сделат', 'сделать', 'делаем', 'сегодня', 'вчера',
  'завтра', 'время', 'раз', 'году', 'год', 'день', 'дня', 'дни', 'всем', 'всех',
  'тольк', 'такж', 'также', 'если', 'чтоб', 'чтобы', 'потом', 'тепер', 'теперь',
  'когда', 'пока', 'более', 'мене', 'менее', 'самы', 'самый', 'самая', 'самое',
  'первы', 'первый', 'второ', 'трети', 'третий', 'новы', 'новый', 'новая',
  'лучш', 'хорош', 'бол', 'част', 'часто', 'иногда', 'всегд', 'всегда',
  'никогд', 'никогда', 'друг', 'друз', 'друзья', 'ребят', 'ребята',
  'тебе', 'меня', 'себе', 'него', 'неё', 'нее', 'них', 'этом', 'этой',
  'эти', 'эта', 'это', 'ещё', 'еще', 'уже', 'или', 'либо', 'но', 'да', 'нет',
]);

const CYRILLIC = /[\u0400-\u04FF]/;

function lower(value) {
  return String(value ?? '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function capitalize(value) {
  const s = String(value || '');
  return s ? s[0].toLocaleUpperCase('ru-RU') + s.slice(1) : s;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function videoText(video) {
  return [video.title, video.description, video.transcript].filter(Boolean).join(' \n ');
}

/**
 * Ключевые термины: сколько роликов их используют, какой у них средний охват
 * и во сколько раз он выше среднего по аккаунту.
 */
export function extractTopics(videos, { minCount = 1, limit = 12, includeHashtags = true } = {}) {
  const buckets = new Map();

  videos.forEach((video, index) => {
    const text = videoText(video);
    // Первая встреченная словоформа становится подписью термина.
    const forms = new Map();
    for (const word of tokenize(text)) {
      const stem = normalizeWord(word);
      if (!forms.has(stem)) forms.set(stem, lower(word));
    }
    if (includeHashtags) {
      for (const raw of video.hashtags || []) {
        const tag = String(raw).replace(/^#/, '');
        const stem = normalizeWord(tag);
        if (stem && !forms.has(stem)) forms.set(stem, lower(tag));
      }
    }

    const seen = new Set();
    for (const [stem, form] of forms) {
      if (!isTopicCandidate(stem) || seen.has(stem)) continue;
      seen.add(stem);
      if (!buckets.has(stem)) {
        buckets.set(stem, { stem, form, videoIndexes: [], views: 0, erSum: 0 });
      }
      const bucket = buckets.get(stem);
      bucket.videoIndexes.push(index);
      bucket.views += Number(video.views) || 0;
      bucket.erSum += Number(video.engagementRate) || 0;
    }
  });

  const total = Math.max(1, videos.length);
  const avgViewsAll = mean(videos.map((v) => Number(v.views) || 0));
  const avgErAll = mean(videos.map((v) => Number(v.engagementRate) || 0));

  return [...buckets.values()]
    .map((b) => {
      const count = b.videoIndexes.length;
      const avgViews = count ? b.views / count : 0;
      const avgEr = count ? b.erSum / count : 0;
      return {
        stem: b.stem,
        label: capitalize(b.form),
        count,
        share: (count / total) * 100,
        avgViews: Math.round(avgViews),
        avgEr,
        lift: avgViewsAll ? avgViews / avgViewsAll : 0,
        erLift: avgErAll ? avgEr / avgErAll : 0,
        videoIds: b.videoIndexes.map((i) => videos[i].id).filter(Boolean),
        videoIndexes: b.videoIndexes,
      };
    })
    .filter((t) => t.count >= minCount)
    .sort((a, b) => (b.count - a.count) || (b.avgViews - a.avgViews))
    .slice(0, limit);
}

function isTopicCandidate(stem) {
  if (!stem || stem.length < 3) return false;
  if (/^\d+$/.test(stem)) return false;
  if (isStopword(stem) || GENERIC.has(stem)) return false;
  return true;
}

export function extractHashtags(videos, { limit = 15 } = {}) {
  const map = new Map();
  videos.forEach((video) => {
    const tags = new Set((video.hashtags || []).map((t) => lower(String(t).replace(/^#/, ''))));
    for (const tag of tags) {
      if (!tag) continue;
      if (!map.has(tag)) map.set(tag, { tag, count: 0, views: 0, er: 0 });
      const row = map.get(tag);
      row.count += 1;
      row.views += Number(video.views) || 0;
      row.er += Number(video.engagementRate) || 0;
    }
  });
  const total = Math.max(1, videos.length);
  return [...map.values()]
    .map((row) => ({
      ...row,
      avgViews: Math.round(row.views / row.count),
      avgEr: row.er / row.count,
      share: (row.count / total) * 100,
    }))
    .sort((a, b) => (b.count - a.count) || (b.avgViews - a.avgViews))
    .slice(0, limit);
}

// Маркеры приёмов подачи заданы основами слов, а сравнение идёт по основам
// токенов, а не по подстроке. Иначе «лайкозависимость» засчитывалась бы как
// призыв «лайк», а «смотрибельность» — как «смотри».
const CTA_STEMS = new Set([
  'подпис', 'подпиш', 'став', 'ставт', 'пиш', 'напиш', 'жм', 'переход',
  'смотр', 'залетай', 'коммент', 'лайк', 'сохран', 'дел', 'ссылк', 'шапк',
  'описан', 'попроб',
]);

const URGENCY_STEMS = new Set([
  'срочн', 'последн', 'шанс', 'успей', 'сегодн', 'конц', 'дедлайн', 'остат',
]);

const PERSONAL_WORDS = new Set(['я', 'мне', 'мой', 'моя', 'мы', 'наш', 'меня']);

export function detectHooks(video) {
  const text = videoText(video);
  const words = tokenize(text);
  const stems = new Set(words.map(normalizeWord));

  let cta = false;
  for (const stem of stems) {
    if (CTA_STEMS.has(stem)) { cta = true; break; }
  }
  let urgency = false;
  for (const stem of stems) {
    if (URGENCY_STEMS.has(stem)) { urgency = true; break; }
  }
  const personal = words.some((w) => PERSONAL_WORDS.has(lower(w)));

  return {
    question: /\?/.test(text),
    cta,
    list: /(^|\n)\s*(\d+[.)]|[-—•])\s/.test(text),
    numbers: /\d/.test(text),
    urgency,
    personal,
  };
}

const HOOK_LABELS = {
  question: 'Вопрос в тексте',
  cta: 'Призыв к действию',
  numbers: 'Цифры и перечисления',
  personal: 'Личный опыт («я», «мы»)',
  urgency: 'Срочность и дедлайн',
  list: 'Список или шаги',
};

/**
 * Приёмы подачи: доля роликов с приёмом и средний ER с ним и без него.
 * Связь описательная, а не причинная.
 */
export function analyzeHooks(videos) {
  const total = Math.max(1, videos.length);
  const avgErAll = mean(videos.map((v) => Number(v.engagementRate) || 0));
  return Object.keys(HOOK_LABELS).map((key) => {
    const hit = videos.filter((v) => v.hooks?.[key]);
    const miss = videos.filter((v) => !v.hooks?.[key]);
    const avgEr = mean(hit.map((v) => Number(v.engagementRate) || 0));
    const avgErWithout = mean(miss.map((v) => Number(v.engagementRate) || 0));
    return {
      key,
      label: HOOK_LABELS[key],
      count: hit.length,
      share: (hit.length / total) * 100,
      avgEr,
      avgErWithout,
      erLift: avgErWithout ? avgEr / avgErWithout : (avgEr ? 1 : 0),
      avgViews: Math.round(mean(hit.map((v) => Number(v.views) || 0))),
      hasEnoughData: hit.length >= 2 && miss.length >= 2,
      vsAccount: avgErAll ? avgEr / avgErAll : 1,
    };
  });
}

export function analyzeSentiment(videos) {
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  const matched = { positive: new Map(), negative: new Map() };

  for (const video of videos) {
    const stems = new Set(stemTokens(videoText(video)));
    let score = 0;
    for (const stem of stems) {
      if (POSITIVE.has(stem)) {
        score += 1;
        matched.positive.set(stem, (matched.positive.get(stem) || 0) + 1);
      } else if (NEGATIVE.has(stem)) {
        score -= 1;
        matched.negative.set(stem, (matched.negative.get(stem) || 0) + 1);
      }
    }
    if (score === 0) neutral += 1;
    else if (score > 0) positive += 1;
    else negative += 1;
  }

  const total = Math.max(1, videos.length);
  const topList = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([word, count]) => ({ word, count }));
  const scoredVideos = videos.filter((v) => {
    const stems = new Set(stemTokens(videoText(v)));
    return [...stems].some((s) => POSITIVE.has(s) || NEGATIVE.has(s));
  }).length;

  return {
    positive: (positive / total) * 100,
    negative: (negative / total) * 100,
    neutral: (neutral / total) * 100,
    coveredShare: (scoredVideos / total) * 100,
    positiveWords: topList(matched.positive),
    negativeWords: topList(matched.negative),
    reliable: videos.length >= 5,
  };
}

export function textStats(video) {
  const text = videoText(video);
  const words = tokenize(text);
  return {
    words: words.length,
    characters: text.length,
    titleWords: tokenize(video.title || '').length,
    hashtags: (video.hashtags || []).length,
    cyrillicShare: words.length
      ? (words.filter((w) => CYRILLIC.test(w)).length / words.length) * 100
      : 0,
  };
}
