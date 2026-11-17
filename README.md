# Saturn Workspace Web Platform

- Status: canonical source guide
- Scope: public/customer/admin Web surfaces and Auth, Admin, Policy, and Route Check Workers
- Owner: repository maintainer
- Last verified: 2026-11-08
- Verification: protected `web-required` CI

Owned and developed by one independent individual/student, not a registered
company or corporate publisher.

## Architecture and ownership

- `site`: React customer, public, and administrator interfaces plus typed API
  adapters and production-cutover checks.
- `workers/auth`: authentication, device linking, account sessions, and OAuth
  configuration delivery.
- `workers/admin`: administrative operations, diagnostics, support, OTA release
  metadata, and provider-disabled commerce routes.
- `workers/policy`: entitlement decisions, notifications, invitations, email
  content, and policy signing.
- `workers/route-check`: short-lived, privacy-bounded browser-origin route
  qualification for the Desktop session lifecycle.
- `workers/shared`: shared subscription and account-domain behavior.
- `contracts`: machine-readable producer contracts consumed by Desktop.
- `tools`: source-promotion, runtime-contract, provenance, and authority checks.
- `.github/workflows/ci.yml`: protected source qualification.
- `.github/workflows/deploy-pages.yml`: manual exact-commit Pages promotion.

Route Check retains one random attempt's minimum observations for a bounded
TTL, deleting them on finalization or alarm. Application observability is off.
The page sends attempt-scoped observations only to Saturn's three
route-check HTTPS origins. Its WebRTC side-route probe also contacts
`stun.cloudflare.com:3478`, a Cloudflare infrastructure boundary that is not
governed by the page's HTTP `connect-src` policy. The page sends no Saturn user
identity, account email, profile identifier, browsing target/content, or proxy secret;
attempt observations are short-lived and excluded from persistent application
analytics. Infrastructure providers may still create transport-level logs
outside Saturn's application retention controls.

The Desktop source is the separate private canonical repository
`saturn-code-cloud/SaturnWorkspace-Desktop`. `contracts/desktop-control-plane.v1.json`
is the Web producer contract; Desktop pins its reviewed content and producer
commit.

## Local qualification

Desktop diagnostics use a bounded local outbox and stable event IDs. The Admin
Worker accepts sanitized technical failures from startup through shutdown,
attributes reports only through a matching verified app session, and leaves
pre-login reports unattributed. Administrator-only history and detail support
user filters, cursor pagination, occurrence counts, and lifecycle context.
Diagnostics refreshes manually. The primary problem summary scans up
to 1,000 recent matching records, groups recurring failures, and includes up
to 40 full sanitized examples with four concurrent detail requests. Its JSON
states the scanned window, occurrence counts, omitted signatures and examples,
and whether more pages may remain. It is limited to 512 KiB; examples are
included whole or omitted, never shortened. This is not a whole-history count
or an atomic snapshot. A separate action copies every matching report across
all pages. Administrators can also copy an individual full report.
New Desktop reports can include a bounded technical timeline before the failure
and a linked follow-up collected afterward. Report detail verifies the link's
event, run and operator boundaries, displays ordered events with expandable
facts, and includes both windows in the full copy. Unattributed reports remain
unattributed. Missing follow-ups, capacity limits and incomplete collection are
visible rather than presented as complete evidence.
Diagnostics keeps results mounted while a report is open: beside the report
on wide screens, restored on return on narrow screens. Detail navigation keeps
filters, pagination, and selection. Selection replaces general export actions.
An unreadable follow-up is marked unavailable without hiding the main report;
refresh retries it. An unreadable main report shows an error.
Summary collection stops after 45 seconds; full collection stops
after 120 seconds. Cancellation and deadlines abort the underlying requests.
If clipboard access is blocked, selectable text and a file download remain
available. Collection errors never produce a partial export presented as complete.
The daily scheduled task deletes reports older than 90 days. Delivery
retries do not change a report's original attribution. Offline delivery is
delayed; an abrupt shutdown can prevent an unsaved failure from being recorded.
Passwords, authentication secrets, access tokens, message contents, and notes
are excluded. Worker and Pages promotion are separate release operations.

