import { useEffect, useRef } from 'react';
import { attentionOf, attentionTitle, badgedIcon, decisionAlert, newAskKind } from '@/lib/attention.mjs';
import { playPing } from '@/lib/ping';
import { usePreferences } from '@/lib/preferences';
import { useWorkspace } from '@/lib/workspace';

const baseTitle = document.title, icon = document.querySelector('link[rel="icon"]'), baseIcon = icon?.href ?? '';
const alternateEvery = 2000;

function useTabTitle(count, decisions) {
  useEffect(() => {
    const title = attentionTitle(baseTitle, count, decisions);
    document.title = title;
    if (decisions <= 0) return;
    let alerting = false, timer = null;
    const alternate = () => { alerting = !alerting; document.title = alerting ? decisionAlert(decisions) : title; };
    const follow = () => {
      clearInterval(timer);
      document.title = title;
      alerting = false;
      if (document.hidden) timer = setInterval(alternate, alternateEvery);
    };
    follow();
    document.addEventListener('visibilitychange', follow);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', follow); };
  }, [count, decisions]);
}

function useTabIcon(decisions) {
  const badged = decisions > 0;
  useEffect(() => { if (icon) icon.href = badged ? badgedIcon(baseIcon) : baseIcon; }, [badged]);
}

export function useAttention() {
  const { state, loaded } = useWorkspace(), { attentionSound, attentionVolume } = usePreferences(), seen = useRef(null);
  const { count, decisions, asks } = attentionOf(state);
  useTabTitle(count, decisions);
  useTabIcon(decisions);
  useEffect(() => {
    if (!loaded) return;
    const kind = newAskKind(seen.current, asks);
    if (attentionSound && kind) playPing(attentionVolume, kind);
    seen.current = asks;
  }, [loaded, state]);
}
