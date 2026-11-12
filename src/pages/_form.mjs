import { site, contactMethods } from '../content/site.mjs';
import { icon } from '../lib/icons.mjs';
import { escapeHtml } from '../lib/html.mjs';

/**
 * Форма заявки. Разметка одинаковая для встроенной и модальной версии,
 * отличается только префикс id — чтобы label/aria-связи оставались валидными.
 */
export function formMarkup({ id, heading, compact = false }) {
  const p = `${id}-`;
  return `<form class="lead-form${compact ? ' lead-form--compact' : ''}" id="${id}" action="/api/lead" method="post" novalidate data-lead-form>
  <h3 class="lead-form__title">${escapeHtml(heading)}</h3>
  <p class="lead-form__hint">Перезвоним в течение ${site.responseMinutes} минут в рабочее время. Без спама и навязчивых звонков.</p>

  <div class="field">
    <label for="${p}name">Имя<span class="field__req" aria-hidden="true"> *</span></label>
    <input type="text" id="${p}name" name="name" autocomplete="name" required minlength="2" maxlength="50"
           placeholder="Как к вам обращаться" aria-describedby="${p}name-error" data-field="name">
    <p class="field__error" id="${p}name-error" data-error-for="name" hidden></p>
  </div>

  <div class="field">
    <label for="${p}phone">Телефон<span class="field__req" aria-hidden="true"> *</span></label>
    <input type="tel" id="${p}phone" name="phone" autocomplete="tel" inputmode="tel" required
           placeholder="+7 (___) ___-__-__" aria-describedby="${p}phone-error" data-field="phone" data-phone>
    <p class="field__error" id="${p}phone-error" data-error-for="phone" hidden></p>
  </div>

  <div class="field">
    <label for="${p}comment">Комментарий</label>
    <textarea id="${p}comment" name="comment" rows="3" maxlength="500"
              placeholder="Например: кухня 9 м², нужен замер на следующей неделе"
              aria-describedby="${p}comment-error ${p}comment-hint" data-field="comment"></textarea>
    <p class="field__hint" id="${p}comment-hint">До 500 символов</p>
    <p class="field__error" id="${p}comment-error" data-error-for="comment" hidden></p>
  </div>

  <fieldset class="field field--choice">
    <legend>Способ связи</legend>
    <div class="choice-row">
      ${contactMethods
        .map(
          (m, i) => `<label class="choice">
        <input type="radio" name="contactMethod" value="${m.value}"${i === 0 ? ' checked' : ''}>
        <span>${escapeHtml(m.label)}</span>
      </label>`,
        )
        .join('')}
    </div>
    <p class="field__error" data-error-for="contactMethod" hidden></p>
  </fieldset>

  <div class="field field--consent">
    <label class="check">
      <input type="checkbox" name="consent" value="on" required data-field="consent">
      <span>Согласен на обработку персональных данных и принимаю <a href="/privacy.html" target="_blank" rel="noopener">политику конфиденциальности</a></span>
    </label>
    <p class="field__error" data-error-for="consent" hidden></p>
  </div>

  <div class="hp" aria-hidden="true">
    <label for="${p}website">Не заполняйте это поле</label>
    <input type="text" id="${p}website" name="website" tabindex="-1" autocomplete="off">
  </div>

  <button type="submit" class="btn btn--primary btn--block" data-submit>
    <span data-submit-label>Отправить заявку</span>
    <span class="spinner" aria-hidden="true" hidden></span>
  </button>

  <p class="form-status" role="status" aria-live="polite" data-form-status></p>
  <p class="form-note">${icon('shield', { size: 16 })} Данные передаются по HTTPS и не используются для рекламы.</p>
</form>`;
}

export const formFields = ['name', 'phone', 'comment', 'contactMethod', 'consent'];
