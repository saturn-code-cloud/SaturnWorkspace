import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import assert from 'node:assert/strict'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const pages = read('src/new-ui/pages/production/AdminProductionPages.tsx')
const adminSupport = read('src/new-ui/pages/production/AdminSupportWorkspace.tsx')
const adminRelease = read('src/new-ui/pages/production/AdminReleaseWorkspace.tsx')
const productionErrorBlock = read('src/new-ui/pages/production/ProductionErrorBlock.tsx')
const errorSyntax = ts.createSourceFile('error.tsx', productionErrorBlock, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const errorFunction = errorSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'userFacingErrorMessage')
const renderFailure = new Function('copyByLocale', ts.transpileModule(errorFunction.getText(errorSyntax),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '; return userFacingErrorMessage;')(
  (locale, en, ar) => locale === 'ar' ? ar : en,
)
for (const locale of ['en', 'ar']) {
  for (const failure of ['subscriptions_unavailable', 'admin_upstream_html_502:/policy/support?thread_id=private-fixture', 'TypeError: Failed to fetch']) {
    assert.doesNotMatch(renderFailure(failure, locale), /subscriptions_|private-fixture|TypeError|upstream_html/)
  }
  assert.notEqual(renderFailure('origin_not_allowed', locale), renderFailure('subscriptions_unavailable', locale))
}
assert.equal(renderFailure('The selected record changed. Review it again.', 'en'), 'The selected record changed. Review it again.')
console.log('PASS User-facing failures keep actionable messages while hiding technical codes and request paths')
const adminAccounts = read('src/new-ui/pages/production/AdminAccountWorkspace.tsx')
const adminData = read('src/new-ui/pages/production/AdminDataWorkspace.tsx')
const adminDevice = read('src/new-ui/pages/production/AdminDeviceWorkspace.tsx')
const adminDiagnostics = read('src/new-ui/pages/production/AdminDiagnosticWorkspace.tsx')
const adminGovernance = read('src/new-ui/pages/production/AdminGovernanceWorkspace.tsx')
const adminOverview = read('src/new-ui/pages/production/AdminOverviewWorkspace.tsx')
const adminPageSupport = read('src/new-ui/pages/production/adminPageSupport.ts')
const supportQueueRoutes = {}
new Function('exports', ts.transpileModule(read('src/new-ui/pages/production/adminRouteState.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(supportQueueRoutes)
const defaultSupportQueue = { scope: 'all', query: '', status: '', priority: '', page: 1 }
assert.deepEqual(supportQueueRoutes.readSupportQueueState(), defaultSupportQueue)
assert.deepEqual(supportQueueRoutes.readSupportQueueState('?scope=unknown&status=unknown&priority=unknown&page=5001'), defaultSupportQueue)
for (const page of ['0', '-1', '1.5', 'NaN', 'Infinity']) assert.equal(supportQueueRoutes.readSupportQueueState('?page=' + page).page, 1)
const supportQueue = supportQueueRoutes.readSupportQueueState('?query=%20Saturn%20%26%20%D8%AF%D8%B9%D9%85%00%20&status=awaiting_support&priority=high&page=2')
assert.deepEqual(supportQueue, { scope: 'all', query: 'Saturn & دعم', status: 'awaiting_support', priority: 'high', page: 2 })
const supportQueueLink = supportQueueRoutes.supportQueueRoute(supportQueue, 'ticket-one')
assert.equal(new URLSearchParams(supportQueueLink.state).get('thread'), 'ticket-one')
assert.deepEqual(supportQueueRoutes.readSupportQueueState(supportQueueLink.state), supportQueue)
assert.equal(supportQueueRoutes.readSupportQueueState('?scope=waiting&status=closed&priority=urgent').status, '')
assert.equal(supportQueueRoutes.readSupportQueueState('?query=' + 'x'.repeat(201)).query.length, 200)
assert.equal(supportQueueRoutes.supportQueueRoute(defaultSupportQueue).state, undefined)
console.log('PASS Support queue links preserve applied search, filters and page; invalid values are bounded and waiting queues do not inherit a hidden status')
const defaultUsers = { query: '', page: 1, accountStatus: '', subscription: '' }
const defaultSubscriptions = { query: '', page: 1, pendingPage: 1, current: '', lifecycle: '' }
assert.deepEqual(supportQueueRoutes.readUserDirectoryState(), defaultUsers)
assert.deepEqual(supportQueueRoutes.readSubscriptionDirectoryState(), defaultSubscriptions)
for (const invalid of ['0', '-1', '1.5', 'NaN', 'Infinity', '5001', '2e1']) {
  assert.equal(supportQueueRoutes.readUserDirectoryState('?page=' + invalid).page, 1)
  assert.equal(supportQueueRoutes.readSubscriptionDirectoryState('?pending_page=' + invalid).pendingPage, 1)
}
assert.deepEqual(supportQueueRoutes.readUserDirectoryState('?account_status=unknown&subscription_status=unknown'), defaultUsers)
assert.deepEqual(supportQueueRoutes.readSubscriptionDirectoryState('?current=unknown&lifecycle=unknown'), defaultSubscriptions)
const userDirectory = supportQueueRoutes.readUserDirectoryState('?search=%20Saturn%20%26%20%D8%AF%D8%B9%D9%85%00%20&page=3&account_status=suspended&subscription_status=history_only')
assert.deepEqual(userDirectory, { query: 'Saturn & دعم', page: 3, accountStatus: 'suspended', subscription: 'history_only' })
const userDirectoryLink = supportQueueRoutes.userDirectoryRoute(userDirectory, 'fixture/user+one')
assert.equal(new URLSearchParams(userDirectoryLink.state).get('user'), 'fixture/user+one')
assert.deepEqual(supportQueueRoutes.readUserDirectoryState(userDirectoryLink.state), userDirectory)
const subscriptionDirectory = supportQueueRoutes.readSubscriptionDirectoryState('?search=samir&page=2&pending_page=3&current=history&lifecycle=expired')
const subscriptionDirectoryLink = supportQueueRoutes.subscriptionDirectoryRoute(subscriptionDirectory, 'fixture-subscription')
assert.equal(new URLSearchParams(subscriptionDirectoryLink.state).get('subscription'), 'fixture-subscription')
assert.deepEqual(supportQueueRoutes.readSubscriptionDirectoryState(subscriptionDirectoryLink.state), subscriptionDirectory)
assert.equal(supportQueueRoutes.userDirectoryRoute(defaultUsers).state, undefined)
assert.equal(supportQueueRoutes.subscriptionDirectoryRoute(defaultSubscriptions).state, undefined)
assert.equal(supportQueueRoutes.readUserDirectoryState('?search=' + 'x'.repeat(255)).query.length, 254)
assert.equal(supportQueueRoutes.readSubscriptionDirectoryState('?search=' + 'x'.repeat(201)).query.length, 200)
assert.equal(supportQueueRoutes.readReleaseChannel(), 'beta')
assert.equal(supportQueueRoutes.readReleaseChannel('?channel=unknown'), 'beta')
for (const channel of ['stable', 'beta']) assert.equal(supportQueueRoutes.readReleaseChannel(supportQueueRoutes.releaseChannelRoute(channel).state), channel)
assert.ok(adminAccounts.includes('useRouteSearchDraft(') && adminSupport.includes('useRouteSearchDraft(') && adminGovernance.includes('useRouteSearchDraft('))
assert.ok(!pages.includes('key={subscriptionSearch}') && pages.includes('<AdminReleases routeState={routeState}'))
assert.ok(adminRelease.includes('key={channel}') && adminRelease.includes('retainChannel') && !adminRelease.includes('setChannel('))
assert.ok(adminAccounts.includes('useRecordProtection(') && adminAccounts.includes('retainRecord'))
assert.ok(adminGovernance.includes('!invalidAuditSearch(applied) ? <AuditResults'))
assert.ok(adminDiagnostics.includes('userId={userId}') && adminDiagnostics.includes('retainTamperScope') && adminDiagnostics.includes('params.get("user_tab") === "diagnostics"'))
console.log('PASS Account and subscription list routes retain search, filters and both page positions; channels restore from URLs, record drafts retain only their own scope, and invalid audit links do not issue an unfiltered read')
const productionPresentation = read('src/new-ui/pages/production/productionPresentation.ts')
const customerPages = read('src/new-ui/pages/production/ProductionPages.tsx')
const emailWorkspace = read('src/new-ui/pages/production/AdminEmailWorkspace.tsx')
const promotions = read('src/new-ui/pages/production/AdminPromotions.tsx')
const invitations = read('src/new-ui/pages/production/AdminInvites.tsx')
const commerce = read('src/new-ui/pages/production/AdminCommerce.tsx')
const globalPolicy = read('src/new-ui/pages/production/AdminGlobalPolicy.tsx')
const policyRecords = read('src/new-ui/pages/production/AdminPolicyRecords.tsx')
const adminSettings = read('src/new-ui/pages/production/AdminSettings.tsx')
const api = read('src/api/admin.ts')
const adapters = read('src/new-ui/adapters/productionAdapters.ts')
const overlays = read('src/new-ui/components/ui/Overlays.tsx')
const adminResponsive = read('src/new-ui/foundation/admin-responsive.css')
const checkboxStyles = read('src/new-ui/foundation/checkbox.css')
const formControls = read('src/new-ui/components/ui/FormControls.tsx')
const componentStyles = read('src/new-ui/foundation/components.css')
const dateRangePicker = read('src/new-ui/pages/production/DiagnosticDateRangePicker.tsx')
const diagnosticFiltersToolbar = read('src/new-ui/pages/production/DiagnosticFiltersToolbar.tsx')
const adminSectionFinder = read('src/new-ui/layouts/AdminSectionFinder.tsx')
const workspaceShell = read('src/new-ui/layouts/WorkspaceShell.tsx')
assert.ok(workspaceShell.includes('dialog.showModal()') && workspaceShell.includes('onCancel=') &&
  workspaceShell.includes('mobileOpen && !operationalAdmin') &&
  (workspaceShell.match(/<WorkspaceNavigation /g) || []).length === 2)
assert.ok(adminSectionFinder.includes('dialog:modal') && adminResponsive.includes('.admin-mobile-navigation:modal') &&
  adminResponsive.includes('.workspace-topbar__tools > .ui-dropdown:has(.account-trigger)'))
function eagerModules(entry, visited = new Set()) {
  if (visited.has(entry)) return visited
  visited.add(entry)
  const ast = ts.createSourceFile(entry, read(entry), ts.ScriptTarget.Latest, true)
  for (const item of ast.statements) {
    if (!ts.isImportDeclaration(item) || item.importClause?.isTypeOnly || !ts.isStringLiteral(item.moduleSpecifier)) continue
    const clause = item.importClause?.namedBindings
    if (!item.importClause?.name && clause && ts.isNamedImports(clause) && clause.elements.every((member) => member.isTypeOnly)) continue
    const specifier = item.moduleSpecifier.text
    if (!specifier.startsWith('.')) continue
    const stem = path.posix.normalize(path.posix.join(path.posix.dirname(entry), specifier))
    const dependency = [stem, stem + '.ts', stem + '.tsx', stem + '/index.ts', stem + '/index.tsx'].find((candidate) => /\.tsx?$/.test(candidate) && fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile())
    if (dependency) eagerModules(dependency, visited)
  }
  return visited
}
const sectionModules = [
  'AdminAccountWorkspace', 'AdminCommerce', 'AdminDataWorkspace', 'AdminDeviceWorkspace', 'AdminDiagnosticWorkspace',
  'AdminEmailWorkspace', 'AdminGovernanceWorkspace', 'AdminOverviewWorkspace', 'AdminPromotions', 'AdminReleaseWorkspace', 'AdminSettings', 'AdminSupportWorkspace',
]
const eagerApp = eagerModules('src/new-ui/app/ProductionApp.tsx')
for (const section of sectionModules) {
  const file = 'src/new-ui/pages/production/' + section + '.tsx'
  assert.equal(eagerApp.has(file), false, section + ' must not load before access and route selection')
  assert.ok(pages.includes(`lazy(() => import('./${section}')`), section + ' must remain routed on demand')
}
const eagerAccount = eagerModules('src/new-ui/pages/production/AdminAccountWorkspace.tsx')
assert.equal(eagerAccount.has('src/new-ui/pages/production/AdminDiagnosticWorkspace.tsx'), false, 'Closed account diagnostics must not eagerly load the diagnostic workspace')
assert.equal(eagerApp.has('src/new-ui/pages/production/ProductionPages.tsx'), false, 'Admin authentication must not load customer workflows')
assert.ok(!fs.existsSync(path.join(root, 'src/new-ui/pages/production/AdminOperations.tsx')), 'Superseded monolithic sections must be removed')
console.log('PASS Admin loading boundaries: customer pages, operational sections and closed account diagnostics load only when opened')
const supportRoles = {}
new Function('exports', 'require', ts.transpileModule(read('src/new-ui/pages/production/productionSupport.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(supportRoles, () => ({ copyByLocale: (locale, en, ar) => locale === 'ar' ? ar : en }))
const messageSyntax = ts.createSourceFile('ProductionSupportMessage.tsx', read('src/new-ui/pages/production/ProductionSupportMessage.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const messageDeclaration = messageSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'SupportThreadMessage')
assert.ok(messageDeclaration)
const messageCode = ts.transpileModule(messageDeclaration.getText(messageSyntax).replace(/^export\s+/, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText
const Message = new Function('React', 'useAdapters', 'supportSenderRole', 'supportMessageClass', 'supportSenderLabel', 'formatDisplayDate', 'Button', 'Paperclip', messageCode + ';return SupportThreadMessage;')(
  React, () => ({ support: {}, admin: {} }), supportRoles.supportSenderRole, supportRoles.supportMessageClass, supportRoles.supportSenderLabel,
  () => '2026-11-13', ({ children }) => React.createElement('button', null, children), () => null,
)
for (const locale of ['ar', 'en']) for (const sender of ['user', 'admin', 'internal', 'email_inbound', 'system']) {
  for (const body of ['Could you help me?', 'هل يمكنك المساعدة؟', 'Profile saturn-1: تعذر التشغيل', '<script>fixture</script>']) {
    for (const attachmentsDownloadable of [true, false]) {
      const markup = renderToStaticMarkup(React.createElement(Message, { locale, attachmentsDownloadable, message: {
        id: 'fixture-message', sender, body, attachments: [{ id: 'fixture-attachment', filename: 'تقرير-2026.txt' }],
      } }))
      assert.match(markup, new RegExp('<' + (sender === 'system' ? 'span' : 'p') + ' dir="auto">'))
      assert.match(markup, /<bdi>تقرير-2026\.txt<\/bdi>/)
      assert.ok(!markup.includes('<script>'))
      assert.ok(!markup.includes('<strong dir='), 'Sender label must keep the interface direction')
    }
  }
}
console.log('PASS Shared support messages: automatic body direction, isolated filenames, localized sender labels and escaped content in both locales')
const subscriptionPresentation = {}
new Function('exports', ts.transpileModule(read('src/new-ui/pages/production/adminSubscriptionPresentation.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(subscriptionPresentation)
const subscriptionFixture = { id: 'fixture-subscription', is_current_record: true, plan_term: 'monthly', status: 'active', effective_lifecycle: 'active' }
assert.deepEqual(subscriptionPresentation.subscriptionActions(subscriptionFixture), ['correct_expiry', 'suspend', 'cancel_at_period_end', 'cancel_now'])
for (const patch of [{ is_current_record: false }, { integrity_warning: 'conflict' }, { effective_lifecycle: 'cancelled' }, { effective_lifecycle: 'unexpected' }]) {
  assert.deepEqual(subscriptionPresentation.subscriptionActions({ ...subscriptionFixture, ...patch }), [])
}
assert.deepEqual(subscriptionPresentation.subscriptionActions({ ...subscriptionFixture, effective_lifecycle: 'expired' }), ['correct_expiry'])
const suspendedFixture = { ...subscriptionFixture, is_current_record: false, effective_lifecycle: 'suspended', expires_at: '2027-02-01T00:00:00Z', subscription_projection: { existence: 'none' } }
assert.deepEqual(subscriptionPresentation.subscriptionActions(suspendedFixture, Date.parse('2027-01-01')), ['resume', 'cancel_now'])
assert.deepEqual(subscriptionPresentation.subscriptionActions(suspendedFixture, Date.parse('2027-03-01')), [])
assert.deepEqual(subscriptionPresentation.subscriptionActions({ ...suspendedFixture, subscription_projection: { existence: 'present' } }), [])
assert.deepEqual(subscriptionPresentation.subscriptionActions({ ...suspendedFixture, subscription_projection: null }), [])
assert.ok(subscriptionPresentation.subscriptionActions({ ...subscriptionFixture, effective_lifecycle: 'trialing' }).includes('end_trial'))
assert.ok(!subscriptionPresentation.subscriptionActions({ ...subscriptionFixture, effective_lifecycle: 'cancel_at_period_end' }).includes('cancel_at_period_end'))
assert.ok(!subscriptionPresentation.subscriptionActions({ ...subscriptionFixture, plan_term: 'lifetime' }).includes('correct_expiry'))
assert.equal(subscriptionPresentation.subscriptionSourceLabel({ source_type: 'admin_manual' }, 'ar'), 'منح إداري')
assert.equal(subscriptionPresentation.currentAccountSubscription({ item: null }), null)
assert.equal(subscriptionPresentation.currentAccountSubscription({ item: { ...subscriptionFixture, is_current_record: false } }), null)
const accountSubscription = subscriptionPresentation.currentAccountSubscription({ item: subscriptionFixture, subscription_projection: { lifecycle: 'past_due', plan_term: 'annual' } })
assert.equal(accountSubscription.plan_term, 'annual')
assert.ok(subscriptionPresentation.subscriptionActions(accountSubscription).includes('suspend'))
assert.deepEqual(subscriptionPresentation.subscriptionActions(subscriptionPresentation.currentAccountSubscription({ item: subscriptionFixture, subscription_integrity: { integrity: 'conflict', code: 'multiple_current_rows' } })), [])
const statusSyntax = ts.createSourceFile('adminPageSupport.ts', adminPageSupport, ts.ScriptTarget.Latest, true)
const statusFunctions = statusSyntax.statements.filter((item) => ts.isFunctionDeclaration(item) && ['copy', 'statusLabel', 'auditActionLabel'].includes(item.name?.text)).map((item) => item.getText(statusSyntax).replace(/^export\s+/, '')).join('\n')
const displayStatus = new Function(ts.transpileModule(statusFunctions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + ';return statusLabel;')()
const displayAuditAction = new Function(ts.transpileModule(statusFunctions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + ';return auditActionLabel;')()
assert.equal(displayAuditAction('publish', 'en'), 'Release published')
assert.equal(displayAuditAction('publish_targeted', 'ar'), 'تم نشر إصدار موجّه')
assert.equal(displayAuditAction('release', 'en'), 'release')
assert.equal(displayAuditAction('future_action', 'en'), 'future action')
assert.ok(adminGovernance.includes('entry.action || entry.type || "—"'), 'Audit details must preserve the exact action code')
for (const value of ['entitled', 'no_subscription', 'grace_period', 'payment_required', 'ok', 'conflict', 'pending', 'authorized', 'consumed', 'revoked', 'yearly']) {
  assert.match(displayStatus(value, 'ar'), /[\u0600-\u06ff]/, value + ' must not expose a raw status in Arabic')
}
assert.ok(adminAccounts.includes('supportStatusLabel(row.status, locale)'))
assert.ok(adminAccounts.includes('deviceRequestStatusLabel(row.status, locale)'))
assert.ok(adminAccounts.includes('account={{ email: profile.email, firebase_uid: profile.firebase_uid,'))
assert.ok(adminAccounts.includes('exactUser?.firebase_uid === account.firebase_uid'))
assert.ok(adminAccounts.includes('useAdminNavigationProtection(page,'))
const displaySyntax = ts.createSourceFile('DataDisplay.tsx', read('src/new-ui/components/ui/DataDisplay.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const tableDeclaration = displaySyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'DataTable')
const Table = new Function('React', 'EmptyState', 'Skeleton', 'Button', 'ResponsiveTableFrame', 'SelectionCheckbox', ts.transpileModule(tableDeclaration.getText(displaySyntax).replace(/^export\s+/, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText + ';return DataTable;')(React, () => null, () => null, ({ children, ...props }) => React.createElement('button', props, children),
  ({ mode, children }) => React.createElement('div', { 'data-mode': mode }, children),
  ({ label, checked }) => React.createElement('input', { type: 'checkbox', 'aria-label': label, defaultChecked: checked }))
const tableMarkup = renderToStaticMarkup(React.createElement(Table, { columns: [{ key: 'email', header: 'Account', render: (row) => row.email }], rows: [{ id: 'fixture', email: 'samir@example.test' }], rowKey: (row) => row.id, onRowClick: () => {}, rowAction: { header: 'Actions', label: 'Manage', accessibleLabel: (row) => 'Manage ' + row.email } }))
assert.match(tableMarkup, /<button[^>]*aria-label="Manage samir@example.test"[^>]*>Manage<\/button>/)
assert.ok(!tableMarkup.includes('role="button"'), 'Table rows must keep their native row semantics')
const stackedMarkup = renderToStaticMarkup(React.createElement(Table, {
  columns: [{ key: 'email', header: 'Account', render: (row) => row.email }, { key: 'state', header: 'Status', render: () => 'Active' },
    { key: 'action', header: 'Actions', narrow: 'action', render: () => React.createElement('button', null, 'Open') }],
  rows: [{ id: 'fixture', email: 'samir@example.test' }], rowKey: (row) => row.id,
  selection: { selectedKeys: new Set(['fixture']), onChange: () => {}, rowLabel: () => 'Select account', selectAllLabel: 'Select page' },
  responsive: { mode: 'stacked', scrollHint: 'Scroll sideways to see more columns.' },
}))
assert.match(stackedMarkup, /data-mode="stacked"/)
assert.match(stackedMarkup, /<table[^>]*role="table"/)
assert.match(stackedMarkup, /<th scope="col" role="columnheader" data-column="state">Status<\/th>/)
assert.match(stackedMarkup, /data-column="state" data-narrow-cell="field"><span class="ui-table__narrow-label" aria-hidden="true">Status<\/span>Active/)
assert.match(stackedMarkup, /data-column="action" data-narrow-cell="action"><button>Open<\/button>/)
assert.match(stackedMarkup, /aria-label="Select page"/)
assert.match(stackedMarkup, /aria-label="Select account" checked=""/)
assert.equal((stackedMarkup.match(/samir@example\.test/g) ?? []).length, 1, 'A narrow row must not duplicate the account content')
assert.doesNotMatch(tableMarkup, /ui-table__narrow-label|data-mode/)
for (const file of fs.readdirSync(path.join(root, 'src/new-ui/pages/production')).filter((file) => /^Admin.*\.tsx$/.test(file) && file !== 'AdminDataTable.tsx')) {
  assert.doesNotMatch(read('src/new-ui/pages/production/' + file), /<DataTable\b/, file + ' must use the shared Admin table layout')
}
console.log('PASS Admin table layouts keep column semantics, one copy of each record, visible selection and row actions without changing the default customer table')
const feedbackSyntax = ts.createSourceFile('Feedback.tsx', read('src/new-ui/components/ui/Feedback.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const emptyDeclaration = feedbackSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'EmptyState')
const Empty = new Function('React', 'Info', ts.transpileModule(emptyDeclaration.getText(feedbackSyntax).replace(/^export\s+/, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText + ';return EmptyState;')(React, () => null)
const emptySection = renderToStaticMarkup(React.createElement(Empty, { title: 'No sessions', body: '', variant: 'section' }))
assert.match(emptySection, /ui-empty--section/)
assert.doesNotMatch(emptySection, /ui-empty__icon|<p>/)
assert.match(renderToStaticMarkup(React.createElement(Empty, { title: 'No records', body: 'Try a different filter.' })), /ui-empty__icon/)
console.log('PASS Record actions: explicit table buttons and lifecycle-scoped subscription commands, including read-only history, conflicts, trial, suspended, expired and lifetime states')
const syntax = ts.createSourceFile('AdminDiagnosticWorkspace.tsx', adminDiagnostics, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const dateRangeModule = ts.transpileModule(read('src/new-ui/pages/production/diagnosticDateRange.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const dateRanges = {}
new Function('exports', dateRangeModule)(dateRanges)
const accessModule = ts.transpileModule(read('src/new-ui/pages/production/adminAccess.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const adminAccess = {}
new Function('exports', accessModule)(adminAccess)
const tabKeys = {}
new Function('exports', ts.transpileModule(read('src/new-ui/components/ui/tabNavigation.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(tabKeys)
const tabItems = [{ id: 'one' }, { id: 'disabled', disabled: true }, { id: 'three' }, { id: 'four' }]
for (const [current, key, rtl, expected] of [
  ['one', 'ArrowRight', false, 'three'], ['three', 'ArrowLeft', false, 'one'], ['one', 'ArrowLeft', false, 'four'], ['four', 'ArrowRight', false, 'one'],
  ['one', 'ArrowLeft', true, 'three'], ['three', 'ArrowRight', true, 'one'], ['one', 'ArrowRight', true, 'four'], ['four', 'ArrowLeft', true, 'one'],
  ['three', 'Home', false, 'one'], ['three', 'End', false, 'four'], ['three', 'Home', true, 'one'], ['three', 'End', true, 'four'], ['one', 'Enter', false, null], ['disabled', 'ArrowRight', false, null],
]) assert.equal(tabKeys.nextTabTarget(tabItems, current, key, rtl), expected)
assert.equal(tabKeys.nextTabTarget([], 'one', 'Home', false), null)
assert.equal(tabKeys.nextTabTarget([{ id: 'one', disabled: true }], 'one', 'End', false), null)
assert.equal(tabKeys.nextTabTarget([{ id: 'one' }], 'one', 'ArrowRight', false), 'one')
const tabsSyntax = ts.createSourceFile('Navigation.tsx', read('src/new-ui/components/ui/Navigation.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const tabsDeclaration = tabsSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'Tabs')
const tabsCode = ts.transpileModule(tabsDeclaration.getText(tabsSyntax).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
const actualTabs = new Function('React', 'useId', 'useRef', 'useState', 'nextTabTarget', tabsCode + ';return Tabs;')(React, React.useId, React.useRef, React.useState, tabKeys.nextTabTarget)
const tabMarkup = renderToStaticMarkup(React.createElement(React.Fragment, null, ...['first', 'second'].map((group) => React.createElement(actualTabs, { key: group, items: tabItems.map((item) => ({ ...item, label: item.id })), active: 'three', onChange: () => {}, ariaLabel: group }, React.createElement('p', null, group + ' content')))))
const tabIds = Array.from(tabMarkup.matchAll(/\sid="([^"]+)"/g), (match) => match[1]); assert.equal(new Set(tabIds).size, tabIds.length)
const controls = Array.from(tabMarkup.matchAll(/aria-controls="([^"]+)"/g), (match) => match[1]); assert.equal(controls.length, 8); assert.ok(controls.every((id) => tabIds.includes(id)))
const tabButtons = Array.from(tabMarkup.matchAll(/<button[^>]+>/g), (match) => match[0]); assert.equal(tabButtons.filter((button) => button.includes('tabindex="0"')).length, 2); assert.ok(tabButtons.every((button) => button.includes('type="button"')))
assert.equal((tabMarkup.match(/aria-selected="true"/g) || []).length, 2); assert.equal((tabMarkup.match(/hidden=""/g) || []).length, 6); assert.ok(tabMarkup.includes('first content') && tabMarkup.includes('second content'))
console.log('PASS Shared tabs: RTL/LTR roving targets, disabled/empty/singleton cases, manual activation boundary, unique tab/panel associations, selected-only entry and mounted active content')
const navigation = {}
const policyTabs = {}
const compileFixtureModule = (file) => ts.transpileModule(read(file), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
new Function('exports', 'require', compileFixtureModule('src/new-ui/app/adminNavigationProtection.ts'))(navigation, (name) => {
  assert.equal(name, 'react')
  return React
})
new Function('exports', compileFixtureModule('src/new-ui/pages/production/adminPolicyTabs.ts'))(policyTabs)
const routeTo = (page, state) => ({ surface: 'admin', page, state })
const supportDraft = { page: 'support', mode: 'draft' }
const inviteCode = { page: 'policies', mode: 'invite-code', retainOn: (route) => policyTabs.adminPolicyTab(route.state) === 'invites' }
const policySave = { page: 'policies', mode: 'saving', retainOn: (route) => policyTabs.adminPolicyTab(route.state) === 'global' }
assert.equal(navigation.protectionForDestination([], routeTo('support')), null)
assert.equal(navigation.protectionForDestination([supportDraft], routeTo('support', '?thread=other')), null)
assert.equal(navigation.protectionForDestination([supportDraft], routeTo('policies')), 'draft')
assert.equal(navigation.protectionForDestination([supportDraft], { surface: 'portal', page: 'support' }), 'draft')
assert.equal(navigation.protectionForDestination([policySave], routeTo('policies', '?tab=unknown')), null)
for (const state of ['?tab=versions', '?tab=plans', '?tab=invites']) {
  assert.equal(navigation.protectionForDestination([policySave], routeTo('policies', state)), 'saving')
}
assert.equal(navigation.protectionForDestination([supportDraft, policySave], routeTo('policies')), 'draft')
assert.equal(navigation.protectionForDestination([supportDraft, policySave], routeTo('diagnostics')), 'saving')
assert.equal(navigation.protectionForDestination([supportDraft]), 'draft')
assert.equal(navigation.protectionForDestination([supportDraft, policySave]), 'saving')
assert.equal(navigation.protectionForDestination([supportDraft, inviteCode], routeTo('diagnostics')), 'invite-code')
assert.equal(navigation.protectionForDestination([inviteCode, supportDraft], routeTo('diagnostics')), 'invite-code')
assert.equal(navigation.protectionForDestination([inviteCode, policySave], routeTo('diagnostics')), 'saving')
assert.equal(navigation.protectionForDestination([inviteCode], routeTo('policies', '?tab=invites&invite=fixture')), null)
console.log('PASS Admin navigation protection: retained work, lost drafts, in-flight priority, tab boundaries and document exits')
const sectionRequirements = {
  overview: 'admin:read', users: 'users:read', 'device-requests': 'users:read',
  subscriptions: 'subscriptions:read', commerce: 'commerce:read', releases: 'releases:read',
  diagnostics: 'diagnostics:read', data: 'diagnostics:read', audit: 'audit:read',
  policies: 'policies:read', support: 'admin:read', communications: 'admin:read',
  promos: 'admin:read', readiness: 'admin:read', settings: 'admin:read',
}
for (const [section, permission] of Object.entries(sectionRequirements)) {
  assert.equal(adminAccess.canOpenAdminSection([], section), false, section)
  assert.equal(adminAccess.canOpenAdminSection(['*'], section), true, section)
  for (const candidate of new Set(Object.values(sectionRequirements))) {
    assert.equal(adminAccess.canOpenAdminSection([candidate], section), candidate === permission, section + ':' + candidate)
  }
}
for (const unknown of ['content', 'coverage', 'toString', '__proto__']) {
  assert.equal(adminAccess.canOpenAdminSection(['*'], unknown), false, unknown)
}
console.log('PASS Admin section access: every visible destination, empty permissions, exact permissions, wildcard, and unknown routes')
const previousTimeZone = process.env.TZ
try {
  process.env.TZ = 'America/New_York'
  const now = new Date('2026-11-10T14:00:00.000Z')
  const custom = dateRanges.readDiagnosticDateRange('?from=2026-10-30&to=2026-11-02', now)
  assert.equal(custom.adjusted, false)
  assert.equal(dateRanges.diagnosticRangeQuery(custom.range), '?from=2026-10-30&to=2026-11-02')
  assert.deepEqual(dateRanges.diagnosticCoveragePeriod(custom.range), { from: '2026-10-30T04:00:00.000Z', to: '2026-11-03T05:00:00.000Z' })
  const partial = dateRanges.readDiagnosticDateRange('?from=2026-08-01&to=2026-08-13', now)
  assert.equal(partial.adjusted, true)
  assert.equal(dateRanges.diagnosticRangeQuery(partial.range), '?from=2026-08-12&to=2026-08-13')
  assert.equal(dateRanges.readDiagnosticDateRange('?from=2026-02-30&to=2026-11-09', now).adjusted, true)
  assert.equal(dateRanges.readDiagnosticDateRange('?days=30', now).adjusted, false)
} finally {
  if (previousTimeZone === undefined) delete process.env.TZ
  else process.env.TZ = previousTimeZone
}
console.log('PASS Diagnostic calendar: local day boundaries, DST, saved date clipping, and legacy links')
const diagnosticFunction = syntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'diagnosticTechnicalFields')
assert.ok(diagnosticFunction, 'Diagnostic context renderer must exist')
const compiledFunction = ts.transpileModule(diagnosticFunction.getText(syntax).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const technicalFields = new Function(`${compiledFunction}; return diagnosticTechnicalFields;`)()
assert.deepEqual(technicalFields({ lifecycle: { phase: 'checking_data' }, auth: { warning: 'session_expired' }, extra: { attempt: 3 } }), [
  ['lifecycle.phase', 'checking_data'], ['auth.warning', 'session_expired'], ['extra.attempt', '3'],
])
const cyclic = { phase: 'ready' }
cyclic.self = cyclic
assert.deepEqual(technicalFields(cyclic), [['phase', 'ready']])
assert.ok(technicalFields(Array.from({ length: 1000 }, () => 'x')).length <= 160)
const windowFunction = syntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'DiagnosticEventWindow')
assert.ok(windowFunction, 'Diagnostic event timeline must exist')
const windowCode = ts.transpileModule(windowFunction.getText(syntax), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
let timelineLocale = 'en'
const Timeline = new Function('React', 'useExperience', 'copy', 'diagnosticTechnicalFields', `${windowCode}; return DiagnosticEventWindow;`)(React, () => ({ locale: timelineLocale }), (locale, en, ar) => locale === 'ar' ? ar : en, technicalFields)
const timelineEvents = Array.from({ length: 96 }, (_, index) => ({ event: `api.event${index}`, sequence: index + 1, at_unix_ms: 1791800000000, facts: { method: 'synthetic_method', success: false } }))
const timeline = renderToStaticMarkup(React.createElement(Timeline, { title: 'Before failure', value: { complete: false, omitted_events: 5, events: timelineEvents } }))
assert.equal((timeline.match(/<li>/g) || []).length, 96)
assert.match(timeline, /api.event95/)
assert.match(timeline, /omitted_events/)
assert.match(timeline, /<summary>/)
timelineLocale = 'ar'
assert.match(renderToStaticMarkup(React.createElement(Timeline, { title: 'After failure', value: null })), /لم تُسجّل أحداث لهذه الفترة/)
console.log('PASS Diagnostic event timeline: ordered events, complete bounded window, coverage and Arabic empty state')
const exportSource = read('src/new-ui/pages/production/diagnosticReportExport.ts')
const exportModule = { exports: {} }
new Function('exports', ts.transpileModule(exportSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(exportModule.exports)
const { collectDiagnosticReports, collectDiagnosticReportsByIds, createDiagnosticBundle, formatDiagnosticReports, DIAGNOSTIC_BUNDLE_LIMITS } = exportModule.exports
const fullReport = (id) => ({ id, happened_at: '2026-10-11T12:00:00Z', error_type: 'synthetic_failure', message: 'Synthetic report', stack_trace: 'full trace\n'.repeat(1000), technical_context: { lifecycle: { phase: 'ready' } }, raw_payload: { secret: 'not-for-export' } })
const requested = []
let concurrent = 0
let peak = 0
const reader = {
  listCrashLogs: async (filters) => {
    requested.push(filters)
    return filters.cursor === '' ? { success: true, items: [1, 2, 3, 4, 5].map((id) => ({ id: String(id) })), has_more: true, next_cursor: 'older', retention_days: 90 }
      : { success: true, items: [{ id: '5' }, { id: '6' }], has_more: false, next_cursor: null, retention_days: 90 }
  },
  getCrashLog: async (id) => { concurrent++; peak = Math.max(peak, concurrent); await Promise.resolve(); concurrent--; return fullReport(id) },
}
const progress = []
const collected = await collectDiagnosticReports(reader, { user: 'synthetic@example.invalid', classification: 'warning' }, new AbortController().signal, (count) => progress.push(count))
assert.deepEqual(collected.map((report) => report.id), ['1', '2', '3', '4', '5', '6'])
assert.deepEqual(progress, [4, 5, 6])
assert.equal(peak, 4)
assert.ok(requested.every((filters) => filters.user === 'synthetic@example.invalid' && filters.classification === 'warning' && filters.limit === 200))
const exported = JSON.parse(formatDiagnosticReports(collected, requested[0]))
assert.equal(exported.report_count, 6)
assert.equal(exported.reports[0].stack_trace, fullReport('1').stack_trace)
assert.deepEqual(exported.reports[0].technical_context, fullReport('1').technical_context)
assert.ok(!JSON.stringify(exported).includes('not-for-export'))
assert.ok(!('cursor' in exported.filters))
await assert.rejects(collectDiagnosticReports({ ...reader, getCrashLog: async () => { throw new Error('synthetic_read_failed') } }, {}, new AbortController().signal, () => {}), /synthetic_read_failed/)
await assert.rejects(collectDiagnosticReports({ ...reader, listCrashLogs: async () => ({ success: true, items: [], has_more: true, next_cursor: 'repeated' }) }, {}, new AbortController().signal, () => {}), /cursor_invalid/)
await assert.rejects(collectDiagnosticReports({ ...reader, getCrashLog: async () => fullReport('wrong') }, {}, new AbortController().signal, () => {}), /mismatch/)
const cancelled = new AbortController()
cancelled.abort()
await assert.rejects(collectDiagnosticReports(reader, {}, cancelled.signal, () => {}), { name: 'AbortError' })
const duringRead = new AbortController()
await assert.rejects(collectDiagnosticReports({ ...reader, getCrashLog: async (id) => { duringRead.abort(); return fullReport(id) } }, {}, duringRead.signal, () => assert.fail('Cancelled work must not publish progress')), { name: 'AbortError' })
console.log('PASS Full diagnostic collection: pagination, detail, bounded concurrency, filters, cancellation, failures and safe export')
concurrent = 0
peak = 0
const selected = await collectDiagnosticReportsByIds(reader, ['4', '2', '4', '1'], new AbortController().signal)
assert.deepEqual(selected.map((report) => report.id), ['4', '2', '1'])
assert.equal(peak, 3)
await assert.rejects(collectDiagnosticReportsByIds({ getCrashLog: async () => fullReport('wrong') }, ['1'], new AbortController().signal), /mismatch/)
const cancelledSelection = new AbortController()
cancelledSelection.abort()
await assert.rejects(collectDiagnosticReportsByIds(reader, ['1'], cancelledSelection.signal), { name: 'AbortError' })
console.log('PASS Selected diagnostic collection: stable order, de-duplication, bounded concurrency, cancellation and identity checks')
const record = (id, signature = 'repeated', version = '1.2.10') => ({ ...fullReport(String(id)), fingerprint: signature, app_version: version, component: 'desktop-app', occurrence_count: 3, stack_trace: '', classification: 'error' })
const records = Array.from({ length: 2400 }, (_, index) => record(index, `signature-${index % 3}`))
const boundedCalls = []
const detailCalls = []
let bundleConcurrent = 0
let bundlePeak = 0
const bundleReader = {
  listCrashLogs: async (filters, signal) => {
    assert.ok(signal instanceof AbortSignal)
    boundedCalls.push(filters)
    const offset = Number(filters.cursor || 0)
    return { success: true, items: records.slice(offset, offset + filters.limit), has_more: offset + filters.limit < records.length, next_cursor: String(offset + filters.limit), retention_days: 90 }
  },
  getCrashLog: async (id, signal) => {
    assert.ok(signal instanceof AbortSignal)
    detailCalls.push(id); bundleConcurrent++; bundlePeak = Math.max(bundlePeak, bundleConcurrent)
    await Promise.resolve(); bundleConcurrent--
    return { ...records.find((item) => item.id === id), stack_trace: fullReport(id).stack_trace }
  },
}
const bundleProgress = []
const bundleText = await createDiagnosticBundle(bundleReader, { user: 'synthetic@example.invalid', classification: 'error', cursor: 'ignored', limit: 1 }, new AbortController().signal, (count, stage) => bundleProgress.push([count, stage]))
const bundle = JSON.parse(bundleText)
assert.equal(bundle.format, 'saturnws.diagnostic-bundle.v1')
assert.equal(bundle.coverage.scanned_records, 1000)
assert.equal(bundle.coverage.scanned_occurrences, 3000)
assert.equal(bundle.coverage.signature_count, 3)
assert.equal(bundle.coverage.included_examples, 3)
assert.equal(bundle.coverage.omitted_examples, 0)
assert.equal(bundle.coverage.has_more, true)
assert.equal(bundle.coverage.counts_scope, 'scanned_records_only')
assert.equal(bundle.coverage.snapshot, 'cursor_walk_not_atomic')
assert.equal(bundle.coverage.retention_days, 90)
assert.equal(boundedCalls.length, 5)
assert.equal(detailCalls.length, 3)
assert.ok(bundlePeak <= 4)
assert.ok(boundedCalls.every((filters) => filters.user === 'synthetic@example.invalid' && filters.classification === 'error' && filters.limit === 200))
assert.deepEqual(bundleProgress.slice(0, 5).map(([count]) => count), [200, 400, 600, 800, 1000])
assert.equal(bundleProgress.at(-1)[1], 'examples')
assert.equal(bundle.examples[0].stack_trace, fullReport('0').stack_trace)
assert.ok(!bundleText.includes('not-for-export'))
assert.ok(!('cursor' in bundle.filters) && !('limit' in bundle.filters))
assert.equal(bundle.signatures.reduce((total, item) => total + item.record_count, 0), 1000)
assert.equal(bundle.signatures.reduce((total, item) => total + item.occurrence_count, 0), 3000)
assert.ok(bundle.coverage.oldest_record_at && bundle.coverage.newest_record_at && bundle.coverage.scan_started_at && bundle.coverage.scan_completed_at)

const manySignatures = Array.from({ length: 1000 }, (_, index) => ({ ...record(index, `signature-${index}`), message: 'synthetic '.repeat(300), context: 'context '.repeat(120) }))
let manyDetailCalls = 0
let manyConcurrent = 0
let manyPeak = 0
const manyReader = {
  listCrashLogs: async (filters) => { const offset = Number(filters.cursor || 0); return { success: true, items: manySignatures.slice(offset, offset + 200), has_more: offset + 200 < manySignatures.length, next_cursor: String(offset + 200), retention_days: 90 } },
  getCrashLog: async (id) => {
    manyDetailCalls++; manyConcurrent++; manyPeak = Math.max(manyPeak, manyConcurrent)
    await Promise.resolve(); manyConcurrent--
    return { ...manySignatures.find((item) => item.id === id), stack_trace: 'synthetic trace\n'.repeat(10000), technical_context: { unicode: 'تشخيص '.repeat(1000) } }
  },
}
const manyText = await createDiagnosticBundle(manyReader, {}, new AbortController().signal, () => {})
const many = JSON.parse(manyText)
assert.ok(Buffer.byteLength(manyText, 'utf8') <= DIAGNOSTIC_BUNDLE_LIMITS.bytes)
assert.equal(many.coverage.signature_count, 1000)
assert.equal(many.coverage.requested_examples, 40)
assert.equal(manyDetailCalls, 40)
assert.equal(manyPeak, 4)
assert.equal(many.coverage.has_more, false)
assert.equal(many.coverage.included_examples + many.coverage.omitted_examples, 1000)
assert.equal(many.coverage.included_signatures + many.coverage.omitted_signatures, 1000)
assert.equal(many.coverage.examples_omitted_by_byte_limit, 40 - many.examples.length)
assert.ok(many.coverage.omitted_signatures > 0 && many.coverage.examples_omitted_by_byte_limit > 0)
assert.ok(many.examples.length > 0)
assert.ok(many.examples.every((item) => item.stack_trace === 'synthetic trace\n'.repeat(10000)))
assert.ok(many.signatures.every((item) => item.message_preview.length <= 320 && item.message_preview_truncated && !('signature' in item)))

const splitRecords = [record('v1', 'same', '1.2.9'), record('v2', 'same', '1.2.10'), { ...record('source', 'same'), component: 'launcher' }, { ...record('fallback-a'), fingerprint: null, message: 'first' }, { ...record('fallback-b'), fingerprint: null, message: 'second' }]
const splitReader = { listCrashLogs: async () => ({ success: true, items: splitRecords, has_more: false, next_cursor: null, retention_days: 90 }), getCrashLog: async (id) => splitRecords.find((item) => item.id === id) }
const split = JSON.parse(await createDiagnosticBundle(splitReader, {}, new AbortController().signal, () => {}))
assert.equal(split.coverage.signature_count, 5)
assert.equal(split.examples.length, 5)
const duplicates = JSON.parse(await createDiagnosticBundle({ ...splitReader, listCrashLogs: async () => ({ success: true, items: [splitRecords[0], splitRecords[0]], has_more: false, next_cursor: null, retention_days: 90 }) }, {}, new AbortController().signal, () => {}))
assert.equal(duplicates.coverage.scanned_records, 1)
assert.equal(duplicates.coverage.scanned_occurrences, 3)
const recentRecords = [
  { ...record('older'), happened_at: '2026-10-01T12:00:00Z', first_happened_at: '2026-09-30T12:00:00Z', last_happened_at: '2026-10-02T12:00:00Z' },
  { ...record('newer'), happened_at: '2026-10-03T12:00:00Z', last_happened_at: '2026-10-04T12:00:00Z' },
]
const recent = JSON.parse(await createDiagnosticBundle({ listCrashLogs: async () => ({ success: true, items: recentRecords, has_more: false, next_cursor: null, retention_days: 90 }), getCrashLog: async (id) => recentRecords.find((item) => item.id === id) }, {}, new AbortController().signal, () => {}))
assert.equal(recent.examples[0].id, 'newer')
assert.equal(recent.coverage.oldest_record_at, '2026-10-01T12:00:00Z')
assert.equal(recent.coverage.newest_record_at, '2026-10-03T12:00:00Z')
assert.equal(recent.signatures[0].first_happened_at, '2026-09-30T12:00:00Z')
assert.equal(recent.signatures[0].last_happened_at, '2026-10-04T12:00:00Z')

for (const collect of [collectDiagnosticReports, createDiagnosticBundle]) {
  await assert.rejects(collect({ ...bundleReader, listCrashLogs: async () => ({ success: false, items: [], has_more: false, next_cursor: null }) }, {}, new AbortController().signal, () => {}), /export_failed/)
  await assert.rejects(collect({ ...bundleReader, listCrashLogs: async () => ({ success: true, items: [], has_more: true, next_cursor: null }) }, {}, new AbortController().signal, () => {}), /cursor_invalid/)
  await assert.rejects(collect({ ...bundleReader, listCrashLogs: async () => ({ success: true, items: [], has_more: true, next_cursor: 'same' }) }, {}, new AbortController().signal, () => {}), /cursor_invalid/)
  await assert.rejects(collect({ ...splitReader, getCrashLog: async () => { throw new Error('synthetic_detail_failure') } }, {}, new AbortController().signal, () => {}), /detail_failure/)
  await assert.rejects(collect({ ...splitReader, getCrashLog: async () => record('wrong') }, {}, new AbortController().signal, () => {}), /mismatch/)
  let underlyingSignal
  const cancelledPending = new AbortController()
  const pending = collect({ ...bundleReader, listCrashLogs: (_, signal) => { underlyingSignal = signal; return new Promise(() => {}) } }, {}, cancelledPending.signal, () => assert.fail('Cancelled read must not publish progress'))
  cancelledPending.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(underlyingSignal.aborted, true)
  let deadlineSignal
  await assert.rejects(collect({ ...bundleReader, listCrashLogs: (_, signal) => { deadlineSignal = signal; return new Promise(() => {}) } }, {}, new AbortController().signal, () => assert.fail('Timed-out read must not publish progress'), { deadlineMs: 5 }), { name: 'TimeoutError' })
  assert.equal(deadlineSignal.aborted, true)
  const cancelledDetail = new AbortController()
  let detailSignal
  const detailPending = collect({ ...splitReader, getCrashLog: (_, signal) => { detailSignal = signal; cancelledDetail.abort(); return new Promise(() => {}) } }, {}, cancelledDetail.signal, () => {})
  await assert.rejects(detailPending, { name: 'AbortError' })
  assert.equal(detailSignal.aborted, true)
}
await assert.rejects(createDiagnosticBundle({ ...splitReader, getCrashLog: async (id) => ({ ...splitRecords.find((item) => item.id === id), app_version: 'changed' }) }, {}, new AbortController().signal, () => {}), /mismatch/)
const empty = JSON.parse(await createDiagnosticBundle({ ...bundleReader, listCrashLogs: async () => ({ success: true, items: [], has_more: false, next_cursor: null, retention_days: 90 }) }, {}, new AbortController().signal, () => {}))
assert.equal(empty.coverage.scanned_records, 0)
assert.equal(empty.examples.length, 0)
assert.equal(empty.coverage.oldest_record_at, null)
console.log('PASS Bounded diagnostic bundle: large histories, signatures, complete samples, byte coverage, real cancellation and deadlines')
const apiSyntax = ts.createSourceFile('admin.ts', api, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const apiFunctionNames = ['adminBaseUrl', 'compactAdminError', 'adminFetch', 'diagnosticQuery', 'fetchCrashLogs', 'fetchCrashLog']
const diagnosticHttpSource = apiSyntax.statements.filter((item) => ts.isFunctionDeclaration(item) && apiFunctionNames.includes(item.name?.text)).map((item) => item.getText(apiSyntax).replace(/^export\s+/, '')).join('\n')
const compiledHttp = ts.transpileModule(diagnosticHttpSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let httpMode = 'list'
let actualHttpSignal
const diagnosticHttp = new Function('fetch', 'getAdminToken', 'ApiError', `${compiledHttp}; return { fetchCrashLogs, fetchCrashLog };`)(async (url, init) => {
  actualHttpSignal = init.signal
  assert.equal(init.credentials, 'same-origin')
  assert.ok(!init.headers.has('Authorization'))
  if (httpMode === 'pending' || (httpMode === 'detail-pending' && url.includes('/crash-logs/'))) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
  const payload = httpMode === 'list' || httpMode === 'detail-pending'
    ? { success: true, items: httpMode === 'detail-pending' ? [fullReport('encoded/id')] : [], has_more: false, next_cursor: null, retention_days: 90 }
    : { success: true, item: fullReport('encoded/id') }
  assert.ok(url.startsWith('/api/admin/crash-logs'))
  return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
}, () => '', Error)
const httpController = new AbortController()
await diagnosticHttp.fetchCrashLogs({ user: 'synthetic@example.invalid' }, httpController.signal)
assert.equal(actualHttpSignal, httpController.signal)
httpMode = 'detail'
assert.equal((await diagnosticHttp.fetchCrashLog('encoded/id', httpController.signal)).item.id, 'encoded/id')
assert.equal(actualHttpSignal, httpController.signal)
httpMode = 'pending'
await assert.rejects(createDiagnosticBundle({ listCrashLogs: diagnosticHttp.fetchCrashLogs, getCrashLog: async (id, signal) => (await diagnosticHttp.fetchCrashLog(id, signal)).item }, {}, new AbortController().signal, () => {}, { deadlineMs: 5 }), { name: 'TimeoutError' })
assert.equal(actualHttpSignal.aborted, true)
httpMode = 'detail-pending'
await assert.rejects(createDiagnosticBundle({ listCrashLogs: diagnosticHttp.fetchCrashLogs, getCrashLog: async (id, signal) => (await diagnosticHttp.fetchCrashLog(id, signal)).item }, {}, new AbortController().signal, () => {}, { deadlineMs: 5 }), { name: 'TimeoutError' })
assert.equal(actualHttpSignal.aborted, true)
console.log('PASS Diagnostic HTTP cancellation: actual list/detail API helpers forward the deadline signal into fetch')
const userListFunction = apiSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'fetchAdminUsers')
const userListCode = ts.transpileModule(userListFunction.getText(apiSyntax).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let usersReply = { success: true, directory_version: 1, exact_email: null, items: [], total: 0, page: 1, limit: 8 }
let usersRequest
const userList = new Function('adminFetch', userListCode + ';return fetchAdminUsers;')(async (url, init) => {
  usersRequest = { url, signal: init.signal }
  init.signal?.throwIfAborted()
  return usersReply
})
const usersController = new AbortController()
assert.deepEqual(await userList({ search: 'fixture+query@example.test', limit: 8 }, usersController.signal), usersReply)
assert.equal(usersRequest.signal, usersController.signal)
assert.equal(new URL(usersRequest.url, 'https://fixture.invalid').searchParams.get('search'), 'fixture+query@example.test')
const validUserPage = { ...usersReply, items: [{ firebase_uid: 'fixture-user', email: 'fixture-user@example.test', account_status: 'active', subscription_presence: 'active', session_count: 0, device_count: 0 }], total: 1 }
usersReply = validUserPage
assert.deepEqual(await userList({ limit: 8 }), validUserPage)
for (const bad of [null, { ...validUserPage, success: false }, { ...validUserPage, directory_version: undefined }, { ...validUserPage, items: null }, { ...validUserPage, total: -1 },
  { ...validUserPage, total: 0.5 }, { ...validUserPage, page: 2 }, { ...validUserPage, limit: 25 }, { ...validUserPage, total: 2 },
  { ...validUserPage, items: [null] }, { ...validUserPage, items: [{ ...validUserPage.items[0], firebase_uid: '' }] },
  { ...validUserPage, items: [{ ...validUserPage.items[0], email: null }] }, { ...validUserPage, items: [{ ...validUserPage.items[0], subscription_presence: 'unknown' }] },
  { ...validUserPage, items: [validUserPage.items[0], validUserPage.items[0]], total: 2 }]) {
  usersReply = bad
  await assert.rejects(userList({ limit: 8 }), /admin_users_unavailable/)
}
const exactUserQuery = { limit: 8, exactEmail: true, search: 'FIXTURE-USER@EXAMPLE.TEST' }
usersReply = { ...validUserPage, exact_email: 'fixture-user@example.test' }
assert.deepEqual(await userList(exactUserQuery), usersReply)
assert.equal(new URL(usersRequest.url, 'https://fixture.invalid').searchParams.get('exact_email'), 'true')
usersReply = { ...usersReply, items: [{ ...usersReply.items[0], email: 'fixture-other@example.test' }] }
await assert.rejects(userList(exactUserQuery), /admin_users_unavailable/)
usersController.abort()
await assert.rejects(userList({ limit: 8 }, usersController.signal), { name: 'AbortError' })
const userListAdapter = adapters.slice(adapters.indexOf('async listUsers('), adapters.indexOf('async listSubscriptions('))
assert.ok(userListAdapter.includes('fetchAdminUsers(input, signal)') && !userListAdapter.includes('items: data.items || []'), 'User-list failures must not be turned into an empty account search')
console.log('PASS Account searches preserve cancellation and reject false success, wrong pages, malformed identities, duplicate records and invalid counts')
const section = (source, start, end) => {
  const from = source.indexOf(start)
  const to = end ? source.indexOf(end, from + start.length) : source.length
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`)
  return source.slice(from, to)
}
const manualGrant = section(adminAccounts, 'function ManualGrantPage', 'function AdminOperationDialog')
const userDetail = section(adminAccounts, 'function UserDetailPage', 'function SubscriptionRecoveryPage')
const recovery = section(adminAccounts, 'function SubscriptionRecoveryPage', 'export function AdminSubscriptions')
const diagnostics = section(adminDiagnostics, 'export function AdminDiagnostics')
const adminReleasesStart = adapters.indexOf('async listReleases(')
const adminReleasesAdapter = adapters.slice(adminReleasesStart, adapters.indexOf('async uploadRelease(', adminReleasesStart))
let currentReleasePayload = { success: true, channel: 'beta', item: {
  channel: 'beta', version: '2.1.0', available: false, disabled: true, disabled_reason: 'Fixture pause',
  published_at: '2026-11-14T12:00:00Z', mandatory: false, notes: 'Fixture notes',
  filename: '', download_url: '', download_sha256: '', artifacts: { installed: { filename: 'fixture.zip' } },
} }
const releaseSignal = new AbortController().signal
const releaseRead = new Function('fetchCurrentAdminRelease', ts.transpileModule(
  'const reader = ({' + adapters.slice(adminReleasesStart, adapters.indexOf('async getStagedRelease(', adminReleasesStart)) + '});',
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText + ';return reader;')(
  async (channel, signal) => { assert.equal(channel, 'beta'); assert.equal(signal, releaseSignal); return currentReleasePayload },
)
assert.equal((await releaseRead.listReleases('beta', releaseSignal))[0].disabled_reason, 'Fixture pause')
const validCurrentRelease = currentReleasePayload
for (const change of [{ disabled: undefined }, { disabled: 'true' }, { disabled_reason: {} }, { mandatory: 'false' },
  { notes: {} }, { published_at: undefined }, { published_at: 'invalid' }, { channel: 'stable' },
  { artifacts: [] }, { artifacts: { installed: { filename: {} } } }, { artifacts: { portable: { size_bytes: -1 } } }]) {
  currentReleasePayload = { ...validCurrentRelease, item: { ...validCurrentRelease.item, ...change } }
  await assert.rejects(releaseRead.listReleases('beta', releaseSignal), /release_channel_unavailable/)
}
currentReleasePayload = { ...validCurrentRelease, success: 'true' }
await assert.rejects(releaseRead.listReleases('beta', releaseSignal), /release_channel_unavailable/)
console.log('PASS Current release reads retain disabled records, forward cancellation, and reject malformed availability, dates, channel, or artifact metadata')
const supportMutationsStart = adapters.indexOf('async sendSupportReply(')
const supportMutationsCode = adapters.slice(supportMutationsStart, adapters.indexOf('getEmailConfiguration:', supportMutationsStart))
let supportReplyResult = { success: true, email_queued: false }
let supportStatusResult = { success: true, status: 'closed' }
let lastSupportReply
let lastSupportStatus
const supportMutations = new Function('sendSupportReply', 'updateAdminSupportStatus', 'updateAdminSupportPriority', 'setSupportBlocked', 'return ({' + supportMutationsCode + '});')(
  async (value) => { lastSupportReply = value; return supportReplyResult },
  async (value) => { lastSupportStatus = value; return supportStatusResult },
  async (value) => ({ success: true, priority: value.priority }),
  async (value) => ({ success: true, blocked: value.blocked }),
)
assert.deepEqual(await supportMutations.sendSupportReply('fixture-thread', 'Fixture reply', { idempotencyKey: 'fixture-stable-reply', emailRequested: true }), { emailQueued: false })
assert.equal(lastSupportReply.idempotency_key, 'fixture-stable-reply')
supportReplyResult = { success: false }
await assert.rejects(supportMutations.sendSupportReply('fixture-thread', 'Fixture reply'), /support_reply_failed/)
await supportMutations.updateSupportStatus('fixture-thread', 'closed', 'Fixture reason', { idempotencyKey: 'fixture-stable-status' })
assert.equal(lastSupportStatus.idempotency_key, 'fixture-stable-status')
supportStatusResult = { success: true, status: 'open' }
await assert.rejects(supportMutations.updateSupportStatus('fixture-thread', 'closed'), /support_status_failed/)
console.log('PASS Support mutations preserve retry identity, reject unsuccessful responses, and expose the email-queue outcome')
const supportReadCode = ['fetchSupportInbox', 'fetchAdminSupportConversation', 'fetchAdminSupportHistory', 'markAdminSupportMessagesRead'].map((name) =>
  apiSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name).getText(apiSyntax).replace(/^export\s+/, ''),
).join('\n')
let supportReadPayload
const supportCalls = []
const supportReads = new Function('adminFetch', ts.transpileModule(supportReadCode, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText + '\nreturn {fetchSupportInbox, fetchAdminSupportConversation, fetchAdminSupportHistory, markAdminSupportMessagesRead};')(
  async (path, init) => { supportCalls.push({ path, init }); return supportReadPayload },
)
const supportSignal = new AbortController().signal
const dashboardBinding = apiSyntax.statements.find((item) => ts.isVariableStatement(item)
  && item.declarationList.declarations.some((declaration) => declaration.name.getText(apiSyntax) === 'dashboardCounts'))
const dashboardReader = apiSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'fetchAdminDashboard')
const dashboardReaderCode = ts.transpileModule(dashboardBinding.getText(apiSyntax) + '\n' +
  dashboardReader.getText(apiSyntax).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let dashboardResponse
const readDashboard = new Function('adminFetch', 'parseServiceTimestamp', dashboardReaderCode + '\nreturn fetchAdminDashboard;')(
  async (path, init) => {
    assert.equal(path, '/dashboard')
    assert.equal(init.signal, supportSignal)
    assert.equal(init.cache, 'no-store')
    return dashboardResponse
  },
  (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value) : null,
)
const dashboardActivity = { id: 'audit-fixture', action: 'policy_global_update', timestamp: '2026-11-14T12:00:00Z', payload: { unused: true } }
dashboardResponse = { success: true, kpis: { total_users: 0, total_active_users: 25, active_sessions: 10, active_tampering_alerts: null },
  recent_activity: [dashboardActivity], degraded_resources: ['sessions'], subscription_count_limited: true }
const dashboard = await readDashboard(supportSignal)
assert.equal(dashboard.kpis.total_users, 0)
assert.equal(dashboard.kpis.total_active_users, null)
assert.equal(dashboard.kpis.active_sessions, null)
assert.deepEqual(dashboard.degraded_resources, ['sessions'])
assert.equal(dashboard.recent_activity[0].id, dashboardActivity.id)
assert.ok(!('payload' in dashboard.recent_activity[0]))
dashboardResponse = { ...dashboardResponse, kpis: { ...dashboardResponse.kpis, total_users: -1 },
  recent_activity: [dashboardActivity, dashboardActivity] }
assert.deepEqual((await readDashboard(supportSignal)).degraded_resources, ['sessions', 'profiles', 'activity'])
assert.deepEqual((await readDashboard(supportSignal)).recent_activity, [])
dashboardResponse = { ...dashboardResponse, success: false }
await assert.rejects(readDashboard(supportSignal), /dashboard_unavailable/)
console.log('PASS Overview distinguishes confirmed zero, capped, failed and malformed sources, and forwards cancellation')
supportReadPayload = { success: true, threads: [{ id: 'ticket-one' }], page: 2, limit: 25, has_more: false }
assert.equal((await supportReads.fetchSupportInbox({ scope: 'waiting', priority: 'high', query: 'Saturn & دعم', page: 2 }, supportSignal)).threads.length, 1)
const supportQueueQuery = new URLSearchParams(supportCalls.at(-1).path.split('?')[1])
assert.equal(supportQueueQuery.get('page'), '2')
assert.equal(supportQueueQuery.get('query'), 'Saturn & دعم')
assert.equal(supportCalls.at(-1).init.signal, supportSignal)
const validSupportPage = supportReadPayload
for (const invalid of [{ ...validSupportPage, success: false }, { ...validSupportPage, success: undefined },
  { ...validSupportPage, page: 1 }, { ...validSupportPage, limit: 50 }, { ...validSupportPage, has_more: true },
  { ...validSupportPage, threads: [{ id: 'ticket-one' }, { id: 'ticket-one' }] },
  { ...validSupportPage, threads: [null] }, { ...validSupportPage, threads: [{ id: '../ticket' }] },
  { ...validSupportPage, threads: Array.from({ length: 26 }, (_, id) => ({ id: 'ticket-' + id })) }]) {
  supportReadPayload = invalid
  await assert.rejects(supportReads.fetchSupportInbox({ page: 2 }, supportSignal), /support_inbox_unavailable/)
}
supportReadPayload = { success: true, thread: { id: 'ticket-one' }, messages: [{ id: 'message-one', thread_id: 'ticket-one' }], unread_message_ids: ['message-one', 'message-one'] }
assert.deepEqual((await supportReads.fetchAdminSupportConversation('ticket-one', supportSignal)).unreadMessageIds, ['message-one'])
assert.equal(supportCalls.at(-1).init.signal, supportSignal)
supportReadPayload = { ...supportReadPayload, unread_message_ids: ['message-two'] }
await assert.rejects(supportReads.fetchAdminSupportConversation('ticket-one'), /support_inbox_unavailable/)
supportReadPayload = { success: true, thread_id: 'ticket-one', events: [], next_cursor: null }
assert.deepEqual(await supportReads.fetchAdminSupportHistory('ticket-one', 'cursor-one', supportSignal), { events: [], nextCursor: null })
assert.equal(supportCalls.at(-1).path, '/policy/support/history?thread_id=ticket-one&cursor=cursor-one')
assert.equal(supportCalls.at(-1).init.signal, supportSignal)
for (const payload of [{ ...supportReadPayload, thread_id: 'ticket-two' }, { ...supportReadPayload, next_cursor: 'cursor-one' }, { ...supportReadPayload, events: [null] }]) {
  supportReadPayload = payload
  await assert.rejects(supportReads.fetchAdminSupportHistory('ticket-one', 'cursor-one'), /support_history_unavailable/)
}
supportReadPayload = { success: true }
await supportReads.markAdminSupportMessagesRead('ticket-one', Array.from({ length: 201 }, (_, index) => 'message-' + index), supportSignal)
assert.deepEqual(supportCalls.slice(-3).map(({ init }) => JSON.parse(init.body).message_ids.length), [100, 100, 1])
assert.ok(supportCalls.slice(-3).every(({ init }) => init.signal === supportSignal && init.method === 'POST'))
supportReadPayload = { success: false }
await assert.rejects(supportReads.markAdminSupportMessagesRead('ticket-one', ['message-one']), /support_read_unavailable/)
console.log('PASS Support history and read receipts validate identity, cursor shape, retry outcome, bounded batches, and cancellation')
const subscriptionListStart = adapters.indexOf('async listSubscriptions(')
let subscriptionResponse = { success: true, view: 'directory', items: [], total: 0, page: 2, limit: 25 }
let subscriptionArguments
const subscriptionList = new Function('fetchSubscriptions',
  'return ({' + adapters.slice(subscriptionListStart, adapters.indexOf('async createSubscription(', subscriptionListStart)) + '});')(
  async (...args) => { subscriptionArguments = args; return subscriptionResponse },
)
assert.deepEqual(await subscriptionList.listSubscriptions({ page: 2 }, supportSignal), { items: [], total: 0, page: 2, limit: 25 })
assert.equal(subscriptionArguments[1], supportSignal)
assert.equal(subscriptionArguments[2], true)
for (const bad of [{ ...subscriptionResponse, total: 26 }, { ...subscriptionResponse, view: undefined },
  { ...subscriptionResponse, page: 1 }, { ...subscriptionResponse, items: null }]) {
  subscriptionResponse = bad
  await assert.rejects(subscriptionList.listSubscriptions({ page: 2 }), /subscriptions_unavailable/)
}
subscriptionResponse = { success: true, view: 'directory', items: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_email: 'fixture@example.test', is_current_record: true }], total: 1, page: 1, limit: 1 }
assert.equal((await subscriptionList.listSubscriptions({ id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', limit: 1 }, supportSignal)).items.length, 1)
assert.equal(subscriptionArguments[0].id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
subscriptionResponse = { ...subscriptionResponse, items: [{ ...subscriptionResponse.items[0], id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }] }
await assert.rejects(subscriptionList.listSubscriptions({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', limit: 1 }), /subscriptions_unavailable/)
assert.ok(adminAccounts.includes('function UserDetailPage') && adminAccounts.includes('function SubscriptionRecord'))
assert.ok(!adminAccounts.includes('function UserDetailDrawer') && !adminAccounts.includes('function SubscriptionDetailDrawer'))
for (const name of fs.readdirSync(path.join(root, 'src/new-ui/pages/production')).filter((name) => /^Admin.*\.tsx$/.test(name))) {
  assert.doesNotMatch(read('src/new-ui/pages/production/' + name), /\bDrawer\b/, name + ' must not reintroduce the admin slide-over pattern')
}
assert.ok(adminAccounts.includes('subscriptionDirectoryRoute(directory, row.id)'))
assert.ok(adminDevice.includes('<AdminRecordPage') && adminDevice.includes('parentRoute={deviceRequestsRoute(status, page)}')
  && adminDevice.includes('sameDeviceRequest(preview.request, request)')
  && adminDevice.includes('request_id: currentReview.operationId')
  && adminDevice.includes('useRecordReturnFocus(requestId'))
const deviceDetailFunction = apiSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'fetchAdminDeviceChangeRequest')
let deviceReply
const readDevice = new Function('adminFetch', 'parseServiceTimestamp',
  ts.transpileModule(deviceDetailFunction.getText(apiSyntax).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    + '\nreturn fetchAdminDeviceChangeRequest;')(
  async (path, options) => {
    assert.equal(path, '/device-change-requests/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    assert.equal(options.signal, supportSignal)
    return deviceReply
  },
  (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value) : null,
)
const deviceFixture = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'pending', firebase_uid: 'fixture-device-owner',
  requested_device_key: '0123456789abcdef', current_binding_id: null, updated_at: '2026-11-14T10:00:00Z' }
deviceReply = { success: true, item: deviceFixture }
assert.equal((await readDevice(deviceFixture.id, supportSignal)).id, deviceFixture.id)
for (const invalid of [
  { success: false, item: deviceFixture }, { success: 'true', item: deviceFixture },
  { success: true, item: { ...deviceFixture, id: 'wrong' } },
  { success: true, item: { ...deviceFixture, status: 'unknown' } },
  { success: true, item: { ...deviceFixture, firebase_uid: '' } },
  { success: true, item: { ...deviceFixture, requested_device_key: null } },
  { success: true, item: { ...deviceFixture, updated_at: null } },
  { success: true, item: { ...deviceFixture, current_binding_id: undefined } },
]) {
  deviceReply = invalid
  await assert.rejects(readDevice(deviceFixture.id, supportSignal), /device_change_requests_unavailable/)
}
console.log('PASS Device request details reject mismatched or malformed decision state and forward cancellation')
const recordPreview = read('src/new-ui/pages/production/AdminRecordPreview.tsx')
assert.equal((adminAccounts.match(/<AdminRecordPreviewLayout panel=/g) || []).length, 2)
assert.ok(recordPreview.includes('<aside id={id} aria-labelledby=') && recordPreview.includes('<RouteLink route={recordRoute}'))
assert.ok(adminResponsive.includes('@container admin-preview') && adminResponsive.includes('data-preview-open'))
assert.doesNotMatch(recordPreview, /\b(?:Modal|role="dialog"|aria-modal|createPortal)\b/)
const pendingGrantFunction = apiSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'fetchPendingSubscriptionGrantPage')
let pendingGrantResponse = { success: true, view: 'directory', items: [], total: 0, page: 1, limit: 5 }
const readPending = new Function('adminFetch', ts.transpileModule(pendingGrantFunction.getText(apiSyntax).replace(/^export\s+/, ''),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\nreturn fetchPendingSubscriptionGrantPage;')(
  async (_path, { signal }) => { assert.equal(signal, supportSignal); return pendingGrantResponse },
)
assert.equal((await readPending('pending', 1, supportSignal)).total, 0)
for (const bad of [{ ...pendingGrantResponse, success: false }, { ...pendingGrantResponse, total: 1 },
  { ...pendingGrantResponse, total: 1, items: [{ id: 'fixture-grant', normalized_email: 'fixture@example.test', status: 'claimed' }] }]) {
  pendingGrantResponse = bad
  await assert.rejects(readPending('pending', 1, supportSignal), /pending_grants_unavailable/)
}
console.log('PASS Subscription and pending-grant consumers preserve cancellation and reject capped legacy, malformed counts, wrong pages, and mismatched records')
const readinessFunction = apiSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'fetchAdminReadiness')
const readinessCode = ts.transpileModule(readinessFunction.getText(apiSyntax).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let readinessSignal
const { default: readinessWorker } = await import(new URL('../../workers/admin/src/index.js', import.meta.url))
const originalReadinessFetch = globalThis.fetch
let readinessPayload
try {
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith('https://supabase.example.invalid/rest/v1/'))
    assert.equal(init.method, 'GET')
    return Response.json([])
  }
  const producerResponse = await readinessWorker.fetch(new Request('https://admin.saturnws.com/api/admin/readiness', {
    headers: { 'cf-access-authenticated-user-email': 'readiness-fixture@example.invalid' },
  }), {
    SUPABASE_URL: 'https://supabase.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-readiness-key',
    ADMIN_EMAIL_ALLOWLIST: 'readiness-fixture@example.invalid',
  })
  assert.equal(producerResponse.status, 200)
  readinessPayload = await producerResponse.json()
} finally {
  globalThis.fetch = originalReadinessFetch
}
const readReadiness = new Function('adminFetch', readinessCode + '; return fetchAdminReadiness;')(async (path, init) => {
  assert.equal(path, '/readiness'); readinessSignal = init.signal; return readinessPayload
})
const readinessController = new AbortController()
assert.equal((await readReadiness(readinessController.signal)).checks[0].status, 'passed')
assert.equal(readinessSignal, readinessController.signal)
for (const malformed of [
  { success: true, generated_at: 'invalid', checks: [] },
  { success: true, generated_at: '2026-11-11T12:00:00Z', services: { supabase: 'ready' } },
  { ...readinessPayload, checks: [readinessPayload.checks[0], readinessPayload.checks[0]] },
  { ...readinessPayload, checks: [{ ...readinessPayload.checks[0], kind: 'configuration' }] },
  { ...readinessPayload, checks: [{ ...readinessPayload.checks[0], reason: 'schema_missing' }] },
]) {
  readinessPayload = malformed
  await assert.rejects(readReadiness(), /readiness_unavailable/)
}
console.log('PASS Readiness rejects unqualified legacy results and inconsistent success states, and forwards cancellation')

const emailApiNames = ['validEmailActivityItem', 'fetchAdminEmailConfiguration', 'fetchAdminEmailActivity', 'fetchAdminEmailJob']
const emailApiCode = ts.transpileModule(apiSyntax.statements.filter((item) => ts.isFunctionDeclaration(item) && emailApiNames.includes(item.name?.text)).map((item) => item.getText(apiSyntax).replace(/^export\s+/, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const emailFixture = { success: true, view: 'outbound', query: 'fixture', status: 'failed', job_id: null, page: 2, limit: 25, has_more: false, items: [{ id: 'fixture-job', email_type: 'admin.email_test', recipient: 'fixture@example.test', subject: 'Fixture', status: 'failed' }], generated_at: '2026-11-11T12:00:00Z' }
let emailPayload = structuredClone(emailFixture)
let emailRequest
const emailApi = new Function('adminFetch', emailApiCode + '; return { fetchAdminEmailActivity, fetchAdminEmailJob, fetchAdminEmailConfiguration };')(async (path, init) => { emailRequest = { path, init }; return emailPayload })
const emailInput = { view: 'outbound', query: ' fixture ', status: 'failed', page: 2 }
assert.equal((await emailApi.fetchAdminEmailActivity(emailInput, readinessController.signal)).items[0].id, 'fixture-job')
assert.equal(emailRequest.init.signal, readinessController.signal)
assert.equal(new URL('https://fixture.invalid' + emailRequest.path).searchParams.get('query'), 'fixture')
for (const invalid of [
  { ...emailFixture, success: false }, { ...emailFixture, view: 'inbound' }, { ...emailFixture, page: 1 }, { ...emailFixture, query: 'other' },
  { ...emailFixture, has_more: undefined }, { ...emailFixture, items: null }, { ...emailFixture, items: [emailFixture.items[0], emailFixture.items[0]] },
  { ...emailFixture, items: [{ id: 'fixture-job', status: 'failed' }] }, { ...emailFixture, generated_at: 'invalid' },
]) { emailPayload = invalid; await assert.rejects(emailApi.fetchAdminEmailActivity(emailInput), /email_activity_unavailable/) }
const detailFixture = { success: true, job: { ...emailFixture.items[0], retry_allowed: true, retry_blocked_reason: null }, events: [{ id: 'fixture-event', email_job_id: 'fixture-job', event_type: 'email.failed' }], events_has_more: false, events_unavailable: false, generated_at: emailFixture.generated_at }
emailPayload = detailFixture
assert.equal((await emailApi.fetchAdminEmailJob('fixture-job', readinessController.signal)).job.id, 'fixture-job')
assert.equal(emailRequest.init.signal, readinessController.signal)
for (const invalid of [
  { ...detailFixture, job: { ...detailFixture.job, id: 'different-job' } },
  { ...detailFixture, events: [{ ...detailFixture.events[0], email_job_id: 'different-job' }] },
  { ...detailFixture, events_unavailable: true }, { ...detailFixture, job: { ...detailFixture.job, retry_blocked_reason: 'recipient_suppressed' } },
]) { emailPayload = invalid; await assert.rejects(emailApi.fetchAdminEmailJob('fixture-job'), /email_activity_unavailable/) }
const emailResultFunction = ts.createSourceFile('adapters.ts', adapters, ts.ScriptTarget.Latest, true).statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'emailProcessingResult')
const emailResultCode = ts.transpileModule(emailResultFunction.getText(), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const emailMutationStart = adapters.indexOf('async processEmailOutbox()')
const emailMutationCode = adapters.slice(emailMutationStart, adapters.indexOf('listCrashLogs(', emailMutationStart))
let emailMutationPayload = { success: true, job_id: 'fixture-job', processed: { processed: 1, sent: 1, skipped: 0 } }
const emailMutations = new Function('processEmailOutboxRequest', 'retryEmailJobRequest', 'sendAdminTestEmailRequest', emailResultCode + '; return ({' + emailMutationCode + '});')(...Array.from({ length: 3 }, () => async () => emailMutationPayload))
assert.equal((await emailMutations.retryEmailJob('fixture-job')).sent, 1)
assert.equal((await emailMutations.sendAdminTestEmail({ recipient: 'fixture@example.test' })).jobId, 'fixture-job')
emailMutationPayload = { success: true, processed: { skipped: true } }
assert.deepEqual(await emailMutations.processEmailOutbox(), { skipped: true })
for (const processed of [{ processed: 0, sent: 0, skipped: 1 }, { processed: 1, sent: 0, skipped: 0 }]) {
  emailMutationPayload = { success: true, job_id: 'fixture-job', processed }
  assert.deepEqual(await emailMutations.retryEmailJob('fixture-job'), processed)
  assert.deepEqual((await emailMutations.sendAdminTestEmail({ recipient: 'fixture@example.test' })).processing, processed)
}
await assert.rejects((async () => {
  emailMutationPayload = { success: true, processed: { processed: 0, sent: 0, skipped: 1 } }
  return emailMutations.processEmailOutbox()
})(), /email_action_unconfirmed/)
for (const invalid of [
  { success: false, job_id: 'fixture-job', processed: { processed: 1, sent: 1, skipped: 0 } },
  { success: true, job_id: 'other-job', processed: { processed: 1, sent: 1, skipped: 0 } },
  { success: true, job_id: 'fixture-job', processed: {} },
  { success: true, job_id: 'fixture-job', processed: { processed: 1, sent: 2, skipped: 0 } },
  { success: true, job_id: 'fixture-job', processed: { processed: 2, sent: 1, skipped: 0 } },
  { success: true, job_id: 'fixture-job', processed: { processed: 0, sent: 0, skipped: 0 } },
  { success: true, job_id: 'fixture-job', processed: { processed: 1, sent: 0, skipped: 1 } },
]) { emailMutationPayload = invalid; await assert.rejects(emailMutations.retryEmailJob('fixture-job'), /email_action_unconfirmed/) }
console.log('PASS Email reads validate view, page, filter and message identity; actions distinguish accepted, skipped and unconfirmed outcomes')

const promoReadFunction = apiSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'fetchAdminPromoDirectory')
const promoReadCode = ts.transpileModule(promoReadFunction.getText(apiSyntax).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const promoFixture = { success: true, query: 'PROMO', status: 'expired', page: 2, limit: 25, has_more: false, generated_at: '2026-11-11T12:00:00Z', items: [{ id: 'fixture-code', code: 'PROMO', discount_type: 'percent', discount_value: 10, is_active: true, effective_status: 'expired', updated_at: '2026-11-11T12:00:00.123456Z' }] }
let promoPayload = structuredClone(promoFixture)
let promoRequest
const readPromoDirectory = new Function('adminFetch', promoReadCode + '; return fetchAdminPromoDirectory;')(async (path, init) => { promoRequest = { path, init }; return promoPayload })
const promoInput = { query: ' PROMO ', status: 'expired', page: 2 }
assert.equal((await readPromoDirectory(promoInput, readinessController.signal)).items[0].code, 'PROMO')
assert.equal(promoRequest.init.signal, readinessController.signal)
assert.equal(new URL('https://fixture.invalid' + promoRequest.path).searchParams.get('view'), 'management')
for (const invalid of [
  { ...promoFixture, success: false }, { ...promoFixture, page: 1 }, { ...promoFixture, status: 'active' },
  { ...promoFixture, items: null }, { ...promoFixture, has_more: undefined }, { ...promoFixture, items: [promoFixture.items[0], promoFixture.items[0]] },
  { ...promoFixture, items: [null] }, { ...promoFixture, items: [{ ...promoFixture.items[0], discount_value: null }] },
  { ...promoFixture, items: [{ ...promoFixture.items[0], effective_status: 'unknown' }] },
  { ...promoFixture, items: [{ ...promoFixture.items[0], updated_at: 'invalid' }] },
]) { promoPayload = invalid; await assert.rejects(readPromoDirectory(promoInput), /promo_codes_unavailable/) }
const promoMutationsStart = adapters.indexOf('async createPromoCode(input)')
const promoMutationsCode = adapters.slice(promoMutationsStart, adapters.indexOf('async listReleases(', promoMutationsStart))
let promoMutationPayload = { success: true, item: promoFixture.items[0] }
let lastPromoStateArguments
const promoMutations = new Function('createPromoCode', 'updatePromoCodeState', 'return ({' + promoMutationsCode + '});')(
  async () => promoMutationPayload, async (...values) => { lastPromoStateArguments = values; return promoMutationPayload },
)
assert.equal((await promoMutations.createPromoCode({ code: 'PROMO' })).code, 'PROMO')
await promoMutations.updatePromoCodeState('fixture-code', true, 'Fixture reason', '2026-11-11T12:00:00.123456Z')
assert.equal(lastPromoStateArguments[3], '2026-11-11T12:00:00.123456Z')
for (const invalid of [
  { success: false, item: promoFixture.items[0] },
  { success: true, item: { ...promoFixture.items[0], id: 'other-code' } },
  { success: true, item: { ...promoFixture.items[0], is_active: false } },
  { success: true, item: { ...promoFixture.items[0], updated_at: undefined } },
]) { promoMutationPayload = invalid; await assert.rejects(promoMutations.updatePromoCodeState('fixture-code', true, 'Fixture reason', '2026-11-11T12:00:00.123456Z'), /promo_save_unconfirmed/) }
console.log('PASS Promotion reads verify lifecycle filter and page; writes preserve the exact reviewed timestamp and reject unconfirmed or mismatched changes')

const inviteFunctions = ['validInvite', 'fetchAdminInviteDirectory', 'fetchAdminInviteDetail', 'createAdminInvite', 'revokeAdminInvite']
const inviteApiCode = ts.transpileModule(apiSyntax.statements.filter((item) => ts.isFunctionDeclaration(item) && inviteFunctions.includes(item.name?.text)).map((item) => item.getText(apiSyntax).replace(/^export\s+/, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const inviteFixture = { id: 'fixture-invite', status: 'active', effective_status: 'active', created_at: '2026-11-11T12:00:00Z', updated_at: '2026-11-11T12:00:00Z', expires_at: null, max_uses: 3, used_count: 0 }
let invitePayload = { success: true, items: [inviteFixture], query: 'fixture', status: 'active', page: 2, limit: 25, has_more: false, generated_at: '2026-11-11T12:00:00Z' }
let inviteRequest
const inviteApi = new Function('adminFetch', inviteApiCode + '; return { fetchAdminInviteDirectory, fetchAdminInviteDetail, createAdminInvite, revokeAdminInvite };')(async (path, init) => { inviteRequest = { path, init }; return invitePayload })
const inviteInput = { query: 'fixture', status: 'active', page: 2 }
assert.equal((await inviteApi.fetchAdminInviteDirectory(inviteInput, readinessController.signal)).items[0].id, 'fixture-invite')
assert.equal(inviteRequest.init.signal, readinessController.signal)
for (const patch of [{ success: false }, { items: null }, { page: 1 }, { status: 'expired' }, { has_more: undefined }, { items: [null] }, { items: [{ ...inviteFixture, scope: { channels: 'beta' } }] }, { items: [{ ...inviteFixture, restrictions: { one_per_user: 'true' } }] }, { items: [{ ...inviteFixture, code_hash: 'must-not-appear' }] }, { items: [inviteFixture, inviteFixture] }]) {
  invitePayload = { success: true, items: [inviteFixture], query: 'fixture', status: 'active', page: 2, has_more: false, generated_at: '2026-11-11T12:00:00Z', ...patch }
  await assert.rejects(inviteApi.fetchAdminInviteDirectory(inviteInput), /invalid_invite_directory/)
}
invitePayload = { success: true, item: inviteFixture, items: [], page: 1, has_more: false }
assert.equal((await inviteApi.fetchAdminInviteDetail('fixture-invite')).item.id, 'fixture-invite')
invitePayload = { ...invitePayload, item: { ...inviteFixture, id: 'other-invite' } }
await assert.rejects(inviteApi.fetchAdminInviteDetail('fixture-invite'), /invalid_invite_detail/)
invitePayload = { success: true, item: inviteFixture, code: 'ABCDEFGHJKLMNPQRSTUV', shown_once: true, replay: false }
await inviteApi.createAdminInvite({ request_id: 'fixture-stable-request' })
assert.equal(inviteRequest.init.headers['Idempotency-Key'], 'fixture-stable-request')
for (const patch of [{ success: false }, { code: 'too-short' }, { code: null }, { replay: true }, { shown_once: false }]) {
  invitePayload = { success: true, item: inviteFixture, code: 'ABCDEFGHJKLMNPQRSTUV', shown_once: true, replay: false, ...patch }
  await assert.rejects(inviteApi.createAdminInvite({ request_id: 'fixture-stable-request' }), /invite_write_unconfirmed/)
}
invitePayload = { success: true, item: inviteFixture, code: null, shown_once: false, replay: true }
assert.equal((await inviteApi.createAdminInvite({ request_id: 'fixture-stable-request' })).code, null)
invitePayload = { success: true, invite_id: 'other-invite', status: 'revoked' }
await assert.rejects(inviteApi.revokeAdminInvite('fixture-invite', 'Fixture reason'), /invite_write_unconfirmed/)
console.log('PASS Invitation consumers reject mismatched pages, malformed or secret-bearing rows and unconfirmed writes; creation preserves the request identity and one-time-code replay state')
const inviteSyntax = ts.createSourceFile('AdminInvites.tsx', invitations, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const pendingNames = ['defaultInviteFields', 'emptyDraft', 'DRAFT_KEY', 'restorePending', 'rememberPending', 'clearPending']
const pendingCode = ts.transpileModule(inviteSyntax.statements.filter((node) => ts.isFunctionDeclaration(node) ? pendingNames.includes(node.name?.text) : ts.isVariableStatement(node) && node.declarationList.declarations.some((entry) => pendingNames.includes(entry.name.getText(inviteSyntax)))).map((node) => node.getText(inviteSyntax)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const sessionStorage = { getItem(key) { return this[key] ?? null }, setItem(key, value) { this[key] = value }, removeItem(key) { delete this[key] } }
const pendingDraft = new Function('sessionStorage', 'crypto', pendingCode + ';return { emptyDraft, restorePending, rememberPending, clearPending };')(sessionStorage, globalThis.crypto)
const restoredDraft = { ...pendingDraft.emptyDraft(), note: 'Synthetic pending invitation', emails: 'fixture@example.test' }
pendingDraft.rememberPending('first@example.test', restoredDraft)
assert.deepEqual(pendingDraft.restorePending('first@example.test'), restoredDraft)
assert.ok(!Object.values(sessionStorage).some((value) => typeof value === 'string' && value.includes('ABCDEFGHJKLMNPQRSTUV')))
assert.equal(pendingDraft.restorePending('second@example.test'), null)
assert.equal(pendingDraft.restorePending('first@example.test'), null)
pendingDraft.rememberPending('first@example.test', restoredDraft)
const pendingKey = Object.keys(sessionStorage).find((key) => key.startsWith('saturnws.admin.invite.pending.v1:'))
sessionStorage[pendingKey] = JSON.stringify({ version: 1, expires: 0, draft: restoredDraft })
assert.equal(pendingDraft.restorePending('first@example.test'), null)
pendingDraft.rememberPending('first@example.test', restoredDraft)
pendingDraft.clearPending('first@example.test')
assert.equal(pendingDraft.restorePending('first@example.test'), null)
console.log('PASS Pending invitation drafts restore the same request, isolate admin identities, expire and clear without retaining the one-time code')

const moneyExports = {}
const timestampExports = {}
new Function('exports', ts.transpileModule(read('src/lib/serviceTimestamp.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(timestampExports)
for (const raw of ['2026-11-12 12:34:56', '2026-11-12T12:34:56', '2026-11-12T12:34:56Z', '2026-11-12T14:34:56+02:00']) assert.equal(timestampExports.parseServiceTimestamp(raw).toISOString(), '2026-11-12T12:34:56.000Z')
assert.equal(timestampExports.parseServiceTimestamp('2026-11-12 12:34:56.123').toISOString(), '2026-11-12T12:34:56.123Z')
for (const raw of [null, undefined, '', 'bad', 1794480000, {}]) assert.equal(timestampExports.parseServiceTimestamp(raw), null)
for (const source of [productionPresentation, adminPageSupport, emailWorkspace, promotions, invitations, commerce, policyRecords]) assert.ok(source.includes('parseServiceTimestamp'), 'service display timestamps must use the shared UTC normalizer')
for (const source of [customerPages, adminSupport]) assert.match(source, /import \{[^}]*\bformatDisplayDate\b[^}]*\} from ['"]\.\/productionPresentation['"]/)
for (const source of [adminAccounts, adminData, adminDevice, adminDiagnostics, adminGovernance, adminOverview]) assert.match(source, /import \{[^}]*\bdate\b[^}]*\} from ['"]\.\/adminPageSupport['"]/)
assert.ok(promotions.includes('new Date(draft.expiry).toISOString()'), 'local form inputs must keep their explicit local-to-UTC conversion')
console.log('PASS Service display timestamps normalize D1/SQL UTC independently of the local timezone, preserve explicit offsets/fractions, reject invalid values, and do not change local form input semantics')
new Function('exports', ts.transpileModule(read('src/lib/money.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(moneyExports)
assert.equal(moneyExports.formatMoneyMinor(3500, 'USD', 'en'), '$35.00')
assert.equal(moneyExports.formatMoneyMinor(500, 'JPY', 'en'), '¥500')
assert.match(moneyExports.formatMoneyMinor(12345, 'BHD', 'en'), /12\.345/)
assert.equal(moneyExports.formatMoneyMinor(null, 'USD', 'en'), '')
assert.equal(moneyExports.formatMoneyMinor(1.5, 'USD', 'en'), '')
assert.equal(moneyExports.formatMoneyMinor(Number.MAX_SAFE_INTEGER + 1, 'USD', 'en'), '')
const commerceFunctions = ['validCommerceOrder', 'fetchAdminCommercePage', 'fetchAdminCommerceConfiguration', 'fetchAdminCommerceOrder']
const commerceApiCode = ts.transpileModule(apiSyntax.statements.filter((item) => ts.isFunctionDeclaration(item) && commerceFunctions.includes(item.name?.text)).map((item) => item.getText(apiSyntax).replace(/^export\s+/, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const commerceRow = { id: 'fixture-order', firebase_uid: 'fixture-user', plan_id: 'monthly', plan_version: 1, status: 'paid', amount_minor: 3500, currency: 'USD', created_at: '2026-11-11T12:00:00Z' }
const commerceFixture = { success: true, view: 'orders', items: [commerceRow], query: 'fixture', status: 'paid', page: 1, limit: 25, has_more: false, total: 1, generated_at: '2026-11-11T12:00:00Z' }
let commercePayload = structuredClone(commerceFixture); let commerceSignal
const commerceApi = new Function('adminFetch', commerceApiCode + ';return { fetchAdminCommercePage, fetchAdminCommerceConfiguration, fetchAdminCommerceOrder };')(async (_, init) => { commerceSignal = init.signal; return commercePayload })
const commerceInput = { view: 'orders', query: 'fixture', status: 'paid' }
assert.equal((await commerceApi.fetchAdminCommercePage(commerceInput, readinessController.signal)).total, 1)
assert.equal(commerceSignal, readinessController.signal)
for (const patch of [{ success: false }, { view: 'plans' }, { query: 'other' }, { page: 2 }, { total: 200 }, { total: null }, { has_more: true }, { items: [{ ...commerceRow, amount_minor: 1.2 }] }, { items: [{ ...commerceRow, metadata: {} }] }, { items: [null] }]) {
  commercePayload = { ...commerceFixture, ...patch }; await assert.rejects(commerceApi.fetchAdminCommercePage(commerceInput), /commerce_unavailable/)
}
commercePayload = { success: true, order: commerceRow, view: 'attempts', page: 1, limit: 25, has_more: false, total: null, unavailable: true, items: null, generated_at: commerceFixture.generated_at }
assert.equal((await commerceApi.fetchAdminCommerceOrder('fixture-order')).order.id, 'fixture-order')
commercePayload = { ...commercePayload, items: [] }
await assert.rejects(commerceApi.fetchAdminCommerceOrder('fixture-order'), /commerce_unavailable/)
commercePayload = { success: true, order: commerceRow, view: 'receipts', page: 1, limit: 25, has_more: false, total: 1, unavailable: false, items: [{ id: 'receipt', order_id: 'other-order' }], generated_at: commerceFixture.generated_at }
await assert.rejects(commerceApi.fetchAdminCommerceOrder('fixture-order', 'receipts'), /commerce_unavailable/)
commercePayload = { ...commercePayload, items: [{ id: 'receipt', order_id: 'fixture-order', document_url: 'private-url' }] }
await assert.rejects(commerceApi.fetchAdminCommerceOrder('fixture-order', 'receipts'), /commerce_unavailable/)
const providers = { stripe: { configured: true, implemented: false, available: false }, nowpayments: { configured: false, implemented: false, available: false } }
commercePayload = { success: true, providers, checkout_available: false, generated_at: commerceFixture.generated_at }
await commerceApi.fetchAdminCommerceConfiguration()
commercePayload = { ...commercePayload, checkout_available: true }
await assert.rejects(commerceApi.fetchAdminCommerceConfiguration(), /commerce_unavailable/)
console.log('PASS Commerce consumers require exact filtered counts, identity and safe projections; unavailable related records are distinct from empty; configured keys cannot enable checkout; money uses currency-specific minor units')

const policyFunctions = ['fetchAdminGlobalPolicy', 'updateAdminGlobalPolicy']
const policyApiCode = ts.transpileModule(apiSyntax.statements.filter((item) => ts.isFunctionDeclaration(item) && policyFunctions.includes(item.name?.text)).map((item) => item.getText(apiSyntax).replace(/^export\s+/, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let policyRequest; let policyPayload
const policyApi = new Function('adminFetch', policyApiCode + ';return { fetchAdminGlobalPolicy, updateAdminGlobalPolicy };')(async (path, init) => { policyRequest = { path, init }; return policyPayload })
const policyFixture = { kill_switch_enabled: 0, mandatory_update_enabled: 0, minimum_supported_version: '1.2.32', update_mode: 'optional', updated_at: '2026-11-12T12:00:00Z', revision: 'a'.repeat(64) }
policyPayload = { success: true, policy: policyFixture }
assert.deepEqual(await policyApi.fetchAdminGlobalPolicy(readinessController.signal), policyFixture); assert.equal(policyRequest.init.signal, readinessController.signal)
for (const patch of [{ policy: null }, { success: false }, { policy: { ...policyFixture, features_json: '{}' } }, { policy: { ...policyFixture, kill_switch_enabled: '0' } }, { policy: { ...policyFixture, updated_at: 'not-a-date' } }, { policy: { ...policyFixture, revision: '' } }, { policy: { ...policyFixture, update_mode: 'typo' } }]) { policyPayload = { success: true, policy: policyFixture, ...patch }; await assert.rejects(policyApi.fetchAdminGlobalPolicy(), /policy_state_unavailable/) }
const policyChange = { request_id: 'fixture-policy-request', expected_revision: policyFixture.revision, kill_switch_enabled: true, mandatory_update_enabled: false, minimum_supported_version: '', update_mode: 'optional', reason: 'Fixture review' }
policyPayload = { success: true, request_id: policyChange.request_id, revision: 'b'.repeat(64), replay: true }
await policyApi.updateAdminGlobalPolicy(policyChange); assert.equal(policyRequest.init.headers['Idempotency-Key'], policyChange.request_id); assert.deepEqual(JSON.parse(policyRequest.init.body), policyChange)
for (const patch of [{ success: false }, { request_id: 'other-request' }, { revision: 'wrong' }, { replay: undefined }]) { policyPayload = { success: true, request_id: policyChange.request_id, revision: 'b'.repeat(64), replay: false, ...patch }; await assert.rejects(policyApi.updateAdminGlobalPolicy(policyChange), /policy_write_unconfirmed/) }
console.log('PASS Global policy consumers validate the scoped projection and exact write confirmation while preserving the reviewed revision and retry identity')

const recordFunctions = ['validDisabledVersion', 'validPolicyRules', 'fetchAdminPolicyDirectory', 'fetchAdminPolicyVersion', 'fetchAdminPolicyPlan', 'updateAdminDisabledVersion']
const recordApiCode = ts.transpileModule(apiSyntax.statements.filter((item) => ts.isFunctionDeclaration(item) && recordFunctions.includes(item.name?.text)).map((item) => item.getText(apiSyntax).replace(/^export\s+/, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let recordPayload; let recordRequest
const recordApi = new Function('adminFetch', recordApiCode + '; return { fetchAdminPolicyDirectory, fetchAdminPolicyVersion, fetchAdminPolicyPlan, updateAdminDisabledVersion };')(async (path, init) => { recordRequest = { path, init }; return recordPayload })
const versionRow = { version: '1.2.33', reason: 'Fixture reason', created_at: '2026-11-12T12:00:00Z' }
const recordFixture = { success: true, view: 'versions', query: '1.2', page: 2, limit: 25, has_more: false, items: [versionRow] }
recordPayload = structuredClone(recordFixture)
assert.equal((await recordApi.fetchAdminPolicyDirectory({ view: 'versions', query: '1.2', page: 2 }, readinessController.signal)).items[0].version, '1.2.33'); assert.equal(recordRequest.init.signal, readinessController.signal)
for (const patch of [{ success: false }, { view: 'plans' }, { query: 'other' }, { page: 1 }, { has_more: true }, { items: [null] }, { items: [versionRow, versionRow] }, { items: [{ ...versionRow, created_at: 'invalid' }] }]) { recordPayload = { ...recordFixture, ...patch }; await assert.rejects(recordApi.fetchAdminPolicyDirectory({ view: 'versions', query: '1.2', page: 2 }), /policy_records_unavailable/) }
recordPayload = { ...recordFixture, view: 'plans', query: '', page: 1, items: [{ plan_id: 'fixture', updated_at: versionRow.created_at, valid: false, features_count: null, limits_count: null, blocked_actions_count: null }] }
await recordApi.fetchAdminPolicyDirectory({ view: 'plans' }); recordPayload.items[0].features_count = 0; await assert.rejects(recordApi.fetchAdminPolicyDirectory({ view: 'plans' }), /policy_records_unavailable/)
recordPayload = { success: true, version: '1.2.33', disabled: false, item: null, revision: 'a'.repeat(64) }
await recordApi.fetchAdminPolicyVersion('1.2.33'); recordPayload.item = versionRow; await assert.rejects(recordApi.fetchAdminPolicyVersion('1.2.33'), /policy_records_unavailable/)
const savedRules = { valid: true, features: { fixture: { nested: [false, 3, null] } }, limits: {}, blocked_actions: ['fixture_action'] }
recordPayload = { success: true, plan_id: 'fixture', updated_at: versionRow.created_at, rules: savedRules, global_rules: null }
assert.equal((await recordApi.fetchAdminPolicyPlan('fixture')).global_rules, null)
recordPayload = { ...recordPayload, rules: { valid: false, features: null, limits: null, blocked_actions: null } }; await recordApi.fetchAdminPolicyPlan('fixture')
recordPayload.rules.features = {}; await assert.rejects(recordApi.fetchAdminPolicyPlan('fixture'), /policy_records_unavailable/)
const versionChange = { version: '1.2.33', disabled: false, reason: 'Fixture review', expected_revision: 'a'.repeat(64), request_id: 'fixture-version-operation' }
recordPayload = { success: true, version: '1.2.33', disabled: false, request_id: versionChange.request_id, revision: 'b'.repeat(64), replay: true }
await recordApi.updateAdminDisabledVersion(versionChange); assert.equal(recordRequest.init.headers['Idempotency-Key'], versionChange.request_id); assert.deepEqual(JSON.parse(recordRequest.init.body), versionChange)
recordPayload.disabled = true; await assert.rejects(recordApi.updateAdminDisabledVersion(versionChange), /policy_write_unconfirmed/)
console.log('PASS Policy record consumers verify paging/filter/identity, distinguish invalid rules from empty, retain readable plan data without global rules, and confirm the exact reviewed version operation')

const sessionFunction = apiSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'fetchAdminSession')
const sessionCode = ts.transpileModule(sessionFunction.getText(apiSyntax).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let sessionPayload = { success: true, email: 'fixture-admin@example.test', role: 'read_only', permissions: ['admin:read', 'users:read'] }
const readSession = new Function('adminFetch', sessionCode + '; return fetchAdminSession;')(async () => sessionPayload)
assert.equal((await readSession()).role, 'read_only')
const sessionFixture = structuredClone(sessionPayload)
for (const patch of [{ success: false }, { email: '' }, { role: 'invented_role' }, { permissions: null }, { permissions: ['admin:read', 'admin:read'] }, { permissions: [null] }, { permissions: ['not a permission'] }]) { sessionPayload = { ...sessionFixture, ...patch }; await assert.rejects(readSession(), /admin_session_unavailable/) }
sessionPayload = { ...sessionFixture, role: 'super_admin', permissions: ['*'] }; assert.deepEqual((await readSession()).permissions, ['*'])
console.log('PASS Admin session consumers reject malformed identities, roles, and permission lists before rendering account capabilities')

const httpRuntime = {}
new Function('exports', ts.transpileModule(read('src/api/http.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(httpRuntime)
const accessRuntime = {}
new Function('exports', 'require', ts.transpileModule(read('src/new-ui/pages/production/adminAccessState.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(accessRuntime, () => httpRuntime)
for (const [code, status, expected] of [
  ['unauthorized', 401, 'signin'], ['firebase_token_invalid', 401, 'signin'], ['preauth_required', 401, 'preauth'],
  ['admin_identity_unavailable', 503, 'unavailable'], ['admin_allowlist_empty', 401, 'unavailable'], ['firebase_not_configured', 401, 'unavailable'],
  ['admin_email_not_allowed:fixture@example.test', 401, 'denied'], ['firebase_email_not_verified', 401, 'denied'], ['admin_permission_denied', 403, 'denied'], ['origin_not_allowed', 403, 'denied'], ['arbitrary-upstream-detail', 502, 'unavailable'],
]) assert.equal(accessRuntime.adminAccessFailure(new httpRuntime.ApiError(code, status)).status, expected, code)
assert.equal(accessRuntime.adminAccessFailure(new TypeError('Failed to fetch')).status, 'unavailable')
const accessSignal = new AbortController().signal
let receivedSignals = []; let preauthReady = true; let failedPreauth = false; let sessionError = null
const accessAdapter = {
  getPreauthState: async (signal) => { receivedSignals.push(signal); if (failedPreauth) throw new Error('fixture'); return { authenticated: preauthReady } },
  getSession: async (signal) => { receivedSignals.push(signal); if (sessionError) throw sessionError; return sessionFixture },
}
assert.equal((await accessRuntime.readAdminAccess(accessAdapter, accessSignal)).status, 'ready')
assert.deepEqual(receivedSignals, [accessSignal, accessSignal])
receivedSignals = []; failedPreauth = true; assert.equal((await accessRuntime.readAdminAccess(accessAdapter, accessSignal)).status, 'unavailable'); assert.equal(receivedSignals.length, 1)
receivedSignals = []; failedPreauth = false; preauthReady = false; sessionError = new Error('fixture'); assert.equal((await accessRuntime.readAdminAccess(accessAdapter, accessSignal)).status, 'preauth'); assert.equal(receivedSignals.length, 1)
preauthReady = true; assert.equal((await accessRuntime.readAdminAccess(accessAdapter, accessSignal)).status, 'unavailable')
sessionError = new httpRuntime.ApiError('unauthorized', 401); assert.equal((await accessRuntime.readAdminAccess(accessAdapter, accessSignal)).status, 'signin')
const cancelledAccess = new AbortController(); cancelledAccess.abort(); await assert.rejects(accessRuntime.readAdminAccess(accessAdapter, cancelledAccess.signal), { name: 'AbortError' })
for (const name of ['fetchAdminPreauthState', 'submitAdminPreauth']) {
  const declaration = apiSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name)
  const code = ts.transpileModule(declaration.getText(apiSyntax).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let data = null; let forwardedSignal
  const fn = new Function('adminFetch', code + `; return ${name};`)(async (_path, init) => { forwardedSignal = init.signal; return data })
  for (data of [null, {}, { success: false, authenticated: true }, { success: true, authenticated: 'false' }]) await assert.rejects(name === 'submitAdminPreauth' ? fn({ username: 'fixture', password: 'fixture' }, accessSignal) : fn(accessSignal), /admin_preauth_unavailable/)
  for (data of [{ success: true, authenticated: true }, { success: true, authenticated: false }]) assert.deepEqual(await (name === 'submitAdminPreauth' ? fn({ username: 'fixture', password: 'fixture' }, accessSignal) : fn(accessSignal)), data)
  assert.equal(forwardedSignal, accessSignal)
}
assert.equal(accessRuntime.adminLoginIssue(new httpRuntime.ApiError('invalid_credentials', 401)), 'credentials')
assert.equal(accessRuntime.adminLoginIssue(new httpRuntime.ApiError('rate_limited', 429)), 'rate')
assert.equal(accessRuntime.adminLoginIssue(new Error('auth/popup-blocked')), 'popup')
assert.equal(accessRuntime.adminLoginIssue(new Error('auth/popup-closed-by-user')), 'cancelled')
assert.equal(accessRuntime.adminLoginIssue(new Error('private-upstream-details')), 'connection')
console.log('PASS Admin access distinguishes service/configuration failure, missing credentials, denied permission and origin; strict preauth reads and writes forward cancellation and never coerce invalid data into sign-in')

const tokenDeclaration = apiSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'getAdminToken')
const tokenCode = ts.transpileModule(tokenDeclaration.getText(apiSyntax), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let tokenMode = 'ok'; let tokenSequence = 0; let finishToken; const refreshFlags = []
const tokenUser = { uid: 'fixture-admin', getIdToken: async (force) => {
  refreshFlags.push(force)
  if (tokenMode === 'pending') return new Promise((resolve) => { finishToken = resolve })
  if (tokenMode !== 'ok') throw { code: tokenMode }
  return `fixture-only-fresh-token-${++tokenSequence}`
} }
const tokenAuth = { currentUser: tokenUser, authStateReady: async () => {} }
const readToken = new Function('firebaseAuth', 'firebaseAuthPersistenceReady', 'ApiError', tokenCode + ';return getAdminToken;')(tokenAuth, Promise.resolve(true), httpRuntime.ApiError)
assert.equal(await readToken(), 'fixture-only-fresh-token-1'); assert.equal(await readToken(), 'fixture-only-fresh-token-2'); assert.deepEqual(refreshFlags, [false, false])
for (tokenMode of ['auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled']) await assert.rejects(readToken(), (error) => error.status === 401 && error.message === 'firebase_token_invalid')
tokenMode = 'auth/network-request-failed'; await assert.rejects(readToken(), (error) => error.status === 503 && error.message === 'admin_identity_unavailable')
tokenAuth.currentUser = null; assert.equal(await readToken(), '')
tokenAuth.currentUser = tokenUser; tokenMode = 'pending'
let tokenStarted = readToken(); await new Promise((resolve) => setImmediate(resolve)); tokenAuth.currentUser = { ...tokenUser, uid: 'another-fixture-admin' }; finishToken('fixture-previous-identity')
await assert.rejects(tokenStarted, (error) => error.status === 401)
tokenAuth.currentUser = tokenUser
const abortToken = new AbortController(); tokenStarted = readToken(abortToken.signal); await new Promise((resolve) => setImmediate(resolve)); abortToken.abort(); await assert.rejects(tokenStarted, { name: 'AbortError' }); finishToken('fixture-late-token')
const alreadyAborted = new AbortController(); alreadyAborted.abort(); const beforeTokenCalls = refreshFlags.length
await assert.rejects(readToken(alreadyAborted.signal), { name: 'AbortError' }); assert.equal(refreshFlags.length, beforeTokenCalls)
assert.ok(!api.includes('inMemoryBearerToken') && !api.includes('setAdminBearerToken') && !api.includes('sessionStorage.getItem(ADMIN_FIREBASE_TOKEN_KEY)'))
const adapterSyntax = ts.createSourceFile('productionAdapters.ts', adapters, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const adapterRoot = adapterSyntax.statements.find((item) => ts.isVariableStatement(item) && item.declarationList.declarations[0].name.getText(adapterSyntax) === 'productionAdapters').declarationList.declarations[0].initializer
const adminAdapterObject = adapterRoot.properties.find((item) => item.name?.getText(adapterSyntax) === 'admin').initializer
const receiptMethods = {
  executeManualGrant: 'executeManualSubscriptionGrant',
  cancelPendingSubscriptionGrant: 'cancelPendingSubscriptionGrantRequest',
  executeDeviceChange: 'executeAdminDeviceChange',
  executeDeviceReset: 'executeAdminDeviceReset',
  executeAccountLifecycle: 'executeAccountLifecycleRequest',
  executeAccessRevocation: 'executeAccessRevocationRequest',
  executeSubscriptionTransition: 'executeSubscriptionTransitionRequest',
  updateCrashGroupState: 'updateCrashGroupStateRequest',
  resolveTamperAlert: 'resolveTamperAlertRequest',
}
const receiptHelper = adapterSyntax.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'confirmedOperation')
const receiptMethodsCode = ts.transpileModule(receiptHelper.getText(adapterSyntax) + '\nconst methods = {' +
  adminAdapterObject.properties.filter((node) => Object.hasOwn(receiptMethods, node.name?.getText(adapterSyntax))).map((node) => node.getText(adapterSyntax)).join(',') +
  '};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let receipt
const receiptAdapter = new Function(...Object.values(receiptMethods), receiptMethodsCode + ';return methods;')(
  ...Object.values(receiptMethods).map(() => async () => receipt),
)
const fixtureRequest = 'fixture-operation'
const fixtureEmail = 'fixture@example.test'
const fixtureOperation = (fields) => ({ request_id: fixtureRequest, ...fields })
const acceptedReceipts = [
  ['executeManualGrant', [{ target_email: fixtureEmail }], { request_id: fixtureRequest, item: { id: 'fixture-subscription', user_email: fixtureEmail } }, { item: { id: 'wrong', user_email: 'other@example.test' } }],
  ['executeManualGrant', [{ target_email: fixtureEmail }], { request_id: fixtureRequest, item: null, pending_grant: { id: 'fixture-pending', normalized_email: fixtureEmail } }, { pending_grant: null }],
  ['executeManualGrant', [{ target_firebase_uid: 'fixture-account', target_email: fixtureEmail }], { request_id: fixtureRequest, item: { id: 'fixture-subscription', firebase_user_id: 'fixture-account' } }, { item: { id: 'fixture-subscription', firebase_user_id: 'wrong', user_email: fixtureEmail } }],
  ['cancelPendingSubscriptionGrant', ['fixture-pending', 'reason'], { item: { id: 'fixture-pending', status: 'cancelled' } }, { item: { id: 'fixture-pending', status: 'pending' } }],
  ['executeDeviceChange', ['fixture-device', { action: 'reject' }], { result: { item: { id: 'fixture-device', status: 'rejected' }, idempotent: false } }, { result: { item: { id: 'wrong', status: 'rejected' }, idempotent: false } }],
  ['executeDeviceReset', ['fixture-account', {}], { result: { reset: true, idempotent: false } }, { result: { reset: true, idempotent: 'false' } }],
  ['executeAccountLifecycle', ['fixture-account', { request_id: fixtureRequest, action: 'suspend' }], { result: fixtureOperation({ account: { firebase_uid: 'fixture-account', account_status: 'suspended' } }) }, { result: fixtureOperation({ account: { firebase_uid: 'fixture-account', account_status: 'active' } }) }],
  ['executeAccessRevocation', ['fixture-account', { request_id: fixtureRequest, scope: 'all' }], { result: fixtureOperation({ scope: 'all', sessions_revoked: 0, device_requests_revoked: 1 }) }, { result: fixtureOperation({ scope: 'all', sessions_revoked: -1, device_requests_revoked: 1 }) }],
  ['executeSubscriptionTransition', ['fixture-subscription', { request_id: fixtureRequest }], { result: fixtureOperation({ subscription: { id: 'fixture-subscription' } }) }, { result: { request_id: 'wrong', subscription: { id: 'fixture-subscription' } } }],
  ['updateCrashGroupState', ['fixture-group', { status: 'resolved', assignee: ' fixture ', note: ' reason ' }], { item: { fingerprint: 'fixture-group', status: 'resolved', assignee: 'fixture', note: 'reason' } }, { item: { fingerprint: 'fixture-group', status: 'resolved', assignee: 'fixture', note: 'wrong' } }],
  ['resolveTamperAlert', ['fixture-alert', 'reason'], { item: { id: 'fixture-alert', resolved: true } }, { item: { id: 'fixture-alert', resolved: false } }],
]
for (const [name, args, valid, mismatch] of acceptedReceipts) {
  receipt = { success: true, ...valid }
  assert.ok(await receiptAdapter[name](...args), name)
  for (const failure of [null, { success: true }, { success: false, ...valid }, { ...receipt, ...mismatch }]) {
    receipt = failure
    await assert.rejects(receiptAdapter[name](...args), /admin_operation_unconfirmed/, name)
  }
}
console.log('PASS Admin write receipts: reject missing or mismatched confirmations and accept only the requested record, status or operation')
const observerDeclaration = adminAdapterObject.properties.find((item) => item.name?.getText(adapterSyntax) === 'onIdentityChanged')
let publishIdentity; let unsubscribed = false; let identityChanges = 0
const observerCode = ts.transpileModule('function ' + observerDeclaration.getText(adapterSyntax), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const subscribeIdentity = new Function('onAuthStateChanged', 'firebaseAuth', observerCode + ';return onIdentityChanged;')((_auth, callback) => { publishIdentity = callback; return () => { unsubscribed = true } }, tokenAuth)
const stopIdentity = subscribeIdentity(() => { identityChanges += 1 })
publishIdentity({ uid: 'fixture-one' }); publishIdentity({ uid: 'fixture-one' }); assert.equal(identityChanges, 0)
publishIdentity(null); assert.equal(identityChanges, 1); publishIdentity({ uid: 'fixture-two' }); assert.equal(identityChanges, 2); stopIdentity(); assert.equal(unsubscribed, true)
const chromeSyntax = ts.createSourceFile('SharedChrome.tsx', read('src/new-ui/layouts/SharedChrome.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const chromeCode = ts.transpileModule(chromeSyntax.statements.filter((item) => ts.isFunctionDeclaration(item) && ['Topbar', 'TopbarAccount', 'PortalTopbarAccount'].includes(item.name?.text)).map((item) => item.getText(chromeSyntax).replace(/^export\s+/, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
let customerIdentityReads = 0
const chromeElement = ({ children, trigger }) => React.createElement('span', null, trigger, children)
const chromeIcon = () => React.createElement('svg')
const renderTopbar = new Function('React', 'useRef', 'useState', 'useAdminExitAction', 'useExperience', 'useAdapters', 'useAuthState', 'IconButton', 'LocaleControl', 'ThemeControl', 'Dropdown', 'DropdownItem', 'Menu', 'Search', 'Bell', 'HelpCircle', 'ChevronDown', 'LayoutDashboard', 'LogOut', chromeCode + ';return Topbar;')(React, React.useRef, React.useState, () => (run) => run(), () => ({ t: (key) => key }), () => ({ auth: { signOut: async () => {} } }), () => { customerIdentityReads += 1; return { user: { email: 'fixture-customer@example.test', displayName: 'Fixture Customer' } } }, chromeElement, chromeIcon, chromeIcon, chromeElement, chromeElement, chromeIcon, chromeIcon, chromeIcon, chromeIcon, chromeIcon, chromeIcon, chromeIcon)
let chromeHtml = renderToStaticMarkup(React.createElement(renderTopbar, { title: 'Fixture', admin: true, adminEmail: 'fixture-admin@example.test', navigate: () => {} }))
assert.equal(customerIdentityReads, 0); assert.ok(chromeHtml.includes('fixture-admin@example.test')); assert.ok(!chromeHtml.includes('Fixture Customer'))
chromeHtml = renderToStaticMarkup(React.createElement(renderTopbar, { title: 'Fixture', navigate: () => {} }))
assert.equal(customerIdentityReads, 1); assert.ok(chromeHtml.includes('fixture-customer@example.test')); assert.ok(chromeHtml.includes('Fixture Customer'))
let identityHttpCalls = 0
const adminHttpCode = ts.transpileModule(apiSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'adminFetch').getText(apiSyntax), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const identityHttp = new Function('getAdminToken', 'fetch', 'ApiError', 'adminBaseUrl', 'compactAdminError', adminHttpCode + ';return adminFetch;')(readToken, async (_url, init) => { identityHttpCalls += 1; assert.ok(init.headers.get('Authorization').startsWith('Bearer fixture-only-fresh-token-')); return Response.json({ success: true }) }, httpRuntime.ApiError, () => 'https://fixture.example.invalid', (message) => message)
const noLateWrite = new AbortController(); const pendingWrite = identityHttp('/fixture-write', { method: 'POST', body: '{}', signal: noLateWrite.signal }); await new Promise((resolve) => setImmediate(resolve)); noLateWrite.abort(); await assert.rejects(pendingWrite, { name: 'AbortError' }); finishToken('fixture-never-send'); assert.equal(identityHttpCalls, 0)
tokenMode = 'ok'; await identityHttp('/fixture-read'); assert.equal(identityHttpCalls, 1)
let tokenCallSites = 0
function checkTokenCalls(node) {
  if (ts.isCallExpression(node) && node.expression.getText(apiSyntax) === 'getAdminToken') { tokenCallSites += 1; assert.ok(ts.isAwaitExpression(node.parent), 'Every admin transport must await the renewed token') }
  ts.forEachChild(node, checkTokenCalls)
}
checkTokenCalls(apiSyntax); assert.ok(tokenCallSites >= 2)
const attachmentCode = ts.transpileModule(apiSyntax.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'downloadAdminSupportAttachment').getText(apiSyntax).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
let attachmentClicks = 0; let attachmentRevokes = 0; let attachmentReads = 0
const downloadAttachment = new Function('getAdminToken', 'fetch', 'adminBaseUrl', 'ApiError', 'URL', 'document', 'window', attachmentCode + ';return downloadAdminSupportAttachment;')(readToken, async (url, init) => { attachmentReads += 1; assert.ok(url.endsWith('/policy/support/attachments/fixture%2Fattachment')); assert.ok(init.headers.get('Authorization').startsWith('Bearer fixture-only-fresh-token-')); return new Response('fixture-only-attachment') }, () => 'https://fixture.example.invalid', httpRuntime.ApiError, { createObjectURL: () => 'blob:fixture-only', revokeObjectURL: () => { attachmentRevokes += 1 } }, { createElement: () => ({ click() { attachmentClicks += 1 }, remove() {} }), body: { appendChild() {} } }, { setTimeout(callback) { callback() } })
await downloadAttachment({ id: 'fixture/attachment', filename: 'fixture.txt' }); assert.equal(attachmentClicks, 1); assert.equal(attachmentReads, 1); assert.equal(attachmentRevokes, 1)
console.log('PASS Admin tokens use the restored Firebase identity and SDK renewal without forced refresh or copied-token fallback; token errors stay distinct, cancellation prevents a late HTTP write, identity changes recheck access, and admin chrome does not bootstrap a customer account')

function rendersRawJson(source) {
  const ast = ts.createSourceFile('admin-review.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let rendersJson = false
  const inspectValue = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'JSON.stringify') rendersJson = true
    ts.forEachChild(node, inspectValue)
  }
  const visit = (node) => {
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent) && !ts.isJsxSpreadAttribute(node.parent)) inspectValue(node.expression)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return rendersJson
}
assert.equal(rendersRawJson('const view = <pre>{JSON.stringify(record)}</pre>'), true)
assert.equal(rendersRawJson('const view = <>{ready ? JSON.stringify(record) : null}</>'), true)
assert.equal(rendersRawJson('const view = <>{ready ? <Panel key={JSON.stringify([id, revision])} /> : null}</>'), false)
assert.equal(rendersRawJson('const view = <Button onClick={() => copy(JSON.stringify(record))}>Copy</Button>'), false)
const checks = [
  ['Admin settings reuse the authenticated session and existing preference controls without duplicate reads or role-editing controls', pages.includes('<AdminSettings session={session}') && adminSettings.includes('<LocaleControl />') && adminSettings.includes('<ThemeControl />') && adminSettings.includes('hasAdminPermission(session.permissions') && !adminSettings.includes('getSession(') && !adminSettings.includes('useAdapters') && !adminSettings.includes('setPermissions')],
  ['Global policy keeps drafts during refresh and tab navigation, reviews changed values, and reuses uncertain writes without resetting hidden policy fields', globalPolicy.includes('expected_revision: base.revision') && globalPolicy.includes('admin.updateGlobalPolicy(review)') && globalPolicy.includes('base.revision !== policy.revision') && globalPolicy.includes('aria-invalid={!versionValid}') && globalPolicy.includes('admin.getGlobalPolicy(signal)') && !globalPolicy.includes('getPolicyState') && adminGovernance.includes("hidden={tab !== 'global'}") && !adminGovernance.includes('getPolicyState')],
  ['Policy records use scoped paging and readable inline plan rules; version changes review current state and preserve the exact retry identity', policyRecords.includes('admin.getPolicyDirectory(') && policyRecords.includes('admin.getPolicyPlan(') && policyRecords.includes('admin.getPolicyVersion(') && policyRecords.includes('admin.updateDisabledVersion(operation)') && policyRecords.includes('expected_revision: next.revision') && policyRecords.includes('global_rules') && !adminGovernance.includes('safeJsonCount')],
  ['Commerce uses paged read-only records and inline order history, without capped-array metrics or unrelated download data', pages.includes('<AdminCommerce routeState=') && commerce.includes('admin.getCommercePage(') && commerce.includes('admin.getCommerceOrder(') && commerce.includes('resource.data.total') && !commerce.includes('getCommerceOverview') && !commerce.includes('StatCard') && !commerce.includes('download_access_logs') && !commerce.includes('<Drawer')],
  ['Invitations use paged search and inline validation history independently of the policy state, preserving uncertain requests without persisting plaintext codes', adminGovernance.includes("tab === 'invites' ? <AdminInvites") && invitations.includes('admin.listInviteDirectory(') && invitations.includes('admin.getInviteDetail(') && invitations.includes('request_id: draft.requestId') && invitations.includes('rememberPending(owner, draft)') && !invitations.includes('sessionStorage.setItem(DRAFT_KEY + owner, JSON.stringify({ code') && !adminGovernance.includes('InviteCreateDrawer')],
  ['Email activity uses server pagination, inline message details, separate tools, and role-scoped actions', pages.includes('<AdminEmailWorkspace canManage=') && emailWorkspace.includes('admin.listEmailActivity(') && emailWorkspace.includes('email-workspace__list') && emailWorkspace.includes('admin.getEmailJob(') && emailWorkspace.includes('resource.data?.job.retry_allowed') && emailWorkspace.includes('<EmailConfiguration section=') && !emailWorkspace.includes('<Drawer') && !emailWorkspace.includes('data.jobs.length')],
  ['Checkboxes share the Workspace shape across tables and forms without hiding native controls', checkboxStyles.includes('--checkbox-radius: 6px') && checkboxStyles.includes('--checkbox-size: 16px') && [':checked', ':indeterminate', ':focus-visible', ':disabled', 'forced-colors: active'].every((state) => checkboxStyles.includes(state)) && !componentStyles.includes('.ui-check input, .ui-radio input') && !formControls.includes('ui-check__box') && read('src/new-ui/production-main.tsx').includes("import './foundation/checkbox.css'") && read('src/new-ui/main.tsx').includes("import './foundation/checkbox.css'")],
  ['Support keeps the ticket queue and drafts while loading ticket history on demand', adminSupport.includes('support-inbox__list') && adminSupport.includes('useState<Record<string, SupportDraft>>({})') && !adminSupport.includes('<Drawer') && adminSupport.includes('draft.statusAttempt') && adminSupport.includes('historyOpen ? <SupportTicketHistory') && adminSupport.includes('getSupportHistory(threadId, cursor')],
  ['Promotion codes use lifecycle-filtered server paging, exact record versions and an existing create form without an extra review step', pages.includes('<AdminPromotions canManage=') && promotions.includes('admin.listPromoDirectory(') && promotions.includes('row.updated_at') && promotions.includes('onLookup') && promotions.includes('form="promo-create-form"') && !promotions.includes('setPreview') && !promotions.includes('maskCode')],
  ['Admin user page is routed and requires read access', pages.includes("page === 'users' ? <AdminUsers") && pages.includes('!canOpenAdminSection(permissions, page)')],
  ['Device requests have a distinct route and use the session permission for decisions', pages.includes("page === 'device-requests'") && pages.includes("canDecide={permitted('users:write')}")],
  ['Admin subscription page is routed and separates read and write access', pages.includes("page === 'subscriptions' ? <AdminSubscriptions") && pages.includes("canManage={permitted('subscriptions:write')}") && pages.includes('!canOpenAdminSection(permissions, page)')],
  ['Sidebar and direct routes use the same section access check', pages.includes('canOpenAdminSection(permissions, item.id)') && pages.includes('!canOpenAdminSection(permissions, page)')],
  ['Section finder follows visible navigation and exposes its active keyboard result', pages.includes('groups={visibleGroups}') && adminSectionFinder.includes('aria-activedescendant={activeOptionId}') && adminSectionFinder.includes('role="listbox"') && adminSectionFinder.includes('role="option"') && adminSectionFinder.includes('page: activeId')],
  ['Publishing, support, mail, promotions, and policy mutations use the session permissions', ['releases:write', 'support:write', 'communications:write', 'promotions:write', 'policies:write'].every((permission) => pages.includes(`canManage={permitted('${permission}')}`))],
  ['Readiness route is real', pages.includes("page === 'readiness' ? <AdminReadiness")],
  ['Readiness separates live reads from configuration and preserves stale results with a warning', adminGovernance.includes('readiness-sections') && adminGovernance.includes('readinessCheckContent') && adminGovernance.includes('resource.data!.checks.filter') && adminGovernance.includes('Previous results are shown.') && adminGovernance.includes('admin.getReadiness(signal)')],
  ['Settings route is real', pages.includes("page === 'settings' ? <AdminSettings")],
  ['Policy route uses the structured admin page', pages.includes("page === 'policies' ? <AdminPolicies")],
  ['Manual grant uses a user picker', manualGrant.includes('Search by name or email')],
  ['Manual grant does not expose Firebase UID input', !manualGrant.includes('Firebase UID')],
  ['Manual grant executes only the reviewed values without inventing a reason note', manualGrant.includes('setReviewed({ input, preview: result })') && manualGrant.includes('...reviewed.input') && manualGrant.includes('reason: reviewed.input.reason_note || ""') && !manualGrant.includes('reason: note || reasonCode')],
  ['Manual grant waits for the current lookup and distinguishes lookup failure from an unregistered account', manualGrant.includes('const lookupPending = debouncedSearch !== searchKey || users.loading || users.refreshing') && manualGrant.includes('lookupReady ? typedEmail : ""') && manualGrant.includes('!selected && !exactUser && lookupReady') && manualGrant.includes('useAsyncData(') && manualGrant.includes('onClick={users.reload}') && manualGrant.includes('exactEmail: validEmail(debouncedSearch), limit: 8 }, signal)')],
  ['Recovery is not a normal grant action', !manualGrant.includes('restore_remaining_time')],
  ['Recovery requires ledger evidence and executes the reviewed input even after the account refreshes', recovery.includes('recovery_evidence_id') && userDetail.includes('recovery_evidence') && recovery.includes('setReviewed({ input, preview: result })') && recovery.includes('...reviewed.input') && recovery.includes('reason: reviewed.input.reason_note')],
  ['User detail exposes safe session revocation', userDetail.includes('scope: "session"') && userDetail.includes('scope: "all"') && !userDetail.includes('row.hwid')],
  ['User detail applies the server permissions to account, access, and recovery actions', pages.includes("canManageAccounts={permitted('users:write')}") && pages.includes("canEndAccess={permitted('sessions:revoke')}") && pages.includes("canManageSubscriptions={permitted('subscriptions:write')}") && userDetail.includes('canManageAccounts && lifecycleAction') && userDetail.includes('canManageSubscriptions && data.recovery_evidence')],
  ['Device unlink uses the shared review flow and rejects a different binding from the one opened', !adminAccounts.includes('function DeviceResetDialog') && adminAccounts.includes('result.binding?.id !== intent.bindingId') && adminAccounts.includes('kind: "device-unlink"') && userDetail.includes('canEndAccess && data.device_binding')],
  ['User detail includes support and access requests', userDetail.includes('support_threads') && userDetail.includes('login_requests')],
  ['Crash group state is operational', diagnostics.includes('updateCrashGroupState') && diagnostics.includes('CrashGroupStateDialog')],
  ['Diagnostics uses manual refresh only', !diagnostics.includes('10000')],
  ['Diagnostics keeps its result queue mounted while a report is inspected', diagnostics.includes('diagnostic-workbench__queue') && diagnostics.includes('presentation="inspector"') && diagnostics.includes('replace: Boolean(reportId)') && adminResponsive.includes('.diagnostic-workbench.is-inspecting .diagnostic-workbench__queue')],
  ['Diagnostics drafts do not replace the applied result and export scope', diagnostics.includes('<DiagnosticFiltersToolbar applied={filters}') && diagnostics.includes('setFilterVersion((value) => value + 1)') && diagnosticFiltersToolbar.includes('onSubmit={apply}') && diagnosticFiltersToolbar.includes('onApply({ search: nextSearch || undefined, user: nextUser || undefined, attribution })') && diagnosticFiltersToolbar.includes('Clear filters')],
  ['Diagnostics only loads groups and tamper alerts on their own tabs', diagnostics.includes('{tab === "groups" ? (') && diagnostics.includes('<DiagnosticTriagePanel') && /tab === "tamper" \? \(\s*<TamperAlertsPanel/.test(diagnostics)],
  ['Account diagnostics are opened on demand, scoped to the account and restricted by role', adminAccounts.includes('lazy(() => import("./AdminDiagnosticWorkspace")') && adminAccounts.includes('<AccountDiagnosticContent>') && adminAccounts.includes('<Accordion initiallyOpen={false}') && adminAccounts.includes('userId={data.profile.firebase_uid}') && adminAccounts.includes('filters={{ user: data.profile.firebase_uid }}') && adminAccounts.includes('getUserDetail(userId, signal)') && adminAccounts.includes('view === "diagnostics" && canReadDiagnostics ? <section>')],
  ['Diagnostic triage states the report sample and opens the latest report directly', adminDiagnostics.includes('coverage.scanned_reports') && adminDiagnostics.includes('row.latest_report_id') && diagnostics.includes('reportId={reportId}')],
  ['Data route uses diagnostic permission and the read-only coverage API', adminAccess.canOpenAdminSection(['diagnostics:read'], 'data') && !adminAccess.canOpenAdminSection(['admin:read'], 'data') && pages.includes('<AdminData routeState={routeState}') && adapters.includes('getDiagnosticCoverage: fetchDiagnosticCoverage') && api.includes('/diagnostic-coverage?') && adminData.includes('admin.getDiagnosticCoverage(period, signal)')],
  ['Diagnostic date picker opens from its own trigger without a modal', adminData.includes('<DiagnosticDateRangePicker') && dateRangePicker.includes('popoverTarget={panelId}') && dateRangePicker.includes('popover="auto"') && !dateRangePicker.includes('aria-modal') && !dateRangePicker.includes('<Modal')],
  ['Diagnostics copies full detail across every matching page', diagnostics.includes('collectDiagnosticReports(admin, filters') && diagnostics.includes('formatDiagnosticReports([report], {})')],
  ['Diagnostics copies one loaded report directly without a second dialog', diagnostics.includes('navigator.clipboard.writeText(formatDiagnosticReports([report], {}))') && !section(adminDiagnostics, 'function DiagnosticReportDialog', 'function CrashGroupStateDialog').includes('<DiagnosticCopyControl')],
  ['Diagnostics supports selecting and copying multiple full reports', diagnostics.includes('collectDiagnosticReportsByIds(admin, [...selectedIds]') && diagnostics.includes('selection={{ selectedKeys: selectedIds') && diagnostics.includes('Copy selected (')],
  ['Diagnostics defaults to a bounded problem summary', diagnostics.includes('createDiagnosticBundle(admin, filters') && diagnostics.includes('Copy problem summary') && diagnostics.includes('Copy all matching reports (slower)')],
  ['Diagnostic reads forward cancellation into HTTP', api.includes('params: AdminDiagnosticFilters = {}, signal?: AbortSignal') && api.includes('encodeURIComponent(id)}`, { signal })') && adapters.includes('fetchCrashLogs(filters, signal)') && adapters.includes('fetchCrashLog(id, signal)')],
  ['Tamper resolution requires an explicit note', diagnostics.includes('TamperResolveDialog') && diagnostics.includes('reason.trim().length < 3')],
  ['Explicit subscription transition endpoints exist', api.includes('/transition/preview') && api.includes('/transition/execute')],
  ['Explicit account lifecycle endpoints exist', api.includes('/lifecycle/preview') && api.includes('/lifecycle/execute')],
  ['Release publication sends the reviewed values and staged artifact revisions', adminRelease.includes('Confirm release publication') && adminRelease.includes('admin.publishRelease({ version: draft.version, channel: draft.channel, notes: draft.notes,') && adminRelease.includes('mandatory: draft.mandatory, updateMode: draft.updateMode, reviewedArtifacts') && api.includes('/releases/publish-reviewed')],
  ['Admin release list uses its own read endpoint without policy or customer download access', adminReleasesAdapter.includes('fetchCurrentAdminRelease(channel, signal)') && !adminReleasesAdapter.includes('fetchRemoteControls') && !adminReleasesAdapter.includes('productionAdapters.releases.getLatest') && api.includes('/releases/current?channel=')],
  ['Admin release page does not call customer protected release catalog', !adminRelease.includes('adapters.releases.getLatest')],
  ['Origin errors are mapped before rendering', productionErrorBlock.includes('userFacingErrorMessage') && productionErrorBlock.includes('origin_not_allowed') && productionErrorBlock.includes('forbidden_origin')],
  ['Overlays render at the viewport root', overlays.includes("createPortal") && overlays.includes('document.body')],
  ['Admin density is explicit and full-page tasks keep actions visible without slide-overs', adminResponsive.includes('font-size: 13px') && adminResponsive.includes('.admin-record-page__footer { position: sticky;') && !adminResponsive.includes('.ui-drawer')],
  [
    'Primary admin pages contain no raw JSON dump',
    [adminAccounts, adminData, adminDevice, adminDiagnostics, adminGovernance, adminOverview].every((source) => !rendersRawJson(source)),
  ],
]

const failed = checks.filter(([, passed]) => !passed)
for (const [label, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`)
if (failed.length) process.exit(1)
