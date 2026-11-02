<?php
declare(strict_types=1);

return static function (PDO $pdo): void {
    $pdo->exec(
        'CREATE UNIQUE INDEX idx_tasks_series_due_date ON tasks(series_id, due_date) '
        . 'WHERE series_id IS NOT NULL AND due_date IS NOT NULL'
    );
};
