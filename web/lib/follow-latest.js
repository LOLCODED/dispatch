import { useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotionConfig } from 'motion/react';

// Keeps a scroll container at its end as items arrive until the reader scrolls back; reaching the end again resumes following.
export function useFollowLatest(count, { initial = true, threshold = 36 } = {}) {
  const ref = useRef(null), pinned = useRef(initial), seeking = useRef(false), [following, setFollowing] = useState(initial), reduced = useReducedMotionConfig();
  useLayoutEffect(() => { if (pinned.current) ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [count]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = new ResizeObserver(() => { if (pinned.current && !seeking.current) element.scrollTo({ top: element.scrollHeight }); });
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  const onScroll = event => {
    const element = event.currentTarget, atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
    if (seeking.current && !atEnd) return;
    seeking.current = false; pinned.current = atEnd; setFollowing(atEnd);
  };
  const followLatest = () => { pinned.current = true; seeking.current = !reduced; setFollowing(true); ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: reduced ? 'instant' : 'smooth' }); };
  return { ref, following, onScroll, followLatest };
}
