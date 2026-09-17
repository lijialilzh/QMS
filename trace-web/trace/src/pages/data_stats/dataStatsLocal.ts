// 本机解析 DICOM 头并汇总。口径对齐 scripts/data_stats，见 docs/function_docs/101_数据统计.md。

import * as XLSX from "xlsx";

export type CaseRow = Record<string, any>;
export type StatsKind = "raw" | "base" | "ann";
export type SheetAoa = { name: string; rows: any[][] };

export const STATS_TITLES: Record<StatsKind, string> = {
    raw: "原始数据库统计表",
    base: "基础数据库统计表",
    ann: "标注数据库统计表",
};

export const DETAIL_COLUMNS = [
    "TXID", "PatientID", "SeriesInstanceUID", "SEX", "DEVICE", "ConvolutionKernel",
    "PhotometricInterpretation", "AGE", "KVP", "THICKNESS", "PixelSpacing",
    "gt", "pred", "dice",
];

export const DETAIL_PREVIEW_COLUMNS = [
    "TXID", "SEX", "AGE", "DEVICE", "KVP", "THICKNESS", "ConvolutionKernel",
];

const HEADER_BYTES = 512 * 1024;
const AGE_BINS = [0, 17, 40, 90];
const SKIP_EXT = /\.(txt|json|xml|csv|xlsx|xls|png|jpg|jpeg|gif|bmp|html|md|zip|pdf)$/i;
const LONG_VR = new Set(["OB", "OW", "OF", "SQ", "UT", "UN", "OD", "OL", "UC", "UR", "OV"]);

const TAGS: Array<{ tag: number; key: string; vr: string; def?: any }> = [
    { tag: 0x00100020, key: "PatientID", vr: "LO", def: "none" },
    { tag: 0x0020000e, key: "SeriesInstanceUID", vr: "UI", def: "none" },
    { tag: 0x00080020, key: "study date", vr: "DA", def: "none" },
    { tag: 0x00080050, key: "ACC NO", vr: "SH", def: "none" },
    { tag: 0x00100040, key: "SEX", vr: "CS" },
    { tag: 0x00080070, key: "DEVICE", vr: "LO", def: "none" },
    { tag: 0x00181210, key: "ConvolutionKernel", vr: "SH", def: "none" },
    { tag: 0x0008103e, key: "Series Description", vr: "LO", def: "none" },
    { tag: 0x00081090, key: "ManufacturerModelName", vr: "LO", def: "none" },
    { tag: 0x00185100, key: "PatientPosition", vr: "CS", def: "none" },
    { tag: 0x00180015, key: "Body Part Examined", vr: "CS", def: "none" },
    { tag: 0x00280004, key: "PhotometricInterpretation", vr: "CS", def: "none" },
    { tag: 0x00101010, key: "AGE", vr: "AS" },
    { tag: 0x00180060, key: "KVP", vr: "DS", def: -1 },
    { tag: 0x00180050, key: "THICKNESS", vr: "DS", def: 1.0 },
    { tag: 0x00281051, key: "WindowWidth", vr: "DS" },
    { tag: 0x00281050, key: "WindowCenter", vr: "DS" },
    { tag: 0x00280011, key: "Columns", vr: "US", def: 9999 },
    { tag: 0x00280010, key: "Rows", vr: "US", def: 9999 },
    { tag: 0x00200011, key: "SeriesNumber", vr: "IS", def: 9999 },
    { tag: 0x00189345, key: "CTDIvol", vr: "FD", def: 9999 },
    { tag: 0x00181152, key: "Exposure", vr: "IS", def: 9999 },
    { tag: 0x00200037, key: "ImageOrientation", vr: "DS", def: "none" },
    { tag: 0x00280030, key: "PixelSpacing", vr: "DS", def: 9999 },
    { tag: 0x00180088, key: "SpacingBetweenSlices", vr: "DS", def: 9999 },
];

function isDicomName(name: string) {
    if (!name || /^DICOMDIR$/i.test(name)) return false;
    if (SKIP_EXT.test(name)) return false;
    return true;
}

function fileRank(name: string) {
    if (/\.(dcm|dicom)$/i.test(name)) return 0;
    if (/\.(ima|img)$/i.test(name)) return 1;
    if (!name.includes(".")) return 2;
    return 3;
}

