<?php

declare(strict_types=1);

namespace Midad\Laravel;

use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Midad\Php\InlineReview;

final class ReviewContent extends InlineReview
{
    public static function rules(string $key, bool $images = true): array
    {
        return [
            $key => ['nullable', 'array', 'max:400'],
            "{$key}.*.type" => Rule::forEach(fn (mixed $value, string $attribute, array $data): array => [
                'required', 'string', Rule::in([...self::ITEM_TYPES, ...($images && isset($data[Str::beforeLast($attribute, '.type').'.attrs.id']) ? ['image'] : [])]),
            ]),
            "{$key}.*.text" => ['nullable', 'string', 'max:20000'],
            "{$key}.*.marks" => ['nullable', 'array', 'max:20'],
            "{$key}.*.marks.*.type" => ['required', 'string', 'max:64'],
            "{$key}.*.attrs" => ['nullable', 'array'],
            "{$key}.*.attrs.id" => ["required_if:{$key}.*.type,image", 'nullable', 'string', 'max:64'],
            "{$key}.*.attrs.name" => ['nullable', 'string', 'max:255'],
            "{$key}.*.attrs.type" => ['nullable', 'string', Rule::in(self::VARIABLE_TYPES)],
            "{$key}.*.attrs.value" => ['nullable', 'string', 'max:5000'],
            "{$key}.*.attrs.participant_id" => ['nullable', 'max:64'],
            "{$key}.*.attrs.settings" => ['nullable', 'array', 'max:50'],
            "{$key}.*.attrs.settings.options" => ['nullable', 'array', 'max:50'],
            "{$key}.*.attrs.settings.options.*" => ['nullable', 'string', 'max:255'],
            "{$key}.*.attrs.settings.multiline" => ['nullable', 'boolean'],
            "{$key}.*.attrs.width" => ['nullable', 'numeric', 'min:1', 'max:5000'],
            "{$key}.*.attrs.height" => ['nullable', 'numeric', 'min:1', 'max:5000'],
            "{$key}.*.attrs.manuallyResized" => ['nullable', 'boolean'],
        ];
    }

    /** Keeps the keys the edit needs; a malformed list becomes null so it can never be applied. */
}
