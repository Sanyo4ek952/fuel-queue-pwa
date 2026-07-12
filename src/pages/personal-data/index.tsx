import { Link } from 'react-router-dom'

import {
  PERSONAL_DATA_CONSENT_VERSION,
  PERSONAL_DATA_OPERATOR,
} from '@/shared/config/personal-data-consent'
import { ROUTES } from '@/shared/config/routes'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

export function PersonalDataPage() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Link
          to={ROUTES.login}
          className="text-sm font-medium text-slate-600 underline underline-offset-4"
        >
          Вернуться к регистрации
        </Link>

        <Card className="rounded-lg border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>Согласие на обработку персональных данных</CardTitle>
            <CardDescription>Версия документа: {PERSONAL_DATA_CONSENT_VERSION}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 text-sm leading-6 text-slate-700">
            <Alert className="border-amber-200 bg-amber-50 text-amber-950">
              <AlertTitle>Перед публичным запуском проверьте реквизиты</AlertTitle>
              <AlertDescription>
                Оператором должен быть город, администрация или уполномоченная организация,
                которая определяет цели и состав обработки данных. Замените шаблонные
                реквизиты на официальные перед регистрацией реальных пользователей.
              </AlertDescription>
            </Alert>

            <section className="space-y-2">
              <h1 className="text-xl font-semibold text-slate-950">1. Оператор</h1>
              <p>
                Оператор персональных данных: {PERSONAL_DATA_OPERATOR.name}. Адрес:{' '}
                {PERSONAL_DATA_OPERATOR.address}. Контакт для обращений по персональным
                данным: {PERSONAL_DATA_OPERATOR.contactEmail}.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-950">2. Цели обработки</h2>
              <p>
                Данные используются для регистрации пользователя, формирования и ведения
                очереди на отпуск топлива, проверки допуска автомобиля к заправке, фиксации
                действий в очереди, контроля лимитов, связи с пользователем и подготовки
                административных отчётов.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-950">3. Состав данных</h2>
              <p>
                Могут обрабатываться фамилия, имя, отчество, email, телефон, роль,
                должность, подпись для журналов, выбранная АЗС, госномер автомобиля,
                сведения о записи в очередь, проверках допуска, заправках, отменах,
                лимитах и техническая информация о факте принятия согласия.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-950">4. Действия с данными</h2>
              <p>
                Оператор может собирать, записывать, систематизировать, хранить, уточнять,
                использовать, передавать уполномоченным сотрудникам в рамках работы очереди,
                блокировать, удалять и уничтожать персональные данные в пределах указанных
                целей.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-950">5. Срок и отзыв</h2>
              <p>
                Согласие действует до достижения целей обработки или до его отзыва, если
                иной срок хранения не требуется по закону или правилам отчётности. Для
                отзыва согласия пользователь обращается к оператору по указанному контакту.
                После отзыва регистрация и использование очереди могут быть невозможны.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-950">6. Последствия отказа</h2>
              <p>
                Если пользователь не даёт согласие на обработку персональных данных,
                приложение не сможет создать учётную запись, вести очередь, проверять
                автомобиль и связывать действия с конкретным пользователем.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

