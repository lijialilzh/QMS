// 本机解析 DICOM 头并汇总。口径对齐 scripts/data_stats，见 docs/function_docs/101_数据统计.md。

export type CaseRow = Record<string, any>;
export type StatsKind = "raw" | "base" | "ann";
export type SheetAoa = { name: string; rows: any[][] };

export const STATS_TITLES: Record<StatsKind, string> = {
    raw: "原始数据库统计表",
    base: "基础数据库统计表",
    ann: "标注数据库统计表",
};

export const DETAIL_COLUMNS = [
    "PatientID", "SeriesInstanceUID", "study date", "ACC NO", "SEX", "DEVICE",
    "ConvolutionKernel", "Series Description", "ManufacturerModelName", "PatientPosition",
    "Body Part Examined", "PhotometricInterpretation", "AGE", "KVP", "THICKNESS", "wc_ww",
    "Columns", "Rows", "SeriesNumber", "CTDIvol", "Exposure", "ImageOrientation",
    "PixelSpacing", "SpacingBetweenSlices", "TXID", "image slices", "contiue",
];

export const DETAIL_PREVIEW_COLUMNS = [
    "TXID", "SEX", "AGE", "DEVICE", "KVP", "THICKNESS", "ConvolutionKernel",
    "image slices", "Series Description",
];

const HEADER_BYTES = 512 * 1024;
const AGE_BINS = [0, 18, 40, 60, 110];
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

function looksText(s: string) {
    if (!s) return false;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 9 || c === 10 || c === 13 || c === 92) continue;
        if (c < 32 || c > 126) return false;
    }
    return true;
}

function huntTag(u8: Uint8Array, view: DataView, tag: number, expectVr: string): string {
    const group = (tag >>> 16) & 0xffff;
    const element = tag & 0xffff;
    const b0 = group & 0xff;
    const b1 = (group >> 8) & 0xff;
    const b2 = element & 0xff;
    const b3 = (element >> 8) & 0xff;
    const start = isDicm(u8) ? 132 : 0;
    for (let i = start; i + 8 <= u8.length; i++) {
        if (u8[i] !== b0 || u8[i + 1] !== b1 || u8[i + 2] !== b2 || u8[i + 3] !== b3) continue;
        const vr = String.fromCharCode(u8[i + 4], u8[i + 5]);
        let len = 0;
        let valOff = 0;
        let useVr = expectVr;
        if (/^[A-Z]{2}$/.test(vr) && vr !== "SQ") {
            if (LONG_VR.has(vr)) {
                if (i + 12 > u8.length) continue;
                len = view.getUint32(i + 8, true);
                valOff = i + 12;
            } else {
                len = view.getUint16(i + 6, true);
                valOff = i + 8;
            }
            useVr = vr === "UN" ? expectVr : vr;
        } else {
            len = view.getUint32(i + 4, true);
            valOff = i + 8;
        }
        if (len === 0xffffffff || len < 0 || valOff + len > u8.length) continue;
        if (len > 1024) continue;
        if (expectVr === "US" && len !== 2 && len !== 4) continue;
        if (expectVr === "DA" && len !== 8 && len !== 10) continue;
        const v = readValue(useVr, view, u8, valOff, len, true);
        if (!v) continue;
        if (expectVr === "US" || expectVr === "FL" || expectVr === "FD" || expectVr === "UL") return v;
        if (looksText(v)) return v;
    }
    return "";
}

function parseDicomTags(buf: ArrayBuffer): Record<string, string> {
    const u8 = new Uint8Array(buf);
    const view = new DataView(buf);
    const out: Record<string, string> = {};
    if (buf.byteLength < 8) return out;
    TAGS.forEach((t) => {
        const v = huntTag(u8, view, t.tag, t.vr);
        if (v) out[t.key] = v;
    });
    const birth = huntTag(u8, view, 0x00100030, "DA");
    if (birth) out.PatientBirthDate = birth;
    return out;
}

function parseAge(raw: string): number | null {
    const m = String(raw || "").match(/(\d+)/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
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
        if (age <= AGE_BINS[i]) return `(${AGE_BINS[i - 1]}.0, ${AGE_BINS[i]}.0]`;
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
        if (t.key === "KVP" || t.key === "THICKNESS" || t.key === "CTDIvol" || t.key === "SpacingBetweenSlices") {
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

function groupFiles(files: File[]) {
    const map = new Map<string, File[]>();
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const rel = relPath(file);
        const parts = rel.split("/").filter(Boolean);
        if (parts.some((p) => p.startsWith("."))) continue;
        if (!isDicomName(file.name)) continue;
        parts.pop();
        const key = parts.join("/") || "_root";
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
            row.TXID = parts[parts.length - 1] || key;
            row["image slices"] = candidates.length;
            row.contiue = checkContinue(candidates);
            if (parts.length >= 3) row["医院"] = parts[parts.length - 2];
            rows.push(row);
        }
        done += 1;
        onProgress?.(done, keys.length);
    });
    return rows;
}

function addFactor(grid: any[][], item: string, counts: Map<string, number>, total: number) {
    let first = true;
    counts.forEach((count, cat) => {
        const ratio = total ? Math.round((count / total) * 1e6) / 1e6 : 0;
        grid.push([first ? item : "", cat, count, ratio]);
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
    if (hasAge) addFactor(grid, "年龄", ageMap, total);
    addFactor(grid, "设备", countBy(rows, (r) => r.device || ""), total);
    addFactor(grid, "KVP", countBy(rows, (r) => r.kvp || ""), total);
    addFactor(grid, "层厚", countBy(rows, (r) => r.thickness || ""), total);
    return grid;
}

export function buildDetailAoa(rows: CaseRow[]) {
    const aoa: any[][] = [DETAIL_COLUMNS];
    rows.forEach((r) => aoa.push(DETAIL_COLUMNS.map((c) => (r[c] == null ? "" : r[c]))));
    return aoa;
}

export function buildTriageAoa(rows: CaseRow[]) {
    const header = ["Item", "Catgory", "pos_cases", "neg_cases", "Sen", "Spe"];
    const body: any[][] = [];
    const keys: Array<{ item: string; getter: (r: CaseRow) => string }> = [
        { item: "SEX", getter: (r) => r.SEX == null ? String(r.sex || "") : String(r.SEX) },
        { item: "DEVICE", getter: (r) => r.DEVICE == null ? String(r.device || "") : String(r.DEVICE) },
        { item: "KVP", getter: (r) => r.KVP == null ? String(r.kvp || "") : String(r.KVP) },
        { item: "THICKNESS", getter: (r) => r.THICKNESS == null ? String(r.thickness || "") : String(r.THICKNESS) },
        { item: "ConvolutionKernel", getter: (r) => r.ConvolutionKernel == null ? "" : String(r.ConvolutionKernel) },
    ];
    keys.forEach(({ item, getter }) => {
        countByAll(rows, getter).forEach((count, cat) => {
            body.push([item, cat, count, 0, "", ""]);
        });
    });
    return [header, ...body];
}

export function buildWorkbookSheets(
    title: string,
    rows: CaseRow[],
    extra?: { dataType?: string; disease?: string; person?: string },
): SheetAoa[] {
    const triage = buildTriageAoa(rows);
    const device = [triage[0].slice(0, 4), ...triage.slice(1).map((r) => r.slice(0, 4))];
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
