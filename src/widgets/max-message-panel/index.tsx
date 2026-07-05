import { MessageCircle } from 'lucide-react'

import { SendMaxMessageForm } from '@/features/send-max-message'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

export function MaxMessagePanel() {
  return (
    <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="size-5 text-slate-500" aria-hidden="true" />
          MAX сообщения
        </CardTitle>
        <CardDescription>
          Рассылка водителям, которые привязали номер через MAX-бота и дали согласие.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SendMaxMessageForm />
      </CardContent>
    </Card>
  )
}
