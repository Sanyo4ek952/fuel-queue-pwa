# 00. Индекс документации

## Основные файлы

1. [01-product-requirements.md](01-product-requirements.md) — продуктовое ТЗ.
2. [02-architecture.md](02-architecture.md) — архитектура и технологии.
3. [03-fsd-rules.md](03-fsd-rules.md) — правила FSD.
4. [04-business-rules.md](04-business-rules.md) — бизнес-правила.
5. [05-database-schema.md](05-database-schema.md) — схема базы данных.
6. [06-roles-and-permissions.md](06-roles-and-permissions.md) — роли и права.
7. [07-offline-sync.md](07-offline-sync.md) — офлайн-режим и синхронизация.
8. [08-ui-guidelines.md](08-ui-guidelines.md) — правила интерфейса.
9. [09-mvp-backlog.md](09-mvp-backlog.md) — backlog MVP.
10. [10-development-flow.md](10-development-flow.md) — процесс разработки.
11. [11-supabase-rls-rpc.md](11-supabase-rls-rpc.md) — Supabase, RLS и RPC.
12. [12-testing-and-quality.md](12-testing-and-quality.md) — тестирование и качество.
13. [13-deployment-and-env.md](13-deployment-and-env.md) — деплой и env.
14. [14-ai-working-rules.md](14-ai-working-rules.md) — правила работы с ИИ.
15. [yandex-auth-setup.md](yandex-auth-setup.md) — ручная настройка входа через Яндекс ID.
16. [99-final-checklist.md](99-final-checklist.md) — финальный чеклист.

## Читать в первую очередь

- `AGENTS.md`
- `docs/02-architecture.md`
- `docs/03-fsd-rules.md`
- `docs/04-business-rules.md`
- `docs/07-offline-sync.md`
- `docs/09-mvp-backlog.md`

## Главный риск проекта

Самая сложная часть — полноценный офлайн-режим с синхронизацией.

Нужны:

- локальная база IndexedDB;
- очередь операций;
- `client_mutation_id`;
- серверная проверка;
- статусы синхронизации;
- обработка конфликтов.
