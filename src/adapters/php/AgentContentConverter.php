<?php

declare(strict_types=1);

namespace Midad\Php;

use JsonException;

final class AgentContentConverter
{
    public function __construct(private readonly ?Runtime $runtime = null, private readonly array $calendars = ['hijri', 'gregorian']) {}

    private const VARIABLE_REGEX = '/<variable\b([^>]*)\/?>/i';

    private const VARIABLE_TYPES = [
        'text', 'date', 'signature', 'initials', 'stamp', 'attachment', 'choice', 'single', 'multi',
    ];

    private const VARIABLE_DIMENSIONS = [
        'date' => ['width' => 92, 'height' => 24],
        'signature' => ['width' => 250, 'height' => 80],
        'stamp' => ['width' => 250, 'height' => 80],
        'initials' => ['width' => 129, 'height' => 43],
    ];

    private const DEFAULT_VARIABLE_WIDTH = 200;

    private const DEFAULT_VARIABLE_HEIGHT = 24;

    public function toTipTapArray(mixed $content): array
    {
        if (is_array($content)) {
            return $this->arrayToDocument($content);
        }

        if (is_string($content) && trim($content) !== '') {
            $decoded = $this->tryDecodeJsonObject($content);
            if (is_array($decoded)) {
                return $this->arrayToDocument($decoded);
            }

            return $this->importHtml($content);
        }

        return $this->emptyDocument();
    }

    private function arrayToDocument(array $candidate): array
    {
        if ($this->isAgentDraftSchema($candidate)) {
            return $this->translateAgentDoc($candidate);
        }

        if ($this->isDocument($candidate)) {
            return $candidate;
        }

        return $this->emptyDocument();
    }

    private function isDocument(array $candidate): bool
    {
        return ($candidate['type'] ?? null) === 'doc' && array_key_exists('content', $candidate);
    }

    private function isAgentDraftSchema(array $candidate): bool
    {
        return ($candidate['type'] ?? null) === 'doc'
            && isset($candidate['blocks'])
            && is_array($candidate['blocks']);
    }

    private function translateAgentDoc(array $doc): array
    {
        $dir = ((string) ($doc['language'] ?? 'en')) === 'ar' ? 'rtl' : 'ltr';
        $content = $this->translateBlocks((array) ($doc['blocks'] ?? []), $dir);
        if ($content === []) {
            $content = [['type' => 'paragraph', 'attrs' => ['dir' => $dir]]];
        }

        return [
            'type' => 'doc',
            'attrs' => ['blockVariables' => []],
            'content' => $content,
        ];
    }

    private function translateBlocks(array $blocks, string $dir): array
    {
        $out = [];
        $position = 0;
        foreach ($blocks as $block) {
            if (! is_array($block)) {
                continue;
            }
            $position++;
            foreach ($this->translateBlock($block, $dir, $position) as $node) {
                $out[] = $node;
            }
        }

        return $out;
    }

    private function translateBlock(array $block, string $dir, int $position): array
    {
        $type = (string) ($block['type'] ?? '');

        return match ($type) {
            'paragraph' => [$this->makeParagraph((string) ($block['content'] ?? $block['text'] ?? ''), $dir)],
            'clause' => $this->translateClause($block, $dir, $position),
            'list' => [$this->translateList($block, $dir)],
            'table' => $this->translateTable($block, $dir),
            'heading' => [$this->translateHeading($block, $dir)],
            'blockquote' => [$this->translateBlockquote($block, $dir)],
            'codeBlock', 'code_block' => [$this->translateCodeBlock($block)],
            'horizontalRule', 'horizontal_rule', 'hr' => [['type' => 'horizontalRule']],
            'image' => $this->translateImage($block),
            default => $this->translateUnknown($block, $dir),
        };
    }

