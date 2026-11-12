// Демонстрационный источник данных.
//
// Зачем он нужен: Instagram и YouTube в большинстве сетей и в CI недоступны,
// а TikTok отдаёт WAF-заглушку. Демо-режим даёт полностью работоспособный
// продукт «из коробки»: те же самые структуры данных, что вернёт реальный
// провайдер, но сгенерированные детерминированно. Числа не выдаются за
// настоящую статистику — в интерфейсе такой аккаунт помечен как «демо».

const DAY = 24 * 60 * 60 * 1000;

// Детерминированный ГПСЧ (mulberry32), чтобы демо-данные были стабильны
// между запусками и тестами.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(random, list) {
  return list[Math.floor(random() * list.length) % list.length];
}

const PROFILES = {
  instagram: [
    {
      handle: 'masha.eats',
      displayName: 'Маша ест',
      bio: 'Рецепты на каждый день · 30 минут и минимум посуды · Москва',
      followers: 184_300,
      postsCount: 412,
      topics: [
        'Ужин за 20 минут из того, что есть в холодильнике',
        'Три рецепта пасты, которые спасают будни',
        'Высокобелковый завтрак без сахара',
        'Готовлю на неделю: 5 контейнеров за час',
      ],
      hashtags: ['рецепты', 'ужин', 'пп', 'готовимдома', 'быстроипросто'],
    },
    {
      handle: 'studio.kadr',
      displayName: 'Студия «Кадр»',
      bio: 'Съёмка Reels и коротких видео · производство контента для брендов',
      followers: 47_800,
      postsCount: 168,
      topics: [
        'Как снимать Reels на телефон и не стыдиться результата',
        'Три ошибки в свете, которые выдают новичка',
        'Разбор рилса клиента: что сработало и почему',
        'Сценарий за 10 минут: структура хука и удержания',
      ],
      hashtags: ['reels', 'контент', 'съёмка', 'монтаж', 'продакшн'],
    },
    {
      handle: 'coach.artem',
      displayName: 'Артём Коуч',
      bio: 'Помогаю экспертам продавать через контент · 7 лет в маркетинге',
      followers: 96_200,
      postsCount: 530,
      topics: [
        'Почему ваши сторис не продают: разбор воронки',
        'Три типа прогревающих постов для экспертов',
        'Как считать окупаемость запуска без таблиц',
        'Ошибка в оффере, которая стоит вам половины заявок',
      ],
      hashtags: ['маркетинг', 'эксперт', 'продажи', 'продвижение', 'личныйбренд'],
    },
  ],
  youtube: [
    {
      handle: 'ProCoding',
      displayName: 'Pro Coding',
      bio: 'Разборы кода, архитектура и практика разработки на JavaScript',
      followers: 512_000,
      postsCount: 214,
      topics: [
        'Пишем планировщик задач с нуля: архитектура без фреймворков',
        'Как читать чужой код и не сходить с ума',
        'Node.js в 2026: что реально изменилось',
        'Рефакторинг легаси: три шага, которые дают эффект',
      ],
      hashtags: ['javascript', 'разработка', 'nodejs', 'архитектура', 'программирование'],
    },
    {
      handle: 'ТихийВлог',
      displayName: 'Тихий влог',
      bio: 'Психология, продуктивность и спокойные разговоры о сложном',
      followers: 208_400,
      postsCount: 96,
      topics: [
        'Почему продуктивность ломается к четвергу и что с этим делать',
        'Прокрастинация — не лень: что говорит психология',
        'Как выстроить утро, если вы «сова»',
        'Тревога на работе: пять техник на каждый день',
      ],
      hashtags: ['психология', 'продуктивность', 'привычки', 'саморазвитие', 'тревога'],
    },
    {
      handle: 'FurnitureLab',
      displayName: 'Furniture Lab',
      bio: 'Мебельное производство: материалы, фурнитура, технологии',
      followers: 74_900,
      postsCount: 128,
      topics: [
        'Почему кухня на 20 мм дороже на 30 %: разбор фурнитуры',
        'Как проверяется влагостойкость ЛДСП на производстве',
        'Сборка шкафа без единого видимого крепежа',
        'Три материала, которые испортят фасад через два года',
      ],
      hashtags: ['мебель', 'производство', 'кухня', 'фурнитура', 'ремонт'],
    },
  ],
  tiktok: [
    {
      handle: 'danceka',
      displayName: 'danceka',
      bio: 'танцы · челленджи · жизнь в камеру',
      followers: 1_240_000,
      postsCount: 388,
      topics: [
        'Тот самый звук, который все танцуют в апреле',
        'Учим хореографию за 15 секунд',
        'Челлендж: повторяю движения на скорость',
        'Разбор танца из рекламы, который сняли за один дубль',
      ],
      hashtags: ['танцы', 'челлендж', 'тренд', 'хореография', 'dance'],
    },
    {
      handle: 'lifestyle.nika',
      displayName: 'Ника',
      bio: 'эстетика обычного дня · распаковки · утренние ритуалы',
      followers: 386_700,
      postsCount: 240,
      topics: [
        'Утро, которое я могу повторить каждый день',
        'Распаковка капсульной капсулы: что реально стоит брать',
        'Моя полка с уходом: три вещи, которые не заменят',
        'День на 40 тысяч шагов: как это вообще возможно',
      ],
      hashtags: ['эстетика', 'утро', 'распаковка', 'рутина', 'lifestyle'],
    },
    {
      handle: 'shopkz',
      displayName: 'Shop KZ',
      bio: 'промо-ролики · товарные подборки · обзоры техники',
      followers: 152_900,
      postsCount: 604,
      topics: [
        'Три гаджета до 5 тысяч, которые меняют быт',
        'Обзор кастрюли: тест на честность',
        'Что не стоит заказывать на распродаже',
        'Тест пылесоса: собираю 300 граммов песка',
      ],
      hashtags: ['обзор', 'техника', 'товары', 'распродажа', 'промо'],
    },
  ],
};

