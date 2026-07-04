# 03. FSD Rules

## Цель

FSD нужен, чтобы проект не превратился в хаотичную папку компонентов.

## Слои

```text
app
pages
widgets
features
entities
shared
```

## Направление импортов

Разрешено только сверху вниз:

```text
app -> pages -> widgets -> features -> entities -> shared
```

Запрещено импортировать верхние слои в нижние.

## app

Содержит:

- провайдеры;
- роутер;
- глобальные стили;
- инициализацию приложения;
- PWA setup;
- Supabase session provider;
- sync provider.

## pages

Страница:

- собирает widgets/features;
- не содержит сложной бизнес-логики;
- не обращается напрямую к Supabase;
- не содержит больших форм внутри себя.

## widgets

Крупные блоки интерфейса:

- `vehicle-check-panel`;
- `reservation-list`;
- `queue-list`;
- `daily-limit-summary`;
- `sync-status-panel`;
- `bottom-navigation`.

## features

Действия пользователя:

- `check-vehicle`;
- `create-reservation`;
- `create-fueling-record`;
- `create-daily-limit`;
- `create-manual-override`;
- `sync-offline-operations`.

Feature может содержать:

```text
model/
api/
ui/
lib/
index.ts
```

## entities

Бизнес-сущности:

- `vehicle`;
- `driver`;
- `reservation`;
- `queue-entry`;
- `fueling-record`;
- `daily-limit`;
- `station`;
- `profile`.

## shared

Общее переиспользуемое:

- базовые UI-компоненты;
- Supabase client;
- helpers;
- config;
- constants;
- общие типы;
- date utils;
- plate-number utils;
- offline-db.

## Рекомендуемая структура

```text
src/
  app/
    providers/
    router/
    styles/
    App.tsx

  pages/
    login/
    dashboard/
    check-vehicle/
    today-queue/
    reservations/
    daily-limits/
    fueling/
    history/
    reports/
    users/
    sync-status/
    settings/

  widgets/
    app-header/
    bottom-navigation/
    offline-banner/
    sync-status-panel/
    vehicle-check-panel/
    reservation-list/
    queue-list/
    daily-limit-summary/
    fueling-form-panel/
    report-summary/
    role-guard/

  features/
    auth-by-login/
    logout/
    check-vehicle/
    create-reservation/
    cancel-reservation/
    update-reservation-status/
    create-queue-entry/
    update-queue-status/
    create-fueling-record/
    create-refusal-record/
    create-daily-limit/
    update-daily-limit/
    create-manual-override/
    sync-offline-operations/
    manage-user-role/
    select-station/
    normalize-plate-number/

  entities/
    profile/
    station/
    vehicle/
    driver/
    reservation/
    queue-entry/
    fueling-record/
    refusal-record/
    daily-limit/
    fuel-type/
    manual-override/
    audit-log/
    sync-operation/

  shared/
    api/
    config/
    lib/
    ui/
    types/
    constants/
```

## Public API

Каждый slice экспортирует наружу только через `index.ts`.

Плохо:

```ts
import { something } from '@/features/create-reservation/model/store'
```

Хорошо:

```ts
import { CreateReservationForm } from '@/features/create-reservation'
```

## Supabase

Supabase client хранить только в:

```text
shared/api/supabase/
```

RPC wrappers хранить в:

```text
shared/api/rpc/
```

Features используют wrappers, а не raw Supabase client.
