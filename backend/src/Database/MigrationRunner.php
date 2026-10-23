<?php
declare(strict_types=1);

namespace TodoList\Database;

use PDO;
use RuntimeException;

final class MigrationRunner
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly string $migrationDirectory,
    ) {
    }

    /** @return list<string> Names of migrations applied during this run. */
    public function migrate(): array
    {
        $this->pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL
            )
            SQL);

        $applied = $this->pdo->query('SELECT version FROM schema_migrations ORDER BY version')
            ->fetchAll(PDO::FETCH_COLUMN);
        $appliedVersions = array_map('intval', $applied);
        $known = [];
        $files = glob(rtrim($this->migrationDirectory, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . '*.php') ?: [];
        sort($files, SORT_STRING);

        foreach ($files as $file) {
            $name = basename($file);
            if (!preg_match('/^(\d{4})_([a-z0-9_]+)\.php$/', $name, $matches)) {
                throw new RuntimeException("Invalid migration filename: {$name}");
            }

            $version = (int) $matches[1];
            if (isset($known[$version])) {
                throw new RuntimeException("Duplicate migration version: {$version}");
            }
            $known[$version] = $name;
        }

        foreach ($appliedVersions as $index => $version) {
            if ($version !== $index + 1 || !isset($known[$version])) {
                throw new RuntimeException('Applied migration history is incomplete or contains unknown versions.');
            }
        }

        $newlyApplied = [];
        foreach ($files as $file) {
            $name = basename($file);
            preg_match('/^(\d{4})_/', $name, $matches);
            $version = (int) $matches[1];
            if (in_array($version, $appliedVersions, true)) {
                continue;
            }
            if ($version !== count($appliedVersions) + 1) {
                throw new RuntimeException("Migration {$name} is out of sequence.");
            }

            $migration = require $file;
            if (!is_callable($migration)) {
                throw new RuntimeException("Migration {$name} must return a callable.");
            }

            $this->pdo->beginTransaction();
            try {
                $migration($this->pdo);
                $statement = $this->pdo->prepare(
                    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (:version, :name, :applied_at)'
                );
                $statement->execute([
                    ':version' => $version,
                    ':name' => $name,
                    ':applied_at' => gmdate('Y-m-d\TH:i:s\Z'),
                ]);
                $this->pdo->commit();
            } catch (\Throwable $exception) {
                if ($this->pdo->inTransaction()) {
                    $this->pdo->rollBack();
                }
                throw $exception;
            }

            $appliedVersions[] = $version;
            $newlyApplied[] = $name;
        }

        $violations = $this->pdo->query('PRAGMA foreign_key_check')->fetchAll();
        if ($violations !== []) {
            throw new RuntimeException('Database foreign key check failed after migrations.');
        }

        return $newlyApplied;
    }
}
