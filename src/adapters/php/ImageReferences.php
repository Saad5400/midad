<?php

declare(strict_types=1);

namespace Midad\Php;

final class ImageReferences
{
    public static function sources(array $content): array
    {
        $sources = [];
        self::visit($content, function (array $node) use (&$sources): array {
            if (($node['type'] ?? null) === 'image' && is_string($node['attrs']['src'] ?? null)) {
                $sources[] = $node['attrs']['src'];
            }

            return $node;
        });

        return array_values(array_unique($sources));
    }

    public static function rewrite(array $content, array $attributes): array
    {
        return self::visit($content, function (array $node) use ($attributes): array {
            if (($node['type'] ?? null) === 'image' && isset($attributes[$node['attrs']['src'] ?? ''])) {
                $node['attrs'] = [...$node['attrs'], ...$attributes[$node['attrs']['src']]];
            }

            return $node;
        });
    }

    private static function visit(array $node, \Closure $map): array
    {
        $node = $map($node);
        foreach ($node as $key => $child) {
            if (is_array($child)) {
                $node[$key] = self::visit($child, $map);
            }
        }

        return $node;
    }
}
