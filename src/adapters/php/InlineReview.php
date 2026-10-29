<?php

namespace Midad\Php;

class InlineReview
{
    public const VARIABLE_TYPES = ['text', 'date', 'signature', 'initials', 'stamp', 'attachment', 'choice', 'single', 'multi'];

    protected const ITEM_TYPES = ['text', 'variable', 'hardBreak'];

    public const OPTION_TYPES = ['choice', 'single', 'multi'];

    private const IMAGE_TYPES = ['signature', 'initials', 'stamp'];

    private const KNOWN_ATTRS = ['id', 'name', 'type', 'description', 'settings', 'participant_id', 'value', 'reference_id', 'width', 'height', 'x', 'y', 'manuallyResized', 'display'];

    private const CREATOR_ATTRS = ['description', 'reference_id', 'x', 'y', 'display'];

    private const DEFAULT_WIDTH = 200;

    private const DEFAULT_HEIGHT = 24;

    public static function sanitize(mixed $items): ?array
    {
        if (! is_array($items)) {
            return null;
        }

        $clean = [];

        foreach ($items as $item) {
            $type = is_array($item) ? ($item['type'] ?? null) : null;

            if ($type === 'text' && self::str($item['text'] ?? null) === '') {
                continue;
            }

            $clean[] = match ($type) {
                'text' => ['type' => 'text', 'text' => self::str($item['text']), ...(empty($item['marks']) ? [] : ['marks' => array_values($item['marks'])])],
                'hardBreak' => ['type' => 'hardBreak', 'attrs' => ['id' => self::str($item['attrs']['id'] ?? null) ?: Ids::uuid()]],
                'image' => self::imageId($item) === '' ? null : ['type' => 'image', 'attrs' => ['id' => self::imageId($item)]],
                'variable' => self::str($item['attrs']['id'] ?? null) === '' ? null : ['type' => 'variable', 'attrs' => self::only($item['attrs'], self::KNOWN_ATTRS)],
                default => null,
            };
        }

        return in_array(null, $clean, true) ? null : $clean;
    }

    public static function snapshot(array $items): array
    {
        return array_map(fn (array $item): array => ($item['type'] ?? null) === 'image' ? ['type' => 'image', 'attrs' => ['id' => self::imageId($item)]] : $item, $items);
    }

    public static function same(array $a, array $b): bool
    {
        return self::stable($a) === self::stable($b);
    }

    public static function variablesChanged(array $from, array $to): bool
    {
        return self::fields($from) !== self::fields($to);
    }

    public static function converts(array $before, array $after, string $text, string $type): bool
    {
        $from = self::units($before);
        $to = self::units($after);
        $start = 0;

        while ($start < count($from) && $start < count($to) && $from[$start] === $to[$start]) {
            $start++;
        }

        $end = 0;

        while ($end < count($from) - $start && $end < count($to) - $start && $from[count($from) - 1 - $end] === $to[count($to) - 1 - $end]) {
            $end++;
        }

        $removed = array_slice($from, $start, count($from) - $start - $end);
        $added = array_slice($to, $start, count($to) - $start - $end);
        $field = count($added) === 1 && $added[0][0] === 'variable' ? $added[0][1] : null;

        return $field !== null
            && $field[2] === $type
            && ! in_array($field[0], array_column(self::fields($before), 0), true)
            && array_filter($removed, fn (array $unit): bool => $unit[0] !== 'text') === []
            && implode('', array_column($removed, 1)) === $text;
    }

    public static function replace(array $current, array $from, array $to, array $signerIds): ?array
    {
        if (! self::same($current, $from)) {
            return null;
        }

        $existing = self::attrsById($current);
        $images = self::images($current);
        if (self::imageReferences($current) !== self::imageReferences($to)) {
            return null;
        }

        return array_map(
            fn (array $item): array => ($item['type'] ?? null) === 'variable'
                ? ['type' => 'variable', 'attrs' => self::merge($existing[self::str($item['attrs']['id'] ?? null)] ?? null, $item['attrs'] ?? [], $signerIds)]
                : (($item['type'] ?? null) === 'image' ? $images[self::imageId($item)] : $item),
            $to,
        );
    }

