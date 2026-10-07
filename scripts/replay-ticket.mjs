// A finished ticket is often edited after the work: it names the pull requests, commits and branches that shipped
// and lists what was done. A replay gives the agent the ticket as it read before the work.
const shippedReference = /\b(?:PRs?|pull requests?|merge requests?|commits?|branch(?:es)?|cherry-pick(?:ed)?|merged|shipped|deployed)\b|(?:^|[\s(])#\d{2,}\b|\b[0-9a-f]{7,40}\b(?=[^0-9a-z]|$)/i;
const prReference = /\b(?:PRs?|pull requests?)\b|(?:^|[\s(])#\d{2,}\b|\b[0-9a-f]{7,40}\b(?=[^0-9a-z]|$)/i;
const doneSection = /^\s*(?:done|implemented|what (?:was )?changed|changes made|implementation(?: notes)?|resolution|fixed in)\s*:/i;
const nextSection = /^\s*[A-Z][\w /&()-]{1,40}:\s/;

const sentences = text => text.split(/(?<=[.!?])\s+(?=[A-Z`"(])/);

function withoutDoneSections(lines) {
  const kept = [], removed = [];
  let skipping = false;
  for (const line of lines) {
    if (doneSection.test(line)) skipping = true;
    else if (skipping && nextSection.test(line) && !doneSection.test(line)) skipping = false;
    (skipping ? removed : kept).push(line);
  }
  return { kept, removed };
}

// Labels such as "Goal:" often share one line with "Done:", so each label starts its own line first.
const splitLabels = text => text.replace(/\s+(?=(?:Repo|Goal|Done|Approach|Why|Impact|Repro\/Impact|Depends on[^:]*|Implemented|Resolution):\s)/g, '\n');

export function preWorkText(text, reference = shippedReference) {
  const { kept, removed } = withoutDoneSections(splitLabels(String(text ?? '')).split('\n'));
  const result = [];
  for (const line of kept) {
    const parts = sentences(line), clean = parts.filter(part => !reference.test(part));
    removed.push(...parts.filter(part => reference.test(part)));
    if (clean.length || !line.trim()) result.push(clean.join(' '));
  }
  return { text: result.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed: removed.map(part => part.trim()).filter(Boolean) };
}

export function preWorkTicket(ticket) {
  const description = preWorkText(ticket.description), acceptance = preWorkText(ticket.acceptance, prReference);
  return { ticket: { ...ticket, description: description.text, acceptance: acceptance.text }, removed: [...description.removed, ...acceptance.removed] };
}

// Wraps the tracker's read hook so every read in the replay, intake included, sees the pre-work ticket.
export function readPreWork(connector, removedLog) {
  for (const spec of Object.values(connector.actions)) {
    const read = spec.hooks?.['ticket.read'];
    if (!read) continue;
    spec.hooks['ticket.read'] = async (...args) => { const { ticket, removed } = preWorkTicket(await read(...args)); removedLog.push(...removed); return ticket; };
  }
}
