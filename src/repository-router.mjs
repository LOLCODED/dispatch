import { InputError } from './engine.mjs';
import { modeFor, streak } from './brain.mjs';
import { autoRepository, homeName } from './home-repository.mjs';
import { RepositoryProfiles, routingKey } from './repository-routing.mjs';
import { tiebreakCandidates, tiebreakPrompt, tiebreakVerdict } from './repository-tiebreak.mjs';
import { changedMembers, maxLinked } from './linked-repositories.mjs';
import { providerName } from './providers.mjs';

export const ticketText = ticket => `${ticket.title}\n${ticket.description}\n${ticket.acceptance}`;
const brief = project => ({ id: project.id, name: project.name });
const changedIn = run => new Set([...(run.changedPaths?.length ? [run.projectId] : []), ...changedMembers(run).map(member => member.projectId)]);
const linkKey = ids => `repository.link:${[...ids].sort().join(' ')}`;

// Repositories that keep changing in the same ticket are offered as links; follow-ups of one ticket count once.
export function linkSuggestions(runs, projects, { minimum = 2, excluded = new Set() } = {}) {
  const tickets = new Map();
  for (const run of runs) {
    if (run.mode !== 'live' || !run.ticket?.key) continue;
    const ids = [...changedIn(run)].filter(id => !excluded.has(id)).sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const pair = `${ids[i]}+${ids[j]}`;
      tickets.set(pair, (tickets.get(pair) ?? new Set()).add(run.ticket.key));
    }
  }
  const byId = new Map(projects.map(project => [project.id, project]));
  return [...tickets].map(([pair, keys]) => ({ ids: pair.split('+'), count: keys.size })).filter(({ ids, count }) => {
    const [a, b] = ids.map(id => byId.get(id));
    return count >= minimum && a && b && !(a.linked ?? []).includes(b.id) && !(b.linked ?? []).includes(a.id);
  }).sort((a, b) => b.count - a.count);
}

export class RepositoryRouter {
  constructor(live) { this.live = live; this.profiles = new RepositoryProfiles(); }

  get saved() { return this.live.savedProjects().filter(project => project.repositoryPath !== this.live.homePath); }

  learned(key) {
    const entry = this.live.brain.lookup({ key });
    return entry ? { mode: modeFor(entry), value: entry.value, count: streak(entry.answers).count } : null;
  }

  context() { return { runs: this.live.engine.runs, profiles: this.profiles.known(this.saved), learned: key => this.learned(key) }; }

  warm() { return this.profiles.warm(this.saved); }

  route(text, home) { return autoRepository(text, this.live.projects, home, this.context()); }

  async preview(input) {
    if (typeof input?.input !== 'string' || input.input.length > 12000) throw new InputError('Enter ticket text (up to 12,000 characters).');
    if (!input.input.trim()) return null;
    await this.warm();
    const home = this.live.homeProject() ?? { id: null, name: homeName, repositoryPath: this.live.homePath, linked: [] };
    const route = this.route(input.input, home), project = route.project;
    const members = (project.linked ?? []).map(id => this.live.projects.find(item => item.id === id)).filter(Boolean);
    return { stage: route.stage, confidence: route.confidence, reason: route.reason, home: project === home, project: brief(project), members: members.map(brief), ranked: route.ranked.map(item => ({ ...brief(item.project), reason: item.reason })) };
  }

  // An operator's repository choice for a ticket climbs the brain's ask → suggest → auto ladder for tickets worded the same way.
  remember(text, projectId, { runId = null, via = 'composer' } = {}) {
    const key = routingKey(text);
    if (!key || projectId === this.live.homeProject()?.id) return null;
    return this.live.brain.answer({ key, scope: 'global', value: projectId, runId, via, source: 'operator' });
  }

  suggestions() {
    const home = this.live.homeProject();
    return linkSuggestions(this.live.engine.runs, this.live.projects, { excluded: new Set(home ? [home.id] : []) })
      .filter(item => this.live.brain.lookup({ key: linkKey(item.ids) })?.value !== 'dismissed');
  }

  offerFor(run) {
    const changed = changedIn(run), offer = changed.size > 1 && this.suggestions().find(item => item.ids.every(id => changed.has(id)));
    if (!offer) return null;
    return { ...offer, names: offer.ids.map(id => this.live.projects.find(project => project.id === id)?.name ?? id) };
  }

  pair(ids) {
    const projects = Array.isArray(ids) && ids.length === 2 && ids[0] !== ids[1] ? ids.map(id => this.live.projects.find(project => project.id === id)) : [];
    if (projects.length !== 2 || projects.some(project => !project)) throw new InputError('Name two saved repositories.');
    return projects;
  }

  // Each repository of the pair links the other, so a task in either brings both; a repository already linking the most it can is left as it is.
  link(ids) {
    const [a, b] = this.pair(ids), linked = [];
    for (const [owner, other] of [[a, b], [b, a]]) if ((owner.linked ?? []).includes(other.id) || (owner.linked ?? []).length < maxLinked) { this.live.repositories.link(owner, other); linked.push(owner.name); }
    if (!linked.length) throw new InputError(`${a.name} and ${b.name} already link ${maxLinked} repositories each, the most they can.`);
    return { linked };
  }

  dismiss(ids) {
    this.pair(ids);
    this.live.brain.answer({ key: linkKey(ids), scope: 'global', value: 'dismissed', source: 'operator', via: 'verdict' });
    return { dismissed: true };
  }

  // A close call is put to the run's own model before its first turn, using each candidate's description and distinctive file words; a clear pick moves the run there, anything else leaves it in dispatch home.
  async tiebreak(run, adapter, signal) {
    const ids = run.repositorySelection?.tiebreak;
    if (!ids?.length) return;
    delete run.repositorySelection.tiebreak;
    const projects = ids.map(id => this.saved.find(project => project.id === id)).filter(Boolean);
    if (!projects.length) return;
    await this.profiles.warm(projects);
    const prompt = tiebreakPrompt(ticketText(run.ticket), tiebreakCandidates(projects, this.profiles.known(projects)));
    this.live.log(run, 'routing', `Asking ${providerName(run.execution?.provider ?? 'codex')} which of ${projects.map(project => project.name).join(', ')} this ticket belongs to.`);
    const verdict = await this.ask(run, adapter, prompt, signal, projects);
    if (signal.aborted) return;
    if (!verdict) { this.live.log(run, 'routing', 'The model did not pick one; staying in dispatch home.'); return; }
    this.live.retarget(run, verdict.project, `Selected ${verdict.project.name}: ${providerName(run.execution?.provider ?? 'codex')} picked it from the close call (${verdict.reason || 'no reason given'}).`);
  }

  async ask(run, adapter, prompt, signal, projects) {
    try {
      const result = await adapter.run({ workspace: this.live.homePath, sessionId: null, readOnly: true, execution: run.execution, prompt, signal,
        onSpawn: pid => { run.workerPid = pid; }, onLimits: limits => this.live.observeLimits(run.execution?.provider ?? 'codex', limits) });
      run.workerPid = null;
      this.live.recordUsage(run, this.live.turnUsage(run, result, null));
      return result.outcome === 'completed' ? tiebreakVerdict(result.summary, projects) : null;
    } catch (error) {
      run.workerPid = null;
      this.live.log(run, 'routing', `Routing question failed: ${error.message}`);
      return null;
    }
  }
}
