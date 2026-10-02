const revisionOf = (run, check) => check.linked ? run.linked?.find(member => member.projectId === check.linked)?.revision : run.revision;

export const currentChecks = run => (run.checks ?? []).filter(check => check.revision === revisionOf(run, check));