    private function translateClause(array $block, string $dir, int $position): array
    {
        $clauseId = $this->stringOrUuid($block['id'] ?? null);
        $order = $this->positiveInt($block['order'] ?? null, $position);
        $contentHash = $this->nullableString($block['content_hash'] ?? null);

        $titleInline = $this->parseInline((string) ($block['title'] ?? ''));
        $titleNode = ['type' => 'clauseTitle'];
        if ($titleInline !== []) {
            $titleNode['content'] = $titleInline;
        }
        $bodyBlocks = $this->translateBlocks((array) ($block['body'] ?? []), $dir);
        if ($bodyBlocks === []) {
            $bodyBlocks = [$this->makeParagraph('', $dir)];
        }
        $bodyNode = [
            'type' => 'clauseBody',
            'content' => $bodyBlocks,
        ];

        $variant = [
            'id' => $clauseId,
            'description' => null,
            'bodyContent' => $bodyNode,
            'isDefault' => true,
            'contentHash' => $contentHash,
        ];

        return [[
            'type' => 'clause',
            'attrs' => [
                'id' => $clauseId,
                'order' => $order,
                'ordered' => true,
                'isTitleHidden' => false,
                'groupId' => Ids::uuid(),
                'activeVariantId' => $clauseId,
                'contentHash' => $contentHash,
                'variantCount' => 1,
                'isDefaultVariant' => true,
                'variants' => [$variant],
                'optional' => false,
                'optionalValue' => null,
                'explanation' => null,
            ],
            'content' => [$titleNode, $bodyNode],
        ]];
    }

    private function translateList(array $block, string $dir): array
    {
        $ordered = (bool) ($block['ordered'] ?? false);
        $items = [];
        foreach ((array) ($block['items'] ?? []) as $item) {
            $text = is_string($item) ? $item : (string) ($item['content'] ?? '');
            $inline = $this->parseInline($text);
            $items[] = [
                'type' => 'listItem',
                'content' => [
                    [
                        'type' => 'paragraph',
                        'attrs' => ['dir' => $dir],
                        'content' => $inline,
                    ],
                ],
            ];
        }

        if ($items === []) {
            return $this->makeParagraph('', $dir);
        }

        return [
            'type' => $ordered ? 'orderedList' : 'bulletList',
            'attrs' => ['dir' => $dir],
            'content' => $items,
        ];
    }

    private function translateTable(array $block, string $dir): array
    {
        $records = (array) ($block['records'] ?? []);
        if ($records === []) {
            return [];
        }

        $keys = [];
        foreach ($records as $record) {
            if (is_array($record)) {
                foreach (array_keys($record) as $key) {
                    $keys[$key] = true;
                }
            }
        }
        $columns = array_keys($keys);
        if ($columns === []) {
            return [];
        }

        $rows = [];
        $headerCells = [];
        foreach ($columns as $header) {
            $headerCells[] = $this->makeTableCell('tableHeader', (string) $header, $dir);
        }
        $rows[] = ['type' => 'tableRow', 'content' => $headerCells];

        foreach ($records as $record) {
            if (! is_array($record)) {
                continue;
            }
            $cells = [];
            foreach ($columns as $col) {
                $cells[] = $this->makeTableCell('tableCell', (string) ($record[$col] ?? ''), $dir);
            }
            $rows[] = ['type' => 'tableRow', 'content' => $cells];
        }

        return [['type' => 'table', 'attrs' => ['dir' => $dir], 'content' => $rows]];
    }

    private function makeTableCell(string $cellType, string $text, string $dir): array
    {
        $inline = $this->parseInline($text);

        return [
            'type' => $cellType,
            'content' => [[
                'type' => 'paragraph',
                'attrs' => ['dir' => $dir],
                'content' => $inline,
            ]],
        ];
    }

    private function translateHeading(array $block, string $dir): array
    {
        $level = $this->positiveInt($block['level'] ?? null, 2);
        if ($level < 1 || $level > 6) {
            $level = 2;
        }

        $text = (string) ($block['content'] ?? $block['text'] ?? '');
        $inline = $this->parseInline($text);

        $node = [
            'type' => 'heading',
            'attrs' => ['level' => $level, 'dir' => $dir],
        ];
        if ($inline !== []) {
            $node['content'] = $inline;
        }

        return $node;
    }

