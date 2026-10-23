export class SyncTransportFailure extends Error {
    constructor(readonly original: unknown) {
        super('The collaboration request failed');
    }
}

export class SyncDeadline extends Error {}

export async function withinDeadline<T>(job: Promise<T>, deadline: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            job,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new SyncDeadline()), Math.max(0, deadline - Date.now()));
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
export async function transfer<T>(request: () => Promise<T>): Promise<T> {
    try {
        return await request();
    } catch (error) {
        throw new SyncTransportFailure(error);
    }
}
