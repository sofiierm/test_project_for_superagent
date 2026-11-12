// Обзор: сводка по всем аккаунтам, динамика, выводы, темы.
import { html } from './html.mjs';
import { layout } from './layout.mjs';
import {
  columnsChart, deltaBadge, emptyState, hookTable, insightList, lineChart, notice,
  platformBadge, sentimentBar, statCard, syncScheduleLabel, topicsList, videosTable,
  PLATFORM_LABELS,
} from './components.mjs';
import {
  formatDateTime, formatIn, formatNumber, formatPercent, formatShortDate, plural, weekdayIndex,
} from '../lib/dates.mjs';

const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function dashboardPage(data, { mode, providerReason }) {
  const { accounts, summary, insights, series, byPlatform, topVideos, topics, sentiment, hooks, hashtags } = data;

  if (!accounts.length) {
    return layout({
      title: 'Обзор',
      active: 'dashboard',
      mode,
      providerReason,
      body: html`
        <div class="page-head">
          <div class="page-head__titles">
            <h1>Аналитика контента креаторов</h1>
            <p class="page-head__lead">Соберите ролики из Instagram, YouTube и TikTok в одном месте и посмотрите, что работает: охват, вовлечённость, темы и приёмы подачи.</p>
          </div>
          <div class="page-head__actions">
            <button class="btn btn--primary" data-open-add-account>Добавить аккаунт</button>
          </div>
        </div>
        <div class="card">
          ${emptyState({
            title: 'Пока нет ни одного аккаунта',
            text: 'Добавьте профиль креатора — сервис загрузит последние ролики, посчитает метрики и покажет выводы. Это займёт несколько секунд.',
            action: html`<button class="btn btn--primary" data-open-add-account>Добавить первый аккаунт</button>`,
          })}
        </div>`,
    });
  }

  const stableAccounts = accounts.filter((a) => a.syncStatus === 'error');
  const demoAccounts = accounts.filter((a) => a.source === 'demo');

  return layout({
    title: 'Обзор',
    active: 'dashboard',
    mode,
    providerReason,
    body: html`
      <div class="page-head">
        <div class="page-head__titles">
          <h1>Обзор</h1>
          <p class="page-head__lead">
            ${accounts.length} ${plural(accounts.length, 'аккаунт', 'аккаунта', 'аккаунтов')} ·
            ${summary.count} ${plural(summary.count, 'ролик', 'ролика', 'роликов')} ·
            обновлено ${formatDateTime(accounts.map((a) => a.lastSyncedAt).filter(Boolean).sort().at(-1))}
          </p>
        </div>
        <div class="page-head__actions">
          <a class="btn" href="/api/videos.csv">Скачать CSV</a>
          <button class="btn btn--primary" data-open-add-account>Добавить аккаунт</button>
        </div>
      </div>

      ${demoAccounts.length
        ? notice(`Аккаунты в демо-режиме: ${demoAccounts.map((a) => `@${a.handle}`).join(', ')}. Показанные цифры сгенерированы для демонстрации работы сервиса, а не взяты у платформы. Живой источник включается через yt-dlp — см. раздел «Как это работает».`, 'warn')
        : ''}
      ${stableAccounts.length
        ? notice(`Не удалось синхронизировать: ${stableAccounts.map((a) => `@${a.handle}`).join(', ')}. ${stableAccounts[0].syncError}`, 'error')
        : ''}

      <section class="grid grid--stats" style="margin-bottom:16px" aria-label="Ключевые показатели">
        ${statCard({
          label: 'Просмотры за 30 дней',
          value: formatNumber(data.dailySeries.reduce((s, r) => s + r.views, 0)),
          delta: deltaBadge(data.viewsDelta.change),
          meta: 'к прошлым 30 дням',
        })}
        ${statCard({
          label: 'Средний ER',
          value: formatPercent(summary.avgEr),
          delta: deltaBadge(data.erDelta.change),
          meta: `медиана ${formatPercent(summary.medianEr)}`,
        })}
        ${statCard({
          label: 'Средний охват ролика',
          value: formatNumber(summary.avgViews),
          meta: `медиана ${formatNumber(summary.medianViews)}`,
        })}
        ${statCard({
          label: 'Вовлечённость',
          value: formatNumber(summary.totalEngagements),
          meta: 'лайки, комментарии, репосты, сохранения',
        })}
        ${statCard({
          label: 'Подписчики',
          value: formatNumber(accounts.reduce((s, a) => s + a.followers, 0), { compact: true }),
          meta: `на ${accounts.length} ${plural(accounts.length, 'аккаунте', 'аккаунтах', 'аккаунтах')}`,
        })}
      </section>

      <div class="grid grid--main" style="margin-bottom:16px">
        <div class="stack">
          <div class="card">
            <div class="card__head">
              <h2 class="card__title">Динамика просмотров</h2>
              <span class="card__hint">по неделям, 120 дней</span>
            </div>
            ${lineChart(series, { ariaLabel: 'Динамика просмотров по неделям' })}
          </div>
          <div class="card card--flush">
            <div class="card__head" style="padding:20px 20px 0">
              <h2 class="card__title">Ролики с наибольшим охватом</h2>
              <a class="card__hint" href="/videos">все ролики →</a>
            </div>
            <div style="padding:8px 8px 8px">${videosTable(topVideos, { emptyText: 'Пока нет роликов.' })}</div>
          </div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card__head">
              <h2 class="card__title">Что говорят данные</h2>
            </div>
            ${insightList(insights)}
          </div>
          <div class="card">
            <div class="card__head">
              <h2 class="card__title">Аккаунты</h2>
              <a class="card__hint" href="/accounts">управлять →</a>
            </div>
            <div class="list">
              ${accounts.slice(0, 6).map((a) => html`
                <div class="list__item">
                  <div style="min-width:0;flex:1">
                    <div class="row" style="gap:6px">
                      <a href="/accounts/${a.id}" class="cell-title__main">${a.displayName || a.handle}</a>
                      ${platformBadge(a.platform)}
                    </div>
                    <span class="cell-title__sub">${formatNumber(a.followers, { compact: true })} подписчиков · ${a.videosCount} ${plural(a.videosCount, 'ролик', 'ролика', 'роликов')}</span>
                  </div>
                  <span class="stat__value" style="font-size:1rem">${formatPercent(a.totalViews ? (a.totalEngagements / a.totalViews) * 100 : 0)}</span>
                </div>
              `)}
            </div>
          </div>
        </div>
      </div>

      <section class="grid grid--3">
        <div class="card">
          <div class="card__head"><h2 class="card__title">Темы контента</h2></div>
          <p class="card__hint" style="margin-bottom:10px">Ключевые термины по текстам и хештегам. Множитель — во сколько раз средний охват роликов с темой выше среднего по всем роликам.</p>
          ${topicsList(topics)}
        </div>
        <div class="card">
          <div class="card__head"><h2 class="card__title">Тональность</h2></div>
          <p class="card__hint" style="margin-bottom:12px">По словарю эмоциональной лексики. Нейтральные ролики — без явных маркеров.</p>
          ${sentimentBar(sentiment)}
          ${sentiment.reliable ? '' : notice('Малый объём текста: тональность может быть неточной.', 'info')}
        </div>
        <div class="card">
          <div class="card__head"><h2 class="card__title">Платформы</h2></div>
          <div class="list">
            ${byPlatform.map((p) => html`
              <div class="list__item">
                <div style="flex:1;min-width:0">
                  <div class="row" style="gap:6px">${platformBadge(p.platform)}</div>
                  <span class="cell-title__sub">${p.accounts} ${plural(p.accounts, 'аккаунт', 'аккаунта', 'аккаунтов')} · ${p.videos} ${plural(p.videos, 'ролик', 'ролика', 'роликов')}</span>
                </div>
                <div style="text-align:right">
                  <div class="cell-title__main">${formatNumber(p.views, { compact: true })}</div>
                  <span class="cell-title__sub">ER ${formatPercent(p.avgEr)}</span>
                </div>
              </div>
            `)}
          </div>
        </div>
      </section>

      <section class="grid grid--2" style="margin-top:16px">
        <div class="card">
          <div class="card__head">
            <h2 class="card__title">Приёмы подачи</h2>
            <span class="card__hint">сравнение ER с приёмом и без</span>
          </div>
          ${hookTable(hooks)}
        </div>
        <div class="card">
          <div class="card__head"><h2 class="card__title">Хештеги</h2></div>
          ${hashtags.length
            ? html`<div class="chips">
                ${hashtags.map((tag) => html`<span class="badge">#${tag.tag} · ${tag.count}</span>`)}
              </div>`
            : html`<p class="card__hint">Хештеги не найдены.</p>`}
          <p class="card__hint" style="margin-top:12px">Число рядом — в скольких роликах встречается хештег.</p>
        </div>
      </section>
    `,
  });
}

