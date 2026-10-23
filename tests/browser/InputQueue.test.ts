import { InputQueue } from '@saad5400/midad/browser/input';
import { describe, expect, it } from 'vitest';

describe('input snapshot ordering', () => {
    it('keeps rapid input ordered through delayed resource preparation', async () => {
        const values: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queue = new InputQueue<string>(async (value) => {
            if (value === 'क') await gate;
            values.push(value);
        });
        const jobs = [queue.push('क'), queue.push('कa'), queue.push('कab')];
        expect(queue.pending).toBe(true);
        release();
        await Promise.all(jobs);
        await queue.idle();
        expect(values).toEqual(['क', 'कa', 'कab']);
        expect(queue.pending).toBe(false);
    });
    it('runs later input after a rejected operation', async () => {
        const values: string[] = [];
        const queue = new InputQueue<string>(async (value) => {
            if (value === 'bad') throw new Error('Unrenderable');
            values.push(value);
        });
        const bad = queue.push('bad'),
            good = queue.push('good');
        await expect(bad).rejects.toThrow('Unrenderable');
        await good;
        await queue.idle();
        expect(values).toEqual(['good']);
    });
    it('discards queued snapshots after reset but accepts new input', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const values: string[] = [];
        const queue = new InputQueue<string>(async (value) => {
            if (value === 'active') await gate;
            values.push(value);
        });
        const active = queue.push('active');
        await Promise.resolve();
        const discarded = queue.push('obsolete');
        queue.reset();
        const current = queue.push('replacement');
        release();
        await Promise.all([active, discarded, current]);
        await queue.idle();
        expect(values).toEqual(['active', 'replacement']);
    });
});
