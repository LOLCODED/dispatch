import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { RunHistory } from '@/components/RunHistory';
import { Decision } from '@/components/Decision';
import { composerMode, RunComposer } from '@/components/run/RunComposer';
import { AgentPulse } from '@/components/run/AgentPulse';
import { runningAppUrl } from '@/components/run/AppFrame';
import { api, navigate, terminal } from '@/lib/workspace';
import { useScrollShadow } from '@/lib/scroll-shadow';
import { useSmoothText } from '@/lib/smooth-text';
import { prefersReducedMotion } from '@/lib/motion';
import { agentName } from '@/lib/providers.mjs';
import { Markdown } from '@/components/Markdown';
import { ChatHandoff, HandoffOutcome, offersHandoff } from '@/components/run/ChatHandoff';

const activityText = (run, event) => ({ queued: run.previousRunId ? 'Continuing your ticket.' : 'Your ticket is queued.', preparing: 'Getting the repository ready.', implementing: `${agentName(run)} is working on your ticket.`, repairing: `${agentName(run)} is addressing check or review findings.`, reviewing: `An independent ${agentName(run)} session is reviewing the checked changes.`, validating: 'Testing the changes.', publishing: 'Saving the tested result.', ready: 'The result is ready for your review.' }[event.kind] ?? event.message);

function currentActivity(run, labels) {
  if (run.waitingForRecipe) return 'Waiting for another ticket’s check command to finish.';
  const latest = run.events.filter(event => !['message', 'raw', 'tool', 'files', 'setup'].includes(event.kind)).at(-1);
  return latest ? activityText(run, latest) : labels[run.status] ?? run.status;
}

// Follows content growth (including smoothed streaming text) only while the reader is at the end.
function useFollowScroll() {
  const ref = useRef(null), pinned = useRef(true), [following, setFollowing] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const follow = () => { if (pinned.current) element.scrollTop = element.scrollHeight; };
    follow();
    const mutations = new MutationObserver(follow), resize = new ResizeObserver(follow);
    mutations.observe(element, { childList: true, subtree: true, characterData: true });
    resize.observe(element);
    return () => { mutations.disconnect(); resize.disconnect(); };
  }, []);
  const onScroll = event => { const element = event.currentTarget, atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 64; pinned.current = atEnd; setFollowing(atEnd); };
  const followLatest = () => { pinned.current = true; setFollowing(true); ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: prefersReducedMotion() ? 'instant' : 'smooth' }); };
  return { ref, following, onScroll, followLatest };
}

function StreamingMessage({ agent, text }) {
  const shown = useSmoothText(text);
  return <article className="message assistant-message streaming-message"><span className="message-author">{agent} · writing</span><Markdown>{shown}</Markdown></article>;
}

function questionRequest(run, question) {
  return { id: 'question', questions: [{ id: 'answer', question: `How should ${agentName(run)} continue?`, options: question.options, label: 'Your answer' }] };
}

const answerQuestion = (run, options) => ({ answers: { answer }, requestId, ...attachments }) => {
  const chosen = options.find(option => option.label === answer);
  if (chosen?.action) return api(`/api/runs/${run.id}/remaining`, { action: chosen.action });
  return api(`/api/runs/${run.id}/followup`, { input: chosen?.value ?? answer, ...attachments });
};

const asksQuestion = (run, request, question) => Boolean(question) && !run.supersededBy && !request && composerMode(run) === 'followup';
export const hasPendingDecision = (run, request, question) => Boolean(request) || asksQuestion(run, request, question);

export function PendingDecision({ run, request, question, onUpdate, onOpenArtifact, answerRef, showQuestion = false }) {
  const agent = agentName(run);
  const answered = next => { onUpdate(next); if (next.id !== run.id) navigate(`/runs/${next.id}`); };
  if (request) return <Decision key={request.id} runId={run.id} request={request} agent={agent} onAnswered={onUpdate} screenshot={run.artifacts?.find(artifact => artifact.id === request.screenshotId) ?? null} artifacts={run.artifacts ?? []} appUrl={runningAppUrl(run)} onOpenArtifact={onOpenArtifact} answerRef={answerRef}/>;
  if (!asksQuestion(run, request, question)) return null;
  return <>
    {showQuestion && <div className="question-bar-text"><Markdown>{question.question}</Markdown></div>}
    <Decision key={question.question} runId={run.id} request={questionRequest(run, question)} agent={agent} heading={false} onAnswered={answered} send={answerQuestion(run, question.options)} onOpenArtifact={onOpenArtifact} answerRef={answerRef}/>
  </>;
}

export function ChatTile({ run, history, labels, request, question, draft, setDraft, composerRef, answerRef, onUpdate, onOpenArtifact, activity = true, decisionElsewhere = false }) {
  const done = terminal.has(run.status), working = !done && run.status !== 'queued', agent = agentName(run);
  const asking = asksQuestion(run, request, question);
  const showComposer = !run.supersededBy && !request && !asking && Boolean(!done || run.sessionId || draft.trim());
  const scroll = useFollowScroll(), handoff = done && !request && offersHandoff(run);
  useScrollShadow(scroll.ref);
  return <div className="chat-tile">
    <section ref={scroll.ref} tabIndex={0} onScroll={scroll.onScroll} className="conversation" aria-label="Task conversation">
      <RunHistory run={run} runs={history} onOpenArtifact={onOpenArtifact} activity={activity}/>
      {run.streamingMessage && <StreamingMessage agent={agent} text={run.streamingMessage}/>}
      {!decisionElsewhere && <PendingDecision run={run} request={request} question={question} onUpdate={onUpdate} onOpenArtifact={onOpenArtifact} answerRef={answerRef}/>}
      {done && <HandoffOutcome run={run}/>}
      {handoff && <ChatHandoff run={run} onFollowUp={showComposer ? () => composerRef.current?.focus() : null}/>}
      {working && !request && <AgentPulse agent={agent} activity={activity ? currentActivity(run, labels) : null}/>}
    </section>
    <AnimatePresence>{!scroll.following && <motion.div className="latest-button" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}><IconButton variant="secondary" label="Latest" icon={ArrowDown} onClick={scroll.followLatest}/></motion.div>}</AnimatePresence>
    {(run.supersededBy || showComposer) && <div className="run-dock">
      {run.supersededBy && <IconButton variant="outline" label="Open latest conversation" icon={ArrowUpRight} href={`/runs/${run.supersededBy}`}/>}
      {showComposer && <RunComposer key={run.id} run={run} question={question} draft={draft} setDraft={setDraft} composerRef={composerRef} onUpdate={onUpdate}/>}
    </div>}
  </div>;
}
