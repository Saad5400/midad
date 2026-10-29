<?php

declare(strict_types=1);

namespace Midad\Php;

use RuntimeException;

final class TaskException extends RuntimeException
{
    public function __construct(string $message, public readonly string $reason = 'unavailable')
    {
        parent::__construct($message);
    }
}
