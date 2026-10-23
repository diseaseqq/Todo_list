<?php
declare(strict_types=1);

namespace TodoList\Repository;

use PDO;

final class UserRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @return array{id: string, email: string, password_hash: string, role: string, status: string}|null */
    public function findByEmail(string $email): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, email, password_hash, role, status FROM users WHERE email = :email LIMIT 1'
        );
        $statement->execute([':email' => $email]);
        $user = $statement->fetch();
        return is_array($user) ? $user : null;
    }

    /** @return array{id: string, email: string, role: string, status: string}|null */
    public function findPublicById(string $id): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, email, role, status FROM users WHERE id = :id LIMIT 1'
        );
        $statement->execute([':id' => $id]);
        $user = $statement->fetch();
        return is_array($user) ? $user : null;
    }
}