    private function translateBlockquote(array $block, string $dir): array
    {
        $text = (string) ($block['content'] ?? $block['text'] ?? '');

        return [
            'type' => 'blockquote',
            'content' => [$this->makeParagraph($text, $dir)],
        ];
    }

    private function translateCodeBlock(array $block): array
    {
        $language = $this->nullableString($block['language'] ?? null);
        $text = (string) ($block['content'] ?? $block['text'] ?? '');

        $node = ['type' => 'codeBlock', 'attrs' => ['language' => $language]];
        if ($text !== '') {
            $node['content'] = [['type' => 'text', 'text' => $text]];
        }

        return $node;
    }

    private function translateImage(array $block): array
    {
        $src = $this->nullableString($block['src'] ?? $block['url'] ?? null);
        if ($src === null) {
            return [];
        }

        $attrs = ['src' => $src];
        foreach (['alt', 'title'] as $attrName) {
            $value = $this->nullableString($block[$attrName] ?? null);
            if ($value !== null) {
                $attrs[$attrName] = $value;
            }
        }
        foreach (['width', 'height'] as $dimName) {
            $dim = $block[$dimName] ?? null;
            if (is_int($dim) && $dim > 0) {
                $attrs[$dimName] = $dim;
            } elseif (is_string($dim) && ctype_digit($dim)) {
                $attrs[$dimName] = (int) $dim;
            }
        }

        return [['type' => 'image', 'attrs' => $attrs]];
    }

    private function translateUnknown(array $block, string $dir): array
    {
        $text = (string) ($block['content'] ?? $block['text'] ?? '');
        if ($text === '') {
            return [];
        }

        return [$this->makeParagraph($text, $dir)];
    }

    private function makeParagraph(string $text, string $dir): array
    {
        $inline = $this->parseInline($text);
        if ($inline === []) {
            return ['type' => 'paragraph', 'attrs' => ['dir' => $dir]];
        }

        return ['type' => 'paragraph', 'attrs' => ['dir' => $dir], 'content' => $inline];
    }

    public function parseInline(string $text): array
    {
        $text = trim($text);
        if ($text === '') {
            return [];
        }

        return $this->tokenizeInline($text, []);
    }

    private function tokenizeInline(string $text, array $cumulativeMarks): array
    {
        if ($text === '') {
            return [];
        }

        $earliest = $this->findEarliestPattern($text);

        if ($earliest === null) {
            $node = $this->makeTextNode($text, $cumulativeMarks);

            return $node !== null ? [$node] : [];
        }

        $nodes = [];

        if ($earliest['offset'] > 0) {
            $before = substr($text, 0, $earliest['offset']);
            $node = $this->makeTextNode($before, $cumulativeMarks);
            if ($node !== null) {
                $nodes[] = $node;
            }
        }

        foreach ($this->renderMatch($earliest, $cumulativeMarks) as $node) {
            $nodes[] = $node;
        }

        $after = substr($text, $earliest['offset'] + $earliest['length']);
        foreach ($this->tokenizeInline($after, $cumulativeMarks) as $node) {
            $nodes[] = $node;
        }

        return $nodes;
    }

