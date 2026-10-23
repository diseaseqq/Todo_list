<?php
declare(strict_types=1);

namespace TodoList\Database;

use PDO;
use RuntimeException;

final class SqliteConnection
{
    public static function connect(string $databasePath): PDO
    {
        if (!extension_loaded('pdo_sqlite')) {
            throw new RuntimeException('The PDO_SQLITE extension is not available.');
        }

        $directory = dirname($databasePath);
        if (!is_dir($directory) || !is_writable($directory)) {
            throw new RuntimeException('The configured SQLite directory is unavailable.');
        }

        $pdo = new PDO('sqlite:' . $databasePath, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);

        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA busy_timeout = 5000');

        return $pdo;
    }
}
