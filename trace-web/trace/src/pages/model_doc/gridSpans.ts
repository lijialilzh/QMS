/** Word 式网格：相邻相同非空单元格横向合并；纵向合并首列（该列已横向合并时仍合并）。 */

export type CellSpan = { skip: boolean; colSpan: number; rowSpan: number };

const txt = (v: any) => String(v ?? "");
const sameNonEmpty = (a: any, b: any) => {
    const sa = txt(a);
    const sb = txt(b);
    return sa === sb && sa.trim() !== "";
};

export const isReviewRecordGrid = (tb: any[]): boolean => {
    const first = Array.isArray(tb?.[0]) ? txt(tb[0][0]) : "";
    return first.includes("评审记录");
};

export const computeGridSpans = (grid: any[][]): CellSpan[][] => {
    const rows: any[][] = (grid || []).map((r) => (Array.isArray(r) ? r : []));
    const R = rows.length;
    const C = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const spans: CellSpan[][] = Array.from({ length: R }, () =>
        Array.from({ length: C }, () => ({ skip: false, colSpan: 1, rowSpan: 1 }))
    );
    const at = (r: number, c: number) => (c < (rows[r] || []).length ? rows[r][c] : "");

    for (let r = 0; r < R; r++) {
        let c = 0;
        while (c < C) {
            if (spans[r][c].skip) {
                c += 1;
                continue;
            }
            let c2 = c;
            while (c2 + 1 < C && sameNonEmpty(at(r, c), at(r, c2 + 1))) c2 += 1;
            const cs = c2 - c + 1;
            spans[r][c].colSpan = cs;
            for (let k = c + 1; k <= c2; k++) spans[r][k].skip = true;
            c = c2 + 1;
        }
    }

    for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
            if (spans[r][c].skip) continue;
            if (c !== 0) continue;
            if (!txt(at(r, c)).trim()) continue;
            const cs = spans[r][c].colSpan;
            let r2 = r;
            while (r2 + 1 < R) {
                const nxt = spans[r2 + 1][c];
                if (nxt.skip || nxt.colSpan !== cs) break;
                if (!sameNonEmpty(at(r, c), at(r2 + 1, c))) break;
                r2 += 1;
            }
            const rs = r2 - r + 1;
            if (rs > 1) {
                spans[r][c].rowSpan = rs;
                for (let k = r + 1; k <= r2; k++) spans[k][c].skip = true;
            }
        }
    }
    return spans;
};
