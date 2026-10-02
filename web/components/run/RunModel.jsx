import { useEffect, useRef, useState } from 'react';
import { ModelPicker } from '@/components/ModelPicker';
import { api, useWorkspace } from '@/lib/workspace';
import { canSwitchModel, runModel } from '@/lib/execution';
import { modelKey } from '@/lib/providers.mjs';

const applyDelay = 400;

// Dragging the effort slider changes the choice on every stop, so only the settled choice is sent.
function useModelSwitch(run, onUpdate, onError) {
  const current = run.nextExecution ?? runModel(run), [choice, setChoice] = useState(null), timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => setChoice(null), [run.id, modelKey(current), current.effort]);
  const choose = next => {
    if (!next?.model) return;
    setChoice(next); onError('');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => api(`/api/runs/${run.id}/model`, next).then(onUpdate, failure => { setChoice(null); onError(failure.message); }), applyDelay);
  };
  return { value: choice ?? current, choose };
}

export function RunModel({ run, disabled, onUpdate, onError }) {
  const { state } = useWorkspace(), { value, choose } = useModelSwitch(run, onUpdate, onError);
  return <ModelPicker label="Next turn model" defaultLabel="CLI default" value={value.model ? value : null} models={state.modelCatalog?.models ?? []} disabled={disabled || !canSwitchModel(run)} onChange={choose}/>;
}
