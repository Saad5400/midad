<?php

declare(strict_types=1);

namespace Midad\Php;

use Closure;
use RuntimeException;

final class Runtime
{
    private readonly array $build;

    public function __construct(
        string $manifest,
        private readonly string $socket,
        private readonly FontArchive $archive,
        private readonly ?Closure $assetUrl = null,
    ) {
        $this->build = json_decode(Files::read($manifest), true, flags: JSON_THROW_ON_ERROR);
        if (! is_string($this->build['version'] ?? null) || ! preg_match('/^[a-f0-9]{64}$/', $this->build['version'])
            || ! is_int($this->build['protocol'] ?? null) || $this->build['protocol'] < 1) {
            throw new RuntimeException('The editor runtime manifest is invalid.');
        }
    }

    public function version(): string
    {
        return $this->build['version'];
    }

    public function protocolVersion(): int
    {
        return $this->build['protocol'];
    }

    public function run(string $kind, array $input, ?string $directory = null, float $budget = 5): array
    {
        $result = (new TaskClient($this->socket, $this->version()))->request(
            ['kind' => $kind, 'directory' => $directory, 'input' => $input], $budget, $input['id'] ?? $kind,
        );
        if (! is_array($result)) {
            throw new TaskException('The editor task returned an invalid result.', 'invalid_response');
        }

        return $result;
    }

    public function current(): array
    {
        return $this->archive->current();
    }

    public function forSource(string $version, array $layout = [], float $budget = 4.5): array
    {
        return $this->archive->forSource($version, $layout, $budget);
    }

    public function asset(string $fingerprint, float $budget = 4.5): string
    {
        return $this->archive->asset($fingerprint, $budget);
    }

    public function descriptors(array $fonts, float $budget = 4.5): array
    {
        if ($this->assetUrl === null) {
            throw new RuntimeException('The host font URL resolver is missing.');
        }

        return array_map(fn (string $hash): array => ['hash' => $hash, 'url' => ($this->assetUrl)($hash)], $this->archive->prepare($fonts, $budget));
    }

