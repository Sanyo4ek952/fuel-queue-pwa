import {
  Activity,
  BarChart3,
  CalendarCheck,
  CarFront,
  CheckCircle2,
  ClipboardCheck,
  Fuel,
  ListChecks,
  MapPinned,
  ShieldCheck,
  Signal,
  TriangleAlert,
} from 'lucide-react'

import cashierMobileCheckImage from '@/assets/promo/cashier-mobile-check.png'
import queueChaosToOrderImage from '@/assets/promo/queue-chaos-to-order.png'
import threeStationDashboardImage from '@/assets/promo/three-station-dashboard.png'

const painPoints = [
  'Очередь приходится вести вручную, из-за этого появляются споры и ошибки.',
  'Повторную заправку сложно отследить между разными АЗС.',
  'Кассир тратит время на выяснение, кто записан и почему можно или нельзя отпускать топливо.',
  'Администрации не хватает единой статистики по машинам, литрам и решениям смены.',
] as const

const solutionPoints = [
  'Проверка по госномеру сразу по всем 3 АЗС.',
  'Понятный статус: разрешено, запрещено или нужна проверка.',
  'Лимиты по топливу и автомобилям видны до заправки.',
  'Факт отпуска топлива и ручные решения попадают в журнал.',
] as const

const workflowSteps = [
  {
    icon: ListChecks,
    title: 'Лимиты',
    text: 'Управляющий АЗС задаёт дату, АЗС, виды топлива, лимит машин и литров.',
  },
  {
    icon: CalendarCheck,
    title: 'Запись',
    text: 'Помощник мэра или управляющий АЗС записывает автомобиль на дату и получает номер записи.',
  },
  {
    icon: CarFront,
    title: 'Допуск',
    text: 'Кассир вводит госномер и сразу видит решение системы.',
  },
  {
    icon: Fuel,
    title: 'Заправка',
    text: 'Фактические литры сохраняются в истории и отчётах.',
  },
] as const

const staffBenefits = [
  { label: 'Разрешено', text: 'Есть запись, лимит не превышен, повторной заправки нет.' },
  { label: 'Запрещено', text: 'Нет записи, автомобиль уже заправлен или превышен лимит.' },
  { label: 'Проверка', text: 'Спорное решение передаётся старшему смены и фиксируется в журнале.' },
] as const

const adminBenefits = [
  { value: '3', label: 'АЗС работают по единым правилам' },
  { value: '1', label: 'проверка номера защищает от повтора за день' },
  { value: '24/7', label: 'журнал действий сохраняет историю решений' },
] as const