    public static function restore(array $current, array $accepted, mixed $headBefore): ?array
    {
        if (! is_array($headBefore) || ! self::same($current, $accepted)) {
            return null;
        }

        $existing = self::attrsById($current);
        $images = self::images($current);

        return array_map(
            fn (mixed $item): mixed => is_array($item) && ($item['type'] ?? null) === 'variable'
                ? ['type' => 'variable', 'attrs' => [...($item['attrs'] ?? []), ...self::only($existing[self::str($item['attrs']['id'] ?? null)] ?? [], self::CREATOR_ATTRS)]]
                : (is_array($item) && ($item['type'] ?? null) === 'image' ? ($images[self::imageId($item)] ?? $item) : $item),
            $headBefore,
        );
    }

    private static function units(array $items): array
    {
        $units = [];

        foreach ($items as $item) {
            $type = self::str($item['type'] ?? null);

            if ($type !== 'text') {
                $units[] = [$type, $type === 'variable' ? self::fields([$item])[0] : ($type === 'image' ? self::imageId($item) : null)];

                continue;
            }

            $marks = self::sorted(array_values($item['marks'] ?? []));

            foreach (mb_str_split(self::str($item['text'] ?? null)) as $char) {
                $units[] = ['text', $char, $marks];
            }
        }

        return $units;
    }

    private static function imageId(array $item): string
    {
        return self::str($item['attrs']['nativeId'] ?? $item['attrs']['id'] ?? null);
    }

    private static function imageReferences(array $items): array
    {
        return array_values(array_map(self::imageId(...), array_filter($items, fn (array $item): bool => ($item['type'] ?? null) === 'image')));
    }

    private static function images(array $items): array
    {
        $images = [];
        foreach ($items as $item) {
            if (($item['type'] ?? null) === 'image') {
                $images[self::imageId($item)] = $item;
            }
        }

        return $images;
    }

    private static function attrsById(array $items): array
    {
        $attrs = [];

        foreach ($items as $item) {
            if (($item['type'] ?? null) === 'variable') {
                $attrs[self::str($item['attrs']['id'] ?? null)] = $item['attrs'] ?? [];
            }
        }

        return $attrs;
    }

    private static function merge(?array $current, array $suggested, array $signerIds): array
    {
        $type = self::str($suggested['type'] ?? $current['type'] ?? 'text');
        $retyped = $current === null || $type !== self::str($current['type'] ?? null);
        $valued = ! in_array($type, ['signature', 'stamp', 'initials', 'attachment'], true);
        $suggestedValue = self::str($suggested['value'] ?? null);
        $value = match (true) {
            $current === null => $valued ? $suggestedValue : '',
            $valued && $suggestedValue !== self::str($current['value'] ?? null) => $suggestedValue,
            default => $current['value'] ?? '',
        };
        $settings = $retyped ? (is_array($suggested['settings'] ?? null) ? $suggested['settings'] : []) : ($current['settings'] ?? []);

        if (in_array($type, self::OPTION_TYPES, true) && is_array($suggested['settings']['options'] ?? null)) {
            $settings['options'] = array_values(array_map(self::str(...), $suggested['settings']['options']));
        }

        $party = self::party($current, self::str($suggested['participant_id'] ?? null), $signerIds);
        if (self::str($party) !== '' && self::str($party) !== self::str($current['participant_id'] ?? null)) {
            $value = '';
        } elseif (self::str($value) !== '' && self::str($value) !== self::str($current['value'] ?? null)) {
            $party = '';
        }

        $drawn = self::size($suggested) !== '' && self::size($suggested) !== self::size($current ?? []);

        if ($drawn && $type === 'text') {
            $settings['multiline'] = self::bool($suggested['settings']['multiline'] ?? false);
        }

        return [
            ...($current ?? [
                'id' => self::str($suggested['id'] ?? null),
                'description' => '',
                'reference_id' => null,
                'width' => max(1, (int) round((float) ($suggested['width'] ?? self::DEFAULT_WIDTH))),
                'height' => max(1, (int) round((float) ($suggested['height'] ?? self::DEFAULT_HEIGHT))),
                'x' => 0,
                'y' => 0,
                'manuallyResized' => false,
                'display' => 'inline',
            ]),
            'name' => self::str($suggested['name'] ?? $current['name'] ?? null),
            'type' => $type,
            'value' => $value,
            'participant_id' => $party,
            'settings' => $settings,
            ...($drawn ? self::drawn($suggested) : []),
        ];
    }