Overview and diagnostics share a triage window of up to 100 recent retained
reports. It groups actionable errors and counts open or investigating groups
as needing review. Counts describe that sample, not full history. Overview links
carry its upper timestamp, without freezing deliveries or group status changes.
Report links load the full retained report separately.

Account details load independently of diagnostics. Authorized administrators
can expand reports and tamper alerts linked through that account's subscriptions.
Promote Admin before Pages for paginated alerts. The Worker still accepts the
published client's previous account-detail request.

Section links, search, and direct URLs follow session permissions. Support,
email, and promotion reads remain available; writes need domain permission.
Admin access separates outages, expired credentials and denied permissions.
Retry retains completed sign-in steps. Reads abort after 15 seconds, Google
verification after 10. Provider/configuration failures return 503, never access.
UI fonts are bundled.
Read-only policies show saved values, not edit forms. Releases/commerce need
their read permissions. `GET /api/admin/releases/current` projects only the
selected channel, excluding policies/targeting. Combined `/state` requires super
admin; `/history` requires release and audit access. Promote Worker before Pages;
limited release roles need new Pages because the old UI reads policy state.
Disabled versions retain their details. Failed refreshes retain the previous
record but block publication until a fresh read succeeds. Admin release reads
and writes reject unreadable manifests; public update checks retain their
existing empty-baseline fallback.
Release channel links survive reloads and browser history. Switching channels
warns before discarding an unpublished draft.

Support shows the list beside the conversation on wide screens, one at a time
on narrow screens, restoring the list on return. Links retain search, filters,
and page across reloads. Separate reply/note drafts stay in memory within the
inbox and are discarded on leaving. Replies/status changes reuse their request
identity after failure. Only a confirmed save clears the composer; a saved
portal reply and failed email queueing are distinct. History/read-marker failure
does not hide the conversation. Unavailable history is explicit; failed primary
message reads are errors, not empty conversations.

Email opens on activity: server-side search, status filters, and 25 records per
page. Details sit beside wide-screen results or replace narrow-screen results,
preserving search/page. Templates/configuration are separate. Reads return only
operational metadata, never bodies, verification codes, template/encrypted
payloads, or headers. Failed reads are unavailable, not empty; provider-event
failure does not hide metadata. Provider acceptance differs from delivery to
the recipient's mail server; neither proves a person read the message.

Retry and test-send actions process their named message, not another queued
message. Retry checks the current job, recipient suppression, catalog rules,
and temporary payload availability before changing its state. It does not remove
a recipient block or restore expired or purged data. Queue processing remains
a separate, confirmed operation and reports when another processor holds the
lock. Writes require `communications:write`. Browsing activity does not send
mail or automatically refresh. The configuration-only read does not queue
alerts. The previous combined status response remains for the older client.

Promote the compatible Policy Worker, then the Admin Worker, then Pages for the
new email routes and qualified action results. The new client rejects older or
malformed responses. Roll back Pages before either Worker if those routes are
removed. These changes add no tracking, provider, production flag, or schema
migration. Local verification uses synthetic mail and does not send real email.

Device-change records return to the same queue status/page. Pending requests
require an explicit decision and reason. Confirmation shows account, device,
reason, and effect: approval replaces the device and ends all active app
sessions; rejection preserves the link. Changed requests invalidate previews.
Unconfirmed decisions allow same-operation retry or checking the current result
without another decision.

Device unlinking is separate from deleting or wiping a device. The Admin review
names the linked device, explains that desktop sessions end and pending device
requests are cancelled, and requires a reason. Execution checks the reviewed
binding ID and timestamp under the account lock. Its audit record commits in
the same transaction. Replaying a completed operation does not unlink a device
that was linked afterward.

Before deploying this Worker, apply
`workers/auth/migrations/20261110142656_review_account_device_before_unlink.sql`
with separate production approval. The migration removes the unchecked
four-argument reset function; an older Worker will fail to unlink devices until
the compatible Worker is deployed. Rolling back the UI or Worker must not
restore that unchecked function. The legacy subscription HWID-reset endpoint
returns 410 and does not change subscription data.

SQL regression tests use pinned PGlite, not a live database. Run
`npm run test:database` in `workers/auth` for device unlinking, promotion codes,
and directory permissions/paging (full commands below).

