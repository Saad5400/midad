import * as Y from 'yjs';
import { activeClauseVariant } from '../content/clauses/queries.js';
import { exportDocument, importDocument } from '../document/codec.js';
import { persistNativeIdentities } from '../document/identities.js';
import type { NativeDocument, NativeNode } from '../document/model.js';
import { textBlocks } from '../document/text.js';
import type { TextCaret } from '../editing/text.js';
import { readSharedDocument } from './shared/reader.js';
import { identity, key } from './shared/schema.js';
import { SharedStore } from './shared/store.js';
import { variantScope } from './shared/variants.js';
import { SharedWriter } from './shared/writer.js';
import { canonicalSharedJson } from './values.js';

export const SHARED_DOCUMENT_SCHEMA = 3;

export interface SharedCaret {
    readonly block: string;
    readonly position: Uint8Array;
}
const LOCAL = Symbol('native-local'),
    REMOTE = Symbol('native-remote'),
    SEED = Symbol('native-seed');
export class SharedNativeDocument {
    readonly ydoc: Y.Doc;
    readonly undoManager: Y.UndoManager;
    private readonly store: SharedStore;
    private readonly writer: SharedWriter;
    private view: NativeDocument;
    private closed = false;
    private validation?: SharedNativeDocument;
    private validationStale = false;
    private validationDeferred = false;
    private mutated = false;
    private delta?: Uint8Array;

    private constructor(
        document: NativeDocument,
        state?: Uint8Array,
        private readonly isolated = false,
    ) {
        this.ydoc = new Y.Doc();
        this.store = new SharedStore(this.ydoc);
        this.writer = new SharedWriter(this.store);
        this.undoManager = new Y.UndoManager(this.ydoc, {
            trackedOrigins: new Set([LOCAL]),
            captureTimeout: 500,
        });
        this.view = document;
        this.ydoc.on('afterTransaction', (transaction) => {
            this.validationStale = true;
            if (!transaction.changed.size) return;
            this.store.invalidateCaches();
            if (transaction.origin !== LOCAL && transaction.origin !== SEED) this.store.placementReady = false;
        });
        try {
            if (state) {
                Y.applyUpdateV2(this.ydoc, state, REMOTE);
                if (this.ydoc.store.pendingStructs || this.ydoc.store.pendingDs)
                    throw new Error('The shared document snapshot is incomplete');
                if (
                    this.store.meta.get('schema') !== SHARED_DOCUMENT_SCHEMA ||
                    typeof this.store.meta.get('root') !== 'string' ||
                    typeof this.store.meta.get('epoch') !== 'string'
                )
                    throw new Error('Unsupported shared document');
                this.view = this.read(document.revision);
            } else {
                this.ydoc.transact(() => {
                    this.store.seeding = true;
                    this.store.meta.set('schema', SHARED_DOCUMENT_SCHEMA);
                    this.store.meta.set('epoch', crypto.randomUUID());
                    this.store.meta.set('root', key('', document.root.id));
                    this.writer.write(undefined, document);
                    this.store.seeding = false;
                }, SEED);
                this.view = this.read(document.revision);
                this.ydoc.transact(() => {
                    if (this.writer.seedPlaceholders(this.view)) this.view = this.read(document.revision);
                }, SEED);
            }
        } catch (error) {
            this.destroy();
            throw error;
        }
    }
    static create(document: NativeDocument): SharedNativeDocument {
        return new SharedNativeDocument(persistNativeIdentities(document));
    }
    static fromState(state: Uint8Array, id: string): SharedNativeDocument {
        return new SharedNativeDocument(importDocument({ type: 'doc' }, id), state);
    }
    document(): NativeDocument {
        return this.view;
    }
    epoch(): string {
        const epoch = this.store.meta.get('epoch');
        if (typeof epoch !== 'string') throw new Error('The shared document has no epoch');
        return epoch;
    }
    state(vector?: Uint8Array): Uint8Array {
        this.assertOpen();
        return Y.encodeStateAsUpdateV2(this.ydoc, vector);
    }
    vector(): Uint8Array {
        this.assertOpen();
        return Y.encodeStateVector(this.ydoc);
    }
    get canUndo(): boolean {
        return this.undoManager.undoStack.length > 0;
    }
    get canRedo(): boolean {
        return this.undoManager.redoStack.length > 0;
    }
    stopCapturing(): void {
        this.undoManager.stopCapturing();
    }

