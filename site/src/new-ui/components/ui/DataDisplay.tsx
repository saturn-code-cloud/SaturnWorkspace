import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal, Search } from 'lucide-react'
import { Button, IconButton } from './Button'
import { EmptyState, Skeleton, type EmptyStateVariant } from './Feedback'
import { SearchInput, Select } from './FormControls'

export function Card({ children, className = '', padding = 'md' }: { children: ReactNode; className?: string; padding?: 'none' | 'sm' | 'md' | 'lg' }) {
  return <section className={`ui-card ui-card--${padding} ${className}`}>{children}</section>
}

export function StatCard({ label, value, detail, icon }: { label: ReactNode; value: ReactNode; detail?: string; icon?: ReactNode }) {
  return <Card padding="sm" className="ui-stat"><div className="ui-stat__top"><span>{label}</span>{icon}</div><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</Card>
}

export function PageHeader({ title, description, actions, breadcrumbs }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: ReactNode }) {
  return <header className="ui-page-header">{breadcrumbs}<div className="split"><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{actions ? <div className="cluster">{actions}</div> : null}</div></header>
}

export function SectionHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return <header className="ui-section-header"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{action}</header>
}

export function Breadcrumbs({ items, label }: { items: { label: string; onClick?: () => void }[]; label: string }) {
  return <nav className="ui-breadcrumbs" aria-label={label}>{items.map((item, index) => <span key={`${item.label}-${index}`}>{index ? <ChevronRight size={13} /> : null}{item.onClick ? <button type="button" onClick={item.onClick}>{item.label}</button> : item.label}</span>)}</nav>
}

export type Column<T> = { key: string; header: string; width?: string; narrow?: 'action'; render: (row: T) => ReactNode }

type TableSelection<T> = {
  selectedKeys: ReadonlySet<string>
  onChange: (keys: Set<string>) => void
  rowLabel: (row: T) => string
  selectAllLabel: string
}

function SelectionCheckbox({ checked, indeterminate = false, label, onChange, onClick }: { checked: boolean; indeterminate?: boolean; label: string; onChange: () => void; onClick?: (event: MouseEvent<HTMLInputElement>) => void }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate
  }, [indeterminate])
  return <input ref={input} type="checkbox" checked={checked} aria-label={label} onChange={onChange} onClick={onClick} />
}

type TableRowAction<T> = { onRowClick?: never; rowAction?: never } | {
  onRowClick: (row: T) => void
  rowAction: { header: string; label: string; accessibleLabel: (row: T) => string;
    disclosure?: { activeKey: string; panelId: string } }
}

export type DataTableProps<T> = {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string;
  emptyTitle: string; emptyBody: string; emptyVariant?: EmptyStateVariant;
  loading?: boolean; selection?: TableSelection<T>;
} & TableRowAction<T>
type ResponsiveTableLayout = { mode: 'stacked' | 'scroll'; scrollHint: string }

function ResponsiveTableFrame({ mode, scrollHint, children }: ResponsiveTableLayout & { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const root = frame.current
    const table = root?.querySelector('table')
    if (!root || !table) return
    const check = () => setOverflow(root.scrollWidth > root.clientWidth + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(root)
    observer.observe(table)
    return () => observer.disconnect()
  }, [])
  return <div className="ui-table-responsive">
    {overflow ? <p className="ui-table-scroll-hint">{scrollHint}</p> : null}
    <div ref={frame} className={`ui-table-wrap ui-table-wrap--${mode}`}
      tabIndex={overflow ? 0 : undefined} role={overflow ? 'group' : undefined}
      aria-label={overflow ? scrollHint : undefined}>{children}</div>
  </div>
}

