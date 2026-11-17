import { Paperclip } from 'lucide-react'
import { useAdapters } from '../../adapters/AdapterProvider'
import type { SupportSenderRole } from '../../adapters/contracts'
import { Button } from '../../components/ui/Button'
import { supportMessageClass, supportSenderLabel, supportSenderRole } from './productionSupport'
import { formatDisplayDate } from './productionPresentation'

export function SupportThreadMessage({ message, locale, onAttachmentDownload, attachmentsDownloadable = true }: { message: { id: string; sender?: string; senderRole?: SupportSenderRole; sender_role?: SupportSenderRole | string | null; body?: string; createdAt?: string; created_at?: string; attachments?: Array<{ id: string; filename: string; mimeType?: string; mime_type?: string; sizeBytes?: number; size_bytes?: number; status?: string }> }; locale: 'ar' | 'en'; attachmentsDownloadable?: boolean; onAttachmentDownload?: (attachment: { id: string; filename: string }) => Promise<void> }) {
  const { support, admin } = useAdapters()
  const role = supportSenderRole(message.sender, (message.senderRole || message.sender_role || undefined) as SupportSenderRole | undefined)
  return <article className={supportMessageClass(role)} data-role={role}>
    <strong>{supportSenderLabel(role, locale)}</strong>
    {role === 'system' ? <span dir="auto">{message.body}</span> : <p dir="auto">{message.body}</p>}
    {message.attachments?.length ? <div className="support-attachments">{message.attachments.map((attachment) => attachmentsDownloadable ? <Button key={attachment.id} size="sm" variant="secondary" leadingIcon={<Paperclip size={14} />} onClick={() => { void (onAttachmentDownload ? onAttachmentDownload(attachment) : message.created_at ? admin.downloadSupportAttachment(attachment) : support.downloadAttachment({ id: attachment.id, filename: attachment.filename, mimeType: attachment.mimeType || attachment.mime_type || 'application/octet-stream', sizeBytes: attachment.sizeBytes || attachment.size_bytes || 0, status: attachment.status || 'complete' })) }}><bdi>{attachment.filename}</bdi></Button> : <span key={attachment.id}><bdi>{attachment.filename}</bdi></span>)}</div> : null}
    <small>{formatDisplayDate(message.createdAt || message.created_at, locale)}</small>
  </article>
}
