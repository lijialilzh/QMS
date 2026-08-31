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

const MD008_CATEGORIES = new Set(["结构", "文档", "变量", "算法操作", "循环和分支"]);
const MD008_META4 = new Set(["代码地址", "被审核人"]);
const MD008_META2 = new Set(["审核依据", "审核方式"]);

export const isCodeReviewChecklistGrid = (tb: any[]): boolean => {
    if (!Array.isArray(tb) || tb.length < 3) return false;
    let hasHeader = false;
    let hasAddr = false;
    for (const row of tb) {
        if (!Array.isArray(row)) continue;
        const a = txt(row[0]).trim();
        if (a === "代码地址") hasAddr = true;
        const cells = row.map((x) => txt(x).replace(/\s/g, ""));
        if (cells.includes("编号") && cells.includes("是") && cells.includes("否") && cells.some((c) => c.includes("不适用"))) {
            hasHeader = true;
        }
    }
    return hasHeader && hasAddr;
};

export const computeCodeReviewSpans = (grid: any[][]): CellSpan[][] => {
    const rows: any[][] = (grid || []).map((r) => (Array.isArray(r) ? r : []));
    const R = rows.length;
    const C = Math.max(7, rows.reduce((m, r) => Math.max(m, r.length), 0));
    const spans: CellSpan[][] = Array.from({ length: R }, () =>
        Array.from({ length: C }, () => ({ skip: false, colSpan: 1, rowSpan: 1 }))
    );
    const at = (r: number, c: number) => (c < (rows[r] || []).length ? rows[r][c] : "");
    const emptyRow = (r: number) => {
        for (let c = 0; c < C; c++) if (txt(at(r, c)).trim()) return false;
        return true;
    };
    const onlyFirst = (r: number) => {
        if (!txt(at(r, 0)).trim()) return false;
        for (let c = 1; c < C; c++) if (txt(at(r, c)).trim()) return false;
        return true;
    };
    const merge = (r: number, c: number, rs: number, cs: number) => {
        if (r >= R || c >= C) return;
        const rr = Math.min(rs, R - r);
        const cc = Math.min(cs, C - c);
        spans[r][c] = { skip: false, colSpan: cc, rowSpan: rr };
        for (let i = 0; i < rr; i++) {
            for (let j = 0; j < cc; j++) {
                if (i === 0 && j === 0) continue;
                spans[r + i][c + j].skip = true;
            }
        }
    };
    for (let r = 0; r < R; r++) {
        if (spans[r][0].skip) continue;
        const a = txt(at(r, 0)).trim();
        if (!a) continue;
        if (a.startsWith("结论")) {
            merge(r, 0, r + 1 < R && emptyRow(r + 1) ? 2 : 1, C);
            continue;
        }
        if (a.includes("审核人") && a.includes("签字")) {
            const rs = r + 1 < R && emptyRow(r + 1) ? 2 : 1;
            merge(r, 0, rs, 2);
            merge(r, 2, rs, C - 2);
            continue;
        }
        if (MD008_META4.has(a)) {
            merge(r, 0, 1, 2);
            merge(r, 3, 1, 2);
            merge(r, 5, 1, 2);
            continue;
        }
        if (MD008_META2.has(a)) {
            merge(r, 0, 1, 2);
            merge(r, 2, 1, C - 2);
            continue;
        }
        if (a === "编号" || /^\d+$/.test(a)) {
            merge(r, 1, 1, 2);
            continue;
        }
        if (MD008_CATEGORIES.has(a) || onlyFirst(r)) {
            merge(r, 0, 1, C);
        }
    }
    return spans;
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

export const isEnvMaintGrid = (tb: any[]): boolean => {
    if (!Array.isArray(tb) || tb.length < 3) return false;
    return tb.some((row) => {
        if (!Array.isArray(row)) return false;
        const cells = row.map((x) => txt(x).replace(/\s/g, ""));
        return cells[0] === "日期" && cells.some((c) => c.includes("检查内容")) && cells.some((c) => c.includes("检查人"));
    });
};

export const computeEnvMaintSpans = (grid: any[][]): CellSpan[][] => {
    const rows: any[][] = (grid || []).map((r) => (Array.isArray(r) ? r : []));
    const R = rows.length;
    const C = Math.max(17, rows.reduce((m, r) => Math.max(m, r.length), 0));
    const spans: CellSpan[][] = Array.from({ length: R }, () =>
        Array.from({ length: C }, () => ({ skip: false, colSpan: 1, rowSpan: 1 }))
    );
    const at = (r: number, c: number) => (c < (rows[r] || []).length ? rows[r][c] : "");
    const merge = (r: number, c: number, rs: number, cs: number) => {
        if (r >= R || c >= C) return;
        const rr = Math.min(rs, R - r);
        const cc = Math.min(cs, C - c);
        spans[r][c] = { skip: false, colSpan: cc, rowSpan: rr };
        for (let i = 0; i < rr; i++) {
            for (let j = 0; j < cc; j++) {
                if (i === 0 && j === 0) continue;
                spans[r + i][c + j].skip = true;
            }
        }
    };
    const onlyFirst = (r: number) => {
        if (!txt(at(r, 0)).trim()) return false;
        for (let c = 1; c < C; c++) if (txt(at(r, c)).trim()) return false;
        return true;
    };
    let h = -1;
    for (let r = 0; r < R; r++) {
        if (txt(at(r, 0)).trim() === "日期" && txt(at(r, 1)).includes("检查内容")) {
            h = r;
            break;
        }
    }
    for (let r = 0; r < R; r++) {
        if (h >= 0 && r >= h && r <= h + 2) continue;
        if (onlyFirst(r)) merge(r, 0, 1, C);
    }
    if (h >= 0) {
        merge(h, 0, 3, 1);
        merge(h, 1, 1, 14);
        merge(h, 15, 3, 1);
        merge(h, 16, 3, 1);
        if (h + 1 < R) {
            merge(h + 1, 1, 1, 4);
            merge(h + 1, 5, 1, 3);
            merge(h + 1, 8, 2, 1);
            merge(h + 1, 9, 1, 2);
            merge(h + 1, 11, 2, 1);
            merge(h + 1, 12, 2, 1);
            merge(h + 1, 13, 2, 1);
            merge(h + 1, 14, 2, 1);
        }
    }
    return spans;
};
