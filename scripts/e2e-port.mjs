import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Concurrent dispatch runs check sibling worktrees at once; a shared fixed port let one run's browser tests reach another run's server.
const worktree = fileURLToPath(new URL('..', import.meta.url));
const derived = 10000 + parseInt(createHash('sha256').update(worktree).digest('hex').slice(0, 8), 16) % 20000;

export const e2ePort = Number(process.env.DISPATCH_E2E_PORT ?? derived);
