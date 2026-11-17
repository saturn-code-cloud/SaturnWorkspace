import { useId, useState, type RefObject } from "react";

export function useRecordPreview(scope: string, listRoot: RefObject<HTMLElement | null>) {
  const panelId = useId();
  const [selection, setSelection] = useState({ scope, key: "" });
  const activeKey = selection.scope === scope ? selection.key : "";
  if (selection.scope !== scope) setSelection({ scope, key: "" });

  const dismiss = () => {
    setSelection({ scope, key: "" });
    const row = listRoot.current?.querySelector(`[data-row-key="${CSS.escape(activeKey)}"]`);
    const trigger = row?.querySelector<HTMLButtonElement>(".ui-table__row-action button");
    (trigger || listRoot.current?.querySelector<HTMLInputElement>("input[type='search']"))?.focus();
  };
  const toggle = (key: string) => {
    if (key === activeKey) dismiss();
    else setSelection({ scope, key });
  };
  return { panelId, activeKey, toggle, dismiss };
}
