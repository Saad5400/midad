import {
    CommandMenuController,
    composeCommandMenu,
    documentCommandMenu,
    searchCommandMenu,
} from '@saad5400/midad/browser';
import { describe, expect, it } from 'vitest';

const groups = [
    {
        id: 'insert',
        label: 'Insert',
        items: [
            { id: 'table', label: 'Table', keywords: ['grid'] },
            { id: 'image', label: 'Image', disabled: true },
        ],
    },
    {
        id: 'text',
        label: 'الفقرات',
        items: [
            { id: 'h1', label: 'عُنوان', keywords: ['Heading', 'Título'] },
            { id: 'body', label: 'Body' },
        ],
    },
];
describe('portable command menus', () => {
    it.each(['عنوان', 'grid', 'titulo', 'HEADING', 'فقرات'])('searches all groups and normalizes %s', (query) => {
        expect(searchCommandMenu(groups, query).length).toBeGreaterThan(0);
    });
    it('keeps the original command ids and profile exclusions across surfaces', () => {
        const tree = documentCommandMenu({
            label: (id) => id,
            exclude: ['clause', 'field-signature', 'field-stamp', 'field-initials'],
            available: (id) => id !== 'image',
        });
        const items = tree.flatMap((group) => group.items);
        expect(tree.map((group) => group.id)).toEqual(['insert', 'fields', 'format', 'paragraph']);
        expect(items.map((item) => item.id)).not.toContain('clause');
        expect(items.find((item) => item.id === 'heading-1')?.badge).toBe('H1');
        expect(items.filter((item) => item.id.startsWith('field-')).map((item) => item.id)).toEqual([
            'field-text',
            'field-date',
            'field-choice',
        ]);
    });
    it.each(['ltr', 'rtl'] as const)(
        'navigates nested groups in %s without consuming modified or composing keys',
        (direction) => {
            const menu = new CommandMenuController();
            menu.update(groups);
            const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
            const back = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
            expect(menu.key({ key: forward }, direction).handled).toBe(true);
            expect(menu.activeGroup?.id).toBe('insert');
            menu.key({ key: 'ArrowDown' }, direction);
            expect(menu.selectedIndex).toBe(0);
            expect(menu.key({ key: 'Enter' }, direction).item?.id).toBe('table');
            expect(menu.key({ key: back }, direction).handled).toBe(true);
            menu.key({ key: 'End' }, direction);
            menu.key({ key: 'Tab' }, direction);
            expect(menu.activeGroup?.id).toBe('text');
            expect(menu.key({ key: 'Enter', isComposing: true }, direction).handled).toBe(false);
            expect(menu.key({ key: 'Home', ctrlKey: true }, direction).handled).toBe(false);
            expect(menu.key({ key: 'Escape' }, direction).dismiss).toBeUndefined();
            expect(menu.key({ key: 'Escape' }, direction).dismiss).toBe(true);
        },
    );
    it('preserves a selected item through state updates, resets on search, and handles missing entries', () => {
        const menu = new CommandMenuController();
        menu.update(groups);
        menu.move(1);
        menu.activate();
        menu.move(1);
        menu.update([...groups]);
        expect(menu.rows[menu.selectedIndex].key).toBe('body');
        menu.update(groups, 'heading');
        expect(menu.rows[0].kind).toBe('item');
        expect(menu.key({ key: 'Tab' }, 'ltr').item?.id).toBe('h1');
        menu.update([], 'unknown');
        expect(menu.key({ key: 'Enter' }, 'ltr').handled).toBe(false);
        expect(menu.activate()).toBeUndefined();
    });
    it('composes host actions and groups without losing callbacks, exclusions or search behavior', () => {
        const run = () => 'selected';
        const tree = composeCommandMenu(
            documentCommandMenu({ label: (id) => id }),
            [
                {
                    id: 'insert',
                    label: 'Host insert',
                    items: [{ id: 'catalog', label: 'Shared catalog', keywords: ['library'], run }],
                },
                { id: 'host', label: 'Host tools', items: [{ id: 'host-help', label: 'Help', run }] },
            ],
            { exclude: ['image', 'fields'], available: (item) => item.id !== 'table' },
        );
        expect(tree[0].label).toBe('insert');
        expect(tree.at(-1)?.id).toBe('host');
        expect(tree.flatMap((group) => group.items).some((item) => ['image', 'table'].includes(item.id))).toBe(false);
        expect(tree.some((group) => group.id === 'fields')).toBe(false);
        const menu = new CommandMenuController<(typeof tree)[number]['items'][number]>();
        menu.update(tree, 'library');
        const item = menu.key({ key: 'Enter' }, 'ltr').item!;
        expect(item.id).toBe('catalog');
        expect('run' in item && item.run()).toBe('selected');
    });
    it('rejects ambiguous command ids and does not mutate input catalogs', () => {
        const before = JSON.stringify(groups);
        expect(() =>
            composeCommandMenu(groups, [
                { id: 'insert', label: 'Insert', items: [{ id: 'table', label: 'Duplicate' }] },
            ]),
        ).toThrow('Duplicate command');
        expect(composeCommandMenu(groups, [], { exclude: ['insert', 'text'] })).toEqual([]);
        expect(JSON.stringify(groups)).toBe(before);
    });
});
