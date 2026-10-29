<?php

declare(strict_types=1);

namespace Midad\Php;

final class StateEnvelope
{
    public static function read(?string $stored, array|string|null $previous = null): ?array
    {
        if ($stored !== null && str_starts_with($stored, 'midad:1:')) {
            return json_decode(substr($stored, 8), true, flags: JSON_THROW_ON_ERROR)['state'];
        }

        return is_string($previous) ? json_decode($previous, true, flags: JSON_THROW_ON_ERROR) : $previous;
    }

    public static function write(?string $stored, ?array $state, array|string|null $previous = null): ?string
    {
        if ($state === null && $stored === null && $previous === null) {
            return null;
        }
        $legacy = $stored !== null && str_starts_with($stored, 'midad:1:')
            ? json_decode(substr($stored, 8), true, flags: JSON_THROW_ON_ERROR)['legacy']
            : ($stored === null ? null : base64_encode($stored));

        return 'midad:1:'.json_encode(['state' => $state, 'legacy' => $legacy], JSON_THROW_ON_ERROR);
    }

    public static function canonical(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value);
        }

        return array_map(self::canonical(...), $value);
    }

    public static function hash(mixed $value): string
    {
        return hash('sha256', json_encode(self::canonical($value), JSON_THROW_ON_ERROR));
    }
}
