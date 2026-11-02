# Развёртывание на VPS по IP с HTTPS

Инструкция подготовлена для Ubuntu 24.04, Nginx, PHP 8.3-FPM и постоянного публичного IP `132.243.19.228`. Она описывает конфигурацию; команды установки и настройки на VPS здесь не запускались.

## Важные условия

- Для IP-адресов Let's Encrypt выдаёт только короткоживущие сертификаты профиля `shortlived`: срок действия — 160 часов. Автообновление и перезагрузка Nginx после успешного обновления обязательны.
- Нужен Certbot 5.4 или новее. Пакет Ubuntu 24.04 `certbot` версии 2.9.0 для этого не подходит. В Certbot IP-сертификаты выпускаются через `webroot`, `manual` или `standalone`; плагин Nginx пока не умеет устанавливать IP-сертификат автоматически.
- Для проверки владения IP через HTTP-01 сервер должен принимать внешние запросы на порт 80. Порт 443 нужен пользователям приложения.
- Учётная запись администратора на VPS уже создана. Повторно `create-admin.php` не запускайте.
- Резервное копирование SQLite настраивается отдельно по [инструкции backup и restore](BACKUP_AND_RESTORE.md) и должно быть проверено до реальной эксплуатации.

## 1. Установить runtime и подготовить каталоги

Проверьте актуальные версии и установите PHP CLI/FPM с модулями приложения:

```bash
sudo apt update
apt policy php8.3-cli php8.3-fpm php8.3-sqlite3 php8.3-mbstring
sudo apt install php8.3-cli php8.3-fpm php8.3-sqlite3 php8.3-mbstring
sudo systemctl enable --now php8.3-fpm
php -m | grep -E '^(PDO|pdo_sqlite|sqlite3|mbstring)$'
sudo systemctl is-active nginx php8.3-fpm
```

Пользователь `www-data` должен читать код, но не менять его. Каталог базы должен быть доступен PHP-FPM для записи:

```bash
sudo chown -R root:www-data /var/www/todo-list
sudo find /var/www/todo-list -type d -exec chmod 0750 {} +
sudo find /var/www/todo-list -type f -exec chmod 0640 {} +
sudo install -d -o www-data -g www-data -m 0750 /var/lib/todolist
sudo install -d -o root -g root -m 0700 /var/backups/todolist
```

Проверьте, что checkout приложения находится в `/var/www/todo-list`, а entry point — `/var/www/todo-list/public/index.php`.

## 2. Передать настройки PHP-FPM

CLI-команды получают переменные из shell, но PHP-FPM должен получить их отдельно. В секции `[www]` файла `/etc/php/8.3/fpm/pool.d/www.conf` добавьте или обновите:

```ini
env[TODO_ENV] = production
env[TODO_DB_PATH] = /var/lib/todolist/app.sqlite
```

Примените конфигурацию и проверьте её:

```bash
sudo php-fpm8.3 -t
sudo systemctl reload php8.3-fpm
```

## 3. Сначала включить HTTP для ACME-проверки

Создайте временный Nginx server block для IP. В примере ниже `root` специально указывает на публичный каталог проекта: Certbot положит HTTP-01 challenge в `.well-known/acme-challenge/`.

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 132.243.19.228;

    root /var/www/todo-list/public;

    location ^~ /.well-known/acme-challenge/ {
        try_files $uri =404;
    }

    location / {
        return 404;
    }
}
```

Сохраните файл как `/etc/nginx/sites-available/todolist`, включите его через ссылку в `sites-enabled`, отключите конфликтующий `default` site при необходимости и примените только после успешной проверки:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Проверьте извне, что challenge-файл доступен по `http://132.243.19.228/.well-known/acme-challenge/<имя>`. Не переходите к выпуску сертификата, пока этот адрес недоступен из интернета.

## 4. Установить поддерживаемый Certbot и проверить выпуск

Если установлен пакет `certbot` из APT, удалите именно его, чтобы команда `certbot` не запускала старую версию. Затем установите Certbot из Snap:

```bash
sudo apt remove certbot
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/local/bin/certbot
certbot --version
```

