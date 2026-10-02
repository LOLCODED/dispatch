export const usageKeys = ['input_tokens', 'cached_input_tokens', 'output_tokens'];
const count = value => Number.isFinite(value) && value >= 0 ? value : null;
export function usageDelta(current, previous) {
  if (!current || !previous) return null;
  return Object.fromEntries(usageKeys.map(key => {
    const after = count(current[key]), before = count(previous[key]);
    return [key, after != null && before != null && after >= before ? after - before : null];
  }));
}
