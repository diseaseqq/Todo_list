<?php
declare(strict_types=1);

namespace TodoList\Http;

final class Request
{
    private function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        public readonly array $body,
        public readonly array $headers,
    ) {
    }

    public static function fromGlobals(): self
    {
        $rawPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
        $path = is_string($rawPath) && $rawPath !== '' ? $rawPath : '/';
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $headers = function_exists('getallheaders') ? getallheaders() : [];
        $headers = array_change_key_case(is_array($headers) ? $headers : [], CASE_LOWER);
        $body = [];

        if (str_contains(strtolower((string) ($headers['content-type'] ?? '')), 'application/json')) {
            $rawBody = file_get_contents('php://input');
            if (is_string($rawBody) && strlen($rawBody) > 65536) {
                throw new ApiException('request_too_large', 'Request body is too large.', 413);
            }
            try {
                $decoded = json_decode($rawBody === false ? '' : $rawBody, false, 32, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                throw new ApiException('invalid_json', 'Request body must be valid JSON.', 400);
            }
            if (!$decoded instanceof \stdClass) {
                throw new ApiException('invalid_json', 'Request body must be a JSON object.', 400);
            }
            $body = get_object_vars($decoded);
        }

        return new self($method, $path, $_GET, $body, $headers);
    }

    public function header(string $name): ?string
    {
        $value = $this->headers[strtolower($name)] ?? null;
        return is_string($value) ? $value : null;
    }
}
