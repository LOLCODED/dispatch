import { GitMerge } from 'lucide-react';
import { Tooltip } from '@/components/IconButton';
import { isLanding } from '@/lib/board.mjs';

export function LandingMark({ entry }) {
  if (!isLanding(entry)) return null;
  const count = entry.latest.landedRunIds?.length;
  const label = count ? `Landing ${count} task${count === 1 ? '' : 's'}` : 'Landing';
  return <Tooltip label={label}><span className="board-row-kind" role="img" aria-label={label} tabIndex={0}><GitMerge size={13} aria-hidden="true"/></span></Tooltip>;
}
