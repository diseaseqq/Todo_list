<?php
declare(strict_types=1);

namespace TodoList\Service;

use PDO;
use PDOException;
use TodoList\Http\ApiException;

final class CategoryService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @return list<array<string, mixed>> */
    public function list(string $ownerId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, name, is_system, version, created_at, updated_at
             FROM categories WHERE owner_id = :owner_id ORDER BY name COLLATE NOCASE, id'
        );
        $statement->execute([':owner_id' => $ownerId]);
        return $statement->fetchAll();
    }

    /** @return array<string, mixed> */
    public function create(string $ownerId, array $input): array
    {
        $this->assertAllowedFields($input, ['name']);
        $name = $this->validateName($input['name'] ?? null);
        $now = gmdate('Y-m-d\TH:i:s\Z');
        $id = self::uuidV4();
        $statement = $this->pdo->prepare(
            'INSERT INTO categories (id, owner_id, name, normalized_name, is_system, created_at, updated_at)
             VALUES (:id, :owner_id, :name, :normalized_name, 0, :created_at, :updated_at)'
        );
        try {
            $statement->execute([
                ':id' => $id,
                ':owner_id' => $ownerId,
                ':name' => $name,
                ':normalized_name' => self::normalize($name),
                ':created_at' => $now,
                ':updated_at' => $now,
            ]);
        } catch (PDOException $exception) {
            $this->throwIfDuplicate($exception);
            throw $exception;
        }
        $select = $this->pdo->prepare(
            'SELECT id, name, is_system, version, created_at, updated_at FROM categories WHERE id = :id AND owner_id = :owner_id'
        );
        $select->execute([':id' => $id, ':owner_id' => $ownerId]);
        return $select->fetch();
    }

    /** @return array<string, mixed> */
    public function rename(string $ownerId, string $categoryId, array $input): array
    {
        $this->assertAllowedFields($input, ['name', 'version']);
        $name = $this->validateName($input['name'] ?? null);
        $version = $this->validateVersion($input['version'] ?? null);
        $statement = $this->pdo->prepare(
            'UPDATE categories SET name = :name, normalized_name = :normalized_name,
                version = version + 1, updated_at = :updated_at
             WHERE id = :id AND owner_id = :owner_id AND version = :version'
        );
        try {
            $statement->execute([
                ':name' => $name,
                ':normalized_name' => self::normalize($name),
                ':updated_at' => gmdate('Y-m-d\TH:i:s\Z'),
                ':id' => $categoryId,
                ':owner_id' => $ownerId,
                ':version' => $version,
            ]);
        } catch (PDOException $exception) {
            $this->throwIfDuplicate($exception);
            throw $exception;
        }
        if ($statement->rowCount() !== 1) {
            $this->assertExists($ownerId, $categoryId, $version);
        }
        return $this->get($ownerId, $categoryId);
    }

    public function delete(string $ownerId, string $categoryId, array $input): void
    {
        $this->assertAllowedFields($input, ['version']);
        $version = $this->validateVersion($input['version'] ?? null);
        $this->pdo->beginTransaction();
        try {
            $this->assertExists($ownerId, $categoryId, $version);
            $now = gmdate('Y-m-d\TH:i:s\Z');
            $clearTasks = $this->pdo->prepare(
                'UPDATE tasks SET category_id = NULL, version = version + 1, updated_at = :updated_at
                 WHERE owner_id = :owner_id AND category_id = :category_id'
            );
            $clearTasks->execute([':updated_at' => $now, ':owner_id' => $ownerId, ':category_id' => $categoryId]);

            $delete = $this->pdo->prepare(
                'DELETE FROM categories WHERE id = :id AND owner_id = :owner_id AND version = :version'
            );
            $delete->execute([':id' => $categoryId, ':owner_id' => $ownerId, ':version' => $version]);
            if ($delete->rowCount() !== 1) {
                throw new ApiException('version_conflict', 'The category changed. Reload it before deleting.', 409);
            }
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    /** @return array<string, mixed> */
    private function get(string $ownerId, string $categoryId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, name, is_system, version, created_at, updated_at FROM categories WHERE id = :id AND owner_id = :owner_id'
        );
        $statement->execute([':id' => $categoryId, ':owner_id' => $ownerId]);
        $category = $statement->fetch();
        if (!is_array($category)) {
            throw new ApiException('not_found', 'Category not found.', 404);
        }
        return $category;
    }

    private function assertExists(string $ownerId, string $categoryId, int $version): void
    {
        $category = $this->get($ownerId, $categoryId);
        if ((int) $category['version'] !== $version) {
            throw new ApiException('version_conflict', 'The category changed. Reload it before saving.', 409);
        }
    }

    private function validateName(mixed $value): string
    {
        if (!is_string($value)) {
            throw new ApiException('validation_error', 'name is required.', 422);
        }
        $name = trim($value);
        if ($name === '' || mb_strlen($name, 'UTF-8') > 50) {
            throw new ApiException('validation_error', 'Category name must contain 1 to 50 characters.', 422);
        }
        return $name;
    }

    private function validateVersion(mixed $value): int
    {
        if (!is_int($value) || $value < 1) {
            throw new ApiException('validation_error', 'A positive integer version is required.', 422);
        }
        return $value;
    }

    private function throwIfDuplicate(PDOException $exception): void
    {
        if (str_contains(strtolower($exception->getMessage()), 'unique constraint failed: categories.owner_id, categories.normalized_name')) {
            throw new ApiException('category_exists', 'A category with this name already exists.', 409);
        }
    }

    private function assertAllowedFields(array $input, array $allowed): void
    {
        $unknown = array_diff(array_keys($input), $allowed);
        if ($unknown !== []) {
            throw new ApiException('validation_error', 'Unsupported category field: ' . (string) reset($unknown), 422);
        }
    }

    private static function normalize(string $name): string
    {
        return mb_convert_case($name, MB_CASE_FOLD, 'UTF-8');
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
