<?php
declare(strict_types=1);

namespace TodoList\Service;

use DateTimeImmutable;
use DateTimeZone;
use TodoList\Http\ApiException;

final class RecurrenceCalculator
{
    /** @return array{type: string, interval: ?int} */
    public static function normalize(mixed $value): ?array
    {
        if ($value === null) {
            return null;
        }
        if ($value instanceof \stdClass) {
            $value = get_object_vars($value);
        }
        if (!is_array($value) || !is_string($value['type'] ?? null)) {
            throw new ApiException('validation_error', 'recurrence must be null or an object with a type.', 422);
        }
        $type = $value['type'];
        if (!in_array($type, ['daily', 'weekly', 'monthly', 'custom'], true)) {
            throw new ApiException('validation_error', 'Unsupported recurrence type.', 422);
        }
        if ($type === 'custom') {
            $interval = $value['interval'] ?? null;
            if (!is_int($interval) || $interval < 1 || $interval > 365) {
                throw new ApiException('validation_error', 'Custom recurrence interval must be from 1 to 365 days.', 422);
            }
            return ['type' => $type, 'interval' => $interval];
        }
        if (isset($value['interval']) && $value['interval'] !== 1) {
            throw new ApiException('validation_error', 'interval is only configurable for custom recurrence.', 422);
        }
        return ['type' => $type, 'interval' => null];
    }

    public static function nextDate(
        ?string $currentDueDate,
        string $type,
        ?int $intervalDays,
        ?int $anchorDay,
        ?string $today = null,
    ): string {
        $timezone = new DateTimeZone('UTC');
        $todayDate = DateTimeImmutable::createFromFormat('!Y-m-d', $today ?? gmdate('Y-m-d'), $timezone);
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $currentDueDate ?? $todayDate->format('Y-m-d'), $timezone);
        if ($date === false || $todayDate === false) {
            throw new ApiException('invalid_state', 'The recurring task contains an invalid date.', 409);
        }

        do {
            if ($type === 'daily') {
                $date = $date->modify('+1 day');
            } elseif ($type === 'weekly') {
                $date = $date->modify('+7 days');
            } elseif ($type === 'custom') {
                $date = $date->modify('+' . (int) $intervalDays . ' days');
            } elseif ($type === 'monthly') {
                $day = $anchorDay ?? (int) $date->format('j');
                $firstOfNextMonth = $date->modify('first day of next month');
                $lastDay = (int) $firstOfNextMonth->format('t');
                $date = $firstOfNextMonth->setDate(
                    (int) $firstOfNextMonth->format('Y'),
                    (int) $firstOfNextMonth->format('n'),
                    min($day, $lastDay),
                );
            } else {
                throw new ApiException('invalid_state', 'The recurring task has an invalid recurrence type.', 409);
            }
        } while ($date <= $todayDate);

        return $date->format('Y-m-d');
    }
}
