# JSON API

All routes are served by `public/index.php` and use JSON. Protected routes require the session cookie created by login. Every state-changing route requires the `X-CSRF-Token` header. Get a token from `GET /api/auth/csrf`; login and `GET /api/auth/me` also return the current token.

`GET /api/health` is public and returns basic application health information.

Successful responses use HTTP 200 unless noted. Invalid JSON returns 400, unauthenticated requests 401, unknown routes or records 404, method mismatches 405, oversized request bodies 413, validation errors 422, and state/version conflicts 409. Errors have the shape `{"error":{"code":"...","message":"..."}}`.

## Accounts

| Method and path | Body | Result |
| --- | --- | --- |
| `GET /api/auth/csrf` | — | `csrf_token` |
| `POST /api/auth/register` | `email`, `password` | 201, public `account` |
| `POST /api/auth/login` | `email`, `password` | public `account`, `csrf_token`; establishes session |
| `POST /api/auth/logout` | — | `status: "ok"`; destroys session |
| `GET /api/auth/me` | — | public `account`, `csrf_token` |

Registration requires a valid email and a password from 12 to 72 bytes. There is no public account administration API.

## Tasks

| Method and path | Body or query | Result |
| --- | --- | --- |
| `GET /api/tasks` | Query: `archived`, `completed`, `category_id`, `q`, `sort`, `direction` | `tasks` |
| `POST /api/tasks` | `title`, optional `description`, `priority`, `due_date`, `category_id`, `recurrence` | 201, `task` |
| `GET /api/tasks/{taskId}` | — | `task` |
| `PATCH /api/tasks/{taskId}` | required `version`; task fields to change | `task` |
| `POST /api/tasks/{taskId}/complete` | required `version`, boolean `is_completed` | `task` |
| `POST /api/tasks/{taskId}/archive` | required `version` | `task` |
| `POST /api/tasks/{taskId}/restore` | required `version` | `task` |
| `DELETE /api/tasks/{taskId}` | required `version` | `status: "deleted"` |

Task titles are 3–150 characters, descriptions up to 500 characters, and priorities are `low`, `medium`, or `high`. Dates use `YYYY-MM-DD`. Sort keys are `created`, `due_date`, `title`, and `priority`; direction is `asc` or `desc`. Search matches title and description without regard to case. Archived tasks are excluded unless `archived=true` is supplied.

`recurrence` is either `null` or an object such as `{"type":"weekly"}` or `{"type":"custom","interval":10}`. Supported types are `daily`, `weekly`, `monthly`, and `custom`; custom intervals are 1–365 days. A due date is required for a recurring task. Completing an active recurring occurrence creates its next occurrence in the same transaction. Rule edits create a new rule version and recalculate future open occurrence dates; completed occurrences retain their previous rule link. Duplicate dates within a series are prevented by a unique index.

## Subtasks

All subtask paths are nested under an owned, unarchived task. Mutations require the parent task's current `task_version`; each successful mutation increments it and returns the updated version and complete subtask list.

| Method and path | Body | Result |
| --- | --- | --- |
| `GET /api/tasks/{taskId}/subtasks` | — | `task_version`, `subtasks` |
| `POST /api/tasks/{taskId}/subtasks` | `task_version`, `title`, optional `sort_order` | 201, updated list |
| `PATCH /api/tasks/{taskId}/subtasks/{subtaskId}` | `task_version`, one or more of `title`, `is_completed`, `sort_order` | updated list |
| `DELETE /api/tasks/{taskId}/subtasks/{subtaskId}` | `task_version` | updated list |
| `PUT /api/tasks/{taskId}/subtasks/order` | `task_version`, `subtask_ids` containing each ID once | reordered list |

## Categories, statistics, and archive

| Method and path | Body or query | Result |
| --- | --- | --- |
| `GET /api/categories` | — | `categories` |
| `POST /api/categories` | `name` | 201, `category` |
| `PATCH /api/categories/{categoryId}` | `version`, `name` | `category` |
| `DELETE /api/categories/{categoryId}` | `version` | `status: "deleted"`; tasks are kept and unassigned |
| `GET /api/stats` | — | `statistics` |
| `POST /api/archive/restore-all` | — | `restored` count |
| `DELETE /api/archive` | `confirm: true` | `deleted` count |

Category names are unique per account, ignoring case. Category rename and delete use optimistic `version` checks. All reads and writes are scoped to the authenticated account.
