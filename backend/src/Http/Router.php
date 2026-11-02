<?php
declare(strict_types=1);

namespace TodoList\Http;

final class Router
{
    /** @var array<string, array<string, array{handler: callable(Request): void, authenticated: bool, csrf: bool}>> */
    private array $routes = [];

    public function __construct(private readonly \TodoList\Config\AppConfig $config)
    {
    }

    /** @param callable(Request): void $handler */
    public function add(
        string $method,
        string $path,
        callable $handler,
        bool $authenticated = false,
        bool $csrf = false,
    ): void
    {
        $this->routes[$path][strtoupper($method)] = [
            'handler' => $handler,
            'authenticated' => $authenticated,
            'csrf' => $csrf,
        ];
    }

    public function dispatch(Request $request): void
    {
        $route = $this->routes[$request->path] ?? null;
        $params = [];
        if ($route === null) {
            foreach ($this->routes as $routePath => $methods) {
                $patternParts = [];
                foreach (explode('/', trim($routePath, '/')) as $part) {
                    if (preg_match('/^\{([A-Za-z][A-Za-z0-9_]*)\}$/', $part, $matches)) {
                        $patternParts[] = '(?P<' . $matches[1] . '>[^/]+)';
                    } else {
                        $patternParts[] = preg_quote($part, '~');
                    }
                }
                if (preg_match('~^/' . implode('/', $patternParts) . '/?$~', $request->path, $matches)) {
                    $route = $methods;
                    foreach ($matches as $key => $value) {
                        if (is_string($key)) {
                            $params[$key] = rawurldecode($value);
                        }
                    }
                    break;
                }
            }
        }
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
        if ($routeDefinition['csrf']) {
            Session::start($this->config);
            Session::verifyCsrfToken($request->header('x-csrf-token'));
        }

        ($routeDefinition['handler'])($request->withParams($params));
    }
}
