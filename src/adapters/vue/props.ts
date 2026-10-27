import type { NativePeer } from '../../collaboration/client.js';
import type { BilingualTranslator } from '../../content/bilingual/translation.js';
import type { InsertCapabilities } from '../../content/capabilities.js';
import type { LibraryClause } from '../../content/clauses/commands.js';
import type { AttachmentUpload, ImageUpload } from '../../content/images.js';
import type { NativeDocument } from '../../document/index.js';
import type { NativeLabels } from '../../browser/labels.js';
import type { MediaResolver } from '../../rendering/assets.js';
import type { NativeTextKernel } from '../../rendering/kernel.js';
import type {
    EditorChrome,
    EditorIntegration,
    EditorReviewPolicy,
    EditorReviewHighlight as ReviewHighlight,
} from './integration.js';

export interface DocumentEditorProps {
    integration?: EditorIntegration;
    chrome?: EditorChrome;
    menuOptions?: { exclude?: readonly string[] };
    content: unknown;
    documentId: string;
    title?: string;
    readonly?: boolean;
    locale?: 'ar' | 'en';
    labels?: Partial<NativeLabels>;
    startedAt?: number;
    resolveMedia?: MediaResolver;
    sharedKernel?: NativeTextKernel;
    loadPdf?: (signal: AbortSignal) => Promise<Uint8Array>;
    participants?: readonly { id: string; name: string; color?: string }[];
    uploadImage?: ImageUpload;
    uploadAttachment?: AttachmentUpload;
    fetchPdf?: (document: NativeDocument) => Promise<Blob>;
    beforePdf?: () => Promise<void>;
    bilingualLanguages?: readonly string[];
    bilingualTranslator?: BilingualTranslator;
    embedded?: boolean;
    reflowWidth?: number;
    historyHighlights?: readonly { id: string; kind: 'added' | 'removed' | 'modified' | 'moved' }[];
    textOnly?: boolean;
    insert?: Partial<InsertCapabilities>;
    hideExport?: boolean;
    showFieldPlaceholders?: boolean;
    sharedHistory?: { canUndo: boolean; canRedo: boolean; undo: () => Promise<void>; redo: () => Promise<void> };
    peers?: readonly NativePeer[];
    loadClauseLibrary?: (signal?: AbortSignal) => Promise<readonly LibraryClause[]>;
    prepareLibraryClause?: (source: LibraryClause, signal?: AbortSignal) => Promise<LibraryClause>;
    reviewHighlights?: readonly ReviewHighlight[];
    reviewPolicy?: EditorReviewPolicy;
    workbench?: boolean;
    presentationControls?: boolean;
    externalFieldDetails?: boolean;
    menuExclude?: readonly string[];
    endPanelOpen?: boolean;
}
