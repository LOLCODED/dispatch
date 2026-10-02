import { useEffect } from 'react';

// Flags overflow on each edge so CSS can draw a shadow only where more content exists.
export function useScrollShadow(ref, mountKey) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      element.dataset.shadowTop = element.scrollTop > 2;
      element.dataset.shadowBottom = element.scrollHeight - element.scrollTop - element.clientHeight > 2;
    };
    element.dataset.scrollShadow = '';
    update();
    element.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update), mutations = new MutationObserver(update);
    resize.observe(element);
    mutations.observe(element, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['open'] });
    return () => { element.removeEventListener('scroll', update); resize.disconnect(); mutations.disconnect(); };
  }, [ref, mountKey]);
}
