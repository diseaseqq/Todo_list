<?php
declare(strict_types=1);

return static function (PDO $pdo): void {
    $pdo->exec(<<<'SQL'
        CREATE TRIGGER task_series_rules_validate_insert
        BEFORE INSERT ON task_series_rules
        WHEN
            (NEW.recurrence_type = 'custom' AND
                (NEW.interval_days IS NULL OR NEW.interval_days NOT BETWEEN 1 AND 365))
            OR (NEW.recurrence_type <> 'custom' AND NEW.interval_days IS NOT NULL)
            OR (NEW.recurrence_type = 'monthly' AND
                (NEW.anchor_day IS NULL OR NEW.anchor_day NOT BETWEEN 1 AND 31))
            OR (NEW.recurrence_type <> 'monthly' AND NEW.anchor_day IS NOT NULL)
        BEGIN
            SELECT RAISE(ABORT, 'Invalid recurrence rule values.');
        END
        SQL);

    $pdo->exec(<<<'SQL'
        CREATE TRIGGER task_series_rules_validate_update
        BEFORE UPDATE OF recurrence_type, interval_days, anchor_day ON task_series_rules
        WHEN
            (NEW.recurrence_type = 'custom' AND
                (NEW.interval_days IS NULL OR NEW.interval_days NOT BETWEEN 1 AND 365))
            OR (NEW.recurrence_type <> 'custom' AND NEW.interval_days IS NOT NULL)
            OR (NEW.recurrence_type = 'monthly' AND
                (NEW.anchor_day IS NULL OR NEW.anchor_day NOT BETWEEN 1 AND 31))
            OR (NEW.recurrence_type <> 'monthly' AND NEW.anchor_day IS NOT NULL)
        BEGIN
            SELECT RAISE(ABORT, 'Invalid recurrence rule values.');
        END
        SQL);
};
