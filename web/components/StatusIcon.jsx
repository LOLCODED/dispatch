import { Ban, CircleAlert, CircleCheck, CircleDashed, CirclePause, CircleX, CornerDownRight, Bookmark, GitMerge, LoaderCircle } from 'lucide-react';
import { statusTone } from '@/lib/status.mjs';

const icons = { waiting: CircleDashed, active: LoaderCircle, success: CircleCheck, completed: CircleCheck, attention: CircleAlert, danger: CircleX, continued: CornerDownRight, saved: Bookmark };

export function LandingLoader({ size }) {
  return <><LoaderCircle size={size}/><GitMerge size={Math.round(size * 0.6)} className="landing-glyph"/></>;
}

export function ToneIcon({ tone, icon: Icon = icons[tone] ?? CircleDashed, size = 16 }) {
  return <span className={`status-icon tone-${tone}`} aria-hidden="true"><Icon size={size}/></span>;
}

export function StatusIcon({ run, done = false, landing = false, size = 16 }) {
  const tone = landing ? 'active' : done ? 'completed' : statusTone(run);
  const icon = landing ? LandingLoader : run.status === 'cancelled' ? Ban : run.status === 'interrupted' ? CirclePause : undefined;
  return <ToneIcon tone={tone} icon={icon} size={size}/>;
}
