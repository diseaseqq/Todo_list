# Создание первого аккаунта администратора

Команда создаёт единственный аккаунт с ролью `admin` и шесть стандартных категорий. Пароль не передаётся в аргументах команды, не записывается в конфигурацию и хранится только в виде хеша. Роль администратора пока не даёт дополнительных прав.

## Локальный запуск в Windows

Откройте PowerShell в корне проекта. Если PHP только что установлен, перезапустите терминал. Затем выполните:

```powershell
$env:TODO_ENV = 'development'
php backend/bin/migrate.php
php backend/bin/check-database.php
php backend/bin/create-admin.php
```

Команда интерактивно запросит email, пароль и повтор пароля. Email проверяется и сохраняется в нижнем регистре. Пароль должен содержать не менее 12 символов и не более 72 байт. На Windows символы пароля при вводе могут отображаться в терминале.

Локальная база создаётся в `storage/app.sqlite`. Этот аккаунт находится только в локальной базе; он не появится на VPS автоматически.

## Создание аккаунта на VPS

Сначала подготовьте сервер. По последним сведениям Ubuntu 24.04 amd64 PHP CLI, FPM, SQLite и mbstring доступны в репозиториях Ubuntu; Nginx уже установлен и работает. Проверьте кандидатов APT и установите нужные пакеты:

```bash
sudo apt update
apt policy php8.3-cli php8.3-fpm php8.3-sqlite3 php8.3-mbstring
sudo apt install php8.3-cli php8.3-fpm php8.3-sqlite3 php8.3-mbstring
```

Это штатные пакеты PHP 8.3 для Ubuntu 24.04 ([CLI](https://packages.ubuntu.com/noble/php8.3-cli), [FPM](https://packages.ubuntu.com/noble/any/php8.3-fpm), [SQLite](https://packages.ubuntu.com/noble/php8.3-sqlite3), [mbstring](https://packages.ubuntu.com/noble/php/php8.3-mbstring)). Устанавливайте обновления из APT; перед установкой сверяйте актуальную версию через `apt policy`.

Включите PHP-FPM и проверьте модули CLI:

```bash
sudo systemctl enable --now php8.3-fpm
php -v
php -m | grep -E '^(PDO|pdo_sqlite|sqlite3|mbstring)$'
systemctl is-active nginx
systemctl is-active php8.3-fpm
ls -l /run/php/php8.3-fpm.sock
```

В выводе PHP должны присутствовать `PDO`, `pdo_sqlite`, `sqlite3` и `mbstring`; обе службы должны показать `active`. Nginx должен передавать PHP-запросы в `/run/php/php8.3-fpm.sock`. Если конфигурация Nginx ещё не настроена, сначала подготовьте её, проверьте `sudo nginx -t`, затем примените; не перезапускайте Nginx с непроверенной конфигурацией.

Создайте каталоги для базы и резервных копий с ограниченными правами и разместите код приложения в `/var/www/todo-list`:

```bash
sudo install -d -o www-data -g www-data -m 0750 /var/lib/todolist
sudo install -d -o root -g root -m 0700 /var/backups/todolist
```

Если PHP CLI или FPM ещё не установлены, пакеты выше подготовят runtime, но сами по себе не публикуют приложение и не настраивают TLS. Первый аккаунт создаётся после размещения кода и подготовки каталога базы. По сообщению владельца проекта, аккаунт администратора на VPS уже создан; этот раздел остаётся инструкцией для повторного развёртывания.

Войдите на сервер по SSH и выполните:

```bash
cd /var/www/todo-list
sudo -u www-data bash -c '
  umask 027
  export TODO_ENV=production
  export TODO_DB_PATH=/var/lib/todolist/app.sqlite
  php backend/bin/migrate.php
  php backend/bin/check-database.php
  php backend/bin/create-admin.php
'
```

Команды запускаются от `www-data`, чтобы файл БД создавался с владельцем веб-процесса; `umask 027` ограничивает права на новый файл. На сервере пароль вводится без отображения символов. Не вставляйте его в команду, не сохраняйте в `.env`, Git или переписке.

## Повторный запуск

Миграции можно запускать повторно: уже применённые версии пропускаются. Если аккаунт `admin` уже существует, команда создания завершится без изменений. Для создания второго администратора эта команда не предназначена.
