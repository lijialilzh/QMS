/** 文档版本同步到封面「文件版本」和文件修订记录首行「版本号」，始终覆盖。 */

const cell = (v: any) => String(v ?? "").trim();

const patchTable = (tb: any[], ver: string): any[] => {
    if (!Array.isArray(tb) || !tb.length) return tb;
    const header = (tb[0] || []).map(cell);
    const isRev = header.includes("版本号") && header.includes("修订说明");
    const verIdx = header.indexOf("版本号");
    return tb.map((row, ri) => {
        if (!Array.isArray(row)) return row;
        const next = [...row];
        if (isRev && ri === 1 && ver && verIdx >= 0) {
            while (next.length <= verIdx) next.push("");
            next[verIdx] = ver;
        }
        for (let i = 0; i < next.length - 1; i++) {
            if (cell(next[i]) === "文件版本" && ver) next[i + 1] = ver;
        }
        return next;
    });
};

export const syncDocVersionFields = (nodes: any[], version: string): any[] => {
    const ver = String(version ?? "").trim();
    const walk = (n: any): any => ({
        ...n,
        tables: Array.isArray(n.tables) ? n.tables.map((tb: any) => (Array.isArray(tb) ? patchTable(tb, ver) : tb)) : n.tables,
        children: (n.children || []).map(walk),
    });
    return (nodes || []).map(walk);
};
