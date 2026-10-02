export function textMatches(fields, query) {
  const wanted = String(query ?? '').trim().toLowerCase();
  if (!wanted) return true;
  return fields.filter(field => field !== null && field !== undefined).some(field => String(field).toLowerCase().includes(wanted));
}

export function filterSort(items, { query = '', matches, compare } = {}) {
  const filtered = matches && String(query).trim() ? items.filter(item => matches(item, query)) : items;
  return compare ? [...filtered].sort(compare) : filtered;
}

export function pageOf(items, page, size) {
  const pages = Math.max(1, Math.ceil(items.length / size)), current = Math.min(Math.max(0, page), pages - 1);
  return { items: items.slice(current * size, (current + 1) * size), page: current, pages, total: items.length };
}

const numeric = direction => read => (a, b) => {
  const left = read(a) ?? null, right = read(b) ?? null;
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction * (left - right);
};
export const ascending = numeric(1), descending = numeric(-1);
export const byText = read => (a, b) => String(read(a) ?? '').localeCompare(String(read(b) ?? ''));
export const timeOf = value => Date.parse(value) || null;
