// Замок «этот аккаунт уже синхронизируется».
//
// Отдельный модуль без зависимостей, потому что им пользуются и провайдеры
// (ручная синхронизация), и планировщик: если бы замок лежал в любом из них,
// получился бы цикл импортов.
const inFlight = new Set();

export function isSyncInFlight(accountId) {
  return inFlight.has(Number(accountId));
}

export function markInFlight(accountId) {
  inFlight.add(Number(accountId));
}

export function clearInFlight(accountId) {
  inFlight.delete(Number(accountId));
}

export function inFlightIds() {
  return [...inFlight];
}

/** Только для тестов: сбрасывает замок между сценариями. */
export function resetInFlight() {
  inFlight.clear();
}