    private function findEarliestPattern(string $text): ?array
    {
        $patterns = [
            ['kind' => 'variable',  'regex' => self::VARIABLE_REGEX,                                                          'capture' => 1],
            ['kind' => 'hardBreak', 'regex' => '/<br\s*\/?>/i'],
            ['kind' => 'mark',      'regex' => '#<(?:strong|b)>(.*?)</(?:strong|b)>#is',                                      'mark' => 'bold',      'capture' => 1],
            ['kind' => 'mark',      'regex' => '#<(?:em|i)>(.*?)</(?:em|i)>#is',                                              'mark' => 'italic',    'capture' => 1],
            ['kind' => 'mark',      'regex' => '#<u>(.*?)</u>#is',                                                            'mark' => 'underline', 'capture' => 1],
            ['kind' => 'mark',      'regex' => '#<s>(.*?)</s>#is',                                                            'mark' => 'strike',    'capture' => 1],
            ['kind' => 'link',      'regex' => '#<a\b[^>]*\bhref=["\']([^"\']+)["\'][^>]*>(.*?)</a>#is',                      'hrefCapture' => 1,    'capture' => 2],
            ['kind' => 'mark',      'regex' => '/\*\*([^*\n]+?)\*\*/',                                                        'mark' => 'bold',      'capture' => 1],
            ['kind' => 'mark',      'regex' => '/__([^_\n]+?)__/',                                                            'mark' => 'bold',      'capture' => 1],
            ['kind' => 'mark',      'regex' => '/(?<![\w*])\*([^*\s][^*\n]*?[^*\s]|[^*\s\n])\*(?![\w*])/u',                   'mark' => 'italic',    'capture' => 1],
            ['kind' => 'mark',      'regex' => '/(?<![\w_])_([^_\s][^_\n]*?[^_\s]|[^_\s\n])_(?![\w_])/u',                     'mark' => 'italic',    'capture' => 1],
            ['kind' => 'mark',      'regex' => '/~~([^\n]+?)~~/',                                                             'mark' => 'strike',    'capture' => 1],
            ['kind' => 'mark',      'regex' => '/`([^`\n]+)`/',                                                               'mark' => 'code',      'capture' => 1],
            ['kind' => 'link',      'regex' => '/\[([^\]\n]+)\]\(([^)\s]+)\)/',                                               'capture' => 1,        'hrefCapture' => 2],
            ['kind' => 'hardBreak', 'regex' => '/\n+/'],
        ];

        $earliest = null;
        foreach ($patterns as $pattern) {
            if (preg_match($pattern['regex'], $text, $matches, PREG_OFFSET_CAPTURE) !== 1) {
                continue;
            }
            $offset = (int) $matches[0][1];
            if ($earliest === null || $offset < $earliest['offset']) {
                $earliest = [
                    'pattern' => $pattern,
                    'offset' => $offset,
                    'length' => strlen($matches[0][0]),
                    'matches' => $matches,
                ];
            }
        }

        return $earliest;
    }

    private function renderMatch(array $match, array $cumulativeMarks): array
    {
        $pattern = $match['pattern'];
        $kind = (string) $pattern['kind'];

        if ($kind === 'hardBreak') {
            return [['type' => 'hardBreak']];
        }

        if ($kind === 'variable') {
            $variable = $this->makeVariableNode($match['matches'][1][0]);

            return $variable !== null ? [$variable] : [];
        }

        if ($kind === 'mark') {
            $captureIdx = (int) $pattern['capture'];
            $inner = $match['matches'][$captureIdx][0];
            $newMarks = $cumulativeMarks;
            $newMarks[] = ['type' => (string) $pattern['mark']];

            return $this->tokenizeInline($inner, $newMarks);
        }

        if ($kind === 'link') {
            $captureIdx = (int) $pattern['capture'];
            $hrefIdx = (int) $pattern['hrefCapture'];
            $inner = $match['matches'][$captureIdx][0];
            $href = $match['matches'][$hrefIdx][0];
            $newMarks = $cumulativeMarks;
            $newMarks[] = ['type' => 'link', 'attrs' => ['href' => $href]];

            return $this->tokenizeInline($inner, $newMarks);
        }

        return [];
    }

    private function makeTextNode(string $text, array $marks): ?array
    {
        $text = $this->collapseWhitespace($text);
        if ($text === '') {
            return null;
        }

        $node = ['type' => 'text', 'text' => $text];
        if ($marks !== []) {
            $node['marks'] = $marks;
        }

        return $node;
    }

    private function collapseWhitespace(string $segment): string
    {
        $segment = (string) preg_replace('/\s+/u', ' ', $segment);

        return $segment;
    }

