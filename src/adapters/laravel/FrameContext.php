<?php

declare(strict_types=1);

namespace Midad\Laravel;

use Closure;

final class FrameContext
{
    public function __construct(private readonly ?Closure $resolve = null) {}

    public function resolve(array $data): array
    {
        return $this->resolve === null ? $data : ($this->resolve)($data);
    }
}
