# 09. MVP Backlog

## Этап 0. Документация

- [x] Product requirements
- [x] Architecture
- [x] FSD rules
- [x] Business rules
- [x] Database schema
- [x] Roles and permissions
- [x] Offline sync rules
- [x] UI guidelines
- [x] Development flow
- [x] AI working rules

## Этап 1. Инициализация проекта

- [ ] Создать Vite React проект
- [ ] Подключить TypeScript
- [ ] Настроить path aliases
- [ ] Настроить ESLint
- [ ] Настроить Prettier
- [ ] Подключить Tailwind CSS
- [ ] Подключить shadcn/ui
- [ ] Подключить React Router
- [ ] Подключить TanStack Query
- [ ] Подключить Zustand
- [ ] Подключить vite-plugin-pwa
- [ ] Создать FSD-структуру

## Этап 2. Supabase

- [ ] Создать Supabase проект
- [ ] Настроить Supabase Auth
- [ ] Создать таблицы
- [ ] Создать индексы
- [ ] Настроить RLS
- [ ] Создать seed для 3 АЗС
- [ ] Создать роли
- [ ] Создать первого admin пользователя

## Этап 3. Auth

- [ ] Страница входа
- [ ] Supabase login
- [ ] Получение profile
- [ ] Role guard
- [ ] Station access guard
- [ ] Logout
- [ ] Защищённые роуты

## Этап 4. Shared UI и layout

- [ ] App layout
- [ ] Bottom navigation
- [ ] Header
- [ ] Offline banner
- [ ] Sync status indicator
- [ ] Loading state
- [ ] Error state
- [ ] Empty state

## Этап 5. Entities

- [ ] profile
- [ ] station
- [ ] vehicle
- [ ] driver
- [ ] reservation
- [ ] queue-entry
- [ ] fueling-record
- [ ] daily-limit
- [ ] fuel-type
- [ ] sync-operation

## Этап 6. Лимиты

- [ ] Страница лимитов
- [ ] Форма создания лимита
- [ ] Валидация Zod
- [ ] RPC create_daily_limit
- [ ] Просмотр лимитов
- [ ] Проверка остатка мест
- [ ] Редактирование лимита

## Этап 7. Запись на дату

- [ ] Страница записи
- [ ] Дата по умолчанию: завтра
- [ ] Выбор АЗС
- [ ] Форма записи
- [ ] Нормализация госномера
- [ ] Проверка дублей
- [ ] RPC create_reservation
- [ ] Вывод номера записи
- [ ] Список записей

## Этап 8. Проверка авто

- [ ] Страница проверки
- [ ] Ввод госномера
- [ ] Нормализация
- [ ] RPC check_vehicle_access
- [ ] Статус ALLOWED
- [ ] Статус BLOCKED
- [ ] Статус WARNING
- [ ] Показ причины

## Этап 9. Фиксация заправки

- [ ] Страница заправки
- [ ] Проверка госномера
- [ ] Форма фактических литров
- [ ] RPC create_fueling_record
- [ ] Закрытие записи
- [ ] Запрет повторной заправки
- [ ] История заправки

## Этап 10. Offline

- [ ] Подключить Dexie
- [ ] Создать локальные таблицы
- [ ] Создать sync_outbox
- [ ] Сохранять offline операции
- [ ] Показ PENDING
- [ ] Синхронизация
- [ ] Обработка FAILED
- [ ] Обработка CONFLICT

## Этап 11. Отчёты и админка

- [ ] Отчёт за день
- [ ] Данные по 3 АЗС
- [ ] Пользователи
- [ ] Роли
- [ ] Доступы к АЗС
- [ ] Ручные разрешения
- [ ] Audit log
- [ ] Конфликты синхронизации