export function accountsPage(accounts, { mode, providerReason }) {
  return layout({
    title: 'Аккаунты',
    active: 'accounts',
    mode,
    providerReason,
    body: html`
      <div class="page-head">
        <div class="page-head__titles">
          <h1>Аккаунты</h1>
          <p class="page-head__lead">Профили, за которыми следит сервис. Синхронизация забирает последние ролики и обновляет метрики.</p>
        </div>
        <div class="page-head__actions">
          <button class="btn btn--primary" data-open-add-account>Добавить аккаунт</button>
        </div>
      </div>
      ${accounts.length
        ? html`<div class="grid grid--3">
            ${accounts.map((a) => html`
              <article class="card account-card">
                <div class="account-card__top">
                  <span class="avatar avatar--${a.platform}" aria-hidden="true">${(a.displayName || a.handle).slice(0, 2).toLocaleUpperCase('ru-RU')}</span>
                  <div style="min-width:0;flex:1">
                    <div class="account-card__name"><a href="/accounts/${a.id}">${a.displayName || a.handle}</a></div>
                    <div class="account-card__handle">@${a.handle}</div>
                  </div>
                  ${platformBadge(a.platform)}
                </div>
                <div class="account-card__stats">
                  <div class="account-card__stat"><span>Подписчики</span><span>${formatNumber(a.followers, { compact: true })}</span></div>
                  <div class="account-card__stat"><span>Ролики</span><span>${a.videosCount}</span></div>
                  <div class="account-card__stat"><span>Просмотры</span><span>${formatNumber(a.totalViews, { compact: true })}</span></div>
                </div>
                <div class="row" style="justify-content:space-between">
                  <span class="badge ${a.source === 'demo' ? 'badge--demo' : 'badge--live'}">${a.source === 'demo' ? 'демо' : 'live'}</span>
                  <span class="cell-title__sub">${a.lastSyncedAt ? `обновлено ${formatShortDate(a.lastSyncedAt)}` : 'не синхронизирован'}${a.nextSyncAt ? ` · далее ${formatIn(a.nextSyncAt)}` : ''}</span>
                </div>
                <div class="row">
                  <a class="btn btn--small" href="/accounts/${a.id}">Открыть</a>
                  <button class="btn btn--small" data-sync-account="${a.id}">Синхронизировать</button>
                  <button class="btn btn--small btn--danger" data-delete-account="${a.id}" data-handle="${a.handle}">Удалить</button>
                </div>
              </article>
            `)}
          </div>`
        : html`<div class="card">${emptyState({
            title: 'Аккаунтов нет',
            text: 'Добавьте ссылку на профиль креатора в Instagram, YouTube или TikTok.',
            action: html`<button class="btn btn--primary" data-open-add-account>Добавить аккаунт</button>`,
          })}</div>`}
    `,
  });
}

