import { useState } from 'react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function BranchQuestion({ question, busy, onChoose }) {
  const [custom, setCustom] = useState('');
  const submit = event => { event.preventDefault(); if (custom.trim()) onChoose(custom.trim()); };
  return <motion.section className="repository-question" aria-label="Branch question" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
    <p>{question.text}</p>
    <div className="verdict-actions connector-options">
      {question.options.map((option, index) => <Button key={option.template} type="button" size="sm" variant={index === 0 ? 'default' : 'outline'} disabled={busy} onClick={() => onChoose(option.template)}>{option.label}</Button>)}
    </div>
    <form className="setting-row" onSubmit={submit}>
      <Label htmlFor="branch-custom">Custom</Label>
      <Input id="branch-custom" value={custom} onChange={event => setCustom(event.target.value)} placeholder="feature/{ticketId}-{slug}" disabled={busy}/>
      <Button type="submit" size="sm" variant="outline" disabled={busy || !custom.trim()}>Use this name</Button>
    </form>
    <p className="muted">dispatch adds a number if the branch already exists. Change this in Settings → Branches.</p>
  </motion.section>;
}
