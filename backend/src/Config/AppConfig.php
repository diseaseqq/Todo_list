<?php
declare(strict_types=1);

namespace TodoList\Config;

use InvalidArgumentException;

final class AppConfig
{
    private function __construct(
        public readonly string $environment,
        public readonly string $databasePath,
    ) {
    }

    public static function fromEnvironment(string $projectRoot): self
    {
        $environment = getenv('TODO_ENV') ?: 'production';
        if (!in_array($environment, ['development', 'test', 'production'], true)) {
            throw new InvalidArgumentException('TODO_ENV must be development, test, or production.');
        }

        $databasePath = getenv('TODO_DB_PATH') ?: '';
        if ($databasePath === '') {
            if ($environment === 'production') {
                throw new InvalidArgumentException('TODO_DB_PATH must be configured in production.');
            }

            $databasePath = $projectRoot . '/storage/app.sqlite';
        }
        $isAbsolutePath = str_starts_with($databasePath, DIRECTORY_SEPARATOR)
            || preg_match('/^[A-Za-z]:[\\\\\/]/', $databasePath) === 1
            || str_starts_with($databasePath, '\\\\');
        if (!$isAbsolutePath) {
            $databasePath = $projectRoot . '/' . $databasePath;
        }

        $publicRoot = realpath($projectRoot . '/public');
        $databaseDirectory = realpath(dirname($databasePath));
        if ($publicRoot !== false && $databaseDirectory !== false) {
            $publicRoot = rtrim($publicRoot, DIRECTORY_SEPARATOR);
            $databaseDirectory = rtrim($databaseDirectory, DIRECTORY_SEPARATOR);
            if (
                $databaseDirectory === $publicRoot ||
                str_starts_with($databaseDirectory . DIRECTORY_SEPARATOR, $publicRoot . DIRECTORY_SEPARATOR)
            ) {
                throw new InvalidArgumentException('TODO_DB_PATH must be outside the public directory.');
            }
        }

        return new self($environment, $databasePath);
    }

    public function isProduction(): bool
    {
        return $this->environment === 'production';
    }
}
