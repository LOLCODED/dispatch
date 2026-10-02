import { setTimeout as sleep } from 'node:timers/promises';
import { tickets } from './world.mjs';

const terminal = new Set(['ready', 'blocked', 'failed', 'cancelled', 'interrupted', 'budget_exceeded']);

export function client(url) {
  const call = async (path, data) => {
    const response = await fetch(url + path, data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const body = await response.json();
    if (!response.ok) throw new Error(`${path}: ${body.error ?? response.status}`);
    return body;
  };
  const until = async (id, ready) => {
    let run;
    for (let i = 0; i < 600; i++) {
      run = (await call('/api/state')).runs.find(candidate => candidate.id === id);
      if (ready(run)) return run;
      await sleep(100);
    }
    throw new Error(`Run ${id} stopped at ${run?.status}: ${JSON.stringify(run?.events?.slice(-3))}`);
  };
  const start = (projectId, ticket) => call('/api/runs', { mode: 'live', projectId, input: ticket });
  return { call, until, start };
}

async function folders({ call }) {
  const launch = await call('/api/board/folders', { name: 'Launch' });
  const polish = await call('/api/board/folders', { name: 'Polish', parentId: launch.id });
  const bugs = await call('/api/board/folders', { name: 'Bugs' });
  const ideas = await call('/api/board/folders', { name: 'Ideas' });
  return { launch, polish, bugs, ideas };
}

export async function seed(url, project) {
  const api = client(url), { call, until, start } = api, filed = [];
  await call('/api/concurrency', { concurrency: 2 });
  const { launch, polish, bugs, ideas } = await folders(api);
  for (const [ticket, folder] of [[tickets.clear, launch], [tickets.strike, polish], [tickets.empty, bugs], [tickets.sort, launch]]) {
    const run = await until((await start(project.id, ticket)).id, run => terminal.has(run.status));
    filed.push([run.id, folder]);
    if (ticket === tickets.clear) await call(`/api/board/items/${run.id}`, { done: true });
  }
  const review = await start(project.id, tickets.filters);
  await until(review.id, run => run.interactions?.some(interaction => interaction.status === 'pending'));
  const storage = await start(project.id, tickets.storage);
  await until(storage.id, run => run.status === 'implementing');
  const queued = await start(project.id, tickets.shortcut);
  filed.push([review.id, launch], [storage.id, launch], [queued.id, polish]);
  for (const [ticket, folder] of [[tickets.reorder, ideas], [tickets.dark, ideas]]) filed.push([(await call('/api/tasks', { projectId: project.id, input: ticket })).id, folder]);
  for (const [key, folder] of filed) await call(`/api/board/items/${key}`, { folderId: folder.id });
  return { review, folders: { launch, polish, bugs, ideas } };
}
