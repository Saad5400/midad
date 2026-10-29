<?php

namespace Midad\Laravel;

use Illuminate\Validation\ValidationException;
use Midad\Php\Runtime;

final class PdfDocumentValidator
{
    public function __construct(private readonly ?Runtime $runtime = null) {}

    public function validate(array &$newContent, ?array $oldContent = null): void
    {
        if (($newContent['type'] ?? null) !== 'doc') {
            $this->fail('Invalid PDF document.');
        }

        $newPages = $this->extractPages($newContent);

        if ($newPages === []) {
            $this->fail('PDF document must contain at least one page.');
        }

        if ($oldContent !== null) {
            $oldPages = $this->collectPdfPagesOnly($oldContent);

            if ($oldPages !== [] && count($oldPages) !== count($newPages)) {
                $this->fail('PDF page count cannot change.');
            }

            foreach ($oldPages as $i => $oldPage) {
                if (($oldPage['attrs']['number'] ?? null) !== ($newPages[$i]['attrs']['number'] ?? null)) {
                    $this->fail('PDF page attributes cannot change.');
                }
            }
        }

        $newContent['content'] = array_map($this->normalizePage(...), $newPages);
        if ($this->runtime !== null && isset($newContent['attrs']['nativePdfSource'])) {
            $newContent['attrs']['nativeEditor'] = ['schema' => 1, 'renderer' => $this->runtime->version(), 'surface' => 'pdf'];
        }
    }

    private function normalizePage(array $page): array
    {
        $page['attrs'] = array_filter(
            ['number' => $page['attrs']['number'] ?? null, 'nativeId' => $page['attrs']['nativeId'] ?? null],
            fn ($value) => $value !== null,
        );

        return $page;
    }

    private function extractPages(array $doc): array
    {
        $pages = [];
        foreach (($doc['content'] ?? []) as $node) {
            if (! is_array($node)) {
                $this->fail('Only PDF pages are allowed at the document root.');
            }
            if (($node['type'] ?? null) !== 'pdfPage') {
                $this->fail('Only PDF pages are allowed at the document root.');
            }
            $pages[] = $node;
        }

        return $pages;
    }

    private function collectPdfPagesOnly(array $doc): array
    {
        if (($doc['type'] ?? null) !== 'doc') {
            return [];
        }

        $pages = [];
        foreach (($doc['content'] ?? []) as $node) {
            if (is_array($node) && ($node['type'] ?? null) === 'pdfPage') {
                $pages[] = $node;
            }
        }

        return $pages;
    }

    private function fail(string $message): never
    {
        throw ValidationException::withMessages(['content' => $message]);
    }
}
