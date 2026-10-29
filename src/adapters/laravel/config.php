<?php

return [
    'socket' => env('MIDAD_SOCKET', env('NATIVE_EDITOR_SOCKET')),
    'build' => base_path('bootstrap/midad/build.json'),
    'font_archive' => storage_path('app/native-fonts'),
    'font_archive_disk' => env('NATIVE_EDITOR_FONT_DISK'),
    'font_archive_prefix' => 'native-editor-fonts',
];
