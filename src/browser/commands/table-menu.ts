export interface TableControlMenuState {
    orientation: 'cell' | 'row' | 'column' | 'table';
    rowIndex: number;
    colIndex: number;
    rowCount: number;
    colCount: number;
    locked: boolean;
    cellCount: number;
    hasMergedCell: boolean;
    textAlign?: string;
    verticalAlign?: string | null;
    canMoveBefore?: boolean;
    canMoveAfter?: boolean;
}
export interface TableControlMenuItem {
    readonly id: string;
    readonly disabled?: boolean;
    readonly active?: boolean;
    readonly kind?: 'color';
    readonly children?: readonly (readonly TableControlMenuItem[])[];
}

export function tableControlMenu(state: TableControlMenuState): readonly (readonly TableControlMenuItem[])[] {
    const style: TableControlMenuItem[] = [
        {
            id: 'alignment',
            children: [
                ['left', 'center', 'right'].map((value) => ({
                    id: `align-${value}`,
                    active: state.textAlign === value,
                })),
                ['top', 'middle', 'bottom'].map((value) => ({
                    id: `valign-${value}`,
                    active: state.verticalAlign === value,
                })),
            ],
        },
        { id: 'color-text', kind: 'color' },
        { id: 'color-background', kind: 'color' },
    ];
    if (state.orientation === 'table')
        return state.locked
            ? [[{ id: 'table-lock' }]]
            : [[{ id: 'table-border-color', kind: 'color' }], [{ id: 'table-lock' }, { id: 'table-delete' }]];
    if (state.orientation === 'cell')
        return [
            ...(state.hasMergedCell || state.cellCount > 1 ? [[{ id: 'merge-toggle', disabled: state.locked }]] : []),
            style,
            [{ id: 'clear' }],
        ];
    if (state.locked) return [];
    const index = state.orientation === 'row' ? state.rowIndex : state.colIndex;
    const count = state.orientation === 'row' ? state.rowCount : state.colCount;
    return [
        ...(index === 0 ? [[{ id: 'header-toggle' }]] : []),
        [
            { id: 'move-back', disabled: !(state.canMoveBefore ?? index > 0) },
            { id: 'move-forward', disabled: !(state.canMoveAfter ?? index < count - 1) },
        ],
        [{ id: 'insert-before' }, { id: 'insert-after' }],
        [...style, { id: 'clear' }],
        [{ id: 'duplicate' }, { id: 'delete' }],
    ];
}
