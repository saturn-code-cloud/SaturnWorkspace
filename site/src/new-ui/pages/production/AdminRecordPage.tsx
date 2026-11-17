import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AppRoute, Navigate } from "../../app/routes";
import { useExperience } from "../../app/ExperienceProvider";
import { PageHeader } from "../../components/ui/DataDisplay";
import { RouteLink } from "../../components/ui/RouteLink";
import { Button } from "../../components/ui/Button";

export function AdminRecordPage({ title, description, parentLabel, parentRoute, navigate, actions, children }: {
  title: string; description?: string; parentLabel: string; parentRoute: AppRoute; navigate: Navigate;
  actions?: ReactNode; children: ReactNode;
}) {
  const { locale } = useExperience();
  const BackIcon = locale === "ar" ? ChevronRight : ChevronLeft;
  return <RecordPageFrame title={title} description={description} actions={actions}
    back={<nav aria-label={locale === "ar" ? "مسار الصفحة" : "Breadcrumb"}>
        <RouteLink className="admin-record-page__back" route={parentRoute} navigate={navigate}>
          <BackIcon size={15} aria-hidden="true" />{parentLabel}
        </RouteLink>
      </nav>}>{children}</RecordPageFrame>;
}

export function AdminTaskPage({ title, description, backLabel, onBack, busy, footer, children }: {
  title: string; description?: string; backLabel: string; onBack: () => void; busy?: boolean; footer?: ReactNode; children: ReactNode;
}) {
  const { locale } = useExperience();
  const BackIcon = locale === "ar" ? ChevronRight : ChevronLeft;
  return <RecordPageFrame title={title} description={description} footer={footer}
    back={<Button variant="ghost" size="sm" disabled={busy} onClick={onBack} leadingIcon={<BackIcon size={15} aria-hidden="true" />}>{backLabel}</Button>}>
    {children}
  </RecordPageFrame>;
}

function RecordPageFrame({ title, description, actions, back, children, footer }: {
  title: string; description?: string; actions?: ReactNode; back: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const heading = root.current?.querySelector("h1");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, []);
  return <section ref={root} className="admin-record-page">
    <PageHeader title={title} description={description} actions={actions} breadcrumbs={back} />
    <div className="admin-record-page__body">{children}</div>
    {footer ? <footer className="admin-record-page__footer cluster">{footer}</footer> : null}
  </section>;
}
