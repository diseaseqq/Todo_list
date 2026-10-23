<?php
declare(strict_types=1);

namespace TodoList\Http;

final class Request
{
    private function __construct(
        public readonly string $method,
        public readonly string $path,
    ) {
    }

    public static function fromGlobals(): self
    {
        $rawPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
        $path = is_string($rawPath) && $rawPath !== '' ? $rawPath : '/';
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

        return new self($method, $path);
    }
}
