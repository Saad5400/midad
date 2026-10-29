<?php

declare(strict_types=1);

namespace Midad\Php;

use Closure;
use DOMDocument;
use DOMXPath;
use RuntimeException;

final class SvgImage
{
    public static function rasterize(string $svg, Closure $convert): string
    {
        if (strlen($svg) > 10 * 1024 * 1024 || str_contains($svg, '\\') || preg_match('/<!DOCTYPE|<!ENTITY|@import|@font-face/i', $svg)) {
            throw new RuntimeException('The SVG contains unsupported external resources.');
        }
        $document = new DOMDocument;
        if (! @$document->loadXML($svg, LIBXML_NONET) || $document->documentElement?->localName !== 'svg') {
            throw new RuntimeException('The SVG document is invalid.');
        }
        if (! $document->documentElement->hasAttribute('stroke')) {
            $document->documentElement->setAttribute('stroke', 'none');
        }
        $xpath = new DOMXPath($document);
        if ($xpath->query('//*[local-name()="script" or local-name()="foreignObject"]')->length) {
            throw new RuntimeException('The SVG contains unsupported active content.');
        }
        foreach ($xpath->query('//@*') as $attribute) {
            if ($attribute->localName === 'href' && $attribute->value !== '' && ! str_starts_with($attribute->value, '#')
                && ! preg_match('/^data:image\/(png|jpeg|webp);base64,[a-z0-9+\/=]+$/i', $attribute->value)) {
                throw new RuntimeException('SVG resources must be embedded in the image.');
            }
        }
        preg_match_all('/url\(\s*(["\']?)(.*?)\1\s*\)/is', $svg, $urls);
        foreach ($urls[2] as $url) {
            if (! str_starts_with(trim($url), '#')) {
                throw new RuntimeException('SVG styles cannot load external resources.');
            }
        }
        $png = $convert($document->saveXML());
        if (! str_starts_with($png, "\x89PNG\r\n\x1a\n")) {
            throw new RuntimeException('SVG conversion did not return a PNG.');
        }

        return $png;
    }
}