export function accountPage(data, { mode, providerReason }) {
  const {
    account, videos, summary, insights, series, topics, hashtags, sentiment, hooks,
    bestTimes, cadence, outliers, weakest, runs, viewsDelta,
  } = data;

  const hourRows = bestTimes.hours
    .slice()
    .sort((a, b) => a.key - b.key)
    .map((h) => ({ ...h, label: String(h.key).padStart(2, '0') }));

  const weekdayRows = bestTimes.weekdays
    .slice()
    .sort((a, b) => a.key - b.key)
    .map((d) => ({ ...d, label: WEEKDAY_SHORT[d.key - 1] }));

  return layout({
    title: account.displayName || account.handle,
    active: 'accounts',
    mode,
    providerReason,
    body: html`
      <nav class="breadcrumbs" aria-label="Хлебные крошки" style="margin-bottom:12px">
        <a href="/accounts">Аккаунты</a><span class="breadcrumbs__sep">/</span><span>@${account.handle}</span>
      </nav>
      <div class="page-head">
        <div class="page-head__titles">
          <div class="row" style="gap:10px">
            <h1>${account.displayName || account.handle}</h1>
            ${platformBadge(account.platform)}
            <span class="badge ${account.source === 'demo' ? 'badge--demo' : 'badge--live'}">${account.source === 'demo' ? 'демо' : 'live'}</span>
          </div>
          <p class="page-head__lead">
            @${account.handle} · ${formatNumber(account.followers)} подписчиков · ${videos.length} ${plural(videos.length, 'ролик', 'ролика', 'роликов')}
            · последняя синхронизация ${formatDateTime(account.lastSyncedAt)}
          </p>
          <p class="card__hint">${syncScheduleLabel(account)}${account.syncIntervalMinutes
            ? ` · интервал ${account.syncIntervalMinutes} мин`
            : ''}</p>
        </div>
        <div class="page-head__actions">
          <a class="btn" href="/api/accounts/${account.id}/videos.csv">CSV</a>
          <button class="btn" data-sync-account="${account.id}">Синхронизировать</button>
          <button class="btn btn--danger" data-delete-account="${account.id}" data-handle="${account.handle}">Удалить</button>
        </div>
      </div>

      ${account.syncError ? notice(account.syncError, 'error') : ''}
      ${account.source === 'demo' ? notice('Это демонстрационные данные: цифры сгенерированы, чтобы показать работу анализа. Подключение живого источника описано в разделе «Как это работает».', 'warn') : ''}

      <section class="grid grid--stats" style="margin-bottom:16px">
        ${statCard({ label: 'Просмотры всего', value: formatNumber(summary.totalViews), meta: `медиана ${formatNumber(summary.medianViews)} на ролик` })}
        ${statCard({ label: 'Средний ER', value: formatPercent(summary.avgEr), meta: `медиана ${formatPercent(summary.medianEr)}` })}
        ${statCard({ label: 'ER к подписчикам', value: formatPercent(summary.avgFollowerReach), meta: 'просмотры / подписчики' })}
        ${statCard({ label: 'Средний охват', value: formatNumber(summary.avgViews), delta: deltaBadge(viewsDelta.change), meta: 'к прошлому периоду' })}
        ${statCard({
          label: 'Ритм публикаций',
          value: cadence.medianGapDays ? `раз в ${cadence.medianGapDays.toFixed(1)} дн.` : '—',
          meta: cadence.daysSinceLast !== null ? `последний ${Math.round(cadence.daysSinceLast)} дн. назад` : '',
        })}
      </section>

      <div class="grid grid--main" style="margin-bottom:16px">
        <div class="stack">
          <div class="card">
            <div class="card__head">
              <h2 class="card__title">Просмотры по неделям</h2>
              <span class="card__hint">180 дней</span>
            </div>
            ${lineChart(series, { ariaLabel: 'Просмотры по неделям' })}
          </div>
          <div class="card card--flush">
            <div class="card__head" style="padding:20px 20px 0">
              <h2 class="card__title">Все ролики</h2>
              <span class="card__hint">${videos.length} шт.</span>
            </div>
            <div style="padding:8px 8px 8px">${videosTable(videos, { showAccount: false })}</div>
          </div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card__head"><h2 class="card__title">Выводы</h2></div>
            ${insightList(insights)}
          </div>
          <div class="card">
            <div class="card__head"><h2 class="card__title">История синхронизаций</h2></div>
            <div class="list">
              ${runs.length ? runs.map((r) => html`
                <div class="list__item">
                  <div style="flex:1;min-width:0">
                    <div class="cell-title__main" style="font-size:0.86rem">${formatDateTime(r.started_at)}</div>
                    <span class="cell-title__sub">${r.videos_found} найдено · ${r.videos_new} новых${r.message ? ` · ${r.message.slice(0, 80)}` : ''}</span>
                  </div>
                  <span class="badge ${r.status === 'success' ? 'badge--live' : 'badge--error'}">${r.status}</span>
                </div>
              `) : html`<p class="card__hint">Синхронизаций ещё не было.</p>`}
            </div>
          </div>
        </div>
      </div>

      <section class="grid grid--2">
        <div class="card">
          <div class="card__head"><h2 class="card__title">Темы контента</h2><span class="card__hint">по охвату</span></div>
          ${topicsList(topics)}
        </div>
        <div class="card">
          <div class="card__head"><h2 class="card__title">Приёмы подачи</h2></div>
          ${hookTable(hooks)}
        </div>
      </section>

      <section class="grid grid--3" style="margin-top:16px">
        <div class="card">
          <div class="card__head"><h2 class="card__title">Лучшие часы</h2><span class="card__hint">средний ER</span></div>
          ${hourRows.length
            ? html`${columnsChart(hourRows, { ariaLabel: 'Средний ER по часам публикаций' })}
                <p class="card__hint" style="margin-top:8px">
                  ${bestTimes.hours[0]
                    ? `Лучший час — ${String(bestTimes.hours[0].key).padStart(2, '0')}:00, ER ${formatPercent(bestTimes.hours[0].avgEr)} (${bestTimes.hours[0].count} ${plural(bestTimes.hours[0].count, 'ролик', 'ролика', 'роликов')}).`
                    : ''}
                </p>`
            : html`<p class="card__hint">Недостаточно данных.</p>`}
        </div>
        <div class="card">
          <div class="card__head"><h2 class="card__title">Дни недели</h2><span class="card__hint">средний ER</span></div>
          ${weekdayRows.length
            ? columnsChart(weekdayRows, { ariaLabel: 'Средний ER по дням недели' })
            : html`<p class="card__hint">Недостаточно данных.</p>`}
          <p class="card__hint" style="margin-top:8px">Часовой пояс: Europe/Moscow. При малой выборке выводы ориентировочные.</p>
        </div>
        <div class="card">
          <div class="card__head"><h2 class="card__title">Тональность</h2></div>
          ${sentimentBar(sentiment)}
          ${hashtags.length
            ? html`<div class="chips" style="margin-top:14px">
                ${hashtags.slice(0, 8).map((t) => html`<span class="badge">#${t.tag}</span>`)}
              </div>`
            : ''}
        </div>
      </section>

      <section class="grid grid--2" style="margin-top:16px">
        <div class="card">
          <div class="card__head"><h2 class="card__title">Лучшие ролики</h2></div>
          ${videosTable(outliers, { showAccount: false })}
        </div>
        <div class="card">
          <div class="card__head"><h2 class="card__title">Слабые ролики</h2></div>
          ${videosTable(weakest, { showAccount: false })}
        </div>
      </section>
    `,
  });
}