    publish(document: NativeDocument, history = true): Uint8Array {
        this.assertOpen();
        if (document.id !== this.view.id) throw new Error('The shared document identity changed');
        if (document.root.id !== this.view.root.id)
            document = {
                ...document,
                root: {
                    ...document.root,
                    id: this.view.root.id,
                    attributes: { ...document.root.attributes, nativeId: this.view.root.id },
                },
            };
        if (!this.isolated) {
            if (this.validationDeferred) this.discardValidation();
            try {
                const candidate = this.candidate(),
                    before = candidate.document();
                const update = candidate.publish(document, false);
                if (!candidate.mutated) return update;
                this.accept(
                    update,
                    candidate.document() !== before
                        ? { ...candidate.document(), revision: document.revision }
                        : undefined,
                    history ? LOCAL : SEED,
                );
                return update;
            } catch (error) {
                this.discardValidation();
                throw error;
            }
        }
        const before = this.view;
        return this.collect(() => {
            try {
                this.ydoc.transact(() => this.writer.write(before, document), history ? LOCAL : SEED);
                const projected = this.read(document.revision);
                this.view =
                    canonicalSharedJson(exportDocument(projected)) === canonicalSharedJson(exportDocument(before))
                        ? before
                        : projected;
            } catch (error) {
                this.destroy();
                throw error;
            }
        });
    }
    receive(update: Uint8Array): NativeDocument {
        this.assertOpen();
        if (!this.isolated) {
            try {
                const candidate = this.candidate(),
                    before = candidate.document();
                candidate.receive(update);
                if (candidate.ydoc.store.pendingStructs || candidate.ydoc.store.pendingDs) {
                    this.validationDeferred = true;
                    return this.view;
                }
                if (!candidate.mutated && !this.validationDeferred) return this.view;
                this.accept(
                    this.validationDeferred ? candidate.state(this.vector()) : candidate.delta!,
                    this.validationDeferred || candidate.document() !== before
                        ? { ...candidate.document(), revision: this.view.revision + 1 }
                        : undefined,
                    REMOTE,
                );
                return this.view;
            } catch (error) {
                this.discardValidation();
                throw error;
            }
        }
        return this.receiveIsolated(update);
    }
    private receiveIsolated(update: Uint8Array, local = false): NativeDocument {
        const root = this.store.meta.get('root'),
            epoch = this.epoch();
        let changed = false;
        const observe = (transaction: Y.Transaction): void => {
            changed ||= transaction.changed.size > 0;
        };
        this.ydoc.on('afterTransaction', observe);
        try {
            this.collect(() => {
                this.applyUpdate(update, REMOTE, local);
                if (
                    this.store.meta.get('schema') !== SHARED_DOCUMENT_SCHEMA ||
                    this.store.meta.get('root') !== root ||
                    this.epoch() !== epoch
                )
                    throw new Error('The shared document identity changed');
                if (changed) this.view = this.read(this.view.revision + 1);
            });
            return this.view;
        } catch (error) {
            this.destroy();
            throw error;
        } finally {
            this.ydoc.off('afterTransaction', observe);
        }
    }
    undo(): NativeDocument {
        this.assertOpen();
        this.undoManager.undo();
        this.view = this.read(this.view.revision + 1);
        return this.view;
    }
    redo(): NativeDocument {
        this.assertOpen();
        this.undoManager.redo();
        this.view = this.read(this.view.revision + 1);
        return this.view;
    }
    caret(caret: TextCaret, association: -1 | 0 = 0): SharedCaret | null {
        const address = this.addressFor(caret.blockId);
        if (!address) return null;
        if (caret.offset < 0 || caret.offset > this.store.length(address)) return null;
        const point = this.store.point(address, caret.offset);
        return {
            block: address,
            position: Y.encodeRelativePosition(
                Y.createRelativePositionFromTypeIndex(point.text, point.index, association),
            ),
        };
    }
    resolve(caret: SharedCaret): TextCaret | null {
        const position = Y.createAbsolutePositionFromRelativePosition(
            Y.decodeRelativePosition(caret.position),
            this.ydoc,
        );
        if (!position) return null;
        const candidates = textBlocks(this.view.root)
            .map((block) => this.addressFor(block.id))
            .filter((address): address is string => !!address);
        for (const address of candidates) {
            const offset = this.store.locate(address, position.type as Y.Text, position.index);
            if (offset !== undefined) return { blockId: identity(address), offset };
        }
        return null;
    }
    destroy(): void {
        if (this.closed) return;
        this.closed = true;
        this.discardValidation();
        this.undoManager.destroy();
        this.ydoc.destroy();
        this.store.clear();
    }
    private collect(operation: () => void): Uint8Array {
        const updates: Uint8Array[] = [];
        const capture = (update: Uint8Array): void => {
            updates.push(update);
        };
        this.ydoc.on('updateV2', capture);
        this.mutated = false;
        try {
            operation();
            this.mutated = updates.length > 0;
            this.delta = Y.mergeUpdatesV2(updates);
            return this.delta;
        } finally {
            this.ydoc.off('updateV2', capture);
        }
    }
    private candidate(): SharedNativeDocument {
        if (!this.validation) {
            this.validation = new SharedNativeDocument(
                importDocument({ type: 'doc' }, this.view.id),
                this.state(),
                true,
            );
        } else if (this.validationStale) {
            this.validation.receiveIsolated(this.state(this.validation.vector()), true);
        }
        this.validation.ydoc.clientID = this.ydoc.clientID;
        this.validationStale = false;
        return this.validation;
    }
    private accept(update: Uint8Array, document: NativeDocument | undefined, origin: symbol): void {
        this.applyUpdate(update, origin, origin !== REMOTE);
        if (document) this.view = document;
        this.validationStale = false;
        this.validationDeferred = false;
    }
    private applyUpdate(update: Uint8Array, origin: symbol, local: boolean): void {
        this.ydoc.transact((transaction) => {
            Y.applyUpdateV2(this.ydoc, update, origin);
            // The validation copy and live document share one author identity.
            if (local) transaction.local = true;
        }, origin);
        this.store.placementReady = false;
    }
    private discardValidation(): void {
        this.validation?.destroy();
        this.validation = undefined;
        this.validationStale = false;
        this.validationDeferred = false;
    }
    private assertOpen(): void {
        if (this.closed) throw new Error('The shared document is closed');
    }
    private addressFor(id: string): string | undefined {
        let result: string | undefined;
        const visit = (node: NativeNode, scope: string): void => {
            if (node.id === id) result = key(scope, id);
            if (node.kind === 'clause') {
                for (const child of node.children ?? [])
                    visit(
                        child,
                        child.kind === 'clauseBody' ? variantScope(scope, node.id, activeClauseVariant(node)) : scope,
                    );
            } else node.children?.forEach((child) => visit(child, scope));
        };
        visit(this.view.root, '');
        return result;
    }
    private read(revision: number): NativeDocument {
        const document = readSharedDocument(this.store, this.view, revision);
        return document;
    }
}
