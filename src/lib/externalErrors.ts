import { t } from '@/lib/i18n'

export function getExternalErrorMessage(error: unknown, fallbackKey: string): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return t('common.requestTimedOut')
  }

  if (error instanceof Error && /timeout/i.test(error.message)) {
    return t('common.requestTimedOut')
  }

  return t(fallbackKey)
}
