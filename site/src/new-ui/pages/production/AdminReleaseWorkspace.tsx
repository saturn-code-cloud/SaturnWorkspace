import { useCallback, useRef, useState, type FormEvent } from 'react'
import { useAdapters } from '../../adapters/AdapterProvider'
import { useExperience } from '../../app/ExperienceProvider'
import { useAdminNavigationProtection } from '../../app/adminNavigationProtection'
import { Button } from '../../components/ui/Button'
import { Card, PageHeader, SectionHeader } from '../../components/ui/DataDisplay'
import { Alert, Badge, SkeletonStack } from '../../components/ui/Feedback'
import { Accordion } from '../../components/ui/Navigation'
import { Checkbox, FormField, Input, Select, Textarea } from '../../components/ui/FormControls'
import { Modal } from '../../components/ui/Overlays'
import { compareReleaseVersions } from '../../../lib/releaseContract'
import { useAsyncData } from '../../hooks/useAsyncData'
import { copyByLocale, formatBytes } from './productionPresentation'
import { date } from './adminPageSupport'
import type { AppRoute, Navigate } from '../../app/routes'
import { readReleaseChannel, releaseChannelRoute } from './adminRouteState'

type AdminReleaseChannel = 'stable' | 'beta'
type AdminReleaseMode = 'optional' | 'required' | 'force' | 'silent'
type AdminReleaseArtifact = 'installed' | 'portable'
type AdminReleaseDraft = Readonly<{
  reviewId: number
  channel: AdminReleaseChannel
  version: string
  notes: string
  updateMode: AdminReleaseMode
  mandatory: boolean
  artifactType: AdminReleaseArtifact
  file: File | null
}>

export function AdminReleases({ canManage, routeState, navigate }: { canManage: boolean; routeState?: string; navigate: Navigate }) {
  const channel = readReleaseChannel(routeState)
  return <ReleaseChannelWorkspace key={channel} channel={channel} canManage={canManage} navigate={navigate} />
}