Overview counts come from existing records. App sign-ins can remain valid
offline and do not count browser launches. The entitlement total includes
grace periods and is unavailable when the subscription read is incomplete.

User and subscription directories filter and page in PostgreSQL. Subscription
projection uses the shared resolver; pending grants have counted pages.
List links retain applied search, filters and page; pending grants retain their
own page. Audit search links retain the applied query. Unsaved account work is
protected when navigating to a different record, including browser history.
On narrow screens, record tables group each row's fields and actions. Comparison
tables keep their columns and support keyboard scrolling when needed.
With separate approval, apply Auth migrations
`20261113141600_admin_user_directory.sql` and
`20261113160805_admin_subscription_directory.sql` before Admin, then Pages.
Missing functions fail explicitly. Roll back Pages first; functions may remain.

Support history loads newest first, separately from the conversation. Read
receipts match the messages returned for that ticket. Before release, apply
Policy D1 migration `0019_support_admin_history_and_reads.sql`, then promote
Policy, Admin, and Pages in that order. Roll back Pages first.

The promotion directory filters/pages codes by lifecycle in the database,
returning copyable codes without private feature/creator data. Failed saves keep
the form and allow code lookup. Checkout stays disabled. Pause/resume require
the reviewed timestamp and never reset expiry or usage.

With separate production approval, apply
`workers/auth/migrations/20261111155417_admin_promo_code_directory.sql` before
Admin and Pages. It adds a service-role-only, security-invoker view and mutation
functions. Writes and admin audits commit together. Timestamps advance even
within a transaction, preventing stale overwrites. Missing migration support
fails explicitly. Older clients must reload compatible Pages before changing
code state. Roll back Pages before Admin; database additions may remain.
Source changes do not apply the migration.

