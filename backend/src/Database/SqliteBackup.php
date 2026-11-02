<?php
declare(strict_types=1);

namespace TodoList\Database;

use RuntimeException;
use SQLite3;

final class SqliteBackup
{
    public static function copy(string $sourcePath, string $destinationPath, int $mode = 0600): void
    {
        if (!is_file($sourcePath) || is_link($sourcePath)) {
            throw new RuntimeException('The SQLite source file does not exist or is not a regular file.');
        }
        if (file_exists($destinationPath) || !is_dir(dirname($destinationPath))) {
            throw new RuntimeException('The SQLite destination already exists or its directory is unavailable.');
        }

        $source = null;
        $destination = null;
        try {
            $source = new SQLite3($sourcePath, SQLITE3_OPEN_READONLY);
            $source->busyTimeout(5000);
            $destination = new SQLite3($destinationPath, SQLITE3_OPEN_READWRITE | SQLITE3_OPEN_CREATE);
            $destination->busyTimeout(5000);

            if (!$source->backup($destination)) {
                throw new RuntimeException('SQLite Backup API could not copy the database.');
            }
            self::assertValid($destination);
        } finally {
            if ($destination instanceof SQLite3) {
                $destination->close();
            }
            if ($source instanceof SQLite3) {
                $source->close();
            }
        }

        if (!chmod($destinationPath, $mode)) {
            throw new RuntimeException('Could not set permissions on the SQLite copy.');
        }
    }

    public static function assertFileValid(string $path): void
    {
        $database = new SQLite3($path, SQLITE3_OPEN_READONLY);
        try {
            self::assertValid($database);
        } finally {
            $database->close();
        }
    }

    private static function assertValid(SQLite3 $database): void
    {
        $integrity = $database->query('PRAGMA integrity_check');
        if ($integrity === false) {
            throw new RuntimeException('SQLite integrity_check could not run.');
        }
        $row = $integrity->fetchArray(SQLITE3_NUM);
        $integrity->finalize();
        if (!is_array($row) || ($row[0] ?? null) !== 'ok') {
            throw new RuntimeException('The SQLite copy did not pass integrity_check.');
        }

        $foreignKeys = $database->query('PRAGMA foreign_key_check');
        if ($foreignKeys === false) {
            throw new RuntimeException('SQLite foreign_key_check could not run.');
        }
        $violation = $foreignKeys->fetchArray(SQLITE3_NUM);
        $foreignKeys->finalize();
        if ($violation !== false) {
            throw new RuntimeException('The SQLite copy contains a foreign-key violation.');
        }
    }
}
