import { randomUUID } from 'node:crypto';
import { maxConcurrency, terminal } from './catalog.mjs';
import { Store } from './store.mjs';

export const maxQueueHoldSeconds = 1800;

export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

const validConcurrency = value => Number.isInteger(value) && value >= 1 && value <= maxConcurrency;

export class Engine {
  constructor({ dataDir, concurrency = 1 } = {}) {
    this.dataDir = dataDir; this.store = new Store(dataDir); this.defaultConcurrency = concurrency;
    this.active = new Map(); this.stopping = false; this.holds = 0; this.queueHold = null;
    for (const run of this.store.state.runs) {
      for (const interaction of run.interactions ?? []) if (interaction.status === 'pending') interaction.status = 'interrupted';
      if (run.status === 'queued') this.event(run, 'recovery', 'Server restarted. Still queued; it had not started.');
      else if (!terminal.has(run.status)) {
        run.status = 'interrupted'; run.finishedAt = new Date().toISOString();
        this.event(run, 'recovery', 'Server restarted. Run stopped for inspection; no automatic replay or publication.');
      }
    }
    this.store.save();
  }
  get runs() { return this.store.state.runs; }
  get concurrency() { return validConcurrency(this.store.state.concurrency) ? this.store.state.concurrency : this.defaultConcurrency; }
  setConcurrency(value) {
    if (!validConcurrency(value)) throw new InputError(`Choose 1 to ${maxConcurrency} tasks at a time.`);
    this.store.state.concurrency = value; this.store.save(); this.pump();
    return value;
  }
  get(id) { const run = this.runs.find(x => x.id === id); if (!run) throw new InputError('Run not found', 404); return run; }
  event(run, kind, message) { run.events.push({ id: randomUUID(), at: new Date().toISOString(), kind, message }); if (run.events.length > 500) run.events.splice(0, run.events.length - 500); this.store.saveSoon(); }
  transition(run, status, message) {
    if (terminal.has(run.status)) return false;
    run.status = status;
    if (terminal.has(status)) run.finishedAt = new Date().toISOString();
    this.event(run, status, message); this.onTransition?.(run, status, message); this.store.save(); return true;
  }
  hold() {
    this.holds++; let held = true;
    return () => { if (!held) return; held = false; this.holds--; this.pump(); };
  }
  queuedInStartOrder() {
    const queued = this.runs.filter(x => x.status === 'queued').reverse();
    return [...queued.filter(x => x.previousRunId), ...queued.filter(x => !x.previousRunId)];
  }
  holdQueue(seconds) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > maxQueueHoldSeconds) throw new InputError(`Hold the queue for 1–${maxQueueHoldSeconds} seconds.`);
    clearTimeout(this.queueHold);
    this.queueHold = setTimeout(() => this.releaseQueue(), seconds * 1000);
    this.queueHold.unref?.();
    return { heldUntil: new Date(Date.now() + seconds * 1000).toISOString(), working: [...this.active.keys()].map(id => this.get(id).title) };
  }
  releaseQueue() {
    clearTimeout(this.queueHold); this.queueHold = null; this.pump();
    return { held: false };
  }
  limited() { return [...this.active.values()].filter(x => !x.landing).length; }
  landingTargets(run) { return this.live.landings.targetsOf(run); }
  busyTargets() { return new Set([...this.active.values()].flatMap(x => x.targets ?? [])); }
  // Earlier queued landings reserve their branches too, so a later landing cannot overtake one that waits on a shared branch.
  launchLandings(waiting) {
    const busy = this.busyTargets();
    for (const run of waiting) {
      const targets = this.landingTargets(run), free = !targets.some(target => busy.has(target));
      for (const target of targets) busy.add(target);
      if (free) this.launch(run);
    }
  }
  pump() {
    if (this.stopping || this.holds || this.queueHold) return;
    const waiting = this.queuedInStartOrder().filter(x => !this.active.has(x.id));
    this.launchLandings(waiting.filter(x => x.kind === 'landing'));
    for (const run of waiting.filter(x => x.kind !== 'landing')) {
      if (this.limited() >= this.concurrency) break;
      this.launch(run);
    }
  }
  launch(run) {
    const controller = new AbortController();
    const promise = this.work(run, controller.signal).catch(error => {
      if (!terminal.has(run.status)) this.transition(run, 'failed', `Runner error: ${error.message}`);
    }).finally(async () => { this.active.delete(run.id); await this.live?.finished?.(run); this.pump(); });
    const landing = run.kind === 'landing';
    this.active.set(run.id, { controller, promise, landing, targets: landing ? this.landingTargets(run) : [] });
  }
  startNow(id) {
    const run = this.get(id);
    if (this.active.has(id)) return run;
    if (run.status !== 'queued') throw new InputError('Only a queued run can start now', 409);
    if (this.stopping) throw new InputError('Server is stopping', 503);
    if (this.queueHold) throw new InputError('The queue is held for an update; start it after the update.', 409);
    if (run.kind === 'landing' && this.landingTargets(run).some(target => this.busyTargets().has(target))) throw new InputError('Another landing is moving the same branch; this one starts when it finishes.', 409);
    this.event(run, 'start', 'Started now by operator, ahead of the tasks-at-a-time limit.'); this.launch(run);
    return run;
  }
  async work(run, signal) {
    if (run.mode !== 'live' || !this.live) throw new Error('Only live runs can be executed.');
    return this.live.work(run, signal);
  }
  cancel(id, message = 'Cancelled by operator. No publication; existing evidence retained.') {
    const run = this.get(id);
    if (terminal.has(run.status)) throw new InputError('Run is already finished', 409);
    this.transition(run, 'cancelled', message);
    this.active.get(id)?.controller.abort(); return run;
  }
  async shutdown() {
    this.stopping = true;
    for (const close of this.live?.clients ?? []) close();
    clearTimeout(this.queueHold);
    for (const run of this.runs) if (!terminal.has(run.status) && (run.status !== 'queued' || this.active.has(run.id))) this.transition(run, 'interrupted', 'Server stopped. Inspect evidence and dispatch a fresh run to continue.');
    for (const { controller } of this.active.values()) controller.abort();
    await Promise.allSettled([...this.active.values()].map(x => x.promise));
    this.store.flush();
  }
}
