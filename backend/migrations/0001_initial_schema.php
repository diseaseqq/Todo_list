<?php
declare(strict_types=1);

return static function (PDO $pdo): void {
    $statements = [
        <<<'SQL'
        CREATE TABLE users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL COLLATE BINARY UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (length(id) = 36),
            CHECK (length(email) BETWEEN 3 AND 254),
            CHECK (length(password_hash) > 0)
        )
        SQL,
        <<<'SQL'
        CREATE TABLE categories (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (owner_id, normalized_name),
            UNIQUE (owner_id, id),
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
            CHECK (length(id) = 36),
            CHECK (length(trim(name)) BETWEEN 1 AND 50),
            CHECK (length(normalized_name) BETWEEN 1 AND 100)
        )
        SQL,
        <<<'SQL'
        CREATE TABLE task_series (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (owner_id, id),
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
            CHECK (length(id) = 36)
        )
        SQL,
        <<<'SQL'
        CREATE TABLE task_series_rules (
            id TEXT PRIMARY KEY,
            series_id TEXT NOT NULL,
            version INTEGER NOT NULL CHECK (version > 0),
            title TEXT NOT NULL,
            description TEXT,
            priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
            category_id TEXT,
            recurrence_type TEXT NOT NULL CHECK (recurrence_type IN ('daily', 'weekly', 'monthly', 'custom')),
            interval_days INTEGER,
            anchor_day INTEGER,
            effective_from TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (series_id, version),
            UNIQUE (series_id, id),
            FOREIGN KEY (series_id) REFERENCES task_series(id) ON DELETE CASCADE,
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
            CHECK (length(id) = 36),
            CHECK (length(trim(title)) BETWEEN 3 AND 150),
            CHECK (description IS NULL OR length(description) <= 500),
            CHECK (
                (recurrence_type = 'custom' AND interval_days BETWEEN 1 AND 365)
                OR (recurrence_type <> 'custom' AND interval_days IS NULL)
            ),
            CHECK (
                (recurrence_type = 'monthly' AND anchor_day BETWEEN 1 AND 31)
                OR (recurrence_type <> 'monthly' AND anchor_day IS NULL)
            ),
            CHECK (length(effective_from) = 10 AND date(effective_from, '+0 days') = effective_from)
        )
        SQL,
        <<<'SQL'
        CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            series_id TEXT,
            series_rule_id TEXT,
            category_id TEXT,
            title TEXT NOT NULL,
            description TEXT,
            priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
            due_date TEXT,
            is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
            completed_at TEXT,
            archived_at TEXT,
            version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (owner_id, series_id) REFERENCES task_series(owner_id, id) ON DELETE RESTRICT,
            FOREIGN KEY (series_id, series_rule_id) REFERENCES task_series_rules(series_id, id) ON DELETE RESTRICT,
            FOREIGN KEY (owner_id, category_id) REFERENCES categories(owner_id, id) ON DELETE RESTRICT,
            CHECK (length(id) = 36),
            CHECK (length(trim(title)) BETWEEN 3 AND 150),
            CHECK (description IS NULL OR length(description) <= 500),
            CHECK (due_date IS NULL OR (length(due_date) = 10 AND date(due_date, '+0 days') = due_date)),
            CHECK ((is_completed = 0 AND completed_at IS NULL) OR (is_completed = 1 AND completed_at IS NOT NULL)),
            CHECK ((series_id IS NULL AND series_rule_id IS NULL) OR (series_id IS NOT NULL AND series_rule_id IS NOT NULL))
        )
        SQL,
        <<<'SQL'
        CREATE TABLE subtasks (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            title TEXT NOT NULL,
            is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
            CHECK (length(id) = 36),
            CHECK (length(trim(title)) BETWEEN 1 AND 150)
        )
        SQL,
        'CREATE INDEX idx_tasks_owner_archive_created ON tasks(owner_id, archived_at, created_at DESC)',
        'CREATE INDEX idx_tasks_owner_completion_due ON tasks(owner_id, is_completed, due_date)',
        'CREATE INDEX idx_tasks_owner_category ON tasks(owner_id, category_id)',
        'CREATE INDEX idx_tasks_series ON tasks(series_id)',
        'CREATE INDEX idx_task_series_owner_active ON task_series(owner_id, is_active)',
        'CREATE INDEX idx_subtasks_task_sort ON subtasks(task_id, sort_order, created_at)',
        "CREATE UNIQUE INDEX idx_users_single_admin ON users(role) WHERE role = 'admin'",
    ];

    foreach ($statements as $statement) {
        $pdo->exec($statement);
    }
};
