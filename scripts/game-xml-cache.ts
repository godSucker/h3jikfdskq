// Кеш игровых XML на время ОДНОГО прогона скрипта.
//
// shopitems.xml весит ~4.6 МБ, и за один прогон build-announcements.ts он
// качался 4 раза: fetchShopForecast(cs), fetchShopForecast(cs+1),
// fetchDailyNewsForecast (buildShopItemIndex) и buildShopFilterMap.
// gamedefinitions.xml - дважды (fetchHallContracts + fetchMysteryContracts).
// При 10 прогонах в день это десятки лишних мегабайт и лишние секунды на
// каждом шаге.
//
// Кешируем ПРОМИС, а не результат: если два детектора стартуют параллельно
// (Promise.all в detectShopForecast), второй подхватит уже летящий запрос,
// а не заведёт свой.
//
// Живёт только внутри процесса - между шагами workflow это разные процессы,
// там кеша нет и не надо: данные между шагами вполне могут обновиться.

import axios from 'axios'

const inflight = new Map<string, Promise<string>>()

export function fetchGameXml(url: string, timeout = 30000): Promise<string> {
  let p = inflight.get(url)
  if (!p) {
    p = axios
      .get<string>(url, { responseType: 'text', timeout })
      .then((r) => r.data)
      .catch((err) => {
        // Неудачу не кешируем - следующий вызов должен попробовать заново.
        inflight.delete(url)
        throw err
      })
    inflight.set(url, p)
  }
  return p
}
