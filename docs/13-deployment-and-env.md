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

## Аварийная выгрузка очереди

Если PWA не открывается, актуальный резервный список очереди нужно скачивать не из приложения, а из Google Drive.

Настройка:

1. Создать Google Drive папку для резервных файлов, например `АЗС backups`.
2. Создать Google service account и дать его email доступ на запись в эту папку.
3. Добавить в Vercel server-only переменные:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
GOOGLE_DRIVE_FOLDER_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
```

Vercel Cron вызывает `/api/cron/backup-queue` каждый день в `00:05` по Москве (`21:05 UTC`).
Файл сохраняется как `azs-queue-backup-YYYY-MM-DD.csv`, открывается в Excel и содержит активную очередь за дату выгрузки.
Система хранит последние 10 ежедневных файлов, старые удаляет автоматически.

Для ручной проверки после деплоя нужно вызывать endpoint только через `Authorization: Bearer`:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-domain>/api/cron/backup-queue
```

В нормальной эксплуатации скачивать файл нужно напрямую из Google Drive папки.

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

Temporary PWA recovery note:

- After deploy, clear old service worker/site data on affected devices, or open Chrome DevTools -> Application -> Service Workers -> Unregister.
- If the recovery screen appears, press "Обновить приложение" to unregister the old service worker, clear app caches, and reload without deleting offline IndexedDB data.

## Hosted Supabase test data

Для тестового hosted-проекта без очистки базы можно выполнить SQL-скрипт:

```text
supabase/hosted-test-data.sql
```

Скрипт также приводит старую hosted-схему ролей к текущей модели приложения (`mayor`, `station_manager`, `cashier`, `mayor_assistant`), если последняя role-migration ещё не была применена.

Порядок:

1. Применить все миграции Supabase.
2. Открыть Supabase Dashboard -> SQL Editor.
3. Выполнить содержимое `supabase/hosted-test-data.sql`.
4. Проверить финальную строку результата: `hosted-test-data-ready`.

Скрипт не делает reset удаленной БД. Если на текущую или завтрашнюю дату уже есть не-seed записи по тестовым АЗС, он остановится с ошибкой.

Тестовые пользователи, пароль для всех: `password123`.

```text
mayor@example.local
station-manager@example.local
station-manager-2@example.local
cashier@example.local
cashier-2@example.local
mayor-assistant@example.local
pending-cashier@example.local
rejected-cashier@example.local
```

Быстрые проверки номеров на текущую дату:

```text
A111AA777 -> ALLOWED на АТАН АЗС №076 (нижняя)
A222AA777 -> RESERVATION_AT_OTHER_STATION на АТАН АЗС №076 (нижняя), ALLOWED на АТАН АЗС №077 (верхняя)
A333AA777 -> ALREADY_FUELED
A444AA777 -> VEHICLE_BLOCKED
A555AA777 -> NO_ACTIVE_RESERVATION
A666AA777 -> MANUAL_OVERRIDE_ACTIVE на АТАН АЗС №076 (нижняя)
A777AA777 -> LITERS_LIMIT_EXCEEDED на АТАН АЗС №076 (нижняя)
```

Ограничение: скрипт рассчитан на безопасное первичное заполнение hosted-теста. После ручной фиксации заправок через UI повторный запуск может остановиться защитной проверкой, чтобы не перезаписать пользовательские тестовые действия.

## Package manager

Use npm only. The repository keeps `package-lock.json` and `package.json#packageManager`; Vercel must install dependencies with npm based on those files. Do not commit `pnpm-lock.yaml`.
