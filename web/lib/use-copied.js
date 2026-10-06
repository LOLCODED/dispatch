import { useState } from 'react';

export function useCopied() {
  const [copied, setCopied] = useState(false);
  const copy = async text => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* Clipboard can be unavailable; the text stays selectable. */ } };
  return [copied, copy];
}
