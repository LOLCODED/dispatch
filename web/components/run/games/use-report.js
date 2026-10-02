import { useEffect } from 'react';

export function useReport(score, ended, won, onScore, onEnd) {
  useEffect(() => { onScore(score); }, [score]);
  useEffect(() => { if (ended) onEnd(won); }, [ended]);
}
