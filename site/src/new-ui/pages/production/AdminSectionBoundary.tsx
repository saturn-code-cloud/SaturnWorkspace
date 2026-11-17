import { Component, type ReactNode } from 'react'
import { useExperience } from '../../app/ExperienceProvider'
import { Alert, PageSkeleton } from '../../components/ui/Feedback'
import { Button } from '../../components/ui/Button'
import { copyByLocale } from './productionPresentation'

export class AdminSectionBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function AdminSectionLoadError() {
  const { locale } = useExperience()
  return <Alert tone="danger"
    title={copyByLocale(locale, 'Could not load this section.', 'تعذّر تحميل هذا القسم.')}
    action={<Button type="button" onClick={() => window.location.reload()}>{copyByLocale(locale, 'Reload page', 'إعادة تحميل الصفحة')}</Button>} />
}

export function AdminSectionLoading({ children }: { children?: ReactNode }) {
  const { locale } = useExperience()
  return <><p role="status" className="sr-only">{copyByLocale(locale, 'Loading section…', 'جارٍ تحميل القسم…')}</p>{children ?? <PageSkeleton cards={1} />}</>
}