Выпустите отдельный staging-сертификат для проверки пути. Он не доверенный браузером и не должен использоваться в production:

```bash
sudo certbot certonly --staging \
  --preferred-profile shortlived \
  --webroot --webroot-path /var/www/todo-list/public \
  --ip-address 132.243.19.228 \
  --cert-name 132.243.19.228-staging
```

Если проверка прошла, запросите production-сертификат под отдельным именем:

```bash
sudo certbot certonly \
  --preferred-profile shortlived \
  --webroot --webroot-path /var/www/todo-list/public \
  --ip-address 132.243.19.228 \
  --cert-name 132.243.19.228
```

## 5. Включить HTTPS в Nginx

Замените временный server block конфигурацией ниже. PHP-запросы разрешены только для `index.php`; остальные PHP-файлы извне не исполняются. `HTTPS on` нужен приложению для проверки secure-сессии за PHP-FPM.

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 132.243.19.228;
    root /var/www/todo-list/public;

    location ^~ /.well-known/acme-challenge/ {
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name 132.243.19.228;
    root /var/www/todo-list/public;

    ssl_certificate /etc/letsencrypt/live/132.243.19.228/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/132.243.19.228/privkey.pem;

    location ^~ /.well-known/acme-challenge/ {
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /index.php {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_param HTTPS on;
    }

    location ~ \.php$ {
        return 404;
    }

    location ~ /\. {
        deny all;
    }
}
```

Проверьте и примените:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Обновлять сертификат автоматически

Создайте Certbot deploy-hook, чтобы Nginx перечитывал сертификат только после успешного обновления:

```bash
sudo install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/20-reload-nginx >/dev/null <<'EOF'
#!/bin/sh
set -eu
/usr/bin/systemctl reload nginx
EOF
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/20-reload-nginx
```

Убедитесь, что Snap настроил автоматический timer обновления, и выполните пробный запуск с deploy-hook:

```bash
sudo systemctl list-timers --all | grep -i certbot
sudo certbot renew --dry-run --run-deploy-hooks
```

Проверьте срок выданного сертификата и доступность приложения:

```bash
sudo certbot certificates
curl -I http://132.243.19.228/
curl -i https://132.243.19.228/api/health
```

Ожидается перенаправление HTTP на HTTPS и успешный JSON-ответ `GET /api/health`. После этого вход в приложение должен открываться только через `https://132.243.19.228`.

## 7. Проверить приложение и базу

После доставки кода примените миграции и проверьте базу. Администратор уже создан, поэтому не запускайте bootstrap создания аккаунта повторно:

```bash
cd /var/www/todo-list
sudo -u www-data bash -c '
  umask 027
  export TODO_ENV=production
  export TODO_DB_PATH=/var/lib/todolist/app.sqlite
  php backend/bin/migrate.php
  php backend/bin/check-database.php
'
```

Установите и включите ежедневное резервирование из репозитория:

```bash
sudo install -o root -g root -m 0644 deploy/systemd/todolist-backup.service /etc/systemd/system/todolist-backup.service
sudo install -o root -g root -m 0644 deploy/systemd/todolist-backup.timer /etc/systemd/system/todolist-backup.timer
sudo systemctl daemon-reload
sudo systemd-analyze calendar '*-*-* 03:00:00 UTC'
sudo systemctl enable --now todolist-backup.timer
sudo systemctl start todolist-backup.service
sudo journalctl -u todolist-backup.service -n 50 --no-pager
```

Проверьте вход, создание задачи, выход и отказ защищённого API для пользователя без сессии. До реальной эксплуатации выполните квартальную проверку восстановления по [инструкции backup и restore](BACKUP_AND_RESTORE.md), а также подтвердите, что renewal timer и reload Nginx работают.

## Источники

- [Let's Encrypt: IP-адресные сертификаты и шестидневный профиль](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)
- [Let's Encrypt: Certbot 5.4+, webroot и ограничения Nginx-плагина для IP-сертификатов](https://letsencrypt.org/2026/03/11/shorter-certs-certbot.html)
- [Certbot: установка Snap и проверка обновления](https://certbot.eff.org/instructions?os=snap&ws=nginx)
