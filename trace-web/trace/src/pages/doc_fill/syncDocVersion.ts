/** 文档版本同步到封面「文件版本」；修订记录首行「首次发布」版本号不随 A0→A1 覆盖。 */

const cell = (v: any) => String(v ?? "").trim();

const patchTable = (tb: any[], ver: string): any[] => {
    if (!Array.isArray(tb) || !tb.length) return tb;
    const header = (tb[0] || []).map(cell);
    const isRev = header.includes("版本号") && header.includes("修订说明");
    const verIdx = header.indexOf("版本号");
    const noteIdx = header.indexOf("修订说明");
    return tb.map((row, ri) => {
        if (!Array.isArray(row)) return row;
        const next = [...row];
        if (isRev && ri === 1 && ver && verIdx >= 0) {
            while (next.length <= verIdx) next.push("");
            const note = noteIdx >= 0 ? cell(next[noteIdx]) : "";
            // 「首次发布」行保持原版本（如 A0）；仅空时填入当前文档版本
            if (note === "首次发布") {
                if (!cell(next[verIdx])) next[verIdx] = ver;
            } else {
                next[verIdx] = ver;
            }
        }
        for (let i = 0; i < next.length - 1; i++) {
            if (cell(next[i]) === "文件版本" && ver) next[i + 1] = ver;
        }
        return next;
    });
};

/** 文件编号末尾的版本段（如 -A0）随文档版本变化，规则与后端 sync_file_no_version 一致。 */
export const syncFileNoVersion = (fileNo: string, version: string): string => {
    const no = String(fileNo || "");
    const ver = String(version || "").trim();
    if (!no || !ver) return no;
    const idx = no.lastIndexOf("-");
    if (idx < 0) return no;
    const tail = no.slice(idx + 1);
    if (!/^[A-Za-z]+\d+$/.test(tail)) return no;
    const num = ver.match(/(\d+)(?!.*\d)/);
    if (!num) return no.slice(0, idx + 1) + ver;
    const letter = tail.match(/^[A-Za-z]+/)?.[0] || "";
    return no.slice(0, idx + 1) + letter + num[1];
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
