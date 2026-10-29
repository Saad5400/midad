<?php

declare(strict_types=1);

namespace Midad\Php;

use Closure;
use RuntimeException;

final class FontArchive
{
    public function __construct(
        private readonly string $root,
        private readonly array $currentFonts,
        private readonly ?Closure $restore = null,
    ) {}

    public function directory(): string
    {
        return $this->root;
    }

    public function current(): array
    {
        return $this->fonts($this->currentFonts);
    }

    public function forSource(string $version, array $layout = [], float $budget = 4.5): array
    {
        if ($budget <= 0) {
            throw new RuntimeException('Native font preparation exceeded its budget.');
        }
        $this->identity($version);
        if (is_array($layout['fonts'] ?? null)) {
            return $this->fonts($layout['fonts']);
        }
        $path = $this->directory().'/manifests/'.$version.'.json';
        if (is_file($path)) {
            $manifest = json_decode(Files::read($path), true, flags: JSON_THROW_ON_ERROR);
            if (($manifest['version'] ?? null) !== $version) {
                throw new RuntimeException('Invalid native font manifest identity.');
            }

            return $this->fonts($manifest['fonts'] ?? []);
        }
        $bytes = $this->restore('manifests/'.$version.'.json', $budget);
        if ($bytes !== null) {
            if (strlen($bytes) > 128 * 1024) {
                throw new RuntimeException('Invalid native font manifest.');
            }
            $manifest = json_decode($bytes, true, flags: JSON_THROW_ON_ERROR);
            if (($manifest['version'] ?? null) !== $version) {
                throw new RuntimeException('Invalid native font manifest identity.');
            }
            $fonts = $this->fonts($manifest['fonts'] ?? []);
            $this->write($path, json_encode(['version' => $version, 'fonts' => $fonts], JSON_THROW_ON_ERROR));

            return $fonts;
        }

        return $this->current();
    }

    public function prepare(array $fonts, float $budget = 4.5): array
    {
        $fonts = $this->fonts($fonts);
        $deadline = microtime(true) + $budget;
        foreach ($fonts as $fingerprint) {
            $this->asset($fingerprint, $deadline - microtime(true));
        }

        return $fonts;
    }

    public function asset(string $fingerprint, float $budget = 4.5): string
    {
        $this->identity($fingerprint);
        if ($budget <= 0) {
            throw new RuntimeException('Native font preparation exceeded its budget.');
        }
        $path = $this->directory().'/files/'.$fingerprint.'.ttf';
        if (is_file($path)) {
            if (! hash_equals($fingerprint, hash_file('sha256', $path))) {
                throw new RuntimeException('An archived native font was modified.');
            }

            return $path;
        }
        $bytes = $this->restore('files/'.$fingerprint.'.ttf', $budget);
        if (! is_string($bytes) || strlen($bytes) > 10 * 1024 * 1024 || ! hash_equals($fingerprint, hash('sha256', $bytes))) {
            throw new RuntimeException('The historical native font is unavailable or invalid.');
        }
        $this->write($path, $bytes);

        return $path;
    }

    private function fonts(array $fonts): array
    {
        if ($fonts === [] || count($fonts) > 512) {
            throw new RuntimeException('Invalid native font manifest.');
        }
        foreach ($fonts as $file => $fingerprint) {
            if (! is_string($file) || ! preg_match('/^[a-z0-9-]+$/i', $file) || ! is_string($fingerprint)) {
                throw new RuntimeException('Invalid native font manifest.');
            }
            $this->identity($fingerprint);
        }

        return $fonts;
    }

    private function restore(string $suffix, float $budget): ?string
    {
        return $this->restore === null ? null : ($this->restore)($suffix, $budget);
    }

    private function identity(string $fingerprint): void
    {
        if (! preg_match('/^[a-f0-9]{64}$/', $fingerprint)) {
            throw new RuntimeException('Invalid native font identity.');
        }
    }

    private function write(string $path, string $bytes): void
    {
        Files::write($path, $bytes);
    }
}
