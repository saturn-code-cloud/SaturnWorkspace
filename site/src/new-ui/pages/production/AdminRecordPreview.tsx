import { useEffect, useId, useRef, type ReactNode } from "react";
import { Maximize2, X } from "lucide-react";
import { useExperience } from "../../app/ExperienceProvider";
import type { AppRoute, Navigate } from "../../app/routes";
import { IconButton } from "../../components/ui/Button";
import { RouteLink } from "../../components/ui/RouteLink";
import { copy } from "./adminPageSupport";

export function AdminRecordPreviewLayout({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  return <div className="admin-preview-layout">
    <div className="admin-preview-layout__grid" data-preview-open={panel ? "true" : undefined}>
      {panel}
      <div className="stack admin-preview-layout__list">{children}</div>
    </div>
  </div>;
}

export function AdminRecordPreview({ id, title, description, icon, recordRoute, navigate, onClose, children }: {
  id: string; title: string; description?: string; icon: ReactNode; recordRoute: AppRoute;
  navigate: Navigate; onClose: () => void; children: ReactNode;
}) {
  const { locale } = useExperience();
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return <aside id={id} aria-labelledby={titleId} className="admin-record-preview"
    onKeyDown={(event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }}>
    <header className="admin-record-preview__header">
      <span className="admin-record-overview__icon" aria-hidden="true">{icon}</span>
      <div className="admin-record-preview__identity">
        <h2 id={titleId} ref={heading} tabIndex={-1}><bdi>{title}</bdi></h2>
        {description ? <p className="secondary"><bdi>{description}</bdi></p> : null}
      </div>
      <IconButton type="button" size="sm" label={copy(locale, "Close preview", "إغلاق المعاينة")} onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </IconButton>
    </header>
    <div className="admin-record-preview__body">{children}</div>
    <footer className="admin-record-preview__footer">
      <RouteLink route={recordRoute} navigate={navigate} className="ui-button ui-button--secondary ui-button--sm">
        <Maximize2 size={14} aria-hidden="true" />
        <span>{copy(locale, "Open full record", "فتح السجل الكامل")}</span>
      </RouteLink>
    </footer>
  </aside>;
}
