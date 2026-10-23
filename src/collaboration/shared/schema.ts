import type * as Y from 'yjs';
import type { Json } from '../../document/model.js';

export interface Edge {
    readonly id: string;
    readonly edge: string;
    readonly rank?: number;
    readonly actor?: number;
}
export interface Parent {
    readonly container: string;
    readonly edge: string;
    readonly rank?: number;
    readonly actor?: number;
}
export interface Joined {
    readonly join: string;
    readonly edge: string;
    readonly rank: number;
    readonly actor: number;
}
export type SharedType = Y.Map<Json> | Y.Array<Edge> | Y.Text;
export interface FlowPart {
    insert: string | { node?: string; edge?: string; block?: string; join?: string };
    attributes?: Record<string, Json>;
    from: number;
}
export interface FlowSegment {
    start: number;
    end: number;
    parts: FlowPart[];
}
export const key = (scope: string, id: string): string => JSON.stringify([scope, id]);
export const identity = (address: string): string => {
    const value: unknown = JSON.parse(address);
    if (!Array.isArray(value) || value.length !== 2 || value.some((part) => typeof part !== 'string'))
        throw new Error('Invalid shared node identity');
    return value[1];
};
