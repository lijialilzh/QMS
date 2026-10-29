/**
 * 文档版本同步规则（全模块统一）：
 * - 封面「文件版本」：随文档版本始终更新（A0→A1）
 * - 文件修订记录：版本形如 A0、A1 时，保留已有版本行，并补齐从 A0 到当前版本的每一行（A0 修订说明空则写「首次发布」）。已有行的日期、说明、人员不改。
 */

const cell = (v: any) => String(v ?? "").trim();

/** 修订行版本号。A0、A1、A2 都返回，空或不是这种写法返回空。 */
export const revisionRowToken = (version: string): string => {
    const matched = String(version || "").trim().toUpperCase().match(/^A(\d+)$/);
    if (!matched) return "";
    return `A${parseInt(matched[1], 10)}`;
};

const timelineTextVersion = (text: string): string => {
    const matched = String(text || "").toUpperCase().match(/(?:^|[^A-Z0-9])A(\d+)(?!\d)/);
    if (!matched) return "";
    return `A${parseInt(matched[1], 10)}`;
};

/** 时间线单元格是否属于这一修订版本。不传版本时只看文件名。A0 不要带 A1、A2 的格子。 */
export const timelineCellMatchesVersion = (text: string, keywords: string[], version?: string): boolean => {
    const value = String(text || "");
    const keys = (keywords || []).filter((item) => String(item || "").trim());
    if (!keys.some((item) => value.includes(item))) return false;
    const token = revisionRowToken(version || "");
    if (!token) return true;
    const found = timelineTextVersion(value);
    if (token === "A0") return found === "" || found === "A0";
    return found === token;
};

/** 修订表每一行的修改日期按该行版本号写入。没有对应时间线时清空这一格。 */
export const applyRevisionGridDates = (table: any[], dateOf: (version: string) => string) => {
    if (!Array.isArray(table) || !table.length || !dateOf) return;
    const header = (table[0] || []).map(cell);
    const dateIdx = header.indexOf("修改日期");
    const verIdx = header.indexOf("版本号");
    if (dateIdx < 0 || verIdx < 0) return;
    for (let i = 1; i < table.length; i += 1) {
        const row = table[i];
        if (!Array.isArray(row)) continue;
        while (row.length <= Math.max(dateIdx, verIdx)) row.push("");
        const ver = revisionRowToken(cell(row[verIdx]));
        if (!ver) continue;
        row[dateIdx] = dateOf(ver) || "";
    }
};

/** 先补齐 A0…当前版本，再按版本写入修改日期。 */
export const writeRevisionDates = (table: any[], version: string | undefined, dateOf: (version: string) => string): any[] => {
    const next = version && revisionVersionSeries(version) ? ensureRevisionGrid(table, version) : table;
    applyRevisionGridDates(next, dateOf);
    return next;
};

/** A0、A1… 补到当前版本；不是「字母+数字」则不拆。 */
export const revisionVersionSeries = (version: string): string[] | null => {
    const text = String(version || "").trim();
    const matched = text.match(/^([A-Za-z]+)(\d+)$/);
    if (!matched) return null;
    const prefix = matched[1];
    const current = parseInt(matched[2], 10);
    if (!Number.isFinite(current) || current < 0) return null;
    const series: string[] = [];
    for (let i = 0; i <= current; i++) series.push(`${prefix}${i}`);
    return series;
};

const blankRevisionRow = (cols: number) => Array.from({ length: cols }, () => "");

