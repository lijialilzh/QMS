/**
 * 文档版本同步规则（全模块统一）：
 * - 封面「文件版本」：随文档版本始终更新（A0→A1）
 * - 文件修订记录「版本号」：已有值不覆盖；升版时最多只给一个空行写入当前版本（不刷满所有空行）
 */

const cell = (v: any) => String(v ?? "").trim();

const patchTable = (tb: any[], ver: string): any[] => {
    if (!Array.isArray(tb) || !tb.length) return tb;
    const header = (tb[0] || []).map(cell);
    const isRev = header.includes("版本号") && header.includes("修订说明");
    const verIdx = header.indexOf("版本号");
    const nextTb = tb.map((row) => (Array.isArray(row) ? [...row] : row));

    for (const row of nextTb) {
        if (!Array.isArray(row)) continue;
        for (let i = 0; i < row.length - 1; i++) {
            if (cell(row[i]) === "文件版本" && ver) row[i + 1] = ver;
        }
    }

    if (isRev && ver && verIdx >= 0) {
        const isBlankRow = (row: any[]) => {
            if (!Array.isArray(row)) return false;
            return row.every((c, i) => i === verIdx || !cell(c));
        };
        // 清掉「只填了版本号」的空行上的多余版本，避免升版刷出多个 A1
        for (let ri = 1; ri < nextTb.length; ri++) {
            const row = nextTb[ri];
            if (!Array.isArray(row)) continue;
            while (row.length <= verIdx) row.push("");
            if (isBlankRow(row) && cell(row[verIdx])) row[verIdx] = "";
        }
        const hasVer = nextTb.slice(1).some((r) => Array.isArray(r) && cell(r[verIdx]) === ver);
        if (!hasVer) {
            let target = nextTb.findIndex((r, ri) => ri >= 1 && Array.isArray(r) && isBlankRow(r));
            if (target < 0 && nextTb.length > 1 && Array.isArray(nextTb[1]) && !cell(nextTb[1][verIdx])) {
                target = 1;
            }
            if (target >= 0) {
                while (nextTb[target].length <= verIdx) nextTb[target].push("");
                nextTb[target][verIdx] = ver;
            }
        }
    }
    return nextTb;
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
