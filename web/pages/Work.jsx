import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { Composer } from '@/components/work/Composer';
import { EditComposer } from '@/components/work/EditComposer';
import { TaskBoard } from '@/components/work/TaskBoard';
import { StorageAlert } from '@/components/work/StorageAlert';
import { ReviewAlert } from '@/components/work/ReviewAlert';
import { FolderAlert } from '@/components/work/FolderAlert';
import { unfiledSuggestions } from '@/lib/folder-suggestion.mjs';
import { UsageAlert } from '@/components/work/UsageAlert';
import { oldCompletedCount } from '@/lib/storage-alert.mjs';
import { boardView } from '@/lib/board.mjs';
import { useWorkspace } from '@/lib/workspace';
import { ease, rise } from '@/lib/motion';
import { useScrollIntent } from '@/lib/scroll-intent';
import { matches, usesCommandModifier } from '@/lib/keybinds.mjs';
import { shortcutLabel, usePreferences } from '@/lib/preferences';


function useFocusShortcut(target, combo) {
  useEffect(() => {
    const key = event => {
      if (!matches(event, combo)) return;
      if (!usesCommandModifier(combo) && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault(); target.current?.focus();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [target, combo]);
}

const Keys = ({ combo }) => shortcutLabel(combo).split('+').map((part, index) => <span key={index}>{index > 0 && ' + '}<kbd>{part}</kbd></span>);

const headline = ['Give', 'it', 'somewhere', 'to'];

function Intro() {
  return <div className="intro">
    <h1>{headline.map((word, index) => <span key={word}><motion.span className="intro-word" {...rise(index)}>{word}</motion.span>{' '}</span>)}<motion.em {...rise(headline.length)}>go.</motion.em></h1>
  </div>;
}

function HistoryCue({ total, active, decisions, onOpen }) {
  return <motion.button type="button" className="history-cue" onClick={onOpen} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ delay: 0.6, duration: 0.4, ease }}>
    Tasks<span className="count">{total}</span>{decisions > 0 && <span className="decision-count">{decisions} need you</span>}{active > 0 && <span className="active-count">{active} active</span>}
    <ChevronDown size={14} aria-hidden="true"/>
  </motion.button>;
}

export function Work() {
  const { state } = useWorkspace(), { keybinds, homeList, alerts } = usePreferences(), [showHistory, setShowHistory] = useState(homeList === 'open'), [historyLeaving, setHistoryLeaving] = useState(false), taskRef = useRef(null), [editing, setEditing] = useState(null);
  useFocusShortcut(taskRef, keybinds.focusComposer);
  const historyRef = useRef(null), scrollRequested = useRef(false), historySettled = useRef(false);
  useEffect(() => { if (!showHistory) historySettled.current = false; }, [showHistory]);
  const scrollToHistory = () => {
    if (!scrollRequested.current || !historyRef.current) return;
    scrollRequested.current = false;
    historyRef.current.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  };
  useEffect(() => {
    let frame;
    const revealTasks = () => {
      if (location.hash !== '#tasks') return;
      scrollRequested.current = true;
      setHistoryLeaving(false);
      setShowHistory(true);
      // An already open list has no entrance animation to wait for.
      if (historyRef.current && historySettled.current) frame = requestAnimationFrame(scrollToHistory);
    };
    revealTasks();
    window.addEventListener('popstate', revealTasks);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('popstate', revealTasks); };
  }, []);
  const openHistory = () => { if (!showHistory) { setHistoryLeaving(false); setShowHistory(true); } };
  const closeHistory = () => { if (showHistory) { setHistoryLeaving(true); setShowHistory(false); } };
  useScrollIntent({ onDown: openHistory, onUp: closeHistory });
  const runs = state.runs.filter(run => run.mode === 'live'), savedTasks = (state.tasks ?? []).filter(task => !task.runId);
  const view = boardView({ runs, tasks: savedTasks, board: state.board });
  const total = view.decision.length + view.active.length + view.queued.length + view.awaiting.length + view.todo.length + view.completed.length;
  const hints = <span className="hints"><Keys combo={keybinds.focusComposer}/> focus · <Keys combo={keybinds.send}/> dispatch</span>;
  return <main className={`work-page ${showHistory || historyLeaving ? 'history-open' : ''}`}>
    <motion.section layout="position" className="launch">
      {alerts.usage && <UsageAlert/>}
      {alerts.review && <ReviewAlert count={view.review.length}/>}
      {alerts.storage && <StorageAlert count={oldCompletedCount(view)}/>}
      {alerts.folders && <FolderAlert suggestions={unfiledSuggestions(Object.values(view).flat(), state.board?.folders)}/>}
      <Intro/>
      {editing ? <><EditComposer key={editing.id} target={editing} taskRef={taskRef} onDone={() => setEditing(null)}/><motion.div layout="position" className="composer-note">{hints}</motion.div></> : <Composer taskRef={taskRef} hints={hints}/>}
    </motion.section>
    <AnimatePresence>{!showHistory && !historyLeaving && (runs.length > 0 || savedTasks.length > 0) && <HistoryCue total={total} active={view.active.length} decisions={view.decision.length} onOpen={openHistory}/>}</AnimatePresence>
    {/* The composer recenters only after the list has left, so it never measures a layout that still contains the list. */}
    <AnimatePresence onExitComplete={() => setHistoryLeaving(false)}>{showHistory && <motion.section ref={historyRef} id="tasks" key="history" className="activity" onAnimationComplete={() => { if (showHistory) { historySettled.current = true; scrollToHistory(); } }} initial={{ opacity: 0, y: 48 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24, transition: { duration: 0.2, ease: 'easeIn' } }}>
      <TaskBoard runs={runs} tasks={savedTasks} board={state.board} projects={state.projects} onEdit={setEditing}/>
    </motion.section>}</AnimatePresence>
  </main>;
}
