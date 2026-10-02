import { readAppServer } from './codex-read.mjs';
import { codexLimits } from './provider-limits.mjs';

const validModel = model => model && !model.hidden && typeof model.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model.model);
const modelEntry = model => ({
  model: model.model, displayName: String(model.displayName ?? model.model).slice(0, 200), isDefault: model.isDefault === true,
  defaultReasoningEffort: model.defaultReasoningEffort ?? null,
  supportedReasoningEfforts: (Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : []).filter(option => /^[a-z]{1,20}$/.test(option?.reasoningEffort ?? '')).map(option => ({ reasoningEffort: option.reasoningEffort })),
});

export function readModels(options = {}) {
  let requestId = 2, pages = 0;
  const models = [], cursors = new Set();
  const page = (send, cursor) => send({ id: requestId, method: 'model/list', params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) } });
  return readAppServer({ ...options, fallback: { available: false, models: [], message: 'Models unavailable. Check your Codex CLI and login, then refresh.' }, onReady: page,
    onResponse: (response, { send, finish, unavailable }) => {
      if (response.id !== requestId) return;
      if (response.error || !Array.isArray(response.result?.data)) { unavailable(); return; }
      models.push(...response.result.data.filter(validModel).map(modelEntry));
      const cursor = response.result.nextCursor;
      if (!cursor) { finish({ available: models.length > 0, models: [...new Map(models.map(model => [model.model, model])).values()], message: models.length ? 'Models reported by your Codex CLI.' : 'Codex did not report any models.' }); return; }
      if (typeof cursor !== 'string' || cursors.has(cursor) || ++pages >= 10) { unavailable(); return; }
      cursors.add(cursor); requestId++; page(send, cursor);
    } });
}

export function readRateLimits(options = {}) {
  return readAppServer({ ...options, fallback: { available: false, windows: [], message: 'Plan usage unavailable. Check your Codex CLI and login, then refresh.' },
    onReady: send => send({ id: 2, method: 'account/rateLimits/read' }),
    onResponse: (response, { finish, unavailable }) => {
      if (response.id !== 2) return;
      if (response.error || !response.result?.rateLimits) { unavailable(); return; }
      finish(codexLimits(response.result.rateLimits));
    } });
}
