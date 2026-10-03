import { randomUUID } from 'node:crypto';
import { modelChoice } from './execution.mjs';
import { InputError } from './engine.mjs';
import { taskRepositories } from './repository-selection.mjs';
import { agentPrimary } from './repository.mjs';
import { autoRepository, homeAndSaved } from './home-repository.mjs';
import { latestRun } from './conversations.mjs';
import { openRemaining, remainingTaskInput } from './remaining.mjs';
import { TaskImages, decodeTaskImages } from './task-images.mjs';

const titleOf = text => text.split('\n')[0].slice(0, 120);
const imageDigests = images => JSON.stringify((images ?? []).map(image => image.sha256));
const runProjectIds = run => run.repositorySelection?.mode === 'agent' ? 'all' : run.repositorySelection?.projectIds?.length > 1 ? run.repositorySelection.projectIds : undefined;

// Saving is local only. Starting delegates to the same live lifecycle as the
// composer; task->run linkage is persisted in the run's first atomic save.
export class Tasks {
  constructor(live) { this.live = live; this.engine = live.engine; this.pending = new Map(); this.images = new TaskImages(this.engine.dataDir); }
  get records() { return this.engine.store.state.tasks; }
  linkedRun(id) {
    const runs = this.engine.runs;
    return latestRun(runs, runs.find(run => run.taskId === id));
  }
  list() {
    return this.records.map(task => {
      const run = this.linkedRun(task.id);
      return { ...task, runId: run?.id ?? null, status: run?.status ?? 'saved' };
    });
  }
  instructions(input) {
    if (typeof input !== 'string' || !input.trim() || input.length > 12000) throw new InputError('Enter task instructions (up to 12,000 characters).');
    return input.trim();
  }
  execution(input) {
    const execution = input === undefined || input === 'auto' ? 'auto' : modelChoice(input, this.live.modelCatalog.models);
    if (execution === null) throw new InputError('Choose Auto or a model.');
    return execution;
  }
  // A saved task always knows its repositories: an automatic or agent-decides primary is fixed at save time from the text.
  repositories(input, text) {
    const choice = taskRepositories(input, this.live.projects);
    const projects = this.live.projects, { home, saved } = homeAndSaved(projects, this.live.homePath);
    const primary = choice.mode === 'manual' ? projects.find(project => project.id === choice.ids[0]) : choice.mode === 'agent' ? agentPrimary(text, saved).project : home && autoRepository(text, projects, home).project;
    if (!primary) throw new InputError('Choose a saved repository.');
    return { projectId: primary.id, projectIds: choice.mode === 'agent' ? 'all' : choice.inherit ? undefined : choice.ids };
  }
  save(input) {
    if (this.engine.stopping) throw new InputError('Server is stopping', 503);
    const text = this.instructions(input.input), execution = this.execution(input.execution), { projectId, projectIds } = this.repositories(input, text), images = decodeTaskImages(input.images);
    const existing = this.records.find(task => task.projectId === projectId && JSON.stringify(task.projectIds ?? null) === JSON.stringify(projectIds ?? null) && task.input === text && JSON.stringify(task.execution ?? 'auto') === JSON.stringify(execution) && imageDigests(task.images) === imageDigests(images) && !this.engine.runs.some(run => run.taskId === task.id));
    if (existing) return existing;
    if (input.kind !== undefined && !['change', 'answer'].includes(input.kind)) throw new InputError('Task kind must be change or answer.');
    const source = input.sourceRunId === undefined ? null : this.engine.runs.find(run => run.id === input.sourceRunId && run.projectId === projectId);
    if (input.sourceRunId !== undefined && !source) throw new InputError('The source run is not in this repository.');
    const id = randomUUID(), saved = this.images.write(id, images);
    const task = { id, projectId, ...(projectIds ? { projectIds } : {}), execution, kind: input.kind ?? 'change', title: titleOf(text), input: text, ...(saved.length ? { images: saved } : {}), ...(source ? { sourceRunId: source.id } : {}), createdAt: new Date().toISOString() };
    this.records.unshift(task); this.engine.store.save(); return task;
  }
  // Unbuilt work either becomes its own Todo task or is dropped; the run's tested result stays for review either way.
  settleRemaining(runId, { action } = {}) {
    const run = this.engine.get(runId);
    if (!openRemaining(run)) throw new InputError('This task has no unbuilt work waiting for a decision.', 409);
    if (!['task', 'finish'].includes(action)) throw new InputError('Choose task or finish.');
    const task = action === 'task' ? this.save({ projectId: run.projectId, projectIds: runProjectIds(run), input: remainingTaskInput(run), sourceRunId: run.id }) : null;
    run.remaining = { ...run.remaining, resolution: action, ...(task && { taskId: task.id }), resolvedAt: new Date().toISOString() };
    this.engine.store.save();
    return run;
  }
  image(id, number) {
    const task = this.records.find(task => task.id === id), image = task && this.images.read(task, number);
    if (!image) throw new InputError('Image not found', 404);
    return image;
  }
  editable(id) {
    const task = this.records.find(task => task.id === id);
    if (!task) throw new InputError('Task not found', 404);
    if (this.pending.has(id) || this.linkedRun(id)) throw new InputError('This task has started; continue it from its run.', 409);
    return task;
  }
  update(id, input) {
    const task = this.editable(id);
    const text = this.instructions(input.input), execution = this.execution(input.execution);
    Object.assign(task, { input: text, title: titleOf(text), execution }); this.engine.store.save(); return task;
  }
  async start(id) {
    const task = this.records.find(task => task.id === id);
    if (!task) throw new InputError('Task not found', 404);
    const existing = this.linkedRun(id);
    if (existing) return existing;
    if (this.pending.has(id)) return this.pending.get(id);
    const promise = this.live.create({ projectId: task.projectId, projectIds: task.projectIds, input: task.input, execution: task.execution, kind: task.kind, ...this.images.payload(task) }, { taskId: task.id });
    this.pending.set(id, promise);
    try { const run = await promise; this.images.remove(id); return run; } finally { this.pending.delete(id); }
  }
}
