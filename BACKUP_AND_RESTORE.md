# Резервное копирование и восстановление SQLite

Для рабочей базы используется SQLite Backup API через `SQLite3::backup()`. Он создаёт согласованный снимок открытой базы и учитывает WAL; обычное копирование активного `.sqlite` файла не используется. Каждый снимок дополнительно проходит `PRAGMA integrity_check` и `PRAGMA foreign_key_check`.

## Расписание и хранение

- Каждый день в 03:00 UTC создаётся `todolist-YYYY-MM-DD.sqlite`.
- По воскресеньям из дневного снимка создаётся отдельная недельная копия `todolist-weekly-YYYY-MM-DD.sqlite`.
- Хранятся 7 последних ежедневных и 4 последних еженедельных снимка. Ротация удаляет только файлы этих двух форматов в каталоге backup; пользовательская база и данные приложения не очищаются.
- Снимки и каталог доступны только root (`0700` для каталога, `0600` для файлов). Каталог находится вне web-root.
- Операции резервирования и восстановления используют общий lock-файл, чтобы не выполняться одновременно.

## Установка на VPS

Из корня проекта установите systemd unit-файлы:

```bash
sudo install -o root -g root -m 0644 deploy/systemd/todolist-backup.service /etc/systemd/system/todolist-backup.service
sudo install -o root -g root -m 0644 deploy/systemd/todolist-backup.timer /etc/systemd/system/todolist-backup.timer
sudo systemctl daemon-reload
sudo systemd-analyze calendar '*-*-* 03:00:00 UTC'
sudo systemctl enable --now todolist-backup.timer
```

Выполните первый снимок вручную и убедитесь, что сервис завершился успешно:

```bash
sudo systemctl start todolist-backup.service
sudo systemctl status todolist-backup.service --no-pager
sudo journalctl -u todolist-backup.service -n 50 --no-pager
sudo systemctl list-timers todolist-backup.timer
sudo ls -l /var/backups/todolist
```

Не продолжайте эксплуатацию, если снимок не создан или `integrity_check`/`foreign_key_check` завершились ошибкой.

## Восстановление рабочей базы

Восстановление требует короткого обслуживания. Остановите PHP-FPM и таймер, чтобы приложение и планировщик не держали базу открытой:

```bash
sudo systemctl stop todolist-backup.timer php8.3-fpm
```

Выберите нужный dated snapshot и выполните команду от root. Аргумент `--confirm` обязателен. Скрипт проверяет файл до восстановления, сохраняет текущую базу отдельным файлом `todolist-pre-restore-<UTC-время>.sqlite`, сохраняет владельца и права текущего файла, затем устанавливает снимок. Восстановление не запускает миграции и не удаляет pre-restore копию.

```bash
cd /var/www/todo-list
sudo env TODO_ENV=production \
  TODO_DB_PATH=/var/lib/todolist/app.sqlite \
  TODO_BACKUP_DIR=/var/backups/todolist \
  php backend/bin/restore-database.php \
  /var/backups/todolist/todolist-YYYY-MM-DD.sqlite --confirm
```

После успешного восстановления проверьте базу и снова включите приложение и timer:

```bash
sudo -u www-data env TODO_ENV=production \
  TODO_DB_PATH=/var/lib/todolist/app.sqlite \
  php backend/bin/check-database.php
sudo systemctl start php8.3-fpm
sudo systemctl start todolist-backup.timer
```

Если restore сообщает об оставшихся `-wal`/`-shm` файлах, не удаляйте их вручную: проверьте, что все процессы приложения остановлены, и разберитесь с состоянием SQLite перед повтором.

## Квартальная проверка восстановления

Не реже раза в квартал используйте отдельный тестовый путь, не `app.sqlite`:

1. Создайте пустую тестовую SQLite-базу, задав `TODO_ENV=test` и временный абсолютный `TODO_DB_PATH` вне `public`, затем запустите `php backend/bin/migrate.php` от владельца тестового файла.
2. Остановите или исключите любые процессы, которые используют именно эту тестовую базу.
3. Запустите `restore-database.php` с `TODO_DB_PATH`, указывающим на тестовую базу, и выбранным production backup-файлом:

   ```bash
   sudo env TODO_ENV=test \
     TODO_DB_PATH=/var/lib/todolist/restore-check.sqlite \
     TODO_BACKUP_DIR=/var/backups/todolist \
     php /var/www/todo-list/backend/bin/restore-database.php \
     /var/backups/todolist/todolist-YYYY-MM-DD.sqlite --confirm
   ```

4. Запустите `check-database.php` для тестового пути и убедитесь, что восстановленные таблицы и записи доступны.
5. Зафиксируйте дату, имя снимка и результат проверки. Удаляйте временную тестовую базу только после проверки и отдельного подтверждения, что она больше не нужна.

Тест восстановления проверяет, что файл можно открыть, что целостность и внешние ключи проходят проверку, а структура совместима с текущими миграциями. Не запускайте миграции на рабочей базе в рамках квартального теста.

## Ограничения

Ежедневные и еженедельные копии находятся на том же VPS, что и база, и защищают от ошибок приложения и части операционных ошибок, но не от потери самого VPS или диска. Для аварийного восстановления после потери сервера потребуется отдельно утвердить и настроить копирование за пределы этого VPS.

Файлы `todolist-pre-restore-*.sqlite` сохраняются отдельно и не попадают в ежедневную ротацию; перед восстановлением проверьте свободное место, а старые pre-restore копии удаляйте вручную после проверки и отдельного решения.

Техническая основа — [SQLite Online Backup API](https://www.sqlite.org/backup.html) и [PHP `SQLite3::backup()`](https://www.php.net/manual/en/sqlite3.backup.php).