    private function makeVariableNode(string $attrString): ?array
    {
        $attrs = $this->parseAttrs($attrString);
        $type = $attrs['type'] ?? 'text';
        if (! in_array($type, self::VARIABLE_TYPES, true)) {
            $type = 'text';
        }

        $placeholder = $attrs['placeholder'] ?? '';
        $dimensions = self::VARIABLE_DIMENSIONS[$type] ?? [
            'width' => self::DEFAULT_VARIABLE_WIDTH,
            'height' => self::DEFAULT_VARIABLE_HEIGHT,
        ];

        $node = [
            'type' => 'variable',
            'attrs' => [
                'id' => Ids::uuid(),
                'name' => $placeholder !== '' ? $placeholder : 'Variable',
                'type' => $type,
                'display' => 'inline',
                'x' => 0,
                'y' => 0,
                'width' => $dimensions['width'],
                'height' => $dimensions['height'],
            ],
        ];

        $calendar = strtolower($attrs['calendar'] ?? '');
        if ($type === 'date' && in_array($calendar, $this->calendars, true)) {
            $node['attrs']['settings'] = ['calendarType' => $calendar];
        }

        if (in_array($type, ['signature', 'initials', 'stamp'], true)) {
            $node['attrs']['settings'] = ['required' => true];
        }

        if (isset($attrs['description'])) {
            $node['attrs']['description'] = $attrs['description'];
        }
        if (in_array($type, ['text', 'date', 'choice', 'single', 'multi'], true) && isset($attrs['value'])) {
            $node['attrs']['value'] = $attrs['value'];
        }
        if (isset($attrs['required']) && ! in_array($type, ['signature', 'initials', 'stamp'], true)) {
            $required = filter_var($attrs['required'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($required !== null) {
                $node['attrs']['settings']['required'] = $required;
            }
        }
        if (in_array($type, ['choice', 'single', 'multi'], true) && isset($attrs['options'])) {
            $options = json_decode($attrs['options'], true);
            if (is_array($options) && array_is_list($options) && count($options) <= 100
                && collect($options)->every(fn ($option) => is_string($option))) {
                $node['attrs']['settings']['options'] = $options;
            }
        }

        return $node;
    }

    private function parseAttrs(string $attrString): array
    {
        $out = [];
        if (preg_match_all('/(\w[\w\-:]*)\s*=\s*"([^"]*)"/u', $attrString, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $out[strtolower($match[1])] = html_entity_decode($match[2], ENT_QUOTES | ENT_HTML5, 'UTF-8');
            }
        }

        return $out;
    }

    private function stringOrUuid(mixed $value): string
    {
        if (is_string($value) && trim($value) !== '') {
            return $value;
        }

        return Ids::uuid();
    }

    private function nullableString(mixed $value): ?string
    {
        if (is_string($value) && trim($value) !== '') {
            return $value;
        }

        return null;
    }

    private function positiveInt(mixed $value, int $fallback): int
    {
        if (is_int($value) && $value > 0) {
            return $value;
        }
        if (is_string($value) && ctype_digit($value)) {
            $parsed = (int) $value;
            if ($parsed > 0) {
                return $parsed;
            }
        }

        return $fallback;
    }

    private function tryDecodeJsonObject(string $content): ?array
    {
        $trimmed = trim($content);
        if ($trimmed === '' || $trimmed[0] !== '{') {
            return null;
        }

        try {
            $decoded = json_decode($trimmed, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return null;
        }

        return is_array($decoded) ? $decoded : null;
    }

    private function importHtml(string $content): array
    {
        $html = preg_replace_callback(self::VARIABLE_REGEX, function (array $match): string {
            $variable = $this->makeVariableNode($match[1]);
            if ($variable === null) {
                return '';
            }
            $attributes = htmlspecialchars(json_encode($variable['attrs'], JSON_THROW_ON_ERROR), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            $value = htmlspecialchars((string) ($variable['attrs']['value'] ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

            return '<span data-clm-variable="'.$attributes.'">'.$value.'</span>';
        }, $content);
        $html = preg_replace('~</variable\s*>~i', '', $html);
        $runtime = $this->runtime ?? throw new \RuntimeException('HTML importing requires an editor runtime.');
        $result = $runtime->run('content', ['html' => $html]);

        return $this->arrayToDocument($result['content']);
    }

    private function emptyDocument(): array
    {
        return [
            'type' => 'doc',
            'content' => [
                ['type' => 'paragraph'],
            ],
        ];
    }
}
