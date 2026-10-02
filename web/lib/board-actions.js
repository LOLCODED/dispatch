import { useCallback } from 'react';
import { useAction } from '@/lib/use-action';
import { api } from '@/lib/workspace';

export const boardScopeKey = 'dispatch-board-folder';

export function useBoardAction() {
  const action = useAction(), { perform } = action;
  const send = useCallback((path, data = {}) => perform(async () => {
    const result = await api(path, data);
    window.dispatchEvent(new Event('dispatch-refresh'));
    return result;
  }), [perform]);
  return { ...action, send };
}
