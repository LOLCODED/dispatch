import { terminal } from '@/lib/workspace';
import { providerName } from '@/lib/providers.mjs';


export const choiceLabel = choice => `${providerName(choice?.provider ?? 'codex')} · ${choice?.model ?? 'CLI default'}${choice?.effort ? ` · ${choice.effort}` : ''}`;
export const runModel = run => ({ ...run.execution, provider: run.execution?.provider ?? run.provider ?? 'codex' });

// A switch applies from the next turn, so a stopped run accepts one only while it can still be continued.
export const canSwitchModel = run => run.mode === 'live' && run.kind !== 'answer' && (!terminal.has(run.status) || Boolean(run.sessionId && !run.supersededBy && !run.worktreeRemovedAt));
