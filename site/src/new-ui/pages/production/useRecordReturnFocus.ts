import { useEffect, useRef, type RefObject } from "react";

export function useRecordReturnFocus(id: string, ready: boolean, root: RefObject<HTMLElement | null>) {
  const previous = useRef(id);
  const returning = useRef("");
  useEffect(() => {
    if (previous.current && !id) returning.current = previous.current;
    previous.current = id;
    if (id || !ready || !returning.current || !root.current) return;
    const row = '[data-row-key="' + CSS.escape(returning.current) + '"]';
    const target = root.current.querySelector<HTMLElement>(row + ' .ui-table__row-action button')
      || root.current.querySelector<HTMLElement>(row + ' button')
      || root.current.querySelector<HTMLElement>(row + ' a[href]')
      || root.current.querySelector<HTMLElement>("h1")
      || root.current;
    const fallback = target === root.current || target.tagName === "H1";
    returning.current = "";
    const frame = requestAnimationFrame(() => {
      if (fallback) target.tabIndex = -1;
      target.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [id, ready, root]);
}
