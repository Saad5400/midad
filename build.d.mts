export interface DependencyLock {
    packages?: Record<
        string,
        {
            version?: string;
            integrity?: string;
            dependencies?: Record<string, string>;
            optionalDependencies?: Record<string, string>;
        }
    >;
}
export interface DependencyRoot {
    name: string;
    parent?: string;
    optional?: boolean;
}
export function dependencyIdentity(lock: DependencyLock, roots: readonly DependencyRoot[]): string;
export function buildPackage(directory?: string): void;
