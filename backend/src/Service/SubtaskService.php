<?php
declare(strict_types=1);

namespace TodoList\Service;

use PDO;
use TodoList\Http\ApiException;

final class SubtaskService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @return array{task_version: int, subtasks: list<array<string, mixed>>} */
    public function list(string $ownerId, string $taskId): array
    {
        $task = $this->requireTask($ownerId, $taskId);
        return ['task_version' => (int) $task['version'], 'subtasks' => $this->selectForTask($taskId)];
    }

    /** @return array{task_version: int, subtasks: list<array<string, mixed>>} */
    public function create(string $ownerId, string $taskId, array $input): array
    {
        $this->assertAllowedFields($input, ['task_version', 'title', 'sort_order']);
        $title = $this->validateTitle($input['title'] ?? null);
        $task = $this->requireTask($ownerId, $taskId);
        $nextVersion = $this->beginTaskMutation($task, $input['task_version'] ?? null);
        try {
            if (array_key_exists('sort_order', $input)) {
                $sortOrder = $input['sort_order'];
            } else {
                $sortStatement = $this->pdo->prepare(
                    'SELECT COALESCE(MAX(sort_order), -1) + 1 FROM subtasks WHERE task_id = :task_id'
                );
                $sortStatement->execute([':task_id' => $taskId]);
                $sortOrder = (int) $sortStatement->fetchColumn();
            }
            $sortOrder = $this->validateSortOrder($sortOrder);
            $now = gmdate('Y-m-d\TH:i:s\Z');
            $statement = $this->pdo->prepare(
                'INSERT INTO subtasks (id, task_id, title, is_completed, sort_order, created_at, updated_at)
                 VALUES (:id, :task_id, :title, 0, :sort_order, :created_at, :updated_at)'
            );
            $statement->execute([
                ':id' => self::uuidV4(), ':task_id' => $taskId, ':title' => $title,
                ':sort_order' => $sortOrder, ':created_at' => $now, ':updated_at' => $now,
            ]);
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
        return ['task_version' => $nextVersion, 'subtasks' => $this->selectForTask($taskId)];
    }

    /** @return array{task_version: int, subtasks: list<array<string, mixed>>} */
    public function update(string $ownerId, string $taskId, string $subtaskId, array $input): array
    {
        $this->assertAllowedFields($input, ['task_version', 'title', 'is_completed', 'sort_order']);
        if (count($input) < 2) {
            throw new ApiException('validation_error', 'Provide at least one subtask field to update.', 422);
        }
        if (array_key_exists('title', $input)) {
            $input['title'] = $this->validateTitle($input['title']);
        }
        if (array_key_exists('is_completed', $input) && !is_bool($input['is_completed'])) {
            throw new ApiException('validation_error', 'is_completed must be a boolean.', 422);
        }
        if (array_key_exists('sort_order', $input)) {
            $input['sort_order'] = $this->validateSortOrder($input['sort_order']);
        }

        $task = $this->requireTask($ownerId, $taskId);
        $nextVersion = $this->beginTaskMutation($task, $input['task_version'] ?? null);
        try {
            $set = [];
            $parameters = [':id' => $subtaskId, ':task_id' => $taskId, ':updated_at' => gmdate('Y-m-d\TH:i:s\Z')];
            foreach (['title', 'is_completed', 'sort_order'] as $field) {
                if (!array_key_exists($field, $input)) {
                    continue;
                }
                $set[] = $field . ' = :' . $field;
                $parameters[':' . $field] = $field === 'is_completed' ? (int) $input[$field] : $input[$field];
            }
            $set[] = 'updated_at = :updated_at';
            $statement = $this->pdo->prepare(
                'UPDATE subtasks SET ' . implode(', ', $set) . ' WHERE id = :id AND task_id = :task_id'
            );
            $statement->execute($parameters);
            if ($statement->rowCount() === 0 && !$this->subtaskExists($taskId, $subtaskId)) {
                throw new ApiException('not_found', 'Subtask not found.', 404);
            }
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
        return ['task_version' => $nextVersion, 'subtasks' => $this->selectForTask($taskId)];
    }

    /** @return array{task_version: int, subtasks: list<array<string, mixed>>} */
    public function delete(string $ownerId, string $taskId, string $subtaskId, array $input): array
    {
        $this->assertAllowedFields($input, ['task_version']);
        $task = $this->requireTask($ownerId, $taskId);
        $nextVersion = $this->beginTaskMutation($task, $input['task_version'] ?? null);
        try {
            $statement = $this->pdo->prepare('DELETE FROM subtasks WHERE id = :id AND task_id = :task_id');
            $statement->execute([':id' => $subtaskId, ':task_id' => $taskId]);
            if ($statement->rowCount() !== 1) {
                throw new ApiException('not_found', 'Subtask not found.', 404);
            }
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
        return ['task_version' => $nextVersion, 'subtasks' => $this->selectForTask($taskId)];
    }

    /** @return array{task_version: int, subtasks: list<array<string, mixed>>} */
    public function reorder(string $ownerId, string $taskId, array $input): array
    {
        $this->assertAllowedFields($input, ['task_version', 'subtask_ids']);
        $ids = $input['subtask_ids'] ?? null;
        if (!is_array($ids) || array_filter($ids, static fn ($id): bool => !is_string($id)) !== []) {
            throw new ApiException('validation_error', 'subtask_ids must be an array of subtask IDs.', 422);
        }
        if (count($ids) !== count(array_unique($ids))) {
            throw new ApiException('validation_error', 'subtask_ids must not contain duplicates.', 422);
        }

        $task = $this->requireTask($ownerId, $taskId);
        $currentIds = array_column($this->selectForTask($taskId), 'id');
        $expected = $currentIds;
        $provided = $ids;
        sort($expected);
        sort($provided);
        if ($expected !== $provided) {
            throw new ApiException('validation_error', 'subtask_ids must contain each subtask exactly once.', 422);
        }

        $nextVersion = $this->beginTaskMutation($task, $input['task_version'] ?? null);
        try {
            $statement = $this->pdo->prepare(
                'UPDATE subtasks SET sort_order = :sort_order, updated_at = :updated_at
                 WHERE id = :id AND task_id = :task_id'
            );
            foreach ($ids as $index => $id) {
                $statement->execute([
                    ':sort_order' => $index,
                    ':updated_at' => gmdate('Y-m-d\TH:i:s\Z'),
                    ':id' => $id,
                    ':task_id' => $taskId,
                ]);
            }
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
        return ['task_version' => $nextVersion, 'subtasks' => $this->selectForTask($taskId)];
    }

    /** @return array<string, mixed> */
    private function requireTask(string $ownerId, string $taskId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, version FROM tasks WHERE id = :id AND owner_id = :owner_id AND archived_at IS NULL'
        );
        $statement->execute([':id' => $taskId, ':owner_id' => $ownerId]);
        $task = $statement->fetch();
        if (!is_array($task)) {
            throw new ApiException('not_found', 'Task not found.', 404);
        }
        return $task;
    }

    private function beginTaskMutation(array $task, mixed $expectedVersion): int
    {
        if (!is_int($expectedVersion) || $expectedVersion < 1) {
            throw new ApiException('validation_error', 'A positive task_version is required.', 422);
        }
        if ((int) $task['version'] !== $expectedVersion) {
            throw new ApiException('version_conflict', 'The task changed. Reload it before saving.', 409);
        }
        $this->pdo->beginTransaction();
        $statement = $this->pdo->prepare(
            'UPDATE tasks SET version = version + 1, updated_at = :updated_at
             WHERE id = :id AND version = :version'
        );
        $statement->execute([
            ':updated_at' => gmdate('Y-m-d\TH:i:s\Z'), ':id' => $task['id'], ':version' => $expectedVersion,
        ]);
        if ($statement->rowCount() !== 1) {
            $this->rollback();
            throw new ApiException('version_conflict', 'The task changed. Reload it before saving.', 409);
        }
        return $expectedVersion + 1;
    }

    /** @return list<array<string, mixed>> */
    private function selectForTask(string $taskId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, task_id, title, is_completed, sort_order, created_at, updated_at
             FROM subtasks WHERE task_id = :task_id ORDER BY sort_order, created_at, id'
        );
        $statement->execute([':task_id' => $taskId]);
        return $statement->fetchAll();
    }

    private function subtaskExists(string $taskId, string $subtaskId): bool
    {
        $statement = $this->pdo->prepare('SELECT 1 FROM subtasks WHERE id = :id AND task_id = :task_id');
        $statement->execute([':id' => $subtaskId, ':task_id' => $taskId]);
        return $statement->fetchColumn() !== false;
    }

    private function validateTitle(mixed $title): string
    {
        if (!is_string($title)) {
            throw new ApiException('validation_error', 'title is required.', 422);
        }
        $title = trim($title);
        if ($title === '' || mb_strlen($title, 'UTF-8') > 150) {
            throw new ApiException('validation_error', 'Subtask title must contain 1 to 150 characters.', 422);
        }
        return $title;
    }

    private function validateSortOrder(mixed $sortOrder): int
    {
        if (!is_int($sortOrder) || $sortOrder < 0 || $sortOrder > 2147483647) {
            throw new ApiException('validation_error', 'sort_order must be a non-negative integer.', 422);
        }
        return $sortOrder;
    }

    private function assertAllowedFields(array $input, array $allowed): void
    {
        $unknown = array_diff(array_keys($input), $allowed);
        if ($unknown !== []) {
            throw new ApiException('validation_error', 'Unsupported subtask field: ' . (string) reset($unknown), 422);
        }
    }

    private function rollback(): void
    {
        if ($this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
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
