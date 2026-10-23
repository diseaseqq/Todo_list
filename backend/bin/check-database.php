<?php
declare(strict_types=1);

use TodoList\Database\SqliteConnection;

$config = require dirname(__DIR__) . '/bootstrap.php';
$pdo = SqliteConnection::connect($config->databasePath);

$integrity = $pdo->query('PRAGMA integrity_check')->fetchAll(PDO::FETCH_COLUMN);
$foreignKeys = $pdo->query('PRAGMA foreign_key_check')->fetchAll(PDO::FETCH_ASSOC);

if ($integrity !== ['ok'] || $foreignKeys !== []) {
    fwrite(STDERR, "Database integrity check failed.\n");
    if ($integrity !== ['ok']) {
        fwrite(STDERR, "SQLite integrity_check reported: " . implode('; ', $integrity) . "\n");
    }
    if ($foreignKeys !== []) {
        fwrite(STDERR, "SQLite foreign_key_check reported " . count($foreignKeys) . " violation(s).\n");
    }
    exit(1);
}

fwrite(STDOUT, "Database integrity and foreign keys are OK.\n");
