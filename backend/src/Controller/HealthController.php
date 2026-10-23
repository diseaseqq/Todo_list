<?php
declare(strict_types=1);

namespace TodoList\Controller;

use TodoList\Config\AppConfig;
use TodoList\Database\SqliteConnection;
use TodoList\Http\JsonResponse;
use TodoList\Http\Request;

final class HealthController
{
    public function __construct(private readonly AppConfig $config)
    {
    }

    public function __invoke(Request $request): void
    {
        SqliteConnection::connect($this->config->databasePath)->query('SELECT 1')->fetchColumn();
        JsonResponse::send(['status' => 'ok']);
    }
}
