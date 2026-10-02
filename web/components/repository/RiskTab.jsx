import { Select } from '@/components/Select';
import { Checkbox } from '@/components/Checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { checkIds } from '@/lib/project-form.mjs';
import { landingChecks, optionalChecks, riskLevel, riskLevels } from '@/lib/risk-policy.mjs';

export function NoChoiceWarning({ form }) {
  const ids = checkIds(form);
  if (form.risk?.mode === 'off' || !ids.length || optionalChecks(form.risk, ids).length) return null;
  return <p className="risk-warning" role="status">Every enabled check always runs, so the agent has nothing to choose. Enable your test commands on the Checks tab; they run only when a change needs them.</p>;
}

export function RiskTab({ form, update }) {
  const policy = form.risk, ids = checkIds(form);
  const change = patch => update({ risk: { ...policy, ...patch } });
  const landing = landingChecks(policy, ids);
  const toggleLanding = (id, on) => change({ landingChecks: on ? ids.filter(item => item === id || landing.includes(item)) : landing.filter(item => item !== id) });
  const toggle = (level, id, on) => change({ minimumChecks: { ...policy.minimumChecks, [level]: on ? [...policy.minimumChecks[level], id] : policy.minimumChecks[level].filter(item => item !== id) } });
  return <section className="tab-section">
    <div className="field"><Label htmlFor="risk-mode">Who chooses the tests?</Label><Select id="risk-mode" value={policy.mode} onChange={event => change({ mode: event.target.value })}>
      <option value="agent">Agent chooses · asks when uncertain</option><option value="ask">Always ask me · agent suggests</option><option value="off">Manual rules · use check shortcuts</option>
    </Select></div>
    <p className="muted">The agent reviews the diff, affected workflows and shared dependencies. It estimates likelihood and impact, then chooses from the enabled commands on the Checks tab. Enable your targeted unit, integration and e2e commands there so the agent can use them.</p>
    <p className="muted">Existing repositories keep manual rules until you enable risk assessment. Missing or stale assessments run all configured checks. New repositories start with agent choice.</p>
    <NoChoiceWarning form={form}/>
    {policy.mode !== 'off' && <>
      <h3>Risk matrix</h3><p className="muted">Qualitative estimates, not measured failure probabilities. Low = 1, medium = 2, high = 3; likelihood × impact gives low (1–2), medium (3–4) or high (6–9) risk.</p>
      <table className="risk-matrix"><caption>Likelihood × impact</caption><thead><tr><th scope="col">Likelihood</th>{riskLevels.map(level => <th scope="col" key={level}>{level} impact</th>)}</tr></thead><tbody>{riskLevels.map(likelihood => <tr key={likelihood}><th scope="row">{likelihood}</th>{riskLevels.map(impact => <td key={impact}>{riskLevel(likelihood, impact)}</td>)}</tr>)}</tbody></table>
      <h3>Required checks by risk</h3><p className="muted">These minimums cannot be skipped by the agent or an approval. Higher levels also include the minimums below them. The agent can add any other enabled check.</p>
      {riskLevels.map(level => <fieldset key={level} className="field"><legend>{level} risk and above</legend><div className="chip-toggles">{ids.map(id => <Checkbox key={id} checked={policy.minimumChecks[level].includes(id)} onChange={on => toggle(level, id, on)}>{id}</Checkbox>)}</div></fieldset>)}
      <h3>Checks when landing</h3><p className="muted">Landing runs these checks on the combined result before the base branch moves, without asking. They are independent of the task checks above.</p>
      <fieldset className="field"><legend>Landing checks</legend><div className="chip-toggles">{ids.map(id => <Checkbox key={id} checked={landing.includes(id)} onChange={on => toggleLanding(id, on)}>{id}</Checkbox>)}</div></fieldset>
      {!landing.length && <p className="risk-warning" role="status">Landing runs no checks for this repository.</p>}
      <div className="field"><Label htmlFor="risk-guidance">Workflow and coverage guidance</Label><Textarea id="risk-guidance" rows={5} maxLength={2000} value={policy.guidance} onChange={event => change({ guidance: event.target.value })} placeholder="Registration uses shared authentication helpers. Use registration tests for form changes and the full auth suite for shared helpers."/></div>
      <p className="muted">The agent can request your review of a live workflow or report its browser observations when the repository browser is enabled. Those observations are shown separately from automated passes. Decisions appear in Results and Brain → Testing decisions.</p>
    </>}
  </section>;
}