export function videosPage(videos, { mode, providerReason, platform = null, account = null }) {
  return layout({
    title: 'Ролики',
    active: 'videos',
    mode,
    providerReason,
    body: html`
      <div class="page-head">
        <div class="page-head__titles">
          <h1>Ролики</h1>
          <p class="page-head__lead">
            Последние загруженные ролики${account ? ` аккаунта @${account.handle}` : ''}${platform ? ` · ${PLATFORM_LABELS[platform]}` : ''}.
            Отсортированы по дате публикации.
          </p>
        </div>
        <div class="page-head__actions">
          <div class="row" role="group" aria-label="Фильтр по платформе">
            <a class="btn btn--small${!platform ? ' btn--primary' : ''}" href="/videos">Все</a>
            ${Object.entries(PLATFORM_LABELS).map(([key, label]) => html`
              <a class="btn btn--small${platform === key ? ' btn--primary' : ''}" href="/videos?platform=${key}">${label}</a>
            `)}
          </div>
          <a class="btn" href="/api/videos.csv">CSV</a>
        </div>
      </div>
      <div class="card card--flush">
        <div style="padding:8px">${videosTable(videos, { emptyText: 'Роликов нет. Добавьте аккаунт и запустите синхронизацию.' })}</div>
      </div>
    `,
  });
}

