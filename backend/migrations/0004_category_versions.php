<?php
declare(strict_types=1);

return static function (PDO $pdo): void {
    $pdo->exec(
        'ALTER TABLE categories ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)'
    );
};
