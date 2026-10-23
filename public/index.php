<?php
declare(strict_types=1);

use TodoList\Http\JsonResponse;
use TodoList\Http\Request;
use TodoList\Http\Router;
use TodoList\Controller\HealthController;

ini_set('display_errors', '0');
ini_set('log_errors', '1');

set_exception_handler(static function (Throwable $exception): void {
    error_log((string) $exception);
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo '{"error":{"code":"internal_error","message":"Internal server error."}}';
});

$config = require dirname(__DIR__) . '/backend/bootstrap.php';

$router = new Router($config);
$router->add('GET', '/api/health', new HealthController($config));
$router->dispatch(Request::fromGlobals());
