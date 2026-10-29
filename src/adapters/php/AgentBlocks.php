<?php

declare(strict_types=1);

namespace Midad\Php;

final class AgentBlocks
{
    public function __construct(private readonly array $calendars = ['hijri', 'gregorian']) {}

    public function convert(mixed $tipTap, string $language = 'ar'): array
    {
        $doc = $this->normalize($tipTap);
        $blocks = [];
        $position = 0;

        foreach ((array) ($doc['content'] ?? []) as $node) {
            if (! is_array($node)) {
                continue;
            }
            $position++;
            $translated = $this->translateNode($node, $position, (string) $position);
            if ($translated !== null) {
                $blocks[] = $translated;
            }
        }

        return [
            'type' => 'doc',
            'language' => $language === 'en' ? 'en' : 'ar',
            'blocks' => $blocks,
        ];
    }

    private function normalize(mixed $tipTap): array
    {
        if (is_string($tipTap) && trim($tipTap) !== '') {
            $decoded = json_decode($tipTap, true);

            return is_array($decoded) ? $decoded : [];
        }

        return is_array($tipTap) ? $tipTap : [];
    }

    private function translateNode(array $node, int $position, string $path): ?array
    {
        $type = (string) ($node['type'] ?? '');
        $id = $this->blockId($node, $path);

        return match ($type) {
            'paragraph' => [
                'type' => 'paragraph',
                'id' => $id,
                'content' => $this->extractText($node),
            ],
            'clause' => $this->translateClause($node, $id, $position, $path),
            'bulletList' => $this->translateList($node, $id, ordered: false),
            'orderedList' => $this->translateList($node, $id, ordered: true),
            'table' => $this->translateTable($node, $id),
            'heading' => [
                'type' => 'heading',
                'id' => $id,
                'level' => $this->positiveInt($node['attrs']['level'] ?? null, 2),
                'content' => $this->extractText($node),
            ],
            'blockquote' => [
                'type' => 'blockquote',
                'id' => $id,
                'content' => $this->extractText($node),
            ],
            'codeBlock' => [
                'type' => 'codeBlock',
                'id' => $id,
                'language' => $this->nullableString($node['attrs']['language'] ?? null),
                'content' => $this->extractText($node),
            ],
            'horizontalRule' => [
                'type' => 'horizontalRule',
                'id' => $id,
            ],
            'image' => $this->translateImage($node, $id),
            default => $this->translateUnknown($node, $id),
        };
    }

    private function translateClause(array $node, string $id, int $position, string $path): array
    {
        $title = '';
        $body = [];
        foreach ((array) ($node['content'] ?? []) as $child) {
            if (! is_array($child)) {
                continue;
            }
            $childType = (string) ($child['type'] ?? '');
            if ($childType === 'clauseTitle') {
                $title = $this->extractText($child);

                continue;
            }
            if ($childType === 'clauseBody') {
                $body = $this->translateChildren((array) ($child['content'] ?? []), $path);
            }
        }

        return [
            'type' => 'clause',
            'id' => $id,
            'order' => $this->positiveInt($node['attrs']['order'] ?? null, $position),
            'title' => $title,
            'content_hash' => $this->nullableString($node['attrs']['contentHash'] ?? null),
            'body' => $body,
        ];
    }

    private function translateChildren(array $children, string $parentPath): array
    {
        $out = [];
        $position = 0;
        foreach ($children as $child) {
            if (! is_array($child)) {
                continue;
            }
            $position++;
            $translated = $this->translateNode($child, $position, $parentPath.'.'.$position);
            if ($translated !== null) {
                $out[] = $translated;
            }
        }

        return $out;
    }

    private function translateList(array $node, string $id, bool $ordered): array
    {
        $items = [];
        foreach ((array) ($node['content'] ?? []) as $item) {
            if (! is_array($item) || ($item['type'] ?? null) !== 'listItem') {
                continue;
            }
            $items[] = $this->extractText($item);
        }

        return [
            'type' => 'list',
            'id' => $id,
            'ordered' => $ordered,
            'items' => $items,
        ];
    }

