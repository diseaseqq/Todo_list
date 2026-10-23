<?php
declare(strict_types=1);

namespace TodoList\Controller;

use PDO;
use PDOException;
use TodoList\Config\AppConfig;
use TodoList\Http\ApiException;
use TodoList\Http\JsonResponse;
use TodoList\Http\Request;
use TodoList\Http\Session;
use TodoList\Repository\UserRepository;

final class AuthController
{
    private readonly UserRepository $users;

    public function __construct(
        private readonly PDO $pdo,
        private readonly AppConfig $config,
    )
    {
        $this->users = new UserRepository($pdo);
    }

    public function csrf(Request $request): void
    {
        Session::start($this->config);
        JsonResponse::send(['csrf_token' => Session::csrfToken()]);
    }

    public function register(Request $request): void
    {
        $email = $this->normalizeEmail($request->body['email'] ?? null);
        $password = $this->validatePassword($request->body['password'] ?? null);
        $id = self::uuidV4();
        $now = gmdate('Y-m-d\TH:i:s\Z');
        $categories = ['Работа', 'Личное', 'Учёба', 'Покупки', 'Спорт', 'Другое'];

        try {
            $this->pdo->beginTransaction();
            $statement = $this->pdo->prepare(
                "INSERT INTO users (id, email, password_hash, role, status, created_at, updated_at)
                 VALUES (:id, :email, :password_hash, 'user', 'active', :created_at, :updated_at)"
            );
            $statement->execute([
                ':id' => $id,
                ':email' => $email,
                ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
                ':created_at' => $now,
                ':updated_at' => $now,
            ]);

            $categoryStatement = $this->pdo->prepare(
                'INSERT INTO categories (id, owner_id, name, normalized_name, is_system, created_at, updated_at)
                 VALUES (:id, :owner_id, :name, :normalized_name, 1, :created_at, :updated_at)'
            );
            foreach ($categories as $name) {
                $categoryStatement->execute([
                    ':id' => self::uuidV4(),
                    ':owner_id' => $id,
                    ':name' => $name,
                    ':normalized_name' => mb_convert_case($name, MB_CASE_FOLD, 'UTF-8'),
                    ':created_at' => $now,
                    ':updated_at' => $now,
                ]);
            }
            $this->pdo->commit();
        } catch (PDOException $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            if (str_contains(strtolower($exception->getMessage()), 'unique constraint failed: users.email')) {
                throw new ApiException('email_in_use', 'An account with this email already exists.', 409);
            }
            throw $exception;
        } catch (\Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        } finally {
            unset($password);
        }

        JsonResponse::send(['account' => $this->users->findPublicById($id)], 201);
    }

    public function login(Request $request): void
    {
        $email = $this->normalizeEmail($request->body['email'] ?? null);
        $password = $request->body['password'] ?? null;
        if (!is_string($password) || $password === '' || strlen($password) > 1024) {
            throw new ApiException('validation_error', 'A valid email and password are required.', 422);
        }

        $user = $this->users->findByEmail($email);
        if (
            $user === null ||
            $user['status'] !== 'active' ||
            !password_verify($password, $user['password_hash'])
        ) {
            throw new ApiException('invalid_credentials', 'Email or password is incorrect.', 401);
        }

        Session::authenticate($user['id']);
        JsonResponse::send([
            'account' => $this->users->findPublicById($user['id']),
            'csrf_token' => Session::csrfToken(),
        ]);
    }

    public function logout(Request $request): void
    {
        Session::destroy();
        JsonResponse::send(['status' => 'ok']);
    }

    public function current(Request $request): void
    {
        $id = Session::requireUserId();
        $account = $this->users->findPublicById($id);
        if ($account === null || $account['status'] !== 'active') {
            Session::destroy();
            throw new ApiException('unauthenticated', 'Authentication is required.', 401);
        }
        JsonResponse::send(['account' => $account, 'csrf_token' => Session::csrfToken()]);
    }

    private function normalizeEmail(mixed $value): string
    {
        if (!is_string($value)) {
            throw new ApiException('validation_error', 'A valid email address is required.', 422);
        }
        $email = strtolower(trim($value));
        if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new ApiException('validation_error', 'A valid email address is required.', 422);
        }
        return $email;
    }

    private function validatePassword(mixed $value): string
    {
        if (!is_string($value) || mb_strlen($value, 'UTF-8') < 12 || strlen($value) > 72) {
            throw new ApiException('validation_error', 'Password must be at least 12 characters and no more than 72 bytes.', 422);
        }
        return $value;
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