/** 修订表补齐 A0…当前版本。表须含表头。 */
export const ensureRevisionGrid = (tb: any[], version: string): any[] => {
    const series = revisionVersionSeries(version);
    if (!series || !Array.isArray(tb) || !tb.length) return tb;
    const header = (tb[0] || []).map(cell);
    const verIdx = header.indexOf("版本号");
    const descIdx = header.indexOf("修订说明");
    if (verIdx < 0 || descIdx < 0) return tb;
    const cols = Math.max(header.length, verIdx + 1, descIdx + 1);
    const nextTb = tb.map((row) => (Array.isArray(row) ? [...row] : row));
    const pad = (row: any[]) => {
        while (row.length < cols) row.push("");
        return row;
    };
    const verOf = (row: any[]) => cell(row[verIdx]);
    const dateIdx = header.indexOf("修改日期");
    const changerIdx = header.indexOf("修订人");
    const approverIdx = header.indexOf("批准人");
    const inSeries = new Set(series);
    // 改版本时先打出「A」会占一行；其余列都空、又不是 A0/A1 的版本号清掉
    nextTb.forEach((row, index) => {
        if (index < 1 || !Array.isArray(row)) return;
        pad(row);
        const ver = verOf(row);
        if (!ver || inSeries.has(ver)) return;
        const rest = [dateIdx, descIdx, changerIdx, approverIdx].filter((i) => i >= 0);
        if (rest.every((i) => !cell(row[i]))) row[verIdx] = "";
    });
    const hasVer = (ver: string) => nextTb.slice(1).some((row) => Array.isArray(row) && verOf(pad(row)) === ver);
    const zero = series[0];
    const current = series[series.length - 1];
    if (zero !== current && !hasVer(zero)) {
        const firstRelease = nextTb.findIndex((row, index) => (
            index >= 1 && Array.isArray(row) && cell(pad(row)[descIdx]) === "首次发布"
            && (verOf(row) === current || verOf(row) === "")
        ));
        if (firstRelease >= 0) nextTb[firstRelease][verIdx] = zero;
    }
    series.forEach((ver) => {
        if (hasVer(ver)) return;
        let target = nextTb.findIndex((row, index) => index >= 1 && Array.isArray(row) && !verOf(pad(row)) && !cell(row[descIdx]));
        if (target < 0) {
            target = nextTb.findIndex((row, index) => index >= 1 && Array.isArray(row) && !verOf(pad(row)));
        }
        if (target < 0) {
            nextTb.push(blankRevisionRow(cols));
            target = nextTb.length - 1;
        }
        pad(nextTb[target]);
        nextTb[target][verIdx] = ver;
        if (ver === zero && !cell(nextTb[target][descIdx])) nextTb[target][descIdx] = "首次发布";
    });
    return nextTb;
};

/** 详细设计 / 需求 / 概要设计这类对象行修订表，同样补齐 A0…当前版本。 */
export const ensureRevisionObjectRows = (rows: any[], version: string): any[] => {
    const series = revisionVersionSeries(version);
    const next = (rows || []).map((row) => ({ ...(row || {}) }));
    if (!series) return next;
    const verOf = (row: any) => cell(row?.version_no);
    const inSeries = new Set(series);
    next.forEach((row) => {
        const ver = verOf(row);
        if (!ver || inSeries.has(ver)) return;
        if (!cell(row?.change_desc) && !cell(row?.change_date) && !cell(row?.changer) && !cell(row?.approver)) {
            row.version_no = "";
        }
    });
    const hasVer = (ver: string) => next.some((row) => verOf(row) === ver);
    const zero = series[0];
    const current = series[series.length - 1];
    if (zero !== current && !hasVer(zero)) {
        const firstRelease = next.find((row) => cell(row?.change_desc) === "首次发布" && (verOf(row) === current || verOf(row) === ""));
        if (firstRelease) firstRelease.version_no = zero;
    }
    series.forEach((ver) => {
        if (hasVer(ver)) return;
        let target = next.find((row) => !verOf(row) && !cell(row?.change_desc) && !cell(row?.change_date) && !cell(row?.changer) && !cell(row?.approver));
        if (!target) target = next.find((row) => !verOf(row));
        if (!target) {
            target = { change_date: "", version_no: "", change_desc: "", changer: "", approver: "" };
            next.push(target);
        }
        target.version_no = ver;
        if (ver === zero && !cell(target.change_desc)) target.change_desc = "首次发布";
    });
    return next;
};

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
        if (revisionVersionSeries(ver)) return ensureRevisionGrid(nextTb, ver);
        // 只打了「A」、数字还没输入时不往修订表写版本
        return nextTb;
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
