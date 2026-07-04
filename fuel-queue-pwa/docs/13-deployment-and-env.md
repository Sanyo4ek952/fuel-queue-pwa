# 13. Deployment and Environment

## Деплой

Frontend размещается на Vercel.

Supabase используется для:

- Auth;
- PostgreSQL;
- RPC;
- RLS.

## Переменные окружения

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_APP_ENV=development
VITE_APP_VERSION=0.1.0
```

Service role key нельзя хранить на клиенте.

## Environments

Желательно иметь:

- local;
- staging;
- production.

Для MVP можно начать с:

- local;
- production.

## PWA

Нужно настроить:

- manifest;
- name;
- short_name;
- icons;
- theme_color;
- background_color;
- display standalone;
- service worker.

## Supabase migrations

Хранить SQL миграции в проекте:

```text
supabase/
  migrations/
  seed.sql
```

## Безопасность

- Не коммитить `.env`.
- Коммитить `.env.example`.
- Не хранить пароли в коде.
- Не отключать RLS в production.
- Не использовать service role key на frontend.

## Перед production

Проверить:

- RLS включён;
- роли работают;
- 3 АЗС созданы;
- админ создан;
- PWA устанавливается;
- offline banner работает;
- sync outbox работает;
- отчёты корректны;
- повторная заправка запрещена по всем АЗС.