function relPath(file: File) {
    return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function readCString(u8: Uint8Array, start: number, len: number) {
    const end = Math.min(u8.length, start + Math.max(0, len));
    let s = "";
    for (let i = start; i < end; i++) {
        const c = u8[i];
        if (c === 0) break;
        s += String.fromCharCode(c);
    }
    return s.replace(/\s+$/g, "").trim();
}

function readValue(vr: string, view: DataView, u8: Uint8Array, off: number, len: number, little: boolean) {
    if (len <= 0) return "";
    if (vr === "US" && len >= 2) return String(view.getUint16(off, little));
    if (vr === "UL" && len >= 4) return String(view.getUint32(off, little));
    if (vr === "SS" && len >= 2) return String(view.getInt16(off, little));
    if (vr === "SL" && len >= 4) return String(view.getInt32(off, little));
    if (vr === "FL" && len >= 4) return String(view.getFloat32(off, little));
    if (vr === "FD" && len >= 8) return String(view.getFloat64(off, little));
    return readCString(u8, off, len);
}

function isDicm(u8: Uint8Array) {
    return u8.length >= 132
        && u8[128] === 68 && u8[129] === 73 && u8[130] === 67 && u8[131] === 77;
}

const TAG_ITEM = 0xfffee000;
const TAG_ITEM_DELIM = 0xfffee00d;
const TAG_SEQ_DELIM = 0xfffee0dd;
const TAG_PIXEL = 0x7fe00010;
const TAG_META_LEN = 0x00020000;
const TAG_TS = 0x00020010;
const VR_OF: Record<number, string> = {};
TAGS.forEach((t) => { VR_OF[t.tag] = t.vr; });
VR_OF[0x00100030] = "DA";
VR_OF[TAG_TS] = "UI";

function parseDicomTags(buf: ArrayBuffer): Record<string, string> {
    const u8 = new Uint8Array(buf);
    const view = new DataView(buf);
    const out: Record<string, string> = {};
    if (buf.byteLength < 8) return out;
    const want: Record<number, string> = { 0x00100030: "PatientBirthDate", 0x00100010: "PatientName" };
    TAGS.forEach((t) => { want[t.tag] = t.key; });

    const isDelim = (tag: number) => tag === TAG_ITEM || tag === TAG_ITEM_DELIM || tag === TAG_SEQ_DELIM;
    const readHdr = (o: number, expl: boolean, le: boolean) => {
        if (o + 8 > u8.length) return null;
        const tag = ((view.getUint16(o, le) << 16) | view.getUint16(o + 2, le)) >>> 0;
        if (isDelim(tag)) {
            return { tag, vr: "", len: view.getUint32(o + 4, le), valOff: o + 8 };
        }
        if (expl) {
            const vr = String.fromCharCode(u8[o + 4], u8[o + 5]);
            if (LONG_VR.has(vr)) {
                if (o + 12 > u8.length) return null;
                return { tag, vr, len: view.getUint32(o + 8, le), valOff: o + 12 };
            }
            return { tag, vr, len: view.getUint16(o + 6, le), valOff: o + 8 };
        }
        return { tag, vr: VR_OF[tag] || "", len: view.getUint32(o + 4, le), valOff: o + 8 };
    };

    const skipSq = (start: number, expl: boolean, le: boolean, seqLen: number): number => {
        if (seqLen !== 0xffffffff) return start + Math.max(0, seqLen);
        let o = start;
        while (o + 8 <= u8.length) {
            const h = readHdr(o, expl, le);
            if (!h) return u8.length;
            if (h.tag === TAG_SEQ_DELIM) return h.valOff;
            if (h.tag === TAG_ITEM) {
                o = h.len === 0xffffffff ? skipItem(h.valOff, expl, le) : h.valOff + Math.max(0, h.len);
                continue;
            }
            if (h.vr === "SQ" || h.len === 0xffffffff) o = skipSq(h.valOff, expl, le, h.len);
            else o = h.valOff + Math.max(0, h.len);
        }
        return u8.length;
    };

    const skipItem = (start: number, expl: boolean, le: boolean): number => {
        let o = start;
        while (o + 8 <= u8.length) {
            const h = readHdr(o, expl, le);
            if (!h) return u8.length;
            if (h.tag === TAG_ITEM_DELIM) return h.valOff;
            if (h.vr === "SQ" || h.len === 0xffffffff) o = skipSq(h.valOff, expl, le, h.len);
            else o = h.valOff + Math.max(0, h.len);
        }
        return u8.length;
    };

    const walk = (start: number, expl: boolean, le: boolean, take: boolean, onlyGroup?: number) => {
        let o = start;
        let ts = "";
        let metaEnd = -1;
        while (o + 8 <= u8.length) {
            const h = readHdr(o, expl, le);
            if (!h) break;
            const group = (h.tag >>> 16) & 0xffff;
            if (onlyGroup != null && group !== onlyGroup) break;
            if (h.tag === TAG_PIXEL || h.tag === TAG_SEQ_DELIM || h.tag === TAG_ITEM_DELIM) break;
            if (h.tag === TAG_ITEM) {
                o = h.len === 0xffffffff ? skipItem(h.valOff, expl, le) : h.valOff + Math.max(0, h.len);
                continue;
            }
            if (h.vr === "SQ" || h.len === 0xffffffff) {
                o = skipSq(h.valOff, expl, le, h.len);
                continue;
            }
            if (h.len < 0 || h.valOff + h.len > u8.length) break;
            const key = want[h.tag];
            if (take && key && h.len <= 2048 && out[key] == null) {
                const vr = h.vr || VR_OF[h.tag] || "LO";
                const v = readValue(vr, view, u8, h.valOff, h.len, le);
                if (v) out[key] = v;
            }
            if (h.tag === TAG_TS) ts = readValue("UI", view, u8, h.valOff, h.len, le);
            if (h.tag === TAG_META_LEN && h.len >= 4) {
                metaEnd = h.valOff + h.len + view.getUint32(h.valOff, le);
            }
            o = h.valOff + h.len;
            if (metaEnd >= 0 && o >= metaEnd) break;
        }
        return { next: metaEnd >= 0 ? metaEnd : o, ts };
    };

    let off = isDicm(u8) ? 132 : 0;
    let little = true;
    let explicit = true;
    if (off + 6 <= u8.length && view.getUint16(off, true) === 2) {
        const meta = walk(off, true, true, false, 2);
        off = meta.next;
        const ts = (meta.ts || "").replace(/\0/g, "").trim();
        if (ts === "1.2.840.10008.1.2") explicit = false;
        else if (ts === "1.2.840.10008.1.2.2") { little = false; explicit = true; }
    }
    walk(off, explicit, little, true);
    return out;
}

function parseAge(raw: string): number | null {
    const m = String(raw || "").match(/(\d+)/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
}

/** 卷积核多值只取第一项：I26f\3、['I26f','3']、IMR1,Routine → I26f / IMR1。 */
function parseKernel(raw: any) {
    let s = String(raw ?? "").trim();
    if (!s || s === "none") return "";
    if (s.charAt(0) === "[") {
        const inner = s.replace(/^\[/, "").replace(/\]$/, "");
        s = inner.split(",")[0].replace(/^['"]|['"]$/g, "").trim() || s;
    }
    s = s.split("\\")[0].split(",")[0].split("/")[0].split(";")[0].trim();
    return s.replace(/^['"]|['"]$/g, "").trim();
}

/** 层厚：单一数字显示绝对值；tag 为 1-3 / [1-3] 等区间则保留区间。 */
function parseThickness(raw: any, def: any) {
    let s = String(raw ?? "").trim();
    if (/mm$/i.test(s)) s = s.replace(/mm$/i, "").trim();
    if (!s) return def;
    const inner = s.replace(/^\[/, "").replace(/\]$/, "").trim();
    if (/[-~～—至]/.test(inner) && !/^-?\d+(\.\d+)?$/.test(inner)) {
        const compact = inner.replace(/\s*至\s*/g, "-").replace(/[～—~]/g, "-").replace(/\s+/g, "");
        return `[${compact}]`;
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : def;
}

function ageFromDates(birth: string, study: string): number | null {
    const b = String(birth).replace(/\D/g, "");
    const s = String(study).replace(/\D/g, "");
    if (b.length < 8 || s.length < 8) return null;
    const by = parseInt(b.slice(0, 4), 10);
    const bm = parseInt(b.slice(4, 6), 10);
    const bd = parseInt(b.slice(6, 8), 10);
    const sy = parseInt(s.slice(0, 4), 10);
    const sm = parseInt(s.slice(4, 6), 10);
    const sd = parseInt(s.slice(6, 8), 10);
    if (!by || !sy) return null;
    let age = sy - by;
    if (sm < bm || (sm === bm && sd < bd)) age -= 1;
    return age >= 0 && age < 150 ? age : null;
}

function ageBinLabel(age: number) {
    for (let i = 1; i < AGE_BINS.length; i++) {
        if (age <= AGE_BINS[i]) return `(${AGE_BINS[i - 1]}, ${AGE_BINS[i]}]`;
    }
    return "";
}

function mergeWwWc(ww: string, wc: string) {
    if (!ww && !wc) return "none";
    const wws = String(ww).split("\\");
    const wcs = String(wc).split("\\");
    const n = Math.max(wws.length, wcs.length);
    const pairs = [];
    for (let i = 0; i < n; i++) pairs.push([wcs[i] || "", wws[i] || ""]);
    return JSON.stringify(pairs);
}

function tagsToRow(tags: Record<string, string>): CaseRow | null {
    if (!Object.keys(tags).length) return null;
    const row: CaseRow = {};
    TAGS.forEach((t) => {
        if (t.key === "WindowWidth" || t.key === "WindowCenter") return;
        const raw = tags[t.key];
        if (raw === undefined || raw === "") {
            if (t.def !== undefined) row[t.key] = t.def;
            return;
        }
        if (t.key === "AGE") {
            const age = parseAge(raw);
            if (age != null) row.AGE = age;
            return;
        }
        if (t.key === "THICKNESS") {
            row[t.key] = parseThickness(raw, t.def);
            return;
        }
        if (t.key === "ConvolutionKernel") {
            row[t.key] = parseKernel(raw) || t.def;
            return;
        }
        if (t.key === "KVP" || t.key === "CTDIvol" || t.key === "SpacingBetweenSlices") {
            const n = parseFloat(raw);
            row[t.key] = Number.isFinite(n) ? n : t.def;
            return;
        }
        if (t.key === "PixelSpacing") {
            const n = parseFloat(raw.split("\\")[0]);
            row[t.key] = Number.isFinite(n) ? n : t.def;
            return;
        }
        row[t.key] = raw;
    });
    if (row.AGE == null && tags.PatientBirthDate && tags["study date"]) {
        const age = ageFromDates(tags.PatientBirthDate, tags["study date"]);
        if (age != null) row.AGE = age;
    }
    row.wc_ww = mergeWwWc(tags.WindowWidth || "", tags.WindowCenter || "");
    row.sex = row.SEX || "";
    row.age = row.AGE == null ? null : row.AGE;
    row.device = row.DEVICE && row.DEVICE !== "none" ? row.DEVICE : "";
    row.kvp = row.KVP == null ? "" : String(row.KVP);
    row.thickness = row.THICKNESS == null ? "" : String(row.THICKNESS);
    return row;
}

async function readOne(file: File): Promise<CaseRow | null> {
    const buf = await file.slice(0, HEADER_BYTES).arrayBuffer();
    return tagsToRow(parseDicomTags(buf));
}

function checkContinue(files: File[]) {
    const ins: number[] = [];
    files.forEach((f) => {
        const n = parseInt(f.name.replace(/\.dcm$/i, "").split("_").pop() || "", 10);
        if (Number.isFinite(n)) ins.push(n);
    });
    if (!ins.length) return false;
    return Math.max.apply(null, ins) - Math.min.apply(null, ins) + 1 === files.length;
}

function isSeriesFolder(name: string) {
    const n = String(name || "").trim();
    if (!n) return false;
    if (/^(dicom|dicomdir|images|image|data|s\d+|ser\d*|series\d*|st\d+|se\d+|im\d+)$/i.test(n)) return true;
    if (/^\d+\.\d+\.\d+/.test(n)) return true;
    if (/abdomen|thorax|chest|lung|pelvis|brain|head|neck|monitor|scout|localizer|topogram/i.test(n)) return true;
    if (/br\d+/i.test(n) || /dcm$/i.test(n) || /_\d+_\d+_/.test(n)) return true;
    return false;
}

function txidFromKeys(keys: string[]) {
    const split = (keys || []).map((k) => String(k || "").split("/").filter(Boolean));
    if (!split.length) return "";
    let i = 0;
    while (split.every((p) => p[i] && p[i] === split[0][i])) i += 1;
    const common = split[0].slice(0, i);
    let parts = common.length ? common : split[0];
    while (parts.length > 2 && isSeriesFolder(parts[parts.length - 1])) parts = parts.slice(0, -1);
    return parts[parts.length - 1] || "";
}

function mergeByStudy(rows: CaseRow[]): CaseRow[] {
    const map = new Map<string, { row: CaseRow; keys: string[]; slices: number }>();
    rows.forEach((r) => {
        const sig = [r.PatientID || "", r["ACC NO"] || "", r["study date"] || ""].join("|");
        const key = String(r._key || r.TXID || "");
        const slices = Number(r["image slices"] || 0) || 0;
        const hit = map.get(sig);
        if (!hit) {
            map.set(sig, { row: { ...r }, keys: key ? [key] : [], slices });
            return;
        }
        if (key) hit.keys.push(key);
        hit.slices += slices;
    });
    const grouped = Array.from(map.values()).map((g) => {
        const fromPath = txidFromKeys(g.keys);
        const txid = fromPath || String(g.row.PatientID || "").trim() || String(g.row.TXID || "");
        return { ...g, txid };
    });
    const txidCount = new Map<string, number>();
    grouped.forEach((g) => txidCount.set(g.txid, (txidCount.get(g.txid) || 0) + 1));
    return grouped.map((g) => {
        const row = g.row;
        const pid = String(row.PatientID || "").trim();
        row.TXID = (txidCount.get(g.txid) || 0) > 1 ? (pid || g.txid) : g.txid;
        row["image slices"] = g.slices;
        delete row._key;
        return trimCaseRow(row);
    });
}

/** 病例明细只保留指定列；统计用小写字段从保留列推导补齐。 */
export const KEEP_CASE_KEYS = [
    "TXID", "PatientID", "SeriesInstanceUID", "SEX", "DEVICE", "ConvolutionKernel",
    "PhotometricInterpretation", "AGE", "KVP", "THICKNESS", "PixelSpacing",
    "gt", "pred", "dice",
];

function trimCaseRow(row: CaseRow): CaseRow {
    const keep = new Set([...KEEP_CASE_KEYS, "study date", "ACC NO", "image slices", "医院"]);
    const out: CaseRow = {};
    keep.forEach((k) => { if (row[k] != null) out[k] = row[k]; });
    out.sex = out.SEX || "";
    out.age = out.AGE == null || out.AGE === "" ? null : out.AGE;
    out.device = out.DEVICE && out.DEVICE !== "none" ? out.DEVICE : "";
    out.kvp = out.KVP == null ? "" : String(out.KVP);
    out.thickness = out.THICKNESS == null ? "" : String(out.THICKNESS);
    return out;
}

export const normalizeStatsRows = (rows: CaseRow[]): CaseRow[] => mergeByStudy(rows || []);

/**
 * 解析上传的 Excel（含 TXID、gt、pred、dice 列），按 TXID 匹配行并覆盖这三列
 * （Excel 空单元格覆盖为空，数值 0 覆盖为 0）。未出现在 Excel 中的病例保持原值。
 * 表头列名兼容大小写与空格（如 GT/Pred/DICE）。
 */
export const importGpdExcel = async (rows: CaseRow[], file: File): Promise<{ rows: CaseRow[]; matched: number; unmatched: string[] }> => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error("Excel 无有效工作表");
    const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    if (!aoa.length) throw new Error("Excel 内容为空");
    // 表头定位：TXID / gt / pred / dice（列名兼容大小写与空格）
    const header = (aoa[0] || []).map((c) => String(c ?? "").trim().toLowerCase());
    const colOf = (names: string[]) => header.findIndex((h) => names.includes(h));
    const txCol = colOf(["txid", "tx id", "病例文件夹"]);
    const gtCol = colOf(["gt", "g/t", "金标准"]);
    const predCol = colOf(["pred", "prediction", "预测"]);
    const diceCol = colOf(["dice", "dice值", "dci系数", "dci"]);
    const missing: string[] = [];
    if (txCol < 0) missing.push("TXID");
    if (gtCol < 0) missing.push("gt");
    if (predCol < 0) missing.push("pred");
    if (diceCol < 0) missing.push("dice");
    if (missing.length) {
        throw new Error(`Excel 不符合模板，缺少列：${missing.join("、")}。第 1 行应为 TXID、gt、pred、dice`);
    }
    // 读入映射表：TXID -> { gt, pred, dice }；空单元格记为空字符串，0 记为 "0"，匹配到的行整列覆盖
    const cellText = (v: any) => {
        if (v == null) return "";
        const s = String(v).trim();
        return (!s || s === "/") ? "" : s;
    };
    const gpd = new Map<string, { gt: string; pred: string; dice: string }>();
    for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] || [];
        const tx = String(r[txCol] ?? "").trim();
        if (!tx) continue;
        gpd.set(tx, { gt: cellText(r[gtCol]), pred: cellText(r[predCol]), dice: cellText(r[diceCol]) });
    }
    if (!gpd.size) throw new Error("Excel 没有数据行");
    // 按 TXID 匹配填充
    let matched = 0;
    const used = new Set<string>();
    const next = (rows || []).map((row) => {
        const tx = String(row.TXID || "").trim();
        if (!tx) return row;
        // 先精确匹配，再尝试去掉常见前后缀（如尾缀 -1/_1 等）匹配
        let hit = gpd.get(tx);
        if (!hit) {
            for (const [k] of gpd) {
                if (k === tx || k.replace(/[\s_-]+$/, "") === tx.replace(/[\s_-]+$/, "")) { hit = gpd.get(k); used.add(k); break; }
            }
        } else {
            used.add(tx);
        }
        if (!hit) return row;
        matched += 1;
        const out = { ...row };
        out.gt = hit.gt;
        out.pred = hit.pred;
        out.dice = hit.dice;
        return out;
    });
    const unmatched = Array.from(gpd.keys()).filter((k) => !used.has(k));
    return { rows: next, matched, unmatched };
};

function caseKey(dirParts: string[]) {
    let end = dirParts.length;
    while (end > 2 && isSeriesFolder(dirParts[end - 1])) end -= 1;
    return dirParts.slice(0, Math.max(1, end)).join("/") || "_root";
}

function groupFiles(files: File[]) {
    const map = new Map<string, File[]>();
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const rel = relPath(file);
        const parts = rel.split("/").filter(Boolean);
        if (parts.some((p) => p.startsWith("."))) continue;
        if (!isDicomName(file.name)) continue;
        parts.pop();
        const key = caseKey(parts);
        const list = map.get(key);
        if (list) list.push(file);
        else map.set(key, [file]);
    }
    map.forEach((list, key) => {
        list.sort((a, b) => fileRank(a.name) - fileRank(b.name));
        map.set(key, list);
    });
    return map;
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
    let idx = 0;
    const n = Math.min(limit, Math.max(1, items.length));
    const runners = Array.from({ length: n }, async () => {
        while (idx < items.length) {
            const cur = items[idx++];
            await worker(cur);
        }
    });
    await Promise.all(runners);
}

export async function statsFromFiles(
    fileList: FileList | File[],
    onProgress?: (done: number, total: number) => void,
): Promise<CaseRow[]> {
    const files = Array.prototype.slice.call(fileList) as File[];
    const grouped = groupFiles(files);
    const keys = Array.from(grouped.keys());
    if (!keys.length) return [];
    const rows: CaseRow[] = [];
    let done = 0;
    await runPool(keys, 6, async (key) => {
        const candidates = grouped.get(key) || [];
        let row: CaseRow | null = null;
        const maxTry = Math.min(8, candidates.length);
        for (let i = 0; i < maxTry; i++) {
            try {
                row = await readOne(candidates[i]);
            } catch (_e) {
                row = null;
            }
            if (row) break;
        }
        if (row) {
            const parts = key.split("/").filter(Boolean);
            row._key = key;
            row.TXID = parts[parts.length - 1] || key;
            row["image slices"] = candidates.length;
            row.contiue = checkContinue(candidates);
            if (parts.length >= 3) row["医院"] = parts[parts.length - 2];
            rows.push(row);
        }
        done += 1;
        onProgress?.(done, keys.length);
    });
    return mergeByStudy(rows);
}

function addFactor(grid: any[][], item: string, counts: Map<string, number>, total: number) {
    let first = true;
    counts.forEach((count, cat) => {
        const ratio = total ? (count / total) : 0;
        grid.push([first ? item : "", cat, count, ratio.toFixed(2)]);
        first = false;
    });
}

function countBy(rows: CaseRow[], getter: (r: CaseRow) => string) {
    const map = new Map<string, number>();
    let any = false;
    rows.forEach((r) => {
        const key = getter(r);
        if (key && key !== "none") any = true;
        map.set(key, (map.get(key) || 0) + 1);
    });
    return any ? map : new Map<string, number>();
}

function countByAll(rows: CaseRow[], getter: (r: CaseRow) => string) {
    const map = new Map<string, number>();
    rows.forEach((r) => {
        const raw = getter(r);
        const key = !raw || raw === "none" ? "(空)" : raw;
        map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
}
void countByAll;

export function buildStatsGrid(
    title: string,
    rows: CaseRow[],
    extra?: { dataType?: string; disease?: string; person?: string },
) {
    const total = rows.length;
    const today = new Date().toISOString().slice(0, 10);
    const sites = new Set(rows.map((r) => r["医院"]).filter(Boolean));
    const grid: any[][] = [
        [title, "", "", ""],
        ["", "", "", ""],
        ["统计人", extra?.person || "", "统计日期", today],
        ["数据总量（序列）", total, "数据类型", extra?.dataType || ""],
        ["疾病构成", extra?.disease || "", "医院数量", sites.size || ""],
        ["数据分布", "", "", ""],
        ["因素", "类别", "序列数", "占比"],
    ];
    addFactor(grid, "性别", countBy(rows, (r) => r.sex || ""), total);
    const ageMap = new Map<string, number>();
    let hasAge = false;
    rows.forEach((r) => {
        if (r.age == null) return;
        const label = ageBinLabel(r.age);
        if (!label) return;
        hasAge = true;
        ageMap.set(label, (ageMap.get(label) || 0) + 1);
    });
    if (hasAge) {
        // 年龄分箱按区间顺序展示（0-17 → 17-40 → 40-90），空区间也显示（数量0）
        const sortedAgeMap = new Map<string, number>();
        AGE_BINS.slice(1).forEach((_, i) => {
            const label = `(${AGE_BINS[i]}, ${AGE_BINS[i + 1]}]`;
            sortedAgeMap.set(label, ageMap.get(label) || 0);
        });
        addFactor(grid, "年龄", sortedAgeMap, total);
    }
    addFactor(grid, "设备", countBy(rows, (r) => r.device || ""), total);
    addFactor(grid, "重建算法", countBy(rows, (r) => parseKernel(r.ConvolutionKernel)), total);
    addFactor(grid, "KVP", countBy(rows, (r) => r.kvp || ""), total);
    addFactor(grid, "层厚", countBy(rows, (r) => r.thickness || ""), total);
    return grid;
}

export function buildDetailAoa(rows: CaseRow[]) {
    const aoa: any[][] = [DETAIL_COLUMNS];
    rows.forEach((r) => aoa.push(DETAIL_COLUMNS.map((c) => {
        const v = r[c] == null ? "" : r[c];
        if ((c === "gt" || c === "pred" || c === "dice") && String(v).trim() === "") return "/";
        return v;
    })));
    return aoa;
}

const stripStatsTitle = (title: string) => String(title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").trim();

export const isStatsMetaSection = (n: any) => {
    const t = stripStatsTitle(n?.title);
    return n?.ref_type === "cover" || n?.ref_type === "revision" || n?.ref_type === "basic_info"
        || t === "文件修订记录" || t === "产品信息";
};

const rowsFromDetailAoa = (aoa: any[][]): CaseRow[] => {
    if (!aoa || aoa.length < 2) return [];
    const header = (aoa[0] || []).map((c: any) => String(c || ""));
    if (header[0] !== "PatientID") return [];
    return aoa.slice(1).map((row: any[]) => {
        const r: CaseRow = {};
        header.forEach((k, i) => { r[k] = row?.[i]; });
        return trimCaseRow(r);
    }).filter((r) => DETAIL_COLUMNS.some((k) => String(r[k] ?? "").trim()));
};

export const attachCaseRows = (section: any, item: StatsCacheItem) => ({
    ...(section || {}),
    case_rows: item.rows || [],
    case_meta: {
        person: item.person || "",
        dataType: item.dataType || "",
        disease: item.disease || "",
        source: item.source || "",
    },
});

export const caseRowsFromContent = (content: any): StatsCacheItem | null => {
    const walk = (ns: any[]): StatsCacheItem | null => {
        for (let i = 0; i < (ns || []).length; i++) {
            const n = ns[i];
            if (isStatsMetaSection(n)) {
                const nested = walk(n.children || []);
                if (nested) return nested;
                continue;
            }
            if (Array.isArray(n?.case_rows) && n.case_rows.length) {
                const m = n.case_meta || {};
                return {
                    rows: normalizeStatsRows(n.case_rows),
                    person: String(m.person || ""),
                    dataType: String(m.dataType || ""),
                    disease: String(m.disease || ""),
                    source: String(m.source || ""),
                };
            }
            const tables = n?.tables || [];
            for (let t = 0; t < tables.length; t++) {
                const rows = rowsFromDetailAoa(tables[t]);
                if (rows.length) return { rows, person: "", dataType: "", disease: "", source: "" };
            }
            const nested = walk(n.children || []);
            if (nested) return nested;
        }
        return null;
    };
    return walk((content && content.sections) || []);
};

export function buildTriageAoa(rows: CaseRow[]) {
    const header = ["Item", "Catgory", "pos_cases", "neg_cases", "Sen", "Spe"];
    const body: any[][] = [];
    const keys: Array<{ item: string; getter: (r: CaseRow) => string }> = [
        { item: "性别", getter: (r) => r.SEX == null ? String(r.sex || "") : String(r.SEX) },
        { item: "设备", getter: (r) => r.DEVICE == null ? String(r.device || "") : String(r.DEVICE) },
        { item: "KVP", getter: (r) => r.KVP == null ? String(r.kvp || "") : String(r.KVP) },
        { item: "层厚", getter: (r) => r.THICKNESS == null ? String(r.thickness || "") : String(r.THICKNESS) },
        { item: "重建算法", getter: (r) => parseKernel(r.ConvolutionKernel) },
    ];
    // gt 值：1=阳性，0=阴性（无 gt 视为阳性，保持总数口径）
    const gtPos = (r: CaseRow) => String(r.gt ?? "").trim() !== "0";
    const predPos = (r: CaseRow) => String(r.pred ?? "").trim() === "1";
    keys.forEach(({ item, getter }) => {
        const cats = new Map<string, { pos: number; neg: number; tp: number; fn: number; fp: number; tn: number }>();
        rows.forEach((r) => {
            const cat = getter(r) || "(空)";
            let hit = cats.get(cat);
            if (!hit) {
                hit = { pos: 0, neg: 0, tp: 0, fn: 0, fp: 0, tn: 0 };
                cats.set(cat, hit);
            }
            const isPos = gtPos(r);
            if (isPos) hit.pos += 1; else hit.neg += 1;
            // 灵敏度/特异度四格表（有 gt+pred 才计入）
            const hasGt = String(r.gt ?? "").trim() !== "";
            const hasPred = String(r.pred ?? "").trim() !== "";
            if (hasGt && hasPred) {
                const p = predPos(r);
                if (isPos) { p ? hit.tp += 1 : hit.fn += 1; }
                else { p ? hit.fp += 1 : hit.tn += 1; }
            }
        });
        cats.forEach((hit, cat) => {
            // 灵敏度 = TP/(TP+FN)；特异度 = TN/(TN+FP)；无法计算时用 / 占位
            const sen = hit.tp + hit.fn ? Math.round((hit.tp / (hit.tp + hit.fn)) * 1000) / 1000 : "/";
            const spe = hit.tn + hit.fp ? Math.round((hit.tn / (hit.tn + hit.fp)) * 1000) / 1000 : "/";
            body.push([item, cat, hit.pos, hit.neg, sen, spe]);
        });
    });
    return [header, ...body];
}

export function buildWorkbookSheets(
    title: string,
    rows: CaseRow[],
    extra?: { dataType?: string; disease?: string; person?: string; source?: string },
): SheetAoa[] {
    const triage = buildTriageAoa(rows);
    const deviceHead: any[][] = extra?.source
        ? [["数据来源", extra.source, "", ""], triage[0].slice(0, 4)]
        : [triage[0].slice(0, 4)];
    const device = [...deviceHead, ...triage.slice(1).map((r) => r.slice(0, 4))];
    return [
        { name: "病例明细", rows: buildDetailAoa(rows) },
        { name: "数据分布", rows: buildStatsGrid(title, rows, extra) },
        { name: "统计结果", rows: triage },
        { name: "设备分布", rows: device },
    ];
}

export function distRowsFromGrid(grid: any[][]) {
    const start = grid.findIndex((r) => r[0] === "因素" && r[1] === "类别");
    if (start < 0) return [];
    return grid.slice(start + 1).map((r, i) => ({
        key: i,
        factor: r[0] || "",
        category: r[1] == null ? "" : String(r[1]),
        count: r[2],
        ratio: r[3],
    }));
}

const STATS_STORE_KEY = "qms_data_stats_v1";

export type StatsCacheItem = {
    rows: CaseRow[];
    person: string;
    dataType: string;
    disease: string;
    source: string;
};

type StatsStore = {
    last?: { productId: number; kind: StatsKind };
    caches?: Record<string, StatsCacheItem>;
};

const slotKey = (productId: number, kind: string) => `${productId || 0}:${kind}`;

export const loadStatsStore = (): StatsStore => {
    try {
        const raw = localStorage.getItem(STATS_STORE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_e) {
        return {};
    }
};

export const readStatsCache = (productId: number, kind: StatsKind): StatsCacheItem | null => {
    const hit = loadStatsStore().caches?.[slotKey(productId, kind)];
    if (!hit || !Array.isArray(hit.rows) || !hit.rows.length) return null;
    return {
        ...hit,
        rows: normalizeStatsRows(hit.rows),
        source: String(hit.source || ""),
    };
};

export const readLastStats = (): { productId: number; kind: StatsKind; item: StatsCacheItem } | null => {
    const last = loadStatsStore().last;
    if (!last || (last.kind !== "raw" && last.kind !== "base" && last.kind !== "ann")) return null;
    const item = readStatsCache(last.productId || 0, last.kind);
    if (!item) return null;
    return { productId: last.productId || 0, kind: last.kind, item };
};

export const ANN_PID_TYPES = ["dd_008_01", "dd_008_02", "dd_009_01", "dd_009_02", "dd_009_03"];

export const pidsFromRows = (rows: CaseRow[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    (rows || []).forEach((r) => {
        const pid = String(r.PatientID || r.TXID || "").trim();
        if (!pid || pid === "none" || seen.has(pid)) return;
        seen.add(pid);
        out.push(pid);
    });
    return out;
};

export const pidsFromCache = (productId: number): string[] => {
    const last = readLastStats();
    const kinds: StatsKind[] = [];
    const add = (k?: StatsKind) => {
        if (k && !kinds.includes(k)) kinds.push(k);
    };
    if (last && (!productId || !last.productId || last.productId === productId)) add(last.kind);
    add("ann");
    add("raw");
    add("base");
    const ids = productId ? [productId, 0] : [0];
    for (let i = 0; i < ids.length; i++) {
        for (let j = 0; j < kinds.length; j++) {
            const hit = readStatsCache(ids[i], kinds[j]);
            if (!hit) continue;
            const pids = pidsFromRows(hit.rows);
            if (pids.length) return pids;
        }
    }
    return last ? pidsFromRows(last.item.rows) : [];
};

const defaultPidHeader = (docType: string) => (
    docType === "dd_009_03"
        ? ["评测日期", "评测项目", "数据类型", "PID", "测试医生1", "测试医生2", "二合一结果", "仲裁医生", "仲裁时间", "仲裁状态"]
        : ["标注日期", "标注人员", "标注项目", "数据类型", "PID", "可用状态", "审核日期", "审核医生", "审核结果"]
);

export type AnnotFillMeta = {
    annotDate: string;
    reviewDate: string;
    annotators: string[];
    reviewer: string;
    reviewers: string[];
    arbiters: string[];
    project: string;
    dataType: string;
    status: string;
    result: string;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const utcOf = (r: any) => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
    const y = num(r.year);
    const m = num(r.month);
    const d = num(r.day) || 1;
    if (isNaN(y) || isNaN(m) || m < 1 || m > 12 || d < 1) return null;
    return Date.UTC(y, m - 1, d);
};

const ymd = (ms: number) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

const matchAnnotText = (text: string, docType: string) => {
    const t = String(text || "");
    if (docType === "dd_008_01") return t.includes("试标注") && t.includes("肺栓塞");
    if (docType === "dd_008_02") return t.includes("试标注") && t.includes("肺叶");
    if (docType === "dd_009_01") return t.includes("标注记录") && t.includes("肺栓塞分割") && !t.includes("试标注") && !t.includes("分诊");
    if (docType === "dd_009_02") return t.includes("标注记录") && t.includes("肺叶") && !t.includes("试标注");
    if (docType === "dd_009_03") return t.includes("标注记录") && t.includes("分诊") && !t.includes("试标注");
    return false;
};

const matchAnnotLoose = (text: string, docType: string) => {
    const t = String(text || "");
    if (docType.indexOf("dd_008_") === 0) return t.includes("试标注");
    if (docType.indexOf("dd_009_") === 0) return t.includes("标注记录") && !t.includes("试标注");
    return false;
};

export const annotProjectOf = (docType: string) => {
    if (docType === "dd_008_02" || docType === "dd_009_02") return "肺叶分割";
    if (docType === "dd_009_03") return "肺栓塞分诊";
    return "肺栓塞分割";
};

export const annotDataTypeOf = (docType: string) => (docType === "dd_009_03" ? "测试集" : "训练集");

export const buildAnnotMeta = (docType: string, tlRows: any[], members: any[]): AnnotFillMeta => {
    const dates: number[] = [];
    (tlRows || []).forEach((r: any) => {
        if ((r.row_type || "date") !== "date") return;
        const dt = utcOf(r);
        if (dt == null) return;
        const text = String((r.cells || {})["数据部"] || "");
        if (matchAnnotText(text, docType)) dates.push(dt);
    });
    if (!dates.length) {
        (tlRows || []).forEach((r: any) => {
            if ((r.row_type || "date") !== "date") return;
            const dt = utcOf(r);
            if (dt == null) return;
            const text = String((r.cells || {})["数据部"] || "");
            if (matchAnnotLoose(text, docType)) dates.push(dt);
        });
    }
    const annotDate = dates.length ? ymd(Math.min.apply(null, dates)) : "";
    const reviewDate = dates.length ? ymd(Math.max.apply(null, dates)) : "";
    const annotators = (members || [])
        .filter((m: any) => String(m.role || "").trim() === "标注人员")
        .map((m: any) => String(m.name || "").trim())
        .filter(Boolean);
    const reviewers = (members || [])
        .filter((m: any) => String(m.role || "").trim() === "审核医生")
        .map((m: any) => String(m.name || "").trim())
        .filter(Boolean);
    const arbiters = (members || [])
        .filter((m: any) => String(m.role || "").trim() === "仲裁医生")
        .map((m: any) => String(m.name || "").trim())
        .filter(Boolean);
    return {
        annotDate,
        reviewDate,
        annotators,
        reviewers,
        reviewer: reviewers[0] || "",
        arbiters,
        project: annotProjectOf(docType),
        dataType: annotDataTypeOf(docType),
        status: "已标注",
        result: "通过",
    };
};

const cellByLabel = (label: string, pid: string, index: number, meta?: AnnotFillMeta, fillExtra = true) => {
    if (label === "PID") return pid;
    if (!fillExtra || !meta) return "";
    if (label === "标注日期") return meta.annotDate;
    if (label === "标注人员") return meta.annotators.length ? meta.annotators[index % meta.annotators.length] : "";
    if (label === "标注项目") return meta.project;
    if (label === "数据类型") return meta.dataType;
    if (label === "可用状态") return meta.status;
    if (label === "审核日期") return meta.reviewDate;
    if (label === "审核医生") {
        const list = (meta.reviewers && meta.reviewers.length) ? meta.reviewers : (meta.reviewer ? [meta.reviewer] : []);
        return list.length ? list[index % list.length] : "";
    }
    if (label === "审核结果") return meta.result;
    if (label === "评测日期") return meta.annotDate;
    if (label === "评测项目") return meta.project;
    if (label === "测试医生1") return meta.annotators[0] || "";
    if (label === "测试医生2") return meta.annotators[1] || "";
    if (label === "二合一结果") return "一致";
    if (label === "仲裁医生") return meta.arbiters.length ? meta.arbiters[index % meta.arbiters.length] : "";
    if (label === "仲裁时间") return meta.arbiters.length ? (meta.reviewDate || meta.annotDate) : "";
    if (label === "仲裁状态") return meta.arbiters.length ? "无需仲裁" : "";
    return "";
};

export const fillPidTable = (table: any[][], pids: string[], docType: string, meta?: AnnotFillMeta): any[][] => {
    const src = Array.isArray(table) ? table : [];
    let headerIdx = -1;
    let pidCol = -1;
    for (let i = 0; i < src.length; i++) {
        const row = Array.isArray(src[i]) ? src[i] : [];
        const col = row.findIndex((c: any) => String(c ?? "").trim() === "PID");
        if (col >= 0) {
            headerIdx = i;
            pidCol = col;
            break;
        }
    }
    const header = headerIdx >= 0 ? [...(src[headerIdx] || [])] : defaultPidHeader(docType);
    if (pidCol < 0) pidCol = header.findIndex((c) => String(c ?? "").trim() === "PID");
    if (pidCol < 0) pidCol = header.length > 4 ? 4 : header.length ? header.length - 1 : 0;
    const cols = Math.max(header.length, 1);
    const prefix = (headerIdx >= 0 ? src.slice(0, headerIdx) : []).map((r) => {
        const next = Array.isArray(r) ? [...r] : [];
        while (next.length < cols) next.push("");
        return next;
    });
    const head = [...header];
    while (head.length < cols) head.push("");
    const fillExtra = true;
    const dataRows = pids.map((pid, index) => {
        const row = Array(cols).fill("");
        for (let c = 0; c < cols; c++) {
            row[c] = cellByLabel(String(head[c] ?? "").trim(), pid, index, meta, fillExtra);
        }
        if (!String(row[pidCol] ?? "").trim()) row[pidCol] = pid;
        return row;
    });
    return [...prefix, head, ...dataRows];
};

const isPidMeta = (n: any) => {
    const t = String(n?.title || "").replace(/^\s*\d+(?:\.\d+)*[、.\s]*/, "").trim();
    return n?.ref_type === "cover" || n?.ref_type === "revision" || n?.ref_type === "basic_info"
        || t === "文件修订记录" || t === "产品信息";
};

const tableHasPid = (tb: any[]) =>
    (tb || []).some((row: any[]) => (row || []).some((c: any) => String(c ?? "").trim() === "PID"));

export const applyPidsToSections = (sections: any[], pids: string[], docType: string, meta?: AnnotFillMeta): any[] => {
    const walk = (ns: any[]): any[] => (ns || []).map((n) => {
        if (isPidMeta(n)) return { ...n, children: walk(n.children || []) };
        const src = Array.isArray(n.tables) ? n.tables : [];
        const tables = src.length
            ? src.map((tb: any[]) => (tableHasPid(tb) || !(tb || []).length ? fillPidTable(tb, pids, docType, meta) : tb))
            : [fillPidTable([], pids, docType, meta)];
        if (!tables.some((tb: any[]) => tableHasPid(tb))) {
            tables[0] = fillPidTable(src[0] || [], pids, docType, meta);
        }
        return { ...n, tables, children: walk(n.children || []) };
    });
    return walk(sections);
};

export const annotTableSig = (sections: any[]): string => {
    const rows: any[] = [];
    const walk = (ns: any[]) => {
        (ns || []).forEach((n) => {
            if (isPidMeta(n)) { walk(n.children || []); return; }
            (n.tables || []).forEach((tb: any[]) => {
                if (tableHasPid(tb)) rows.push(tb);
            });
            walk(n.children || []);
        });
    };
    walk(sections);
    return JSON.stringify(rows);
};

export const saveStatsCache = (productId: number, kind: StatsKind, item: StatsCacheItem): boolean => {
    try {
        const store = loadStatsStore();
        const caches = { ...(store.caches || {}) };
        caches[slotKey(productId, kind)] = {
            rows: item.rows || [],
            person: item.person || "",
            dataType: item.dataType || "",
            disease: item.disease || "",
            source: item.source || "",
        };
        localStorage.setItem(STATS_STORE_KEY, JSON.stringify({
            last: { productId: productId || 0, kind },
            caches,
        }));
        return true;
    } catch (_e) {
        return false;
    }
};
