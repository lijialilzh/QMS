/**
 * PDP 风格章节：可自由添加多段正文 / 图片 / 表格（按插入顺序交错）。
 * 供 IMM 等文档详情页复用；不改 src/common/DocBlocks。
 */
import { splitBodyTables } from "@/common/DocBlocks";

export const appendBodyLine = (body: string, line: string) => {
    const b = String(body || "");
    if (!b.trim()) return line;
    return b.endsWith("\n") ? `${b}${line}` : `${b}\n${line}`;
};

/** 统计正文中已能占住一张表/图的行（含旧「见下表/见下图」等），避免再追加 {{TBL}}/{{IMG}} 导致露到编辑框 */
const countMediaSlots = (body: string) => {
    let tbl = 0;
    let img = 0;
    for (const ln of String(body || "").split("\n")) {
        const s = ln.trim();
        if (s === "{{TBL}}" || /^(见下表|如下表|下表)$/.test(s) || /^表\s*\d/.test(s) || /见表\s*\d/.test(s)) tbl += 1;
        else if (s === "{{IMG}}" || /^(见下图|如下图|下图)$/.test(s) || /^图\s*\d/.test(s) || /见下图|如下图|下图/.test(s)) img += 1;
    }
    return { tbl, img };
};

/** 为图/表补齐 {{IMG}}/{{TBL}}；无占位且同时有图和表时按先图后表；旧占位已够则不再追加 */
export const ensureMediaPlaceholders = (body: string, tables: any[], images: any[]) => {
    let b = String(body || "");
    const nImg = Array.isArray(images) ? images.length : 0;
    const nTbl = Array.isArray(tables) ? tables.length : 0;
    const slots = countMediaSlots(b);
    const hasLegacy = /见下图|如下图|下图|见下表|如下表|下表|见表\s*\d/.test(b);
    if (slots.img === 0 && slots.tbl === 0 && !hasLegacy && nImg > 0 && nTbl > 0) {
        let next = b;
        for (let i = 0; i < nImg; i++) next = appendBodyLine(next, "{{IMG}}");
        for (let i = 0; i < nTbl; i++) next = appendBodyLine(next, "{{TBL}}");
        return next;
    }
    for (let i = slots.img; i < nImg; i++) b = appendBodyLine(b, "{{IMG}}");
    for (let i = slots.tbl; i < nTbl; i++) b = appendBodyLine(b, "{{TBL}}");
    return b;
};

/** 去掉正文段中未消耗的整行 {{TBL}}/{{IMG}}（不展示给用户）；纯占位段丢弃以免多出空框 */
export const stripOrphanMediaLines = (segs: any[]): any[] => {
    const out: any[] = [];
    for (const seg of segs) {
        if (seg.type !== "text") {
            out.push(seg);
            continue;
        }
        const kept = String(seg.text ?? "")
            .split("\n")
            .filter((ln) => {
                const s = ln.trim();
                return s !== "{{TBL}}" && s !== "{{IMG}}";
            })
            .join("\n");
        if (!kept.trim()) continue;
        out.push({ ...seg, text: kept });
    }
    return out;
};

export const removeNthPlaceholder = (body: string, kind: "IMG" | "TBL", index: number) => {
    const token = `{{${kind}}}`;
    let seen = 0;
    return String(body || "")
        .split("\n")
        .filter((ln) => {
            if (ln.trim() !== token) return true;
            if (seen === index) {
                seen += 1;
                return false;
            }
            seen += 1;
            return true;
        })
        .join("\n");
};

/** 不自动在图/表前插空正文（添加图/表勿多出输入框）；仅空章节保留一个正文框 */
export const ensureInterleaveTextSlots = (segs: any[]): any[] => {
    if (!segs.length) return [{ type: "text", text: "" }];
    return segs.map((seg) => (seg.type === "text" ? { ...seg, text: seg.text ?? "" } : seg));
};

export const expandTxtMarkers = (segs: any[]): any[] => {
    const out: any[] = [];
    for (const seg of segs) {
        if (seg.type !== "text") {
            out.push(seg);
            continue;
        }
        const raw = String(seg.text ?? "");
        // 清空后的正文框占位，展示为空输入框
        if (raw.trim() === "{{EMPTY}}") {
            out.push({ type: "text", text: "" });
            continue;
        }
        if (!raw.includes("{{TXT}}")) {
            out.push(seg);
            continue;
        }
        raw.split(/\{\{TXT\}\}/).forEach((piece) => {
            const p = piece.replace(/^\n+|\n+$/g, "");
            out.push({ type: "text", text: p.trim() === "{{EMPTY}}" ? "" : p });
        });
    }
    return out;
};

