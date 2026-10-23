export class InputQueue<Snapshot> {
    private tail: Promise<void> = Promise.resolve();
    private generation = 0;
    private count = 0;

    constructor(private readonly apply: (snapshot: Snapshot) => Promise<void>) {}

    get pending(): boolean {
        return this.count > 0;
    }
    idle(): Promise<void> {
        return this.tail;
    }

    push(snapshot: Snapshot): Promise<void> {
        const generation = this.generation;
        this.count++;
        const task = this.tail.then(async () => {
            if (generation === this.generation) await this.apply(snapshot);
        });
        this.tail = task
            .catch(() => undefined)
            .finally(() => {
                this.count--;
            });
        return task;
    }

    reset(): void {
        this.generation++;
    }
}
