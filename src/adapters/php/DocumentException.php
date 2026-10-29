<?php

declare(strict_types=1);

namespace Midad\Php;

use RuntimeException;

final class DocumentException extends RuntimeException
{
    public function __construct(string $message, public readonly string $reason, int $status)
    {
        parent::__construct($message, $status);
    }

    public static function changed(string $message, string $reason = 'content_changed'): self
    {
        return new self($message, $reason, 409);
    }

    public static function unavailable(): self
    {
        return new self('The requested document is unavailable.', 'document_unavailable', 404);
    }

    public static function sourceChanged(): self
    {
        return new self('The document source changed. Reload before submitting.', 'native_source_changed', 409);
    }
}
