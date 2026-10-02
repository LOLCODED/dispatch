import { useState } from 'react';
import { motion } from 'motion/react';
import { ChoiceQuestion } from '@/components/ChoiceQuestion';
import { Check } from 'lucide-react';
import { IconButton } from '@/components/IconButton';

const agentOption = 'All repositories (agent decides)';

export function RepositoryQuestion({ question, busy, onChoose, onUsePath }) {
  const [answer, setAnswer] = useState(''), [path, setPath] = useState('');
  const options = [...question.candidates.map(candidate => ({ label: candidate.name })), ...(question.candidates.length > 1 ? [{ label: agentOption }] : [])];
  const choose = value => {
    setAnswer(value);
    if (value === agentOption) { onChoose('all'); return; }
    const candidate = question.candidates.find(item => item.name === value);
    if (candidate) onChoose(candidate.id);
  };
  return <motion.section className="repository-question" aria-label="Repository question" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
    <ChoiceQuestion question={question.text} options={options} value={answer} other={path} onChange={choose} onOtherChange={setPath} label="Other repository path"/>
    {answer === '__other__' && <IconButton label="Use repository" icon={Check} variant="outline" disabled={!path.trim() || busy} onClick={() => onUsePath(path)}/>}
  </motion.section>;
}
