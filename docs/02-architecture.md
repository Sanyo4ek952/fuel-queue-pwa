# 02. Архитектура и технологии

## Архитектурное решение

Проект — мобильное PWA-приложение на Vite React с FSD-архитектурой.

Backend и база — Supabase.

Frontend размещается на Vercel.

## Стек

### Frontend

- Vite
- React
- TypeScript
- React Router
- Tailwind CSS
- shadcn/ui
- React Hook Form
- Zod
- TanStack Query
- Zustand

### Backend / BaaS

- Supabase Auth
- Supabase PostgreSQL
- Supabase RPC
- Supabase RLS

### Offline

- IndexedDB
- Dexie
- Service Worker
- vite-plugin-pwa
- sync outbox

### Deploy

- Vercel для frontend;
- Supabase для Auth, DB, API.

## Почему Vite React

Vite React подходит, потому что:

- приложение внутреннее для сотрудников;
- важна скорость разработки;
- нет необходимости в SSR;
- проще offline-first;
- PWA можно настроить через `vite-plugin-pwa`.

## Почему Supabase

Supabase даёт:

- авторизацию;
- PostgreSQL;
- RLS;
- RPC;
- быстрый backend без отдельного сервера.

## Почему RPC

Критичные операции должны проверяться на сервере:

- создание записи;
- проверка допуска;
- фиксация заправки;
- создание лимита;
- ручное разрешение;
- синхронизация офлайн-операции.

## Основной поток данных

```text
React UI
  -> Feature
    -> Entity model / Zod schema
      -> shared/api/rpc
        -> Supabase RPC
          -> PostgreSQL transaction
            -> response
```

## Offline-first поток

```text
User action
  -> Zod validation
    -> local Dexie write
      -> sync_outbox
        -> UI shows PENDING
          -> internet restored
            -> sync worker
              -> Supabase RPC
                -> SYNCED or CONFLICT
```

## FSD-структура

```text
src/
  app/
  pages/
  widgets/
  features/
  entities/
  shared/
```

## Состояние

Использовать:

- TanStack Query для серверных данных;
- Zustand для UI-состояния;
- Dexie для офлайн-базы;
- React Hook Form для форм.

## Основные роуты

```text
/login
/dashboard
/check
/queue
/reservations
/limits
/fueling
/history
/reports
/users
/sync
/settings
```

## Основные риски

### Офлайн-режим

Офлайн-действие нельзя считать подтверждённым до серверной синхронизации.

### Несколько АЗС

Повторная заправка должна проверяться по всем АЗС.

### Лимиты

Создание записи только через серверную транзакцию, иначе возможны дубли и превышение лимита.
