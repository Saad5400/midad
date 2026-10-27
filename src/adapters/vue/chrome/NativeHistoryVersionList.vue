<script setup lang="ts">
import { useEditorUi, useUiComponent, useUiText } from '../ui.js';
import type { HistoryVersion } from '@saad5400/midad/history';
import { computed } from 'vue';
import { nativeHistoryLabels } from './history-labels.js';

const ui = useEditorUi();
const Button = useUiComponent('Button');
const CommitItem = useUiComponent('CommitItem');
const CommitSkeleton = useUiComponent('CommitSkeleton');

const props = withDefaults(
    defineProps<{
        versions: readonly HistoryVersion[];
        selected?: number;
        busy?: boolean;
        loading?: boolean;
        failed?: boolean;
        more?: boolean;
        nextPage?: number | null;
        locale?: 'ar' | 'en';
    }>(),
    { locale: 'ar' },
);
const labels = computed(() => nativeHistoryLabels[props.locale]);
const emit = defineEmits<{ select: [version: HistoryVersion]; retry: []; loadMore: [] }>();
</script>

<template>
    <div class="native-history-list flex min-w-0 flex-col gap-2">
        <div v-if="failed" role="alert" class="text-destructive mb-4 grid gap-2 text-sm">
            {{ labels.loadError }}<Button variant="outline" size="sm" @click="emit('retry')">{{ labels.retry }}</Button>
        </div>
        <template v-if="loading"><CommitSkeleton v-for="index in 5" :key="index" /></template>
        <p v-else-if="!versions.length && !failed" class="text-muted-foreground py-8 text-center text-sm">
            {{ labels.empty }}
        </p>
        <template v-else>
            <CommitItem
                v-for="(version, index) in versions"
                :key="version.number"
                :commit="version"
                :index="index"
                :is-selected="selected === version.number"
                :is-oldest="false"
                :is-loading="!!busy"
                :rejected="version.rejected"
                :cancelled="version.cancelled"
                :data-version-number="version.number"
                :aria-current="selected === version.number ? 'true' : undefined"
                @click="emit('select', version)"
            />
        </template>
        <Button
            v-if="nextPage"
            variant="outline"
            size="sm"
            :disabled="more || busy"
            class="mt-4"
            @click="emit('loadMore')"
            >{{ labels.more }}</Button
        >
    </div>
</template>
