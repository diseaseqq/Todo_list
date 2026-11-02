<?php
declare(strict_types=1);

use TodoList\Database\SqliteBackup;

$config = require dirname(__DIR__) . '/bootstrap.php';
$backupDirectory = getenv('TODO_BACKUP_DIR') ?: '/var/backups/todolist';
$resolvedDirectory = realpath($backupDirectory);
if ($resolvedDirectory === false || !is_dir($resolvedDirectory) || !is_writable($resolvedDirectory)) {
    fwrite(STDERR, "Backup directory must exist and be writable.\n");
    exit(1);
}

$lockPath = $resolvedDirectory . DIRECTORY_SEPARATOR . '.backup.lock';
$lock = fopen($lockPath, 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    fwrite(STDERR, "Another backup or restore operation is already running.\n");
    exit(1);
}
chmod($lockPath, 0600);

$temporaryFiles = [];
$exitCode = 0;
try {
    $date = gmdate('Y-m-d');
    $dailyPath = $resolvedDirectory . DIRECTORY_SEPARATOR . 'todolist-' . $date . '.sqlite';
    $dailyTemporary = temporaryPath($dailyPath);
    $temporaryFiles[] = $dailyTemporary;

    SqliteBackup::copy($config->databasePath, $dailyTemporary);
    publish($dailyTemporary, $dailyPath);
    $temporaryFiles = array_values(array_diff($temporaryFiles, [$dailyTemporary]));

    $weeklyPath = null;
    if (gmdate('N') === '7') {
        $weeklyPath = $resolvedDirectory . DIRECTORY_SEPARATOR . 'todolist-weekly-' . $date . '.sqlite';
        $weeklyTemporary = temporaryPath($weeklyPath);
        $temporaryFiles[] = $weeklyTemporary;
        SqliteBackup::copy($dailyPath, $weeklyTemporary);
        publish($weeklyTemporary, $weeklyPath);
        $temporaryFiles = array_values(array_diff($temporaryFiles, [$weeklyTemporary]));
    }

    $dailyRetained = rotate($resolvedDirectory, '/^todolist-(\d{4}-\d{2}-\d{2})\.sqlite$/D', 7);
    $weeklyRetained = rotate($resolvedDirectory, '/^todolist-weekly-(\d{4}-\d{2}-\d{2})\.sqlite$/D', 4);

    fwrite(STDOUT, 'Created ' . $dailyPath . "\n");
    if ($weeklyPath !== null) {
        fwrite(STDOUT, 'Created ' . $weeklyPath . "\n");
    }
    fwrite(STDOUT, 'Retained daily: ' . $dailyRetained . '; weekly: ' . $weeklyRetained . "\n");
} catch (Throwable $exception) {
    fwrite(STDERR, 'Backup failed: ' . $exception->getMessage() . "\n");
    $exitCode = 1;
} finally {
    foreach ($temporaryFiles as $temporaryFile) {
        if (is_file($temporaryFile)) {
            @unlink($temporaryFile);
        }
    }
    flock($lock, LOCK_UN);
    fclose($lock);
}
exit($exitCode);

function temporaryPath(string $path): string
{
    return $path . '.tmp-' . bin2hex(random_bytes(8));
}

function publish(string $temporaryPath, string $finalPath): void
{
    $previousPath = null;
    if (is_file($finalPath)) {
        $previousPath = $finalPath . '.previous-' . bin2hex(random_bytes(4));
        if (!rename($finalPath, $previousPath)) {
            throw new RuntimeException('Could not move the previous snapshot aside.');
        }
    }

    if (!rename($temporaryPath, $finalPath)) {
        if ($previousPath !== null) {
            @rename($previousPath, $finalPath);
        }
        throw new RuntimeException('Could not publish the completed SQLite snapshot.');
    }
    if ($previousPath !== null && !unlink($previousPath)) {
        throw new RuntimeException('The new snapshot is complete, but the previous same-day copy could not be removed.');
    }
}

function rotate(string $directory, string $pattern, int $keep): int
{
    $snapshots = [];
    foreach (new DirectoryIterator($directory) as $entry) {
        if (!$entry->isFile() || $entry->isLink() || !preg_match($pattern, $entry->getFilename(), $matches)) {
            continue;
        }
        SqliteBackup::assertFileValid($entry->getPathname());
        $snapshots[] = ['path' => $entry->getPathname(), 'date' => $matches[1]];
    }

    usort($snapshots, static fn (array $left, array $right): int => strcmp($right['date'], $left['date']));
    foreach (array_slice($snapshots, $keep) as $expired) {
        if (!unlink($expired['path'])) {
            throw new RuntimeException('Could not rotate an expired backup snapshot.');
        }
    }

    return min(count($snapshots), $keep);
}
