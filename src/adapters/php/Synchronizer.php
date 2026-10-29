<?php

declare(strict_types=1);

namespace Midad\Php;

use Closure;

final class Synchronizer
{
    public function __construct(private readonly Runtime $runtime) {}

    public function synchronize(array $snapshot, array $context, array $input, bool $write, Closure $initialize, Closure $accept, Closure $store, float $budget = 5): array
    {
        $deadline = microtime(true) + min(5, $budget);
        $remaining = fn (): float => $deadline - microtime(true);
        $protocol = $this->runtime->protocolVersion();
        if ((int) ($input['protocol_version'] ?? 3) !== $protocol || ($input['renderer_version'] ?? null) !== $this->runtime->version()) {
            throw new TaskException('The shared editor renderer changed.', 'renderer_changed');
        }
        $basis = StateEnvelope::hash($snapshot['content']);
        $shared = $snapshot['shared'];
        $number = $snapshot['number'];
        $identity = [...$context, 'renderer' => $input['renderer_version'], 'protocol' => $protocol];
        if (! is_array($shared) || ! is_string($shared['state'] ?? null) || ! is_string($shared['epoch'] ?? null)
            || ($shared['basis'] ?? null) !== $basis || StateEnvelope::canonical(array_intersect_key($shared, $identity)) !== StateEnvelope::canonical($identity)) {
            $content = $initialize($snapshot['content'], $remaining());
            $seed = $this->runtime->collaborate(['id' => $context['id'], 'content' => $content, 'initializeTypography' => $context['initializeTypography'] ?? false], $remaining());
            $shared = [...$identity, 'state' => $seed['state'], 'epoch' => $seed['epoch'], 'vector' => $seed['vector'], 'basis' => $basis,
                ...(($context['pdfSource'] ?? null) !== null ? ['preparedBasis' => StateEnvelope::hash($content)] : [])];
            $number = $store($snapshot['content'], $shared, null, false);
        }
        if ($write && ! hash_equals($shared['epoch'], $input['epoch'])) {
            throw new TaskException('The shared document was replaced.', 'content_changed');
        }
        $requestHash = $write ? hash('sha256', $input['update'].'|'.($input['restored_from_number'] ?? '')) : null;
        $requestId = $input['request_id'] ?? null;
        $replayed = $write && $requestId && isset($shared['requests'][$requestId]);
        if ($replayed && $shared['requests'][$requestId] !== $requestHash) {
            throw new TaskException('A request identifier was reused with different content.', 'request_reused');
        }
        $apply = $write && ! $replayed;
        if ($apply && isset($input['restored_from_number']) && (int) ($input['base_number'] ?? 0) !== $number) {
            throw new TaskException('The document changed before history restoration.', 'content_changed');
        }
        $replaced = isset($input['epoch']) && ! hash_equals($shared['epoch'], $input['epoch']);
        if (! $write && ! $replaced && isset($input['since_number']) && (int) $input['since_number'] === $number) {
            return ['epoch' => $shared['epoch'], 'number' => $number, 'changed' => false];
        }
        if (! $write && ($replaced || ! isset($input['vector']))) {
            return ['epoch' => $shared['epoch'], 'number' => $number, 'state' => $shared['state'], 'vector' => $shared['vector'], 'changed' => true,
                'persisted' => ($snapshot['content']['attrs']['nativeEditor']['renderer'] ?? null) === $input['renderer_version'] && ($shared['preparedBasis'] ?? $basis) === $basis];
        }
        $result = $this->runtime->collaborate(['id' => $context['id'], 'state' => $shared['state'],
            ...($apply ? ['update' => $input['update'], 'includeContent' => true] : []),
            ...(isset($input['vector']) ? ['vector' => $input['vector']] : []),
        ], $remaining());
        if ($result['epoch'] !== $shared['epoch']) {
            throw new TaskException('The update belongs to a different shared document.', 'invalid_input');
        }
        if ($apply) {
            $content = $result['content'];
            $nextContext = $accept($content, $remaining());
            $envelope = [...$identity, ...$nextContext, 'state' => $result['state'], 'epoch' => $result['epoch'], 'vector' => $result['vector'],
                'basis' => StateEnvelope::hash($content), 'requests' => array_slice($shared['requests'] ?? [], -127, null, true)];
            if ($requestId) {
                $envelope['requests'][$requestId] = $requestHash;
            }
            $number = $store($content, $envelope, isset($input['restored_from_number']) ? (int) $input['restored_from_number'] : null, StateEnvelope::canonical($content) !== StateEnvelope::canonical($snapshot['content']) || isset($input['restored_from_number']));
        }
        if ($remaining() <= 0) {
            throw new TaskException('The task deadline has expired.', 'deadline');
        }

        return ['epoch' => $result['epoch'], 'number' => $number, 'vector' => $result['vector'], 'update' => $result['update'], 'changed' => true];
    }
}
