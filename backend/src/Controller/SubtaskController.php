<?php
declare(strict_types=1);

namespace TodoList\Controller;

use TodoList\Http\JsonResponse;
use TodoList\Http\Request;
use TodoList\Http\Session;
use TodoList\Service\SubtaskService;

final class SubtaskController
{
    public function __construct(private readonly SubtaskService $subtasks)
    {
    }

    public function index(Request $request): void
    {
        JsonResponse::send($this->subtasks->list(Session::requireUserId(), $this->taskId($request)));
    }

    public function create(Request $request): void
    {
        JsonResponse::send(
            $this->subtasks->create(Session::requireUserId(), $this->taskId($request), $request->body),
            201,
        );
    }

    public function update(Request $request): void
    {
        JsonResponse::send($this->subtasks->update(
            Session::requireUserId(),
            $this->taskId($request),
            $this->subtaskId($request),
            $request->body,
        ));
    }

    public function delete(Request $request): void
    {
        JsonResponse::send($this->subtasks->delete(
            Session::requireUserId(),
            $this->taskId($request),
            $this->subtaskId($request),
            $request->body,
        ));
    }

    public function reorder(Request $request): void
    {
        JsonResponse::send(
            $this->subtasks->reorder(Session::requireUserId(), $this->taskId($request), $request->body),
        );
    }

    private function taskId(Request $request): string
    {
        return $request->params['taskId'] ?? '';
    }

    private function subtaskId(Request $request): string
    {
        return $request->params['subtaskId'] ?? '';
    }
}
