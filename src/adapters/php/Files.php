<?php

declare(strict_types=1);

namespace Midad\Php;

use RuntimeException;

final class Files
{
    public static function read(string $path): string
    {
        $bytes = @file_get_contents($path);
        if ($bytes === false) {
            throw new RuntimeException('The editor file could not be read.');
        }

        return $bytes;
    }

    public static function directory(string $path): void
    {
        if (! is_dir($path) && ! @mkdir($path, 0700, true) && ! is_dir($path)) {
            throw new RuntimeException('The editor directory could not be created.');
        }
    }

    public static function write(string $path, string $bytes): void
    {
        self::directory(dirname($path));
        $temporary = $path.'.'.bin2hex(random_bytes(16)).'.tmp';
        try {
            if (file_put_contents($temporary, $bytes) !== strlen($bytes) || ! chmod($temporary, 0600) || ! rename($temporary, $path)) {
                throw new RuntimeException('The editor file could not be written.');
            }
        } finally {
            if (is_file($temporary)) {
                unlink($temporary);
            }
        }
    }

    public static function remove(string $path): void
    {
        if (! is_dir($path) || is_link($path)) {
            if (is_file($path) || is_link($path)) {
                unlink($path);
            }

            return;
        }
        foreach (scandir($path) as $entry) {
            if ($entry !== '.' && $entry !== '..') {
                self::remove($path.'/'.$entry);
            }
        }
        rmdir($path);
    }
}
