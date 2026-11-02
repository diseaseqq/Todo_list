<?php
declare(strict_types=1);

$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$requestPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$frontendFiles = [
    '/' => [dirname(__DIR__) . '/index.html', 'text/html; charset=utf-8'],
    '/index.html' => [dirname(__DIR__) . '/index.html', 'text/html; charset=utf-8'],
    '/style.css' => [dirname(__DIR__) . '/style.css', 'text/css; charset=utf-8'],
    '/js/script.js' => [dirname(__DIR__) . '/js/script.js', 'text/javascript; charset=utf-8'],
    '/js/toast.js' => [dirname(__DIR__) . '/js/toast.js', 'text/javascript; charset=utf-8'],
];

if (is_string($requestPath) && isset($frontendFiles[$requestPath]) && in_array($requestMethod, ['GET', 'HEAD'], true)) {
    [$frontendFile, $contentType] = $frontendFiles[$requestPath];
    if (!is_file($frontendFile)) {
        http_response_code(404);
        exit;
    }
    header('Content-Type: ' . $contentType);
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-cache');
    header('Content-Length: ' . filesize($frontendFile));
    if ($requestMethod === 'GET') {
        readfile($frontendFile);
    }
    exit;
}

use TodoList\Http\JsonResponse;
use TodoList\Http\Request;
use TodoList\Http\Router;
use TodoList\Http\ApiException;
use TodoList\Database\SqliteConnection;
use TodoList\Controller\AuthController;
use TodoList\Controller\HealthController;
use TodoList\Controller\TaskController;
use TodoList\Controller\SubtaskController;
use TodoList\Controller\CategoryController;
use TodoList\Service\TaskService;
use TodoList\Service\SubtaskService;
use TodoList\Service\CategoryService;

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
$tasks = new TaskController(new TaskService($pdo));
$router->add('GET', '/api/tasks', [$tasks, 'index'], authenticated: true);
$router->add('POST', '/api/tasks', [$tasks, 'create'], authenticated: true, csrf: true);
$router->add('GET', '/api/stats', [$tasks, 'statistics'], authenticated: true);
$router->add('POST', '/api/archive/restore-all', [$tasks, 'restoreAll'], authenticated: true, csrf: true);
$router->add('DELETE', '/api/archive', [$tasks, 'clearArchive'], authenticated: true, csrf: true);
$router->add('GET', '/api/tasks/{taskId}', [$tasks, 'show'], authenticated: true);
$router->add('PATCH', '/api/tasks/{taskId}', [$tasks, 'update'], authenticated: true, csrf: true);
$router->add('DELETE', '/api/tasks/{taskId}', [$tasks, 'delete'], authenticated: true, csrf: true);
$router->add('POST', '/api/tasks/{taskId}/complete', [$tasks, 'complete'], authenticated: true, csrf: true);
$router->add('POST', '/api/tasks/{taskId}/archive', [$tasks, 'archive'], authenticated: true, csrf: true);
$router->add('POST', '/api/tasks/{taskId}/restore', [$tasks, 'restore'], authenticated: true, csrf: true);
$categories = new CategoryController(new CategoryService($pdo));
$router->add('GET', '/api/categories', [$categories, 'index'], authenticated: true);
$router->add('POST', '/api/categories', [$categories, 'create'], authenticated: true, csrf: true);
$router->add('PATCH', '/api/categories/{categoryId}', [$categories, 'rename'], authenticated: true, csrf: true);
$router->add('DELETE', '/api/categories/{categoryId}', [$categories, 'delete'], authenticated: true, csrf: true);
$subtasks = new SubtaskController(new SubtaskService($pdo));
$router->add('GET', '/api/tasks/{taskId}/subtasks', [$subtasks, 'index'], authenticated: true);
$router->add('POST', '/api/tasks/{taskId}/subtasks', [$subtasks, 'create'], authenticated: true, csrf: true);
$router->add('PUT', '/api/tasks/{taskId}/subtasks/order', [$subtasks, 'reorder'], authenticated: true, csrf: true);
$router->add('PATCH', '/api/tasks/{taskId}/subtasks/{subtaskId}', [$subtasks, 'update'], authenticated: true, csrf: true);
$router->add('DELETE', '/api/tasks/{taskId}/subtasks/{subtaskId}', [$subtasks, 'delete'], authenticated: true, csrf: true);
$router->dispatch(Request::fromGlobals());