export function PromoPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-950 text-slate-950">
      <main className="mx-auto min-h-screen w-full max-w-6xl overflow-x-hidden bg-slate-50">
        <section className="relative isolate overflow-hidden bg-slate-950 px-4 pb-10 pt-5 text-white sm:px-6 md:grid md:min-h-[760px] md:grid-cols-[0.94fr_1.06fr] md:items-center md:gap-8 md:px-10 lg:px-14">
          <div className="absolute inset-0 -z-10 md:hidden">
            <img
              src={queueChaosToOrderImage}
              alt=""
              className="size-full object-cover opacity-35"
            />
            <div className="absolute inset-0 bg-slate-950/72" />
          </div>

          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-normal text-sky-100">
              <ShieldCheck className="size-4" aria-hidden="true" />
              АЗС Онлайн
            </div>

            <h1 className="mt-5 max-w-[12ch] text-4xl font-black leading-[1.02] tracking-normal sm:text-5xl md:max-w-[13ch] md:text-6xl lg:text-7xl">
              Очередь на АЗС без хаоса и споров
            </h1>

            <p className="mt-5 max-w-xl text-lg leading-7 text-slate-200 sm:text-xl">
              Приложение помогает записывать автомобили, проверять допуск по госномеру,
              контролировать лимиты и фиксировать фактический отпуск топлива по 3 АЗС.
            </p>

            <div className="mt-7 grid grid-cols-2 gap-2 sm:max-w-lg sm:grid-cols-3">
              <HeroMetric icon={MapPinned} value="3" label="АЗС" />
              <HeroMetric icon={CarFront} value="1" label="номер" />
              <HeroMetric icon={Signal} value="офлайн" label="режим" />
            </div>
          </div>

          <div className="relative z-10 mt-8 hidden overflow-hidden rounded-lg border border-white/10 bg-white/10 shadow-2xl md:block">
            <img
              src={queueChaosToOrderImage}
              alt="Организация очереди на АЗС через мобильное приложение"
              className="aspect-[4/3] w-full object-cover"
            />
          </div>
        </section>

        <section className="px-4 py-10 sm:px-6 md:px-10 lg:px-14">
          <SectionHeader
            eyebrow="Боль без системы"
            title="Когда топлива мало, ручной учёт быстро ломается"
            text="Главная проблема не в самой очереди, а в том, что нет единого правила проверки, записи и фиксации факта заправки."
          />

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <InfoPanel title="Что происходит сейчас" tone="danger" items={painPoints} />
            <InfoPanel title="Что даёт приложение" tone="success" items={solutionPoints} />
          </div>
        </section>

        <section className="bg-white px-4 py-10 sm:px-6 md:px-10 lg:px-14">
          <SectionHeader
            eyebrow="Рабочий сценарий"
            title="Весь путь заправки укладывается в четыре понятных шага"
            text="Каждый сотрудник видит только свой простой участок работы, а данные остаются в едином контуре."
          />

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {workflowSteps.map((step, index) => {
              const Icon = step.icon

              return (
                <article
                  key={step.title}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="grid size-11 place-items-center rounded-lg bg-blue-600 text-white">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span className="text-sm font-bold text-slate-400">{index + 1}</span>
                  </div>
                  <h3 className="mt-4 text-xl font-extrabold tracking-normal text-slate-950">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{step.text}</p>
                </article>
              )
            })}
          </div>
        </section>

        <section className="grid gap-8 px-4 py-10 sm:px-6 md:grid-cols-[0.95fr_1.05fr] md:items-center md:px-10 lg:px-14">
          <div>
            <SectionHeader
              eyebrow="Удобство на смене"
              title="Кассиру не нужно спорить — он видит решение системы"
              text="Проверка по госномеру показывает причину допуска или отказа. Спорная ситуация уходит старшему смены, а решение сохраняется."
            />

            <div className="mt-6 grid gap-3">
              {staffBenefits.map((item, index) => (
                <StatusRow key={item.label} item={item} index={index} />
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <img
              src={cashierMobileCheckImage}
              alt="Кассир проверяет автомобиль по телефону"
              className="aspect-[4/3] w-full object-cover"
            />
          </div>
        </section>

        <section className="grid gap-8 bg-white px-4 py-10 sm:px-6 md:grid-cols-[1.05fr_0.95fr] md:items-center md:px-10 lg:px-14">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-sm md:order-none">
            <img
              src={threeStationDashboardImage}
              alt="Панель контроля по трём АЗС"
              className="aspect-[4/3] w-full object-cover"
            />
          </div>

          <div>
            <SectionHeader
              eyebrow="Контроль для администрации"
              title="Видно очередь, лимиты и фактический отпуск топлива"
              text="Руководитель получает понятную картину: сколько машин записано, сколько литров отпущено, где заканчивается лимит и какие решения приняты вручную."
            />

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
              {adminBenefits.map((item) => (
                <div key={item.value} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <strong className="block text-4xl font-black text-blue-600">{item.value}</strong>
                  <span className="mt-2 block text-sm leading-5 text-slate-600">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-10 sm:px-6 md:px-10 lg:px-14">
          <div className="rounded-lg bg-slate-950 p-5 text-white sm:p-8 md:p-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-normal text-sky-100">
              <Activity className="size-4" aria-hidden="true" />
              Главная ценность
            </div>
            <h2 className="mt-5 max-w-3xl text-3xl font-black leading-tight tracking-normal sm:text-4xl md:text-5xl">
              Меньше ручного контроля. Меньше конфликтов. Больше прозрачности.
            </h2>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-200 sm:text-lg">
              Приложение превращает дефицитный процесс в управляемый: очередь,
              лимиты, допуск, заправка, отчёты и журнал действий работают вместе.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <FinalBenefit
                icon={ClipboardCheck}
                title="Для сотрудников"
                text="Быстрая проверка, понятные статусы и минимум действий при фиксации заправки."
              />
              <FinalBenefit
                icon={BarChart3}
                title="Для управления"
                text="Единая очередь, отчёты по литрам, аудит действий и защита от повторных заправок."
              />
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function HeroMetric({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof MapPinned
  value: string
  label: string
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/10 p-3">
      <Icon className="size-4 text-sky-200" aria-hidden="true" />
      <strong className="mt-2 block text-xl font-black leading-none">{value}</strong>
      <span className="mt-1 block text-xs font-medium text-slate-300">{label}</span>
    </div>
  )
}

function SectionHeader({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string
  title: string
  text: string
}) {
  return (
    <div>
      <p className="text-xs font-extrabold uppercase tracking-normal text-blue-600">{eyebrow}</p>
      <h2 className="mt-2 max-w-3xl text-3xl font-black leading-tight tracking-normal text-slate-950 sm:text-4xl md:text-5xl">
        {title}
      </h2>
      <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">{text}</p>
    </div>
  )
}

function InfoPanel({
  title,
  tone,
  items,
}: {
  title: string
  tone: 'danger' | 'success'
  items: readonly string[]
}) {
  const isSuccess = tone === 'success'

  return (
    <article
      className={[
        'rounded-lg border p-4 sm:p-5',
        isSuccess ? 'border-emerald-200 bg-emerald-50/70' : 'border-red-200 bg-red-50/70',
      ].join(' ')}
    >
      <h3 className="text-xl font-extrabold tracking-normal text-slate-950">{title}</h3>
      <ul className="mt-4 grid gap-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-6 text-slate-700 sm:text-base">
            <span
              className={[
                'mt-0.5 grid size-6 shrink-0 place-items-center rounded-md text-white',
                isSuccess ? 'bg-emerald-600' : 'bg-red-600',
              ].join(' ')}
            >
              {isSuccess ? (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              ) : (
                <TriangleAlert className="size-4" aria-hidden="true" />
              )}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </article>
  )
}

function StatusRow({
  item,
  index,
}: {
  item: (typeof staffBenefits)[number]
  index: number
}) {
  const variants = [
    'bg-emerald-50 text-emerald-700 border-emerald-200',
    'bg-red-50 text-red-700 border-red-200',
    'bg-amber-50 text-amber-700 border-amber-200',
  ] as const

  return (
    <article className="grid grid-cols-[auto_1fr] gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <span
        className={[
          'grid size-10 place-items-center rounded-lg border',
          variants[index] ?? variants[0],
        ].join(' ')}
      >
        {index === 0 ? (
          <CheckCircle2 className="size-5" aria-hidden="true" />
        ) : index === 1 ? (
          <TriangleAlert className="size-5" aria-hidden="true" />
        ) : (
          <ShieldCheck className="size-5" aria-hidden="true" />
        )}
      </span>
      <div>
        <h3 className="text-lg font-extrabold tracking-normal text-slate-950">{item.label}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">{item.text}</p>
      </div>
    </article>
  )
}

function FinalBenefit({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof ClipboardCheck
  title: string
  text: string
}) {
  return (
    <article className="rounded-lg border border-white/10 bg-white/10 p-4">
      <Icon className="size-6 text-sky-200" aria-hidden="true" />
      <h3 className="mt-3 text-xl font-extrabold tracking-normal">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-200">{text}</p>
    </article>
  )
}
