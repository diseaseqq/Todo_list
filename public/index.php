<?php
declare(strict_types=1);

use TodoList\Http\JsonResponse;
use TodoList\Http\Request;
use TodoList\Http\Router;
use TodoList\Http\ApiException;
use TodoList\Database\SqliteConnection;
use TodoList\Controller\AuthController;
use TodoList\Controller\HealthController;

ini_set('display_errors', '0');
ini_set('log_errors', '1');

set_exception_handler(static function (Throwable $exception): void {
    if ($exception instanceof ApiException) {
        JsonResponse::error($exception->errorCode, $exception->getMessage(), $exception->status);
    }
    error_log((string) $exception);
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo '{"error":{"code":"internal_error","message":"Internal server error."}}';
});

$config = require dirname(__DIR__) . '/backend/bootstrap.php';
$pdo = SqliteConnection::connect($config->databasePath);

$router = new Router($config);
$router->add('GET', '/api/health', new HealthController($config));
$auth = new AuthController($pdo, $config);
$router->add('GET', '/api/auth/csrf', [$auth, 'csrf']);
$router->add('POST', '/api/auth/register', [$auth, 'register'], csrf: true);
$router->add('POST', '/api/auth/login', [$auth, 'login'], csrf: true);
$router->add('POST', '/api/auth/logout', [$auth, 'logout'], authenticated: true, csrf: true);
$router->add('GET', '/api/auth/me', [$auth, 'current'], authenticated: true);
$router->dispatch(Request::fromGlobals());