const DESCRIPTIONS = [
  'Полный рецепт ниже, сохраняй, чтобы не потерять. Кстати, если хочешь больше такого — пиши в комментариях, что готовить в следующий раз.',
  'Этот способ сэкономил мне кучу времени. Показываю по шагам, комментируй, если делаешь иначе.',
  'Разбираю на пальцах. Сохрани видео и вернись к нему, когда будешь делать своё.',
  'Подробный рассказ без воды. Ставь лайк, если было полезно, и подписывайся — короткого контента будет больше.',
  'Меня часто спрашивают об этом, поэтому записал отдельное видео. Вопросы — в комментарии, отвечу всем.',
  'Минимум действий, максимум результата. Ссылка на подробности в профиле.',
  'Честный разбор без рекламы. Расскажи, что у тебя получилось в комментариях.',
  'Здесь собрал всё, что проверил на себе. Поделись с тем, кому это нужно.',
  'Третья часть серии, первая — в закрепе. Если хочешь четвёртую — дай знать.',
  'Покадровый разбор и объяснение каждого решения. Сохрани в избранное, чтобы не искать.',
];

const HOOKS = [
  'Стоп, не делай так, как я год назад',
  'Этого никто не расскажет на курсах',
  'Три вещи, которые ты делаешь неправильно',
  'Проверено на себе: работает',
  'Смотри до конца, если хочешь результат',
  'Мне понадобилось 7 лет, чтобы понять это',
  'Главная ошибка новичка',
  'Как сделать это за 10 минут',
];

const LANGUAGES = ['ru', 'ru', 'ru', 'ru', 'en'];

function mediaUrl(platform, handle, index) {
  // Внешние превью не зашиты в репозиторий: вместо картинок интерфейс
  // рисует детерминированную заглушку с инициалами и номером видео.
  void platform; void handle; void index;
  return '';
}

