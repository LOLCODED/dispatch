import { randomUUID } from 'node:crypto';
import { InputError } from '../engine.mjs';
import { projectScope } from '../brain.mjs';

const trigger = { trigger: 'delivery.pr-opened', action: 'tracker.set-state' };

export function writebackComment(run, rev) {
  const lines = [];
  if (Number.isInteger(rev) && rev !== run.ticket.revision) lines.push(`Ticket changed since dispatch (rev ${run.ticket.revision} → ${rev}).`);
  lines.push(`dispatch run ${run.ticketId}: ${run.status}.`, run.branch ? `Branch: ${run.branch}${run.headSha ? ` @ ${run.headSha}` : ''}` : `Folder: ${run.workspace} (tested changes left in place)`);
  if (run.delivery?.pr?.url) lines.push(`Pull request: ${run.delivery.pr.url} (${run.delivery.pr.state})`);
  const moved = (run.offers ?? []).find(offer => offer.kind === 'tracker.set-state' && offer.status === 'applied');
  if (moved) lines.push(`State: ${moved.current ?? 'unknown'} → ${moved.result.value}${moved.result.auto ? ' (remembered preference)' : ''}.`);
  const checks = run.checks.filter(check => check.revision === run.revision);
  lines.push(`Checks against revision ${run.revision?.slice(0, 12) ?? 'unknown'}: ${checks.map(check => `${check.name} ${check.status}`).join(', ') || 'none recorded'}.`);
  return lines.join('\n');
}

export const ticketRef = ticket => ({ tracker: ticket.tracker, organization: ticket.organization, project: ticket.project, id: ticket.id, sourceUrl: ticket.sourceUrl });

// What happens to a run's ticket after delivery: one result comment, and an offer to move its state.
export class TicketActions {
  constructor(live) { this.live = live; this.connectors = live.connectors; this.brain = live.brain; }
  connector(run) { return run.ticket?.tracker ? this.connectors.registry.get(run.ticket.tracker) : null; }
  log(run, message) { this.live.log(run, 'delivery', message); }
  call(run, hook, args, signal) { return this.connectors.invoke(run.project, run.ticket.tracker, hook, args, { signal }); }
  writebackAllowed(run) { const id = run.ticket?.tracker; return Boolean(id) && this.connectors.active(run.project, id) && this.connectors.allows(run.project, id, 'ticket.comment'); }
  statesAllowed(run) { const id = run.ticket?.tracker; return Boolean(id) && this.connectors.active(run.project, id) && this.connectors.allows(run.project, id, 'ticket.setState'); }

  async comment(run, { signal } = {}) {
    const connector = this.connector(run), name = connector?.name ?? 'Tracker';
    if (run.delivery.tracker?.commented) return `${name} comment already posted for this run${run.delivery.tracker.rev === null ? '' : ` (rev ${run.delivery.tracker.rev})`}.`;
    const record = fields => { run.delivery.tracker = { id: run.ticket?.tracker ?? null, name, ticketRevision: run.ticket?.revision ?? null, at: new Date().toISOString(), ...fields }; };
    try {
      if (!connector) throw new Error('This run has no work item a loaded connector can comment on.');
      const ref = ticketRef(run.ticket), rev = this.connectors.allows(run.project, connector.id, 'ticket.revision') ? await this.call(run, 'ticket.revision', [ref], signal) : null;
      await this.call(run, 'ticket.comment', [ref, writebackComment(run, rev)], signal);
      record({ commented: true, rev: Number.isInteger(rev) ? rev : null, error: null });
      return !Number.isInteger(rev) || rev === run.ticket.revision ? `Commented on ${name} work item ${run.ticket.id}${Number.isInteger(rev) ? ` (rev ${rev})` : ''}.` : `Commented on ${name} work item ${run.ticket.id}; it changed since dispatch (rev ${run.ticket.revision} → ${rev}).`;
    } catch (error) {
      record({ commented: false, rev: null, error: error.message });
      return `${name} comment not posted: ${error.message}`;
    }
  }

