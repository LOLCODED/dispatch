const shortList = 5;

export const branchLimit = project => Math.max(shortList, 1 + (project?.targetBranches?.length ?? 0));
