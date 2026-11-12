// Морфологический «стеммер» русского и английского языков.
//
// Задача скромная: свести словоформы к общей основе, чтобы «рецепт», «рецепты»,
// «рецептов» считались одним термином. Полноценная лемматизация (pymorphy)
// здесь избыточна и добавила бы зависимость в рантайм.

const RU_SUFFIXES = [
  'ирования', 'ирование', 'ования', 'ование', 'ения', 'ение', 'ания', 'ание',
  'ость', 'ости', 'остей', 'ами', 'ями', 'ого', 'его', 'ому', 'ему', 'ыми',
  'ими', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ой', 'ей', 'ий', 'ый', 'ов',
  'ев', 'ах', 'ях', 'ам', 'ям', 'ом', 'ем', 'ую', 'юю', 'а', 'я', 'о', 'е',
  'ы', 'и', 'у', 'ю', 'ь',
];

const EN_SUFFIXES = ['ations', 'ation', 'ings', 'ing', 'ies', 'ied', 'ers', 'er', 'ed', 'es', 's'];

const RU_VOWELS = new Set([...'аеёиоуыэюя']);

export function normalizeWord(raw) {
  let w = String(raw || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  // Убираем эмодзи и всё, что не буква/цифра.
  w = w.replace(/[^\p{L}\p{N}-]+/gu, '');
  if (!w) return '';
  if (/^[a-z0-9-]+$/.test(w)) {
    for (const suffix of EN_SUFFIXES) {
      if (w.length - suffix.length >= 4 && w.endsWith(suffix)) return w.slice(0, -suffix.length);
    }
    return w;
  }
  if (!/^[\u0400-\u04FF-]+$/.test(w)) return w;
  if (w.length <= 4) return w;
  for (const suffix of RU_SUFFIXES) {
    if (w.length - suffix.length >= 3 && w.endsWith(suffix)) {
      const stem = w.slice(0, -suffix.length);
      // Не отрезаем суффикс, если он оставляет сплошные согласные без гласной.
      if ([...stem].some((ch) => RU_VOWELS.has(ch))) return stem;
    }
  }
  return w;
}

export function tokenize(text) {
  return String(text || '')
    .split(/[^\p{L}\p{N}]+/gu)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function stemTokens(text) {
  return tokenize(text).map(normalizeWord).filter(Boolean);
}
