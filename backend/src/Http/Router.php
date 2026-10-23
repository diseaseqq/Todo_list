<?php
declare(strict_types=1);

namespace TodoList\Http;

final class Router
{
    /** @var array<string, array<string, array{handler: callable(Request): void, authenticated: bool}>> */
    private array $routes = [];

    public function __construct(private readonly \TodoList\Config\AppConfig $config)
    {
    }

    /** @param callable(Request): void $handler */
    public function add(string $method, string $path, callable $handler, bool $authenticated = false): void
    {
        $this->routes[$path][strtoupper($method)] = [
            'handler' => $handler,
            'authenticated' => $authenticated,
        ];
    }

    public function dispatch(Request $request): void
    {
        $route = $this->routes[$request->path] ?? null;
        if ($route === null) {
            JsonResponse::send(['error' => ['code' => 'not_found', 'message' => 'Route not found.']], 404);
        }

        $routeDefinition = $route[$request->method] ?? null;
        if ($routeDefinition === null) {
            header('Allow: ' . implode(', ', array_keys($route)));
            JsonResponse::send(['error' => ['code' => 'method_not_allowed', 'message' => 'Method not allowed.']], 405);
        }

        if ($routeDefinition['authenticated']) {
            Session::start($this->config);
            Session::requireUserId();
        }

        ($routeDefinition['handler'])($request);
    }
}
