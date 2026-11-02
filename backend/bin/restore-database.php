<?php
declare(strict_types=1);

use TodoList\Database\SqliteBackup;

$config = require dirname(__DIR__) . '/bootstrap.php';
if ($argc !== 3 || $argv[2] !== '--confirm') {
    fwrite(STDERR, "Usage: php backend/bin/restore-database.php <backup-file> --confirm\n");
    exit(2);
}

$backupDirectory = realpath(getenv('TODO_BACKUP_DIR') ?: '/var/backups/todolist');
$backupArgument = $argv[1];
$backupPath = realpath($backupArgument);
if (
    $backupDirectory === false ||
    $backupPath === false ||
    is_link($backupArgument) ||
    dirname($backupPath) !== $backupDirectory ||
    !preg_match('/^todolist-(?:weekly-)?\d{4}-\d{2}-\d{2}\.sqlite$/D', basename($backupPath))
) {
    fwrite(STDERR, "Restore source must be a dated backup file directly inside TODO_BACKUP_DIR.\n");
    exit(1);
}

$databasePath = $config->databasePath;
$databaseDirectory = realpath(dirname($databasePath));
if (
    $databaseDirectory === false ||
    !is_file($databasePath) ||
    !is_writable($databasePath) ||
    !is_writable($databaseDirectory)
) {
    fwrite(STDERR, "The current database and its directory must exist and be writable.\n");
    exit(1);
}
if (is_file($databasePath . '-wal') || is_file($databasePath . '-shm')) {
    fwrite(STDERR, "SQLite WAL sidecars exist. Stop PHP-FPM and other database clients before restoring.\n");
    exit(1);
}

$lockPath = $backupDirectory . DIRECTORY_SEPARATOR . '.backup.lock';
$lock = fopen($lockPath, 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    fwrite(STDERR, "Another backup or restore operation is already running.\n");
    exit(1);
}
chmod($lockPath, 0600);

$temporaryPath = $databasePath . '.restore-' . bin2hex(random_bytes(8));
$preRestorePath = $backupDirectory . DIRECTORY_SEPARATOR . 'todolist-pre-restore-' . gmdate('Ymd\THis\Z') . '.sqlite';
$exitCode = 0;
try {
    SqliteBackup::assertFileValid($backupPath);
    SqliteBackup::copy($backupPath, $temporaryPath);

    $currentMode = fileperms($databasePath);
    $currentOwner = fileowner($databasePath);
    $currentGroup = filegroup($databasePath);
    if (!is_int($currentMode) || !is_int($currentOwner) || !is_int($currentGroup)) {
        if (PHP_OS_FAMILY !== 'Windows' || !is_int($currentMode)) {
            throw new RuntimeException('Could not read current database ownership and permissions.');
        }
    }
    SqliteBackup::copy($databasePath, $preRestorePath);

    $mode = $currentMode & 0777;
    if (
        !chmod($temporaryPath, $mode) ||
        (PHP_OS_FAMILY !== 'Windows' && (!chown($temporaryPath, $currentOwner) || !chgrp($temporaryPath, $currentGroup)))
    ) {
        throw new RuntimeException('Could not preserve database ownership and permissions for the restored file.');
    }

    replaceFile($temporaryPath, $databasePath);
    fwrite(STDOUT, "Database restored successfully.\n");
    fwrite(STDOUT, 'Pre-restore copy: ' . $preRestorePath . "\n");
} catch (Throwable $exception) {
    fwrite(STDERR, 'Restore failed: ' . $exception->getMessage() . "\n");
    $exitCode = 1;
} finally {
    if (is_file($temporaryPath)) {
        @unlink($temporaryPath);
    }
    flock($lock, LOCK_UN);
    fclose($lock);
}
exit($exitCode);

function replaceFile(string $source, string $destination): void
{
    if (@rename($source, $destination)) {
        return;
    }

    $displacedPath = $destination . '.displaced-' . bin2hex(random_bytes(6));
    if (!rename($destination, $displacedPath)) {
        throw new RuntimeException('Could not replace the current database file.');
    }
    if (!rename($source, $destination)) {
        @rename($displacedPath, $destination);
        throw new RuntimeException('Could not install the restored database; the previous database was put back.');
    }
    if (!unlink($displacedPath)) {
        throw new RuntimeException('The database was restored, but a displaced temporary file remains.');
    }
}
