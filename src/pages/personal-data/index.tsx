import { Link } from 'react-router-dom'

import {
  PERSONAL_DATA_CONSENT_VERSION,
  PERSONAL_DATA_OPERATOR,
} from '@/shared/config/personal-data-consent'
import { ROUTES } from '@/shared/config/routes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

const personalDataItems = [
  'фамилия, имя и отчество',
  'адрес электронной почты',
  'номер телефона',
  'государственный регистрационный номер автомобиля',
  'выбранная АЗС и вид топлива',
  'сведения о записи и месте в электронной очереди',
  'сведения о допуске, прибытии, отмене и факте заправки',
  'сведения о применённых ограничениях и лимитах',
  'идентификатор учётной записи',
  'дата и время регистрации и принятия согласия',
  'техническая информация, необходимая для работы и безопасности системы',
] as const

const processingPurposeItems = [
  'регистрации и идентификации пользователя',
  'создания и ведения электронной очереди',
  'проверки автомобиля и допуска к заправке',
  'учёта записей, отмен, прибытия и заправок',
  'контроля установленных лимитов',
  'связи с пользователем по вопросам очереди',
  'предотвращения повторных и неправомерных записей',
  'обеспечения безопасности системы',
  'подготовки служебной и статистической отчётности',
] as const

const confirmationItems = [
  'ознакомился с настоящим документом',
  'понимаю цели и условия обработки данных',
  'предоставляю достоверные сведения',
  'согласен на обработку персональных данных на указанных условиях',
] as const

function ConsentList({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item) => (
        <li key={item}>{item};</li>
      ))}
    </ul>
  )
}

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
            <CardDescription className="space-y-1">
              <span className="block">Версия документа: {PERSONAL_DATA_CONSENT_VERSION}</span>
              <span className="block">Дата редакции: 12 июля 2026 года</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 text-sm leading-6 text-slate-700">
            <p>
              Я, пользователь информационной системы «АЗС Онлайн», свободно, своей волей и в
              своём интересе даю согласие на обработку моих персональных данных на следующих
              условиях.
            </p>

            <section className="space-y-2">
              <h1 className="text-xl font-semibold text-slate-950">
                1. Оператор персональных данных
              </h1>
              <dl className="space-y-1">
                <div>
                  <dt className="inline font-medium text-slate-950">Оператор: </dt>
                  <dd className="inline">{PERSONAL_DATA_OPERATOR.name}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-slate-950">ОГРН: </dt>
                  <dd className="inline">{PERSONAL_DATA_OPERATOR.ogrn}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-slate-950">ИНН: </dt>
                  <dd className="inline">{PERSONAL_DATA_OPERATOR.inn}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-slate-950">КПП: </dt>
                  <dd className="inline">{PERSONAL_DATA_OPERATOR.kpp}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-slate-950">Адрес: </dt>
                  <dd className="inline">{PERSONAL_DATA_OPERATOR.address}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-slate-950">Электронная почта: </dt>
                  <dd className="inline">{PERSONAL_DATA_OPERATOR.contactEmail}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-slate-950">Телефон: </dt>
                  <dd className="inline">{PERSONAL_DATA_OPERATOR.phone}</dd>
                </div>
              </dl>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-950">
                2. Какие данные обрабатываются
              </h2>
              <p>
                Оператор может обрабатывать следующие персональные данные:
              </p>
              <ConsentList items={personalDataItems} />
              <p>
                Обрабатываются только сведения, фактически предоставленные пользователем или
                созданные при использовании электронной очереди.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-950">3. Цели обработки</h2>
              <p>
                Персональные данные используются для:
              </p>
              <ConsentList items={processingPurposeItems} />
              <p>Персональные данные не используются для рекламных рассылок.</p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-950">
                4. Обработка персональных данных
              </h2>
              <p>
                Оператор вправе осуществлять сбор, запись, хранение, уточнение, использование,
                предоставление доступа уполномоченным сотрудникам, блокирование, удаление и
                уничтожение персональных данных.
              </p>
              <p>
                Обработка может осуществляться автоматизированным способом с использованием
                информационной системы и сети Интернет.
              </p>
              <p>
                Доступ к данным предоставляется только уполномоченным сотрудникам администрации,
                участвующих АЗС и организациям, обслуживающим информационную систему, в объёме,
                необходимом для работы электронной очереди.
              </p>
              <p>
                Персональные данные не размещаются в открытом доступе и не распространяются
                неопределённому кругу лиц.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-950">
                5. Срок действия и отзыв согласия
              </h2>
              <p>
                Согласие действует до достижения целей обработки, удаления учётной записи или
                его отзыва пользователем.
              </p>
              <p>Пользователь вправе отозвать согласие, направив обращение:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>на электронную почту: {PERSONAL_DATA_OPERATOR.contactEmail};</li>
                <li>по адресу Оператора: {PERSONAL_DATA_OPERATOR.address}.</li>
              </ul>
              <p>
                После отзыва обработка прекращается, а данные удаляются, если их дальнейшее
                хранение не требуется по закону.
              </p>
              <p>
                Отзыв согласия может привести к невозможности дальнейшего использования
                электронной очереди.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-950">
                6. Подтверждение пользователя
              </h2>
              <p>Предоставляя согласие, я подтверждаю, что:</p>
              <ConsentList items={confirmationItems} />
              <p>
                Согласие предоставляется путём самостоятельной установки отдельной отметки и
                нажатия кнопки регистрации.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
