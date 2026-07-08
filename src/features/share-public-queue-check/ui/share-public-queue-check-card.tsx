import { Check, Clipboard, ExternalLink, QrCode } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ROUTES } from '@/shared/config/routes'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

const qrImagePath = '/queue-check-qr.png'

type CopyState = 'idle' | 'copied' | 'error'

export function SharePublicQueueCheckCard() {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [isQrImageAvailable, setIsQrImageAvailable] = useState(true)
  const publicUrl = useMemo(() => new URL(ROUTES.queueCheck, window.location.origin).toString(), [])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
  }

  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="size-5 text-slate-500" aria-hidden="true" />
          QR для проверки номера
        </CardTitle>
        <CardDescription>
          Покажите QR-код или отправьте ссылку водителю, чтобы он проверил свое место в
          очереди без входа в приложение.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4">
          {isQrImageAvailable ? (
            <img
              src={qrImagePath}
              alt="QR-код публичной проверки номера"
              className="aspect-square w-full max-w-64 rounded-md bg-white object-contain"
              onError={() => setIsQrImageAvailable(false)}
            />
          ) : (
            <div className="flex aspect-square w-full max-w-64 flex-col items-center justify-center gap-3 rounded-md bg-white p-6 text-center text-slate-500">
              <QrCode className="size-12" aria-hidden="true" />
              <p className="text-sm font-medium">QR-код будет добавлен</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">Публичная ссылка</p>
          <a
            href={publicUrl}
            className="block break-all rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-950 underline-offset-4 hover:underline"
          >
            {publicUrl}
          </a>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" className="h-11 gap-2" onClick={handleCopy}>
            {copyState === 'copied' ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Clipboard className="size-4" aria-hidden="true" />
            )}
            {copyState === 'copied' ? 'Скопировано' : 'Скопировать'}
          </Button>
          <Button asChild variant="outline" className="h-11 gap-2">
            <Link to={ROUTES.queueCheck}>
              <ExternalLink className="size-4" aria-hidden="true" />
              Открыть проверку
            </Link>
          </Button>
        </div>

        {copyState === 'error' ? (
          <Alert variant="destructive">
            <AlertTitle>Не удалось скопировать</AlertTitle>
            <AlertDescription>
              Скопируйте ссылку вручную из поля выше.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
