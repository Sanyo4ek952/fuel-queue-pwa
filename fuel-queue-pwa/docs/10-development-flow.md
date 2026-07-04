# 10. Development Flow

## Главный принцип

Не начинать с UI.

Правильный порядок:

1. Бизнес-правило.
2. Типы.
3. Zod schema.
4. API/RPC.
5. Entity.
6. Feature.
7. Widget.
8. Page.
9. Тест/ручная проверка.

## Перед задачей

Перед новой задачей ответить:

- какая бизнес-сущность затронута;
- какой слой FSD;
- какие роли имеют доступ;
- работает ли это офлайн;
- нужна ли серверная проверка;
- какие конфликты возможны.

## Создание entity

```text
entities/reservation/
  model/
    types.ts
    constants.ts
  lib/
    is-active-reservation.ts
  ui/
    reservation-status-badge.tsx
  index.ts
```

## Создание feature

```text
features/create-reservation/
  model/
    schema.ts
    types.ts
  api/
    create-reservation.ts
  ui/
    create-reservation-form.tsx
  index.ts
```

## Создание page

Page только собирает готовые блоки.

```tsx
export function CheckVehiclePage() {
  return <VehicleCheckPanel />
}
```

## Работа с Supabase

- raw Supabase client только в `shared/api/supabase`;
- RPC wrappers в `shared/api/rpc`;
- features вызывают wrappers;
- UI не знает про устройство Supabase.

## Definition of Done

Задача готова, если:

- соблюдён FSD;
- есть типы;
- есть Zod schema, если есть форма;
- есть проверка прав;
- есть loading/error/empty;
- учтён offline status;
- нет прямых Supabase insert для критичных операций;
- не нарушены бизнес-правила.