  async offerState(run, signal) {
    if (!this.statesAllowed(run) || !run.delivery?.pr?.url) return;
    const connector = this.connector(run), preference = this.brain.lookup({ ...trigger, projectId: run.projectId });
    if (preference?.mode === 'auto' && preference.pinned && preference.value === undefined) return;
    const statesKey = `tracker.${connector.id}.states:${run.ticket.project ?? ''}:${run.ticket.type ?? ''}`;
    let states; try { states = await this.call(run, 'ticket.states', [ticketRef(run.ticket), run.ticket], signal); } catch (error) { this.log(run, `Work item states were not read: ${error.message}`); states = []; }
    states = Array.isArray(states) ? states.filter(state => typeof state === 'string' && state.trim()).slice(0, 30) : [];
    if (states.length) this.brain.add({ kind: 'preference', scope: projectScope(run.projectId), key: statesKey, value: states.join('|'), source: 'observed', pinned: true, mode: 'auto', origin: { runId: run.id, via: 'verdict' } });
    else states = (this.brain.lookup({ key: statesKey, projectId: run.projectId })?.value ?? '').split('|').filter(Boolean);
    const mode = preference?.mode ?? 'ask';
    const offer = { id: randomUUID(), kind: 'tracker.set-state', tracker: connector.id, trackerName: connector.name, ticketId: run.ticket.id, reference: run.ticket.reference ?? null, current: run.ticket.state ?? null, options: states.filter(state => state !== run.ticket.state), suggested: mode !== 'ask' && preference?.value ? preference.value : null, preferenceId: preference?.id ?? null, mode, status: 'pending', createdAt: new Date().toISOString(), result: null, error: null };
    run.offers = [...(run.offers ?? []), offer];
    if (mode === 'auto' && preference?.value) await this.apply(run, offer, preference.value, { auto: true, signal });
    else this.log(run, `${connector.name} work item ${run.ticket.id} is in "${run.ticket.state ?? 'unknown'}"; choose a state to move it to from the verdict.`);
  }

  async move(run, value, expectedRevision, signal) {
    const result = await this.call(run, 'ticket.setState', [ticketRef(run.ticket), value, { expectedRevision }], signal);
    return { moved: result?.moved === true, changed: result?.changed === true, rev: Number.isInteger(result?.rev) ? result.rev : null };
  }

  async apply(run, offer, value, { auto = false, signal, confirmed = false } = {}) {
    const connector = this.requireStates(run);
    try {
      const result = await this.move(run, value, confirmed ? offer.changedRevision : run.ticket.revision, signal);
      if (!result.moved) { offer.changedRevision = result.rev; offer.error = `Work item changed since dispatch (rev ${run.ticket.revision} → ${result.rev}). Confirm to move it anyway.`; this.log(run, offer.error); return offer; }
      offer.status = 'applied'; offer.error = null; offer.result = { value, previous: offer.current, rev: result.rev, at: new Date().toISOString(), auto };
      this.log(run, `${connector.name} work item ${run.ticket.id} moved from "${offer.current ?? 'unknown'}" to "${value}"${auto ? ' (remembered preference)' : ''}.`);
      if (auto && offer.preferenceId) this.brain.touch(offer.preferenceId, run.id);
    } catch (error) { offer.error = error.message; this.log(run, `${connector.name} state was not changed: ${error.message}`); }
    return offer;
  }

  requireStates(run) {
    if (!this.statesAllowed(run)) throw new InputError('This run has no tracker that may move its work item.', 409);
    return this.connector(run);
  }

  find(id, offerId) {
    const run = this.live.engine.get(id), offer = (run.offers ?? []).find(item => item.id === offerId);
    if (!offer) throw new InputError('Offer not found', 404);
    return { run, offer };
  }

  async answer(id, offerId, input) {
    const { run, offer } = this.find(id, offerId);
    if (offer.status !== 'pending') throw new InputError('This offer was already answered.', 409);
    if (typeof input.value !== 'string' || !input.value.trim()) throw new InputError('Choose a state, skip, or never.');
    const scope = input.scope === 'global' ? 'global' : 'project', value = input.value.trim(), save = () => this.live.engine.store.save();
    if (value === 'skip') { offer.status = 'skipped'; save(); return offer; }
    if (value === 'never') { offer.status = 'skipped'; const entry = this.brain.answer({ ...trigger, projectId: run.projectId, scope, value: null }); Object.assign(entry, { value: undefined, pinned: true, mode: 'auto' }); save(); return offer; }
    if (value.length > 100) throw new InputError('State names are under 100 characters.');
    await this.apply(run, offer, value, { confirmed: input.confirmed === true });
    if (offer.status === 'applied') { const entry = this.brain.answer({ ...trigger, projectId: run.projectId, scope, value, runId: run.id }); offer.preferenceId = entry.id; offer.mode = entry.mode; }
    save(); return offer;
  }

  async undo(id, offerId) {
    const { run, offer } = this.find(id, offerId);
    if (offer.status !== 'applied' || !offer.result?.previous) throw new InputError('Nothing to undo for this offer.', 409);
    const connector = this.requireStates(run), result = await this.move(run, offer.result.previous, offer.result.rev);
    if (!result.moved) throw new InputError(`Work item changed again (rev ${result.rev}); change its state in ${connector.name} instead.`, 409);
    offer.status = 'undone'; offer.result = { ...offer.result, undoneAt: new Date().toISOString(), rev: result.rev };
    if (offer.preferenceId) this.brain.answer({ ...trigger, projectId: run.projectId, scope: this.brain.find(offer.preferenceId)?.scope === 'global' ? 'global' : 'project', value: null, runId: run.id, undo: true });
    this.log(run, `${connector.name} work item ${run.ticket.id} moved back to "${offer.result.previous}".`);
    this.live.engine.store.save(); return offer;
  }
}
