import { useExperience } from '../../app/ExperienceProvider'
import { Button } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Feedback'
import { copyByLocale } from './productionPresentation'

function userFacingErrorMessage(error: string, locale: 'ar' | 'en') {
  const key = String(error || '').trim().toLowerCase()
  if (key === 'invalid_file_type' || key === 'invalid_file_content') {
    return copyByLocale(locale, 'Choose a valid update file for the selected type.', 'اختر ملف تحديث صالحًا للنوع المحدد.')
  }
  if (key === 'file_too_large') {
    return copyByLocale(locale, 'The update file exceeds the allowed size.', 'حجم ملف التحديث أكبر من الحد المسموح.')
  }
  if (key === 'origin_not_allowed' || key === 'forbidden_origin') {
    return copyByLocale(
      locale,
      'This request was blocked by the site origin policy. Open the admin panel from admin.saturnws.com and retry.',
      'تم حظر الطلب بسبب سياسة مصدر الموقع. افتح لوحة الإدارة من admin.saturnws.com ثم أعد المحاولة.',
    )
  }
  if (/^[a-z][a-z0-9_./-]*(?::|\?|$)/i.test(key)) {
    return copyByLocale(locale, 'The request could not be completed. Try again.', 'تعذر إكمال الطلب. حاول مرة أخرى.')
  }
  return error
}

export function ErrorBlock({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const { t, locale } = useExperience()
  return <Alert title={t('failed')} tone="danger" action={onRetry ? <Button size="sm" onClick={onRetry}>{t('retry')}</Button> : undefined}>{userFacingErrorMessage(error, locale)}</Alert>
}
