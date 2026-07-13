import { Download, PlusSquare, Share2, Smartphone } from 'lucide-react'

import { usePwaInstallPrompt } from '@/shared/lib/pwa-install'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/sheet'

export function PwaInstallPrompt() {
  const { install, isVisible, mode, snooze } = usePwaInstallPrompt()

  if (!isVisible || !mode) {
    return null
  }

  return (
    <Sheet
      open={isVisible}
      onOpenChange={(open) => {
        if (!open) {
          snooze()
        }
      }}
    >
      <SheetContent side="bottom" className="mx-auto max-w-3xl rounded-t-lg">
        <SheetHeader className="pr-12">
          <div className="flex size-10 items-center justify-center rounded-lg bg-slate-900 text-white">
            <Smartphone className="size-5" aria-hidden="true" />
          </div>
          <SheetTitle>Скачайте приложение</SheetTitle>
          <SheetDescription>
            Установите АЗС Онлайн на телефон, чтобы быстрее открывать кабинет и работать как в
            приложении.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4">
          {mode === 'ios-instructions' ? (
            <Alert className="border-sky-200 bg-sky-50 text-sky-950">
              <Share2 className="size-4" aria-hidden="true" />
              <AlertTitle>Для iPhone и iPad</AlertTitle>
              <AlertDescription>
                Нажмите «Поделиться», затем «На экран Домой».
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
              <Download className="size-4" aria-hidden="true" />
              <AlertTitle>Для Android</AlertTitle>
              <AlertDescription>
                Нажмите кнопку ниже, и телефон предложит установить приложение.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <SheetFooter>
          {mode === 'native' ? (
            <Button onClick={() => void install()}>
              <Download className="size-4" aria-hidden="true" />
              Скачать приложение
            </Button>
          ) : (
            <Button variant="outline" onClick={snooze}>
              <PlusSquare className="size-4" aria-hidden="true" />
              Понятно
            </Button>
          )}
          <Button variant="ghost" onClick={snooze}>
            Напомнить позже
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
