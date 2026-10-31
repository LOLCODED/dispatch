import { answerOptions, blockedQuestionOf } from '../web/lib/question.mjs';

export const afkLimit = 3;
const away = 'The operator is away and asked not to be asked.';

export const afkBrief = ` ${away} Never ask a question or stop for a decision: when a requirement or choice is unclear, take the option you would recommend, name it and why in your final report, and keep going. Finish with DISPATCH_BLOCKED: only when nothing more can be done without the operator (access, credentials), after finishing everything else.`;

export function recommended(options) {
  const choices = answerOptions(options);
  return (choices.find(option => option.recommended) ?? choices[0])?.text ?? null;
}

export function afkAnswers(questions) {
  const chosen = Object.fromEntries(questions.map(question => [question.id, recommended(question.options) ?? `${away} Use your best judgement and say what you chose.`]));
  return { chosen, answers: Object.fromEntries(Object.entries(chosen).map(([id, text]) => [id, { answers: [text] }])) };
}

export function afkContinuation(run) {
  if (run.status !== 'blocked' || !run.question || (run.afkStreak ?? 0) >= afkLimit) return null;
  const choice = recommended(blockedQuestionOf(run.question, run.plan).options);
  if (!choice) return null;
  return { what: 'with the recommended option', afk: true, input: `${away} Go with: ${choice}`, event: `AFK: continuing with the recommended option, ${choice}.`, log: `Continuing automatically (AFK): ${choice}.` };
}
