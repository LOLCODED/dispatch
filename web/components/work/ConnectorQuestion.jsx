import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';

export function ConnectorQuestion({ question, busy, onChoose }) {
  return <motion.section className="repository-question" aria-label="Connector question" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
    <p>{question.text}</p>
    <div className="verdict-actions connector-options">
      {question.options.map(option => <Button key={option.id} type="button" size="sm" variant={option.id === 'project' ? 'default' : 'outline'} disabled={busy} onClick={() => onChoose(option.id)}>{option.label}</Button>)}
    </div>
    <p className="muted">Reading uses your own {question.trackerName} login. Nothing is written to the work item until you ask.</p>
  </motion.section>;
}
