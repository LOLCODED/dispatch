import { useCallback, useState } from 'react';

export function useAction() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [question, setQuestion] = useState(null);
  const perform = useCallback(async operation => {
    setBusy(true); setError('');
    try { return await operation(); }
    catch (failure) { setError(failure.message); if (failure.question) setQuestion(failure.question); }
    finally { setBusy(false); }
  }, []);
  return { busy, error, setError, question, setQuestion, perform };
}
