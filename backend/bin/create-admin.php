<?php
declare(strict_types=1);

use TodoList\Database\MigrationRunner;
use TodoList\Database\SqliteConnection;

$config = require dirname(__DIR__) . '/bootstrap.php';
$pdo = SqliteConnection::connect($config->databasePath);
(new MigrationRunner($pdo, dirname(__DIR__) . '/migrations'))->migrate();

if (!function_exists('stream_isatty') || !stream_isatty(STDIN)) {
    fwrite(STDERR, "Run this command from an interactive terminal.\n");
    exit(1);
}

$adminExists = (bool) $pdo->query("SELECT EXISTS(SELECT 1 FROM users WHERE role = 'admin')")->fetchColumn();
if ($adminExists) {
    fwrite(STDERR, "An administrator already exists; no account was changed.\n");
    exit(1);
}

$email = strtolower(trim((string) readline('Administrator email: ')));
if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    fwrite(STDERR, "Enter a valid email address (up to 254 characters).\n");
    exit(1);
}

$password = readPassword('Password (at least 12 characters): ');
$confirmation = readPassword('Confirm password: ');
if (!hash_equals($password, $confirmation)) {
    fwrite(STDERR, "Passwords do not match.\n");
    exit(1);
}
if (mb_strlen($password, 'UTF-8') < 12 || strlen($password) > 72) {
    fwrite(STDERR, "Password must be at least 12 characters and no more than 72 bytes.\n");
    exit(1);
}

$now = gmdate('Y-m-d\TH:i:s\Z');
$userId = uuidV4();
$categories = ['Работа', 'Личное', 'Учёба', 'Покупки', 'Спорт', 'Другое'];

try {
    $pdo->beginTransaction();
    $insertUser = $pdo->prepare(
        "INSERT INTO users (id, email, password_hash, role, status, created_at, updated_at)
         VALUES (:id, :email, :password_hash, 'admin', 'active', :created_at, :updated_at)"
    );
    $insertUser->execute([
        ':id' => $userId,
        ':email' => $email,
        ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
        ':created_at' => $now,
        ':updated_at' => $now,
    ]);

    $insertCategory = $pdo->prepare(
        'INSERT INTO categories (id, owner_id, name, normalized_name, is_system, created_at, updated_at)
         VALUES (:id, :owner_id, :name, :normalized_name, 1, :created_at, :updated_at)'
    );
    foreach ($categories as $name) {
        $insertCategory->execute([
            ':id' => uuidV4(),
            ':owner_id' => $userId,
            ':name' => $name,
            ':normalized_name' => mb_convert_case($name, MB_CASE_FOLD, 'UTF-8'),
            ':created_at' => $now,
            ':updated_at' => $now,
        ]);
    }
    $pdo->commit();
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $exception;
} finally {
    unset($password, $confirmation);
}

fwrite(STDOUT, "Administrator account created successfully.\n");

function readPassword(string $prompt): string
{
    fwrite(STDOUT, $prompt);
    if (PHP_OS_FAMILY !== 'Windows' && function_exists('shell_exec')) {
        shell_exec('stty -echo');
        try {
            $value = trim((string) fgets(STDIN));
        } finally {
            shell_exec('stty echo');
            fwrite(STDOUT, "\n");
        }
        return $value;
    }

    return trim((string) fgets(STDIN));
}

function uuidV4(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return sprintf('%s-%s-%s-%s-%s', substr($hex, 0, 8), substr($hex, 8, 4), substr($hex, 12, 4), substr($hex, 16, 4), substr($hex, 20));
}
