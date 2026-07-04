# 14. AI Working Rules

## Назначение

Файл нужен, чтобы ИИ-ассистент не ломал архитектуру проекта.

## Перед любой задачей ИИ должен определить

- какой слой FSD нужен;
- какие сущности затронуты;
- затрагивает ли задача UI-компоненты и какие существующие компоненты можно переиспользовать;
- какие public API slices будут использоваться;
- есть ли бизнес-правило;
- нужны ли роли;
- нужна ли Zod schema;
- нужна ли offline-синхронизация;
- нужна ли RPC-функция.

## Перед созданием или изменением UI-компонентов

ИИ должен сначала проверить, есть ли в проекте подходящий компонент:

- `src/shared/ui`;
- `src/widgets/*/ui`;
- `src/features/*/ui`;
- `src/entities/*/ui`;
- публичные экспорты через `index.ts`;
- уже подключённые shadcn/ui-компоненты.

Если компонент похож по назначению, нужно переиспользовать его и при необходимости немного расширить через props, variants или composition.

Создавать новый компонент можно только после проверки существующих компонентов и только если переиспользование приведёт к неправильной ответственности компонента, поломке текущих сценариев или чрезмерно сложному API.

Новый переиспользуемый UI нужно размещать на самом низком подходящем FSD-слое:

- базовый UI — `shared/ui`;
- UI бизнес-сущности — `entities/*/ui`;
- UI действия пользователя — `features/*/ui`;
- крупный блок экрана — `widgets/*/ui`.

## Import boundaries

ИИ должен соблюдать направление зависимостей:

```text
app -> pages -> widgets -> features -> entities -> shared
```

Импорт из чужого slice должен идти через public API:

```ts
import { CheckVehicleForm } from '@/features/check-vehicle'
```

Deep import разрешён только внутри того же slice, например из `features/check-vehicle/ui` в `features/check-vehicle/model`:

```ts
import { checkVehicleSchema } from '@/features/check-vehicle/model/schema'
```

Не импортировать внутренности чужих slices, например из widget в feature model:

```ts
import { checkVehicleSchema } from '@/features/check-vehicle/model/schema'
```

## API boundaries

UI-компоненты, pages и widgets не должны импортировать Supabase client напрямую.

Правильный путь данных:

- UI вызывает feature/model/hook;
- feature вызывает wrapper в `shared/api/rpc` или собственный `api`;
- критичные операции идут через RPC;
- raw Supabase client остаётся в `shared/api/supabase`.

## Forms

Новая или изменённая форма должна использовать:

- React Hook Form;
- Zod schema;
- `@hookform/resolvers/zod`;
- shadcn/ui Form-компоненты.

Не писать inline validation в JSX, если правило можно выразить через Zod schema.

## Offline operations

Если действие может выполняться без интернета, перед кодом нужно определить:

- что сохраняется локально;
- какой `client_mutation_id` используется;
- какой `sync_status` получает запись;
- какая операция попадает в `sync_outbox`;
- как обрабатывается `CONFLICT`.

## Dependencies

Не добавлять новую production dependency без явной причины.

Перед добавлением библиотеки проверить:

- текущий стек проекта;
- `shared/ui`;
- `shared/lib`;
- shadcn/ui;
- TanStack Query;
- Zustand;
- Dexie;
- date-fns;
- стандартные Web API.

Новая зависимость допустима только если она закрывает реальную сложность и не дублирует уже выбранный стек.

## Запрещено

ИИ не должен:

- писать бизнес-логику в `pages`;
- создавать новые папки без FSD-логики;
- создавать новый UI-компонент без проверки существующих компонентов;
- копировать похожий компонент вместо расширения или композиции существующего;
- импортировать внутренности чужих slices вместо public API;
- импортировать Supabase client из UI, pages или widgets;
- делать прямой Supabase insert для заправки;
- игнорировать offline status;
- игнорировать роли;
- дублировать компоненты;
- обходить Zod;
- добавлять dependencies без причины;
- хранить service role key на клиенте.

## Нужно делать

ИИ должен:

- использовать TypeScript;
- использовать Zod;
- использовать React Hook Form;
- использовать shadcn/ui;
- соблюдать public API через `index.ts`;
- запускать `npm run check:architecture` после изменений импортов или структуры;
- писать читаемые имена;
- учитывать mobile-first;
- учитывать 3 АЗС;
- учитывать запрет повторной заправки;
- учитывать offline conflict.

## Проверка изменений

После изменения кода запускать:

- `npm run typecheck`;
- `npm run lint`;
- `npm run check:architecture`;
- `npm run test`, если менялись бизнес-логика, формы, helpers, schemas или offline sync;
- `npm run build` перед финальной проверкой крупных изменений.

## Шаблон запроса к ИИ

```text
Создай feature по FSD для [действие].
Перед кодом проверь docs/03-fsd-rules.md, docs/04-business-rules.md, docs/07-offline-sync.md.
Если задача затрагивает UI, сначала проверь существующие компоненты в shared/widgets/features/entities и переиспользуй их.
Используй public API slices через index.ts, не делай deep imports из чужих slices.
Используй React Hook Form + Zod + shadcn/ui.
Не обращайся напрямую к Supabase из UI.
Учти роли и offline sync.
После изменений запусти typecheck, lint и check:architecture.
```

## Шаблон проверки кода

```text
Проверь этот код по FSD, public API, бизнес-правилам, ролям, Supabase/RPC и offline sync.
Сначала найди нарушения, потом предложи исправления.
```
