import { useState } from 'react';
import { Check } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/Checkbox';
import { useAction } from '@/lib/use-action';
import { api, navigate } from '@/lib/workspace';
import { confirmLongRunning, longRunningSteps, parseRecipeText, recipeText } from '@/lib/recipe-text.mjs';

export const recipeEditable = run => ['blocked', 'failed'].includes(run.status) && !run.supersededBy && Boolean(run.sessionId) && run.checks.at(-1)?.status === 'failed';

export function RecipeEditor({ run }) {
  const [text, setText] = useState(() => recipeText(run.project.validation)), [confirmed, setConfirmed] = useState(false);
  const { busy, error, perform } = useAction();
  const steps = parseRecipeText(text, run.project.validation), longRunning = longRunningSteps(steps).length > 0;
  const submit = event => {
    event.preventDefault();
    perform(async () => { const next = await api(`/api/runs/${run.id}/recipe`, { validation: confirmed ? confirmLongRunning(steps) : steps }); navigate(`/runs/${next.id}`); });
  };
  return <details className="custom-commands recipe-editor"><summary>Edit checks and continue</summary>
    <form onSubmit={submit}>
      <p className="muted">One command per line. Saving updates this repository’s checks and continues the same session; the checks then run fresh.</p>
      <Label htmlFor={`recipe-${run.id}`}>Mandatory checks</Label>
      <Textarea id={`recipe-${run.id}`} value={text} onChange={event => setText(event.target.value)} rows={Math.min(8, Math.max(2, steps.length + 1))} required/>
      {longRunning && <><p className="muted" role="status">Long-running script; it will not finish as a check.</p><Checkbox checked={confirmed} onChange={setConfirmed}>Run it as a check anyway</Checkbox></>}
      <IconButton type="submit" variant="default" label="Save checks and continue" icon={Check} disabled={busy || !steps.length}/>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  </details>;
}
