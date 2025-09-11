// apps/api/src/workers.ts
export { runYandexPull } from './workers/yandexPull.js';
export { runLidarrPull, runLidarrPullEx } from './workers/lidarrPull.js';
export { runMbMatch, runCustomArtistsMatch } from './workers/mbMatch.js';
export { runLidarrPush } from './workers/lidarrPush.js';
export { runLidarrSearchArtists } from './workers/lidarrSearchArtists.js';
export { runNavidromePlan } from './workers/runNavidromePlan.js';
// Совместимые обёртки под старые импорты из routes/sync.ts, routes/yandex.ts и scheduler.ts
export {
  runCustomMatchAll,
  runCustomPushAll,
  runYandexPullAll,
  runYandexMatch,
  runYandexPush,
} from './workers/index.js';