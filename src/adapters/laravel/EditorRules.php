<?php

declare(strict_types=1);

namespace Midad\Laravel;

final class EditorRules
{
    public static function presence(): array
    {
        return [
            'client_id' => ['required', 'uuid'],
            'anchor' => ['nullable', 'array:block,position'],
            'focus' => ['nullable', 'array:block,position'],
            'anchor.block' => ['required_with:anchor', 'string', 'max:4096'],
            'focus.block' => ['required_with:focus', 'string', 'max:4096'],
            'anchor.position' => ['required_with:anchor', 'string', 'max:8192', 'regex:/^[A-Za-z0-9+\/]*={0,2}$/'],
            'focus.position' => ['required_with:focus', 'string', 'max:8192', 'regex:/^[A-Za-z0-9+\/]*={0,2}$/'],
        ];
    }

    public static function synchronization(bool $read): array
    {
        return [
            'epoch' => [$read ? 'sometimes' : 'required', 'uuid'],
            'update' => [$read ? 'prohibited' : 'required', 'string', 'max:8388608', 'regex:/^[A-Za-z0-9+\/]*={0,2}$/'],
            'vector' => ['sometimes', 'string', 'max:87384', 'regex:/^[A-Za-z0-9+\/]*={0,2}$/'],
            'since_number' => ['sometimes', 'integer', 'min:1'],
            'base_number' => ['sometimes', 'integer', 'min:1'],
            'request_id' => ['sometimes', 'uuid'],
            'renderer_version' => ['required', 'string', 'regex:/^[a-f0-9]{64}$/'],
            'protocol_version' => ['sometimes', 'integer', 'min:1'],
            'restored_from_number' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
