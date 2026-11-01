const policy = 'this repository\'s AGENTS.md';

const followsRepositoryPolicy = project => project?.repositoryPolicy === true;

export function effortBrief(run) {
  const review = `review ${run.shadow ? 'your changes' : 'the diff'} before finishing`;
  if (followsRepositoryPolicy(run.project)) return `Scale effort to the change: read the relevant code, implement the smallest complete fix, and ${review}. Run the checks ${policy} requires for the change, entire suites included when it asks for them; dispatch runs the mandatory checks afterwards as well.`;
  return `Scale effort to the change: for copy, text or documentation edits, make the edit, confirm it and finish; otherwise read the relevant code, implement the smallest complete fix, and ${review}. Prefer targeted checks while developing; dispatch runs the mandatory checks afterwards, so do not run entire suites.`;
}

export function limitsBrief(run) {
  if (followsRepositoryPolicy(run.project)) return `Do not push Git branches, change branches, start other agent CLIs, or modify package scripts used for validation. Make the documentation, roadmap and journal updates ${policy} requires; other documentation only when the ticket asks.`;
  return 'Do not push Git branches, change branches, start other agent CLIs, edit documentation the ticket did not ask for, or modify package scripts used for validation.';
}

export function writesBrief(run) {
  const place = run.shadow ? 'folder' : 'worktree', elsewhere = `dispatch checks${run.shadow ? '' : ' and commits'} nothing elsewhere.`;
  if (followsRepositoryPolicy(run.project)) return `Keep your own edits inside this ${place}; tools its AGENTS.md names may write where it says (for example a journal in a sibling repository) when the sandbox allows it, and ${elsewhere}`;
  return `Keep every change inside this ${place}; ${elsewhere}`;
}
