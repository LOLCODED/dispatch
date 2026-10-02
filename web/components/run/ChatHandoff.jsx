import { useState } from 'react';
import { GitMerge, GitPullRequest } from 'lucide-react';
import { LandForm } from '@/components/LandDialog';
import { PullRequestForm } from '@/components/PullRequestDialog';
import { Link } from '@/lib/workspace';

export const offersHandoff = run => !run.supersededBy && Boolean(run.landable || run.publishable);

export function HandoffOutcome({ run }) {
  const pr = run.delivery?.pr;
  if (!run.landed && !pr?.url) return null;
  return <p className="handoff-outcome" role="status">
    {run.landed && <><GitMerge aria-hidden="true"/>Landed on {run.landed.target} at <Link href={`/runs/${run.landed.runId}`}>{run.landed.commit.slice(0, 12)}</Link></>}
    {pr?.url && <><GitPullRequest aria-hidden="true"/>Draft pull request <a href={pr.url} target="_blank" rel="noopener">#{pr.number ?? '?'}</a></>}
  </p>;
}

const optionKey = index => String.fromCharCode(65 + index);

function handoffChoices(run, onFollowUp) {
  return [
    run.landable && { id: 'land', text: 'Land it on a branch', description: 'Checks run on the combined result; the branch moves only if they pass. Nothing is pushed.' },
    run.publishable && { id: 'pull-request', text: 'Open a draft pull request', description: 'Pushes this task on its own branch.' },
    onFollowUp && { id: 'follow-up', text: 'Ask for a change', description: 'Continue the conversation below.', act: onFollowUp },
  ].filter(Boolean);
}

function ChoiceForm({ run, id }) {
  if (id === 'land') return <div className="handoff-reveal"><LandForm runs={[run]} note={false}/></div>;
  return <div className="handoff-reveal"><PullRequestForm runs={[run]} listTasks={false} noteId={`handoff-pr-${run.id}`}/></div>;
}

export function ChatHandoff({ run, onFollowUp }) {
  const [chosen, setChosen] = useState(null), choices = handoffChoices(run, onFollowUp);
  const choose = choice => { if (choice.act) { setChosen(null); choice.act(); } else setChosen(choice.id); };
  const keys = event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('textarea, input, select')) return;
    const choice = event.key.length === 1 && choices[event.key.toUpperCase().charCodeAt(0) - 65];
    if (!choice) return;
    event.preventDefault(); choose(choice);
  };
  return <section className="decision handoff" aria-label="Hand off" onKeyDown={keys}>
    <p className="question-eyebrow">What next?</p>
    <div className="answer-options" role="group" aria-label="Hand-off choices">
      {choices.map((choice, index) => <div key={choice.id}>
        <button type="button" className="answer-option" aria-pressed={chosen === choice.id} aria-expanded={choice.act ? undefined : chosen === choice.id} onClick={() => choose(choice)}>
          <kbd aria-hidden="true">{optionKey(index)}</kbd>
          <span className="answer-text"><span>{choice.text}</span><small>{choice.description}</small></span>
        </button>
        {chosen === choice.id && <ChoiceForm run={run} id={choice.id}/>}
      </div>)}
    </div>
  </section>;
}