function ReleaseChannelWorkspace({ canManage, channel, navigate }: { canManage: boolean; channel: AdminReleaseChannel; navigate: Navigate }) {
  const { t, locale } = useExperience()
  const { admin } = useAdapters()
  const releases = useAsyncData((signal) => admin.listReleases(channel, signal), [admin, channel], channel)
  const latestRelease = releases.data?.[0] ?? null
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [mandatory, setMandatory] = useState(false)
  const [updateMode, setUpdateMode] = useState<AdminReleaseMode>('optional')
  const [artifactType, setArtifactType] = useState<AdminReleaseArtifact>('installed')
  const [file, setFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [draft, setDraft] = useState<AdminReleaseDraft | null>(null)
  const staged = useAsyncData((signal) => draft ? admin.getStagedRelease(draft.channel, draft.version, signal) : Promise.resolve(null),
    [admin, draft], draft ? String(draft.reviewId) : undefined)
  const [acknowledged, setAcknowledged] = useState(false)
  const [phase, setPhase] = useState<'uploading' | 'publishing' | null>(null)
  const hasDraft = Boolean(version.trim() || notes.trim() || mandatory || updateMode !== 'optional' || artifactType !== 'installed' || file)
  const retainChannel = useCallback((route: AppRoute) => readReleaseChannel(route.state) === channel, [channel])
  useAdminNavigationProtection('releases', canManage ? phase ? 'saving' : hasDraft ? 'draft' : null : null, retainChannel)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const publishing = useRef(false)
  const reviewSequence = useRef(0)
  const backButton = useRef<HTMLButtonElement>(null)
  const modeRequiresUpdate = updateMode === 'required' || updateMode === 'force'
  const canReview = !releases.loading && !releases.refreshing && !releases.error && Boolean(latestRelease)
  const reviewedFiles = !staged.loading && !staged.refreshing && !staged.error ? staged.data : null
  const hasPublishableFile = Boolean(reviewedFiles && (draft?.file || reviewedFiles.installed || reviewedFiles.portable))
  const channelLabel = (value: AdminReleaseChannel) => t(value)
  const artifactLabel = (value: AdminReleaseArtifact) => value === 'installed'
    ? copyByLocale(locale, 'Installed update', 'تحديث النسخة المثبّتة')
    : copyByLocale(locale, 'Portable application', 'نسخة محمولة')
  const modeLabels: Record<AdminReleaseMode, string> = {
    optional: copyByLocale(locale, 'Optional', 'اختياري'),
    required: copyByLocale(locale, 'Required', 'مطلوب'),
    force: copyByLocale(locale, 'Forced', 'إجباري'),
    silent: copyByLocale(locale, 'In the background', 'في الخلفية'),
  }
  const clearFile = () => {
    setFile(null)
    setFileInputKey((value) => value + 1)
  }
  const resetForm = () => {
    setVersion('')
    setNotes('')
    setMandatory(false)
    setUpdateMode('optional')
    setArtifactType('installed')
    clearFile()
  }
  const closeReview = () => {
    if (publishing.current) return
    setDraft(null)
    setAcknowledged(false)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canManage || !canReview || publishing.current || draft) return
    setError('')
    setNotice('')
    const reviewedVersion = version.trim()
    const reviewedNotes = notes.trim()
    if (!/^[0-9A-Za-z._-]{1,60}$/.test(reviewedVersion)) {
      setError(copyByLocale(locale, 'Enter a version such as 1.2.30.', 'أدخل رقم إصدار مثل 1.2.30.'))
      return
    }
    if (!reviewedNotes) {
      setError(copyByLocale(locale, 'Enter the release notes.', 'أدخل ملاحظات الإصدار.'))
      return
    }
    const hasActiveArtifact = latestRelease?.download_url || latestRelease?.artifacts?.installed?.url || latestRelease?.artifacts?.portable?.url
    if (hasActiveArtifact && latestRelease?.version && compareReleaseVersions(reviewedVersion, latestRelease.version) <= 0) {
      setError(copyByLocale(locale, `Enter a version newer than ${latestRelease.version}.`, `أدخل إصدارًا أحدث من ${latestRelease.version}.`))
      return
    }
    const extension = artifactType === 'installed' ? '.zip' : '.exe'
    if (file && (!file.size || !file.name.toLowerCase().endsWith(extension))) {
      const format = extension.slice(1).toUpperCase()
      setError(copyByLocale(locale, `Select a nonempty ${format} file.`, `اختر ملف ${format} غير فارغ.`))
      return
    }
    setAcknowledged(false)
    setDraft({ reviewId: ++reviewSequence.current, channel, version: reviewedVersion, notes: reviewedNotes,
      updateMode, mandatory: mandatory || modeRequiresUpdate, artifactType, file })
  }
  const confirmPublish = async () => {
    if (!canManage || publishing.current || !acknowledged || !draft || draft.channel !== channel || !reviewedFiles || !hasPublishableFile) return
    publishing.current = true
    let stage: NonNullable<typeof phase> = draft.file ? 'uploading' : 'publishing'
    setPhase(stage)
    try {
      const reviewedArtifacts = {
        portable: reviewedFiles.portable?.revision ?? null,
        installed: reviewedFiles.installed?.revision ?? null,
      }
      if (draft.file) {
        const uploaded = await admin.uploadRelease({ file: draft.file, version: draft.version, channel: draft.channel, artifactType: draft.artifactType })
        reviewedArtifacts[draft.artifactType] = uploaded.revision
      }
      stage = 'publishing'
      setPhase(stage)
      await admin.publishRelease({ version: draft.version, channel: draft.channel, notes: draft.notes,
        mandatory: draft.mandatory, updateMode: draft.updateMode, reviewedArtifacts })
      setNotice(copyByLocale(locale, `Published ${draft.version} to ${channelLabel(draft.channel)}.`, `تم نشر الإصدار ${draft.version} على قناة ${channelLabel(draft.channel)}.`))
      resetForm()
      releases.reload()
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      if (code === 'same_version_already_active' || code === 'release_version_not_newer') {
        setError(copyByLocale(locale, 'This version is not newer than the published release. Check the current version before trying again.', 'هذا الإصدار ليس أحدث من الإصدار المنشور. راجع رقم الإصدار الحالي قبل إعادة المحاولة.'))
      } else if (code === 'reviewed_release_artifacts_changed') {
        if (draft.file) clearFile()
        setError(copyByLocale(locale, 'The staged files changed. Review the current files before publishing.', 'تغيّرت الملفات المرفوعة. راجع الملفات الحالية قبل النشر.'))
      } else if (code === 'release_not_uploaded' || code === 'release_artifact_not_uploaded') {
        setError(copyByLocale(locale, 'No uploaded file was found for this version and channel. Select a file and review the release again.', 'لم يُرفع ملف لهذا الإصدار على القناة المختارة. اختر ملفًا وراجع الإصدار مرة أخرى.'))
      } else if (stage === 'uploading') {
        setError(copyByLocale(locale, 'The upload could not be confirmed. No publish request was sent.', 'تعذر تأكيد رفع الملف. لم يُرسل طلب نشر.'))
      } else {
        setError(copyByLocale(locale, 'Publication could not be confirmed. Check the version now listed on this channel before trying again.', 'تعذر تأكيد النشر. راجع الإصدار المعروض الآن على القناة قبل إعادة المحاولة.'))
      }
      if (stage === 'publishing') releases.reload()
    } finally {
      publishing.current = false
      setPhase(null)
      closeReview()
    }
  }
  const publishedArtifacts = latestRelease ? (['installed', 'portable'] as const).flatMap((kind) => {
    const artifact = latestRelease.artifacts?.[kind]
    if (artifact?.filename || artifact?.sha256) return [{ kind, filename: artifact.filename, sha256: artifact.sha256 }]
    if (kind === 'portable' && (latestRelease.filename || latestRelease.download_sha256)) {
      return [{ kind, filename: latestRelease.filename, sha256: latestRelease.download_sha256 }]
    }
    return []
  }) : []
  return <>
    <PageHeader title={t('releases')} actions={
      <FormField label={t('channel')} htmlFor="release-channel-filter">
        <Select id="release-channel-filter" value={channel} disabled={Boolean(phase)} onChange={(event) => {
          const next = event.target.value as AdminReleaseChannel
          navigate(releaseChannelRoute(next), { preserveScroll: true })
        }}>
          <option value="beta">{t('beta')}</option>
          <option value="stable">{t('stable')}</option>
        </Select>
      </FormField>
    } />
    <Card>
      <SectionHeader title={copyByLocale(locale, 'Current release', 'الإصدار الحالي')}
        action={<Button size="sm" variant="ghost" loading={releases.loading || releases.refreshing} disabled={Boolean(phase)} onClick={releases.reload}>{copyByLocale(locale, 'Refresh', 'تحديث')}</Button>} />
      {releases.error ? <Alert title={latestRelease
        ? copyByLocale(locale, 'Refresh failed. Showing the last loaded release. Reload before publishing.', 'تعذّر التحديث. المعروض هو آخر بيانات للإصدار. أعد التحميل قبل النشر.')
        : copyByLocale(locale, 'Could not load this channel', 'تعذر تحميل هذه القناة')} tone={latestRelease ? 'warning' : 'danger'}
        action={<Button size="sm" onClick={releases.reload}>{t('retry')}</Button>} /> : null}
      {releases.loading ? <div aria-busy="true"><SkeletonStack rows={3} /></div>
        : latestRelease && (latestRelease.version || latestRelease.available || latestRelease.disabled) ? <div className="stack" aria-busy={releases.refreshing}><dl className="detail-list">
          <div><dt>{t('version')}</dt><dd><bdi>{latestRelease.version}</bdi></dd></div>
          <div><dt>{t('status')}</dt><dd><Badge tone={latestRelease.disabled ? 'danger' : latestRelease.available ? 'success' : 'neutral'}>{latestRelease.disabled
            ? copyByLocale(locale, 'Disabled', 'معطّل') : latestRelease.available ? copyByLocale(locale, 'Available', 'متاح') : copyByLocale(locale, 'No update available', 'لا يوجد تحديث متاح')}</Badge></dd></div>
          <div><dt>{t('mandatory')}</dt><dd>{latestRelease.mandatory ? copyByLocale(locale, 'Yes', 'نعم') : copyByLocale(locale, 'No', 'لا')}</dd></div>
          <div><dt>{copyByLocale(locale, 'Publication date', 'تاريخ النشر')}</dt><dd>{date(latestRelease.published_at, locale)}</dd></div>
          {latestRelease.disabled && latestRelease.disabled_reason ? <div><dt>{copyByLocale(locale, 'Reason', 'السبب')}</dt><dd>{latestRelease.disabled_reason}</dd></div> : null}
          {publishedArtifacts.map(({ kind, filename, sha256 }) => <div key={kind}>
            <dt>{artifactLabel(kind)}</dt>
            <dd className="admin-release-text">
              {filename ? <bdi>{filename}</bdi> : null}
              {sha256 ? <small className="block secondary" dir="ltr">SHA-256: <code>{sha256}</code></small> : null}
            </dd>
          </div>)}
        </dl>{latestRelease.notes.trim() ? <Accordion initiallyOpen={false} items={[{ id: 'release-notes', title: copyByLocale(locale, 'Release notes', 'ملاحظات الإصدار'), body: <p dir="auto" className="admin-release-text admin-release-notes">{latestRelease.notes}</p> }]} /> : null}</div>
        : latestRelease ? <p className="secondary">{copyByLocale(locale, 'No release is available on this channel.', 'لا يوجد إصدار متاح على هذه القناة.')}</p> : null}
    </Card>
    {canManage ? <Card>
      <SectionHeader title={copyByLocale(locale, 'New release', 'إصدار جديد')} />
      <form className="settings-form" onSubmit={submit}>
        <div className="form-grid">
          <FormField label={t('version')} htmlFor="release-version" required>
            <Input id="release-version" value={version} maxLength={60} dir="ltr" onChange={(event) => setVersion(event.target.value)} required />
          </FormField>
          <FormField label={copyByLocale(locale, 'Update mode', 'طريقة التحديث')} htmlFor="release-mode">
            <Select id="release-mode" value={updateMode} onChange={(event) => setUpdateMode(event.target.value as AdminReleaseMode)}>
              {Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </FormField>
        </div>
        <div className="form-grid">
          <FormField label={t('type')} htmlFor="release-artifact">
            <Select id="release-artifact" value={artifactType} onChange={(event) => {
              setArtifactType(event.target.value as AdminReleaseArtifact)
              clearFile()
            }}>
              <option value="installed">{artifactLabel('installed')}</option>
              <option value="portable">{artifactLabel('portable')}</option>
            </Select>
          </FormField>
          <FormField label={copyByLocale(locale, 'Release file', 'ملف الإصدار')} htmlFor="release-file">
            <Input key={fileInputKey} id="release-file" type="file"
              accept={artifactType === 'installed' ? '.zip,application/zip,application/x-zip-compressed' : '.exe,application/vnd.microsoft.portable-executable'}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </FormField>
        </div>
        <FormField label={t('releaseNotes')} htmlFor="release-notes" required>
          <Textarea id="release-notes" value={notes} required onChange={(event) => setNotes(event.target.value)} />
        </FormField>
        <Checkbox checked={mandatory || modeRequiresUpdate} disabled={modeRequiresUpdate}
          onChange={(event) => setMandatory(event.target.checked)} label={t('mandatory')} />
        {error ? <Alert title={copyByLocale(locale, 'Release not confirmed', 'لم يتأكد نشر الإصدار')} tone="danger">{error}</Alert> : null}
        {notice ? <Alert title={t('success')} tone="success">{notice}</Alert> : null}
        <Button type="submit" variant="primary" disabled={!canReview || Boolean(phase)}>{copyByLocale(locale, 'Review release', 'مراجعة الإصدار')}</Button>
      </form>
    </Card> : null}
    {canManage && draft ? <Modal open onClose={closeReview} closeDisabled={Boolean(phase)}
      title={copyByLocale(locale, 'Confirm release publication', 'تأكيد نشر الإصدار')}
      closeLabel={t('close')} initialFocusRef={backButton}
      footer={<>
        <Button ref={backButton} onClick={closeReview} disabled={Boolean(phase)}>{copyByLocale(locale, 'Back to editing', 'رجوع للتعديل')}</Button>
        <Button variant="primary" loading={Boolean(phase)} disabled={!acknowledged || !hasPublishableFile} onClick={confirmPublish}>
          {copyByLocale(locale, 'Publish release', 'نشر الإصدار')}
        </Button>
      </>}>
      <div className="stack">
        <dl className="detail-list">
          <div><dt>{t('channel')}</dt><dd>{channelLabel(draft.channel)}</dd></div>
          <div><dt>{t('targetAudience')}</dt><dd>{copyByLocale(locale, 'Entire channel', 'القناة بالكامل')}</dd></div>
          <div><dt>{t('version')}</dt><dd><bdi>{draft.version}</bdi></dd></div>
          <div><dt>{copyByLocale(locale, 'Update mode', 'طريقة التحديث')}</dt><dd>{modeLabels[draft.updateMode]}</dd></div>
          <div><dt>{t('mandatory')}</dt><dd>{draft.mandatory ? t('enabled') : t('disabled')}</dd></div>
        </dl>
        <section aria-labelledby="reviewed-release-files">
          <h3 id="reviewed-release-files">{copyByLocale(locale, 'Release files', 'ملفات الإصدار')}</h3>
          {staged.error ? <Alert title={copyByLocale(locale, 'Could not load uploaded files', 'تعذر تحميل الملفات المرفوعة')} tone="danger"
            action={<Button size="sm" onClick={staged.reload}>{t('retry')}</Button>} />
            : !reviewedFiles ? <div role="status">{copyByLocale(locale, 'Checking uploaded files…', 'جارٍ التحقق من الملفات المرفوعة…')}</div>
            : hasPublishableFile ? <dl className="detail-list">
              {(['installed', 'portable'] as const).map((kind) => {
                const existing = reviewedFiles[kind]
                const selected = draft.artifactType === kind ? draft.file : null
                if (!selected && !existing) return null
                const size = formatBytes(selected?.size ?? existing?.size_bytes)
                return <div key={kind}><dt>{artifactLabel(kind)}</dt><dd className="admin-release-text">
                  <bdi>{selected?.name ?? existing?.filename}</bdi>{size ? <> · <bdi>{size}</bdi></> : null}
                  <small className="block secondary">{selected
                    ? existing ? <>{copyByLocale(locale, 'Replaces', 'سيحل محل')} <bdi>{existing.filename}</bdi></> : copyByLocale(locale, 'To be uploaded', 'سيُرفع عند النشر')
                    : copyByLocale(locale, 'Already uploaded', 'مرفوع مسبقًا')}</small>
                </dd></div>
              })}
            </dl> : <p className="secondary">{copyByLocale(locale, 'No files have been uploaded for this release. Go back and choose a file.', 'لا توجد ملفات مرفوعة لهذا الإصدار. ارجع واختر ملفًا.')}</p>}
        </section>
        <div>
          <strong>{t('releaseNotes')}</strong>
          <p className="admin-release-text admin-release-notes" dir="auto">{draft.notes}</p>
        </div>
        <Checkbox checked={acknowledged} disabled={Boolean(phase) || !hasPublishableFile} onChange={(event) => setAcknowledged(event.target.checked)}
          label={copyByLocale(locale, 'I reviewed the release details.', 'راجعت تفاصيل الإصدار.')} />
        <div role="status" className={phase ? undefined : 'sr-only'}>{phase === 'uploading' ? copyByLocale(locale, 'Uploading the release file…', 'جارٍ رفع ملف الإصدار…')
          : phase === 'publishing' ? copyByLocale(locale, 'Publishing the release…', 'جارٍ نشر الإصدار…') : null}</div>
      </div>
    </Modal> : null}
  </>
}