Commerce requires `commerce:read`: filtered, counted pages of orders, plans,
and subscription-integrity records. Order lookup uses email or exact ID;
inline paged attempts, events, and receipt metadata preserve the order.
Failed related reads are unavailable, not empty. Invalid rows/counts fail;
payloads, idempotency hashes, checkout/receipt URLs, releases, and downloads
are excluded. The pattern follows [Lemon Squeezy's order lookup](https://docs.lemonsqueezy.com/api/orders/list-all-orders), not its provider actions.
Public pricing and Admin distinguish credentials from implemented providers;
checkout stays disabled pending approved rollout. Money respects currency
minor units; no cross-currency revenue is inferred. Creation is unchanged;
no grants, refunds, receipts, credentials, flags, or schema are added.
Promote Admin before Pages. Retire the legacy sampled overview after compatible
Pages promotion and old rollback retirement; until then it checks release/audit
permissions separately.

Invitations have searchable lifecycle pages, inline restrictions, and validation
history, following [Clerk's invitation management](https://clerk.com/docs/guides/users/inviting), not its email, membership, or expiry policies.
Recorded attempts include rejections; best-effort logging is not a complete
ledger. Failed reads are unavailable, independent of global policy.
Create/revoke and Policy audit commit in one D1 batch. Concurrent creation
retries reuse one request; different actors/payloads reject replay. Codes appear
once, never persisted in plaintext. Uncertain creation retains its request and
non-secret draft in that admin's tab for 24 hours, cleared on confirmation;
there is no automatic retry. Lost codes require review or explicit revocation
before replacement. Revocation retains uses/history. Restrictions are validated,
not shortened; public validation/permissions are unchanged. Policy `test:invites`
tests concurrency and audit rollback on disposable Workers/D1, not live invites.

Promote Policy, Admin, then Pages; roll back Pages before removing compatible
Worker responses. No migration, email, entitlement grant, or access-mode change
is added.

Global policy has scoped reads and [explicit saves](https://primer.style/product/ui-patterns/saving/).
Refresh/policy-tab changes retain drafts; unload warns. Review shows changes
only and rejects stale revisions. Saves preserve hidden feature/limit/action
rules. Paged version/plan reads replace combined state, restricted to super-admin
for older clients. Version reviews include enable/disable cycles. Both writes
and audit commit in one D1 batch; retries reuse the same request. Plan rules are
read-only; unreadable rules and missing global rules are explicit. `test:policies`
covers concurrency, replay, paging, projections and rollback. With approval,
apply `workers/policy/migrations/0018_disabled_version_revisions.sql` before
Policy, Admin, then Pages. Stamps survive unblocking; reads do not scan audits.
Evaluation is unchanged. Older clients need new Pages; rollback retains stamps
and triggers, never unchecked writes.

Readiness separates three bounded database reads from configuration presence.
Empty tables can pass; missing tables, denied reads, malformed responses, and
timeouts cannot. It shows check time and marks stale results after failed refresh.
No writes, polling, secret exposure, payment activation, or permission changes
occur. Promote Admin before Pages; new Pages reject unqualified older responses.
The Worker retains earlier summary fields for old clients. Roll back Pages
before the Worker.

The admin Data page groups received error and warning reports by release
version and channel for dates selected in the administrator's time zone.
Both selected days are included, within the 90-day retention window. The page
reads the newest 100 records at most and shows when the period contains more. It counts
each matching report once, skips expected events and trace supplements, and
links to the latest matching report in each row. It uses the existing
`diagnostics:read` permission and does not add client-side collection.
Usage and performance collection will follow Admin approval; neither is active.

Audit reads and writes use `admin_activity`. A failed insert is retried from
private R2 on the 15-minute schedule; confirmed objects are removed. The
existing release-history endpoints also read the old archive. Rolling back the
Worker hides new entries from those legacy endpoints until re-promotion.

Use Node.js 22 and the committed npm locks. Security overrides pin fixes where
upstream ranges still select affected dependencies; review them when upstream
pins change.

```powershell
node --test tools/authority-surface.test.mjs tools/deployment-boundary.test.mjs tools/runtime-contract.test.mjs
node tools/check-authority-surface.mjs
node tools/check-deployment-boundary.mjs

Push-Location site
npm ci
npm run lint
npm run build
npm run test:production-integration
npm run test:production-rollout
npm run test:content
npm run test:admin-surface
Pop-Location

Push-Location workers/admin
npm ci
npm run check:syntax
npm run test:required
Pop-Location

Push-Location workers/auth
npm ci
npm run check
npm run test:device-linking
npm run test:database
Pop-Location

Push-Location workers/policy
npm ci
npm run test:required
Pop-Location

Push-Location workers/route-check
npm ci
npm run test:required
Pop-Location
```

`npm run dev` or `wrangler dev` is a local development surface only. Local
fixtures and tokens must remain synthetic; never copy real customer or
production data into tests.

## Current product boundaries

- Account connection and entitlement are distinct. A linked account can have no
  subscription, while paid operations remain denied.
- No production payment provider is active. Checkout, manual grants, and
  billing communications stay disabled or fail closed until separately
  approved and externally verified.
- Irreversible account deletion is not approved; do not promise hard deletion.
- Gmail read access remains disabled until provider verification and an explicit
  rollout decision.
- The Route Check Worker source may be adopted through a protected PR, but its
  custom route, Durable Object, and rate-limit binding are not live capability
  until a separately authorized Worker deployment and browser-provider QA.
- Desktop production signing, publisher verification, publication, and release
  remain outside this repository and are deferred.

These boundaries are enforced in runtime code, contracts, and tests. A prose
change cannot activate an integration or authorize an operation.

## Source, deployment, and secrets

Merging a protected pull request adopts source; it does not deploy. GitHub Pages
can be promoted only by manually dispatching `deploy-pages.yml` with the exact
current `main` SHA after `web-required` succeeds. Worker deployment is a separate
operator action and is not automated by this repository.

Expected environment bindings are declared by Worker configuration and code.
Secret values belong only in the approved external platform or local ignored
files. Never commit or print `.dev.vars`, service-role keys, Firebase or OAuth
credentials, signing keys, tokens, production payloads, Wrangler state, or real
user data.

## Documentation authority

`AGENTS.md` and this file are the complete active prose surface. Code, contracts,
migrations, configuration, workflows, and tests are executable authority.
Migration filenames preserve database history, not current product intent.
Git history replaces in-tree archives of superseded guidance.
