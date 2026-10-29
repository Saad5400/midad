<?php

declare(strict_types=1);

namespace Midad\Laravel;

use Illuminate\Support\Facades\Cache;

final class Presence
{
    public function __construct(private readonly string $secret) {}

    public function active(string $document): array
    {
        return array_values(array_filter(Cache::get($this->key($document), []), fn (array $entry): bool => $entry['expires'] > time()));
    }

    public function identity(string $document, string $user): string
    {
        return hash_hmac('sha256', $document.':'.$user, $this->secret);
    }

    public function update(string $document, string $user, string $name, bool $writable, array $input, bool $leave): array
    {
        return Cache::lock($this->key($document).':lock', 3)->block(1, function () use ($document, $user, $name, $writable, $input, $leave): array {
            $identity = $this->identity($document, $user);
            $entries = array_filter($this->active($document), fn (array $entry): bool => $entry['user'] !== $identity || $entry['client_id'] !== $input['client_id']);
            if (! $leave) {
                $colors = ['#2563eb', '#b91c1c', '#0f766e', '#7c3aed', '#a16207', '#be185d'];
                $entries[] = ['user' => $identity, 'client_id' => $input['client_id'], 'name' => $name,
                    'color' => $colors[hexdec(substr(hash('sha256', $input['client_id']), 0, 4)) % count($colors)],
                    'writable' => $writable, 'expires' => time() + 20, 'anchor' => $input['anchor'] ?? null, 'focus' => $input['focus'] ?? null];
            }
            $entries = array_slice(array_values($entries), -200);
            Cache::put($this->key($document), $entries, 25);

            return $entries;
        });
    }

    private function key(string $document): string
    {
        return 'midad:presence:'.hash('sha256', $document);
    }
}