export function videoPage(data, { mode, providerReason }) {
  const { video, account, percentile, rank, viewsVsMedian, erVsAccount, followerReach, siblings } = data;
  return layout({
    title: video.title,
    active: 'videos',
    mode,
    providerReason,
    body: html`
      <nav class="breadcrumbs" aria-label="Хлебные крошки" style="margin-bottom:12px">
        <a href="/videos">Ролики</a><span class="breadcrumbs__sep">/</span>
        <a href="/accounts/${account.id}">@${account.handle}</a><span class="breadcrumbs__sep">/</span>
        <span>${formatShortDate(video.publishedAt)}</span>
      </nav>
      <div class="grid grid--main">
        <div class="stack">
          <div class="card">
            <div class="video-head">
              <div class="row" style="gap:8px">
                ${platformBadge(video.platform)}
                <a class="badge" href="/accounts/${account.id}">@${account.handle}</a>
                <span class="badge">${formatDateTime(video.publishedAt)}</span>
                ${video.durationSeconds ? html`<span class="badge">${Math.floor(video.durationSeconds / 60)}:${String(video.durationSeconds % 60).padStart(2, '0')}</span>` : ''}
              </div>
              <h1 class="video-head__title">${video.title}</h1>
              <div class="video-head__meta">
                <span>Просмотры: <strong>${formatNumber(video.views)}</strong></span>
                <span>Лайки: <strong>${formatNumber(video.likes)}</strong></span>
                <span>Комментарии: <strong>${formatNumber(video.comments)}</strong></span>
                <span>Репосты: <strong>${formatNumber(video.shares)}</strong></span>
                ${video.saves ? html`<span>Сохранения: <strong>${formatNumber(video.saves)}</strong></span>` : ''}
              </div>
              ${video.url ? html`<a class="btn btn--small" href="${video.url}" target="_blank" rel="noopener noreferrer nofollow">Открыть оригинал ↗</a>` : ''}
            </div>
          </div>

          <section class="grid grid--3">
            ${statCard({ label: 'ER ролика', value: formatPercent(video.engagementRate), meta: `в ${erVsAccount ? `${erVsAccount.toFixed(2)}×` : '—'} к среднему по аккаунту` })}
            ${statCard({ label: 'Охват к медиане', value: viewsVsMedian ? `${viewsVsMedian.toFixed(2)}×` : '—', meta: `медиана ${formatNumber(data.summary.medianViews)}` })}
            ${statCard({ label: 'Место в аккаунте', value: rank !== null && rank >= 0 ? `${rank + 1} из ${data.summary.count}` : '—', meta: percentile !== null ? `лучше ${Math.round(percentile)}% роликов` : '' })}
          </section>

          <div class="card">
            <div class="card__head"><h2 class="card__title">Текст ролика</h2></div>
            <p class="prose">${video.description || 'Описание не загружено.'}</p>
            ${video.hashtags.length
              ? html`<div class="chips" style="margin-top:12px">
                  ${video.hashtags.map((tag) => html`<span class="badge">#${tag}</span>`)}
                </div>`
              : ''}
            <div class="row" style="margin-top:14px;gap:18px">
              <span class="cell-title__sub">${video.text.words} слов</span>
              <span class="cell-title__sub">${video.text.hashtags} хештегов</span>
              <span class="cell-title__sub">${formatPercent(video.text.cyrillicShare, 0)} кириллицы</span>
            </div>
          </div>

          <div class="card">
            <div class="card__head"><h2 class="card__title">Приёмы в этом ролике</h2></div>
            <div class="chips">
              ${Object.entries({ question: 'Вопрос', cta: 'Призыв к действию', numbers: 'Цифры', personal: 'Личный опыт', urgency: 'Срочность', list: 'Список' })
                .map(([key, label]) => html`<span class="badge ${video.hooks[key] ? 'badge--live' : ''}">${video.hooks[key] ? '✓' : '—'} ${label}</span>`)}
            </div>
          </div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card__head"><h2 class="card__title">Что можно сделать</h2></div>
            ${video.engagementRate < data.summary.avgEr * 0.7
              ? html`<div class="insight insight--warning">
                  <span class="insight__icon">!</span>
                  <div class="insight__body">
                    <span class="insight__title">Вовлечённость ниже среднего по аккаунту</span>
                    <span class="insight__detail">ER ${formatPercent(video.engagementRate)} против ${formatPercent(data.summary.avgEr)} в среднем. Стоит проверить хук и призыв к действию.</span>
                  </div>
                </div>`
              : html`<div class="insight insight--opportunity">
                  <span class="insight__icon">↑</span>
                  <div class="insight__body">
                    <span class="insight__title">Вовлечённость на уровне или выше среднего</span>
                    <span class="insight__detail">ER ${formatPercent(video.engagementRate)} при среднем ${formatPercent(data.summary.avgEr)}. Формат можно повторить.</span>
                  </div>
                </div>`}
            ${percentile !== null && percentile >= 75
              ? html`<div class="insight insight--opportunity" style="margin-top:10px">
                  <span class="insight__icon">★</span>
                  <div class="insight__body">
                    <span class="insight__title">Ролик в верхней четверти аккаунта</span>
                    <span class="insight__detail">Он входит в 25 % лучших по просмотрам. Разберите тему и структуру и сделайте продолжение.</span>
                  </div>
                </div>`
              : ''}
          </div>
          <div class="card">
            <div class="card__head"><h2 class="card__title">Другие ролики аккаунта</h2></div>
            <div class="list">
              ${siblings.map((v) => html`
                <div class="list__item">
                  <div style="min-width:0;flex:1">
                    <a class="cell-title__main" href="/videos/${v.id}" style="font-size:0.86rem">${v.title}</a>
                    <span class="cell-title__sub">${formatShortDate(v.publishedAt)} · ${formatNumber(v.views)} просмотров · ER ${formatPercent(v.engagementRate)}</span>
                  </div>
                </div>
              `)}
            </div>
          </div>
          ${data.growth
            ? html`<div class="card">
                <div class="card__head"><h2 class="card__title">Прирост после публикации</h2></div>
                <p class="card__hint">По снимкам метрик: ${formatNumber(data.growth.viewsGrowth)} просмотров за ${Math.round(data.growth.days)} дн.</p>
              </div>`
            : ''}
        </div>
      </div>
    `,
  });
}