    public function render(array $content, string $id, string $title, array $assets = [], float $budget = 5, bool $validateOnly = false, bool $includeContent = false, ?string $inputPdf = null, array $fillFields = [], ?array $sourceFonts = null, bool $pdfSurface = false, bool $prepareSource = false, bool $storedFields = false, ?array $frozenLayout = null): array
    {
        $started = microtime(true);
        $version = $this->version();
        $directory = sys_get_temp_dir().'/midad-'.bin2hex(random_bytes(16));
        Files::directory($directory);

        try {
            if ($prepareSource && ($inputPdf === null || $pdfSurface || $fillFields !== [] || $validateOnly || $includeContent)) {
                throw new RuntimeException('Invalid native source preparation input.');
            }
            if ($pdfSurface && ($inputPdf === null || $fillFields !== [])) {
                throw new RuntimeException('Invalid native PDF surface input.');
            }
            if ($inputPdf !== null) {
                if (! str_starts_with($inputPdf, '%PDF-') || strlen($inputPdf) > 60 * 1024 * 1024 || (! $pdfSurface && ! $prepareSource && ($validateOnly || $includeContent || $fillFields === []))) {
                    throw new RuntimeException('Invalid native PDF field-fill input.');
                }
                Files::write($directory.'/input.pdf', $inputPdf);
            }
            $manifest = [];
            foreach ($assets as $source => $bytes) {
                if (! is_string($source) || ! is_string($bytes) || strlen($bytes) > 30 * 1024 * 1024) {
                    throw new RuntimeException('Invalid native image asset.');
                }
                $filename = 'asset-'.count($manifest).'.bin';
                Files::write($directory.'/'.$filename, $bytes);
                $manifest[$source] = $filename;
            }
            $timeout = min(5, $budget) - (microtime(true) - $started);
            if ($timeout <= 0) {
                throw new RuntimeException('The native render exceeded its five-second budget.');
            }
            $fonts = $sourceFonts === null ? null : $this->archive->prepare($sourceFonts, $timeout);
            $timeout = min(5, $budget) - (microtime(true) - $started);
            if ($timeout <= 0) {
                throw new RuntimeException('The native render exceeded its five-second budget.');
            }
            $input = ['content' => $content, 'id' => $id, 'title' => $title, 'assets' => (object) $manifest, 'validateOnly' => $validateOnly, ...($storedFields ? ['storedFields' => true] : []), ...($frozenLayout !== null ? ['frozenLayout' => $frozenLayout] : []), 'includeContent' => $includeContent, ...($prepareSource ? ['prepareSource' => true] : ($pdfSurface ? ['pdfSurface' => true] : ($inputPdf !== null ? ['fillFields' => $fillFields] : []))), ...($fonts !== null ? ['fonts' => $fonts, 'fontRoot' => $this->archive->directory().'/files'] : [])];
            $metadata = $this->run('render', $input, $directory, $timeout);
            $metadata = $this->validateReviewMetadata($metadata);
            if ($validateOnly && ($metadata['version'] ?? null) === $version && ($metadata['validated'] ?? false)) {
                if ($includeContent && (! is_array($metadata['content'] ?? null) || ($metadata['content']['type'] ?? null) !== 'doc')) {
                    throw new RuntimeException('The native renderer did not return its prepared document.');
                }

                return ['metadata' => $metadata];
            }
            $path = $directory.'/document.pdf';
            if (($metadata['version'] ?? null) !== $version || ! is_file($path) || filesize($path) === 0) {
                throw new RuntimeException('The native renderer returned an invalid result.');
            }
            $stream = fopen($path, 'rb');
            $header = fread($stream, 5);
            fclose($stream);
            if ($header !== '%PDF-') {
                throw new RuntimeException('The native renderer did not return a PDF.');
            }
            $target = sys_get_temp_dir().'/midad-'.bin2hex(random_bytes(16)).'.pdf';
            rename($path, $target);
            chmod($target, 0600);

            return ['path' => $target, 'metadata' => $metadata];
        } finally {
            Files::remove($directory);
        }
    }

    private function validateReviewMetadata(array $metadata): array
    {
        $review = $metadata['review'] ?? null;
        if (! is_array($review) || ($review['encoding'] ?? null) !== 'deflate-base64') {
            return $metadata;
        }
        $bytes = is_string($review['data'] ?? null) ? base64_decode($review['data'], true) : false;
        if ($bytes === false || strlen($bytes) > 8 * 1024 * 1024) {
            throw new RuntimeException('The native renderer returned an invalid review index.');
        }
        $decoded = @gzuncompress($bytes, 32 * 1024 * 1024);
        if ($decoded === false) {
            throw new RuntimeException('The native renderer returned an invalid review index.');
        }
        $map = json_decode($decoded, true, flags: JSON_THROW_ON_ERROR);
        if (($map['version'] ?? null) !== 1 || ! is_array($map['blocks'] ?? null) || ! is_array($map['rows'] ?? null) || ! is_array($map['pages'] ?? null)) {
            throw new RuntimeException('The native renderer returned an invalid review index.');
        }

        return $metadata;
    }

    public function collaborate(array $input, float $budget = 5): array
    {
        $started = microtime(true);
        $encoded = json_encode($input, JSON_THROW_ON_ERROR);
        if (strlen($encoded) > 24 * 1024 * 1024) {
            throw new RuntimeException('The collaborative document is too large.');
        }
        $remaining = min(5, $budget) - (microtime(true) - $started);
        if ($remaining <= 0) {
            throw new TaskException('The task deadline has expired.', 'deadline');
        }
        $result = $this->run('collaboration', $input, budget: $remaining);
        if (($result['renderer'] ?? null) !== $this->version()
            || ! is_string($result['state'] ?? null) || ! is_string($result['epoch'] ?? null)
            || ! is_string($result['vector'] ?? null) || ! is_string($result['update'] ?? null)) {
            throw new RuntimeException('The collaborative result is invalid.');
        }

        return $result;
    }
}
