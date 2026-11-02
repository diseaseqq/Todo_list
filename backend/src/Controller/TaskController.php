<?php
declare(strict_types=1);

namespace TodoList\Controller;

use TodoList\Http\JsonResponse;
use TodoList\Http\Request;
use TodoList\Http\Session;
use TodoList\Service\TaskService;

final class TaskController
{
    public function __construct(private readonly TaskService $tasks)
    {
    }

    public function index(Request $request): void
    {
        JsonResponse::send(['tasks' => $this->tasks->list(Session::requireUserId(), $request->query)]);
    }

    public function show(Request $request): void
    {
        JsonResponse::send(['task' => $this->tasks->get(Session::requireUserId(), $this->taskId($request))]);
    }

    public function create(Request $request): void
    {
        JsonResponse::send(['task' => $this->tasks->create(Session::requireUserId(), $request->body)], 201);
    }

    public function update(Request $request): void
    {
        JsonResponse::send([
            'task' => $this->tasks->update(Session::requireUserId(), $this->taskId($request), $request->body),
        ]);
    }

    public function complete(Request $request): void
    {
        JsonResponse::send([
            'task' => $this->tasks->setCompleted(Session::requireUserId(), $this->taskId($request), $request->body),
        ]);
    }

    public function archive(Request $request): void
    {
        JsonResponse::send([
            'task' => $this->tasks->archive(Session::requireUserId(), $this->taskId($request), $request->body),
        ]);
    }

    public function restore(Request $request): void
    {
        JsonResponse::send([
            'task' => $this->tasks->restore(Session::requireUserId(), $this->taskId($request), $request->body),
        ]);
    }

    public function delete(Request $request): void
    {
        $this->tasks->delete(Session::requireUserId(), $this->taskId($request), $request->body);
        JsonResponse::send(['status' => 'deleted']);
    }

    public function restoreAll(Request $request): void
    {
        JsonResponse::send($this->tasks->restoreAll(Session::requireUserId()));
    }

    public function clearArchive(Request $request): void
    {
        JsonResponse::send($this->tasks->clearArchive(Session::requireUserId(), $request->body));
    }

    public function statistics(Request $request): void
    {
        JsonResponse::send(['statistics' => $this->tasks->statistics(Session::requireUserId())]);
    }

    private function taskId(Request $request): string
    {
        return $request->params['taskId'] ?? '';
    }
}
