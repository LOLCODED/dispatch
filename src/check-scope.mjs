const maxPatterns = 20, maxScopes = 24;
const matchEverything = new Set(['*', '**', '**/*', '/**', '/*']);

export function globRegExp(pattern) {
  const anchored = pattern.includes('/');
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      const slash = pattern[index + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      index += slash ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${source.replace(/^\//, '')}$`);
}

function scopePaths(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} need a list of path patterns.`);
  const paths = [...new Set(value.map(path => typeof path === 'string' ? path.trim() : path).filter(path => path !== ''))];
  if (paths.length > maxPatterns) throw new Error(`Use at most ${maxPatterns} path patterns per scope.`);
  for (const path of paths) {
    if (typeof path !== 'string' || path.length > 200 || path.split('/').includes('..')) throw new Error(`${label} path patterns must be repository-relative and under 200 characters.`);
    if (matchEverything.has(path)) throw new Error(`"${path}" matches every file and would skip checks for all changes.`);
  }
  return paths;
}

function scopeChecks(value, validation) {
  if (!Array.isArray(value ?? [])) throw new Error('A check scope needs a list of checks.');
  const ids = new Set(validation.map(step => step.id));
  return [...new Set(value ?? [])].filter(id => ids.has(id));
}

export function textOnlySettings(value, validation) {
  if (value === undefined || value === null) return { paths: [], checks: [] };
  if (typeof value !== 'object' || !Array.isArray(value.paths)) throw new Error('Text-only rules need a list of path patterns and a list of checks.');
  const paths = scopePaths(value.paths, 'Text-only'), checks = scopeChecks(value.checks, validation);
  return { paths, checks: paths.length ? checks : [] };
}

export function scopeSettings(value, validation) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('Check scopes need a list of scopes.');
  if (value.length > maxScopes) throw new Error(`Use at most ${maxScopes} check scopes.`);
  const scopes = value.map((scope, index) => {
    if (!scope || typeof scope !== 'object') throw new Error('Each check scope needs paths and checks.');
    const id = String(scope.id ?? `scope-${index + 1}`).trim().slice(0, 40) || `scope-${index + 1}`;
    return { id, paths: scopePaths(scope.paths, 'Check scope'), checks: scopeChecks(scope.checks, validation) };
  }).filter(scope => scope.paths.length);
  if (new Set(scopes.map(scope => scope.id)).size !== scopes.length) throw new Error('Check scope names must be unique.');
  return scopes;
}

export function protectedPaths(value) {
  if (!Array.isArray(value)) throw new Error('Protected paths need a list of path patterns.');
  return scopePaths(value, 'Protected');
}

export function recipeScopes(input, validation) {
  const scopes = input.checkScopes !== undefined ? scopeSettings(input.checkScopes, validation) : null;
  if (scopes?.length) return scopes;
  const legacy = textOnlySettings(input.textOnly, validation);
  return legacy.paths.length ? [{ id: 'text-only', paths: legacy.paths, checks: legacy.checks }] : scopes ?? [];
}

export function projectScopes(project) {
  if (Array.isArray(project?.checkScopes)) return project.checkScopes;
  const legacy = project?.textOnly;
  return legacy?.paths?.length ? [{ id: 'text-only', paths: legacy.paths, checks: legacy.checks ?? [] }] : [];
}

export function checkScope(project, changedPaths) {
  const scopes = projectScopes(project), steps = project.validation;
  const everything = { scoped: false, matched: [], steps, skipped: [] };
  if (!scopes.length || !changedPaths?.length) return everything;
  const compiled = scopes.map(scope => ({ scope, patterns: scope.paths.map(globRegExp) }));
  const matched = new Set();
  for (const path of changedPaths) {
    const hits = compiled.filter(({ patterns }) => patterns.some(pattern => pattern.test(path)));
    if (!hits.length) return everything;
    for (const hit of hits) matched.add(hit.scope);
  }
  const kept = new Set([...matched].flatMap(scope => scope.checks));
  return { scoped: true, matched: [...matched], steps: steps.filter(step => kept.has(step.id)), skipped: steps.filter(step => !kept.has(step.id)) };
}

export const savedRecipe = project => ({ validation: project.validation ?? [], setup: project.setup ?? [], checkScopes: projectScopes(project) });
export const recipeDiffers = (snapshot, saved) => JSON.stringify(savedRecipe(snapshot)) !== JSON.stringify(savedRecipe(saved));
const stepIds = steps => steps.map(step => step.id).join(', ') || 'none';
export function recipeChange(name, before, after) {
  const changed = ['validation', 'setup', 'checkScopes'].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  const parts = changed.map(key => key === 'validation' ? `checks ${stepIds(before.validation)} → ${stepIds(after.validation)}` : key === 'setup' ? `setup ${stepIds(before.setup)} → ${stepIds(after.setup)}` : 'check scopes');
  return `${name} picked up its saved settings: ${parts.join('; ')}.`;
}
