import { describe, expect, it } from 'vitest';
import { objectRegions, type ScenePage } from '@saad5400/midad/layout';
const field = (nodeId: string, x = 10) => ({
    kind: 'field' as const,
    nodeId,
    attributes: { name: nodeId },
    x,
    y: 10,
    width: 50,
    height: 30,
});
describe('shared editable and read-only object regions', () => {
    it('preserves repeated identities, nested clips and the parent clip after a nested scope ends', () => {
        const page: ScenePage = {
            width: 100,
            height: 100,
            lines: [],
            commands: [
                { kind: 'clipStart', x: 20, y: 0, width: 20, height: 100 },
                field('same'),
                { kind: 'clipStart', x: 30, y: 0, width: 5, height: 100 },
                field('nested'),
                { kind: 'clipEnd' },
                field('same'),
                { kind: 'clipEnd' },
                { kind: 'clipEnd' },
                field('outside-clip', 90),
            ],
        };
        const regions = objectRegions(page);
        expect(regions.map((region) => region.visible)).toEqual([
            { x: 20, y: 10, width: 20, height: 30 },
            { x: 30, y: 10, width: 5, height: 30 },
            { x: 20, y: 10, width: 20, height: 30 },
            { x: 90, y: 10, width: 10, height: 30 },
        ]);
        expect(regions.map((region) => region.nodeId)).toEqual(['same', 'nested', 'same', 'outside-clip']);
        expect(Object.isFrozen(regions[0].visible)).toBe(true);
    });
    it('omits fully clipped objects and can exclude image targets', () => {
        const page: ScenePage = {
            width: 100,
            height: 100,
            lines: [],
            commands: [field('hidden', 150), { ...field('image'), kind: 'image', assetId: 'asset' }],
        };
        expect(objectRegions(page)).toHaveLength(1);
        expect(objectRegions(page, false)).toEqual([]);
    });
});
