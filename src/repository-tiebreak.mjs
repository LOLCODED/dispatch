import { distinctiveTerms } from './repository-routing.mjs';

const verdictLine = /^\s*ROUTE:\s*(.+?)(?:\s+-{1,2}\s+|\s*[—–]\s*|\s*$)(.*)$/im;

export function tiebreakCandidates(projects, profiles) {
  const byId = new Map(profiles.map(profile => [profile.projectId, profile]));
  return projects.map(project => {
    const profile = byId.get(project.id), others = profiles.filter(item => item !== profile);
    return { project, description: profile?.description ?? '', terms: profile ? distinctiveTerms(profile, others) : [] };
  });
}

export function tiebreakPrompt(ticket, candidates) {
  const lines = candidates.map(({ project, description, terms }, index) => `${index + 1}. ${project.name}${description ? ` — ${description}` : ''}\n   Its files mention: ${terms.length ? terms.join(', ') : 'nothing distinctive'}`);
  return [
    'Decide which repository this ticket belongs to. Do not read files, run commands or call tools; decide only from the descriptions below.',
    `Repositories:\n${lines.join('\n')}`,
    `Ticket:\n${ticket.trim().slice(0, 4000)}`,
    'Reply with exactly one line: "ROUTE: <repository name> — <one short reason>". Reply "ROUTE: none — <reason>" when the ticket fits none of them, fits several equally, or is a question about no particular repository.',
  ].join('\n\n');
}

export function tiebreakVerdict(summary, projects) {
  const [, name, reason] = String(summary ?? '').match(verdictLine) ?? [];
  if (!name) return null;
  const wanted = name.replace(/^["'`*]+|["'`*.]+$/g, '').trim().toLowerCase();
  const project = projects.find(item => item.name.toLowerCase() === wanted);
  return project ? { project, reason: reason.trim().replace(/\.$/, '').slice(0, 200) } : null;
}
