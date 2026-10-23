<?php
declare(strict_types=1);

namespace TodoList\Http;

use RuntimeException;

final class ApiException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $status,
    ) {
        parent::__construct($message);
    }
}
