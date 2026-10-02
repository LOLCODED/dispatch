import { randomUUID } from 'node:crypto';
import { InputError } from './engine.mjs';
import { terminal } from './catalog.mjs';
import { providerName } from './providers.mjs';
import { attachedFilesNote, decodeAttachments } from './attachments.mjs';

export function latestScreenshot(run) {
  const since = run.interactions?.at(-1)?.createdAt ?? '';
  return (run.artifacts ?? []).findLast(artifact => ['browser', 'agent'].includes(artifact.source) && artifact.mimeType?.startsWith('image/') && artifact.attempt === run.attempt && artifact.capturedAt > since) ?? null;
}

export class Interactions {
  constructor(live) { this.engine = live.engine; this.live = live; this.pending = new Map(); }
  async request(run, details, signal) {
    if (signal.aborted || terminal.has(run.status)) throw new InputError('Run is no longer accepting decisions.', 409);
    if (this.pending.has(run.id)) throw new InputError('Answer the current request first.', 409);
    run.interactions ??= [];
    if (run.interactions.length >= 50) throw new InputError('Decision limit reached for this run.');
    const screenshotIds = details.review?.screenshots.map(item => item.id) ?? [latestScreenshot(run)?.id].filter(Boolean);
    const screenshotId = screenshotIds.at(-1);
    const request = { ...details, ...(screenshotId && { screenshotId }), id: randomUUID(), status: 'pending', createdAt: new Date().toISOString() };
    run.interactions.push(request); this.engine.event(run, 'question', `${providerName(run.provider)} has a question.`);
    this.live.steps?.append(run, { kind: 'question', requestId: request.id, source: details.source ?? 'native', questions: request.questions, ...(screenshotId && { screenshotId, screenshotIds }), ...(details.review && { review: details.review }) });
    return new Promise((resolve, reject) => {
      const finish = (status, value) => { this.pending.delete(run.id); signal.removeEventListener('abort', abort); request.status = status; request.finishedAt = new Date().toISOString(); this.engine.store.saveSoon(); resolve(value); };
      const abort = () => { this.pending.delete(run.id); signal.removeEventListener('abort', abort); request.status = 'cancelled'; this.engine.store.saveSoon(); reject(new InputError('Decision cancelled.', 409)); };
      this.pending.set(run.id, { request, finish, cancel: abort }); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  cancel(run) { this.pending.get(run.id)?.cancel(); }
  answer(id, input) {
    const run = this.engine.get(id), pending = this.pending.get(id);
    if (!pending || terminal.has(run.status) || input.requestId !== pending.request.id) throw new InputError('This request is no longer pending.', 409);
    if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)) throw new InputError('Answer each question.');
    const answers = {}, attachments = decodeAttachments(input);
    for (const question of pending.request.questions) {
      const value = input.answers[question.id];
      if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new InputError('Each answer needs 1–4,000 characters.');
      answers[question.id] = { answers: [value.trim()] };
    }
    pending.request.answers = Object.fromEntries(Object.entries(answers).map(([id, value]) => [id, value.answers[0]]));
    this.live.steps?.append(run, { kind: 'answer', requestId: pending.request.id, answers: pending.request.answers });
    const evidence = this.live.browserEvidence, attached = evidence.attach(run, attachments, { check: 'Answer', attempt: run.attempt });
    answers[pending.request.questions.at(-1).id].answers[0] += attachedFilesNote(attached.map(artifact => ({ name: artifact.name, path: evidence.artifact(run, artifact.id).path })));
    pending.finish('answered', { answers });
    this.engine.event(run, 'decision', `Answer recorded. ${providerName(run.provider)} can continue.`);
    return run;
  }
}
