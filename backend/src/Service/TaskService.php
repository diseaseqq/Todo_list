<?php
declare(strict_types=1);

namespace TodoList\Service;

use DateTimeImmutable;
use PDO;
use TodoList\Http\ApiException;

final class TaskService
{
    private const PRIORITIES = ['low', 'medium', 'high'];

    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @param array<string, mixed> $filters
     *  @return list<array<string, mixed>>
     */
    public function list(string $ownerId, array $filters): array
    {
        $where = ['owner_id = :owner_id'];
        $parameters = [':owner_id' => $ownerId];
        $archived = false;
        if (array_key_exists('archived', $filters)) {
            $archived = filter_var($filters['archived'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
            if ($archived === null) {
                throw new ApiException('validation_error', 'archived must be true or false.', 422);
            }
        }
        $where[] = $archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL';

        if (isset($filters['completed'])) {
            $completed = filter_var($filters['completed'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
            if ($completed === null) {
                throw new ApiException('validation_error', 'completed must be true or false.', 422);
            }
            $where[] = 'is_completed = :is_completed';
            $parameters[':is_completed'] = $completed ? 1 : 0;
        }

        if (isset($filters['category_id']) && $filters['category_id'] !== '') {
            if (!is_string($filters['category_id'])) {
                throw new ApiException('validation_error', 'category_id must be a string.', 422);
            }
            $where[] = 'category_id = :category_id';
            $parameters[':category_id'] = $filters['category_id'];
        }

        if (isset($filters['q']) && $filters['q'] !== '') {
            if (!is_string($filters['q']) || mb_strlen($filters['q'], 'UTF-8') > 100) {
                throw new ApiException('validation_error', 'Search text must not exceed 100 characters.', 422);
            }
            $search = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], trim($filters['q']));
            $where[] = "(unicode_fold(title) LIKE unicode_fold(:query) ESCAPE '\\'
                OR unicode_fold(description) LIKE unicode_fold(:query) ESCAPE '\\')";
            $parameters[':query'] = '%' . $search . '%';
        }

        $sortColumns = [
            'created' => 'created_at',
            'due_date' => 'due_date',
            'title' => 'title COLLATE NOCASE',
            'priority' => "CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END",
        ];
        $sort = $filters['sort'] ?? 'created';
        if (!is_string($sort) || !isset($sortColumns[$sort])) {
            throw new ApiException('validation_error', 'Unsupported task sort order.', 422);
        }
        $direction = strtolower((string) ($filters['direction'] ?? 'desc'));
        if (!in_array($direction, ['asc', 'desc'], true)) {
            throw new ApiException('validation_error', 'direction must be asc or desc.', 422);
        }

        $statement = $this->pdo->prepare(
            'SELECT id, series_id, series_rule_id, category_id, title, description, priority, due_date,
                    is_completed, completed_at, archived_at, version, created_at, updated_at
             FROM tasks WHERE ' . implode(' AND ', $where)
            . ' ORDER BY ' . $sortColumns[$sort] . ' ' . strtoupper($direction) . ', id ASC'
        );
        $statement->execute($parameters);
        return $this->attachSubtasks($statement->fetchAll());
    }

    /** @return array<string, mixed> */
    public function get(string $ownerId, string $taskId): array
    {
        return $this->withSubtasks($this->requireOwned($ownerId, $taskId));
    }

    /** @param array<string, mixed> $input
     *  @return array<string, mixed>
     */
    public function create(string $ownerId, array $input): array
    {
        $this->assertAllowedFields($input, ['title', 'description', 'priority', 'due_date', 'category_id', 'recurrence']);
        $fields = $this->validateFields($ownerId, $input, true);
        $recurrence = RecurrenceCalculator::normalize($input['recurrence'] ?? null);
        if ($recurrence !== null && $fields['due_date'] === null) {
            throw new ApiException('validation_error', 'A due_date is required for recurring tasks.', 422);
        }
        $id = self::uuidV4();
        $now = gmdate('Y-m-d\TH:i:s\Z');
        $seriesId = null;
        $ruleId = null;
        if ($recurrence !== null) {
            $this->pdo->beginTransaction();
            try {
                $seriesId = self::uuidV4();
                $series = $this->pdo->prepare(
                    'INSERT INTO task_series (id, owner_id, is_active, created_at, updated_at)
                     VALUES (:id, :owner_id, 1, :created_at, :updated_at)'
                );
                $series->execute([':id' => $seriesId, ':owner_id' => $ownerId, ':created_at' => $now, ':updated_at' => $now]);
                $ruleId = $this->insertRule($seriesId, 1, $fields, $recurrence, $fields['due_date'], null, $now);
                $this->insertTask($id, $ownerId, $seriesId, $ruleId, $fields, $now);
                $this->pdo->commit();
            } catch (\Throwable $exception) {
                if ($this->pdo->inTransaction()) {
                    $this->pdo->rollBack();
                }
                throw $exception;
            }
        } else {
            $this->insertTask($id, $ownerId, null, null, $fields, $now);
        }
        return $this->withSubtasks($this->requireOwned($ownerId, $id));
    }

    /** @param array<string, mixed> $input
     *  @return array<string, mixed>
     */
    public function update(string $ownerId, string $taskId, array $input): array
    {
        $this->assertAllowedFields($input, ['version', 'title', 'description', 'priority', 'due_date', 'category_id', 'recurrence']);
        $current = $this->requireOwned($ownerId, $taskId);
        $this->assertVersion($current, $input['version'] ?? null);
        if ($current['archived_at'] !== null) {
            throw new ApiException('invalid_state', 'Archived tasks must be restored before editing.', 409);
        }

        $fields = $this->validateFields($ownerId, array_replace($current, $input), false);
        $seriesState = $this->seriesState($current['series_id']);
        $templateFields = ['title', 'description', 'priority', 'due_date', 'category_id'];
        $templateChanged = array_intersect(array_keys($input), $templateFields) !== [];
        $seriesChange = array_key_exists('recurrence', $input)
            || ($seriesState !== null && (int) $seriesState['is_active'] === 1 && $templateChanged);
        $recurrence = null;
        if ($seriesChange) {
            $recurrence = array_key_exists('recurrence', $input)
                ? RecurrenceCalculator::normalize($input['recurrence'])
                : [
                    'type' => $seriesState['recurrence_type'],
                    'interval' => $seriesState['interval_days'] === null ? null : (int) $seriesState['interval_days'],
                ];
            if ($recurrence !== null && $fields['due_date'] === null) {
                throw new ApiException('validation_error', 'A due_date is required for recurring tasks.', 422);
            }
        }

        if ($seriesChange) {
            return $this->updateWithSeries($ownerId, $taskId, $current, $fields, $recurrence, $seriesState);
        }

        $statement = $this->pdo->prepare(
            'UPDATE tasks SET category_id = :category_id, title = :title, description = :description,
                priority = :priority, due_date = :due_date, version = version + 1, updated_at = :updated_at
             WHERE id = :id AND owner_id = :owner_id AND version = :version'
        );
        $statement->execute([
            ':category_id' => $fields['category_id'],
            ':title' => $fields['title'],
            ':description' => $fields['description'],
            ':priority' => $fields['priority'],
            ':due_date' => $fields['due_date'],
            ':updated_at' => gmdate('Y-m-d\TH:i:s\Z'),
            ':id' => $taskId,
            ':owner_id' => $ownerId,
            ':version' => $current['version'],
        ]);
        if ($statement->rowCount() !== 1) {
            throw new ApiException('version_conflict', 'The task changed. Reload it before saving.', 409);
        }
        return $this->withSubtasks($this->requireOwned($ownerId, $taskId));
    }

    /** @return array<string, mixed> */
    public function setCompleted(string $ownerId, string $taskId, array $input): array
    {
        $current = $this->requireOwned($ownerId, $taskId);
        $this->assertVersion($current, $input['version'] ?? null);
        if ($current['archived_at'] !== null) {
            throw new ApiException('invalid_state', 'Archived tasks must be restored before changing completion.', 409);
        }
        $completed = $input['is_completed'] ?? null;
        if (!is_bool($completed)) {
            throw new ApiException('validation_error', 'is_completed must be a boolean.', 422);
        }
        if ($current['is_completed'] === (int) $completed) {
            return $this->withSubtasks($current);
        }

        $now = gmdate('Y-m-d\TH:i:s\Z');
        $this->pdo->beginTransaction();
        try {
            $statement = $this->pdo->prepare(
                'UPDATE tasks SET is_completed = :is_completed, completed_at = :completed_at,
                    version = version + 1, updated_at = :updated_at
                 WHERE id = :id AND owner_id = :owner_id AND version = :version'
            );
            $statement->execute([
                ':is_completed' => $completed ? 1 : 0,
                ':completed_at' => $completed ? $now : null,
                ':updated_at' => $now,
                ':id' => $taskId,
                ':owner_id' => $ownerId,
                ':version' => $current['version'],
            ]);
            if ($statement->rowCount() !== 1) {
                throw new ApiException('version_conflict', 'The task changed. Reload it before saving.', 409);
            }

            if ($completed && is_string($current['series_id'])) {
                $series = $this->seriesState($current['series_id']);
                if ($series !== null && (int) $series['is_active'] === 1) {
                    $nextDate = RecurrenceCalculator::nextDate(
                        $current['due_date'],
                        $series['recurrence_type'],
                        $series['interval_days'] === null ? null : (int) $series['interval_days'],
                        $series['anchor_day'] === null ? null : (int) $series['anchor_day'],
                    );
                    $existing = $this->pdo->prepare(
                        'SELECT 1 FROM tasks WHERE owner_id = :owner_id AND series_id = :series_id AND due_date = :due_date LIMIT 1'
                    );
                    $existing->execute([
                        ':owner_id' => $ownerId,
                        ':series_id' => $current['series_id'],
                        ':due_date' => $nextDate,
                    ]);
                    if ($existing->fetchColumn() === false) {
                        $this->insertTask(
                            self::uuidV4(),
                            $ownerId,
                            $current['series_id'],
                            $series['rule_id'],
                            [
                                'title' => $series['title'],
                                'description' => $series['description'],
                                'priority' => $series['priority'],
                                'category_id' => $series['category_id'],
                                'due_date' => $nextDate,
                            ],
                            $now,
                        );
                    }
                }
            }
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
        return $this->withSubtasks($this->requireOwned($ownerId, $taskId));
    }

    /** @return array<string, mixed> */
    public function archive(string $ownerId, string $taskId, array $input): array
    {
        return $this->setArchivedAt($ownerId, $taskId, $input, gmdate('Y-m-d\TH:i:s\Z'));
    }

    /** @return array<string, mixed> */
    public function restore(string $ownerId, string $taskId, array $input): array
    {
        return $this->setArchivedAt($ownerId, $taskId, $input, null);
    }

    public function delete(string $ownerId, string $taskId, array $input): void
    {
        $current = $this->requireOwned($ownerId, $taskId);
        $this->assertVersion($current, $input['version'] ?? null);
        $statement = $this->pdo->prepare('DELETE FROM tasks WHERE id = :id AND owner_id = :owner_id AND version = :version');
        $statement->execute([':id' => $taskId, ':owner_id' => $ownerId, ':version' => $current['version']]);
        if ($statement->rowCount() !== 1) {
            throw new ApiException('version_conflict', 'The task changed. Reload it before deleting.', 409);
        }
    }

    /** @return array{restored: int} */
    public function restoreAll(string $ownerId): array
    {
        $statement = $this->pdo->prepare(
            'UPDATE tasks SET archived_at = NULL, version = version + 1, updated_at = :updated_at
             WHERE owner_id = :owner_id AND archived_at IS NOT NULL'
        );
        $statement->execute([':updated_at' => gmdate('Y-m-d\TH:i:s\Z'), ':owner_id' => $ownerId]);
        return ['restored' => $statement->rowCount()];
    }

    /** @return array{deleted: int} */
    public function clearArchive(string $ownerId, array $input): array
    {
        if (($input['confirm'] ?? null) !== true) {
            throw new ApiException('confirmation_required', 'Set confirm to true to permanently clear the archive.', 422);
        }
        $statement = $this->pdo->prepare(
            'DELETE FROM tasks WHERE owner_id = :owner_id AND archived_at IS NOT NULL'
        );
        $statement->execute([':owner_id' => $ownerId]);
        return ['deleted' => $statement->rowCount()];
    }

    /** @return array{active: int, completed: int, overdue: int, archived: int, archived_completed: int} */
    public function statistics(string $ownerId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT
                COALESCE(SUM(CASE WHEN archived_at IS NULL AND is_completed = 0 THEN 1 ELSE 0 END), 0) AS active,
                COALESCE(SUM(CASE WHEN archived_at IS NULL AND is_completed = 1 THEN 1 ELSE 0 END), 0) AS completed,
                COALESCE(SUM(CASE WHEN archived_at IS NULL AND is_completed = 0 AND due_date < :today THEN 1 ELSE 0 END), 0) AS overdue,
                COALESCE(SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS archived,
                COALESCE(SUM(CASE WHEN archived_at IS NOT NULL AND is_completed = 1 THEN 1 ELSE 0 END), 0) AS archived_completed
             FROM tasks WHERE owner_id = :owner_id'
        );
        $statement->execute([':today' => gmdate('Y-m-d'), ':owner_id' => $ownerId]);
        $counts = $statement->fetch();
        return array_map('intval', $counts);
    }

    /** @return array<string, mixed> */
    private function setArchivedAt(string $ownerId, string $taskId, array $input, ?string $archivedAt): array
    {
        $current = $this->requireOwned($ownerId, $taskId);
        $this->assertVersion($current, $input['version'] ?? null);
        if (($current['archived_at'] !== null) === ($archivedAt !== null)) {
            return $this->withSubtasks($current);
        }
        $statement = $this->pdo->prepare(
            'UPDATE tasks SET archived_at = :archived_at, version = version + 1, updated_at = :updated_at
             WHERE id = :id AND owner_id = :owner_id AND version = :version'
        );
        $statement->execute([
            ':archived_at' => $archivedAt,
            ':updated_at' => gmdate('Y-m-d\TH:i:s\Z'),
            ':id' => $taskId,
            ':owner_id' => $ownerId,
            ':version' => $current['version'],
        ]);
        if ($statement->rowCount() !== 1) {
            throw new ApiException('version_conflict', 'The task changed. Reload it before saving.', 409);
        }
        return $this->withSubtasks($this->requireOwned($ownerId, $taskId));
    }

    /** @return array<string, mixed> */
    private function requireOwned(string $ownerId, string $taskId): array
    {
        $statement = $this->pdo->prepare('SELECT * FROM tasks WHERE id = :id AND owner_id = :owner_id LIMIT 1');
        $statement->execute([':id' => $taskId, ':owner_id' => $ownerId]);
        $task = $statement->fetch();
        if (!is_array($task)) {
            throw new ApiException('not_found', 'Task not found.', 404);
        }
        return $task;
    }

    /** @return array<string, mixed>|null */
    private function seriesState(?string $seriesId): ?array
    {
        if ($seriesId === null) {
            return null;
        }
        $statement = $this->pdo->prepare(
            'SELECT s.id AS series_id, s.is_active, r.id AS rule_id, r.version AS rule_version,
                    r.recurrence_type, r.interval_days, r.anchor_day, r.title, r.description, r.priority, r.category_id
             FROM task_series s JOIN task_series_rules r ON r.series_id = s.id
             WHERE s.id = :series_id ORDER BY r.version DESC LIMIT 1'
        );
        $statement->execute([':series_id' => $seriesId]);
        $state = $statement->fetch();
        return is_array($state) ? $state : null;
    }

    /** @param array<string, mixed> $fields
     *  @param array{type: string, interval: ?int}|null $recurrence
     *  @param array<string, mixed>|null $seriesState
     *  @return array<string, mixed>
     */
    private function updateWithSeries(
        string $ownerId,
        string $taskId,
        array $current,
        array $fields,
        ?array $recurrence,
        ?array $seriesState,
    ): array {
        $this->pdo->beginTransaction();
        try {
            $seriesId = null;
            $ruleId = null;
            $ruleAnchorDay = null;
            if ($recurrence === null) {
                // Keep the task linked to the rule that created it. Disabling a series
                // stops future generation; it does not rewrite an occurrence's history.
                $seriesId = $current['series_id'];
                $ruleId = $current['series_rule_id'];
                if ($seriesState !== null && (int) $seriesState['is_active'] === 1) {
                    $deactivate = $this->pdo->prepare(
                        'UPDATE task_series SET is_active = 0, updated_at = :updated_at WHERE id = :id AND owner_id = :owner_id'
                    );
                    $deactivate->execute([
                        ':updated_at' => gmdate('Y-m-d\TH:i:s\Z'),
                        ':id' => $seriesState['series_id'],
                        ':owner_id' => $ownerId,
                    ]);
                }
            } else {
                $now = gmdate('Y-m-d\TH:i:s\Z');
                if ($seriesState !== null && (int) $seriesState['is_active'] === 1) {
                    $seriesId = $seriesState['series_id'];
                    $ruleVersion = (int) $seriesState['rule_version'] + 1;
                    $priorAnchor = $seriesState['recurrence_type'] === 'monthly'
                        ? (int) $seriesState['anchor_day']
                        : null;
                    $activate = $this->pdo->prepare(
                        'UPDATE task_series SET is_active = 1, updated_at = :updated_at WHERE id = :id AND owner_id = :owner_id'
                    );
                    $activate->execute([':updated_at' => $now, ':id' => $seriesId, ':owner_id' => $ownerId]);
                } else {
                    $seriesId = self::uuidV4();
                    $ruleVersion = 1;
                    $priorAnchor = null;
                    $createSeries = $this->pdo->prepare(
                        'INSERT INTO task_series (id, owner_id, is_active, created_at, updated_at)
                         VALUES (:id, :owner_id, 1, :created_at, :updated_at)'
                    );
                    $createSeries->execute([
                        ':id' => $seriesId, ':owner_id' => $ownerId, ':created_at' => $now, ':updated_at' => $now,
                    ]);
                }
                $ruleId = $this->insertRule(
                    $seriesId,
                    $ruleVersion,
                    $fields,
                    $recurrence,
                    $fields['due_date'],
                    $priorAnchor,
                    $now,
                );
                if ($recurrence['type'] === 'monthly') {
                    $ruleAnchorDay = $priorAnchor
                        ?? (int) (new DateTimeImmutable($fields['due_date'], new \DateTimeZone('UTC')))->format('j');
                }
            }

            $now = gmdate('Y-m-d\TH:i:s\Z');
            // A completed occurrence is immutable as series history. The edit still
            // creates a new rule and updates future open occurrences below.
            if ((int) $current['is_completed'] !== 1) {
                $statement = $this->pdo->prepare(
                    'UPDATE tasks SET series_id = :series_id, series_rule_id = :series_rule_id,
                        category_id = :category_id, title = :title, description = :description,
                        priority = :priority, due_date = :due_date, version = version + 1, updated_at = :updated_at
                     WHERE id = :id AND owner_id = :owner_id AND version = :version'
                );
                $statement->execute([
                    ':series_id' => $seriesId,
                    ':series_rule_id' => $ruleId,
                    ':category_id' => $fields['category_id'],
                    ':title' => $fields['title'],
                    ':description' => $fields['description'],
                    ':priority' => $fields['priority'],
                    ':due_date' => $fields['due_date'],
                    ':updated_at' => $now,
                    ':id' => $taskId,
                    ':owner_id' => $ownerId,
                    ':version' => $current['version'],
                ]);
                if ($statement->rowCount() !== 1) {
                    throw new ApiException('version_conflict', 'The task changed. Reload it before saving.', 409);
                }
            }

            if ($seriesId !== null && $ruleId !== null && $seriesState !== null && (int) $seriesState['is_active'] === 1) {
                $futureQuery = $this->pdo->prepare(
                    'SELECT id FROM tasks WHERE owner_id = :owner_id AND series_id = :series_id AND id <> :current_id
                        AND due_date > :today AND is_completed = 0 AND archived_at IS NULL ORDER BY due_date, created_at, id'
                );
                $futureQuery->execute([
                    ':owner_id' => $ownerId,
                    ':series_id' => $seriesId,
                    ':current_id' => $taskId,
                    ':today' => gmdate('Y-m-d'),
                ]);
                $futureIds = $futureQuery->fetchAll(PDO::FETCH_COLUMN);
                if ($futureIds !== []) {
                    // Clear the unique series/date slots before reassigning them in case
                    // the new cadence overlaps dates from the old cadence.
                    $placeholders = implode(',', array_fill(0, count($futureIds), '?'));
                    $clearDates = $this->pdo->prepare(
                        'UPDATE tasks SET due_date = NULL WHERE id IN (' . $placeholders . ') AND owner_id = ?'
                    );
                    $clearDates->execute([...$futureIds, $ownerId]);

                    $updateFuture = $this->pdo->prepare(
                        'UPDATE tasks SET series_rule_id = :rule_id, category_id = :category_id, title = :title,
                            description = :description, priority = :priority, due_date = :due_date,
                            version = version + 1, updated_at = :updated_at
                         WHERE id = :id AND owner_id = :owner_id'
                    );
                    $nextDate = $fields['due_date'];
                    foreach ($futureIds as $futureId) {
                        $nextDate = RecurrenceCalculator::nextDate(
                            $nextDate,
                            $recurrence['type'],
                            $recurrence['interval'],
                            $ruleAnchorDay,
                        );
                        $updateFuture->execute([
                            ':rule_id' => $ruleId,
                            ':category_id' => $fields['category_id'],
                            ':title' => $fields['title'],
                            ':description' => $fields['description'],
                            ':priority' => $fields['priority'],
                            ':due_date' => $nextDate,
                            ':updated_at' => $now,
                            ':id' => $futureId,
                            ':owner_id' => $ownerId,
                        ]);
                    }
                }
            }

            $this->pdo->commit();
        } catch (\Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
        return $this->withSubtasks($this->requireOwned($ownerId, $taskId));
    }

    /** @param array<string, mixed> $fields
     *  @param array{type: string, interval: ?int} $recurrence
     */
    private function insertRule(
        string $seriesId,
        int $version,
        array $fields,
        array $recurrence,
        ?string $dueDate,
        ?int $priorAnchor,
        string $now,
    ): string {
        $id = self::uuidV4();
        $anchor = null;
        if ($recurrence['type'] === 'monthly') {
            $anchor = $priorAnchor ?? (int) (new \DateTimeImmutable($dueDate ?? 'today', new \DateTimeZone('UTC')))->format('j');
        }
        $statement = $this->pdo->prepare(
            'INSERT INTO task_series_rules
                (id, series_id, version, title, description, priority, category_id,
                 recurrence_type, interval_days, anchor_day, effective_from, created_at)
             VALUES
                (:id, :series_id, :version, :title, :description, :priority, :category_id,
                 :recurrence_type, :interval_days, :anchor_day, :effective_from, :created_at)'
        );
        $statement->execute([
            ':id' => $id,
            ':series_id' => $seriesId,
            ':version' => $version,
            ':title' => $fields['title'],
            ':description' => $fields['description'],
            ':priority' => $fields['priority'],
            ':category_id' => $fields['category_id'],
            ':recurrence_type' => $recurrence['type'],
            ':interval_days' => $recurrence['interval'],
            ':anchor_day' => $anchor,
            ':effective_from' => $dueDate ?? gmdate('Y-m-d'),
            ':created_at' => $now,
        ]);
        return $id;
    }

    /** @param array<string, mixed> $fields */
    private function insertTask(
        string $id,
        string $ownerId,
        ?string $seriesId,
        ?string $ruleId,
        array $fields,
        string $now,
    ): void {
        $statement = $this->pdo->prepare(
            'INSERT INTO tasks
                (id, owner_id, series_id, series_rule_id, category_id, title, description, priority, due_date, created_at, updated_at)
             VALUES
                (:id, :owner_id, :series_id, :series_rule_id, :category_id, :title, :description, :priority, :due_date, :created_at, :updated_at)'
        );
        $statement->execute([
            ':id' => $id,
            ':owner_id' => $ownerId,
            ':series_id' => $seriesId,
            ':series_rule_id' => $ruleId,
            ':category_id' => $fields['category_id'],
            ':title' => $fields['title'],
            ':description' => $fields['description'],
            ':priority' => $fields['priority'],
            ':due_date' => $fields['due_date'],
            ':created_at' => $now,
            ':updated_at' => $now,
        ]);
    }

    /** @param list<array<string, mixed>> $tasks
     *  @return list<array<string, mixed>>
     */
    private function attachSubtasks(array $tasks): array
    {
        if ($tasks === []) {
            return [];
        }
        $ids = array_column($tasks, 'id');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $statement = $this->pdo->prepare(
            'SELECT id, task_id, title, is_completed, sort_order, created_at, updated_at
             FROM subtasks WHERE task_id IN (' . $placeholders . ') ORDER BY sort_order, created_at, id'
        );
        $statement->execute($ids);
        $byTask = [];
        foreach ($statement->fetchAll() as $subtask) {
            $byTask[$subtask['task_id']][] = $subtask;
        }
        $ruleIds = array_values(array_filter(array_unique(array_column($tasks, 'series_rule_id'))));
        $recurrenceByRule = [];
        if ($ruleIds !== []) {
            $rulePlaceholders = implode(',', array_fill(0, count($ruleIds), '?'));
            $rules = $this->pdo->prepare(
                'SELECT id, recurrence_type, interval_days FROM task_series_rules WHERE id IN (' . $rulePlaceholders . ')'
            );
            $rules->execute($ruleIds);
            foreach ($rules->fetchAll() as $rule) {
                $recurrenceByRule[$rule['id']] = [
                    'type' => $rule['recurrence_type'],
                    'interval' => $rule['interval_days'] === null ? 1 : (int) $rule['interval_days'],
                ];
            }
        }
        foreach ($tasks as &$task) {
            unset($task['owner_id']);
            $task['is_completed'] = (bool) $task['is_completed'];
            $task['version'] = (int) $task['version'];
            $task['subtasks'] = $byTask[$task['id']] ?? [];
            $task['recurrence'] = $recurrenceByRule[$task['series_rule_id'] ?? ''] ?? null;
            unset($task['series_id'], $task['series_rule_id']);
        }
        unset($task);
        return $tasks;
    }

    /** @param array<string, mixed> $task
     *  @return array<string, mixed>
     */
    private function withSubtasks(array $task): array
    {
        unset($task['owner_id']);
        $task['is_completed'] = (bool) $task['is_completed'];
        $task['version'] = (int) $task['version'];
        return $this->attachSubtasks([$task])[0];
    }

    /** @return array{title: string, description: ?string, priority: string, due_date: ?string, category_id: ?string} */
    private function validateFields(string $ownerId, array $input, bool $creating): array
    {
        $title = $input['title'] ?? null;
        if (!is_string($title)) {
            throw new ApiException('validation_error', 'title is required.', 422);
        }
        $title = trim($title);
        $titleLength = mb_strlen($title, 'UTF-8');
        if ($titleLength < 3 || $titleLength > 150) {
            throw new ApiException('validation_error', 'title must contain 3 to 150 characters.', 422);
        }

        $description = $input['description'] ?? null;
        if ($description !== null && !is_string($description)) {
            throw new ApiException('validation_error', 'description must be a string or null.', 422);
        }
        if (is_string($description)) {
            $description = trim($description);
            if (mb_strlen($description, 'UTF-8') > 500) {
                throw new ApiException('validation_error', 'description must not exceed 500 characters.', 422);
            }
            $description = $description === '' ? null : $description;
        }

        $priority = $input['priority'] ?? ($creating ? 'medium' : null);
        if (!is_string($priority) || !in_array($priority, self::PRIORITIES, true)) {
            throw new ApiException('validation_error', 'priority must be low, medium, or high.', 422);
        }

        $dueDate = $input['due_date'] ?? null;
        if ($dueDate !== null && (!is_string($dueDate) || !self::isValidDate($dueDate))) {
            throw new ApiException('validation_error', 'due_date must be a valid YYYY-MM-DD date or null.', 422);
        }

        $categoryId = $input['category_id'] ?? null;
        if ($categoryId !== null && !is_string($categoryId)) {
            throw new ApiException('validation_error', 'category_id must be a string or null.', 422);
        }
        if (is_string($categoryId) && $categoryId !== '') {
            $category = $this->pdo->prepare('SELECT 1 FROM categories WHERE id = :id AND owner_id = :owner_id');
            $category->execute([':id' => $categoryId, ':owner_id' => $ownerId]);
            if ($category->fetchColumn() === false) {
                throw new ApiException('validation_error', 'category_id is not available to this account.', 422);
            }
        } else {
            $categoryId = null;
        }

        return [
            'title' => $title,
            'description' => $description,
            'priority' => $priority,
            'due_date' => $dueDate,
            'category_id' => $categoryId,
        ];
    }

    private function assertVersion(array $task, mixed $version): void
    {
        if (!is_int($version) || $version < 1) {
            throw new ApiException('validation_error', 'A positive integer version is required.', 422);
        }
        if ($task['version'] !== $version) {
            throw new ApiException('version_conflict', 'The task changed. Reload it before saving.', 409);
        }
    }

    /** @param list<string> $allowed */
    private function assertAllowedFields(array $input, array $allowed): void
    {
        $unknown = array_diff(array_keys($input), $allowed);
        if ($unknown !== []) {
            throw new ApiException('validation_error', 'Unsupported task field: ' . (string) reset($unknown), 422);
        }
    }

    private static function isValidDate(string $value): bool
    {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        return $date !== false && $date->format('Y-m-d') === $value;
    }

    private static function uuidV4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return sprintf('%s-%s-%s-%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20));
    }
}
