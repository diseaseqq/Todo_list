<?php
declare(strict_types=1);

namespace TodoList\Http;

use RuntimeException;
use TodoList\Config\AppConfig;

final class Session
{
    public static function start(AppConfig $config): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        $httpsFlag = strtolower((string) ($_SERVER['HTTPS'] ?? ''));
        $isHttps = ($httpsFlag !== '' && $httpsFlag !== 'off') || ($_SERVER['SERVER_PORT'] ?? '') === '443';
        if ($config->isProduction() && !$isHttps) {
            JsonResponse::send(
                ['error' => ['code' => 'https_required', 'message' => 'HTTPS is required.']],
                426,
            );
        }

        if (headers_sent()) {
            throw new RuntimeException('Cannot start a session after response output has begun.');
        }

        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        session_set_cookie_params([
            'httponly' => true,
            'secure' => $config->isProduction(),
            'samesite' => 'Lax',
            'path' => '/',
        ]);

        if (!session_start()) {
            throw new RuntimeException('Could not start the session.');
        }
    }

    public static function authenticate(string $userId): void
    {
        self::assertStarted();
        if ($userId === '') {
            throw new RuntimeException('An authenticated session requires a user ID.');
        }
        if (!session_regenerate_id(true)) {
            throw new RuntimeException('Could not rotate the session ID.');
        }

        $_SESSION['user_id'] = $userId;
    }

    public static function currentUserId(): ?string
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            return null;
        }

        $userId = $_SESSION['user_id'] ?? null;
        return is_string($userId) && $userId !== '' ? $userId : null;
    }

    public static function csrfToken(): string
    {
        self::assertStarted();
        if (!isset($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf_token'];
    }

    public static function verifyCsrfToken(?string $token): void
    {
        self::assertStarted();
        $expected = $_SESSION['csrf_token'] ?? null;
        if (!is_string($expected) || $token === null || !hash_equals($expected, $token)) {
            JsonResponse::error('csrf_failed', 'A valid CSRF token is required.', 403);
        }
    }

    public static function requireUserId(): string
    {
        $userId = self::currentUserId();
        if ($userId === null) {
            JsonResponse::send(
                ['error' => ['code' => 'unauthenticated', 'message' => 'Authentication is required.']],
                401,
            );
        }

        return $userId;
    }

    public static function destroy(): void
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            return;
        }

        $_SESSION = [];
        $cookie = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000,
            'path' => $cookie['path'] ?: '/',
            'domain' => $cookie['domain'],
            'secure' => $cookie['secure'],
            'httponly' => $cookie['httponly'],
            'samesite' => $cookie['samesite'] ?? 'Lax',
        ]);

        if (!session_destroy()) {
            throw new RuntimeException('Could not destroy the session.');
        }
    }

    private static function assertStarted(): void
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            throw new RuntimeException('Start the session before changing its authentication state.');
        }
    }
}
