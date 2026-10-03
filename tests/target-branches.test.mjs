import test from 'node:test';
import assert from 'node:assert/strict';
import { git } from '../src/local-tools.mjs';
import { liveFixture } from './live-double.mjs';

test('saved target branches are validated and listed right after the base branch for landing and pull requests', async t => {
  const { live, project, repo } = await liveFixture(t);
  for (const name of ['alpha', 'release', 'zeta']) await git(repo, ['branch', name]);
  const save = targetBranches => live.saveProject({ ...project, confirmed: true, targetBranches }, project.id);
  await assert.rejects(save(['missing']), /existing local branches/);
  await assert.rejects(save('release'), /existing local branches/);
  assert.deepEqual((await save(['zeta', 'release', 'zeta', 'main'])).targetBranches, ['zeta', 'release']);
  assert.deepEqual(await live.landings.branches(project.id), { base: 'main', branches: ['main', 'zeta', 'release', 'alpha'] });
  assert.deepEqual((await live.saveProject({ ...project, confirmed: true, targetBranches: undefined, baseBranch: 'zeta' }, project.id)).targetBranches, ['release']);
  await git(repo, ['branch', '-D', 'release']);
  assert.deepEqual((await live.saveProject({ ...project, confirmed: true, targetBranches: undefined }, project.id)).targetBranches, []);
});
