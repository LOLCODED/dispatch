import { SearchSelect } from '@/components/SearchSelect';
import { useId } from 'react';
import { Slider } from 'radix-ui';
import { Brain, Sparkles } from 'lucide-react';
import { navigate } from '@/lib/workspace';
import { modelKey, providerName } from '@/lib/providers.mjs';

const addProviderValue = '__add_provider__';

function effortStops(selected, effort) {
  const supported = selected.supportedReasoningEfforts.map(option => option.reasoningEffort);
  const stale = effort && !supported.includes(effort) ? [effort] : [];
  return [...(selected.defaultReasoningEffort ? [] : [null]), ...stale, ...supported].map(value => ({ value, label: value == null ? 'CLI default' : stale.includes(value) ? `${value} · unavailable` : value }));
}

function EffortSlider({ label, selected, value, disabled, onChange }) {
  const stops = effortStops(selected, value.effort ?? null);
  const index = Math.max(0, stops.findIndex(stop => stop.value === (value.effort ?? null)));
  if (stops.length < 2 && stops[0]?.value == null) return null;
  return <div className="effort-slider"><Brain size={14} aria-hidden="true" className="select-icon"/>
    <Slider.Root className="slider" min={0} max={Math.max(1, stops.length - 1)} step={1} value={[index]} disabled={disabled || stops.length < 2} onValueChange={([next]) => onChange({ ...value, effort: stops[next].value })}>
      <Slider.Track className="slider-track"><Slider.Range className="slider-range"/></Slider.Track>
      <Slider.Thumb className="slider-thumb" aria-label={`${label} reasoning`} aria-valuetext={stops[index].label} data-value={value.effort ?? ''}/>
    </Slider.Root>
    <span className="effort-value" aria-hidden="true">{stops[index].label}</span>
  </div>;
}

export function ModelPicker({ value, onChange, models, label = 'Model', defaultLabel = 'Auto', disabled = false, addProvider = false }) {
  const id = useId(), selected = models.find(model => modelKey(model) === modelKey(value));
  const groups = [...new Set(models.map(model => model.provider))];
  const option = model => <option key={modelKey(model)} value={modelKey(model)}>{model.displayName}</option>;
  const list = groups.length > 1 ? groups.map(provider => <optgroup key={provider} label={providerName(provider)}>{models.filter(model => model.provider === provider).map(option)}</optgroup>) : models.map(option);
  const chooseModel = event => {
    if (event.target.value === addProviderValue) { navigate('/setup#providers'); return; }
    const model = models.find(model => modelKey(model) === event.target.value);
    onChange(model ? { provider: model.provider, model: model.model, effort: model.defaultReasoningEffort ?? null } : null);
  };
  return <div className="model-picker"><label className="sr-only" htmlFor={`${id}-model`}>{label}</label><SearchSelect id={`${id}-model`} icon={Sparkles} disabled={disabled} value={modelKey(value)} onChange={chooseModel} searchLabel="Search models">
    <option value="">{defaultLabel}</option>{value?.model && !selected && <option value={modelKey(value)}>{value.model} · unavailable</option>}{list}{addProvider && <option value={addProviderValue}>+ Add new provider</option>}
  </SearchSelect>{selected && <EffortSlider label={label} selected={selected} value={value} disabled={disabled} onChange={onChange}/>}</div>;
}
