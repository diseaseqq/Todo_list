<?php
declare(strict_types=1);

namespace TodoList\Controller;

use TodoList\Http\JsonResponse;
use TodoList\Http\Request;
use TodoList\Http\Session;
use TodoList\Service\CategoryService;

final class CategoryController
{
    public function __construct(private readonly CategoryService $categories)
    {
    }

    public function index(Request $request): void
    {
        JsonResponse::send(['categories' => $this->categories->list(Session::requireUserId())]);
    }

    public function create(Request $request): void
    {
        JsonResponse::send(['category' => $this->categories->create(Session::requireUserId(), $request->body)], 201);
    }

    public function rename(Request $request): void
    {
        JsonResponse::send([
            'category' => $this->categories->rename(
                Session::requireUserId(),
                $request->params['categoryId'] ?? '',
                $request->body,
            ),
        ]);
    }

    public function delete(Request $request): void
    {
        $this->categories->delete(
            Session::requireUserId(),
            $request->params['categoryId'] ?? '',
            $request->body,
        );
        JsonResponse::send(['status' => 'deleted']);
    }
}