export function helpPage({ mode, providerReason, provider, overview }) {
  return layout({
    title: 'Как это работает',
    active: 'help',
    mode,
    providerReason,
    body: html`
      <div class="page-head">
        <div class="page-head__titles">
          <h1>Как это работает</h1>
          <p class="page-head__lead">Что сервис делает, откуда берёт данные и где границы точности.</p>
        </div>
      </div>
      <div class="doc">
        <section class="card stack">
          <h2>Что делает сервис</h2>
          <p>Вы добавляете публичные профили креаторов в Instagram, YouTube и TikTok. Сервис загружает последние ролики, хранит их метрики и разбирает содержание: темы, хештеги, приёмы подачи и тональность. На основе этого он показывает сводку и формулирует выводы: что растёт, что проседает, какие темы дают охват.</p>
          <ul>
            <li>Сводная статистика: просмотры, вовлечённость (ER), охват, подписчики.</li>
            <li>Динамика по неделям и сравнение периодов.</li>
            <li>Разбор содержания: ключевые темы, хештеги, приёмы подачи, тональность.</li>
            <li>Лучшее время публикации и ритм публикаций.</li>
            <li>Выводы на естественном языке с указанием, на каких данных они основаны.</li>
            <li>Выгрузка в CSV для таблиц.</li>
          </ul>
        </section>

        <section class="card stack">
          <h2>Откуда данные</h2>
          <p>Сейчас сервис работает в режиме <strong>${mode === 'demo' ? 'демо-данных' : 'живого источника'}</strong>. ${providerReason}</p>
          <table>
            <thead><tr><th>Режим</th><th>Что это значит</th></tr></thead>
            <tbody>
              <tr><td><code>demo</code></td><td>Данные генерируются детерминированно. Нужны, чтобы интерфейс и анализ работали без сети и без ключей. Цифры не являются статистикой реальных аккаунтов.</td></tr>
              <tr><td><code>ytdlp</code></td><td>Публичные данные через <code>yt-dlp</code>. Требует установленного yt-dlp и сетевого доступа к платформам.</td></tr>
              <tr><td><code>auto</code></td><td>Если yt-dlp установлен — используется он, иначе демо-режим. Значение по умолчанию.</td></tr>
            </tbody>
          </table>
          <p>Переключение — переменной окружения <code>PROVIDER</code>. Путь к yt-dlp задаётся <code>YTDLP_PATH</code>.</p>
        </section>

        <section class="card stack">
          <h2>Ограничения, о которых важно знать</h2>
          <ul>
            <li><strong>Платформы закрываются.</strong> Instagram и TikTok ограничивают автоматический доступ: возможны ошибки «требуется вход», «слишком много запросов» или страница-заглушка вместо профиля. Сервис показывает такую ошибку честно и не подставляет выдуманные числа.</li>
            <li><strong>Просмотры у TikTok и Instagram часто скрыты</strong> на странице профиля. ER тогда считается от доступных метрик, а часть графиков остаётся пустой.</li>
            <li><strong>Анализ текста — словарный.</strong> Темы и тональность определяются по словарю и морфологии, а не языковой моделью. Это быстро, приватно и бесплатно, но грубее ML-модели.</li>
            <li><strong>Выводы описательные, не причинные.</strong> «Ролики с вопросом дают ER выше» означает корреляцию на вашей выборке, а не доказанное причинное влияние.</li>
            <li><strong>Малые выборки.</strong> При нескольких роликах выводы о времени публикации и тональности помечаются как ненадёжные.</li>
            <li><strong>Данные — снимок.</strong> Метрики фиксируются на момент синхронизации и не обновляются сами.</li>
          </ul>
        </section>

        <section class="card stack">
          <h2>Как считаются метрики</h2>
          <ul>
            <li><strong>ER</strong> = (лайки + комментарии + репосты + сохранения) / просмотры × 100.</li>
            <li><strong>ER к подписчикам</strong> = просмотры / подписчики × 100 — показывает, насколько ролик выходит за пределы своей аудитории.</li>
            <li><strong>Ориентир ER</strong> — 4 % для Instagram, 2,5 % для YouTube, 5 % для TikTok. Это середина диапазонов из отраслевых обзоров, а не официальные данные платформ: сравнение с ориентиром — повод присмотреться, а не приговор.</li>
            <li><strong>Медиана</strong> используется вместо среднего там, где один вирусный ролик искажает картину.</li>
            <li><strong>Выбросы</strong> — правило Тьюки: выше третьего квартиля плюс 1,5 межквартильного размаха.</li>
            <li><strong>Темы</strong> — основы слов после отсечения суффиксов и стоп-слов; множитель охвата сравнивает средний охват роликов с темой со средним по всем роликам.</li>
          </ul>
        </section>

        <section class="card stack">
          <h2>Приватность</h2>
          <p>Сервис работает на вашем сервере: база — локальный файл SQLite в каталоге <code>data/</code>. Тексты роликов не отправляются во внешние сервисы анализа. Наружу уходят только запросы к самим платформам за публичными данными, если включён живой режим. Cookies и пароли сервис не запрашивает и не хранит.</p>
        </section>

        <section class="card stack">
          <h2>Текущее состояние</h2>
          <p>${overview.accounts} ${plural(overview.accounts, 'аккаунт', 'аккаунта', 'аккаунтов')}, ${overview.videos} ${plural(overview.videos, 'ролик', 'ролика', 'роликов')}, платформ: ${overview.platforms}. Провайдер: <code>${provider.name}</code>${provider.version ? ` (yt-dlp ${provider.version})` : ''}.</p>
        </section>
      </div>
    `,
  });
}

export function notFoundPage({ mode, providerReason }) {
  return layout({
    title: 'Страница не найдена',
    mode,
    providerReason,
    body: html`
      <div class="card">${emptyState({
        title: 'Страница не найдена',
        text: 'Возможно, аккаунт или ролик был удалён.',
        action: html`<a class="btn btn--primary" href="/">На главную</a>`,
      })}</div>`,
  });
}

export { weekdayIndex };
