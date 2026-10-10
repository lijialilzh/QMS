/** 标识配置 / 版本控制表：相邻重复项的合并范围。空单元格不合并。 */

export const DUP_MERGE_TITLES = new Set([
    "标识配置",
    "产品开发部软件构建配置项版本控制",
    "现成软件配置状态",
    "软件配置项状态(不包括现成软件)",
]);

export type ItemSpans = {
    hide: boolean[][];
    rowSpan: number[][];
    colSpan: number[][];
};

const textOf = (cell: any): string => String(cell ?? "").trim();

export const duplicateItemSpans = (grid: any[][]): ItemSpans => {
    const rows = Array.isArray(grid) ? grid : [];
    const n = rows.length;
    const cols = rows.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
    const hide = Array.from({ length: n }, () => Array(cols).fill(false));
    const rowSpan = Array.from({ length: n }, () => Array(cols).fill(1));
    const colSpan = Array.from({ length: n }, () => Array(cols).fill(1));
    const text = (r: number, c: number) => (c < (rows[r] || []).length ? textOf(rows[r][c]) : "");
    for (let r = 0; r < n; r++) {
        let c = 0;
        while (c < cols) {
            const val = text(r, c);
            if (!val) {
                c += 1;
                continue;
            }
            let c2 = c;
            while (c2 + 1 < cols && text(r, c2 + 1) === val) c2 += 1;
            if (c2 > c) {
                colSpan[r][c] = c2 - c + 1;
                for (let k = c + 1; k <= c2; k++) hide[r][k] = true;
            }
            c = c2 + 1;
        }
    }
    let r = 1;
    while (r < n) {
        const key = text(r, 0);
        if (!key) {
            r += 1;
            continue;
        }
        let r2 = r;
        while (r2 + 1 < n && text(r2 + 1, 0) === key) r2 += 1;
        if (r2 > r) {
            for (let c = 0; c < cols; c++) {
                if (hide[r][c]) continue;
                const val = text(r, c);
                const cs = colSpan[r][c];
                if (!val) continue;
                let same = true;
                for (let rr = r; rr <= r2 && same; rr++) {
                    if (hide[rr][c] || colSpan[rr][c] !== cs) {
                        same = false;
                        break;
                    }
                    for (let k = c; k < c + cs; k++) {
                        if (text(rr, k) !== val) {
                            same = false;
                            break;
                        }
                    }
                }
                if (!same) continue;
                rowSpan[r][c] = r2 - r + 1;
                for (let rr = r + 1; rr <= r2; rr++) {
                    for (let k = c; k < c + cs; k++) hide[rr][k] = true;
                }
            }
        }
        r = r2 + 1;
    }
    return { hide, rowSpan, colSpan };
};
