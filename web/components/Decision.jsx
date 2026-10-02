import { useEffect, useImperativeHandle, useState } from 'react';
import { ChevronLeft, ChevronRight, Gamepad2, Image as ImageIcon, Send } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { Button } from '@/components/ui/button';
import { api, preference, savePreference } from '@/lib/workspace';
import { ChoiceQuestion } from '@/components/ChoiceQuestion';
import { artifactUrl, PointerImage } from '@/components/run/Artifacts';
import { AppFrame } from '@/components/run/AppFrame';
import { AttachButton, AttachmentList, useAttachments } from '@/components/work/Attachments';

function DecisionView({ runId, screenshots, appUrl, playing, onOpenArtifact }) {
  if (playing && appUrl) return <div className="decision-app"><AppFrame url={appUrl}/></div>;
  if (!screenshots.length) return null;
  return <div className="decision-shots">{screenshots.map(({ artifact, caption }, index) => <figure className="decision-capture" key={artifact.id}>
    <figcaption><span className="decision-brand">dispatch<span>.</span></span><span>{index + 1} / {screenshots.length} · {caption}</span></figcaption>
    <button type="button" className="step-shot decision-shot" onClick={() => onOpenArtifact?.({ runId, artifact, items: screenshots.map(item => item.artifact) })} aria-label={`Open ${artifact.name}`}><PointerImage src={`${artifactUrl(runId, artifact)}?inline`} artifact={artifact}/></button>
  </figure>)}</div>;
}

export function Decision({ runId, request, onAnswered, agent, screenshot = null, artifacts = [], appUrl = null, onOpenArtifact, answerRef, heading = true, send = body => api(`/api/runs/${runId}/respond`, body) }) {
  const draftKey = `dispatch-question-${runId}-${request.id}`;
  const [draft] = useState(() => { try { return JSON.parse(preference(draftKey, '{}')); } catch { return {}; } });
  const [answers, setAnswers] = useState(draft.answers ?? {}), [other, setOther] = useState(draft.other ?? {}), [questionIndex, setQuestionIndex] = useState(Math.min(draft.questionIndex ?? 0, (request.questions?.length ?? 1) - 1)), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const screenshots = request.review ? request.review.screenshots.map(item => ({ artifact: artifacts.find(artifact => artifact.id === item.id), caption: item.caption })).filter(item => item.artifact) : screenshot ? [{ artifact: screenshot, caption: screenshot.name }] : [];
  const previewUrl = appUrl && (request.review ? request.review.appUrl : appUrl);
  const [play, setPlay] = useState(!screenshots.length), playing = play && Boolean(previewUrl);
  const attachments = useAttachments(draftKey, setError), reading = attachments.documents.reading;
  useEffect(() => { savePreference(draftKey, JSON.stringify({ answers, other, questionIndex })); }, [draftKey, answers, other, questionIndex]);
  const question = request.questions?.[questionIndex];
  const reference = text => { setAnswers(current => ({ ...current, [question.id]: '__other__' })); setOther(current => ({ ...current, [question.id]: [current[question.id], text].filter(Boolean).join('\n') })); };
  useImperativeHandle(answerRef, () => reference, [question.id]);
  const respond = async value => {
    setBusy(true); setError('');
    try { const run = await send({ requestId: request.id, ...value, ...attachments.payload() }); savePreference(draftKey, '{}'); attachments.clear(); onAnswered(run); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  return <section className="decision" aria-label={`Answer ${agent}`}>
    {heading && <div className="decision-head">
      <p className="question-eyebrow">{agent} needs your call{request.questions.length > 1 && ` · ${questionIndex + 1} of ${request.questions.length}`}</p>
    </div>}
    {request.review && <div className="decision-review"><p><strong>Visual review</strong>{request.review.assessment}</p><p><strong>Try this</strong>{request.review.steps}</p></div>}
    {previewUrl && <div className="decision-preview-actions">
      <Button type="button" size="sm" variant={playing ? 'secondary' : 'default'} aria-pressed={playing} onClick={() => setPlay(!playing)}>{playing ? <ImageIcon aria-hidden="true"/> : <Gamepad2 aria-hidden="true"/>}{playing ? 'Back to screenshots' : 'Try it yourself'}</Button>
      <a href={previewUrl} target="_blank" rel="noreferrer">Open app in a new tab ↗</a>
    </div>}
    <DecisionView runId={runId} screenshots={screenshots} appUrl={previewUrl} playing={playing} onOpenArtifact={onOpenArtifact}/>
    <form onPaste={attachments.pasted.paste} onSubmit={event => { event.preventDefault(); if (questionIndex < request.questions.length - 1) setQuestionIndex(questionIndex + 1); else respond({ answers: Object.fromEntries(request.questions.map(item => [item.id, (answers[item.id] ?? '__other__') === '__other__' ? other[item.id] : answers[item.id]])) }); }}>
      <ChoiceQuestion key={question.id} question={question.question} label={question.label} markdown details={question.details} options={question.options} value={answers[question.id] ?? (question.options?.length ? '' : '__other__')} other={other[question.id] ?? ''} onChange={value => setAnswers({ ...answers, [question.id]: value })} onOtherChange={value => setOther({ ...other, [question.id]: value })}/>
      <AttachmentList attachments={attachments} busy={busy}/>
      <div className="decision-actions"><AttachButton attachments={attachments} disabled={busy}/>{questionIndex > 0 && <IconButton label="Previous question" icon={ChevronLeft} onClick={() => setQuestionIndex(questionIndex - 1)}/>}<IconButton type="submit" variant="default" label={questionIndex < request.questions.length - 1 ? 'Next question' : 'Send answer'} icon={questionIndex < request.questions.length - 1 ? ChevronRight : Send} disabled={busy || reading || !(answers[question.id] && answers[question.id] !== '__other__' || other[question.id]?.trim())}/></div>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