    private static function party(?array $current, string $suggested, array $signerIds): mixed
    {
        $kept = $current['participant_id'] ?? '';

        if ($suggested === self::str($kept)) {
            return $kept;
        }

        if ($suggested === '' || (ctype_digit($suggested) && in_array((int) $suggested, $signerIds, true))) {
            return $suggested;
        }

        return $kept;
    }

    private static function fields(array $items): array
    {
        $fields = [];

        foreach ($items as $item) {
            if (($item['type'] ?? null) === 'variable') {
                $attrs = $item['attrs'] ?? [];
                $fields[] = [self::str($attrs['id'] ?? null), self::str($attrs['name'] ?? null), self::str($attrs['type'] ?? null), self::str($attrs['value'] ?? null), self::str($attrs['participant_id'] ?? null), self::str(self::options($attrs)), self::size($attrs)];
            }
        }

        return $fields;
    }

    private static function options(array $attrs): array
    {
        $options = $attrs['settings']['options'] ?? null;

        return in_array(self::str($attrs['type'] ?? null), self::OPTION_TYPES, true) && is_array($options)
            ? array_values(array_map(self::str(...), $options))
            : [];
    }

    private static function bool(mixed $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_BOOL) === true;
    }

    private static function tall(array $attrs): bool
    {
        $type = self::str($attrs['type'] ?? null);

        return in_array($type, self::IMAGE_TYPES, true) || ($type === 'text' && self::bool($attrs['settings']['multiline'] ?? false));
    }

    private static function size(array $attrs): string
    {
        if (! self::bool($attrs['manuallyResized'] ?? false)) {
            return '';
        }

        $width = (int) round((float) ($attrs['width'] ?? 0));

        return self::tall($attrs) ? $width.'x'.(int) round((float) ($attrs['height'] ?? 0)) : (string) $width;
    }

    private static function drawn(array $suggested): array
    {
        return [
            'width' => max(1, (int) round((float) ($suggested['width'] ?? self::DEFAULT_WIDTH))),
            'manuallyResized' => true,
            ...(self::tall($suggested) ? ['height' => max(1, (int) round((float) ($suggested['height'] ?? self::DEFAULT_HEIGHT)))] : []),
        ];
    }

    private static function stable(array $items): string
    {
        $out = [];

        foreach ($items as $item) {
            $entry = match ($item['type'] ?? null) {
                'text' => ['type' => 'text', 'text' => self::str($item['text'] ?? null), 'marks' => self::sorted(array_values($item['marks'] ?? []))],
                'variable' => ['type' => 'variable', 'field' => self::fields([$item])[0]],
                'image' => ['type' => 'image', 'image' => self::imageId($item)],
                default => ['type' => self::str($item['type'] ?? null)],
            };
            $last = array_key_last($out);

            if ($entry['type'] === 'text' && $last !== null && $out[$last]['type'] === 'text' && $out[$last]['marks'] === $entry['marks']) {
                $out[$last]['text'] .= $entry['text'];

                continue;
            }

            $out[] = $entry;
        }

        return (string) json_encode($out, JSON_UNESCAPED_UNICODE);
    }

    private static function sorted(array $value): array
    {
        if (! array_is_list($value)) {
            ksort($value);
        }

        return array_map(fn ($item) => is_array($item) ? self::sorted($item) : $item, $value);
    }

    private static function str(mixed $value): string
    {
        if ($value === null) {
            return '';
        }

        return is_scalar($value) ? (string) $value : (string) json_encode($value, JSON_UNESCAPED_UNICODE);
    }

    private static function only(array $value, array $keys): array
    {
        return array_intersect_key($value, array_flip($keys));
    }
}