    private function tableRows(array $node): array
    {
        $rows = [];
        foreach ($node['content'] ?? [] as $child) {
            if (! is_array($child)) {
                continue;
            }
            if (($child['type'] ?? null) === 'tableRow') {
                $rows[] = $child;
            } elseif (($child['type'] ?? null) === 'tableRowGroup') {
                array_push($rows, ...$this->tableRows($child));
            }
        }

        return $rows;
    }

    private function translateTable(array $node, string $id): array
    {
        $rows = [];
        foreach ($this->tableRows($node) as $row) {
            $cells = [];
            foreach ((array) ($row['content'] ?? []) as $cell) {
                if (! is_array($cell)) {
                    continue;
                }
                $cells[] = $this->extractText($cell);
            }
            $rows[] = $cells;
        }

        $records = [];
        if (count($rows) >= 2) {
            $headers = $rows[0];
            for ($i = 1, $n = count($rows); $i < $n; $i++) {
                $record = [];
                foreach ($headers as $idx => $headerName) {
                    $record[(string) $headerName] = (string) ($rows[$i][$idx] ?? '');
                }
                $records[] = $record;
            }
        }

        return [
            'type' => 'table',
            'id' => $id,
            'records' => $records,
        ];
    }

    private function translateImage(array $node, string $id): ?array
    {
        $src = $this->nullableString($node['attrs']['src'] ?? null);
        if ($src === null) {
            return null;
        }

        $out = [
            'type' => 'image',
            'id' => $id,
            'src' => $src,
        ];
        foreach (['alt', 'title'] as $attr) {
            $value = $this->nullableString($node['attrs'][$attr] ?? null);
            if ($value !== null) {
                $out[$attr] = $value;
            }
        }
        foreach (['width', 'height'] as $dim) {
            $value = $node['attrs'][$dim] ?? null;
            if (is_int($value) && $value > 0) {
                $out[$dim] = $value;
            }
        }

        return $out;
    }

    private function translateUnknown(array $node, string $id): ?array
    {
        $text = $this->extractText($node);
        if ($text === '') {
            return null;
        }

        return [
            'type' => 'paragraph',
            'id' => $id,
            'content' => $text,
        ];
    }

    private function blockId(array $node, string $path): string
    {
        $id = $node['attrs']['id'] ?? null;
        if (is_string($id) && trim($id) !== '') {
            return $id;
        }

        return 'auto-'.substr(hash('sha256', $path.'|'.($node['type'] ?? '')), 0, 12);
    }

    private function extractText(array $node): string
    {
        $type = (string) ($node['type'] ?? '');

        if ($type === 'text') {
            return (string) ($node['text'] ?? '');
        }

        if ($type === 'hardBreak') {
            return "\n";
        }

        if ($type === 'variable') {
            return $this->variableTag((array) ($node['attrs'] ?? []));
        }

        $children = (array) ($node['content'] ?? []);
        if ($children === []) {
            return '';
        }

        $parts = [];
        foreach ($children as $child) {
            if (! is_array($child)) {
                continue;
            }
            $parts[] = $this->extractText($child);
        }

        $joined = trim(implode('', $parts));
        if (in_array($type, ['paragraph', 'listItem', 'tableCell', 'tableHeader', 'blockquote'], true)) {
            return $joined;
        }

        return $joined;
    }

    private function variableTag(array $attrs): string
    {
        $clean = fn (string $value): string => str_replace('"', "'", $value);

        $id = $this->nullableString($attrs['id'] ?? null);
        $name = $this->nullableString($attrs['name'] ?? null);
        $type = $this->nullableString($attrs['type'] ?? null) ?? 'text';

        $tag = '<variable';
        if ($id !== null) {
            $tag .= ' id="'.$clean($id).'"';
        }
        $tag .= ' type="'.$clean($type).'"';

        $settings = $attrs['settings'] ?? null;
        $calendar = is_array($settings) ? ($settings['calendarType'] ?? null) : null;
        if ($type === 'date' && is_string($calendar) && in_array($calendar, $this->calendars, true)) {
            $tag .= ' calendar="'.$calendar.'"';
        }

        if ($name !== null) {
            $tag .= ' placeholder="'.$clean($name).'"';
        }

        return $tag.'/>';
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
}