export const reassembleFreeBody = (segments: any[], editedIndex?: number, newText?: string): string => {
    const next =
        editedIndex === undefined
            ? segments
            : segments.map((seg, i) => (seg.type === "text" && i === editedIndex ? { ...seg, text: newText ?? "" } : seg));
    const parts: string[] = [];
    let prevWasText = false;
    for (const seg of next) {
        if (seg.type === "text") {
            if (prevWasText) parts.push("{{TXT}}");
            // 空正文写 {{EMPTY}}，避免下次切分丢掉输入框
            const t = seg.text ?? "";
            parts.push(t === "" ? "{{EMPTY}}" : t);
            prevWasText = true;
        } else if (seg.type === "table") {
            prevWasText = false;
            parts.push(seg.caption || "{{TBL}}");
        } else if (seg.type === "image") {
            prevWasText = false;
            parts.push(seg.caption || "{{IMG}}");
        }
    }
    return parts.join("\n");
};

export const buildFreeSegments = (body: string, tables: any[], images: any[]) => {
    const normalized = ensureMediaPlaceholders(body, tables, images);
    return expandTxtMarkers(
        ensureInterleaveTextSlots(stripOrphanMediaLines(splitBodyTables(normalized, tables, images)))
    );
};

export const shouldUseFreeInterleave = (body: string, segments: any[], opts?: { skip?: boolean }) => {
    if (opts?.skip) return false;
    const hasMedia = segments.some((s) => s.type === "table" || s.type === "image");
    const textCount = segments.filter((s) => s.type === "text").length;
    return hasMedia || textCount > 1 || /\{\{TXT\}\}/.test(String(body || ""));
};

export type FreeChapterState = { body: string; tables: any[]; images: any[] };

/** 添加空表并在 body 末尾追加 {{TBL}}（先补齐已有图占位） */
export const freeAddTable = (s: FreeChapterState): FreeChapterState => {
    const tables = [...(s.tables || []), [["", ""], ["", ""]]];
    const images = Array.isArray(s.images) ? s.images : [];
    let body = ensureMediaPlaceholders(String(s.body || ""), s.tables || [], images);
    body = appendBodyLine(body, "{{TBL}}");
    return { body, tables, images };
};

export const freeDelTable = (s: FreeChapterState, ti: number): FreeChapterState => {
    const tables = (s.tables || []).filter((_: any, i: number) => i !== ti);
    const body = removeNthPlaceholder(String(s.body || ""), "TBL", ti);
    return { body, tables, images: Array.isArray(s.images) ? s.images : [] };
};

export const freeAddImage = (s: FreeChapterState, dataUrl: string): FreeChapterState => {
    const images = [...(Array.isArray(s.images) ? s.images : []), dataUrl];
    let body = ensureMediaPlaceholders(String(s.body || ""), s.tables || [], images.slice(0, -1));
    body = appendBodyLine(body, "{{IMG}}");
    return { body, tables: s.tables || [], images };
};

export const freeReplaceImage = (s: FreeChapterState, index: number, dataUrl: string): FreeChapterState => {
    const images = [...(Array.isArray(s.images) ? s.images : [])];
    if (index >= 0 && index < images.length) images[index] = dataUrl;
    return { body: String(s.body || ""), tables: s.tables || [], images };
};

export const freeDelImage = (s: FreeChapterState, index: number): FreeChapterState => {
    const images = [...(Array.isArray(s.images) ? s.images : [])];
    images.splice(index, 1);
    const body = removeNthPlaceholder(String(s.body || ""), "IMG", index);
    return { body, tables: s.tables || [], images };
};

export const freeAddBodyBlock = (s: FreeChapterState): FreeChapterState => {
    const images = Array.isArray(s.images) ? s.images : [];
    const tables = s.tables || [];
    const body0 = ensureMediaPlaceholders(String(s.body || ""), tables, images);
    let segs = buildFreeSegments(body0, tables, images);
    if (!segs.length) segs = [{ type: "text", text: "" }];
    segs = [...segs, { type: "text", text: "" }];
    return { body: reassembleFreeBody(segs), tables, images };
};
