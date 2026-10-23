<?php
declare(strict_types=1);

use TodoList\Database\MigrationRunner;
use TodoList\Database\SqliteConnection;

$config = require dirname(__DIR__) . '/bootstrap.php';
$pdo = SqliteConnection::connect($config->databasePath);
$runner = new MigrationRunner($pdo, dirname(__DIR__) . '/migrations');
$applied = $runner->migrate();

if ($applied === []) {
    fwrite(STDOUT, "Database schema is up to date.\n");
    exit(0);
}

foreach ($applied as $migration) {
    fwrite(STDOUT, "Applied {$migration}\n");
}