function buildVideos(platform, profile, seedSource) {
  const random = rng(hash(`${platform}:${profile.handle}:${seedSource}`));
  const now = Date.now();
  const count = platform === 'youtube' ? 18 : 24;
  const videos = [];
  let cursor = now - Math.floor(random() * 3 * DAY);

  for (let i = 0; i < count; i += 1) {
    // Публикации распределены по 8 месяцам с «сезонными» сгустками.
    const gapDays = 1 + Math.floor(random() * 9);
    cursor -= gapDays * DAY;
    const publishedAt = new Date(cursor).toISOString();

    const topic = pick(random, profile.topics);
    const hook = pick(random, HOOKS);
    const hashtags = [];
    const tagPool = [...profile.hashtags];
    while (hashtags.length < 3 + Math.floor(random() * 3) && tagPool.length) {
      hashtags.push(tagPool.splice(Math.floor(random() * tagPool.length), 1)[0]);
    }
    const used = new Set(hashtags);
    const extra = ['рек', 'совет', 'лайфхак', 'тренд', 'разбор', 'новое'];
    for (const tag of extra) {
      if (hashtags.length >= 6) break;
      if (random() > 0.55 && !used.has(tag)) { hashtags.push(tag); used.add(tag); }
    }

    const baseReach = platform === 'tiktok'
      ? 0.25
      : platform === 'youtube' ? 0.055 : 0.14;
    const virality = random() < 0.14 ? 3 + random() * 6 : 0.4 + random() * 1.4;
    const views = Math.round(profile.followers * baseReach * virality * (0.7 + random() * 0.6));
    const likeRate = platform === 'youtube' ? 0.045 : platform === 'tiktok' ? 0.07 : 0.05;
    const likes = Math.round(views * likeRate * (0.6 + random() * 0.8));
    const comments = Math.round(views * (0.0015 + random() * 0.006));
    const shares = Math.round(views * (0.0008 + random() * 0.004));
    const saves = platform === 'youtube' ? 0 : Math.round(views * (0.002 + random() * 0.01));
    const duration = platform === 'youtube'
      ? 240 + Math.floor(random() * 900)
      : platform === 'tiktok' ? 12 + Math.floor(random() * 48) : 20 + Math.floor(random() * 70);

    const title = `${hook} — ${topic}`.slice(0, 120);
    const description = `${pick(random, DESCRIPTIONS)}\n\n${hashtags.map((t) => `#${t}`).join(' ')}`;

    videos.push({
      externalId: `${platform}-${profile.handle}-${i + 1}`,
      url: platform === 'youtube'
        ? `https://www.youtube.com/watch?v=demo${i}${hash(profile.handle) % 1000}`
        : platform === 'tiktok'
          ? `https://www.tiktok.com/@${profile.handle}/video/${7200000000000 + i}`
          : `https://www.instagram.com/reel/DEMO${i}${hash(profile.handle) % 100}/`,
      title,
      description,
      transcript: '',
      hashtags,
      publishedAt,
      durationSeconds: duration,
      views,
      likes,
      comments,
      shares,
      saves,
      thumbnailUrl: mediaUrl(platform, profile.handle, i),
      language: platform === 'youtube' ? 'ru' : pick(random, LANGUAGES),
    });
  }
  return videos;
}

export function demoTemplates() {
  return Object.entries(PROFILES).flatMap(([platform, list]) => list.map((profile) => ({
    platform,
    ...profile,
  })));
}

export function demoProfile(platform, handle) {
  const list = PROFILES[platform] || [];
  const profile = list.find((p) => p.handle.toLowerCase() === String(handle).toLowerCase());
  if (!profile) return null;
  return {
    platform,
    handle: profile.handle,
    displayName: profile.displayName,
    url: platform === 'instagram'
      ? `https://www.instagram.com/${profile.handle}/`
      : platform === 'youtube'
        ? `https://www.youtube.com/@${profile.handle}`
        : `https://www.tiktok.com/@${profile.handle}`,
    bio: profile.bio,
    followers: profile.followers,
    following: Math.round(profile.followers * 0.006),
    postsCount: profile.postsCount,
    avatarUrl: '',
  };
}

export function demoVideos(platform, handle, { limit = 100, now = Date.now() } = {}) {
  const list = PROFILES[platform] || [];
  const profile = list.find((p) => p.handle.toLowerCase() === String(handle).toLowerCase());
  if (!profile) return [];
  const random = rng(hash(`${platform}:${profile.handle}:demo-cadence`));
  let cursor = now - (1 + Math.floor(random() * 3)) * DAY;
  return buildVideos(platform, profile, Math.floor(now / DAY))
    .slice(0, limit)
    .map((v) => {
      // Ровный ритм публикаций: 2–6 дней между роликами, самый свежий — недавно.
      const publishedAt = new Date(cursor).toISOString();
      cursor -= (2 + Math.floor(random() * 5)) * DAY;
      return { ...v, publishedAt };
    });
}
