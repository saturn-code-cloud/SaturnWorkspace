import { useExperience } from '../../app/ExperienceProvider'
import { DataTable, type DataTableProps } from '../../components/ui/DataDisplay'

export function AdminDataTable<T>({ comparison = false, ...props }: DataTableProps<T> & { comparison?: boolean }) {
  const { locale } = useExperience()
  return <DataTable {...props} responsive={{
    mode: comparison ? 'scroll' : 'stacked',
    scrollHint: locale === 'ar' ? 'مرّر أفقيًا لعرض باقي الأعمدة.' : 'Scroll sideways to see more columns.',
  }} />
}
