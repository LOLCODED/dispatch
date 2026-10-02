const recommendedMark = /\s*\((?:recommended)\)\s*/i;
const numberedOption = /^\s*(\d{1,2})[.)]\s+(.+)$/;

export function answerOption(option) {
  const recommended = recommendedMark.test(option.label);
  return { ...option, text: option.label.replace(recommendedMark, ' ').trim(), recommended };
}

export const answerOptions = options => (options ?? []).filter(option => option.label.trim().toLowerCase() !== 'other').map(answerOption);

function splitOption(line) {
  const [label, ...rest] = line.split(/\s+[—–-]\s+/);
  return { label: label.trim(), description: rest.join(' — ').trim() || undefined };
}

export const remainingQuestion = 'Some planned work isn’t built yet. What should happen to it?';
export const remainingOptions = [
  { label: 'Move it to a new task (Recommended)', description: 'Save it to Todo with this task’s context; this result stays ready for review.', action: 'task' },
  { label: 'Keep building', description: 'Continue in this task.', value: 'Build the remaining work you listed.' },
  { label: 'Finish here', description: 'Drop it and review what was built.', action: 'finish' },
];

export const planApproval = { label: 'Implement the plan (Recommended)', description: 'Approve it and start the work as written.' };

// Blocked turns end with free text, so numbered lines are the only reliable option signal.
export function parseBlockedQuestion(text) {
  const body = String(text ?? '').split(/^[#*\s]*notes for next time\b.*$/im)[0].trim();
  const lines = body.split('\n'), options = [], prompt = [];
  for (const line of lines) {
    const match = line.match(numberedOption);
    if (match) options.push(splitOption(match[2]));
    else if (!options.length) prompt.push(line);
  }
  if (options.length < 2) return { question: body, options: [] };
  return { question: prompt.join('\n').trim(), options };
}

export const blockedQuestionOf = (text, plan = false) => plan ? { question: text, options: [planApproval] } : parseBlockedQuestion(text);
