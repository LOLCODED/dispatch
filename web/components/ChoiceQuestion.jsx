import { Markdown } from '@/components/Markdown';
import { Textarea } from '@/components/ui/textarea';
import { answerOptions } from '@/lib/question.mjs';
import { submitOnShortcut } from '@/lib/keybinds.mjs';
import { usePreferences } from '@/lib/preferences';

const optionKey = index => String.fromCharCode(65 + index);

function chooseByKey(event, choices, onChange) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('textarea, input')) return;
  const index = event.key.toUpperCase().charCodeAt(0) - 65;
  if (event.key.length !== 1 || index < 0 || index > choices.length) return;
  event.preventDefault();
  if (index === choices.length) event.currentTarget.querySelector('textarea')?.focus();
  else onChange(choices[index].label);
}

export function ChoiceQuestion({ question, options = [], value, other, onChange, onOtherChange, label = 'Other answer', markdown = false, details }) {
  const { keybinds } = usePreferences();
  const choices = answerOptions(options), custom = value === '__other__';
  const send = event => {
    if (event.nativeEvent.isComposing || event.repeat) return;
    const submit = event.currentTarget.form?.querySelector('button[type="submit"]');
    if (submit && !submit.disabled) submitOnShortcut(event, keybinds.send);
  };
  return <fieldset className="choice-question" onKeyDown={event => chooseByKey(event, choices, onChange)}>
    <legend>{markdown ? <Markdown>{question}</Markdown> : question}</legend>
    {details && <details className="question-details"><summary>Assessment details</summary><Markdown>{details}</Markdown></details>}
    <div className="answer-options" role="group" aria-label="Answer choices">
      {choices.map((option, index) => <button key={option.label} type="button" className="answer-option" aria-pressed={value === option.label} onClick={() => onChange(option.label)}>
        <kbd aria-hidden="true">{optionKey(index)}</kbd>
        <span className="answer-text"><span>{option.text}</span>{option.description && <small>{option.description}</small>}</span>
      </button>)}
      <div className={`answer-option answer-custom ${custom ? 'is-selected' : ''}`}>
        {choices.length > 0 && <kbd aria-hidden="true">{optionKey(choices.length)}</kbd>}
        <Textarea aria-label={label} value={other} placeholder={choices.length ? 'Or type your own answer…' : 'Type your answer…'} onFocus={() => onChange('__other__')} onChange={event => { onChange('__other__'); onOtherChange(event.target.value); }} onKeyDown={send} maxLength={4000} rows={1}/>
      </div>
    </div>
  </fieldset>;
}