export function DataTable<T>({ columns, rows, rowKey, emptyTitle, emptyBody, emptyVariant = 'page', loading = false, onRowClick, rowAction, selection, responsive }: DataTableProps<T> & { responsive?: ResponsiveTableLayout }) {
  if (!loading && rows.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} variant={emptyVariant} />
  const pageKeys = rows.map(rowKey)
  const selectedOnPage = pageKeys.filter((key) => selection?.selectedKeys.has(key)).length
  const allOnPageSelected = pageKeys.length > 0 && selectedOnPage === pageKeys.length
  const changePageSelection = () => {
    if (!selection) return
    const next = new Set(selection.selectedKeys)
    for (const key of pageKeys) {
      if (allOnPageSelected) next.delete(key)
      else next.add(key)
    }
    selection.onChange(next)
  }
  const stacked = responsive?.mode === 'stacked'
  const table = <table className="ui-table" role={stacked ? 'table' : undefined} aria-busy={loading || undefined}>
    <thead role={stacked ? 'rowgroup' : undefined}><tr role={stacked ? 'row' : undefined}>
      {selection ? <th scope="col" className="ui-table__selection" role={stacked ? 'columnheader' : undefined}>
        {stacked ? <label className="ui-table__select-page">
          <SelectionCheckbox checked={allOnPageSelected} indeterminate={selectedOnPage > 0 && !allOnPageSelected}
            label={selection.selectAllLabel} onChange={changePageSelection} />
          <span className="ui-table__narrow-label" aria-hidden="true">{selection.selectAllLabel}</span>
        </label> : <SelectionCheckbox checked={allOnPageSelected} indeterminate={selectedOnPage > 0 && !allOnPageSelected}
          label={selection.selectAllLabel} onChange={changePageSelection} />}
      </th> : null}
      {columns.map((column) => <th scope="col" role={stacked ? 'columnheader' : undefined} key={column.key} data-column={column.key} style={{ width: column.width }}>{column.header}</th>)}
      {rowAction ? <th scope="col" role={stacked ? 'columnheader' : undefined}>{rowAction.header}</th> : null}
    </tr></thead>
    <tbody role={stacked ? 'rowgroup' : undefined}>
      {(loading ? Array.from({ length: 5 }, () => null) : rows).map((row, index) => {
        const key = row === null ? undefined : rowKey(row)
        const expanded = key !== undefined && rowAction?.disclosure ? rowAction.disclosure.activeKey === key : undefined
        return <tr key={key ?? index} data-row-key={key} role={stacked ? 'row' : undefined}
          data-previewed={expanded || undefined}
          className={onRowClick && row !== null ? 'is-clickable' : undefined}
          onClick={onRowClick && row !== null ? (event) => {
            if (!(event.target as Element).closest('button,a,input,select,textarea,summary')) onRowClick(row)
          } : undefined}>
          {selection ? <td role={stacked ? 'cell' : undefined} className="ui-table__selection" data-narrow-cell="selection">
            {row === null || key === undefined ? <Skeleton width="1rem" /> : <SelectionCheckbox checked={selection.selectedKeys.has(key)}
              label={selection.rowLabel(row)} onClick={(event) => event.stopPropagation()}
              onChange={() => {
                const next = new Set(selection.selectedKeys)
                if (next.has(key)) next.delete(key); else next.add(key)
                selection.onChange(next)
              }} />}
          </td> : null}
          {columns.map((column, columnIndex) => {
            const placement = column.narrow ?? (columnIndex === 0 ? 'identity' : 'field')
            return <td key={column.key} role={stacked ? 'cell' : undefined} data-column={column.key} data-narrow-cell={stacked ? placement : undefined}>
              {stacked && placement === 'field' && !loading ? <span className="ui-table__narrow-label" aria-hidden="true">{column.header}</span> : null}
              {row === null ? <Skeleton width={column.width ? '80%' : '65%'} /> : column.render(row)}
            </td>
          })}
          {rowAction ? <td role={stacked ? 'cell' : undefined} data-narrow-cell="action" className="ui-table__row-action">
            {row === null ? <Skeleton width="5rem" /> : onRowClick ? <Button size="sm" variant="ghost" aria-label={rowAction.accessibleLabel(row)}
              aria-expanded={expanded} aria-controls={expanded ? rowAction.disclosure?.panelId : undefined}
              onClick={() => onRowClick(row)}>{rowAction.label}</Button> : null}
          </td> : null}
        </tr>
      })}
    </tbody>
  </table>
  return responsive ? <ResponsiveTableFrame {...responsive}>{table}</ResponsiveTableFrame> : <div className="ui-table-wrap">{table}</div>
}

export function TableToolbar({ searchLabel, searchValue, onSearch, filters, action }: { searchLabel: string; searchValue: string; onSearch: (value: string) => void; filters?: ReactNode; action?: ReactNode }) {
  return <div className="ui-table-toolbar"><SearchInput label={searchLabel} placeholder={searchLabel} value={searchValue} onChange={(event) => onSearch(event.target.value)} />{filters}<span className="ui-table-toolbar__spacer" />{action}</div>
}

type PaginationProps = { page: number; label: string; previousLabel: string; nextLabel: string; disabled?: boolean; onChange: (page: number) => void } &
  ({ pages: number; hasNext?: never } | { pages?: never; hasNext: boolean })

export function Pagination({ page, pages, hasNext, label, previousLabel, nextLabel, disabled, onChange }: PaginationProps) {
  return <nav className="ui-pagination" aria-label={label}><span>{label}</span><IconButton label={previousLabel} size="sm" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={15} /></IconButton><strong aria-live="polite">{page}</strong><IconButton label={nextLabel} size="sm" disabled={disabled || !(hasNext ?? page < (pages ?? 1))} onClick={() => onChange(page + 1)}><ChevronRight size={15} /></IconButton></nav>
}

export function ActionMenu({ label, children }: { label: string; children: ReactNode }) {
  return <details className="ui-action-menu"><summary><MoreHorizontal size={16} /><span className="sr-only">{label}</span></summary><div className="ui-popover ui-action-menu__content">{children}</div></details>
}

export function ActionMenuItem({ children, onClick, danger }: { children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return <button type="button" className={danger ? 'is-danger' : ''} onClick={onClick}>{children}</button>
}

export function FilterSelect({ label, options }: { label: string; options: string[] }) {
  return <Select aria-label={label} defaultValue=""><option value="">{label}</option>{options.map((option) => <option key={option}>{option}</option>)}</Select>
}

export function Timeline({ items }: { items: { title: string; body?: string; time?: string; tone?: 'brand' | 'neutral' }[] }) {
  return <ol className="ui-timeline">{items.map((item, index) => <li key={`${item.title}-${index}`} className={item.tone === 'brand' ? 'is-brand' : ''}><span /><div><strong>{item.title}</strong>{item.body ? <p>{item.body}</p> : null}{item.time ? <small>{item.time}</small> : null}</div></li>)}</ol>
}

export function Stepper({ steps, current }: { steps: { label: string; description?: string }[]; current: number }) {
  return <ol className="ui-stepper">{steps.map((step, index) => <li key={step.label} className={index < current ? 'is-complete' : index === current ? 'is-current' : ''}><span>{index + 1}</span><div><strong>{step.label}</strong>{step.description ? <small>{step.description}</small> : null}</div></li>)}</ol>
}

export function CompactSearch({ label }: { label: string }) {
  return <label className="ui-compact-search"><Search size={15} /><input aria-label={label} placeholder={label} /></label>
}
