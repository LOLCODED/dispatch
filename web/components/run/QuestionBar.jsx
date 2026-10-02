import { PendingDecision } from '@/components/run/ChatTile';
import { agentName } from '@/lib/providers.mjs';

export function QuestionBar({ run, request, question, onUpdate, onOpenArtifact, answerRef }) {
  return <section className="question-bar" aria-label={`${agentName(run)} needs your call`}>
    {!request && <p className="question-eyebrow">{agentName(run)} needs your call</p>}
    <PendingDecision run={run} request={request} question={question} onUpdate={onUpdate} onOpenArtifact={onOpenArtifact} answerRef={answerRef} showQuestion/>
  </section>;
}
