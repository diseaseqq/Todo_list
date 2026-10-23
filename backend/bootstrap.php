<?php
declare(strict_types=1);

use TodoList\Config\AppConfig;

const TODO_LIST_ROOT = __DIR__ . '/..';

spl_autoload_register(static function (string $class): void {
    $prefix = 'TodoList\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }

    $relativeClass = substr($class, strlen($prefix));
    $file = __DIR__ . '/src/' . str_replace('\\', '/', $relativeClass) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

return AppConfig::fromEnvironment(TODO_LIST_ROOT);
