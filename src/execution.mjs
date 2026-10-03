import { InputError } from './engine.mjs';
import { providerCatalog, providerName } from './providers.mjs';

export const modelPreferenceKey = 'execution.model';
const tierLimit = 8;

export function modelChoice(value, models) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || typeof value.provider !== 'string' || !models.some(model => model.provider === value.provider)) throw new InputError('Choose a model from an enabled provider. Refresh models in Settings if it is missing.');
  const model = models.find(model => model.provider === value.provider && model.model === value.model);
  if (!model) throw new InputError('This model is unavailable. Refresh models in Setup and choose again.');
  const effort = value.effort ?? model.defaultReasoningEffort ?? null;
  if (effort !== null && !model.supportedReasoningEfforts.some(option => option.reasoningEffort === effort)) throw new InputError('Choose a reasoning level supported by this model.');
  return { provider: model.provider, model: model.model, effort };
}
const validChoice = (value, models) => { try { return modelChoice(value, models); } catch { return null; } };
export const sameModel = (a, b) => Boolean(a && b) && a.provider === b.provider && a.model === b.model && (a.effort ?? null) === (b.effort ?? null);
export const modelLabel = choice => `${providerName(choice.provider)} ${choice.model ?? 'CLI default'}${choice.effort ? ` · ${choice.effort}` : ''}`;

export const modelValue = choice => `${choice.provider}/${choice.model}${choice.effort ? `@${choice.effort}` : ''}`;
export function parseModelValue(value) {
  const match = typeof value === 'string' && value.match(/^([a-z][a-z0-9-]*)\/([^@\s]+)(?:@([A-Za-z0-9_-]+))?$/);
  return match ? { provider: match[1], model: match[2], effort: match[3] ?? null } : null;
}

function storedTier(entry) {
  if (!entry || typeof entry !== 'object' || !providerCatalog.some(provider => provider.id === entry.provider) || typeof entry.model !== 'string' || !entry.model || entry.model.length > 100 || (entry.effort != null && typeof entry.effort !== 'string')) throw new InputError('Each Auto tier needs a provider and a model.');
  return { provider: entry.provider, model: entry.model, effort: entry.effort ?? null };
}
// New entries must be in the catalog; entries already saved may have gone stale and are kept so reordering still saves.
export function tierList(value, models, stored = []) {
  if (!Array.isArray(value) || value.length > tierLimit) throw new InputError(`Auto tiers are a list of at most ${tierLimit} models.`);
  const tiers = value.map(entry => {
    const tier = storedTier(entry), current = validChoice(tier, models);
    if (current) return current;
    if (stored.some(item => sameModel(item, tier))) return tier;
    return modelChoice(tier, models);
  });
  if (tiers.some((tier, index) => tiers.findIndex(other => sameModel(other, tier)) !== index)) throw new InputError('Each Auto tier must be a different model or reasoning level.');
  return tiers;
}
const hiddenLimit = 500;
export const isHiddenModel = (model, hidden = []) => hidden.some(item => item.provider === model.provider && item.model === model.model);
export function toggleHiddenModel(hidden, input, models) {
  if (!input || typeof input !== 'object' || typeof input.provider !== 'string' || typeof input.model !== 'string' || typeof input.enabled !== 'boolean') throw new InputError('Choose a model and whether it is on.');
  const rest = hidden.filter(item => !isHiddenModel(input, [item]));
  if (input.enabled) return rest;
  const model = models.find(model => model.provider === input.provider && model.model === input.model);
  if (!model) throw new InputError('This model is unavailable. Refresh models and try again.');
  if (rest.length >= hiddenLimit) throw new InputError(`At most ${hiddenLimit} models can be turned off.`);
  return [...rest, { provider: model.provider, model: model.model }];
}
export const activeTiers =(tiers = [], models) => tiers.map(tier => validChoice(tier, models)).filter((tier, index, all) => tier && all.findIndex(other => sameModel(other, tier)) === index);

export function nextTier(execution, tiers, models) {
  const active = activeTiers(tiers, models);
  const index = active.findIndex(tier => sameModel(tier, execution));
  return index >= 0 ? active[index + 1] ?? null : null;
}

function autoStart(models, provider, { tiers = [], learned = null } = {}) {
  const learnedChoice = learned && validChoice(learned, models);
  if (learnedChoice) return { ...learnedChoice, mode: 'auto', reason: `Auto started on ${modelLabel(learnedChoice)}, learned for this repository.` };
  const [first] = activeTiers(tiers, models);
  if (first) return { ...first, mode: 'auto', reason: `Auto started on the first tier, ${modelLabel(first)}.` };
  const model = models.find(model => model.provider === provider && model.isDefault);
  if (model) return { ...modelChoice({ provider, model: model.model }, models), mode: 'auto', reason: `Auto used the default reported by ${providerName(provider)}.` };
  return { provider, model: null, effort: null, mode: 'auto', reason: `Auto uses your ${providerName(provider)} CLI defaults; no default model was reported.` };
}
export function selectExecution(selection, models, provider = 'codex', auto = {}) {
  if (selection !== undefined && selection !== 'auto' && (selection === null || typeof selection !== 'object' || Array.isArray(selection))) throw new InputError('Choose Auto or a model.');
  if (selection && selection !== 'auto') return { ...modelChoice(selection, models), mode: 'manual', reason: 'Selected by you.' };
  return autoStart(models, provider, auto);
}
