export function RiskDecision({ decision, selection }) {
  if (!decision && !selection) return null;
  return <section className="tile-section" aria-label="Risk assessment">
    <h3>Testing decision</h3>
    {selection?.status === 'fallback' && <p>{selection.reason}</p>}
    {selection?.status === 'fallback' && <p><strong>Required checks:</strong> {selection.checks?.join(', ') || 'none'} · revision {selection.revision?.slice(0, 12)}</p>}
    {selection?.approval && <p><strong>Fallback approval:</strong> {selection.approval}{selection.manualReviewPassed ? ' · human review confirmed' : ''}</p>}
    {decision && <>
      {selection && selection.assessmentId !== decision.id && <p className="muted">Previous assessment; not used for the current validation.</p>}
      <p><strong>{decision.level} risk</strong> · {decision.likelihood} likelihood × {decision.impact} impact · {decision.confidence}</p>
      <p className="muted">Agent estimate, not a measured failure probability. Decision: {decision.status}. Revision {decision.revision?.slice(0, 12)}, attempt {decision.attempt}.</p>
      <p><strong>Affected workflows:</strong> {decision.workflows}</p><p>{decision.reason}</p>
      <p><strong>Selected checks:</strong> {decision.checks?.join(', ') || 'none'}</p>
      {decision.observations && <p><strong>Agent observations (self-reported):</strong> {decision.observations}</p>}
      {decision.manualReview && <p><strong>Human review {decision.manualReviewPassed ? 'confirmed' : 'not confirmed'}:</strong> {decision.manualReview}</p>}
      {decision.answer && <p><strong>Operator response:</strong> {decision.answer}</p>}
    </>}
  </section>;
}
