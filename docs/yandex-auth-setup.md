# Yandex ID auth setup

Yandex ID используется только для жителей (`consumer`). Сотрудники продолжают входить через рабочий email и пароль в Supabase Auth.

## Supabase

1. В Supabase Dashboard создайте Custom OAuth Provider:

```text
Identifier: custom:yandex
Authorization URL: https://oauth.yandex.ru/authorize
Token URL: https://oauth.yandex.ru/token
UserInfo URL: https://<project-ref>.supabase.co/functions/v1/yandex-userinfo
Scopes: login:info login:email
```

2. Добавьте redirect URL для локальной разработки:

```text
http://localhost:5173/auth/callback
```

3. Добавьте production redirect URL:

```text
https://<production-domain>/auth/callback
```

4. Во frontend env можно хранить только публичные значения:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Нельзя хранить во frontend env:

- Yandex Client Secret;
- Supabase service role key;
- любые private keys;
- OAuth client secrets.

## Yandex OAuth

В кабинете Яндекса укажите callback/redirect URL, который ожидает Supabase Custom OAuth Provider:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Точный URL берите из настроек Custom OAuth Provider в Supabase Dashboard.

## Проверка localhost

1. Запустите приложение локально.
2. Откройте `/login`.
3. Нажмите `Войти через Яндекс ID`.
4. После возврата на `/auth/callback` новый пользователь должен получить профиль `consumer`.
5. Если в профиле не хватает имени, фамилии или телефона, приложение перенаправит на `/profile/setup`.

## Проверка production

1. Убедитесь, что production domain добавлен в Supabase redirect URLs.
2. Убедитесь, что Yandex OAuth использует Supabase Auth callback.
3. Проверьте вход новым Yandex-пользователем без staff-профиля.
4. Проверьте, что в `auth.users` появилась identity `custom:yandex` или `yandex`.
5. Проверьте, что в `profiles.auth_user_id` используется `auth.users.id`, а роль равна `consumer`.

## Automatic identity linking

Supabase может привязать Yandex identity к существующему пользователю, если provider возвращает email, совпадающий с email существующего аккаунта. Это отдельный сценарий безопасности.

Правило проекта:

- Yandex ID разрешён только для `consumer`;
- если Yandex identity привязалась к существующему профилю сотрудника (`mayor`, `station_manager`, `cashier`, `mayor_assistant`), callback завершает сессию и возвращает пользователя на `/login`;
- роль staff-профиля нельзя автоматически менять на `consumer`;
- `handle_new_auth_user()` не является единственной защитой, потому что при linking новая строка `auth.users` может не создаваться.

Для привилегированных ролей (`mayor`, `station_manager`, `cashier`, `mayor_assistant`) MFA/AAL2 не требуется: вход выполняется по рабочему email и паролю.

## Yandex UserInfo

Yandex может возвращать email как `default_email`, а идентификатор пользователя как `id`. Проект использует:

- `auth.users.id` как основной внутренний идентификатор;
- `new.email`, затем `raw_user_meta_data.email`, затем `raw_user_meta_data.default_email` как email fallback;
- `first_name`, `last_name`, `display_name`, `real_name`, `name` только для предварительного заполнения профиля.

Роль нельзя брать из `user_metadata`, query params или frontend.

Supabase Custom OAuth должен обращаться к серверному адаптеру UserInfo:

```text
https://<project-ref>.supabase.co/functions/v1/yandex-userinfo
```

Edge Function `yandex-userinfo` принимает Yandex access token только из заголовка:

```text
Authorization: Bearer <YANDEX_ACCESS_TOKEN>
```

Передавать `access_token` в query-параметрах URL нельзя: такой запрос должен отклоняться и не отправляться в Yandex UserInfo.

## Ограничения

- Yandex metadata используется только как предварительное заполнение профиля.
- Email может отсутствовать.
- Реальные поля `user_metadata` и `identities` нужно подтвердить ручным OAuth-прогоном после настройки provider credentials.
- Если прямой `custom:yandex` окажется несовместим с форматом Yandex UserInfo в Supabase Custom OAuth, нужен минимальный серверный адаптер для нормализации UserInfo перед Supabase.
