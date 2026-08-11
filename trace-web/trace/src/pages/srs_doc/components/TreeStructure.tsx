import "./TreeStructure.less";
import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button, Input, Space, Popconfirm, Table, Empty, Tooltip, Select, Tag, Upload, message, Image } from "antd";
import { PlusOutlined, DeleteOutlined, TableOutlined, EditOutlined, FileOutlined, UploadOutlined, CaretRightOutlined, CaretDownOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import EditableTableGenerator, { TableDataWithHeaders } from "./EditableTableGenerator";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile, UploadProps } from "antd/es/upload/interface";
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from "xlsx";
import * as Api from "@/api/ApiSrsDoc";
import * as ApiDocFile from "@/api/ApiDocFile";

// 表格数据结构（匹配后端接口，允许空对象表示无表格数据）
interface TableData {
    name?: string;
    show_header?: number;
    headers?: Array<{ code: string; name: string }>;
    rows?: { [key: string]: any }[];
    cells?: Array<Array<{ value?: string; row_span?: number; col_span?: number; h_align?: string; v_align?: string }>>;
    req_detail_key?: string;
}

export interface TreeNode {
    id: number;
    doc_id?: number;
    n_id?: number;
    p_id?: number;
    title: string;
    srs_code?: string | null; // 标准模板中需填写 SRS 编码的节点：srs_code=null 时不展示输入框
    rcm_codes?: string[] | null; // RCM 编号数组（code 列表），用于章节 RCM 选择控件
    text?: string;
    ref_type?: string;  // 有则表示该节点对应文件，用 img_url 展示，替换 textarea
    img_url?: string;  // 文件地址，点击下载/打开
    label?: string;    // 不展示，但上传时需传递给后端
    req_detail_key?: string; // 功能描述稳定绑定 key，不随 SRS 编号/模块/功能/子功能变化
    table?: TableData | null; // 允许空对象/ null 表示无表格数据
    children: TreeNode[];
}

const REF_TYPE_LABEL_KEYS: Record<string, string> = {
    img_struct: 'srs_doc.ref_type_struct',
    img_flow: 'srs_doc.ref_type_flow',
    img_topo: 'srs_doc.ref_type_topo',
};

function getRefTypeLabel(refType: string | undefined, ts: (key: string) => string): string {
    if (!refType) return '';
    return ts(REF_TYPE_LABEL_KEYS[refType] || refType);
}

const IMG_REF_TYPES = ['img_struct', 'img_flow', 'img_topo'];
const PRODUCT_BOUND_DOC_IMAGE_REF_TYPES = ['img_topo', 'img_struct'] as const;
type ProductBoundDocImageRefType = typeof PRODUCT_BOUND_DOC_IMAGE_REF_TYPES[number];

function isImgRefType(refType: string | undefined): boolean {
    return !!refType && IMG_REF_TYPES.includes(refType);
}

function isDataUrl(url: string | undefined): boolean {
    return !!url && /^data:/i.test(url);
}

function resolveFileUrl(url: string | undefined): string {
    if (!url) return "";
    if (isDataUrl(url) || url.startsWith("http") || url.startsWith("blob:")) return url;
    return `${window.location.origin}/${url.replace(/^\//, "")}`;
}

function isImportedImageNode(node: TreeNode): boolean {
    const title = (node.title || "").trim();
    const onlyImage = !!node.img_url && !node.text && (!node.table || !node.table.headers?.length) && (!node.children || node.children.length === 0);
    return /^导入图片\d*$/.test(title) && onlyImage;
}

function isEmbeddedImageNode(node: TreeNode): boolean {
    const title = (node.title || "").trim();
    const onlyImage = !!node.img_url && !node.text && (!node.table || !node.table.headers?.length) && (!node.children || node.children.length === 0);
    return isImportedImageNode(node) || (onlyImage && (
        /^导入图片\d*$/.test(title)
        || /^图\s*\d+/i.test(title)
        || /程序逻辑|流程图|结构图|拓扑图/.test(title)
    ));
}

function isImportedTableNode(node: TreeNode): boolean {
    const title = (node.title || "").trim();
    const hasTable = !!(node.table && Array.isArray(node.table.headers) && node.table.headers.length > 0 && Array.isArray(node.table.rows));
    const noExtra = !node.img_url && !node.text && (!node.children || node.children.length === 0);
    return /^导入表格\d*$/.test(title) && hasTable && noExtra;
}

function isEmbeddedTableNode(node: TreeNode): boolean {
    // 只隐藏 Word 解析出的“导入表格”承载节点；真实目录节点必须按 Word 原结构显示。
    return isImportedTableNode(node);
}

/** 与 SDS/IMM 一致：去掉标题里已有章节号前缀，编辑时只填名称 */
function stripNavChapterPrefix(title: string): string {
    return String(title || "")
        .replace(/^\s*\d+(?:\.\d+)*(?:[、.\s　]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
        .trim();
}

function isNavTableTitleNode(node: TreeNode): boolean {
    const title = String(node.title || node.label || "").trim();
    return /^\s*表\d+([、.\s　]|$)/.test(title);
}

function isNavChapterNodeForMap(n: TreeNode): boolean {
    if (isEmbeddedImageNode(n) || isEmbeddedTableNode(n)) return false;
    if (n.ref_type === "srs_reqs" || n.ref_type === "srs_reqs_2" || n.ref_type === "srs_reqds") return false;
    if (n.label === "__auto_req_group" || n.label === "__auto_req_detail") return false;
    return true;
}

function isNavUnnumberedNode(node: TreeNode): boolean {
    return isNavTableTitleNode(node);
}

function computeNavChapterNumberMap(list: TreeNode[]): Map<string, string> {
    const map = new Map<string, string>();
    const walkChildren = (nodes: TreeNode[], prefix: string) => {
        let idx = 0;
        (nodes || []).filter(isNavChapterNodeForMap).forEach((node) => {
            if (isNavUnnumberedNode(node)) {
                map.set(String(node.id), "");
                walkChildren(node.children || [], prefix);
                return;
            }
            idx += 1;
            const num = prefix ? `${prefix}.${idx}` : `${idx}`;
            map.set(String(node.id), num);
            walkChildren(node.children || [], num);
        });
    };
    let bodyIdx = 0;
    (list || []).filter(isNavChapterNodeForMap).forEach((node) => {
        if (isNavUnnumberedNode(node)) {
            map.set(String(node.id), "");
            walkChildren(node.children || [], "");
            return;
        }
        bodyIdx += 1;
        const num = String(bodyIdx);
        map.set(String(node.id), num);
        walkChildren(node.children || [], num);
    });
    return map;
}

function isImportedTableCarrierTitle(title?: string): boolean {
    return /^导入表格\d*$/.test(String(title || "").trim());
}

function stripTableTitleFromText(text: string | undefined, tableTitle?: string): string {
    if (!tableTitle?.trim()) return String(text || "");
    const title = tableTitle.trim();
    const normalizedTitle = title.replace(/[：:]/g, "").trim();
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    const filtered = lines.filter((line) => {
        const normalized = line.trim().replace(/[：:]/g, "").trim();
        return normalized !== normalizedTitle && line.trim() !== title;
    });
    return filtered.join("\n").trim();
}

function resolveDeletedTableTitle(parent: TreeNode | undefined, target: TreeNode): string {
    const fromTable = String(target.table?.name || "").trim();
    if (fromTable) return fromTable;
    if (!parent) return "";
    const tableChildren = (parent.children || []).filter((child) => isImportedTableCarrierTitle(child.title));
    const idx = tableChildren.findIndex((child) => child.id === target.id);
    if (idx < 0) return "";
    const { tableHeaders } = splitTextByTables(parent.text, tableChildren.length);
    return tableHeaders[idx]?.tableTitle || "";
}

function isReqMainTable(table?: TableData | null): boolean {
    if (!table?.headers?.length) return false;
    const hs = table.headers.map((h) => normalizeCellText(h?.name));
    return hs.some((h) => isReqCodeHeaderText(h)) && hs.some((h) => h.includes("功能"));
}

function isReqOtherTable(table?: TableData | null): boolean {
    if (!table?.headers?.length) return false;
    const hs = table.headers.map((h) => normalizeCellText(h?.name));
    return hs.some((h) => isReqCodeHeaderText(h)) && hs.some((h) => h.includes("章节"));
}

function normalizeRcmCode(code: string | undefined): string {
    return String(code || "")
        .trim()
        .toUpperCase()
        .replace(/[，。；;、,.]+$/g, "");
}

function extractRcmCodesFromText(text: string | undefined): string[] {
    const content = String(text || "");
    const hits = content.match(/RCM[\s\-_]*\d{2,4}/gi) || [];
    const normalized = hits
        .map((hit) => normalizeRcmCode(hit).replace(/[\s\-_]/g, ""))
        .filter((code) => /^RCM\d{2,4}$/.test(code));
    return Array.from(new Set(normalized));
}

const KV_FIELD_LABELS = new Set([
    "需求编号",
    "需求名称",
    "需求概述",
    "需求描述",
    "主参加者",
    "前置条件",
    "触发器",
    "工作流",
    "事件流",
    "后置条件",
    "异常情况",
    "约束",
]);
const REQ_DETAIL_KEY_FIELD = "__req_detail_key";

function normalizeCellText(value: string | undefined): string {
    return String(value || "")
        .replace(/[\s↩\r\n\t]+/g, "")
        .replace(/[：:，,。.;；、]/g, "")
        .toLowerCase();
}

function renderChangeTableTitle(title?: string) {
    const txt = String(title || "").trim();
    return txt || "变更需求";
}

function stripChangeTableTitleHeading(value?: string) {
    return String(value || "")
        .trim()
        .replace(/[：:，,。.;；、]/g, "")
        .replace(/^\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
        .trim();
}

function normalizeChangeTableTitleKey(value?: string) {
    return normalizeCellText(value).replace(/\s+/g, "");
}

function matchesChangeTableTitle(left?: string, right?: string) {
    const leftKey = normalizeChangeTableTitleKey(left);
    const rightKey = normalizeChangeTableTitleKey(right);
    if (!leftKey || !rightKey) return false;
    if (leftKey === rightKey) return true;
    const leftBody = normalizeChangeTableTitleKey(stripChangeTableTitleHeading(left));
    const rightBody = normalizeChangeTableTitleKey(stripChangeTableTitleHeading(right));
    return !!leftBody && !!rightBody && leftBody === rightBody;
}

function findChangeTableForPreview(
    changeTables: Array<{ id: number | string; title: string; data: any[]; type_code?: string }> = [],
    table?: TableData | null,
    title?: string,
    options?: { allowSingleFallback?: boolean },
) {
    const treeTitle = renderChangeTableTitle(table?.name || title);
    const titleMatched = changeTables.find((item) => matchesChangeTableTitle(treeTitle, item?.title));
    if (titleMatched) return titleMatched;
    // 关键：仅在调用方显式传 allowSingleFallback=true 时才回退。
    // 旧默认 true 在"多张变更表 / DB 状态滞后"等场景下会错把另一张表的数据当作当前表数据
    // （例如点击的是 2.0 变更需求，但 srsReqPreview.changes 里此刻只有 变更需求1，就会拿后者的 data）。
    if (options?.allowSingleFallback === true && changeTables.length === 1) return changeTables[0];
    return undefined;
}

function buildChangeRowsFromRenderedTable(table?: TableData | null) {
    if (!table?.headers?.length || !Array.isArray(table.rows)) return [];
    const headers = table.headers;
    const pickColumn = (matcher: (text: string) => boolean) => (
        headers.find((header) => matcher(normalizeCellText(header?.name)))?.code || ""
    );
    const codeCol = pickColumn((text) => isReqCodeHeaderText(text));
    const moduleCol = pickColumn((text) => text.includes("模块"));
    const functionCol = pickColumn((text) => text.includes("功能") && !text.includes("子功能"));
    const subFunctionCol = pickColumn((text) => text.includes("子功能"));
    return (table.rows || [])
        .map((row: any, index: number) => ({
            key: `rendered_change_${index}`,
            srs_code: String(row?.[codeCol] || extractSrsCodeFromTableRow(row) || "").trim(),
            module: normalizeReqDisplayText(row?.[moduleCol]),
            function: normalizeReqDisplayText(row?.[functionCol]),
            sub_function: normalizeReqDisplayText(row?.[subFunctionCol]),
        }))
        .filter((row) => row.srs_code || row.module || row.function || row.sub_function);
}

function isReqCodeHeaderText(text: string): boolean {
    return text.includes("需求编号") || text.includes("需求列表") || text.includes("srscode") || text === "code";
}

function normalizeReqDisplayText(value: any): string {
    const txt = String(value ?? "").trim();
    if (!txt) return "";
    const invalid = new Set(["/", "\\", "／", "＼", "-", "--", "_", "无", "N/A", "n/a", "NA", "na", "null", "NULL", "None", "none"]);
    return invalid.has(txt) ? "" : txt;
}

const NUMBERED_REQ_DETAIL_FIELDS = new Set(["事件流", "工作流", "工作流程", "前置条件", "触发器", "后置条件", "异常情况", "约束"]);

function normalizeReqDetailNumberedText(value: any, fieldLabel?: string): string {
    const text = normalizeReqDisplayText(value);
    if (!text) return "";
    const label = normalizeCellText(fieldLabel || "");
    if (!Array.from(NUMBERED_REQ_DETAIL_FIELDS).some((field) => label.includes(normalizeCellText(field)))) {
        return text;
    }
    let nextNo = 1;
    const numberedLine = /^(\s*)(\d{1,4})([）)、．]|[.](?!\d))\s*(.*)$/;
    return text.split(/\r?\n/).map((line) => {
        const matched = String(line || "").match(numberedLine);
        if (!matched) return line;
        const prefix = matched[1] || "";
        const sep = matched[3] === "．" ? "." : matched[3];
        const rest = matched[4] || "";
        return `${prefix}${nextNo++}${sep} ${rest}`.trimEnd();
    }).join("\n");
}

function normalizeReqDetailKey(value: any): string {
    return String(value || "").trim();
}

function getRowReqDetailKey(row: any): string {
    return normalizeReqDetailKey(row?.[REQ_DETAIL_KEY_FIELD] || row?.req_detail_key);
}

function getTableReqDetailKey(table?: TableData | null): string {
    if (!table) return "";
    const directKey = normalizeReqDetailKey((table as any).req_detail_key);
    if (directKey) return directKey;
    for (const row of table.rows || []) {
        const rowKey = getRowReqDetailKey(row);
        if (rowKey) return rowKey;
    }
    return "";
}

function getSrsCodeOrderKey(code?: string): string {
    const matched = normalizeSrsCodeValue(code).match(/^SRS-[A-Z]+?(\d+)-(\d+)$/);
    return matched ? `${parseInt(matched[1], 10)}-${parseInt(matched[2], 10)}` : "";
}

function getLegacyReqDetailKeyByCode(code?: string): string {
    const normalizedCode = normalizeSrsCodeValue(code);
    const orderKey = getSrsCodeOrderKey(normalizedCode);
    return orderKey ? `legacy_reqd_${orderKey}` : (normalizedCode ? `legacy_reqd_${normalizedCode}` : "");
}

function normalizeSrsCodeValue(value?: string): string {
    return String(value || "").replace(/\s+/g, "").toUpperCase();
}

export function validateStandardSrsCodeUnique(
    rows: Array<{ srs_code?: string; code?: string; [key: string]: any }> = [],
    codeResolver?: (row: any, index: number) => string,
): string {
    const resolveCode = codeResolver || ((row) => normalizeSrsCodeValue(row?.srs_code || row?.code || ""));
    const seen = new Map<string, number>();
    for (let index = 0; index < rows.length; index += 1) {
        const code = resolveCode(rows[index], index);
        if (!code) continue;
        if (seen.has(code)) {
            const firstRow = seen.get(code)! + 1;
            const duplicateRow = index + 1;
            return `产品需求列表中 SRS 编号 ${code} 重复（第 ${firstRow} 行与第 ${duplicateRow} 行），请确保每条标准需求的编号唯一`;
        }
        seen.set(code, index);
    }
    return "";
}

export type StandardReqTableRow = {
    code: string;
    module: string;
    function: string;
    sub_function: string;
};

function pickStandardReqTableColumns(headers: Array<{ code: string; name: string }> = []) {
    const normalizeHeader = (value?: string) => String(value || "")
        .replace(/[\s↩\r\n\t]+/g, "")
        .replace(/[：:，,。.;；、]/g, "")
        .toLowerCase();
    const pickColumn = (matcher: (text: string) => boolean) => (
        headers.find((header) => matcher(normalizeHeader(header?.name)))?.code || ""
    );
    return {
        codeCol: pickColumn((text) => isReqCodeHeaderText(text)),
        moduleCol: pickColumn((text) => text.includes("模块")),
        functionCol: pickColumn((text) => text.includes("功能") && !text.includes("子功能")),
        subFunctionCol: pickColumn((text) => text.includes("子功能")),
    };
}

export function buildStandardReqRowsFromTableHeaders(
    headers: Array<{ code: string; name: string }> = [],
    rows: Array<Record<string, any>> = [],
): StandardReqTableRow[] {
    const { codeCol, moduleCol, functionCol, subFunctionCol } = pickStandardReqTableColumns(headers);
    if (!codeCol || !moduleCol || !functionCol) return [];

    const getSrsExportGroup = (code: string) => {
        const normalized = normalizeSrsCodeValue(code);
        return normalized.match(/^(SRS-[A-Z]+\d+)-\d+$/)?.[1] || normalized;
    };
    const lastValues: Record<string, string> = {};
    return (rows || [])
        .map((row) => {
            const code = normalizeSrsCodeValue(row?.[codeCol]);
            const group = getSrsExportGroup(code);
            const sameGroup = !!group && group === lastValues.group;
            if (!sameGroup) {
                lastValues.group = group;
                lastValues.module = "";
                lastValues.function = "";
                lastValues.sub_function = "";
            }
            const rawModule = normalizeReqDisplayText(row?.[moduleCol]);
            const rawFunction = normalizeReqDisplayText(row?.[functionCol]);
            const rawSubFunction = normalizeReqDisplayText(row?.[subFunctionCol]);
            if (rawModule) {
                lastValues.module = rawModule;
                lastValues.function = "";
                lastValues.sub_function = "";
            }
            if (rawFunction) {
                lastValues.function = rawFunction;
                lastValues.sub_function = "";
            }
            if (rawSubFunction) {
                lastValues.sub_function = rawSubFunction;
            }
            return {
                code,
                module: rawModule || (sameGroup ? lastValues.module || "" : ""),
                function: rawFunction || (sameGroup ? lastValues.function || "" : ""),
                sub_function: rawSubFunction || (sameGroup ? lastValues.sub_function || "" : ""),
            };
        })
        .filter((row) => row.code);
}

export function validateStandardSrsRowContent(rows: StandardReqTableRow[] = []): string {
    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (!row.code) continue;
        if (!row.module && !row.function && !row.sub_function) {
            return `产品需求列表第 ${index + 1} 行已填写 SRS 编号 ${row.code}，模块/功能/子功能至少填写一项`;
        }
    }
    return "";
}

/** 按行原始填写值校验，不使用合并单元格继承值 */
export function validateStandardSrsRowContentRaw(
    headers: Array<{ code: string; name: string }> = [],
    rows: Array<Record<string, any>> = [],
): string {
    const { codeCol, moduleCol, functionCol, subFunctionCol } = pickStandardReqTableColumns(headers);
    if (!codeCol || !moduleCol || !functionCol) return "";

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const code = normalizeSrsCodeValue(row?.[codeCol]);
        if (!code) continue;
        const module = normalizeReqDisplayText(row?.[moduleCol]);
        const fn = normalizeReqDisplayText(row?.[functionCol]);
        const subFn = normalizeReqDisplayText(row?.[subFunctionCol]);
        if (!module && !fn && !subFn) {
            return `产品需求列表第 ${index + 1} 行已填写 SRS 编号 ${code}，模块/功能/子功能至少填写一项`;
        }
    }
    return "";
}

export function validateStandardSrsTableRows(
    headers: Array<{ code: string; name: string }> = [],
    rows: Array<Record<string, any>> = [],
): string {
    const { codeCol } = pickStandardReqTableColumns(headers);
    const duplicateMsg = validateStandardSrsCodeUnique(rows, (row) => (
        normalizeSrsCodeValue(codeCol ? String(row?.[codeCol] || "") : "")
    ));
    if (duplicateMsg) return duplicateMsg;
    const contentMsg = validateStandardSrsRowContentRaw(headers, rows);
    if (contentMsg) return contentMsg;
    const effectiveRows = resolveEffectiveReqRowsFromTable(headers, rows);
    return validateReqHierarchyDuplicates(effectiveRows, "产品需求列表");
}

export function validateStandardSrsDataRows(
    rows: Array<{ srs_code?: string; code?: string; module?: string; function?: string; sub_function?: string }> = [],
): string {
    const duplicateMsg = validateStandardSrsCodeUnique(rows);
    if (duplicateMsg) return duplicateMsg;
    const mappedRows: StandardReqTableRow[] = (rows || []).map((row) => ({
        code: normalizeSrsCodeValue(row?.srs_code || row?.code || ""),
        module: normalizeReqDisplayText(row?.module),
        function: normalizeReqDisplayText(row?.function),
        sub_function: normalizeReqDisplayText(row?.sub_function),
    }));
    const contentMsg = validateStandardSrsRowContent(mappedRows.filter((row) => row.code));
    if (contentMsg) return contentMsg;
    const effectiveRows = resolveEffectiveReqRowsFromData(rows);
    return validateReqHierarchyDuplicates(effectiveRows, "产品需求列表");
}

export function validateChangeReqCodeUnique(
    rows: Array<{ srs_code?: string; code?: string; [key: string]: any }> = [],
    tableLabel = "变更需求表",
    codeResolver?: (row: any, index: number) => string,
): string {
    const resolveCode = codeResolver || ((row) => normalizeSrsCodeValue(row?.srs_code || row?.code || ""));
    const seen = new Map<string, number>();
    for (let index = 0; index < rows.length; index += 1) {
        const code = resolveCode(rows[index], index);
        if (!code) continue;
        if (seen.has(code)) {
            const firstRow = seen.get(code)! + 1;
            const duplicateRow = index + 1;
            return `${tableLabel}中 SRS 编号 ${code} 重复（第 ${firstRow} 行与第 ${duplicateRow} 行），请确保每条变更需求的编号唯一`;
        }
        seen.set(code, index);
    }
    return "";
}

function getReqSrsGroup(code: string): string {
    const normalized = normalizeSrsCodeValue(code);
    return normalized.match(/^(SRS-[A-Z]+\d+)-\d+$/)?.[1] || normalized;
}

function resolveEffectiveReqRowsFromData(
    rows: Array<{ srs_code?: string; code?: string; module?: string; function?: string; sub_function?: string }> = [],
): StandardReqTableRow[] {
    const lastValues: Record<string, string> = {};
    return (rows || []).map((row) => {
        const code = normalizeSrsCodeValue(row?.srs_code || row?.code || "");
        const group = getReqSrsGroup(code);
        const sameGroup = !!group && group === lastValues.group;
        if (!sameGroup) {
            lastValues.group = group;
            lastValues.module = "";
            lastValues.function = "";
            lastValues.sub_function = "";
        }
        const rawModule = normalizeReqDisplayText(row?.module);
        const rawFunction = normalizeReqDisplayText(row?.function);
        const rawSubFunction = normalizeReqDisplayText(row?.sub_function);
        if (rawModule) {
            lastValues.module = rawModule;
            lastValues.function = "";
            lastValues.sub_function = "";
        }
        if (rawFunction) {
            lastValues.function = rawFunction;
            lastValues.sub_function = "";
        }
        if (rawSubFunction) {
            lastValues.sub_function = rawSubFunction;
        }
        return {
            code,
            module: rawModule || (sameGroup ? lastValues.module || "" : ""),
            function: rawFunction || (sameGroup && !rawModule ? lastValues.function || "" : ""),
            sub_function: rawSubFunction || (sameGroup && !rawModule && !rawFunction ? lastValues.sub_function || "" : ""),
        };
    });
}

function resolveEffectiveReqRowsFromTable(
    headers: Array<{ code: string; name: string }> = [],
    rows: Array<Record<string, any>> = [],
): StandardReqTableRow[] {
    const { codeCol, moduleCol, functionCol, subFunctionCol } = pickStandardReqTableColumns(headers);
    if (!codeCol || !moduleCol || !functionCol) return [];
    return resolveEffectiveReqRowsFromData(
        rows.map((row) => ({
            code: row?.[codeCol],
            module: row?.[moduleCol],
            function: row?.[functionCol],
            sub_function: subFunctionCol ? row?.[subFunctionCol] : "",
        })),
    );
}

/** 同模块名称下，除首行外若功能与子功能均为空则不允许保存 */
function validateReqDuplicateModule(
    rows: StandardReqTableRow[] = [],
    tableLabel = "需求表",
): string {
    const moduleOwner = new Map<string, { index: number; code: string }>();
    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const code = normalizeSrsCodeValue(row.code);
        if (!code) continue;
        const moduleKey = normalizeReqDisplayText(row.module);
        if (!moduleKey) continue;
        const fn = normalizeReqDisplayText(row.function);
        const subFn = normalizeReqDisplayText(row.sub_function);
        if (fn || subFn) continue;
        if (moduleOwner.has(moduleKey)) {
            const first = moduleOwner.get(moduleKey)!;
            return `${tableLabel}第 ${index + 1} 行 SRS 编号 ${code} 与第 ${first.index + 1} 行模块「${moduleKey}」相同，请填写功能或子功能以区分`;
        }
        moduleOwner.set(moduleKey, { index, code });
    }
    return "";
}

/** 同模块且同功能时，除首行外子功能必填，且同组内子功能不可重复 */
function validateReqDuplicateModuleFunction(
    rows: StandardReqTableRow[] = [],
    tableLabel = "需求表",
): string {
    const moduleFunctionGroups = new Map<string, Array<{ index: number; code: string; subFn: string }>>();
    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const code = normalizeSrsCodeValue(row.code);
        if (!code) continue;
        const moduleKey = normalizeReqDisplayText(row.module);
        const fnKey = normalizeReqDisplayText(row.function);
        if (!moduleKey || !fnKey) continue;
        const subFn = normalizeReqDisplayText(row.sub_function);
        const key = `${moduleKey}\0${fnKey}`;
        const members = moduleFunctionGroups.get(key) || [];
        if (members.length > 0) {
            if (!subFn) {
                const first = members[0];
                return `${tableLabel}第 ${index + 1} 行 SRS 编号 ${code} 与第 ${first.index + 1} 行模块「${moduleKey}」功能「${fnKey}」相同，请填写子功能以区分`;
            }
            const duplicateSubFn = members.find((member) => member.subFn === subFn);
            if (duplicateSubFn) {
                return `${tableLabel}第 ${index + 1} 行 SRS 编号 ${code} 与第 ${duplicateSubFn.index + 1} 行模块「${moduleKey}」功能「${fnKey}」子功能「${subFn}」重复，请填写不同的子功能以区分`;
            }
        }
        members.push({ index, code, subFn });
        moduleFunctionGroups.set(key, members);
    }
    return "";
}

function validateReqHierarchyDuplicates(
    rows: StandardReqTableRow[] = [],
    tableLabel = "需求表",
): string {
    const duplicateModuleMsg = validateReqDuplicateModule(rows, tableLabel);
    if (duplicateModuleMsg) return duplicateModuleMsg;
    return validateReqDuplicateModuleFunction(rows, tableLabel);
}

export function validateStandardSrsHierarchyDuplicates(rows: StandardReqTableRow[] = []): string {
    return validateReqHierarchyDuplicates(rows, "产品需求列表");
}

const resolveEffectiveChangeReqRowsFromData = resolveEffectiveReqRowsFromData;
const resolveEffectiveChangeReqRowsFromTable = resolveEffectiveReqRowsFromTable;
const validateChangeReqHierarchyDuplicates = validateReqHierarchyDuplicates;

export function validateChangeReqRowContent(
    rows: Array<{ srs_code?: string; code?: string; module?: string; function?: string; sub_function?: string }> = [],
    tableLabel = "变更需求表",
): string {
    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const code = normalizeSrsCodeValue(row?.srs_code || row?.code || "");
        if (!code) continue;
        const module = normalizeReqDisplayText(row?.module);
        const fn = normalizeReqDisplayText(row?.function);
        const subFn = normalizeReqDisplayText(row?.sub_function);
        if (!module && !fn && !subFn) {
            return `${tableLabel}第 ${index + 1} 行已填写 SRS 编号 ${code}，模块/功能/子功能至少填写一项`;
        }
    }
    return "";
}

export function validateChangeReqTableRows(
    headers: Array<{ code: string; name: string }> = [],
    rows: Array<Record<string, any>> = [],
    tableLabel = "变更需求表",
): string {
    const { codeCol, moduleCol, functionCol, subFunctionCol } = pickStandardReqTableColumns(headers);
    if (!codeCol || !moduleCol || !functionCol) return "";

    const duplicateMsg = validateChangeReqCodeUnique(rows, tableLabel, (row) => (
        normalizeSrsCodeValue(codeCol ? String(row?.[codeCol] || "") : "")
    ));
    if (duplicateMsg) return duplicateMsg;

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const code = normalizeSrsCodeValue(row?.[codeCol]);
        if (!code) continue;
        const module = normalizeReqDisplayText(row?.[moduleCol]);
        const fn = normalizeReqDisplayText(row?.[functionCol]);
        const subFn = normalizeReqDisplayText(row?.[subFunctionCol]);
        if (!module && !fn && !subFn) {
            return `${tableLabel}第 ${index + 1} 行已填写 SRS 编号 ${code}，模块/功能/子功能至少填写一项`;
        }
    }
    const effectiveRows = resolveEffectiveChangeReqRowsFromTable(headers, rows);
    return validateChangeReqHierarchyDuplicates(effectiveRows, tableLabel);
}

export function validateChangeReqDataRows(
    rows: Array<{ srs_code?: string; code?: string; module?: string; function?: string; sub_function?: string }> = [],
    tableLabel = "变更需求表",
): string {
    const duplicateMsg = validateChangeReqCodeUnique(rows, tableLabel);
    if (duplicateMsg) return duplicateMsg;
    const contentMsg = validateChangeReqRowContent(rows, tableLabel);
    if (contentMsg) return contentMsg;
    const effectiveRows = resolveEffectiveChangeReqRowsFromData(rows);
    return validateChangeReqHierarchyDuplicates(effectiveRows, tableLabel);
}

function getHeadingNumberFromTitle(title?: string): string {
    return String(title || "").trim().match(/^(\d+(?:\.\d+)*)/)?.[1] || "";
}

const FIXED_TEMPLATE_SECTION_HEADINGS = new Set([
    "2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7",
]);

function isFixedTemplateSectionChapter(node: TreeNode): boolean {
    return FIXED_TEMPLATE_SECTION_HEADINGS.has(getHeadingNumberFromTitle(node.title));
}

function isChapterMetaLockedNode(node: TreeNode, otherRows: any[] = []): boolean {
    return isFixedTemplateSectionChapter(node) || isOtherReqManagedChapterNode(node, otherRows);
}

export function resolveProductBoundDocImageRefType(
    node: Pick<TreeNode, "ref_type" | "title">,
): ProductBoundDocImageRefType | undefined {
    const refType = String(node.ref_type || "").trim();
    if (refType === "img_topo" || refType === "img_struct") return refType;
    const headingNo = getHeadingNumberFromTitle(node.title);
    if (headingNo === "2.2") return "img_topo";
    if (headingNo === "2.3") return "img_struct";
    return undefined;
}

function withProductImageCacheBuster(url?: string, token?: string): string {
    const raw = String(url || "").trim();
    if (!raw) return "";
    if (isDataUrl(raw) || /^https?:\/\//i.test(raw)) return raw;
    const sep = raw.includes("?") ? "&" : "?";
    return `${raw}${sep}t=${encodeURIComponent(token || String(Date.now()))}`;
}

function sortDocFileRowsByLatest(rows: any[] = []): any[] {
    return [...rows].sort((a: any, b: any) => {
        const ta = new Date(a?.update_time || a?.create_time || 0).getTime();
        const tb = new Date(b?.update_time || b?.create_time || 0).getTime();
        if (ta !== tb) return tb - ta;
        return Number(b?.id || 0) - Number(a?.id || 0);
    });
}

function sanitizeDocImageToken(value?: string): string {
    return String(value || "").trim().replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildDocImageFilePrefix(productVersion?: string, docVersion?: string): string {
    const productToken = sanitizeDocImageToken(productVersion);
    const docToken = sanitizeDocImageToken(docVersion);
    if (productToken && docToken) return `${productToken}_${docToken}`;
    return docToken || productToken || "doc";
}

function matchesProductBoundDocFileRow(row: any, docVersion?: string, productVersion?: string, fileType?: ProductBoundDocImageRefType): boolean {
    const docVer = String(row?.doc_version || "").trim();
    const fileName = String(row?.file_name || "").trim();
    const normalizedDocVersion = String(docVersion || "").trim();
    const prefix = buildDocImageFilePrefix(productVersion, normalizedDocVersion);
    if (fileType && prefix) {
        if (fileName.startsWith(`${prefix}_${fileType}`)) return true;
    }
    if (normalizedDocVersion && docVer === normalizedDocVersion) return true;
    if (normalizedDocVersion && fileName.startsWith(`${normalizedDocVersion}_`)) return true;
    if (normalizedDocVersion && fileType && fileName.includes(`_${normalizedDocVersion}_${fileType}`)) return true;
    if (productVersion && normalizedDocVersion && fileName.startsWith(`${buildDocImageFilePrefix(productVersion, normalizedDocVersion)}_`)) {
        return true;
    }
    return false;
}

function pickProductBoundDocFileRow(rows: any[] = [], docVersion?: string, productVersion?: string, fileType?: ProductBoundDocImageRefType): any | undefined {
    if (!rows.length) return undefined;
    const normalizedVersion = String(docVersion || "").trim();
    if (normalizedVersion) {
        const matched = rows.find((row) => matchesProductBoundDocFileRow(row, docVersion, productVersion, fileType));
        if (matched) return matched;
        return undefined;
    }
    return sortDocFileRowsByLatest(rows)[0];
}

async function listProductBoundDocFileRows(
    fileType: ProductBoundDocImageRefType,
    productId: number,
    docVersion?: string,
    productVersion?: string,
): Promise<any[]> {
    const res: any = await ApiDocFile.list_doc_file(fileType, {
        product_id: productId,
        doc_version: docVersion,
        product_version: productVersion,
        page_index: 0,
        page_size: 1000,
    });
    if (res?.code !== ApiDocFile.C_OK) return [];
    const allRows = res?.data?.rows || [];
    const normalizedVersion = String(docVersion || "").trim();
    if (!normalizedVersion) return allRows;
    return allRows.filter((row: any) => matchesProductBoundDocFileRow(row, docVersion, productVersion, fileType));
}

async function findProductBoundDocFileRow(
    fileType: ProductBoundDocImageRefType,
    productId: number,
    docVersion?: string,
    productVersion?: string,
): Promise<any | undefined> {
    const rows = await listProductBoundDocFileRows(fileType, productId, docVersion, productVersion);
    return pickProductBoundDocFileRow(rows, docVersion, productVersion, fileType);
}

function buildProductBoundDocFileUrl(row?: any): string {
    if (!row?.file_url) return "";
    return withProductImageCacheBuster(
        row.file_url,
        `${row?.id || ""}_${row?.file_size || ""}_${row?.file_name || ""}_${row?.update_time || ""}`,
    );
}

async function findProductBoundDocFileRowForUpdate(
    fileType: ProductBoundDocImageRefType,
    productId: number,
    docVersion?: string,
    productVersion?: string,
): Promise<any | undefined> {
    const res: any = await ApiDocFile.list_doc_file(fileType, {
        product_id: productId,
        doc_version: docVersion,
        product_version: productVersion,
        page_index: 0,
        page_size: 1000,
    });
    if (res?.code !== ApiDocFile.C_OK) return undefined;
    return pickProductBoundDocFileRow(res?.data?.rows || [], docVersion, productVersion, fileType);
}

export async function fetchProductBoundDocImageMap(
    productId?: number,
    docVersion?: string,
    productVersion?: string,
): Promise<Map<string, string>> {
    const fileMaps = new Map<string, string>();
    if (!productId) return fileMaps;
    await Promise.all(
        PRODUCT_BOUND_DOC_IMAGE_REF_TYPES.map(async (fileType) => {
            try {
                const row = await findProductBoundDocFileRow(fileType, productId, docVersion, productVersion);
                const fileUrl = buildProductBoundDocFileUrl(row);
                if (fileUrl) fileMaps.set(fileType, fileUrl);
            } catch (error) {
                console.error("加载产品绑定图片失败:", fileType, error);
            }
        }),
    );
    return fileMaps;
}

export async function remapProductBoundDocImages(
    treeNodes: TreeNode[],
    productId?: number,
    docVersion?: string,
    productVersion?: string,
): Promise<TreeNode[]> {
    if (!productId || !Array.isArray(treeNodes) || treeNodes.length === 0) return treeNodes;
    const fileMaps = await fetchProductBoundDocImageMap(productId, docVersion, productVersion);
    const walk = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => {
        const boundType = resolveProductBoundDocImageRefType(node);
        const mappedUrl = boundType ? fileMaps.get(boundType) : undefined;
        return {
            ...node,
            ...(boundType && !node.ref_type ? { ref_type: boundType } : {}),
            img_url: boundType ? (mappedUrl || "") : (node.img_url || ""),
            children: walk(node.children || []),
        };
    });
    return walk(treeNodes);
}

function parseOtherReqLocationTokens(location?: string): string[] {
    const raw = String(location || "").trim();
    if (!raw) return [];
    return raw
        .split(/[,，、;；]+/)
        .map((part) => {
            const trimmed = part.trim();
            return trimmed.match(/^(\d+(?:\.\d+)*)$/)?.[1]
                || trimmed.match(/^(\d+(?:\.\d+)*)/)?.[1]
                || "";
        })
        .filter(Boolean);
}

/** 其他需求同步只作用于主章节号：单章节直接用该号，多章节仅第一个 */
function getOtherReqSyncLocationToken(location?: string): string {
    return parseOtherReqLocationTokens(location)[0] || "";
}

function isOtherReqSyncLocationForHeading(location?: string, headingNo?: string): boolean {
    if (!headingNo) return false;
    const syncToken = getOtherReqSyncLocationToken(location);
    return !!syncToken && syncToken === headingNo;
}

function isOtherReqManagedChapterNode(node: TreeNode, otherRows: any[] = []): boolean {
    if (!otherRows.length) return false;
    const headingNo = getHeadingNumberFromTitle(node.title);
    const nodeCode = normalizeSrsCodeValue(node.srs_code || extractSrsCodeFromText(node.text) || "");
    const locationSet = new Set<string>();
    const codeSet = new Set<string>();
    otherRows.forEach((row) => {
        const code = normalizeSrsCodeValue(row?.srs_code || row?.code || "");
        const syncLocation = getOtherReqSyncLocationToken(row?.location);
        if (syncLocation) locationSet.add(syncLocation);
        if (code) codeSet.add(code);
    });
    if (headingNo && locationSet.has(headingNo)) return true;
    if (nodeCode && codeSet.has(nodeCode)) return true;
    if (findOtherReqRowForChapter(otherRows, headingNo, nodeCode, node.title)) return true;
    return false;
}

function normalizeOtherReqSyncRow(row: any) {
    return {
        code: normalizeSrsCodeValue(row?.code || row?.srs_code || ""),
        module: normalizeReqDisplayText(row?.module),
        location: normalizeReqDisplayText(row?.location),
        type_code: String(row?.type_code || "2"),
        id: row?.id,
    };
}

function isOtherReqRowMatchedToHeading(
    row: ReturnType<typeof normalizeOtherReqSyncRow>,
    headingNo?: string,
): boolean {
    if (!headingNo) return true;
    const locations = parseOtherReqLocationTokens(row.location);
    if (locations.length === 0) return true;
    return isOtherReqSyncLocationForHeading(row.location, headingNo);
}

function getMisboundOtherReqRow(
    node: TreeNode,
    headingNo: string | undefined,
    rows: ReturnType<typeof normalizeOtherReqSyncRow>[],
) {
    if (!headingNo) return undefined;
    const nodeCode = normalizeSrsCodeValue(node.srs_code || extractSrsCodeFromText(node.text) || "");
    if (!nodeCode) return undefined;
    const row = rows.find((item) => item.code === nodeCode);
    if (!row) return undefined;
    return isOtherReqSyncLocationForHeading(row.location, headingNo) ? undefined : row;
}

function stripOtherReqCodeLineFromText(text?: string): string {
    return String(text || "")
        .replace(/^\s*需求编号\s*[：:]\s*SRS[^\n]*\n?/im, "")
        .replace(/^\s*SRS\s*-\s*[A-Z0-9]+\s*-\s*\d+\s*\n?/im, "")
        .replace(/^\s+/, "");
}

function restoreMisboundOtherReqChapter(
    node: TreeNode,
    headingNo: string,
    fixedName: string | undefined,
    children: TreeNode[] = [],
): TreeNode {
    const cleared = clearMisboundOtherReqFromNode(node, children);
    if (fixedName && headingNo) {
        return {
            ...cleared,
            title: `${headingNo} ${fixedName}`,
        };
    }
    return cleared;
}

function clearMisboundOtherReqFromNode(node: TreeNode, children: TreeNode[] = []): TreeNode {
    const nextText = stripOtherReqCodeLineFromText(node.text);
    return {
        ...node,
        srs_code: undefined,
        text: nextText,
        children,
    };
}

export function findOtherReqRowForChapter(
    otherRows: any[] = [],
    headingNo?: string,
    nodeSrsCode?: string | null,
    chapterTitle?: string,
) {
    const rows = (otherRows || [])
        .map(normalizeOtherReqSyncRow)
        .filter((row) => row.code && row.type_code === "2");
    if (headingNo) {
        const bySyncLocation = rows.find((row) => isOtherReqSyncLocationForHeading(row.location, headingNo));
        if (bySyncLocation) return bySyncLocation;
    }
    if (headingNo && chapterTitle) {
        const titleName = normalizeReqDisplayText(chapterTitle.replace(/^\d+(?:\.\d+)*\s*/, ""));
        if (titleName) {
            const byTitleModule = rows.find((row) => (
                normalizeReqDisplayText(row.module) === titleName &&
                isOtherReqRowMatchedToHeading(row, headingNo)
            ));
            if (byTitleModule) return byTitleModule;
        }
    }
    const normalizedNodeCode = normalizeSrsCodeValue(nodeSrsCode || "");
    if (normalizedNodeCode) {
        const byCode = rows.find((row) => row.code === normalizedNodeCode);
        if (byCode && isOtherReqRowMatchedToHeading(byCode, headingNo)) {
            return byCode;
        }
    }
    return undefined;
}

export function buildOtherReqChapterTitle(
    headingNo: string,
    matchedRow: { module?: string } | undefined,
    fallbackName?: string,
    currentTitle?: string,
) {
    if (!headingNo) return currentTitle || "";
    const moduleName = normalizeReqDisplayText(matchedRow?.module);
    if (moduleName) return `${headingNo} ${moduleName}`;
    if (fallbackName) return `${headingNo} ${fallbackName}`;
    return currentTitle || "";
}

export function mergeOtherReqDetailsForSync(previewRows: any[] = [], tableRows: any[] = []) {
    const toOutput = (row: ReturnType<typeof normalizeOtherReqSyncRow>) => ({
        code: row.code,
        srs_code: row.code,
        module: row.module,
        location: row.location,
        type_code: row.type_code,
        id: row.id,
    });
    const normalizedPreview = (previewRows || [])
        .map(normalizeOtherReqSyncRow)
        .filter((row) => row.code);
    const normalizedTable = (tableRows || [])
        .map(normalizeOtherReqSyncRow)
        .filter((row) => row.code);

    if (!normalizedTable.length) {
        return normalizedPreview.map(toOutput);
    }
    if (!normalizedPreview.length) {
        return normalizedTable.map(toOutput);
    }

    const previewByCode = new Map(normalizedPreview.map((row) => [row.code, row]));
    const previewByLocation = new Map<string, ReturnType<typeof normalizeOtherReqSyncRow>>();
    normalizedPreview.forEach((row) => {
        if (row.location) previewByLocation.set(row.location, row);
    });

    // 以外部/预览状态为准；树内嵌旧表仅补充 preview 未覆盖的行
    const tableKept = normalizedTable.filter((row) => {
        if (previewByCode.has(row.code)) return false;
        if (row.location && previewByLocation.has(row.location)) return false;
        return true;
    });

    return [...normalizedPreview, ...tableKept].map(toOutput);
}

function pickOtherReqTableColumnCode(headers: Array<{ code: string; name: string }>, matcher: (text: string) => boolean) {
    return headers.find((header) => matcher(normalizeCellText(header?.name)))?.code || "";
}

function buildOtherReqTableRowsFromState(
    otherRows: any[],
    headers: Array<{ code: string; name: string }>,
) {
    const codeCol = pickOtherReqTableColumnCode(headers, (text) => isReqCodeHeaderText(text));
    const moduleCol = pickOtherReqTableColumnCode(headers, (text) => text.includes("需求模块") || text.includes("模块"));
    const locationCol = pickOtherReqTableColumnCode(headers, (text) => text.includes("章节") || text.includes("位置"));
    return (otherRows || []).map((row) => ({
        ...(codeCol ? { [codeCol]: normalizeSrsCodeValue(row?.srs_code || row?.code || "") } : {}),
        ...(moduleCol ? { [moduleCol]: normalizeReqDisplayText(row?.module) } : {}),
        ...(locationCol ? { [locationCol]: normalizeReqDisplayText(row?.location) } : {}),
    }));
}

export function syncEmbeddedOtherReqTableInTree(items: TreeNode[], otherRows: any[] = []): TreeNode[] {
    if (!otherRows.length) return items || [];
    const walk = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => {
        const table = node.table;
        let nextTable = table;
        if (isReqOtherTable(table) && Array.isArray(table?.headers) && table.headers.length > 0) {
            nextTable = {
                ...table,
                rows: buildOtherReqTableRowsFromState(otherRows, table.headers),
                cells: undefined,
            };
        }
        return {
            ...node,
            table: nextTable,
            children: walk(node.children || []),
        };
    });
    return walk(items || []);
}

export function syncTreeWithOtherReqState(
    items: TreeNode[],
    otherRows: any[] = [],
    options?: Parameters<typeof syncOtherReqCodesToChaptersFromRows>[2],
): TreeNode[] {
    const withEmbeddedTable = syncEmbeddedOtherReqTableInTree(items || [], otherRows);
    const normalizedOtherRows = (otherRows || [])
        .map(normalizeOtherReqSyncRow)
        .filter((row) => row.code)
        .map((row) => ({
            code: row.code,
            srs_code: row.code,
            module: row.module,
            location: row.location,
            type_code: row.type_code,
            id: row.id,
        }));
    const tableRows = collectOtherReqRowsFromTree(withEmbeddedTable);
    const mergedOtherRows = normalizedOtherRows.length
        ? normalizedOtherRows
        : mergeOtherReqDetailsForSync([], tableRows);
    return syncOtherReqCodesToChaptersFromRows(withEmbeddedTable, mergedOtherRows, options);
}

function collectOtherReqRowsFromTree(nodeList: TreeNode[]): any[] {
    const rows: any[] = [];
    const walk = (nodes: TreeNode[]) => {
        (nodes || []).forEach((node) => {
            const table = node.table;
            if (isReqOtherTable(table) && Array.isArray(table?.headers) && Array.isArray(table?.rows)) {
                const headers = table.headers || [];
                const codeCol = pickOtherReqTableColumnCode(headers, (text) => isReqCodeHeaderText(text));
                const moduleCol = pickOtherReqTableColumnCode(headers, (text) => text.includes("需求模块") || text.includes("模块"));
                const locationCol = pickOtherReqTableColumnCode(headers, (text) => text.includes("章节") || text.includes("位置"));
                (table.rows || []).forEach((row) => {
                    const code = normalizeSrsCodeValue(String(row?.[codeCol] || extractSrsCodeFromTableRow(row) || ""));
                    if (!code) return;
                    rows.push({
                        code,
                        srs_code: code,
                        module: normalizeReqDisplayText(row?.[moduleCol]),
                        location: normalizeReqDisplayText(row?.[locationCol]),
                        type_code: "2",
                    });
                });
            }
            walk(node.children || []);
        });
    };
    walk(nodeList || []);
    return rows;
}

export function syncOtherReqCodesToChaptersFromRows(
    items: TreeNode[],
    otherRows: any[] = [],
    options?: {
        fixedTemplateSections?: Record<string, string>;
        resolveSrsCode?: (node: TreeNode, headingNo: string, otherReqCode?: string) => string;
        isCodeCompatible?: (code: string, headingNo: string) => boolean;
    },
): TreeNode[] {
    const fixedSections = options?.fixedTemplateSections || {
        "2.1": "软件总体描述",
        "2.2": "物理拓扑图",
        "2.3": "系统结构图",
        "2.4": "运行环境",
        "2.5": "数据库要求",
        "2.6": "算法和数据要求",
        "2.7": "性能要求",
    };
    const isCodeCompatible = options?.isCodeCompatible || ((code, headingNo) => {
        const normalized = normalizeSrsCodeValue(code);
        if (!normalized || !headingNo) return false;
        if (headingNo.split(".")[0] === "2") {
            return /^SRS-RCN30[02]-/i.test(normalized);
        }
        return true;
    });
    const resolveSrsCode = options?.resolveSrsCode || ((node, headingNo, otherReqCode) => {
        const normalizedOther = normalizeSrsCodeValue(otherReqCode || "");
        if (normalizedOther) return normalizedOther;
        const normalizedNode = normalizeSrsCodeValue(node.srs_code || "");
        return normalizedNode && isCodeCompatible(normalizedNode, headingNo) ? normalizedNode : "";
    });
    const applyFixedProtection = (list: TreeNode[]): TreeNode[] => {
        const byLocation = new Map<string, string>();
        (otherRows || []).forEach((row) => {
            const code = normalizeSrsCodeValue(row?.code || row?.srs_code || "");
            const syncLocation = getOtherReqSyncLocationToken(row?.location);
            if (code && syncLocation) byLocation.set(syncLocation, code);
        });
        const walk = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => {
            const headingNo = getHeadingNumberFromTitle(node.title);
            const fixedName = headingNo ? fixedSections[headingNo] : undefined;
            const children = walk(node.children || []);
            if (!fixedName) return { ...node, children };
            const nodeCode = normalizeSrsCodeValue(node.srs_code || extractSrsCodeFromText(node.text) || "");
            const matchedRow = findOtherReqRowForChapter(otherRows, headingNo, nodeCode, node.title);
            return buildOtherReqSyncedNode(
                node,
                headingNo,
                matchedRow,
                byLocation.get(headingNo) || matchedRow?.code || "",
                { fixedName, resolveSrsCode },
                children,
            );
        });
        return walk(list);
    };
    if (!otherRows.length) return applyFixedProtection(items || []);
    const normalizedOtherRows = (otherRows || [])
        .map(normalizeOtherReqSyncRow)
        .filter((row) => row.code && row.type_code === "2");
    const byLocation = new Map<string, string>();
    (otherRows || []).forEach((row) => {
        const code = normalizeSrsCodeValue(row?.code || row?.srs_code || "");
        const syncLocation = getOtherReqSyncLocationToken(row?.location);
        if (code && syncLocation) byLocation.set(syncLocation, code);
    });
    const synced = (items || []).map((node) => {
        const headingNo = getHeadingNumberFromTitle(node.title);
        const fixedName = headingNo ? fixedSections[headingNo] : undefined;
        const nodeCode = normalizeSrsCodeValue(node.srs_code || extractSrsCodeFromText(node.text) || "");
        const matchedRow = findOtherReqRowForChapter(otherRows, headingNo, nodeCode, node.title);
        const matchedCode = matchedRow?.code || (headingNo ? byLocation.get(headingNo) : undefined) || "";
        const children = syncOtherReqCodesToChaptersFromRows(node.children || [], otherRows, options);
        if (!matchedRow && !matchedCode) {
            if (getMisboundOtherReqRow(node, headingNo, normalizedOtherRows)) {
                return restoreMisboundOtherReqChapter(node, headingNo || "", fixedName, children);
            }
            return { ...node, children };
        }
        return buildOtherReqSyncedNode(
            node,
            headingNo,
            matchedRow,
            matchedCode,
            { fixedName, resolveSrsCode },
            children,
        );
    });
    return applyFixedProtection(synced);
}

function extractSrsCodeFromText(value: any): string {
    const matched = String(value || "").match(/SRS\s*-\s*[A-Z]+\s*\d+\s*-\s*\d+/i);
    return matched ? normalizeSrsCodeValue(matched[0]) : "";
}

function replaceOtherReqCodeInNodeText(text: string | undefined, nextCode: string): string {
    const normalizedNext = normalizeSrsCodeValue(nextCode);
    if (!normalizedNext) return String(text || "");
    const raw = String(text || "");
    const srsInTextPattern = /SRS\s*-\s*[A-Z0-9]+\s*-\s*\d+/i;

    if (!raw.trim()) {
        return `需求编号：${normalizedNext}`;
    }

    if (/需求编号\s*[：:]/i.test(raw)) {
        const replaced = raw.replace(
            /(需求编号\s*[：:]\s*)(?:SRS\s*-\s*[A-Z0-9]+\s*-\s*\d+)/i,
            `$1${normalizedNext}`,
        );
        if (replaced !== raw) return replaced;
        return raw.replace(/(需求编号\s*[：:]\s*).*(?=\r?\n|$)/i, `$1${normalizedNext}`);
    }

    if (srsInTextPattern.test(raw)) {
        return raw.replace(srsInTextPattern, normalizedNext);
    }

    return `需求编号：${normalizedNext}\n${raw}`;
}

function buildOtherReqSyncedNode(
    node: TreeNode,
    headingNo: string,
    matchedRow: ReturnType<typeof findOtherReqRowForChapter>,
    matchedCode: string,
    options: {
        fixedName?: string;
        resolveSrsCode: (node: TreeNode, headingNo: string, otherReqCode?: string) => string;
    },
    children: TreeNode[],
): TreeNode {
    const nextCode = matchedCode
        ? options.resolveSrsCode(node, headingNo, matchedCode)
        : options.resolveSrsCode(node, headingNo, undefined);
    const nextTitle = buildOtherReqChapterTitle(
        headingNo,
        matchedRow,
        options.fixedName,
        node.title,
    );
    const nextText = nextCode ? replaceOtherReqCodeInNodeText(node.text, nextCode) : node.text;
    return {
        ...node,
        title: nextTitle,
        ...(nextCode ? { srs_code: nextCode } : {}),
        ...(nextText !== node.text ? { text: nextText } : {}),
        children,
    };
}

function extractSrsCodeFromTableRow(row: any): string {
    const values = Object.values(row || {});
    for (const value of values) {
        const code = extractSrsCodeFromText(value);
        if (code) return code;
    }
    return "";
}

function extractSrsCodeFromCellRow(row: any[]): string {
    for (const cell of row || []) {
        const code = extractSrsCodeFromText(cell?.value);
        if (code) return code;
    }
    return "";
}

function extractSrsCodeFromTable(table?: TableData | null): string {
    if (!table) return "";
    for (const header of table.headers || []) {
        const code = extractSrsCodeFromText(header?.name);
        if (code) return code;
    }
    for (const row of table.rows || []) {
        const code = extractSrsCodeFromTableRow(row);
        if (code) return code;
    }
    for (const row of table.cells || []) {
        const code = extractSrsCodeFromCellRow(row);
        if (code) return code;
    }
    return "";
}

function getFunctionalKvLeftText(row: any, leftCode?: string): string {
    if (!row) return "";
    if (leftCode && row[leftCode] != null && String(row[leftCode]).trim() !== "") {
        return String(row[leftCode]);
    }
    for (const key of ["field", "attr"]) {
        if (row[key] != null && String(row[key]).trim() !== "") {
            return String(row[key]);
        }
    }
    return "";
}

function countFunctionalKvFieldHits(table: TableData): number {
    const leftCode = table.headers?.[0]?.code;
    const hits = new Set<string>();
    (table.rows || []).forEach((row) => {
        const text = normalizeCellText(getFunctionalKvLeftText(row, leftCode));
        if (KV_FIELD_LABELS.has(text)) {
            hits.add(text);
        }
    });
    return hits.size;
}

function isFunctionalKvTable(table?: TableData | null): boolean {
    if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) return false;
    if (table.headers.length !== 2 || table.rows.length < 3) return false;
    const h1 = normalizeCellText(table.headers[0]?.name);
    const h2 = normalizeCellText(table.headers[1]?.name);
    const fieldHits = countFunctionalKvFieldHits(table);
    // 命中多个“需求详情字段”时，按 Word 里的“左列字段+右列内容”无表头表格渲染
    if (fieldHits >= 3) return true;
    // 兜底：第一行常被误解析成表头（如“需求编号 | SRS-XXX”）
    if (KV_FIELD_LABELS.has(h1) && !!h2) return true;
    // 弹框保存后常见表头为“字段 | 内容”
    if (h1.includes("字段") && h2.includes("内容") && fieldHits >= 2) return true;
    return false;
}

function shouldNarrowFunctionalFirstColumn(table?: TableData | null): boolean {
    if (!table || !Array.isArray(table.headers) || table.headers.length !== 2) return false;
    if (isFunctionalKvTable(table)) return true;
    if (table.show_header === 0) return true;
    const h1 = normalizeCellText(table.headers[0]?.name);
    const h2 = normalizeCellText(table.headers[1]?.name);
    if (h1.includes("字段") && h2.includes("内容")) return true;
    if (countFunctionalKvFieldHits(table) >= 2) return true;
    return !!(extractSrsCodeFromTable(table) && countFunctionalKvFieldHits(table) >= 1);
}

function isReqDetailProtectedTable(table?: TableData | null): boolean {
    if (!table || isReqMainTable(table) || isReqOtherTable(table)) return false;
    if (isFunctionalKvTable(table)) return true;
    if (extractSrsCodeFromTable(table)) return true;

    const textValues = [
        ...(table.headers || []).flatMap((header) => [header?.name, header?.code]),
        ...(table.rows || []).flatMap((row) => Object.values(row || {})),
        ...(table.cells || []).flatMap((row) => (row || []).map((cell) => cell?.value)),
    ].map((value) => normalizeCellText(String(value || ""))).filter(Boolean);
    const hasSrsCode = !!extractSrsCodeFromTable(table);
    const hitCount = textValues.filter((text) => Array.from(KV_FIELD_LABELS).some((label) => {
        const normalizedLabel = normalizeCellText(label);
        return text === normalizedLabel || text.includes(normalizedLabel);
    })).length;
    return hasSrsCode && hitCount >= 2;
}

function hasRenderableTable(table?: TableData | null): boolean {
    return !!(
        table &&
        Array.isArray(table.headers) &&
        table.headers.length > 0 &&
        Array.isArray(table.rows) &&
        table.rows.length > 0
    );
}

function isSrsCodeColumn(header?: { code: string; name: string }): boolean {
    const hName = normalizeCellText(header?.name);
    const hCode = normalizeCellText(header?.code);
    return isReqCodeHeaderText(hName) || hCode.includes("srscode") || hCode.includes("srs");
}

function splitTextByTables(rawText: string | undefined, tableCount: number): { intro: string; tableHeaders: Array<{ section: string; tableTitle: string }> } {
    const text = String(rawText || "").replace(/\r/g, "");
    if (!text || tableCount <= 0) return { intro: text, tableHeaders: [] };
    const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const introLines: string[] = [];
    const tableHeaders: Array<{ section: string; tableTitle: string }> = [];
    let currentSection = "";
    let seenFirstTableHeader = false;
    for (const line of lines) {
        const isSectionLine = /^\d+(?:\.\d+)+/.test(line);
        const isTableLine = /^表\s*\d+/.test(line);
        if (isSectionLine) {
            currentSection = line;
            continue;
        }
        if (isTableLine) {
            tableHeaders.push({
                section: currentSection || "",
                tableTitle: line,
            });
            seenFirstTableHeader = true;
            continue;
        }
        if (!seenFirstTableHeader) {
            const normalized = line.replace(/[：:]/g, "").trim();
            if (normalized !== "其他需求列表") {
                introLines.push(line);
            }
        }
    }
    return {
        intro: introLines.join("\n"),
        tableHeaders: tableHeaders.slice(0, tableCount),
    };
}

function removeOtherReqMarker(rawText: string | undefined): string {
    const lines = String(rawText || "").replace(/\r/g, "").split("\n");
    const filtered = lines.filter((line) => {
        const normalized = line.trim().replace(/[：:]/g, "");
        return normalized !== "其他需求列表";
    });
    return filtered.join("\n");
}

/** 图片章节正文拆分：图上 intro（如「如图1所示：」）/ 图下 caption（如「图1 xxx」）/ 图下 body（说明） */
function extractImageTextParts(rawText: string | undefined): { intro: string; caption: string; body: string } {
    const lines = String(rawText || "").replace(/\r/g, "").split("\n");
    let captionIdx = -1;
    let caption = "";
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (/^图\s*\d+/.test(trimmed)) {
            captionIdx = i;
            caption = trimmed;
            break;
        }
    }
    if (captionIdx < 0) {
        return { intro: "", caption: "", body: String(rawText || "") };
    }
    const intro = lines.slice(0, captionIdx).join("\n").replace(/\n+$/g, "");
    const body = lines.slice(captionIdx + 1).join("\n").replace(/^\n+/g, "");
    return { intro, caption, body };
}

function joinImageTextParts(intro: string, caption: string, body: string): string {
    return [intro, caption, body]
        .map((s) => String(s ?? "").replace(/\s+$/g, ""))
        .filter((s) => s.length > 0)
        .join("\n");
}

interface TreeNodeItemProps {
    node: TreeNode;
    level: number;
    docId?: number;
    productId?: number;
    docVersion?: string;
    productVersion?: string;
    readOnly?: boolean;
    rcmOptions: Array<{ value: number; label: string; description?: string }>;
    onRcmSelectChange: (nodeId: number, selectedRcmIds: Array<number | string>) => void;
    onAdd: (parentId: number) => void;
    onAddSibling: (nodeId: number, position: 'before' | 'after', defaultTitle: string) => void;
    onDelete: (id: number) => Promise<void>;
    onTitleChange: (id: number, title: string) => void;
    onSrsCodeChange: (id: number, value: string) => void;
    onImageChange: (id: number, imgUrl: string) => void;
    onContentChange: (id: number, content: string, preserveOtherReqCode?: boolean) => void;
    onAddTable: (id: number) => void;
    onImportTable: (id: number, file: File) => Promise<void>;
    onEditTable: (id: number) => void;
    onDeleteTable: (id: number) => void;
    onOpenSrsTable?: () => void;  // 打开 SRS 表弹框
    onOpenReqList?: () => void;   // 打开需求列表弹框
    onEditSrsChangeTable?: (table: { id: number | string; title: string; data: any[]; type_code?: string }) => void;
    onDeleteSrsChangeTable?: (table: { id: number | string; title: string; data: any[]; type_code?: string }) => void;
    onSaveReqDetailTable?: (detail: any) => Promise<void>;
    srsReqPreview?: {
        main: any[];
        other: any[];
        changes: Array<{ id: number | string; title: string; data: any[] }>;
    };
    reqDetails?: any[];
    srsReqLoading?: boolean;
    existingChangeTableTitles?: string[];
    hideLevelPrefix?: boolean;
    disableHierarchyActions?: boolean;
    useNavChapterEditor?: boolean;
    autoNavChapterNo?: string;
    // 单章编辑：为 false 时只渲染当前节点自身，不递归渲染子章节（子章节走左目录导航）
    renderChildren?: boolean;
}

const TreeNodeItem = ({
    node,
    level,
    docId,
    productId,
    docVersion,
    productVersion,
    readOnly,
    rcmOptions,
    onRcmSelectChange,
    onAdd,
    onAddSibling,
    onDelete,
    onTitleChange,
    onSrsCodeChange,
    onImageChange,
    onContentChange,
    onAddTable,
    onImportTable,
    onEditTable,
    onDeleteTable,
    onOpenSrsTable,
    onOpenReqList,
    onEditSrsChangeTable,
    onDeleteSrsChangeTable,
    srsReqPreview,
    reqDetails,
    srsReqLoading,
    existingChangeTableTitles = [],
    disableHierarchyActions = false,
    useNavChapterEditor = false,
    autoNavChapterNo = "",
    renderChildren = true,
}: TreeNodeItemProps) => {
    const { t: ts } = useTranslation();
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [uploadLoading, setUploadLoading] = useState(false);
    // 新增模板需要直接展示二级/三级结构，避免空模板看起来只剩一级菜单。
    const [expanded, setExpanded] = useState(() => level < 1);
    const embeddedImageNode = (node.children || []).find((child) => isEmbeddedImageNode(child));
    const productBoundImageRefType = resolveProductBoundDocImageRefType(node);
    const isProductBoundDocImageNode = !!productBoundImageRefType;
    const isGenericImgRefNode = isImgRefType(node.ref_type) && !isProductBoundDocImageNode;
    const displayImageUrl = isProductBoundDocImageNode
        ? String(node.img_url || embeddedImageNode?.img_url || "")
        : (node.img_url || embeddedImageNode?.img_url || "");
    const imageTargetId = isProductBoundDocImageNode ? node.id : (embeddedImageNode?.id || node.id);
    const hasDisplayImage = !!String(displayImageUrl || "").trim();

    useEffect(() => {
        if (displayImageUrl) {
            setFileList([{
                uid: '-1',
                name: 'image.png',
                status: 'done',
                url: resolveFileUrl(displayImageUrl),
            }]);
        } else {
            setFileList([]);
        }
    }, [displayImageUrl]);

    const buildNamedProductImageFile = (file: File, fileType: ProductBoundDocImageRefType) => {
        const ext = file.name.match(/(\.[^.]+)$/)?.[1] || ".png";
        const prefix = buildDocImageFilePrefix(productVersion, docVersion);
        return new File([file], `${prefix}_${fileType}${ext}`, { type: file.type });
    };

    const uploadProductBoundDocImage = async (file: File) => {
        if (!productId) {
            message.error("请先选择产品");
            return;
        }
        if (!productBoundImageRefType) return;
        const namedFile = buildNamedProductImageFile(file, productBoundImageRefType);
        const localPreview = URL.createObjectURL(namedFile);
        onImageChange(imageTargetId, localPreview);
        try {
            let matchedRow = await findProductBoundDocFileRowForUpdate(productBoundImageRefType, productId, docVersion, productVersion);
            const payload: Record<string, any> = {
                product_id: productId,
                file: namedFile,
            };
            const saveRes: any = matchedRow?.id
                ? await ApiDocFile.update_doc_file(productBoundImageRefType, { ...payload, id: matchedRow.id })
                : await ApiDocFile.add_doc_file(productBoundImageRefType, payload);
            if (saveRes?.code !== ApiDocFile.C_OK) {
                throw new Error(saveRes?.msg || ts("upload_failed"));
            }
            if (matchedRow?.id) {
                const detailRes: any = await ApiDocFile.get_doc_file(productBoundImageRefType, { id: matchedRow.id });
                if (detailRes?.code === ApiDocFile.C_OK) {
                    matchedRow = detailRes.data;
                }
            } else {
                matchedRow = await findProductBoundDocFileRowForUpdate(productBoundImageRefType, productId, docVersion, productVersion);
            }
            const imgUrl = buildProductBoundDocFileUrl(matchedRow);
            if (!imgUrl) {
                throw new Error(ts("upload_failed"));
            }
            onImageChange(imageTargetId, imgUrl);
            setFileList([{
                uid: `${Date.now()}`,
                name: namedFile.name,
                status: "done",
                url: resolveFileUrl(imgUrl),
            }]);
            message.success(ts("upload_success"));
        } finally {
            URL.revokeObjectURL(localPreview);
        }
    };

    const uploadProps: UploadProps = {
        maxCount: 1,
        fileList,
        disabled: uploadLoading,
        beforeUpload: async (file) => {
            try {
                setUploadLoading(true);
                const formData = new FormData();
                formData.append("file", file);
                formData.append("doc_id", String(docId ?? 0));

                const res = await Api.add_doc_file(formData);
                if (res.code === Api.C_OK || res.code === 1) {
                    const imgUrl = res.data;
                    onImageChange(imageTargetId, imgUrl);
                    setFileList([{
                        uid: file.uid,
                        name: file.name,
                        status: "done",
                        url: `${window.location.origin}/${imgUrl}`,
                    }]);
                    message.success(ts("upload_success"));
                } else {
                    message.error(res.msg || ts("upload_failed"));
                }
            } catch (error) {
                console.error("图片上传失败:", error);
                message.error(ts("upload_failed"));
            } finally {
                setUploadLoading(false);
            }
            return false;
        },
        onRemove: () => {
            onImageChange(imageTargetId, "");
            setFileList([]);
        },
        accept: "image/*",
        showUploadList: false,
    };

    const productBoundUploadProps: UploadProps = {
        maxCount: 1,
        fileList,
        disabled: uploadLoading,
        accept: "image/*",
        showUploadList: false,
        beforeUpload: async (file) => {
            try {
                setUploadLoading(true);
                await uploadProductBoundDocImage(file);
            } catch (error: any) {
                console.error("产品绑定图片上传失败:", error);
                message.error(error?.message || ts("upload_failed"));
            } finally {
                setUploadLoading(false);
            }
            return false;
        },
    };

    const rcmSelectOptions = (() => {
        const options = [...(rcmOptions || [])];
        const existed = new Set(
            options.map((o) => normalizeRcmCode(o.label))
        );
        for (const code of (Array.isArray(node.rcm_codes) ? node.rcm_codes : [])) {
            const normalized = normalizeRcmCode(code);
            if (!normalized || existed.has(normalized)) continue;
            existed.add(normalized);
            options.push({
                value: normalized, // 兜底值：非产品RCM库内编号也允许显示
                label: normalized,
                description: "",
            } as any);
        }
        return options as Array<{ value: number | string; label: string; description?: string }>;
    })();

    const tableImportProps: UploadProps = {
        showUploadList: false,
        accept: ".xlsx,.xls,.csv,text/csv",
        beforeUpload: async (file) => {
            await onImportTable(node.id, file as File);
            return false;
        },
    };
    const embeddedTableNodes = (node.children || []).filter((child) => isEmbeddedTableNode(child));
    const embeddedMainReqTableNode =
        embeddedTableNodes.find((child) => isReqMainTable(child.table)) || embeddedTableNodes[0];
    const embeddedOtherReqTableNodes = embeddedTableNodes.filter(
        (child) => child.id !== embeddedMainReqTableNode?.id
    );
    const displayTable = node.table && node.table.headers?.length ? node.table : undefined;
    const visibleChildren = (node.children || []).filter((child) => (
        !isEmbeddedImageNode(child) &&
        !isEmbeddedTableNode(child) &&
        child.ref_type !== "srs_reqs" &&
        child.ref_type !== "srs_reqs_2" &&
        child.ref_type !== "srs_reqds"
    ));
    const hasVisibleChildren = visibleChildren.length > 0;
    const isAutoReqNode = node.label === "__auto_req_group" || node.label === "__auto_req_detail";
    const hasFunctionalTableDescendant = (target: TreeNode): boolean => (
        isFunctionalKvTable(target.table) ||
        (target.children || []).some((child) => hasFunctionalTableDescendant(child))
    );
    const currentHeadingDepth = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1].split(".").length || 0;
    const isFunctionalHierarchyNode = currentHeadingDepth >= 2 && hasFunctionalTableDescendant(node);
    const isLockedReqHierarchyNode = (isAutoReqNode || isFunctionalHierarchyNode) && !readOnly;
    const isLockedReqDetailCodeNode = !readOnly && (
        node.label === "__auto_req_detail" ||
        isFunctionalKvTable(node.table) ||
        (node.children || []).some((child) => isFunctionalKvTable(child.table))
    );
    const isLockedOtherReqChapter = !readOnly && isOtherReqManagedChapterNode(node, srsReqPreview?.other || []);
    const isLockedChapterMeta = !readOnly && isChapterMetaLockedNode(node, srsReqPreview?.other || []);
    const canEditNodeContent = !readOnly && (!isLockedReqHierarchyNode || isLockedOtherReqChapter);
    const lockedChapterSrsCode = isLockedChapterMeta
        ? normalizeSrsCodeValue(node.srs_code || extractSrsCodeFromText(node.text) || "")
        : "";
    const editableNodeText = isLockedOtherReqChapter ? stripOtherReqCodeLineFromText(node.text) : (node.text || "");
    const hasRcm = Array.isArray(node.rcm_codes);
    const hasRcmText = readOnly && /RCM\d+/i.test(String(node.text || ""));
    const isSrsReqRefNode = node.ref_type === "srs_reqs" || node.ref_type === "srs_reqs_2";
    const isSrsReqListNode = node.ref_type === "srs_reqds";
    const normalizeSrsCode = (value?: string) => String(value || "").replace(/\s+/g, "").toUpperCase();
    const nodeSrsCode = normalizeSrsCode(node.srs_code || "");
    const getTitleMajorChapter = (title?: string) => {
        const matched = String(title || "").trim().match(/^(\d+)/);
        return matched?.[1] || "";
    };
    const isImportedReqTableAnchor = (() => {
        if (isSrsReqRefNode || isSrsReqListNode) return false;
        const title = String(node.title || "").replace(/\s+/g, "");
        if (/^2\.1软件总体描述/.test(title)) return true;
        if (/^2软件整体架构要求/.test(title)) {
            return !(node.children || []).some((child) => /^2\.1软件总体描述/.test(String(child.title || "").replace(/\s+/g, "")));
        }
        return false;
    })();
    const isReqDetailAnchor = () => {
        if (isSrsReqListNode) return true;
        const title = String(node.title || "").replace(/\s+/g, "");
        return /功能描述|需求列表/.test(title);
    };
    const matchedReqDetail = nodeSrsCode && (isReqDetailAnchor() || node.label === "__auto_req_detail")
        ? (reqDetails || []).find((item: any) => normalizeSrsCode(item?.code) === nodeSrsCode)
        : undefined;
    const getSrsCodeMajorChapter = (code?: string) => {
        const matched = normalizeSrsCode(code).match(/^SRS-[A-Z]+(\d+)-/);
        const digits = matched?.[1] || "";
        return digits ? String(parseInt(digits.slice(-1), 10)) : "";
    };
    const isBaseReqType = (typeCode?: string) => ["1", "2", ""].includes(String(typeCode || ""));
    const nodeMajorChapter = getTitleMajorChapter(node.title);
    const chapterReqDetails = !nodeSrsCode && isReqDetailAnchor()
        ? (reqDetails || []).filter((item: any) => {
            return nodeMajorChapter && getSrsCodeMajorChapter(item?.code) === nodeMajorChapter && !isBaseReqType(item?.type_code);
        })
        : [];
    const showReqExtraTables = false;
    const reqDetailRows = (detail: any) => ([
        { field: ts("srs_doc.srs_code") || "需求编号", value: detail?.code },
        { field: ts("srs_reqd.name") || "需求名称", value: detail?.name || detail?.module || detail?.function || detail?.sub_function },
        { field: ts("srs_reqd.overview") || "需求概述", value: detail?.overview },
        { field: ts("srs_doc.main_participant") || "主参加者", value: detail?.participant },
        { field: ts("test_case.precondition") || "前置条件", value: detail?.pre_condition },
        { field: ts("srs_doc.trigger") || "触发器", value: detail?.trigger },
        { field: "事件流", value: detail?.work_flow },
        { field: ts("srs_doc.postcondition") || "后置条件", value: detail?.post_condition },
        { field: ts("srs_doc.exception") || "异常情况", value: detail?.exception },
        { field: ts("srs_doc.constraint") || "约束", value: detail?.constraint },
    ].map((row) => ({ ...row, value: normalizeReqDetailNumberedText(row.value, row.field) })).filter((row) => String(row.value || "").trim()));
    const renderReqDetailTable = (detail: any, key: string) => (
        <div className="node-table node-table--functional-kv" key={key}>
            <Table
                size="small"
                bordered
                pagination={false}
                tableLayout="fixed"
                rowKey="field"
                dataSource={reqDetailRows(detail)}
                columns={[
                    { title: "字段", dataIndex: "field", width: 120, className: "functional-kv-field-col" },
                    { title: "内容", dataIndex: "value", render: (t: string) => <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t || "-"}</span> },
                ]}
                showHeader={false}
            />
        </div>
    );
    const buildChangeRowsFromRenderedTable = (table?: TableData | null) => {
        if (!table?.headers?.length || !Array.isArray(table.rows)) return [];
        const headers = table.headers;
        const pickColumn = (matcher: (text: string) => boolean) => (
            headers.find((header) => matcher(normalizeCellText(header?.name)))?.code || ""
        );
        const codeCol = pickColumn((text) => isReqCodeHeaderText(text));
        const moduleCol = pickColumn((text) => text.includes("模块"));
        const functionCol = pickColumn((text) => text.includes("功能") && !text.includes("子功能"));
        const subFunctionCol = pickColumn((text) => text.includes("子功能"));
        return (table.rows || [])
            .map((row: any, index: number) => ({
                key: `rendered_change_${index}`,
                srs_code: String(row?.[codeCol] || extractSrsCodeFromTableRow(row) || "").trim(),
                module: normalizeReqDisplayText(row?.[moduleCol]),
                function: normalizeReqDisplayText(row?.[functionCol]),
                sub_function: normalizeReqDisplayText(row?.[subFunctionCol]),
            }))
            .filter((row) => row.srs_code || row.module || row.function || row.sub_function);
    };
    const findChangeTableForRenderedTable = (table?: TableData | null, title?: string) =>
        findChangeTableForPreview(srsReqPreview?.changes || [], table, title);
    const isRenderableTable = hasRenderableTable;
    const isImportedPlaceholderTitle = (title?: string) => /^导入表格\d*$/.test(String(title || "").trim());
    const getNormalTableDisplayTitle = (item: { table?: TableData | null; title?: string; text?: string; index: number; isCurrentNodeTable?: boolean }) => {
        if (isFunctionalKvTable(item.table)) return "";
        const tableName = String(item.table?.name || "").trim();
        if (tableName) return tableName;
        if (item.isCurrentNodeTable) return "";
        const title = String(item.title || "").trim();
        if (title && !isImportedPlaceholderTitle(title)) return title;
        return "";
    };
    const orderedNormalTables = (!isSrsReqRefNode
        ? [
            ...(isRenderableTable(node.table) ? [{
                key: `node_table_${node.id}`,
                table: node.table as TableData,
                ownerNodeId: node.id,
                title: node.title || "",
                text: node.text || "",
                isCurrentNodeTable: true,
            }] : []),
            ...embeddedTableNodes
                .filter((child) => isRenderableTable(child.table))
                .map((child, idx) => ({
                    key: `embedded_table_${child.id}_${idx}`,
                    table: child.table as TableData,
                    ownerNodeId: Number(child.id || child.n_id || node.id),
                    title: child.title || "",
                    text: child.text || "",
                    isCurrentNodeTable: false,
                })),
        ].map((item, index) => ({ ...item, index }))
        : []);
    const shouldSplitTextForTables = readOnly && !isSrsReqRefNode && orderedNormalTables.length > 1 && embeddedTableNodes.length > 0;
    const splitText = splitTextByTables(node.text, orderedNormalTables.length);
    const hasOtherReqMarker = /其他需求列表[:：]?/.test(String(node.text || ""));
    const otherReqTableIndex = orderedNormalTables.findIndex((tbl) => isReqOtherTable(tbl.table));
    const hasNormalOtherReqTable = otherReqTableIndex >= 0;
    const hasNormalMainReqTable = orderedNormalTables.some((tbl) => (
        isReqMainTable(tbl.table) &&
        !/变更/.test(String(tbl.table?.name || tbl.title || ""))
    ));
    const hasNormalChangeReqTable = orderedNormalTables.some((tbl) => {
        const title = String(tbl.table?.name || tbl.title || getNormalTableDisplayTitle(tbl) || "");
        return /变更/.test(title) && !!tbl.table?.headers?.length;
    });
    const hasChangeReqTableInSubtree = (items: TreeNode[] = []): boolean => (
        (items || []).some((item) => {
            const title = String(item?.table?.name || item?.title || item?.label || "");
            const isChangeTable = /变更/.test(title) && !!item?.table?.headers?.length;
            return isChangeTable || hasChangeReqTableInSubtree(item.children || []);
        })
    );
    const hasMatchingChangeTableInTree = (title?: string): boolean => (
        existingChangeTableTitles.some((existingTitle) => matchesChangeTableTitle(existingTitle, title))
    );
    const changeReqPreviewTablesToRender = (srsReqPreview?.changes || []).filter((table) => (
        !hasMatchingChangeTableInTree(table?.title)
    ));
    const shouldShowSrsReqPreviewTables = !!(
        (isSrsReqRefNode || isImportedReqTableAnchor) &&
        !(hasNormalMainReqTable || hasNormalOtherReqTable) &&
        srsReqPreview &&
        (
            (srsReqPreview.main || []).length > 0 ||
            (srsReqPreview.other || []).length > 0 ||
            changeReqPreviewTablesToRender.length > 0
        )
    );
    const shouldShowChangeReqTables = !!(
        (isSrsReqListNode || (isImportedReqTableAnchor && hasNormalOtherReqTable)) &&
        changeReqPreviewTablesToRender.length > 0 &&
        !hasNormalChangeReqTable &&
        !hasChangeReqTableInSubtree(node.children || [])
    );
    const shouldMoveOtherReqMarker = readOnly && hasOtherReqMarker && otherReqTableIndex >= 0;
    const imageTextParts = extractImageTextParts(node.text);
    const hasDisplayedImage = !!displayImageUrl;
    // 有图且能识别「图N …」图题时，按 Word 版式拆分：图上 intro / 图下 caption / 图下 body
    const useImageSplitLayout = hasDisplayedImage && !!imageTextParts.caption;
    const displayNodeText = (() => {
        let text = shouldMoveOtherReqMarker ? removeOtherReqMarker(node.text) : (node.text || "");
        if (useImageSplitLayout) {
            text = [imageTextParts.intro, imageTextParts.body].filter(Boolean).join("\n");
        }
        return text;
    })();
    const updateImageTextPart = (part: "intro" | "caption" | "body", value: string) => {
        const next = {
            intro: imageTextParts.intro,
            caption: imageTextParts.caption,
            body: imageTextParts.body,
            [part]: value,
        };
        onContentChange(node.id, joinImageTextParts(next.intro, next.caption, next.body), isLockedOtherReqChapter);
    };
    const buildSafeSrsMainCells = (table?: TableData | null): TableData["cells"] | undefined => {
        if (!table || !isReqMainTable(table) || !Array.isArray(table.headers) || !Array.isArray(table.rows) || table.rows.length === 0) {
            return table?.cells;
        }
        const headers = table.headers || [];
        const rows = table.rows || [];
        const getColumnIndex = (matcher: (text: string) => boolean) => (
            headers.findIndex((header) => matcher(normalizeCellText(header?.name)))
        );
        const codeColIndex = getColumnIndex((text) => isReqCodeHeaderText(text));
        const moduleColIndex = getColumnIndex((text) => text.includes("模块"));
        const functionColIndex = getColumnIndex((text) => text.includes("功能") && !text.includes("子功能"));
        const subFunctionColIndex = getColumnIndex((text) => text.includes("子功能"));
        if (codeColIndex < 0 || moduleColIndex < 0 || functionColIndex < 0) return table.cells;
        const getSrsGroup = (value: string) => {
            const code = normalizeSrsCodeValue(value);
            return code.match(/^(SRS-[A-Z]+\d+)-\d+$/)?.[1] || code;
        };
        const next = [
            headers.map((header) => ({ value: header.name || "", row_span: 1, col_span: 1 })),
            ...rows.map((row) => headers.map((header) => ({
                value: row?.[header.code] || "",
                row_span: 1,
                col_span: 1,
            }))),
        ];
        const effectiveRows = rows.map((row, index) => {
            const prevEffective = index > 0 ? (rows[index - 1] as any).__effectiveSrsValues : undefined;
            const rawModule = normalizeReqDisplayText(row?.[headers[moduleColIndex]?.code]);
            const rawFunction = normalizeReqDisplayText(row?.[headers[functionColIndex]?.code]);
            const rawSubFunction = subFunctionColIndex >= 0
                ? normalizeReqDisplayText(row?.[headers[subFunctionColIndex]?.code])
                : "";
            const currentCode = normalizeReqDisplayText(row?.[headers[codeColIndex]?.code]);
            const currentGroup = getSrsGroup(currentCode);
            const sameSrsGroup = !!currentGroup && currentGroup === String(prevEffective?.group || "");
            const effective = {
                module: rawModule || (sameSrsGroup ? (prevEffective?.module || "") : ""),
                function: rawFunction || (sameSrsGroup && !rawModule ? (prevEffective?.function || "") : ""),
                subFunction: rawSubFunction || (sameSrsGroup && !rawModule && !rawFunction ? (prevEffective?.subFunction || "") : ""),
                group: currentGroup,
            };
            (row as any).__effectiveSrsValues = effective;
            return effective;
        });
        rows.forEach((row) => {
            delete (row as any).__effectiveSrsValues;
        });
        const effectiveValueAt = (rowIndex: number, colIndex: number) => {
            if (colIndex === moduleColIndex) return effectiveRows[rowIndex]?.module || "";
            if (colIndex === functionColIndex) return effectiveRows[rowIndex]?.function || "";
            if (colIndex === subFunctionColIndex) return effectiveRows[rowIndex]?.subFunction || "";
            return normalizeReqDisplayText(rows[rowIndex]?.[headers[colIndex]?.code]);
        };
        const mergeColumnByHierarchy = (colIndex: number, parentIndexes: number[]) => {
            if (colIndex < 0) return;
            let start = 0;
            while (start < rows.length) {
                const startValue = effectiveValueAt(start, colIndex);
                if (!startValue) {
                    start += 1;
                    continue;
                }
                let end = start + 1;
                while (end < rows.length) {
                    if (!effectiveRows[start]?.group || effectiveRows[start]?.group !== effectiveRows[end]?.group) break;
                    const sameValue = effectiveValueAt(end, colIndex) === startValue;
                    const sameParents = parentIndexes.every((index) => index < 0 || effectiveValueAt(end, index) === effectiveValueAt(start, index));
                    if (!sameValue || !sameParents) break;
                    end += 1;
                }
                const span = end - start;
                if (span > 1) {
                    next[start + 1][colIndex].value = startValue;
                    next[start + 1][colIndex].row_span = span;
                    for (let rowIndex = start + 1; rowIndex < end; rowIndex += 1) {
                        next[rowIndex + 1][colIndex].value = "";
                        next[rowIndex + 1][colIndex].row_span = 0;
                    }
                }
                start = end;
            }
        };
        mergeColumnByHierarchy(moduleColIndex, []);
        mergeColumnByHierarchy(functionColIndex, [moduleColIndex]);
        mergeColumnByHierarchy(subFunctionColIndex, [moduleColIndex, functionColIndex]);
        return next;
    };

    // 构建表格列配置：不横向滚动，内容自动换行
    const buildTableColumns = (targetTable?: TableData | null): ColumnsType<any> => {
        const table = targetTable || displayTable;
        if (!table || !table.headers || table.headers.length === 0) {
            return [];
        }
        const hideHeader = table.show_header === 0 || isFunctionalKvTable(table);
        const narrowFirstCol = shouldNarrowFunctionalFirstColumn(table);
        const tableCells = buildSafeSrsMainCells(table) || [];
        // 无表头两列表格优先按“数据行”渲染，避免合并单元格分支吞掉首行（需求编号/SRS）
        const hasMergedCells = !hideHeader && Array.isArray(tableCells) && tableCells.length > 1;
        return table.headers.map((header, index) => {
            const codeCol = isSrsCodeColumn(header);
            const col: any = {
                title: hideHeader ? "" : header.name,
                dataIndex: header.code,
                key: `col_${index}`,
                className: [
                    codeCol ? "srs-code-col" : "",
                    narrowFirstCol && index === 0 ? "functional-kv-field-col" : "",
                ].filter(Boolean).join(" ") || undefined,
            };
            if (narrowFirstCol && index === 0) {
                col.width = 120;
                col.onHeaderCell = () => ({ style: { width: 120, minWidth: 120, maxWidth: 120 } });
                col.onCell = () => ({ style: { width: 120, minWidth: 120, maxWidth: 120 } });
            } else if (codeCol) {
                col.width = 190;
                col.ellipsis = true;
            }
            if (hasMergedCells) {
                // 表头也按 cells[0] 的 col_span 合并，延续列 colSpan=0 隐藏，避免导入合并单元格时多出「列N」
                col.onHeaderCell = () => {
                    const headerCell = tableCells[0]?.[index];
                    return { colSpan: headerCell?.col_span ?? 1 } as any;
                };
                col.render = (_val: any, _row: any, rowIndex: number) => {
                    const bodyCells = tableCells.slice(1);
                    const cell = bodyCells[rowIndex]?.[index];
                    const rowSpan = cell?.row_span ?? 1;
                    const colSpan = cell?.col_span ?? 1;
                    const hAlign = (cell?.h_align || "left") as "left" | "center" | "right";
                    const vAlign = (cell?.v_align || "top") as "top" | "middle" | "bottom";
                    return {
                        children: <div className={codeCol ? "table-cell-code" : "table-cell-content"}>{cell?.value || ""}</div>,
                        props: { rowSpan, colSpan, style: { textAlign: hAlign, verticalAlign: vAlign } },
                    };
                };
            } else {
                col.render = (val: any) => <div className={codeCol ? "table-cell-code" : "table-cell-content"}>{val || ""}</div>;
            }
            return col;
        });
    };

    // 构建表格数据源
    const buildTableDataSource = (targetTable?: TableData | null) => {
        const table = targetTable || displayTable;
        if (!table || !table.rows || table.rows.length === 0) {
            return [];
        }
        const hideHeader = table.show_header === 0 || isFunctionalKvTable(table);
        const headers = table.headers || [];
        const tableCells = buildSafeSrsMainCells(table) || [];
        // 无表头两列表格优先按“数据行”渲染，避免合并单元格分支吞掉首行（需求编号/SRS）
        const hasMergedCells = !hideHeader && Array.isArray(tableCells) && tableCells.length > 1;
        const shouldPrependHeaderAsFirstRow =
            hideHeader &&
            headers.length === 2 &&
            normalizeCellText(headers[0]?.name).includes("需求编号") &&
            !!normalizeCellText(headers[1]?.name);
        if (hasMergedCells && table.headers) {
            const bodyCells = tableCells.slice(1);
            const rows = bodyCells.map((row, rowIndex) => {
                const rowObj: any = { key: rowIndex };
                table!.headers!.forEach((header, colIdx) => {
                    const fieldLabel = isFunctionalKvTable(table) && colIdx === 1
                        ? row?.[0]?.value
                        : "";
                    const cellValue = normalizeReqDisplayText(row?.[colIdx]?.value || "");
                    rowObj[header.code] = fieldLabel ? normalizeReqDetailNumberedText(cellValue, fieldLabel) : cellValue;
                });
                return rowObj;
            });
            if (shouldPrependHeaderAsFirstRow) {
                const firstHeaderRow: any = { key: `kv_header_row` };
                firstHeaderRow[headers[0].code] = headers[0].name || "";
                firstHeaderRow[headers[1].code] = headers[1].name || "";
                const firstBodyLeft = normalizeCellText(rows?.[0]?.[headers[0].code]);
                const firstBodyRight = normalizeCellText(rows?.[0]?.[headers[1].code]);
                const headerLeft = normalizeCellText(headers[0].name);
                const headerRight = normalizeCellText(headers[1].name);
                // 仅当首行与“需求编号|SRS编号”完全重复时才不重复插入
                if (!(firstBodyLeft === headerLeft && firstBodyRight === headerRight)) {
                    rows.unshift(firstHeaderRow);
                }
            }
            return rows;
        }

        const functionalLeftCode = isFunctionalKvTable(table) ? headers[0]?.code : "";
        const functionalRightCode = isFunctionalKvTable(table) ? headers[1]?.code : "";
        const rows: any[] = table.rows.map((row, index) => {
            const fieldLabel = functionalLeftCode ? row?.[functionalLeftCode] : "";
            return {
                key: index,
                ...Object.fromEntries(Object.entries(row || {}).map(([k, v]) => {
                    const value = normalizeReqDisplayText(v);
                    return [k, functionalRightCode && k === functionalRightCode ? normalizeReqDetailNumberedText(value, fieldLabel) : value];
                }))
            };
        });
        if (shouldPrependHeaderAsFirstRow) {
            const firstHeaderRow: any = { key: `kv_header_row` };
            firstHeaderRow[headers[0].code] = headers[0].name || "";
            firstHeaderRow[headers[1].code] = headers[1].name || "";
            const firstBodyLeft = normalizeCellText(rows?.[0]?.[headers[0].code]);
            const firstBodyRight = normalizeCellText(rows?.[0]?.[headers[1].code]);
            const headerLeft = normalizeCellText(headers[0].name);
            const headerRight = normalizeCellText(headers[1].name);
            // 仅当首行与“需求编号|SRS编号”完全重复时才不重复插入
            if (!(firstBodyLeft === headerLeft && firstBodyRight === headerRight)) {
                rows.unshift(firstHeaderRow);
            }
        }
        return rows;
    };

    const navTitleValue = stripNavChapterPrefix(String(node.title || ""));

    return (
        <div style={{ marginLeft: renderChildren ? level * 20 : 0 }}>
          <div className={`tree-node-item level-${level}`}>
              <div className={`node-row${hasRcm ? " has-rcm" : ""}${hasRcmText ? " has-rcm-text" : ""}`}>
                  {hasVisibleChildren && renderChildren ? (
                      <Button
                          type="text"
                          size="small"
                          className="node-expand-btn"
                          icon={expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                          onClick={() => setExpanded((v) => !v)}
                      />
                  ) : (
                      <span className="node-expand-placeholder" />
                  )}
                  {useNavChapterEditor && !readOnly && (
                      <span className="node-title-prefix">{autoNavChapterNo || ""}</span>
                  )}
                  {readOnly || isLockedReqHierarchyNode || isLockedChapterMeta ? (
                      <div className={`node-title${hasRcm ? " with-rcm" : ""}${hasRcmText ? " with-rcm-text" : ""}`}>{node.title || "-"}</div>
                  ) : (
                      <Input
                          className={`node-title${hasRcm ? " with-rcm" : ""}${hasRcmText ? " with-rcm-text" : ""}`}
                          value={useNavChapterEditor ? navTitleValue : node.title}
                          onChange={(e) => onTitleChange(node.id, e.target.value)}
                          placeholder={ts('please_input_title')}
                          disabled={readOnly}
                      />
                  )}
                  {
                    !isAutoReqNode && (
                        isLockedChapterMeta ? (
                            lockedChapterSrsCode ? (
                                <div className="node-srs-code node-srs-code-readonly" title={ts('srs_doc.other_req_code_readonly_hint') || '请在其他需求列表中修改章节名称和需求编号'}>
                                    {`${ts("srs_doc.srs_code") || "需求编号"}：${lockedChapterSrsCode}`}
                                </div>
                            ) : null
                        ) : (
                            !isLockedReqDetailCodeNode && ('srs_code' in node) && node.srs_code !== null && (
                                readOnly || isLockedReqDetailCodeNode ? (
                                    <div className="node-srs-code">{node.srs_code || "-"}</div>
                                ) : (
                                    <Input
                                        className="node-srs-code"
                                        value={node.srs_code ?? ''}
                                        onChange={(e) => onSrsCodeChange(node.id, e.target.value)}
                                        placeholder={ts('please_input_srs_code')}
                                        disabled={readOnly}
                                    />
                                )
                            )
                        )
                    )
                  }
                  {/* 章节 RCM 选择：选择后自动拼接写入 text 文本框（与标题同一行） */}
                  {!isAutoReqNode && Array.isArray(node.rcm_codes) && (
                      <div className="node-rcm-select">
                          {readOnly ? (
                              <div>{(node.rcm_codes || []).join(", ") || "-"}</div>
                          ) : (
                              <Select
                                  mode="multiple"
                                  showSearch
                                  allowClear
                                  optionFilterProp="label"
                                  placeholder={ts("srs_doc.select_rcm_code") || "选择RCM"}
                                  options={rcmSelectOptions}
                                  popupClassName="srs-rcm-select-dropdown"
                                  value={(() => {
                                      const codes = Array.isArray(node.rcm_codes) ? node.rcm_codes.filter(Boolean) : [];
                                      const normalizedCodes = codes.map((code) => normalizeRcmCode(code));
                                      return codes
                                          .map((_code, idx) => {
                                              const codeNorm = normalizedCodes[idx];
                                              return rcmSelectOptions.find((o) => normalizeRcmCode(o.label) === codeNorm)?.value;
                                          })
                                          .filter((v): v is number | string => typeof v === "number" || typeof v === "string");
                                  })()}
                                  onChange={(vals) => onRcmSelectChange(node.id, (vals || []) as Array<number | string>)}
                                  disabled={readOnly || !rcmSelectOptions.length}
                                  // 容器变窄时避免 responsive 模式不渲染选中 tag
                                  maxTagCount={999}
                                  tagRender={(tagProps: any) => {
                                      const code = String(tagProps?.label ?? "");
                                      const opt = rcmSelectOptions.find((o) => o.label === code);
                                      return (
                                          <Tooltip title={opt?.description || ""} placement="topLeft">
                                              <Tag color="blue">{code}</Tag>
                                          </Tooltip>
                                      );
                                  }}
                                  optionRender={(opt: any) => (
                                      <Tooltip title={opt?.data?.description || ""} placement="left">
                                          <span>{opt?.data?.label}</span>
                                      </Tooltip>
                                  )}
                                  style={{ width: "100%", minWidth: 0 }}
                              />
                          )}
                      </div>
                  )}
                  {!isSrsReqRefNode && !useImageSplitLayout && (
                      canEditNodeContent ? (
                          <Input.TextArea
                              className="node-content node-text-area"
                              value={editableNodeText}
                              onChange={(e) => onContentChange(node.id, e.target.value, isLockedOtherReqChapter)}
                              placeholder={ts('srs_doc.please_input_content')}
                              size="small"
                              rows={3}
                              autoSize={{ minRows: 3, maxRows: 20 }}
                              disabled={readOnly}
                          />
                      ) : (
                          <div className="node-content node-text-area">
                              {shouldSplitTextForTables
                                  ? removeOtherReqMarker(splitText.intro || "")
                                  : (isLockedOtherReqChapter ? editableNodeText : displayNodeText)}
                          </div>
                      )
                  )}
                  {/* 图片章节拆分：图上方 intro（如「如图1所示：」） */}
                  {useImageSplitLayout && (
                      canEditNodeContent ? (
                          <Input.TextArea
                              className="node-content node-img-intro"
                              value={imageTextParts.intro}
                              onChange={(e) => updateImageTextPart("intro", e.target.value)}
                              placeholder="如图N所示："
                              size="small"
                              autoSize={{ minRows: 1, maxRows: 6 }}
                          />
                      ) : (
                          imageTextParts.intro ? (
                              <div className="node-content node-img-intro">{imageTextParts.intro}</div>
                          ) : null
                      )
                  )}
                  {isImgRefType(node.ref_type) && !isProductBoundDocImageNode && (
                      <div className="node-file-ref node-content">
                          {displayImageUrl ? (
                              <a
                                  href={resolveFileUrl(displayImageUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="node-file-link"
                              >
                                  <FileOutlined /> {getRefTypeLabel(node.ref_type, ts)}
                              </a>
                          ) : (
                              <Tooltip title={ts('srs_doc.no_file')}>
                                  <span className="node-file-empty">
                                      <FileOutlined /> {getRefTypeLabel(node.ref_type, ts)}
                                  </span>
                              </Tooltip>
                          )}
                      </div>
                  )}
                  {level <= 2 && displayImageUrl && (
                      <div className="node-pic-block">
                          <div className="node-pic node-pic-readonly">
                              <Image
                                  key={displayImageUrl}
                                  src={resolveFileUrl(displayImageUrl)}
                                  alt={node.title || "image"}
                                  preview={true}
                              />
                          </div>
                      </div>
                  )}
                  {isProductBoundDocImageNode && !readOnly && (
                      <Upload {...productBoundUploadProps} className="node-pic">
                          <Button size="small" icon={<UploadOutlined />}>
                              {hasDisplayImage ? "重新上传" : ts("select_file")}
                          </Button>
                      </Upload>
                  )}
                  {isGenericImgRefNode && !readOnly && (
                      <Upload {...uploadProps} className="node-pic">
                          <Button size="small" icon={<UploadOutlined />}>
                              {displayImageUrl ? "重新上传" : ts("select_file")}
                          </Button>
                      </Upload>
                  )}
                  {/* 图片章节拆分：图下方居中图题 + 说明正文 */}
                  {useImageSplitLayout && (
                      <>
                          {canEditNodeContent ? (
                              <Input
                                  className="node-content node-img-caption"
                                  value={imageTextParts.caption}
                                  onChange={(e) => updateImageTextPart("caption", e.target.value)}
                                  placeholder="图N 图题"
                                  size="small"
                              />
                          ) : (
                              <div className="node-content node-img-caption">{imageTextParts.caption}</div>
                          )}
                          {canEditNodeContent ? (
                              <Input.TextArea
                                  className="node-content node-img-body"
                                  value={imageTextParts.body}
                                  onChange={(e) => updateImageTextPart("body", e.target.value)}
                                  placeholder={ts('srs_doc.please_input_content')}
                                  size="small"
                                  autoSize={{ minRows: 2, maxRows: 20 }}
                              />
                          ) : (
                              imageTextParts.body ? (
                                  <div className="node-content node-img-body">{imageTextParts.body}</div>
                              ) : null
                          )}
                      </>
                  )}
                  {node.ref_type === 'srs_reqds' && onOpenReqList && (
                      <Button type="primary" size="small" className="node-srsreq-btn" onClick={onOpenReqList}>
                          {ts('srs_doc.req_detailed_list')}
                      </Button>
                  )}
                  {/* {node.ref_type === 'srs_reqds' && (
                      <Tag color="geekblue" style={{padding: '5px'}}>{ts('srs_doc.req_list')}</Tag>
                  )} */}
                  {!readOnly && !disableHierarchyActions && !isLockedReqHierarchyNode && (
                  <Space className="node-actions" size={8}>
                      {!(isProductBoundDocImageNode || (node.ref_type && (isImgRefType(node.ref_type) || node.ref_type === 'srs_reqs' || node.ref_type === 'srs_reqs_2'))) && (
                      <Button
                          size="small"
                          icon={<TableOutlined />}
                          onClick={() => onAddTable(node.id)}>
                          {ts('srs_doc.table')}
                      </Button>
                      )}
                      {!(isProductBoundDocImageNode || (node.ref_type && (isImgRefType(node.ref_type) || node.ref_type === 'srs_reqs' || node.ref_type === 'srs_reqs_2'))) && (
                      <Upload {...tableImportProps}>
                          <Button
                              size="small"
                              icon={<UploadOutlined />}>
                              导入表格
                          </Button>
                      </Upload>
                      )}
                      <Popconfirm
                          title={ts('confirm_delete')}
                          onConfirm={() => onDelete(node.id)}
                          okText={ts('confirm')}
                          cancelText={ts('cancel')}>
                          <Button
                              size="small"
                              danger
                              icon={<DeleteOutlined />}>
                              {ts('delete')}
                          </Button>
                      </Popconfirm>
                  </Space>
                  )}
              </div>

              {/* 显示普通章节表格：按节点内 + 导入子表顺序展示 */}
              {!(isProductBoundDocImageNode || (node.ref_type && (isImgRefType(node.ref_type) || node.ref_type === 'srs_reqs' || node.ref_type === 'srs_reqs_2'))) &&
                orderedNormalTables.map((tbl, idx) => (
                    <div className={`node-table${shouldNarrowFunctionalFirstColumn(tbl.table) ? " node-table--functional-kv" : ""}`} key={tbl.key}>
                        {shouldMoveOtherReqMarker && idx === otherReqTableIndex && (
                            <div className="node-content" style={{ marginBottom: 8, whiteSpace: "pre-line", fontSize: 13, fontWeight: 400 }}>
                                其他需求列表
                            </div>
                        )}
                        {shouldSplitTextForTables && (!!splitText.tableHeaders[idx] || !!getNormalTableDisplayTitle(tbl)) && (
                            <div className="node-content" style={{ marginBottom: 8, whiteSpace: "pre-line", fontSize: 13, fontWeight: 400 }}>
                                {!!splitText.tableHeaders[idx]?.section && (
                                    <div style={{ textAlign: "left" }}>{splitText.tableHeaders[idx]?.section}</div>
                                )}
                                {!!(splitText.tableHeaders[idx]?.tableTitle || getNormalTableDisplayTitle(tbl)) && (
                                    <div style={{ textAlign: "left", fontWeight: 600 }}>{splitText.tableHeaders[idx]?.tableTitle || getNormalTableDisplayTitle(tbl)}</div>
                                )}
                            </div>
                        )}
                        {!shouldSplitTextForTables && !!getNormalTableDisplayTitle(tbl) && (
                            <div style={{ marginBottom: 8, fontWeight: 600 }}>
                                {getNormalTableDisplayTitle(tbl)}
                            </div>
                        )}
                        <div className="node-table-header">
                            <Table
                                columns={buildTableColumns(tbl.table)}
                                dataSource={buildTableDataSource(tbl.table)}
                                pagination={false}
                                size="small"
                                bordered
                                tableLayout="fixed"
                                showHeader={!(tbl.table?.show_header === 0 || isFunctionalKvTable(tbl.table))}
                            />
                            {!readOnly && (
                            <Space className="node-table-actions" size={8}>
                                <Button
                                    size="small"
                                    icon={<EditOutlined />}
                                    onClick={() => {
                                        const isChangeReqTable = isReqMainTable(tbl.table) && /变更/.test(String(tbl.table?.name || tbl.title || getNormalTableDisplayTitle(tbl) || ""));
                                        if (isChangeReqTable) {
                                            const treeTableTitle = renderChangeTableTitle(tbl.table?.name || tbl.title);
                                            const matchedChangeTable = findChangeTableForRenderedTable(tbl.table, tbl.title);
                                            if (onEditSrsChangeTable) {
                                                onEditSrsChangeTable({
                                                    ...(matchedChangeTable || {}),
                                                    id: matchedChangeTable?.id ?? `node_${tbl.ownerNodeId}`,
                                                    title: treeTableTitle,
                                                    type_code: matchedChangeTable?.type_code,
                                                    data: (matchedChangeTable?.data || []).length
                                                        ? (matchedChangeTable?.data || [])
                                                        : buildChangeRowsFromRenderedTable(tbl.table),
                                                } as any);
                                            } else {
                                                message.error("变更需求表未加载完成，请刷新后重试");
                                            }
                                            return;
                                        }
                                        onEditTable(tbl.ownerNodeId);
                                    }}>
                                    {ts('edit')}
                                </Button>
                                {!isReqDetailProtectedTable(tbl.table) && (
                                    <Popconfirm
                                        title={ts('srs_doc.confirm_delete_table')}
                                        onConfirm={() => onDeleteTable(tbl.ownerNodeId)}
                                        okText={ts('confirm')}
                                        cancelText={ts('cancel')}>
                                        <Button
                                            size="small"
                                            danger
                                            icon={<DeleteOutlined />}>
                                            {ts('delete')}
                                        </Button>
                                    </Popconfirm>
                                )}
                            </Space>
                            )}
                        </div>
                    </div>
                ))}
              {showReqExtraTables && embeddedOtherReqTableNodes.map((subNode, idx) => (
                  <div className="node-table" key={`embedded_sub_table_${subNode.id || idx}`}>
                      <div style={{ marginBottom: 8, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span>{isReqOtherTable(subNode.table) ? (ts("srs_doc.other_req_list") || "其他需求列表") : (subNode.title || `表格${idx + 1}`)}</span>
                          {!readOnly && (
                              <Button size="small" icon={<EditOutlined />} onClick={() => onEditTable(Number(subNode.id || subNode.n_id || node.id))}>
                                  {ts("edit")}
                              </Button>
                          )}
                      </div>
                      <div className="node-table-header">
                          <Table
                              columns={buildTableColumns(subNode.table)}
                              dataSource={buildTableDataSource(subNode.table)}
                              pagination={false}
                              size="small"
                              bordered
                              tableLayout="fixed"
                              showHeader={!(subNode.table?.show_header === 0 || isFunctionalKvTable(subNode.table))}
                          />
                      </div>
                  </div>
              ))}
              {shouldShowChangeReqTables && changeReqPreviewTablesToRender.map((table) => (
                  <div className="node-table" key={`srs_change_${table.id}`}>
                      <div style={{ marginBottom: 8, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span>{renderChangeTableTitle(table.title)}</span>
                          {!readOnly && (
                              <Space size={8}>
                                  <Button
                                      size="small"
                                      type="default"
                                      icon={<EditOutlined />}
                                      onClick={() => onEditSrsChangeTable?.(table as any)}
                                  >
                                      {ts("edit")}
                                  </Button>
                                  {!!onDeleteSrsChangeTable && (
                                      <Popconfirm
                                          title={ts("srs_doc.confirm_delete_table")}
                                          onConfirm={() => onDeleteSrsChangeTable(table as any)}
                                          okText={ts("confirm")}
                                          cancelText={ts("cancel")}
                                      >
                                          <Button size="small" danger icon={<DeleteOutlined />}>
                                              {ts("delete")}
                                          </Button>
                                      </Popconfirm>
                                  )}
                              </Space>
                          )}
                      </div>
                      <div className="node-table-header">
                          <Table
                              columns={[
                                  { title: ts("srs_doc.srs_code") || "需求编号", dataIndex: "srs_code", key: "srs_code" },
                                  { title: ts("srs_doc.module") || "模块", dataIndex: "module", key: "module" },
                                  { title: ts("srs_doc.function") || "功能", dataIndex: "function", key: "function", render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-" },
                                  { title: ts("srs_doc.sub_function") || "子功能", dataIndex: "sub_function", key: "sub_function", render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-" },
                              ]}
                              dataSource={table.data || []}
                              pagination={false}
                              size="small"
                              bordered
                              tableLayout="fixed"
                              rowKey="key"
                          />
                      </div>
                  </div>
              ))}
              {matchedReqDetail && !isRenderableTable(node.table) && renderReqDetailTable(matchedReqDetail, `req_detail_${node.id}`)}
              {chapterReqDetails.map((detail: any, idx: number) => renderReqDetailTable(detail, `chapter_req_detail_${node.id}_${detail?.code || idx}`))}
              {shouldShowSrsReqPreviewTables && (
                  <div className="node-table">
                      {(srsReqPreview.main || []).length > 0 && (
                          <>
                              <div style={{ marginBottom: 8, fontWeight: 600 }}>{ts("srs_doc.srs_table") || "产品需求列表"}</div>
                              <Table
                                  size="small"
                                  bordered
                                  pagination={false}
                                  rowKey="key"
                                  loading={!!srsReqLoading}
                                  locale={{ emptyText: "暂无数据" }}
                                  dataSource={srsReqPreview.main || []}
                                  columns={[
                                      { title: ts("srs_doc.srs_code") || "需求编号", dataIndex: "srs_code", width: 180 },
                                      { title: ts("srs_doc.module") || "模块", dataIndex: "module", width: 180 },
                                      { title: ts("srs_doc.function") || "功能", dataIndex: "function", width: 360, render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-" },
                                      { title: ts("srs_doc.sub_function") || "子功能", dataIndex: "sub_function", width: 360, render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-" },
                                  ]}
                                  scroll={{ x: 1060 }}
                              />
                          </>
                      )}

                      {(srsReqPreview.other || []).length > 0 && (
                          <>
                              <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>{ts("srs_doc.other_req_list") || "其他需求列表"}</div>
                              <Table
                                  size="small"
                                  bordered
                                  pagination={false}
                                  rowKey="key"
                                  loading={!!srsReqLoading}
                                  locale={{ emptyText: "暂无数据" }}
                                  dataSource={srsReqPreview.other || []}
                                  columns={[
                                      { title: ts("srs_doc.srs_code") || "需求编号", dataIndex: "srs_code", width: 180 },
                                      { title: ts("srs_doc.module") || "需求模块", dataIndex: "module", width: 320 },
                                      { title: ts("srs_doc.chapter_number") || "对应的章节号", dataIndex: "location", width: 320 },
                                  ]}
                                  scroll={{ x: 820 }}
                              />
                          </>
                      )}

                      {changeReqPreviewTablesToRender.map((table) => (
                          <div key={`srs_preview_change_${table.id}`} style={{ marginTop: 16 }}>
                              <div style={{ marginBottom: 8, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                  <span>{renderChangeTableTitle(table.title)}</span>
                                  {!readOnly && (
                                      <Space size={8}>
                                          <Button
                                              size="small"
                                              type="default"
                                              icon={<EditOutlined />}
                                              onClick={() => onEditSrsChangeTable?.(table as any)}
                                          >
                                              {ts("edit")}
                                          </Button>
                                          {!!onDeleteSrsChangeTable && (
                                              <Popconfirm
                                                  title={ts("srs_doc.confirm_delete_table")}
                                                  onConfirm={() => onDeleteSrsChangeTable(table as any)}
                                                  okText={ts("confirm")}
                                                  cancelText={ts("cancel")}
                                              >
                                                  <Button size="small" danger icon={<DeleteOutlined />}>
                                                      {ts("delete")}
                                                  </Button>
                                              </Popconfirm>
                                          )}
                                      </Space>
                                  )}
                              </div>
                              <Table
                                  size="small"
                                  bordered
                                  pagination={false}
                                  rowKey="key"
                                  loading={!!srsReqLoading}
                                  locale={{ emptyText: "暂无数据" }}
                                  dataSource={table.data || []}
                                  columns={[
                                      { title: ts("srs_doc.srs_code") || "需求编号", dataIndex: "srs_code", width: 180 },
                                      { title: ts("srs_doc.module") || "模块", dataIndex: "module", width: 180 },
                                      { title: ts("srs_doc.function") || "功能", dataIndex: "function", width: 360, render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-" },
                                      { title: ts("srs_doc.sub_function") || "子功能", dataIndex: "sub_function", width: 360, render: (t: string) => t ? <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t}</span> : "-" },
                                  ]}
                                  scroll={{ x: 1060 }}
                              />
                          </div>
                      ))}
                  </div>
              )}
          </div>
            {renderChildren && expanded && visibleChildren.map((child) => (
                <TreeNodeItem
                    key={child.id}
                    node={child}
                    level={level + 1}
                    docId={docId}
                    productId={productId}
                    docVersion={docVersion}
                    productVersion={productVersion}
                    readOnly={readOnly}
                    rcmOptions={rcmOptions}
                    onRcmSelectChange={onRcmSelectChange}
                    onAdd={onAdd}
                    onAddSibling={onAddSibling}
                    onDelete={onDelete}
                    onTitleChange={onTitleChange}
                    onSrsCodeChange={onSrsCodeChange}
                    onImageChange={onImageChange}
                    onContentChange={onContentChange}
                    onAddTable={onAddTable}
                    onImportTable={onImportTable}
                    onEditTable={onEditTable}
                    onDeleteTable={onDeleteTable}
                    onOpenSrsTable={onOpenSrsTable}
                    onOpenReqList={onOpenReqList}
                    onEditSrsChangeTable={onEditSrsChangeTable}
                    onDeleteSrsChangeTable={onDeleteSrsChangeTable}
                    srsReqPreview={srsReqPreview}
                    reqDetails={reqDetails}
                    srsReqLoading={srsReqLoading}
                    existingChangeTableTitles={existingChangeTableTitles}
                />
            ))}
        </div>
    );
};

interface TreeStructureProps {
    value?: TreeNode[];
    onChange?: (value: TreeNode[]) => void;
    docId?: number;
    productId?: number;
    docVersion?: string;
    productVersion?: string;
    hiddenNodeIds?: number[];
    readOnly?: boolean;
    rcmOptions: Array<{ value: number; label: string; description?: string }>;
    onNodeDelete?: (docId: number, nodeId: number) => Promise<boolean>; // 删除节点回调
    onOpenSrsTable?: () => void;  // 打开 SRS 表弹框
    onOpenReqList?: () => void;  // 打开需求列表弹框
    onEditSrsChangeTable?: (table: { id: number | string; title: string; data: any[]; type_code?: string }) => void;
    onDeleteSrsChangeTable?: (table: { id: number | string; title: string; data: any[]; type_code?: string }) => void;
    onSaveReqDetailTable?: (detail: any) => Promise<void>;
    onSaveSrsReqTable?: (table: TableData) => Promise<any[] | void>;
    onSaveOtherReqTable?: (table: TableData) => Promise<TreeNode[] | any[] | void>;
    onSaveSrsChangeReqTable?: (tableData: TableDataWithHeaders) => Promise<TreeNode[] | undefined>;
    srsReqPreview?: {
        main: any[];
        other: any[];
        changes: Array<{ id: number | string; title: string; data: any[] }>;
    };
    reqDetails?: any[];
    srsReqLoading?: boolean;
    onNodesSnapshot?: (nodes: TreeNode[]) => void;
    enableStandardReqAutoSync?: boolean;
    // 左目录顶部的额外入口（如封面、文件修订记录），选中后右侧渲染其 content
    extraNavSections?: { key: string; title: string; content: ReactNode }[];
    // 左目录底部“添加根章节”按钮的回调（由父组件提供，复用其新增根节点逻辑）
    onAddRoot?: () => void;
}

export default ({ value = [], onChange, docId, productId, docVersion, productVersion, hiddenNodeIds = [], readOnly, rcmOptions, onNodeDelete, onOpenSrsTable, onOpenReqList, onEditSrsChangeTable, onDeleteSrsChangeTable, onSaveReqDetailTable, onSaveSrsReqTable, onSaveOtherReqTable, onSaveSrsChangeReqTable, srsReqPreview, reqDetails, srsReqLoading, onNodesSnapshot, enableStandardReqAutoSync = false, extraNavSections = [], onAddRoot }: TreeStructureProps) => {
    const { t: ts } = useTranslation();
    const [nodes, setNodes] = useState<TreeNode[]>(value);
    // 注意：srsReqPreview 在父组件里是每次渲染都新建的字面量对象 ({main, other, changes})，
    // 直接用对象引用比较会"永远不等"，导致每次 onChange 都把 demand 同步链路重新跑一遍，
    // 副作用就是普通表保存后 7 章节被重建。
    // 这里改成记录其内部稳定引用（main/other/changes 数组本身、reqDetails 本身、enableStandardReqAutoSync 标记），
    // 只有真正的 demand 数据来源发生变化时才跑 demand 同步。
    const reqSyncSourceRef = useRef<{
        reqDetails?: any[];
        srsReqPreviewMain?: any[];
        srsReqPreviewOther?: any[];
        srsReqPreviewChanges?: any[];
        enableStandardReqAutoSync?: boolean;
    }>({});
    const [tableModalVisible, setTableModalVisible] = useState(false);
    const [showReqTableHint, setShowReqTableHint] = useState(false);
    const [currentNodeId, setCurrentNodeId] = useState<number | null>(null);
    const [initialTableData, setInitialTableData] = useState<TableDataWithHeaders | undefined>(undefined);
    const [tableCellsBackup, setTableCellsBackup] = useState<TableData["cells"] | undefined>(undefined);
    const [lockedTableRowLabels, setLockedTableRowLabels] = useState<string[]>([]);
    // 左目录 + 右单章 布局：当前选中的节点 id 与目录折叠集合（仅展示层，不影响数据）
    const [activeNodeId, setActiveNodeId] = useState<string | number | null>(null);
    const [navCollapsedIds, setNavCollapsedIds] = useState<Set<string>>(new Set());
    const toggleNavCollapse = (id: string | number) => {
        setNavCollapsedIds((prev) => {
            const next = new Set(prev);
            const key = String(id);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    const syncRcmCodesFromText = (nodeList: TreeNode[]): TreeNode[] => {
        return (nodeList || []).map((node) => {
            const children = syncRcmCodesFromText(node.children || []);
            // 仅对“本就具备 RCM 选择能力”的节点进行文本回填，避免误开更多 RCM 控件
            if (!Array.isArray(node.rcm_codes)) {
                return { ...node, children };
            }
            const extracted = extractRcmCodesFromText(node.text);
            if (extracted.length === 0) {
                return { ...node, children };
            }
            const current = (node.rcm_codes || []).map((c) => normalizeRcmCode(c));
            const merged = Array.from(new Set([...current, ...extracted])).filter(Boolean);
            return { ...node, rcm_codes: merged, children };
        });
    };

    const normalizeSrsCode = (value?: string) => String(value || "").replace(/\s+/g, "").toUpperCase();
    const normalizeTitleText = (value?: string) => normalizeReqDisplayText(value).replace(/\s+/g, "");
    const FIXED_TEMPLATE_SECTIONS: Record<string, string> = {
        "2.1": "软件总体描述",
        "2.2": "物理拓扑图",
        "2.3": "系统结构图",
        "2.4": "运行环境",
        "2.5": "数据库要求",
        "2.6": "算法和数据要求",
        "2.7": "性能要求",
    };
    const isCodeCompatibleWithFixedSection = (code?: string, headingNo?: string) => {
        const normalized = normalizeSrsCode(code);
        if (!normalized || !headingNo) return false;
        const chapterMajor = headingNo.split(".")[0];
        if (chapterMajor === "2") {
            return /^SRS-RCN30[02]-/i.test(normalized);
        }
        return true;
    };
    const extractSrsCodeFromNodeText = (text?: string) => {
        const matched = String(text || "").match(/SRS-[A-Z]+\d+-\d+/i);
        return matched?.[0] || "";
    };
    const resolveFixedSectionSrsCode = (node: TreeNode, headingNo: string, otherReqCode?: string) => {
        const normalizedOther = normalizeSrsCode(otherReqCode || "");
        if (normalizedOther) return normalizedOther;
        const candidates = [node.srs_code ?? undefined, extractSrsCodeFromNodeText(node.text)]
            .map((value) => normalizeSrsCode(value))
            .filter(Boolean);
        return candidates.find((code) => isCodeCompatibleWithFixedSection(code, headingNo)) || "";
    };
    const isImportedCatalogTitle = (title?: string) => /^\d+(?:\.\d+)*\s+\S.*\s+\d+$/.test(String(title || "").trim());
    const getReqCodeFamily = (code?: string) => {
        const matched = normalizeSrsCode(code).match(/^(SRS-[A-Z]+\d+)-/);
        return matched?.[1] || "";
    };
    const buildReqDetailTable = (detail: any): TableData => {
        const leftCode = "field";
        const rightCode = "value";
        const reqDetailKey = normalizeReqDetailKey(detail?.req_detail_key || detail?.[REQ_DETAIL_KEY_FIELD]);
        const rows = [
            { [leftCode]: "需求编号", [rightCode]: detail?.code || "" },
            { [leftCode]: "需求名称", [rightCode]: detail?.name || detail?.module || detail?.function || detail?.sub_function || "" },
            { [leftCode]: "需求概述", [rightCode]: normalizeReqDetailNumberedText(detail?.overview || "", "需求概述") },
            { [leftCode]: "主参加者", [rightCode]: detail?.participant || "" },
            { [leftCode]: "前置条件", [rightCode]: normalizeReqDetailNumberedText(detail?.pre_condition || "", "前置条件") },
            { [leftCode]: "触发器", [rightCode]: normalizeReqDetailNumberedText(detail?.trigger || "", "触发器") },
            { [leftCode]: "事件流", [rightCode]: normalizeReqDetailNumberedText(detail?.work_flow || "", "事件流") },
            { [leftCode]: "后置条件", [rightCode]: normalizeReqDetailNumberedText(detail?.post_condition || "", "后置条件") },
            { [leftCode]: "异常情况", [rightCode]: normalizeReqDetailNumberedText(detail?.exception || "", "异常情况") },
            { [leftCode]: "约束", [rightCode]: normalizeReqDetailNumberedText(detail?.constraint || "", "约束") },
        ];
        const keyedRows = reqDetailKey
            ? rows.map((row) => ({ ...row, [REQ_DETAIL_KEY_FIELD]: reqDetailKey }))
            : rows;
        return {
            show_header: 0,
            ...(reqDetailKey ? { req_detail_key: reqDetailKey } : {}),
            headers: [
                { code: leftCode, name: "字段" },
                { code: rightCode, name: "内容" },
            ],
            rows: keyedRows,
        };
    };
    const normalizeFunctionalHeaderToRow = (table: TableData | null | undefined): TableData | null | undefined => {
        if (!table || !Array.isArray(table.headers) || table.headers.length !== 2) return table;
        const leftHeader = table.headers[0];
        const rightHeader = table.headers[1];
        const leftName = normalizeCellText(leftHeader?.name);
        const rightName = String(rightHeader?.name || "").trim();
        if (!leftName.includes("需求编号") || !/^SRS-/i.test(rightName)) return table;
        const firstRow = {
            [leftHeader.code]: leftHeader.name || "需求编号",
            [rightHeader.code]: rightName,
        };
        const rows = [firstRow, ...(table.rows || [])];
        return {
            ...table,
            headers: [
                { ...leftHeader, name: "字段" },
                { ...rightHeader, name: "内容" },
            ],
            rows,
            cells: undefined,
        };
    };
    const buildAutoNode = (title: string, parent: TreeNode, extra: Partial<TreeNode> = {}): TreeNode => ({
        id: Date.now() + Math.floor(Math.random() * 100000),
        doc_id: docId,
        n_id: 0,
        p_id: parent.n_id || 0,
        title,
        srs_code: null,
        rcm_codes: null,
        text: "",
        label: "__auto_req_group",
        table: null,
        children: [],
        ...extra,
    });
    const getNextChildNo = (children: TreeNode[], prefix: string) => children.reduce((max, child) => {
        const escaped = prefix.replace(/\./g, "\\.");
        const matched = String(child.title || "").trim().match(new RegExp(`^${escaped}\\.(\\d+)`));
        return matched ? Math.max(max, parseInt(matched[1], 10)) : max;
    }, 0) + 1;
    const findChildByTitleText = (children: TreeNode[], prefix: string, titleText: string) => {
        const normalizedText = normalizeTitleText(titleText);
        return (children || []).find((child) => {
            const title = String(child.title || "").trim();
            return title.startsWith(`${prefix}.`) && normalizeTitleText(title.replace(/^\d+(?:\.\d+)*\s*/, "")) === normalizedText;
        });
    };
    const findExistingModuleNode = (items: TreeNode[], moduleText: string): TreeNode | undefined => {
        const normalizedText = normalizeTitleText(moduleText);
        if (!normalizedText) return undefined;
        let fallbackInReqRoot: TreeNode | undefined;
        const walk = (nodes: TreeNode[], rootHeading = ""): TreeNode | undefined => {
            for (const node of nodes || []) {
                const title = String(node.title || "").trim();
                const heading = title.match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
                const currentRootHeading = rootHeading || heading.split(".")[0] || "";
                const titleText = normalizeTitleText(title.replace(/^\d+(?:\.\d+)*\s*/, ""));
                const isHeading = !!heading;
                const isAutoReqDetail = node.label === "__auto_req_detail";
                if (isHeading && titleText === normalizedText && !isImportedCatalogTitle(title) && !isAutoReqDetail) {
                    if (currentRootHeading !== "7") {
                        return node;
                    }
                    fallbackInReqRoot = fallbackInReqRoot || node;
                }
                const found = walk(node.children || [], currentRootHeading);
                if (found) return found;
            }
            return undefined;
        };
        return walk(items || []) || fallbackInReqRoot;
    };
    const hasFunctionalDetailCodeFamily = (node: TreeNode, family: string): boolean => {
        if (isFunctionalKvTable(node.table) && getReqCodeFamily(extractSrsCodeFromTable(node.table)) === family) {
            return true;
        }
        return (node.children || []).some((child) => hasFunctionalDetailCodeFamily(child, family));
    };
    const findRootByCodeFamily = (items: TreeNode[], code?: string, ancestors: TreeNode[] = []): TreeNode | undefined => {
        const family = getReqCodeFamily(code);
        if (!family) return undefined;
        for (const node of items || []) {
            const nextAncestors = [...ancestors, node];
            if (getHeadingDepth(node.title) === 1 && hasFunctionalDetailCodeFamily(node, family)) {
                return node;
            }
            if (getReqCodeFamily(node.srs_code || "") === family) {
                return nextAncestors.find((item) => getHeadingDepth(item.title) === 1);
            }
            const found = findRootByCodeFamily(node.children || [], code, nextAncestors);
            if (found) return found;
        }
        return undefined;
    };
    const findRootByTitleText = (items: TreeNode[], titleText?: string): TreeNode | undefined => {
        const normalizedText = normalizeTitleText(titleText || "");
        if (!normalizedText) return undefined;
        return (items || []).find((node) => (
            getHeadingDepth(node.title) === 1 &&
            normalizeTitleText(stripHeadingNumber(node.title)) === normalizedText
        ));
    };
    const findReqDetailRoot = (items: TreeNode[]): TreeNode | undefined => {
        for (const node of items || []) {
            const title = String(node.title || "").trim();
            const heading = title.match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
            if (heading === "7") return node;
        }
        return (items || []).find((node) => (
            getHeadingDepth(node.title) === 1 &&
            /需求/.test(stripHeadingNumber(node.title))
        ));
    };
    const filterReqTableRows = (table: TableData | null | undefined, detailMap: Map<string, any>) => {
        if (!table || !Array.isArray(table.rows)) return table;
        if (isReqMainTable(table) || isReqOtherTable(table)) return table;
        const hasReqCodes = (table.rows || []).some((row) => !!extractSrsCodeFromTableRow(row));
        const cellBodyRows = Array.isArray(table.cells) ? table.cells.slice(1) : [];
        const hasCellReqCodes = cellBodyRows.some((row) => !!extractSrsCodeFromCellRow(row));
        if (!hasReqCodes && !hasCellReqCodes) return table;

        const keepIndexes: number[] = [];
        const nextRows = (table.rows || []).filter((row, index) => {
            const rowCode = extractSrsCodeFromTableRow(row) || extractSrsCodeFromCellRow(cellBodyRows[index] || []);
            const keep = !rowCode || detailMap.has(rowCode);
            if (keep) keepIndexes.push(index);
            return keep;
        });
        const nextCells = Array.isArray(table.cells) && table.cells.length > 1
            ? [table.cells[0], ...keepIndexes.map((idx) => table.cells![idx + 1]).filter(Boolean)]
            : table.cells;
        return {
            ...table,
            rows: nextRows,
            ...(nextCells ? { cells: nextCells } : {}),
        };
    };
    const updateReqIdentityInFunctionalTable = (table: TableData | null | undefined, detail: any): TableData | null | undefined => {
        const nextCode = normalizeSrsCode(detail?.code || "");
        const nextName = String(detail?.name || detail?.sub_function || detail?.function || detail?.module || "").trim();
        const nextReqDetailKey = normalizeReqDetailKey(detail?.req_detail_key || detail?.[REQ_DETAIL_KEY_FIELD]);
        if (!table || !isFunctionalKvTable(table) || (!nextCode && !nextName)) return table;
        const leftCode = table.headers?.[0]?.code;
        const rightCode = table.headers?.[1]?.code;
        if (!leftCode || !rightCode) return table;
        const nextHeaders = (table.headers || []).map((header, index) => (
            index === 1 && normalizeCellText(table.headers?.[0]?.name).includes("需求编号")
                ? { ...header, name: nextCode }
                : header
        ));
        const nextRows = (table.rows || []).map((row) => {
            const label = normalizeCellText(String(row?.[leftCode] || ""));
            const withKey = nextReqDetailKey ? { ...row, [REQ_DETAIL_KEY_FIELD]: nextReqDetailKey } : row;
            if (nextCode && label.includes("需求编号")) return { ...withKey, [rightCode]: nextCode };
            if (nextName && label.includes("需求名称")) return { ...withKey, [rightCode]: nextName };
            return withKey;
        });
        const nextCells = Array.isArray(table.cells)
            ? table.cells.map((row) => (row || []).map((cell, index) => {
                if (!cell || index !== 1) return cell;
                const leftCell = row?.[0];
                const label = normalizeCellText(String((leftCell as any)?.value || ""));
                if (nextCode && label.includes("需求编号")) return { ...cell, value: nextCode };
                if (nextName && label.includes("需求名称")) return { ...cell, value: nextName };
                return cell;
            }))
            : table.cells;
        return {
            ...table,
            ...(nextReqDetailKey ? { req_detail_key: nextReqDetailKey } : {}),
            headers: nextHeaders,
            rows: nextRows,
            ...(nextCells ? { cells: nextCells } : {}),
        };
    };
    const matchReqDetailByHierarchy = (node: TreeNode, ancestors: TreeNode[], standardDetails: any[] = []) => {
        const titles = [...ancestors, node].map((item) => normalizeTitleText(stripHeadingNumber(item.title))).filter(Boolean);
        const current = titles[titles.length - 1] || "";
        const parent = titles[titles.length - 2] || "";
        const grandParent = titles[titles.length - 3] || "";
        return (standardDetails || []).find((detail: any) => {
            const moduleText = normalizeTitleText(detail?.module);
            const functionText = normalizeTitleText(detail?.function || detail?.name);
            const subFunctionText = normalizeTitleText(detail?.sub_function);
            if (subFunctionText && current === subFunctionText && parent === functionText && grandParent === moduleText) return true;
            if (functionText && current === functionText && parent === moduleText) return true;
            return !functionText && moduleText && current === moduleText;
        });
    };
    const matchReqDetailByCurrentCode = (node: TreeNode, standardDetails: any[] = []) => {
        const currentCode = normalizeSrsCode(node.srs_code || extractSrsCodeFromTable(node.table));
        if (!currentCode) return undefined;
        return (standardDetails || []).find((detail: any) => normalizeSrsCode(detail?.code) === currentCode);
    };
    const extractReqNameFromFunctionalTable = (table: TableData | null | undefined) => {
        if (!table || !isFunctionalKvTable(table)) return "";
        const normalizedTable = normalizeFunctionalHeaderToRow(table);
        const leftCode = normalizedTable?.headers?.[0]?.code;
        const rightCode = normalizedTable?.headers?.[1]?.code;
        if (!leftCode || !rightCode) return "";
        const reqNameRow = (normalizedTable?.rows || []).find((row) => (
            normalizeCellText(String(row?.[leftCode] || "")).includes("需求名称")
        ));
        return normalizeTitleText(String(reqNameRow?.[rightCode] || ""));
    };
    const matchReqDetailByTableName = (node: TreeNode, ancestors: TreeNode[], standardDetails: any[] = []) => {
        const reqName = extractReqNameFromFunctionalTable(node.table);
        if (!reqName) return undefined;
        const parent = normalizeTitleText(stripHeadingNumber(ancestors[ancestors.length - 1]?.title));
        return (standardDetails || []).find((detail: any) => {
            const moduleText = normalizeTitleText(detail?.module);
            const functionText = normalizeTitleText(detail?.function || detail?.name);
            const subFunctionText = normalizeTitleText(detail?.sub_function);
            const nameText = normalizeTitleText(detail?.name);
            const nameMatched = reqName === subFunctionText || reqName === functionText || reqName === nameText;
            if (!nameMatched) return false;
            return !parent || parent === moduleText || parent === functionText;
        });
    };
    const findFunctionalDetailFromDirectChildren = (items: TreeNode[], standardDetails: any[] = []): any => {
        for (const child of items || []) {
            if (isFunctionalKvTable(child.table)) {
                const code = normalizeSrsCode(child.srs_code || extractSrsCodeFromTable(child.table));
                const matched = code
                    ? (standardDetails || []).find((detail: any) => normalizeSrsCode(detail?.code) === code)
                    : undefined;
                if (matched) return matched;
            }
        }
        return undefined;
    };
    const hasDirectFunctionalTable = (items: TreeNode[] = []) => (
        (items || []).some((child) => isFunctionalKvTable(child.table))
    );
    const isAlgorithmReqTitle = (value?: string) => {
        const text = normalizeTitleText(stripHeadingNumber(value));
        return text.includes("算法和数据要求") || text.includes("算法需求");
    };
    const syncImportedReqDetailCodes = (items: TreeNode[], standardDetails: any[] = [], ancestors: TreeNode[] = []): TreeNode[] => {
        if (!standardDetails.length) return items || [];
        const parentTitle = normalizeTitleText(stripHeadingNumber(ancestors[ancestors.length - 1]?.title));
        const orderedParentDetails = parentTitle
            ? (standardDetails || []).filter((detail: any) => normalizeTitleText(detail?.module) === parentTitle)
            : [];
        let functionalSiblingIndex = 0;
        const syncedItems: Array<TreeNode | null> = (items || []).map((node): TreeNode | null => {
            let children = syncImportedReqDetailCodes(node.children || [], standardDetails, [...ancestors, node]);
            if (isAlgorithmReqTitle(node.title) || ancestors.some((item) => isAlgorithmReqTitle(item.title))) {
                return { ...node, children };
            }
            const matched = node.label !== "__auto_req_detail" && isFunctionalKvTable(node.table)
                ? (matchReqDetailByCurrentCode(node, standardDetails) || matchReqDetailByTableName(node, ancestors, standardDetails) || matchReqDetailByHierarchy(node, ancestors, standardDetails))
                : undefined;
            const headingDepth = getHeadingDepth(node.title);
            const directFunctionalTable = hasDirectFunctionalTable(children);
            const isFunctionalCarrier = isFunctionalKvTable(node.table) || directFunctionalTable;
            const orderMatched = !matched && node.label !== "__auto_req_detail" && headingDepth >= 3 && isFunctionalCarrier
                ? orderedParentDetails[functionalSiblingIndex]
                : undefined;
            if (isFunctionalCarrier) {
                functionalSiblingIndex += 1;
            }
            const childMatched = !matched && !orderMatched && node.label !== "__auto_req_detail" && headingDepth >= 3
                ? findFunctionalDetailFromDirectChildren(children, standardDetails)
                : undefined;
            const effectiveMatched = matched || orderMatched;
            if (node.label !== "__auto_req_detail" && headingDepth >= 3 && isFunctionalCarrier && !effectiveMatched && !childMatched) {
                return null;
            }
            if (effectiveMatched && directFunctionalTable) {
                children = children.map((child) => isFunctionalKvTable(child.table)
                    ? {
                        ...child,
                        srs_code: normalizeSrsCode(effectiveMatched?.code || child.srs_code || ""),
                        table: updateReqIdentityInFunctionalTable(child.table, effectiveMatched),
                    }
                    : child
                );
            }
            const titleMatched = effectiveMatched || orderMatched || childMatched;
            const nextCode = normalizeSrsCode(effectiveMatched?.code || "");
            const nextName = String(titleMatched?.name || titleMatched?.sub_function || titleMatched?.function || titleMatched?.module || "").trim();
            const titlePrefix = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*\s+)/)?.[1] || "";
            return {
                ...node,
                ...(nextName && titlePrefix ? { title: `${titlePrefix}${nextName}` } : {}),
                ...(nextCode ? { srs_code: nextCode } : {}),
                table: effectiveMatched ? updateReqIdentityInFunctionalTable(node.table, effectiveMatched) : node.table,
                children,
            };
        });
        return syncedItems.filter((node): node is TreeNode => !!node);
    };

    const stripHeadingNumber = (value?: string) => String(value || "").trim().replace(/^\d+(?:\.\d+)*\s*/, "").trim();
    const getHeadingDepth = (value?: string) => {
        const matched = String(value || "").trim().match(/^(\d+(?:\.\d+)*)\s+/);
        return matched ? matched[1].split(".").length : 0;
    };
    const parseSrsCodeOrder = (code?: string) => {
        const matched = normalizeSrsCode(code).match(/^SRS-([A-Z]+?)(\d+)-(\d+)$/);
        return matched
            ? { prefix: matched[1], group: parseInt(matched[2], 10), index: parseInt(matched[3], 10) }
            : null;
    };
    const compareSrsCodes = (left?: string, right?: string) => {
        const leftOrder = parseSrsCodeOrder(left);
        const rightOrder = parseSrsCodeOrder(right);
        if (!leftOrder || !rightOrder) return 0;
        if (leftOrder.group !== rightOrder.group) return leftOrder.group - rightOrder.group;
        return leftOrder.index - rightOrder.index;
    };
    const minSrsCode = (codes: string[]) => codes.filter(Boolean).sort(compareSrsCodes)[0] || "";
    const getMinFunctionalSrsCode = (node: TreeNode): string => {
        const codes = [
            normalizeSrsCode(node.srs_code || ""),
            isFunctionalKvTable(node.table) ? normalizeSrsCode(extractSrsCodeFromTable(node.table)) : "",
            ...(node.children || []).map((child) => getMinFunctionalSrsCode(child)),
        ];
        return minSrsCode(codes);
    };
    const collectFunctionalSrsCodes = (node: TreeNode): string[] => {
        const codes = [
            normalizeSrsCode(node.srs_code || ""),
            isFunctionalKvTable(node.table) ? normalizeSrsCode(extractSrsCodeFromTable(node.table)) : "",
            ...(node.children || []).flatMap((child) => collectFunctionalSrsCodes(child)),
        ];
        return codes.filter(Boolean);
    };
    const findRootByNearestPreviousCode = (items: TreeNode[], code?: string): TreeNode | undefined => {
        const targetCode = normalizeSrsCode(code);
        if (!parseSrsCodeOrder(targetCode)) return undefined;
        let matchedRoot: TreeNode | undefined;
        let matchedCode = "";
        (items || []).forEach((node) => {
            if (getHeadingDepth(node.title) !== 1) return;
            collectFunctionalSrsCodes(node).forEach((itemCode) => {
                if (compareSrsCodes(itemCode, targetCode) >= 0) return;
                if (!matchedCode || compareSrsCodes(itemCode, matchedCode) > 0) {
                    matchedCode = itemCode;
                    matchedRoot = node;
                }
            });
        });
        return matchedRoot;
    };
    const replaceHeadingPrefix = (node: TreeNode, oldPrefix: string, newPrefix: string) => {
        const title = String(node.title || "").trim();
        const matched = title.match(/^(\d+(?:\.\d+)*)(?:\s+|(?=\D|$))(.*)$/);
        if (matched && (matched[1] === oldPrefix || matched[1].startsWith(`${oldPrefix}.`))) {
            const suffix = matched[1] === oldPrefix ? "" : matched[1].slice(oldPrefix.length);
            node.title = `${newPrefix}${suffix} ${matched[2]}`.trim();
        }
        (node.children || []).forEach((child) => replaceHeadingPrefix(child, oldPrefix, newPrefix));
    };
    const renumberDirectHeadingChildren = (children: TreeNode[], parentPrefix: string) => {
        const childDepth = parentPrefix.split(".").length + 1;
        let nextNo = 1;
        (children || []).forEach((child) => {
            const matched = String(child.title || "").trim().match(/^(\d+(?:\.\d+)*)(?:\s+|(?=\D|$))/);
            if (!matched || matched[1].split(".").length !== childDepth) return;
            const nextPrefix = `${parentPrefix}.${nextNo}`;
            if (matched[1] !== nextPrefix) {
                replaceHeadingPrefix(child, matched[1], nextPrefix);
            }
            nextNo += 1;
        });
    };
    const sortTreeChildrenBySrsCode = (items: TreeNode[]) => {
        (items || []).forEach((node) => {
            sortTreeChildrenBySrsCode(node.children || []);
            const parentPrefix = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
            if (!parentPrefix || !(node.children || []).length) return;
            node.children = [...(node.children || [])].sort((left, right) => {
                const leftCode = getMinFunctionalSrsCode(left);
                const rightCode = getMinFunctionalSrsCode(right);
                if (!leftCode && !rightCode) return 0;
                if (!leftCode) return -1;
                if (!rightCode) return 1;
                return compareSrsCodes(leftCode, rightCode);
            });
            renumberDirectHeadingChildren(node.children, parentPrefix);
        });
    };
    const collectReqRowsFromTreeTables = (nodeList: TreeNode[]): any[] => {
        const rows: any[] = [];
        const pickColumn = (headers: Array<{ code: string; name: string }>, matcher: (text: string) => boolean) => {
            const header = headers.find((item) => matcher(normalizeCellText(item?.name)));
            return header?.code || "";
        };
        const walk = (items: TreeNode[]) => {
            (items || []).forEach((node) => {
                const table = node.table;
                if (isReqMainTable(table) && Array.isArray(table?.headers) && Array.isArray(table?.rows)) {
                    const headers = table.headers || [];
                    const codeCol = pickColumn(headers, (text) => isReqCodeHeaderText(text));
                    const moduleCol = pickColumn(headers, (text) => text.includes("模块"));
                    const functionCol = pickColumn(headers, (text) => text.includes("功能") && !text.includes("子功能"));
                    const subFunctionCol = pickColumn(headers, (text) => text.includes("子功能"));
                    const lastValues: Record<string, string> = {};
                    (table.rows || []).forEach((row, rowIndex) => {
                        const code = normalizeSrsCode(String(row?.[codeCol] || extractSrsCodeFromTableRow(row) || ""));
                        if (!code || !/^SRS-/i.test(code)) return;
                        const rawModule = normalizeReqDisplayText(row?.[moduleCol]);
                        const rawFunction = normalizeReqDisplayText(row?.[functionCol]);
                        const rawSubFunction = normalizeReqDisplayText(row?.[subFunctionCol]);
                        if (rawModule) {
                            lastValues.module = rawModule;
                            lastValues.function = "";
                            lastValues.sub_function = "";
                        }
                        if (rawFunction) {
                            lastValues.function = rawFunction;
                            lastValues.sub_function = "";
                        }
                        if (rawSubFunction) {
                            lastValues.sub_function = rawSubFunction;
                        }
                        const moduleValue = rawModule || lastValues.module || "";
                        const functionValue = rawFunction || lastValues.function || "";
                        const subFunctionValue = rawSubFunction || lastValues.sub_function || "";
                        rows.push({
                            code,
                            name: subFunctionValue || functionValue || moduleValue,
                            module: moduleValue,
                            function: functionValue,
                            sub_function: subFunctionValue,
                            req_detail_key: getRowReqDetailKey(row),
                            type_code: /变更/.test(String(table.name || node.title || "")) ? "__change_table" : "1",
                            __fromTable: true,
                            __row_index: rowIndex,
                        });
                    });
                }
                if (isReqOtherTable(table) && Array.isArray(table?.headers) && Array.isArray(table?.rows)) {
                    const headers = table.headers || [];
                    const codeCol = pickColumn(headers, (text) => isReqCodeHeaderText(text));
                    const moduleCol = pickColumn(headers, (text) => text.includes("需求模块") || text.includes("模块"));
                    const locationCol = pickColumn(headers, (text) => text.includes("章节") || text.includes("位置"));
                    (table.rows || []).forEach((row) => {
                        const code = normalizeSrsCode(String(row?.[codeCol] || extractSrsCodeFromTableRow(row) || ""));
                        if (!code || !/^SRS-/i.test(code)) return;
                        rows.push({
                            code,
                            name: normalizeReqDisplayText(row?.[moduleCol]),
                            module: normalizeReqDisplayText(row?.[moduleCol]),
                            location: normalizeReqDisplayText(row?.[locationCol]),
                            type_code: "2",
                            __fromTable: true,
                        });
                    });
                }
                walk(node.children || []);
            });
        };
        walk(nodeList || []);
        return rows;
    };
    const pruneStaleAutoReqNodes = (nodeList: TreeNode[], detailMap: Map<string, any>, validReqTitleSet: Set<string>, relocatingAutoCodes: Set<string> = new Set()): TreeNode[] => {
        return (nodeList || [])
            .map((node) => {
                const originalTable = normalizeFunctionalHeaderToRow(node.table);
                const isImportedReqDetailTable = node.label !== "__auto_req_detail" && isFunctionalKvTable(originalTable);
                return {
                    ...node,
                    __originalReqTableCode: extractSrsCodeFromTable(originalTable),
                    __originalIsReqDetailTable: isFunctionalKvTable(originalTable),
                    table: (!enableStandardReqAutoSync && isImportedReqDetailTable)
                        ? originalTable
                        : filterReqTableRows(originalTable, detailMap),
                    children: pruneStaleAutoReqNodes(node.children || [], detailMap, validReqTitleSet, relocatingAutoCodes),
                } as TreeNode & { __originalReqTableCode?: string; __originalIsReqDetailTable?: boolean };
            })
            .filter((node) => {
                const label = String(node.label || "");
                const isReqDetailTableNode = !!node.__originalIsReqDetailTable;
                const code = normalizeSrsCode(node.srs_code || "") || (isReqDetailTableNode ? (node.__originalReqTableCode || extractSrsCodeFromTable(node.table)) : "");
                if (label === "__auto_req_detail" && code && relocatingAutoCodes.has(code)) {
                    return false;
                }
                const detailTypeCode = String(detailMap.get(code)?.type_code || "");
                if (!enableStandardReqAutoSync && label === "__auto_req_detail" && (detailTypeCode === "1" || !detailTypeCode)) {
                    const table = normalizeFunctionalHeaderToRow(node.table);
                    return isFunctionalKvTable(table) || hasRenderableTable(node.table);
                }
                if (!enableStandardReqAutoSync && isReqDetailTableNode && label !== "__auto_req_detail") {
                    return true;
                }
                if ((label === "__auto_req_detail" || isReqDetailTableNode) && code && !detailMap.has(code)) {
                    return false;
                }
                const isEmptyAutoGroup =
                    label === "__auto_req_group" &&
                    !code &&
                    !(node.children || []).length &&
                    !String(node.text || "").trim() &&
                    !hasRenderableTable(node.table);
                return !isEmptyAutoGroup;
            });
    };
    const buildPreviewChangeDetails = () => (srsReqPreview?.changes || [])
        .flatMap((table: any) => (table.data || []).map((item: any) => ({
            code: normalizeSrsCode(item?.srs_code || item?.code || ""),
            name: normalizeReqDisplayText(item?.sub_function || item?.function || item?.module),
            module: normalizeReqDisplayText(item?.module),
            function: normalizeReqDisplayText(item?.function),
            sub_function: normalizeReqDisplayText(item?.sub_function),
            type_code: item?.type_code || table?.type_code || "__change_table",
            req_detail_key: item?.id ? `change_reqd_${item.id}` : "",
            __fromChangeTable: true,
        })))
        .filter((item: any) => item.code);
    const buildPreviewStandardDetails = () => (srsReqPreview?.main || [])
        .map((item: any) => ({
            code: normalizeSrsCode(item?.srs_code || item?.code || ""),
            name: normalizeReqDisplayText(item?.sub_function || item?.function || item?.module),
            module: normalizeReqDisplayText(item?.module),
            function: normalizeReqDisplayText(item?.function),
            sub_function: normalizeReqDisplayText(item?.sub_function),
            type_code: item?.type_code || "1",
            __fromStandardTable: true,
        }))
        .filter((item: any) => item.code);
    const buildPreviewOtherDetails = () => (srsReqPreview?.other || [])
        .map((item: any) => ({
            code: normalizeSrsCode(item?.srs_code || item?.code || ""),
            module: normalizeReqDisplayText(item?.module),
            location: normalizeReqDisplayText(item?.location),
            type_code: item?.type_code || "2",
        }))
        .filter((item: any) => item.code && item.module);
    const syncMissingChangeReqPreviewToTree = (nodeList: TreeNode[]): TreeNode[] => {
        const changeDetails = buildPreviewChangeDetails();
        if (!changeDetails.length) return nodeList || [];
        const cloned: TreeNode[] = JSON.parse(JSON.stringify(nodeList || []));
        const existingCodes = new Set<string>();
        const walkCodes = (items: TreeNode[]) => {
            (items || []).forEach((node) => {
                const code = normalizeSrsCode(node.srs_code || "") ||
                    (isFunctionalKvTable(node.table) ? normalizeSrsCode(extractSrsCodeFromTable(node.table)) : "");
                if (code) existingCodes.add(code);
                walkCodes(node.children || []);
            });
        };
        walkCodes(cloned);
        const appendChangeDetail = (detail: any) => {
            const code = normalizeSrsCode(detail?.code);
            const typeCode = String(detail?.type_code || "");
            if (!code || existingCodes.has(code) || typeCode === "1" || typeCode === "2") return;
            const moduleText = String(detail?.module || detail?.name || detail?.function || code || "").trim() || code;
            const functionText = String(detail?.function || "").trim();
            const subFunctionText = String(detail?.sub_function || "").trim();
            const reqDetailRoot = findReqDetailRoot(cloned);
            if (!reqDetailRoot) return;
            let moduleNode = findExistingModuleNode(cloned, moduleText);
            if (!moduleNode) {
                const rootPrefix = String(reqDetailRoot.title || "").trim().match(/^(\d+)/)?.[1] || "";
                if (!rootPrefix) return;
                reqDetailRoot.children = reqDetailRoot.children || [];
                moduleNode = findChildByTitleText(reqDetailRoot.children, rootPrefix, moduleText);
                if (!moduleNode) {
                    const moduleNo = getNextChildNo(reqDetailRoot.children, rootPrefix);
                    moduleNode = buildAutoNode(`${rootPrefix}.${moduleNo} ${moduleText}`, reqDetailRoot);
                    reqDetailRoot.children = [...reqDetailRoot.children, moduleNode];
                }
            }
            let targetNode = moduleNode;
            if (functionText) {
                const modulePrefix = String(moduleNode.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
                if (modulePrefix) {
                    moduleNode.children = moduleNode.children || [];
                    let functionNode = findChildByTitleText(moduleNode.children, modulePrefix, functionText);
                    if (!functionNode) {
                        const functionNo = getNextChildNo(moduleNode.children, modulePrefix);
                        functionNode = buildAutoNode(`${modulePrefix}.${functionNo} ${functionText}`, moduleNode);
                        moduleNode.children = [...moduleNode.children, functionNode];
                    }
                    targetNode = functionNode;
                }
            }
            if (subFunctionText) {
                const functionPrefix = String(targetNode.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
                if (functionPrefix) {
                    targetNode.children = targetNode.children || [];
                    let subFunctionNode = findChildByTitleText(targetNode.children, functionPrefix, subFunctionText);
                    if (!subFunctionNode) {
                        const subFunctionNo = getNextChildNo(targetNode.children, functionPrefix);
                        subFunctionNode = buildAutoNode(`${functionPrefix}.${subFunctionNo} ${subFunctionText}`, targetNode);
                        targetNode.children = [...targetNode.children, subFunctionNode];
                    }
                    targetNode = subFunctionNode;
                }
            }
            if (getHeadingDepth(targetNode.title) === 1) {
                const rootPrefix = String(targetNode.title || "").trim().match(/^(\d+)/)?.[1] || "";
                if (!rootPrefix) return;
                targetNode.children = targetNode.children || [];
                const detailTitle = String(detail?.name || detail?.function || detail?.sub_function || moduleText || code).trim();
                const detailNo = getNextChildNo(targetNode.children, rootPrefix);
                const detailNode = buildAutoNode(`${rootPrefix}.${detailNo} ${detailTitle}`, targetNode);
                targetNode.children = [...targetNode.children, detailNode];
                targetNode = detailNode;
            }
            targetNode.srs_code = code;
            targetNode.rcm_codes = null;
            targetNode.text = "";
            targetNode.label = "__auto_req_detail";
            targetNode.table = buildReqDetailTable(detail);
            existingCodes.add(code);
        };
        changeDetails.forEach(appendChangeDetail);
        const reqRoot = findReqDetailRoot(cloned);
        if (reqRoot) sortTreeChildrenBySrsCode([reqRoot]);
        return cloned;
    };
    const pruneStaleChangeReqPreviewFromTree = (nodeList: TreeNode[]): TreeNode[] => {
        const changeCodes = new Set(
            buildPreviewChangeDetails().map((item) => normalizeSrsCode(item?.code)).filter(Boolean),
        );
        const standardKeyByCode = new Map<string, string>();
        (srsReqPreview?.main || []).forEach((item: any) => {
            const code = normalizeSrsCode(item?.srs_code || item?.code || "");
            if (code && item?.id) {
                standardKeyByCode.set(code, `reqd_${item.id}`);
            }
        });
        const standardCodes = new Set([
            ...buildPreviewStandardDetails().map((item) => normalizeSrsCode(item?.code)).filter(Boolean),
            ...collectReqRowsFromTreeTables(nodeList || [])
                .filter((item: any) => String(item?.type_code || "1") === "1")
                .map((item: any) => normalizeSrsCode(item?.code))
                .filter(Boolean),
        ]);
        const rebindNodeReqDetailKey = (node: TreeNode, nextKey: string): TreeNode => {
            if (!nextKey) return node;
            const table = node.table;
            let nextTable = table;
            if (isFunctionalKvTable(table) && table?.headers?.length) {
                nextTable = {
                    ...table,
                    req_detail_key: nextKey,
                    rows: (table.rows || []).map((row: any) => ({
                        ...row,
                        [REQ_DETAIL_KEY_FIELD]: nextKey,
                        req_detail_key: nextKey,
                    })),
                };
            }
            return { ...node, req_detail_key: nextKey, table: nextTable };
        };
        const getRootNo = (value?: string) => String(value || "").trim().match(/^(\d+)/)?.[1] || "";
        const getDepth = (value?: string) => {
            const matched = String(value || "").trim().match(/^(\d+(?:\.\d+)*)\s+/);
            return matched ? matched[1].split(".").length : 0;
        };
        const stripHeadingNo = (value?: string) => String(value || "").trim().replace(/^\d+(?:\.\d+)*\s*/, "");
        const isEmptyGeneratedHeading = (node: TreeNode) => (
            getDepth(node?.title) > 1 &&
            normalizeTitleText(stripHeadingNo(node?.title)) !== "要求" &&
            !normalizeReqDisplayText(node?.text) &&
            !node?.img_url &&
            !hasRenderableTable(node?.table) &&
            !isFunctionalKvTable(node?.table) &&
            !(node?.children || []).length
        );
        const walk = (items: TreeNode[], insideReqRoot = false): TreeNode[] => (items || [])
            .map((node) => {
                const nextInsideReqRoot = insideReqRoot || getRootNo(node?.title) === "7";
                let nextNode: TreeNode = {
                    ...node,
                    children: walk(node.children || [], nextInsideReqRoot),
                };
                if (!nextInsideReqRoot) return nextNode;
                const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                const code = normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                const key = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table));
                if (isReqDetailNode && code && standardCodes.has(code) && key.startsWith("change_reqd_")) {
                    const standardKey = standardKeyByCode.get(code);
                    if (standardKey) {
                        nextNode = rebindNodeReqDetailKey(nextNode, standardKey);
                    }
                }
                return nextNode;
            })
            .filter((node) => {
                const nextInsideReqRoot = insideReqRoot || getRootNo(node?.title) === "7";
                if (!nextInsideReqRoot) return true;
                const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                const code = normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                const key = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table));
                if (isReqDetailNode && key.startsWith("change_reqd_") && code && !changeCodes.has(code)) {
                    return standardCodes.has(code);
                }
                if (
                    isReqDetailNode &&
                    node.label === "__auto_req_detail" &&
                    code &&
                    !changeCodes.has(code) &&
                    !standardCodes.has(code)
                ) {
                    // 预览加载中保留已有功能描述，避免误删；加载完成后不在 preview 中的变更章节应清掉
                    // （外部删除变更表后 preview 已刷新，此处若继续保留会导致 7 章节删不掉）
                    if (srsReqLoading) {
                        return isFunctionalKvTable(node.table) || hasRenderableTable(node.table);
                    }
                    return false;
                }
                if ((node.label === "__auto_req_group" || !node.label) && isEmptyGeneratedHeading(node)) return false;
                return true;
            });
        return walk(nodeList || []);
    };
    const syncOtherReqCodesToChapters = (items: TreeNode[], otherDetails: any[] = []): TreeNode[] => (
        syncOtherReqCodesToChaptersFromRows(items, otherDetails, {
            fixedTemplateSections: FIXED_TEMPLATE_SECTIONS,
            resolveSrsCode: (node, headingNo, otherReqCode) => resolveFixedSectionSrsCode(node, headingNo, otherReqCode),
            isCodeCompatible: (code, headingNo) => isCodeCompatibleWithFixedSection(code, headingNo),
        })
    );
    const restoreFixedTemplateSections = (items: TreeNode[], otherDetails: any[] = []) => (
        syncOtherReqCodesToChapters(items, otherDetails)
    );
    const syncChangeReqTablesFromPreview = (items: TreeNode[]): TreeNode[] => {
        const previewTables = srsReqPreview?.changes || [];
        if (!previewTables.length) return items || [];
        const normalizeTitle = (value?: string) => normalizeReqDisplayText(value).replace(/\s+/g, "");
        const getColumnCode = (headers: Array<{ code: string; name: string }>, matcher: (text: string) => boolean) => (
            headers.find((header) => matcher(normalizeCellText(header?.name)))?.code || ""
        );
        return (items || []).map((node) => {
            const table = node.table;
            let nextTable = table;
            // 只判定 table.name / node.title 是否含"变更"，不再用 node.title 是否为"导入表格X"做排除。
            // 旧逻辑会把 Word 导入的变更需求表（title="导入表格6"、table.name="2.0 变更需求列表："）排除掉，
            // 导致弹窗里删除/编辑行后页面 2.1 章节仍展示 srs_node 里旧的原始行。
            if (
                isReqMainTable(table) &&
                /变更/.test(String(table?.name || node.title || ""))
            ) {
                const tableTitle = normalizeTitle(table?.name || node.title || "");
                const matchedPreview = previewTables.find((preview: any) => normalizeTitle(preview?.title) === tableTitle);
                if (matchedPreview) {
                    const headers = table?.headers || [];
                    const codeCol = getColumnCode(headers, (text) => isReqCodeHeaderText(text));
                    const moduleCol = getColumnCode(headers, (text) => text.includes("模块"));
                    const functionCol = getColumnCode(headers, (text) => text.includes("功能") && !text.includes("子功能"));
                    const subFunctionCol = getColumnCode(headers, (text) => text.includes("子功能"));
                    nextTable = {
                        ...table,
                        rows: (matchedPreview.data || []).map((row: any) => ({
                            ...(codeCol ? { [codeCol]: row?.srs_code || row?.code || "" } : {}),
                            ...(moduleCol ? { [moduleCol]: row?.module || "" } : {}),
                            ...(functionCol ? { [functionCol]: row?.function || "" } : {}),
                            ...(subFunctionCol ? { [subFunctionCol]: row?.sub_function || "" } : {}),
                        })),
                        cells: undefined,
                    };
                }
            }
            return {
                ...node,
                table: nextTable,
                children: syncChangeReqTablesFromPreview(node.children || []),
            };
        });
    };
    const syncReqDetailsToTree = (nodeList: TreeNode[], details: any[] = [], preferTreeStandardDetails = false, standardDetailsOverride?: any[]): TreeNode[] => {
        const previewChangeDetails = buildPreviewChangeDetails();
        const shouldSyncStandardReqDetails = enableStandardReqAutoSync || preferTreeStandardDetails || !!standardDetailsOverride?.length;
        const latestStandardDetails = shouldSyncStandardReqDetails ? buildPreviewStandardDetails() : [];
        const previewSyncedNodeList = syncChangeReqTablesFromPreview(nodeList || []);
        const previewOtherDetails = buildPreviewOtherDetails();
        const tableOtherDetails = collectReqRowsFromTreeTables(previewSyncedNodeList || [])
            .filter((detail: any) => String(detail?.type_code || "") === "2");
        const mergedOtherDetails = mergeOtherReqDetailsForSync(previewOtherDetails, tableOtherDetails);
        const syncedEmbeddedTable = syncEmbeddedOtherReqTableInTree(previewSyncedNodeList, mergedOtherDetails);
        const syncedNodeList = syncOtherReqCodesToChapters(syncedEmbeddedTable, mergedOtherDetails);
        const tableDetails = collectReqRowsFromTreeTables(syncedNodeList || []);
        const changeTableDetails = tableDetails
            .filter((detail: any) => {
                const typeCode = String(detail?.type_code || "");
                return typeCode && !["1", "2"].includes(typeCode);
            })
            .map((detail: any) => ({ ...detail, __fromChangeTable: true }));
        const nonChangeTableDetails = tableDetails.filter((detail: any) => {
            const typeCode = String(detail?.type_code || "");
            return !typeCode || ["1", "2"].includes(typeCode);
        }).map((detail: any) => ({ ...detail, __fromStandardTable: String(detail?.type_code || "1") === "1" }));
        const treeStandardDetails = nonChangeTableDetails.filter((detail: any) => String(detail?.type_code || "1") === "1");
        const standardTableDetails = standardDetailsOverride?.length
            ? standardDetailsOverride
            : (preferTreeStandardDetails && treeStandardDetails.length > 0
                ? treeStandardDetails
                : (latestStandardDetails.length > 0 ? latestStandardDetails : treeStandardDetails));
        const nodeListForReqDetails = enableStandardReqAutoSync
            ? syncedNodeList
            : (shouldSyncStandardReqDetails ? syncImportedReqDetailCodes(syncedNodeList, standardTableDetails) : syncedNodeList);
        // 编辑 SRS 变更表后，以接口返回的最新数据为准；导入文档里的旧变更表行不再参与功能描述生成。
        const effectiveChangeDetails = previewChangeDetails.length > 0 ? previewChangeDetails : changeTableDetails;
        const existingAutoReqCodes = new Set<string>();
        const collectAutoReqCodes = (items: TreeNode[]) => {
            (items || []).forEach((node) => {
                if (node.label === "__auto_req_detail") {
                    const code = normalizeSrsCode(node.srs_code || "") || normalizeSrsCode(extractSrsCodeFromTable(node.table));
                    if (code) existingAutoReqCodes.add(code);
                }
                collectAutoReqCodes(node.children || []);
            });
        };
        collectAutoReqCodes(nodeListForReqDetails || []);
        const changeCodes = new Set(
            effectiveChangeDetails
                .map((detail: any) => normalizeSrsCode(detail?.code))
                .filter(Boolean)
        );
        const standardCodes = new Set(
            [...nonChangeTableDetails, ...standardTableDetails]
                .filter((detail: any) => String(detail?.type_code || "1") === "1")
                .map((detail: any) => normalizeSrsCode(detail?.code))
                .filter(Boolean)
        );
        const relocatingAutoCodes = new Set([...existingAutoReqCodes, ...changeCodes, ...standardCodes]);
        // 同一个 SRS 编号同时存在“需求简表”和“功能描述明细”时，明细字段必须优先保留。
        const combinedDetails = preferTreeStandardDetails
            ? [...latestStandardDetails, ...standardTableDetails, ...nonChangeTableDetails, ...effectiveChangeDetails, ...(details || [])]
            : [...nonChangeTableDetails, ...standardTableDetails, ...latestStandardDetails, ...effectiveChangeDetails, ...(details || [])];
        const detailMap = new Map((combinedDetails || []).map((detail: any) => [normalizeSrsCode(detail?.code), detail]));
        // 功能描述明细可能带有旧的需求名称；标准需求的编号/模块/功能/子功能以 SRS 表最新数据为准，概述等明细字段仍保留。
        (standardTableDetails || []).forEach((detail: any) => {
            const code = normalizeSrsCode(detail?.code);
            if (!code) return;
            const existed = detailMap.get(code) || {};
            detailMap.set(code, {
                ...existed,
                code,
                name: normalizeReqDisplayText(detail?.sub_function || detail?.function || detail?.module),
                module: normalizeReqDisplayText(detail?.module),
                function: normalizeReqDisplayText(detail?.function),
                sub_function: normalizeReqDisplayText(detail?.sub_function),
                type_code: detail?.type_code || existed?.type_code || "1",
            });
        });
        const validReqTitleSet = new Set<string>();
        (combinedDetails || []).forEach((detail: any) => {
            [detail?.name, detail?.module, detail?.function, detail?.sub_function]
                .map((item) => normalizeTitleText(String(item || "")))
                .filter(Boolean)
                .forEach((item) => validReqTitleSet.add(item));
        });
        const standardDetailCodeSet = new Set((standardTableDetails || []).map((detail: any) => normalizeSrsCode(detail?.code)).filter(Boolean));
        const removeMisplacedStandardReqNodes = (items: TreeNode[]): TreeNode[] => (items || [])
            .filter((node) => {
                if (!shouldSyncStandardReqDetails || enableStandardReqAutoSync) return true;
                const depth = getHeadingDepth(node.title);
                const code = normalizeSrsCode(node.srs_code || "") || normalizeSrsCode(extractSrsCodeFromTable(node.table));
                const isStandardReqDetailNode = !!code && standardDetailCodeSet.has(code) && (isFunctionalKvTable(node.table) || (node.children || []).some((child) => isFunctionalKvTable(child.table)));
                // 编辑/导入文档中，标准需求功能描述不允许被错误提升成一级/二级目录。
                return !(isStandardReqDetailNode && depth > 0 && depth < 3);
            })
            .map((node) => ({ ...node, children: removeMisplacedStandardReqNodes(node.children || []) }));
        const cloned = pruneStaleAutoReqNodes((nodeListForReqDetails || []).map((node) => {
            const isAutoReqDetailNode = node.label === "__auto_req_detail";
            const detail = detailMap.get(normalizeSrsCode(node.srs_code || ""));
            const titlePrefix = String(node.title || "").trim().match(/^(\d+\.\d+)\s+/)?.[1];
            const titleText = String(detail?.module || detail?.name || detail?.function || node.srs_code || "").trim();
            return {
                ...node,
                title: isAutoReqDetailNode && titlePrefix && titleText ? `${titlePrefix} ${titleText}` : node.title,
                // 自动补出来的需求章节，明细用下方表格展示，输入框保持空白，样式与导入的功能描述一致。
                text: isAutoReqDetailNode ? "" : node.text,
                table: isAutoReqDetailNode && detail ? buildReqDetailTable(detail) : node.table,
                children: syncReqDetailsToTree(node.children || [], details, preferTreeStandardDetails, standardTableDetails),
            };
        }), detailMap, validReqTitleSet, relocatingAutoCodes);
        const cleanedCloned = removeMisplacedStandardReqNodes(cloned);
        const existingCodes = new Set<string>();
        const walkCodes = (items: TreeNode[]) => {
            (items || []).forEach((node) => {
                const code = normalizeSrsCode(node.srs_code || "") || (isFunctionalKvTable(node.table) ? normalizeSrsCode(extractSrsCodeFromTable(node.table)) : "");
                if (code) existingCodes.add(code);
                walkCodes(node.children || []);
            });
        };
        walkCodes(cleanedCloned);

        const getReqHierarchyKey = (detail: any) => [
            normalizeSrsCode(detail?.code),
            normalizeTitleText(detail?.module),
            normalizeTitleText(detail?.function),
            normalizeTitleText(detail?.sub_function),
        ].join("|");
        const createReqHierarchy = (detail: any, mode: "standard" | "change") => {
            const code = normalizeSrsCode(detail?.code);
            if (mode === "change" && existingCodes.has(code)) return;
            const moduleText = String(detail?.module || detail?.name || detail?.function || code || "").trim() || code;
            const functionText = String(detail?.function || "").trim();
            const subFunctionText = String(detail?.sub_function || "").trim();

            let parent: TreeNode | undefined;
            let moduleNode: TreeNode | undefined;
            const reqDetailRoot = findReqDetailRoot(cleanedCloned);
            moduleNode = findExistingModuleNode(cleanedCloned, moduleText);
            if (!moduleNode) {
                parent = reqDetailRoot;
                if (!parent) return;
                const rootPrefix = String(parent.title || "").trim().match(/^(\d+)/)?.[1] || "";
                if (!rootPrefix) return;
                parent.children = parent.children || [];
                const parentMatchesModule = false;
                moduleNode = parentMatchesModule ? parent : findChildByTitleText(parent.children, rootPrefix, moduleText);
                if (!moduleNode) {
                    const moduleNo = getNextChildNo(parent.children, rootPrefix);
                    moduleNode = buildAutoNode(`${rootPrefix}.${moduleNo} ${moduleText}`, parent);
                    parent.children = [...parent.children, moduleNode];
                }
            }

            let targetNode = moduleNode;
            if (functionText) {
                const modulePrefix = String(moduleNode.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
                if (modulePrefix) {
                    moduleNode.children = moduleNode.children || [];
                    let functionNode = findChildByTitleText(moduleNode.children, modulePrefix, functionText);
                    if (!functionNode) {
                        const functionNo = getNextChildNo(moduleNode.children, modulePrefix);
                        functionNode = buildAutoNode(`${modulePrefix}.${functionNo} ${functionText}`, moduleNode);
                        moduleNode.children = [...moduleNode.children, functionNode];
                    }
                    targetNode = functionNode;
                }
            }

            if (subFunctionText) {
                const functionPrefix = String(targetNode.title || "").trim().match(/^(\d+\.\d+\.\d+)/)?.[1] || "";
                if (functionPrefix) {
                    targetNode.children = targetNode.children || [];
                    let subFunctionNode = findChildByTitleText(targetNode.children, functionPrefix, subFunctionText);
                    if (!subFunctionNode) {
                        const subFunctionNo = getNextChildNo(targetNode.children, functionPrefix);
                        subFunctionNode = buildAutoNode(`${functionPrefix}.${subFunctionNo} ${subFunctionText}`, targetNode);
                        targetNode.children = [...targetNode.children, subFunctionNode];
                    }
                    targetNode = subFunctionNode;
                }
            }

            if (getHeadingDepth(targetNode.title) === 1) {
                const rootPrefix = String(targetNode.title || "").trim().match(/^(\d+)/)?.[1] || "";
                if (!rootPrefix) return;
                targetNode.children = targetNode.children || [];
                const detailTitle = String(detail?.name || detail?.function || detail?.sub_function || moduleText || code).trim();
                const detailNo = getNextChildNo(targetNode.children, rootPrefix);
                const detailNode = buildAutoNode(`${rootPrefix}.${detailNo} ${detailTitle}`, targetNode);
                targetNode.children = [...targetNode.children, detailNode];
                targetNode = detailNode;
            }

            targetNode.srs_code = code;
            targetNode.rcm_codes = null;
            targetNode.text = "";
            targetNode.label = "__auto_req_detail";
            targetNode.table = buildReqDetailTable(detail);
            existingCodes.add(code);
        };

        const standardCandidateMap = new Map<string, any>();
        if (enableStandardReqAutoSync && (latestStandardDetails.length > 0 || enableStandardReqAutoSync)) {
            [...nonChangeTableDetails, ...latestStandardDetails].forEach((detail: any) => {
                const code = normalizeSrsCode(detail?.code);
                const detailFromReqd = detailMap.get(code) || {};
                const typeCode = String(detail?.type_code || detailFromReqd?.type_code || "1");
                if (code && typeCode === "1") {
                    standardCandidateMap.set(getReqHierarchyKey(detail), {
                        ...detailFromReqd,
                        ...detail,
                        code,
                        type_code: "1",
                        __fromStandardTable: true,
                    });
                }
            });
            Array.from(standardCandidateMap.values())
                .filter((detail: any) => {
                    const code = normalizeSrsCode(detail?.code);
                    return code && detail?.__fromStandardTable && (enableStandardReqAutoSync || !existingCodes.has(code));
                })
                .forEach((detail: any) => createReqHierarchy(detail, "standard"));
        }

        const changeCandidateMap = new Map<string, any>();
        effectiveChangeDetails.forEach((detail: any) => {
            const code = normalizeSrsCode(detail?.code);
            const detailFromReqd = detailMap.get(code) || {};
            if (code) {
                changeCandidateMap.set(code, {
                    ...detail,
                    ...detailFromReqd,
                    code,
                    type_code: detail?.type_code || detailFromReqd?.type_code,
                    __fromChangeTable: true,
                });
            }
        });
        Array.from(changeCandidateMap.values())
            .filter((detail: any) => {
                const code = normalizeSrsCode(detail?.code);
                const typeCode = String(detail?.type_code || "");
                return code && !existingCodes.has(code) && typeCode !== "1" && typeCode !== "2" && detail?.__fromChangeTable;
            })
            .forEach((detail: any) => createReqHierarchy(detail, "change"));
        if (shouldSyncStandardReqDetails || changeCandidateMap.size > 0) {
            sortTreeChildrenBySrsCode(cleanedCloned);
        }
        return cleanedCloned;
    };

    // 同步外部传入的 value 到内部状态
    useEffect(() => {
        const withRcm = syncRcmCodesFromText(value);
        const previewMain = srsReqPreview?.main;
        const previewOther = srsReqPreview?.other;
        const previewChanges = srsReqPreview?.changes;
        const shouldSyncReqDerivedTree =
            reqSyncSourceRef.current.reqDetails !== reqDetails ||
            reqSyncSourceRef.current.srsReqPreviewMain !== previewMain ||
            reqSyncSourceRef.current.srsReqPreviewOther !== previewOther ||
            reqSyncSourceRef.current.srsReqPreviewChanges !== previewChanges ||
            reqSyncSourceRef.current.enableStandardReqAutoSync !== enableStandardReqAutoSync;
        reqSyncSourceRef.current = {
            reqDetails,
            srsReqPreviewMain: previewMain,
            srsReqPreviewOther: previewOther,
            srsReqPreviewChanges: previewChanges,
            enableStandardReqAutoSync,
        };
        if (!shouldSyncReqDerivedTree) {
            setNodes(withRcm);
            return;
        }
        const previewOtherDetails = buildPreviewOtherDetails();
        const tableOtherDetails = collectReqRowsFromTreeTables(withRcm)
            .filter((item: any) => String(item?.type_code || "") === "2" && normalizeSrsCode(item?.code));
        const otherDetails = previewOtherDetails.length
            ? previewOtherDetails
            : mergeOtherReqDetailsForSync(previewOtherDetails, tableOtherDetails);
        const withEmbeddedTable = otherDetails.length
            ? syncEmbeddedOtherReqTableInTree(withRcm, otherDetails)
            : withRcm;
        const withOtherReqSync = otherDetails.length
            ? syncOtherReqCodesToChapters(withEmbeddedTable, otherDetails)
            : withEmbeddedTable;
        const hasPreviewChangeRows = (srsReqPreview?.changes || []).some((table) => (table.data || []).length > 0);
        // 编辑模式下也要把 preview 中的变更需求表行强制覆盖到树节点（含 title="导入表格X" 这种导入表），
        // 否则保存弹窗里删除/编辑行后，页面 2.1 章节展示的仍是 srs_node 里旧的原始 rows。
        const withChangeTableRowsSynced = syncChangeReqTablesFromPreview(withOtherReqSync);
        const withChangePruned = pruneStaleChangeReqPreviewFromTree(withChangeTableRowsSynced);
        const nextNodes = enableStandardReqAutoSync
            ? syncReqDetailsToTree(withRcm, reqDetails || [])
            : (hasPreviewChangeRows
                ? syncMissingChangeReqPreviewToTree(withChangePruned)
                : withChangePruned);
        setNodes(nextNodes);
    }, [value, reqDetails, srsReqPreview, enableStandardReqAutoSync]);
    // 把组件内部“最新树状态”实时回传给父组件，避免保存时拿到滞后值
    useEffect(() => {
        onNodesSnapshot?.(nodes);
    }, [nodes, onNodesSnapshot]);

    const updateNodes = (newNodes: TreeNode[]) => {
        // 同步回传最新树，避免“刚编辑后立刻保存”拿到旧值
        onNodesSnapshot?.(newNodes);
        setNodes(newNodes);
        onChange?.(newNodes);
    };

    const generateId = () => {
        // 临时ID使用时间戳，实际应由后端返回
        return Date.now() + Math.floor(Math.random() * 1000);
    };

    const findNodeAndUpdate = (
        nodes: TreeNode[],
        targetId: number,
        updateFn: (node: TreeNode) => TreeNode | null
    ): TreeNode[] => {
        return nodes.map(node => {
            if (node.id === targetId) {
                const updated = updateFn(node);
                return updated === null ? node : updated;
            }
            if (node.children && node.children.length > 0) {
                return {
                    ...node,
                    children: findNodeAndUpdate(node.children, targetId, updateFn)
                };
            }
            return node;
        }).filter(node => node !== null);
    };

    const deleteNode = (nodes: TreeNode[], targetId: number): TreeNode[] => {
        return nodes.filter(node => {
            if (node.id === targetId) {
                return false;
            }
            if (node.children && node.children.length > 0) {
                node.children = deleteNode(node.children, targetId);
            }
            return true;
        });
    };

    const handleAdd = (parentId: number) => {
        // 查找父节点以获取其信息
        let parentNode: TreeNode | undefined = undefined;
        const findParent = (nodeList: TreeNode[]): TreeNode | undefined => {
            for (const node of nodeList) {
                if (node.id === parentId) {
                    return node;
                }
                if (node.children && node.children.length > 0) {
                    const found = findParent(node.children);
                    if (found) return found;
                }
            }
            return undefined;
        };
        parentNode = findParent(nodes);

        const newNode: TreeNode = {
            id: generateId(),
            doc_id: parentNode?.doc_id || 0,
            n_id: 0, // 新节点，后端生成
            p_id: parentNode?.n_id || 0, // 使用父节点的n_id
            title: "",
            text: "",
            table: {},
            children: []
        };

        const newNodes = findNodeAndUpdate(nodes, parentId, (node) => ({
            ...node,
            children: [...node.children, newNode]
        }));

        updateNodes(newNodes);
        return newNode.id;
    };

    const handleAddSibling = (targetId: number, position: 'before' | 'after', _defaultTitle: string) => {
        const insertSibling = (list: TreeNode[], parentNode?: TreeNode): TreeNode[] => {
            const idx = list.findIndex((n) => n.id === targetId);
            if (idx >= 0) {
                const sibling = list[idx];
                const newNode: TreeNode = {
                    id: generateId(),
                    doc_id: sibling.doc_id || 0,
                    n_id: 0,
                    p_id: parentNode?.n_id ?? sibling.p_id ?? 0,
                    title: "",
                    srs_code: '',
                    text: '',
                    table: {},
                    children: []
                };
                const insertIndex = position === 'before' ? idx : idx + 1;
                return [
                    ...list.slice(0, insertIndex),
                    newNode,
                    ...list.slice(insertIndex)
                ];
            }
            return list.map((node) => ({
                ...node,
                children: insertSibling(node.children || [], node)
            }));
        };
        const newNodes = insertSibling(nodes, undefined);
        updateNodes(newNodes);
    };

    const handleDelete = async (id: number) => {
        // 查找要删除的节点
        const findNodeById = (nodeList: TreeNode[], targetId: number): TreeNode | undefined => {
            for (const node of nodeList) {
                if (node.id === targetId) return node;
                if (node.children) {
                    const found = findNodeById(node.children, targetId);
                    if (found) return found;
                }
            }
            return undefined;
        };

        const nodeToDelete = findNodeById(nodes, id);

        // 变更需求表节点：节点级"删除"按钮原先只调 delete_srs_node，
        // 不会清理 srs_type / srs_req，导致 fetchSrsTableState 后 srsReqPreview 仍含该表，
        // syncMissingChangeReqPreviewToTree 会把 7 章节里被删需求对应的功能描述节点又补回来。
        // 这里识别到变更需求表节点时，先走 onDeleteSrsChangeTable 把整张变更表清掉（含 7 章节联动），
        // 再让 onNodeDelete 删除 srs_node。
        const candidateTitle = String(nodeToDelete?.table?.name || nodeToDelete?.title || nodeToDelete?.label || "").trim();
        const tableMeta: any = nodeToDelete?.table || null;
        const isChangeReqNode = !!(
            tableMeta &&
            typeof tableMeta === "object" &&
            /变更/.test(candidateTitle) &&
            (
                (Array.isArray(tableMeta.headers) && tableMeta.headers.length > 0) ||
                (Array.isArray(tableMeta.rows) && tableMeta.rows.length > 0) ||
                (Array.isArray(tableMeta.cells) && tableMeta.cells.length > 0) ||
                !!String(tableMeta.name || "").trim()
            )
        );
        if (nodeToDelete && isChangeReqNode && onDeleteSrsChangeTable) {
            const nodeTitle = candidateTitle;
            const matchedPreview = (srsReqPreview?.changes || []).find((preview: any) => (
                matchesChangeTableTitle(nodeTitle, preview?.title)
            ));
            const payload = matchedPreview
                ? matchedPreview
                : {
                    id: `node_${nodeToDelete.n_id || nodeToDelete.id}`,
                    title: nodeTitle,
                    type_code: undefined,
                    data: [],
                };
            try {
                // 1) 先把当前 srs_node 删掉，避免下次刷新还能看到这张表节点
                if (nodeToDelete?.n_id && docId && onNodeDelete) {
                    const success = await onNodeDelete(docId, nodeToDelete.n_id);
                    if (!success) return;
                }
                // 2) 再走 onDeleteSrsChangeTable：会清理 srs_type / srs_req / 7 章节联动节点，
                //    并 dispatch 更新父组件的 treeStructure。
                //    这里完成后直接 return，不再让外层 updateNodes(deleteNode(nodes, id))
                //    用 dispatch 之前的旧 nodes 把父组件最新的树覆盖回去。
                await onDeleteSrsChangeTable(payload as any);
            } catch (err) {
                console.error("delete change-req-table failed:", err);
            }
            return;
        }

        // 普通节点：保留原行为
        if (nodeToDelete?.n_id && docId && onNodeDelete) {
            const success = await onNodeDelete(docId, nodeToDelete.n_id);
            if (!success) return; // 删除失败，不更新前端状态
        }

        const newNodes = deleteNode(nodes, id);
        updateNodes(newNodes);
    };

    const handleDeleteFromNav = async (id: number) => {
        const deletingActive = String(activeNodeId) === String(id);
        await handleDelete(id);
        if (deletingActive) {
            setActiveNodeId(null);
        }
    };

    const findNodeById = (nodeList: TreeNode[], targetId: number): TreeNode | undefined => {
        for (const node of nodeList) {
            if (node.id === targetId) return node;
            const found = findNodeById(node.children || [], targetId);
            if (found) return found;
        }
        return undefined;
    };

    const handleTitleChange = (id: number, title: string) => {
        const targetNode = findNodeById(nodes, id);
        if (targetNode && isChapterMetaLockedNode(targetNode, srsReqPreview?.other || [])) {
            return;
        }
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            title
        }));
        updateNodes(newNodes);
    };

    const handleSrsCodeChange = (id: number, srs_code: string) => {
        const targetNode = findNodeById(nodes, id);
        if (targetNode && isChapterMetaLockedNode(targetNode, srsReqPreview?.other || [])) {
            return;
        }
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            srs_code
        }));
        updateNodes(newNodes);
    };

    const handleContentChange = (id: number, text: string, preserveOtherReqCode = false) => {
        const targetNode = findNodeById(nodes, id);
        const nextText = preserveOtherReqCode && targetNode
            ? replaceOtherReqCodeInNodeText(
                text,
                normalizeSrsCodeValue(targetNode.srs_code || extractSrsCodeFromText(targetNode.text) || ""),
            )
            : text;
        const newNodes = findNodeAndUpdate(nodes, id, (node) => {
            if (!Array.isArray(node.rcm_codes)) {
                return {
                    ...node,
                    text: nextText,
                };
            }
            const extracted = extractRcmCodesFromText(nextText);
            const current = (node.rcm_codes || []).map((c) => normalizeRcmCode(c));
            const merged = Array.from(new Set([...current, ...extracted])).filter(Boolean);
            return {
                ...node,
                text: nextText,
                rcm_codes: merged,
            };
        });
        updateNodes(newNodes);
    };

    const handleImageChange = (id: number, img_url: string) => {
        const clearEmbeddedImages = (children: TreeNode[] = []): TreeNode[] => (
            children.map((child) => (
                isEmbeddedImageNode(child)
                    ? { ...child, img_url: "" }
                    : { ...child, children: clearEmbeddedImages(child.children || []) }
            ))
        );
        const updateImageById = (nodeList: TreeNode[]): TreeNode[] => {
            return nodeList.map((node) => {
                const sameNode = String(node.id) === String(id) || String(node.n_id ?? "") === String(id);
                if (sameNode) {
                    const boundType = resolveProductBoundDocImageRefType(node);
                    return {
                        ...node,
                        img_url,
                        ...(boundType && !node.ref_type ? { ref_type: boundType } : {}),
                        ...(boundType ? { children: clearEmbeddedImages(node.children || []) } : {}),
                    };
                }
                if (node.children && node.children.length > 0) {
                    return { ...node, children: updateImageById(node.children) };
                }
                return node;
            });
        };
        updateNodes(updateImageById(nodes));
    };

    // 选择章节 RCM 后，自动拼接“RCM编号 + 详细描述”写入当前节点 text
    const handleRcmSelectChange = (nodeId: number, selectedRcmIds: Array<number | string>) => {
        type SelectedRcmOption = { value: number | string; label: string; description: string };
        const selectedOptions = (selectedRcmIds || []).map((id): SelectedRcmOption | undefined => {
            const matched = rcmOptions.find((o) => o.value === id);
            if (matched) return { value: matched.value, label: matched.label, description: matched.description ?? "" };
            const code = normalizeRcmCode(String(id || ""));
            if (!code) return undefined;
            return { value: id, label: code, description: "" };
        }).filter((o): o is SelectedRcmOption => !!o);

        const nextRcmCodes = selectedOptions.map((o) => normalizeRcmCode(o.label)).filter(Boolean);
        const nextText = selectedOptions
            // 只写详细描述
            .map((o) => o.description ?? "")
            .join("\n");

        const newNodes = findNodeAndUpdate(nodes, nodeId, (node) => ({
            ...node,
            rcm_codes: nextRcmCodes,
            text: nextText,
        }));
        updateNodes(newNodes);
    };

    const handleAddTable = (id: number) => {
        const findNodeById = (list: TreeNode[]): TreeNode | undefined => {
            for (const item of list) {
                if (item.id === id) return item;
                const found = item.children?.length ? findNodeById(item.children) : undefined;
                if (found) return found;
            }
            return undefined;
        };
        const targetNode = findNodeById(nodes);
        const headingNo = getHeadingNumberFromTitle(targetNode?.title);
        // 仅第 2 章小节（2.1、2.2…）的表格添加弹窗显示需求表规则提示
        setShowReqTableHint(/^2\./.test(headingNo));
        setCurrentNodeId(id);
        setTableModalVisible(true);
        setInitialTableData(undefined); // 新增模式，不传初始数据
        setTableCellsBackup(undefined);
    };

    const parseExcelToTables = (file: File): Promise<Array<{ sheetName: string; table: TableData }>> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = event.target?.result;
                    if (!data) {
                        reject(new Error("empty_file"));
                        return;
                    }
                    const workbook = XLSX.read(data, { type: "array" });
                    const sheetNames = workbook.SheetNames || [];
                    if (sheetNames.length === 0) {
                        reject(new Error("empty_sheet"));
                        return;
                    }
                    const tables: Array<{ sheetName: string; table: TableData }> = [];
                    for (const sheetName of sheetNames) {
                        const worksheet = workbook.Sheets[sheetName];
                        const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" }) as any[][];
                        const normalized = matrix.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : []));
                        const validRows = normalized.filter((row) => row.some((cell) => cell !== ""));
                        if (validRows.length < 2) {
                            reject(new Error(`invalid_sheet:${sheetName}`));
                            return;
                        }
                        const [headerRow, ...bodyRows] = validRows;
                        const headers = headerRow.map((name, idx) => ({
                            code: uuidv4(),
                            name: name || `列${idx + 1}`,
                        }));
                        if (headers.length === 0) {
                            reject(new Error(`invalid_header:${sheetName}`));
                            return;
                        }
                        const rows = bodyRows.map((row) => {
                            const rowObj: { [key: string]: string } = {};
                            headers.forEach((header, idx) => {
                                rowObj[header.code] = String(row[idx] ?? "").trim();
                            });
                            return rowObj;
                        });
                        tables.push({ sheetName, table: { headers, rows } });
                    }
                    resolve(tables);
                } catch {
                    reject(new Error("parse_failed"));
                }
            };
            reader.onerror = () => reject(new Error("read_failed"));
            reader.readAsArrayBuffer(file);
        });
    };

    const handleImportTable = async (id: number, file: File) => {
        try {
            const importedTables = await parseExcelToTables(file);
            const insertImportedSheets = (nodeList: TreeNode[], parentNode?: TreeNode): TreeNode[] => {
                const idx = nodeList.findIndex((n) => n.id === id);
                if (idx >= 0) {
                    const target = nodeList[idx];
                    const currentSheet = importedTables[0];
                    const siblingSheets = importedTables.slice(1);
                    const currentNode: TreeNode = {
                        ...target,
                        table: currentSheet.table,
                    };
                    const siblingNodes: TreeNode[] = siblingSheets.map((sheet) => ({
                        id: generateId(),
                        doc_id: target.doc_id || 0,
                        n_id: 0,
                        p_id: parentNode?.n_id ?? target.p_id ?? 0,
                        title: "",
                        ...(("srs_code" in target) ? { srs_code: target.srs_code ?? "" } : {}),
                        text: "",
                        table: sheet.table,
                        children: [],
                    }));
                    return [
                        ...nodeList.slice(0, idx),
                        currentNode,
                        ...siblingNodes,
                        ...nodeList.slice(idx + 1),
                    ];
                }
                return nodeList.map((node) => ({
                    ...node,
                    children: insertImportedSheets(node.children || [], node),
                }));
            };
            const newNodes = insertImportedSheets(nodes);
            updateNodes(newNodes);
            message.success("导入成功");
        } catch {
            message.error("导入失败，请检查Excel内容（首行表头，至少一行数据）");
        }
    };

    const handleEditTable = (id: number) => {
        // 查找节点
        const findNode = (nodeList: TreeNode[], targetId: number): TreeNode | undefined => {
            for (const node of nodeList) {
                if (node.id === targetId) {
                    return node;
                }
                if (node.children && node.children.length > 0) {
                    const found = findNode(node.children, targetId);
                    if (found) return found;
                }
            }
            return undefined;
        };

        const targetNode = findNode(nodes, id);
        if (!targetNode || !targetNode.table) return;

        // 适配新的表头结构：将字符串表头/带code的表头转换为 TableHeaderItem 数组
        const headers = (targetNode.table.headers || []).map(header => {
            // 兼容旧数据（字符串表头）和新数据（{code, name} 表头）
            if (typeof header === 'string') {
                return {
                    code: uuidv4(), // 为旧字符串表头生成新的UUID
                    name: header
                };
            }
            return {
                code: header.code || uuidv4(), // 确保有UUID
                name: header.name || ''
            };
        });

        const rows = targetNode.table.rows || [];
        if (headers.length === 0) return;
        const existingReqDetailKeyByCode = new Map<string, string>();
        const existingReqDetailKeyByCodeOrder = new Map<string, string>();
        const existingReqDetailKeyByComposite = new Map<string, string>();
        const getExistingDetailCompositeKey = (node: TreeNode, ancestors: TreeNode[]) => {
            const headingNames = [...ancestors, node]
                .filter((item) => getHeadingDepth(item.title) > 0)
                .map((item) => normalizeTitleText(stripHeadingNumber(item.title)))
                .filter(Boolean);
            const reqName = extractReqNameFromFunctionalTable(node.table);
            const moduleName = headingNames.length >= 3 ? headingNames[headingNames.length - 3] : (headingNames[0] || "");
            const functionName = headingNames.length >= 3 ? headingNames[headingNames.length - 2] : (headingNames[1] || "");
            const subFunction = headingNames.length >= 3 ? (reqName || headingNames[headingNames.length - 1] || "") : "";
            return [moduleName, functionName, subFunction].join("|");
        };
        const collectExistingReqDetailKeys = (nodeList: TreeNode[], ancestors: TreeNode[] = []) => {
            (nodeList || []).forEach((node) => {
                if (isFunctionalKvTable(node.table)) {
                    const code = normalizeSrsCode(extractSrsCodeFromTable(node.table));
                    const key = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table) || getLegacyReqDetailKeyByCode(code));
                    if (code && key && !existingReqDetailKeyByCode.has(code)) {
                        existingReqDetailKeyByCode.set(code, key);
                    }
                    const orderKey = getSrsCodeOrderKey(code);
                    if (orderKey && key && !existingReqDetailKeyByCodeOrder.has(orderKey)) {
                        existingReqDetailKeyByCodeOrder.set(orderKey, key);
                    }
                    const composite = getExistingDetailCompositeKey(node, ancestors);
                    if (composite.replace(/\|/g, "") && key && !existingReqDetailKeyByComposite.has(composite)) {
                        existingReqDetailKeyByComposite.set(composite, key);
                    }
                }
                collectExistingReqDetailKeys(node.children || [], [...ancestors, node]);
            });
        };
        collectExistingReqDetailKeys(nodes || []);
        const pickColumnCode = (matcher: (text: string) => boolean) => (
            headers.find((header) => matcher(normalizeCellText(header?.name)))?.code || ""
        );
        const codeCol = pickColumnCode((text) => isReqCodeHeaderText(text));
        const moduleCol = pickColumnCode((text) => text.includes("模块"));
        const functionCol = pickColumnCode((text) => text.includes("功能") && !text.includes("子功能"));
        const subFunctionCol = pickColumnCode((text) => text.includes("子功能"));
        const lastValues: Record<string, string> = {};
        const rowCompositeKeys = rows.map((row) => {
            const rawModule = normalizeReqDisplayText(row?.[moduleCol]);
            const rawFunction = normalizeReqDisplayText(row?.[functionCol]);
            const rawSubFunction = normalizeReqDisplayText(row?.[subFunctionCol]);
            if (rawModule) {
                lastValues.module = rawModule;
                lastValues.function = "";
                lastValues.sub_function = "";
            }
            if (rawFunction) {
                lastValues.function = rawFunction;
                lastValues.sub_function = "";
            }
            if (rawSubFunction) {
                lastValues.sub_function = rawSubFunction;
            }
            return [
                normalizeTitleText(rawModule || lastValues.module || ""),
                normalizeTitleText(rawFunction || lastValues.function || ""),
                normalizeTitleText(rawSubFunction || lastValues.sub_function || ""),
            ].join("|");
        });

        const tableData: TableDataWithHeaders = {
            tableName: targetNode.table.name || "",
            headers,
            data: rows.map(row =>
                headers.map(header => row[header.code] || '')
            ),
            rowMeta: rows.map((row, index) => ({
                req_detail_key: getRowReqDetailKey(row) ||
                    existingReqDetailKeyByCode.get(normalizeSrsCode(String(row?.[codeCol] || extractSrsCodeFromTableRow(row)))) ||
                    existingReqDetailKeyByCodeOrder.get(getSrsCodeOrderKey(String(row?.[codeCol] || extractSrsCodeFromTableRow(row)))) ||
                    existingReqDetailKeyByComposite.get(rowCompositeKeys[index]) ||
                    "",
            })),
        };

        setCurrentNodeId(id);
        setInitialTableData(tableData);
        setTableCellsBackup(targetNode.table.cells);
        setLockedTableRowLabels(isFunctionalKvTable(targetNode.table) ? ["需求编号", "需求名称"] : []);
        setTableModalVisible(true);
    };

    const handleDeleteTable = async (id: number) => {
        const findNode = (nodeList: TreeNode[], targetId: number): TreeNode | undefined => {
            for (const node of nodeList) {
                if (node.id === targetId) return node;
                if (node.children?.length) {
                    const found = findNode(node.children, targetId);
                    if (found) return found;
                }
            }
            return undefined;
        };
        const findParentNode = (nodeList: TreeNode[], targetId: number): TreeNode | undefined => {
            for (const node of nodeList) {
                if ((node.children || []).some((child) => child.id === targetId)) {
                    return node;
                }
                const found = findParentNode(node.children || [], targetId);
                if (found) return found;
            }
            return undefined;
        };
        const targetNode = findNode(nodes, id);
        if (isReqDetailProtectedTable(targetNode?.table)) {
            message.error("功能描述表格不允许删除");
            return;
        }
        const parentNode = findParentNode(nodes, id);
        const tableTitle = targetNode
            ? resolveDeletedTableTitle(parentNode, targetNode)
            : "";
        const tableMeta = targetNode?.table;
        const changeTableTitle = renderChangeTableTitle(tableMeta?.name || tableTitle || targetNode?.title);
        const isChangeReqTable = isReqMainTable(tableMeta) && /变更/.test(String(tableMeta?.name || tableTitle || targetNode?.title || ""));
        // 章节内嵌变更需求表：不能只清空 node.table，必须走 onDeleteSrsChangeTable 删除 srs_type/srs_req 并联动清理 7 章节。
        if (isChangeReqTable && onDeleteSrsChangeTable) {
            const matchedChangeTable = findChangeTableForPreview(
                srsReqPreview?.changes || [],
                tableMeta,
                tableTitle || targetNode?.title,
            );
            try {
                await onDeleteSrsChangeTable({
                    ...(matchedChangeTable || {}),
                    id: matchedChangeTable?.id ?? targetNode?.id,
                    title: changeTableTitle,
                    type_code: matchedChangeTable?.type_code,
                    data: (matchedChangeTable?.data || []).length
                        ? (matchedChangeTable?.data || [])
                        : buildChangeRowsFromRenderedTable(tableMeta),
                } as any);
            } catch (err) {
                console.error("delete embedded change-req-table failed:", err);
            }
            return;
        }

        // Word 导入的“导入表格N”承载节点：删除表格时应整节点移除，避免留下空壳四级菜单
        if (isImportedTableCarrierTitle(targetNode?.title)) {
            if (targetNode?.n_id && docId && onNodeDelete) {
                const success = await onNodeDelete(docId, targetNode.n_id);
                if (!success) return;
            }
            let newNodes = deleteNode(nodes, id);
            if (parentNode && tableTitle) {
                newNodes = findNodeAndUpdate(newNodes, parentNode.id, (node) => ({
                    ...node,
                    text: stripTableTitleFromText(node.text, tableTitle),
                }));
            }
            updateNodes(newNodes);
            return;
        }

        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            text: tableTitle ? stripTableTitleFromText(node.text, tableTitle) : node.text,
            table: {},
        }));
        updateNodes(newNodes);
    };

    const handleTableConfirm = async (tableData: TableDataWithHeaders) => {
        if (currentNodeId === null) return;

        const rebuildMergedCells = () => {
            const cells = tableCellsBackup;
            const colCount = tableData.headers.length;
            const rowCount = rows.length;
            const getColumnIndex = (matcher: (text: string) => boolean) => (
                tableData.headers.findIndex((header) => matcher(normalizeCellText(header?.name)))
            );
            const codeColIndex = getColumnIndex((text) => isReqCodeHeaderText(text));
            const moduleColIndex = getColumnIndex((text) => text.includes("模块"));
            const functionColIndex = getColumnIndex((text) => text.includes("功能") && !text.includes("子功能"));
            const subFunctionColIndex = getColumnIndex((text) => text.includes("子功能"));
            const isSrsMainReqTable = codeColIndex >= 0 && moduleColIndex >= 0 && functionColIndex >= 0;
            const buildSrsMainCellsFromRows = () => {
                if (!isSrsMainReqTable || rowCount === 0) return undefined;
                const next = [
                    tableData.headers.map((header) => ({ value: header.name || "", row_span: 1, col_span: 1 })),
                    ...rows.map((row) => tableData.headers.map((header) => ({
                        value: row?.[header.code] || "",
                        row_span: 1,
                        col_span: 1,
                    }))),
                ];
                const getSrsGroup = (value: string) => {
                    const code = normalizeSrsCode(value);
                    return code.match(/^(SRS-[A-Z]+\d+)-\d+$/)?.[1] || code;
                };
                const effectiveRows = rows.map((row, index) => {
                    const prev = index > 0 ? rows[index - 1] : undefined;
                    const rawModule = normalizeReqDisplayText(row?.[tableData.headers[moduleColIndex]?.code]);
                    const rawFunction = normalizeReqDisplayText(row?.[tableData.headers[functionColIndex]?.code]);
                    const rawSubFunction = subFunctionColIndex >= 0
                        ? normalizeReqDisplayText(row?.[tableData.headers[subFunctionColIndex]?.code])
                        : "";
                    const prevEffective = index > 0 ? (rows[index - 1] as any).__effectiveSrsValues : undefined;
                    const currentCode = normalizeReqDisplayText(row?.[tableData.headers[codeColIndex]?.code]);
                    const currentGroup = getSrsGroup(currentCode);
                    const prevGroup = getSrsGroup(String(prevEffective?.code || prev?.[tableData.headers[codeColIndex]?.code] || ""));
                    const sameSrsGroup = !!currentGroup && currentGroup === prevGroup;
                    const moduleValue = rawModule || (sameSrsGroup ? (prevEffective?.module || "") : "");
                    const functionValue = rawFunction || (sameSrsGroup && !rawModule ? (prevEffective?.function || "") : "");
                    const subFunctionValue = rawSubFunction || (sameSrsGroup && !rawModule && !rawFunction ? (prevEffective?.subFunction || "") : "");
                    const effective = {
                        module: moduleValue,
                        function: functionValue,
                        subFunction: subFunctionValue,
                        code: currentCode || normalizeReqDisplayText(prev?.[tableData.headers[codeColIndex]?.code]),
                        group: currentGroup,
                    };
                    (row as any).__effectiveSrsValues = effective;
                    return effective;
                });
                rows.forEach((row) => {
                    delete (row as any).__effectiveSrsValues;
                });
                const effectiveValueAt = (rowIndex: number, colIndex: number) => {
                    if (colIndex === moduleColIndex) return effectiveRows[rowIndex]?.module || "";
                    if (colIndex === functionColIndex) return effectiveRows[rowIndex]?.function || "";
                    if (colIndex === subFunctionColIndex) return effectiveRows[rowIndex]?.subFunction || "";
                    return normalizeReqDisplayText(rows[rowIndex]?.[tableData.headers[colIndex]?.code]);
                };
                const sameSrsGroupAt = (leftIndex: number, rightIndex: number) => (
                    !!effectiveRows[leftIndex]?.group &&
                    effectiveRows[leftIndex]?.group === effectiveRows[rightIndex]?.group
                );
                const mergeColumnByHierarchy = (colIndex: number, parentIndexes: number[]) => {
                    if (colIndex < 0) return;
                    let start = 0;
                    while (start < rowCount) {
                        const startValue = effectiveValueAt(start, colIndex);
                        if (!startValue) {
                            start += 1;
                            continue;
                        }
                        let end = start + 1;
                        while (end < rowCount) {
                            if (!sameSrsGroupAt(start, end)) break;
                            const sameValue = effectiveValueAt(end, colIndex) === startValue;
                            const sameParents = parentIndexes.every((index) => index < 0 || effectiveValueAt(end, index) === effectiveValueAt(start, index));
                            if (!sameValue || !sameParents) break;
                            end += 1;
                        }
                        const span = end - start;
                        if (span > 1) {
                            next[start + 1][colIndex].value = startValue;
                            next[start + 1][colIndex].row_span = span;
                            for (let rowIndex = start + 1; rowIndex < end; rowIndex += 1) {
                                next[rowIndex + 1][colIndex].value = "";
                                next[rowIndex + 1][colIndex].row_span = 0;
                            }
                        }
                        start = end;
                    }
                };
                mergeColumnByHierarchy(moduleColIndex, []);
                mergeColumnByHierarchy(functionColIndex, [moduleColIndex]);
                mergeColumnByHierarchy(subFunctionColIndex, [moduleColIndex, functionColIndex]);
                return next;
            };
            if (isSrsMainReqTable) {
                return buildSrsMainCellsFromRows();
            }
            if (!cells || !Array.isArray(cells) || cells.length < 2) return undefined;
            if (!cells.every((r) => Array.isArray(r) && r.length === colCount)) return undefined;

            const nextHeader = tableData.headers.map((header, index) => ({
                ...(cells[0]?.[index] || {}),
                value: header.name || "",
                row_span: cells[0]?.[index]?.row_span ?? 1,
                col_span: cells[0]?.[index]?.col_span ?? 1,
            }));
            if (cells.length === rowCount + 1) {
                const next = cells.map((r) => r.map((c) => ({ ...c })));
                next[0] = nextHeader;
                for (let r = 0; r < rowCount; r++) {
                    for (let c = 0; c < colCount; c++) {
                        const cell = next[r + 1][c];
                        const rs = cell?.row_span ?? 1;
                        const cs = cell?.col_span ?? 1;
                        if (rs === 0 || cs === 0) continue;
                        next[r + 1][c].value = rows[r]?.[tableData.headers[c]?.code] || "";
                    }
                }
                return next;
            }
            // 行数变化后旧 row_span 无法可靠映射到新行，继续复用会导致 SRS 编号和模块/功能错位。
            // 此时丢弃 cells，让 rows 按当前数据逐行渲染，优先保证内容和行关系正确。
            return undefined;
        };

        // 转换为父组件存储的格式：rows 是对象数组，键为表头name（或code），值为单元格内容
        const rows: { [key: string]: any }[] = tableData.data
            .map((row, rowIndex) => {
                const rowObj: { [key: string]: any } = {};
                tableData.headers.forEach((header, index) => {
                    rowObj[header.code] = row[index] || ''; // 键=code，值=单元格内容
                });
                const reqDetailKey = normalizeReqDetailKey(tableData.rowMeta?.[rowIndex]?.req_detail_key);
                if (reqDetailKey) {
                    rowObj[REQ_DETAIL_KEY_FIELD] = reqDetailKey;
                }
                return rowObj;
            })
            // 过滤掉整行都是空字符串的行
            .filter(row => {
                return Object.values(row).some(value => value.trim() !== '');
            });

        // 如果过滤后没有有效行，或者表头为空，则设置为空对象
        let tableFormat: TableData | null = {};
        if (rows.length > 0 && tableData.headers.length > 0 && tableData.headers.some(h => h.name.trim() !== '')) {
            const mergedCells = rebuildMergedCells();
            tableFormat = {
                name: String(tableData.tableName || "").trim(),
                show_header: 0,
                // 存储完整的表头对象（包含code和name）
                headers: tableData.headers.map(header => ({
                    code: header.code,
                    name: header.name.trim()
                })),
                rows: rows,
                cells: mergedCells,
            };
            if (!isFunctionalKvTable(tableFormat)) {
                delete (tableFormat as any).show_header;
            }
            if (tableCellsBackup && !mergedCells) {
                message.warning("表格结构已变化，合并单元格已按新结构重建。");
            }
        }

        const getReqNameFromTable = () => {
            const leftCode = tableData.headers[0]?.code;
            const rightCode = tableData.headers[1]?.code;
            if (!leftCode || !rightCode) return "";
            const reqNameRow = rows.find((row) => normalizeCellText(row[leftCode]).includes("需求名称"));
            return String(reqNameRow?.[rightCode] || "").trim();
        };
        const replaceTitleName = (title: string, name: string) => {
            const txt = String(title || "").trim();
            const newName = String(name || "").trim();
            if (!newName) return title;
            const matched = txt.match(/^(\d+(?:\.\d+)*\s*)(.*)$/);
            return matched ? `${matched[1]}${newName}` : newName;
        };
        const reqNameFromTable = getReqNameFromTable();
        const buildReqDetailPayload = () => {
            if (!tableFormat || !isFunctionalKvTable(tableFormat)) return undefined;
            const leftCode = tableData.headers[0]?.code;
            const rightCode = tableData.headers[1]?.code;
            if (!leftCode || !rightCode) return undefined;
            const normalizeLabel = (value: string) => normalizeCellText(value).replace(/[\s:：]/g, "");
            const payload: any = {};
            (rows || []).forEach((row) => {
                const label = normalizeLabel(String(row[leftCode] || ""));
                const rawValue = String(row[rightCode] || "");
                const value = normalizeReqDetailNumberedText(rawValue, String(row[leftCode] || ""));
                if (label.includes("需求编号")) payload.code = value.trim();
                else if (label.includes("需求名称")) payload.name = value.trim();
                else if (label.includes("需求概述")) payload.overview = value;
                else if (label.includes("主参加者") || label.includes("参与人")) payload.participant = value;
                else if (label.includes("前置条件")) payload.pre_condition = value;
                else if (label.includes("触发器") || label.includes("触发条件")) payload.trigger = value;
                else if (label.includes("事件流") || label.includes("工作流") || label.includes("工作流程")) payload.work_flow = value;
                else if (label.includes("后置条件")) payload.post_condition = value;
                else if (label.includes("异常情况") || label.includes("异常")) payload.exception = value;
                else if (label.includes("约束") || label.includes("限制")) payload.constraint = value;
            });
            return payload.code ? payload : undefined;
        };
        const reqDetailPayload = buildReqDetailPayload();
        if (reqDetailPayload && onSaveReqDetailTable) {
            await onSaveReqDetailTable(reqDetailPayload);
        }
        const isSavingChangeReqTable = !!(tableFormat && isReqMainTable(tableFormat) && /变更/.test(String(tableFormat.name || tableData.tableName || "")));
        if (isSavingChangeReqTable) {
            const tableLabel = String(tableFormat?.name || tableData.tableName || "变更需求").trim() || "变更需求表";
            const validateMsg = validateChangeReqTableRows(tableData.headers, rows, tableLabel);
            if (validateMsg) {
                throw new Error(validateMsg);
            }
            if (!initialTableData) {
                const normalizeChangeTableNameKey = (value: string) =>
                    String(value || "").replace(/\s+/g, "").replace(/：/g, ":").replace(/:$/, "").trim();
                const newTitleKey = normalizeChangeTableNameKey(tableData?.tableName || tableFormat?.name || "");
                if (newTitleKey) {
                    const isDuplicateChangeTableName = (srsReqPreview?.changes || []).some(
                        (item) => normalizeChangeTableNameKey(item?.title) === newTitleKey
                    );
                    if (isDuplicateChangeTableName) {
                        throw new Error("表名已存在，不允许重复，请修改后重试");
                    }
                }
            }
        }
        if (isSavingChangeReqTable && onSaveSrsChangeReqTable) {
            // 关键：在调用父级保存逻辑前，先把当前手动新增/编辑的变更表节点写入 state 与 ref，
            // 避免父级把"树里已有的这张"当成"缺失变更表"再自动补一张，造成重复。
            const nodesAfterChangeTableApply = findNodeAndUpdate(nodes, currentNodeId, (node) => {
                const isAddingTable = !initialTableData;
                const hasExistingTableInNode = hasRenderableTable(node.table);
                const hasExistingChildTables = (node.children || []).some((child) => hasRenderableTable(child.table));
                if (isAddingTable && (hasExistingTableInNode || hasExistingChildTables)) {
                    const importedIndexes = (node.children || [])
                        .map((child) => String(child.title || "").trim().match(/^导入表格(\d+)$/)?.[1])
                        .filter((item): item is string => !!item)
                        .map((item) => parseInt(item, 10))
                        .filter((item) => Number.isFinite(item));
                    const nextTableIndex = Math.max(0, ...importedIndexes) + 1;
                    const newTableNode: TreeNode = {
                        id: generateId(),
                        doc_id: node.doc_id || docId,
                        n_id: 0,
                        p_id: node.n_id || 0,
                        title: `导入表格${nextTableIndex}`,
                        text: "",
                        table: tableFormat,
                        children: [],
                    };
                    return {
                        ...node,
                        children: [...(node.children || []), newTableNode],
                    };
                }
                return { ...node, table: tableFormat };
            });
            updateNodes(nodesAfterChangeTableApply);
            const explicitTypeCode = String(tableData?.type_code || "").trim();
            const explicitTableId = tableData?.tableId;
            const matchedChangeTable = (!explicitTypeCode && explicitTableId == null)
                ? findChangeTableForPreview(srsReqPreview?.changes || [], tableFormat, tableData.tableName, { allowSingleFallback: false })
                : undefined;
            const syncedTree = await onSaveSrsChangeReqTable({
                ...tableData,
                type_code: explicitTypeCode || matchedChangeTable?.type_code,
                tableId: explicitTableId ?? matchedChangeTable?.id ?? tableData.tableId,
            });
            if (syncedTree?.length) {
                updateNodes(syncedTree);
            }
            setTableCellsBackup(undefined);
            return;
        }
        const isSavingOtherReqTable = !!(tableFormat && isReqOtherTable(tableFormat));
        const isSavingStandardSrsTable = !!(tableFormat && isReqMainTable(tableFormat) && !/变更/.test(String(tableFormat.name || "")));
        if (isSavingStandardSrsTable) {
            const validateMsg = validateStandardSrsTableRows(tableData.headers, rows);
            if (validateMsg) {
                throw new Error(validateMsg);
            }
        }
        const allStandardDetailsForIdentitySync = isSavingStandardSrsTable
            ? collectReqRowsFromTreeTables([{
                id: -1,
                title: tableFormat?.name || "",
                table: tableFormat,
                children: [],
            } as TreeNode]).filter((item: any) => normalizeSrsCode(item?.code))
            : [];
        if (isSavingStandardSrsTable && onSaveSrsReqTable) {
            await onSaveSrsReqTable(tableFormat);
        }
        const getReqDetailKey = (detail: any) => [
            normalizeTitleText(detail?.module),
            normalizeTitleText(detail?.function),
            normalizeTitleText(detail?.sub_function),
        ].join("|");
        const collectDetailsFromEditableTableData = (source?: TableDataWithHeaders) => {
            if (!source?.headers?.length || !source?.data?.length) return [];
            const sourceRows = (source.data || [])
                .map((row, rowIndex) => {
                    const rowObj: { [key: string]: any } = {};
                    (source.headers || []).forEach((header, index) => {
                        rowObj[header.code] = row[index] || "";
                    });
                    const reqDetailKey = normalizeReqDetailKey(source.rowMeta?.[rowIndex]?.req_detail_key);
                    if (reqDetailKey) {
                        rowObj[REQ_DETAIL_KEY_FIELD] = reqDetailKey;
                    }
                    return rowObj;
                })
                .filter((row) => Object.values(row).some((value) => String(value || "").trim() !== ""));
            if (!sourceRows.length) return [];
            return collectReqRowsFromTreeTables([{
                id: -2,
                title: source.tableName || "",
                table: {
                    name: source.tableName || "",
                    headers: source.headers,
                    rows: sourceRows,
                },
                children: [],
            } as TreeNode]).filter((item: any) => normalizeSrsCode(item?.code));
        };
        const getExistingReqDetailKey = (node: TreeNode, ancestors: TreeNode[]) => {
            const headingNames = [...ancestors, node]
                .filter((item) => getHeadingDepth(item.title) > 0)
                .map((item) => normalizeTitleText(stripHeadingNumber(item.title)))
                .filter(Boolean);
            const reqName = extractReqNameFromFunctionalTable(node.table);
            const moduleName = headingNames.length >= 3 ? headingNames[headingNames.length - 3] : (headingNames[0] || "");
            const functionName = headingNames.length >= 3 ? headingNames[headingNames.length - 2] : (headingNames[1] || "");
            const subFunction = headingNames.length >= 3 ? (reqName || headingNames[headingNames.length - 1] || "") : "";
            return [moduleName, functionName, subFunction].join("|");
        };
        const getExistingReqDetailKeyCandidates = (node: TreeNode, ancestors: TreeNode[]) => {
            const headingNames = [...ancestors, node]
                .filter((item) => getHeadingDepth(item.title) > 0)
                .map((item) => normalizeTitleText(stripHeadingNumber(item.title)))
                .filter(Boolean);
            const reqName = extractReqNameFromFunctionalTable(node.table);
            const candidates = new Set<string>();
            const add = (moduleName?: string, functionName?: string, subFunction?: string) => {
                const key = [moduleName || "", functionName || "", subFunction || ""].join("|");
                if (key.replace(/\|/g, "")) candidates.add(key);
            };
            add(...(getExistingReqDetailKey(node, ancestors).split("|") as [string, string, string]));
            for (let index = 0; index < headingNames.length; index += 1) {
                add(headingNames[index], headingNames[index + 1], headingNames[index + 2] || reqName);
                add(headingNames[index], headingNames[index + 1], "");
                add(headingNames[index], "", reqName || headingNames[index + 1]);
                add(headingNames[index], "", "");
            }
            if (reqName && headingNames.length >= 2) {
                add(headingNames[headingNames.length - 2], headingNames[headingNames.length - 1], reqName);
            }
            return Array.from(candidates);
        };
        const collectExistingReqDetailKeys = (list: TreeNode[], ancestors: TreeNode[] = [], keys = new Set<string>()) => {
            (list || []).forEach((node) => {
                const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table) || (node.children || []).some((child) => isFunctionalKvTable(child.table));
                if (isReqDetailNode) {
                    getExistingReqDetailKeyCandidates(node, ancestors).forEach((key) => keys.add(key));
                }
                collectExistingReqDetailKeys(node.children || [], [...ancestors, node], keys);
            });
            return keys;
        };
        const previousStandardDetails = isSavingStandardSrsTable ? collectDetailsFromEditableTableData(initialTableData) : [];
        const getReqStableKey = (detail: any) => normalizeReqDetailKey(detail?.req_detail_key || detail?.[REQ_DETAIL_KEY_FIELD]);
        const previousKeySet = new Set(
            previousStandardDetails
                .map((detail: any) => getReqDetailKey(detail))
                .filter((key: string) => key.replace(/\|/g, ""))
        );
        const previousKeyByCode = new Map<string, string>();
        const previousStableKeyByIndex = new Map<number, string>();
        const previousKeyByIndex = new Map<number, string>();
        const getReqRowIndex = (detail: any, fallback: number) => {
            const rowIndex = Number(detail?.__row_index);
            return Number.isFinite(rowIndex) ? rowIndex : fallback;
        };
        previousStandardDetails.forEach((detail: any, index: number) => {
            const rowIndex = getReqRowIndex(detail, index);
            const code = normalizeSrsCode(detail?.code);
            const key = getReqDetailKey(detail);
            if (code && key.replace(/\|/g, "")) {
                previousKeyByCode.set(code, key);
            }
            const stableKey = getReqStableKey(detail);
            if (stableKey) {
                previousStableKeyByIndex.set(rowIndex, stableKey);
            }
            if (key.replace(/\|/g, "")) {
                previousKeyByIndex.set(rowIndex, key);
            }
        });
        const existingReqDetailKeys = previousKeySet.size > 0
            ? new Set(previousKeySet)
            : collectExistingReqDetailKeys(nodes || []);
        const renamedDetailByPreviousKey = new Map<string, any>();
        const collectExistingReqDetailBindings = (list: TreeNode[]) => {
            const keyByComposite = new Map<string, string>();
            const keyByCode = new Map<string, string>();
            const keyByCodeOrder = new Map<string, string>();
            const usedKeys = new Set<string>();
            const compositeSet = new Set<string>();
            const ensureKey = (node: TreeNode) => {
                const existingCode = normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                const existing = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table) || getLegacyReqDetailKeyByCode(existingCode));
                const key = existing || `reqd_${uuidv4()}`;
                usedKeys.add(key);
                return key;
            };
            const walk = (items: TreeNode[], ancestors: TreeNode[] = []) => {
                (items || []).forEach((node) => {
                    const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table) || (node.children || []).some((child) => isFunctionalKvTable(child.table));
                    if (isReqDetailNode) {
                        const key = ensureKey(node);
                        getExistingReqDetailKeyCandidates(node, ancestors)
                            .filter((candidate) => candidate.replace(/\|/g, ""))
                            .forEach((candidate) => {
                                compositeSet.add(candidate);
                                if (!keyByComposite.has(candidate)) keyByComposite.set(candidate, key);
                            });
                        const code = normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                        if (code && !keyByCode.has(code)) keyByCode.set(code, key);
                        const orderKey = getSrsCodeOrderKey(code);
                        if (orderKey && !keyByCodeOrder.has(orderKey)) keyByCodeOrder.set(orderKey, key);
                    }
                    walk(node.children || [], [...ancestors, node]);
                });
            };
            walk(list || []);
            return { keyByComposite, keyByCode, keyByCodeOrder, usedKeys, compositeSet };
        };
        const initialReqDetailCompositeSet = collectExistingReqDetailBindings(nodes || []).compositeSet;
        const previousDetailKeys = new Set(previousStandardDetails.map((detail: any) => getReqDetailKey(detail)).filter((key: string) => key.replace(/\|/g, "")));
        const allowedStandardDetailsForIdentitySync = allStandardDetailsForIdentitySync.filter((detail: any) => {
            const composite = getReqDetailKey(detail);
            if (!composite.replace(/\|/g, "")) return false;
            return getReqStableKey(detail) ||
                initialReqDetailCompositeSet.has(composite) ||
                !previousDetailKeys.has(composite);
        });
        const standardDetailsForIdentitySync = isSavingStandardSrsTable ? allowedStandardDetailsForIdentitySync : [];
        const ignoredStandardReqCodes = new Set(
            allStandardDetailsForIdentitySync
                .filter((detail: any) => !standardDetailsForIdentitySync.some((item: any) => normalizeSrsCode(item?.code) === normalizeSrsCode(detail?.code)))
                .map((detail: any) => normalizeSrsCode(detail?.code))
                .filter(Boolean)
        );
        const currentKeySet = new Set(
            standardDetailsForIdentitySync
                .map((detail: any) => getReqDetailKey(detail))
                .filter((key: string) => key.replace(/\|/g, ""))
        );
        if (previousKeySet.size > 0) {
            standardDetailsForIdentitySync.forEach((detail: any, index: number) => {
                const rowIndex = getReqRowIndex(detail, index);
                const code = normalizeSrsCode(detail?.code);
                const key = getReqDetailKey(detail);
                const previousKey = code ? previousKeyByCode.get(code) : "";
                const previousKeyAtSameIndex = !getReqStableKey(detail) && previousStandardDetails.length === allStandardDetailsForIdentitySync.length
                    ? previousKeyByIndex.get(rowIndex)
                    : "";
                if (key.replace(/\|/g, "") && previousKeySet.has(key)) {
                    existingReqDetailKeys.add(key);
                }
                // 同编号改名：旧组合键已不存在于新 SRS 表，视为同一需求改名并保留内容。
                if (
                    previousKey &&
                    key.replace(/\|/g, "") &&
                    !currentKeySet.has(previousKey) &&
                    !previousKeySet.has(key)
                ) {
                    existingReqDetailKeys.add(key);
                    renamedDetailByPreviousKey.set(previousKey, detail);
                }
                // 同一旧行同时修改 SRS 编号和功能名称，也应视为旧需求改名/改号；新增行没有旧行号，不复用。
                if (
                    previousKeyAtSameIndex &&
                    key.replace(/\|/g, "") &&
                    !currentKeySet.has(previousKeyAtSameIndex) &&
                    !previousKeySet.has(key)
                ) {
                    existingReqDetailKeys.add(key);
                    renamedDetailByPreviousKey.set(previousKeyAtSameIndex, detail);
                }
            });
        }
        const ensureStableReqDetailKeys = (details: any[], table?: TableData | null) => {
            if (!isSavingStandardSrsTable || !details.length) return;
            const bindings = collectExistingReqDetailBindings(nodes || []);
            const previousKeyByComposite = new Map<string, string>();
            const previousKeyByCodeStrict = new Map<string, string>();
            previousStandardDetails.forEach((detail: any, index: number) => {
                const rowIndex = getReqRowIndex(detail, index);
                const key = getReqStableKey(detail);
                const composite = getReqDetailKey(detail);
                if (key && composite.replace(/\|/g, "")) previousKeyByComposite.set(composite, key);
                const code = normalizeSrsCode(detail?.code);
                if (key && code) previousKeyByCodeStrict.set(code, key);
                const fallbackKey = key ||
                    (composite.replace(/\|/g, "") ? bindings.keyByComposite.get(composite) : "") ||
                    (code ? bindings.keyByCode.get(code) : "") ||
                    (code ? bindings.keyByCodeOrder.get(getSrsCodeOrderKey(code)) : "") ||
                    "";
                if (fallbackKey) {
                    previousStableKeyByIndex.set(rowIndex, fallbackKey);
                }
            });
            const usedKeys = new Set<string>(bindings.usedKeys);
            details.forEach((detail: any) => {
                const composite = getReqDetailKey(detail);
                const code = normalizeSrsCode(detail?.code);
                let stableKey = getReqStableKey(detail) ||
                    previousKeyByComposite.get(composite) ||
                    (previousKeySet.has(composite) ? bindings.keyByComposite.get(composite) : "") ||
                    (previousKeySet.has(composite) && code ? previousKeyByCodeStrict.get(code) : "") ||
                    (previousKeySet.has(composite) && code ? bindings.keyByCodeOrder.get(getSrsCodeOrderKey(code)) : "") ||
                    "";
                if (!stableKey) {
                    do {
                        stableKey = `reqd_${uuidv4()}`;
                    } while (usedKeys.has(stableKey));
                }
                usedKeys.add(stableKey);
                detail.req_detail_key = stableKey;
                detail[REQ_DETAIL_KEY_FIELD] = stableKey;
            });
            const keysByCode = new Map<string, string[]>();
            details.forEach((detail: any) => {
                const code = normalizeSrsCode(detail?.code);
                const key = getReqStableKey(detail);
                if (!code || !key) return;
                const queue = keysByCode.get(code) || [];
                queue.push(key);
                keysByCode.set(code, queue);
            });
            (table?.rows || []).forEach((row) => {
                const code = normalizeSrsCode(extractSrsCodeFromTableRow(row));
                const queue = code ? keysByCode.get(code) : undefined;
                const stableKey = queue?.shift();
                if (stableKey) {
                    row[REQ_DETAIL_KEY_FIELD] = stableKey;
                    row.req_detail_key = stableKey;
                }
            });
        };
        ensureStableReqDetailKeys(allStandardDetailsForIdentitySync, tableFormat);
        const newNodes = findNodeAndUpdate(nodes, currentNodeId, (node) => {
            const isAddingTable = !initialTableData;
            const hasExistingTableInNode = hasRenderableTable(node.table);
            const hasExistingChildTables = (node.children || []).some((child) => hasRenderableTable(child.table));
            if (isAddingTable && (hasExistingTableInNode || hasExistingChildTables)) {
                const importedIndexes = (node.children || [])
                    .map((child) => String(child.title || "").trim().match(/^导入表格(\d+)$/)?.[1])
                    .filter((item): item is string => !!item)
                    .map((item) => parseInt(item, 10))
                    .filter((item) => Number.isFinite(item));
                const nextTableIndex = Math.max(0, ...importedIndexes) + 1;
                const newTableNode: TreeNode = {
                    id: generateId(),
                    doc_id: node.doc_id || docId,
                    n_id: 0,
                    p_id: node.n_id || 0,
                    title: `导入表格${nextTableIndex}`,
                    text: "",
                    table: tableFormat,
                    children: [],
                };
                return {
                    ...node,
                    children: [...(node.children || []), newTableNode],
                };
            }
            return {
                ...node,
                title: node.label === "__auto_req_detail" && reqNameFromTable ? replaceTitleName(node.title, reqNameFromTable) : node.title,
                table: tableFormat,
            };
        });
        if (isSavingOtherReqTable) {
            const otherDetailsForSync = collectReqRowsFromTreeTables([{
                id: -3,
                title: tableFormat?.name || "",
                table: tableFormat,
                children: [],
            } as TreeNode]).filter((item: any) => String(item?.type_code || "") === "2" && normalizeSrsCode(item?.code));
            if (onSaveOtherReqTable) {
                const saveResult = await onSaveOtherReqTable(tableFormat);
                if (Array.isArray(saveResult) && saveResult.length && "children" in (saveResult[0] || {})) {
                    updateNodes(saveResult as TreeNode[]);
                } else {
                    const nextNodes = syncTreeWithOtherReqState(newNodes, otherDetailsForSync, {
                        fixedTemplateSections: FIXED_TEMPLATE_SECTIONS,
                        resolveSrsCode: (node, headingNo, otherReqCode) => resolveFixedSectionSrsCode(node, headingNo, otherReqCode),
                        isCodeCompatible: (code, headingNo) => isCodeCompatibleWithFixedSection(code, headingNo),
                    });
                    updateNodes(nextNodes);
                }
            } else {
                const nextNodes = syncTreeWithOtherReqState(newNodes, otherDetailsForSync, {
                    fixedTemplateSections: FIXED_TEMPLATE_SECTIONS,
                    resolveSrsCode: (node, headingNo, otherReqCode) => resolveFixedSectionSrsCode(node, headingNo, otherReqCode),
                    isCodeCompatible: (code, headingNo) => isCodeCompatibleWithFixedSection(code, headingNo),
                });
                updateNodes(nextNodes);
            }
            setTableCellsBackup(undefined);
            return;
        }
        const syncExistingReqIdentity = (items: TreeNode[], details: any[]): TreeNode[] => {
            if (!details.length) return items;
            const detailByKey = new Map<string, any>();
            const detailByCode = new Map<string, any>();
            const detailByStableKey = new Map<string, any>();
            details.forEach((detail: any) => {
                const key = getReqDetailKey(detail);
                if (key.replace(/\|/g, "")) detailByKey.set(key, detail);
                const code = normalizeSrsCode(detail?.code);
                if (code) detailByCode.set(code, detail);
                const stableKey = getReqStableKey(detail);
                if (stableKey) detailByStableKey.set(stableKey, detail);
            });
            const getNodeStableKey = (node: TreeNode) => {
                const code = normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                return normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table) || getLegacyReqDetailKeyByCode(code));
            };
            const pickMatchedDetail = (node: TreeNode, ancestors: TreeNode[]): { detail: any; matchedKey: string } | undefined => {
                const keyCandidates = getExistingReqDetailKeyCandidates(node, ancestors);
                const stableKey = getNodeStableKey(node);
                const matchedByStableKey = stableKey ? detailByStableKey.get(stableKey) : undefined;
                if (matchedByStableKey) {
                    return { detail: matchedByStableKey, matchedKey: keyCandidates[0] || getReqDetailKey(matchedByStableKey) };
                }
                const matchedKey = keyCandidates.find((key) => existingReqDetailKeys.has(key) && detailByKey.has(key));
                const matchedByKey = matchedKey ? detailByKey.get(matchedKey) : undefined;
                if (matchedByKey && matchedKey) return { detail: matchedByKey, matchedKey };
                const renamedKey = keyCandidates.find((key) => renamedDetailByPreviousKey.has(key));
                const renamedDetail = renamedKey ? renamedDetailByPreviousKey.get(renamedKey) : undefined;
                if (renamedDetail && renamedKey) return { detail: renamedDetail, matchedKey: renamedKey };
                return undefined;
            };
            const getNextTitleName = (node: TreeNode, detail: any, matchedKey: string, isOwnDetail: boolean) => {
                const currentTitleName = normalizeTitleText(stripHeadingNumber(node.title));
                const [moduleKey, functionKey, subFunctionKey] = (matchedKey || "").split("|");
                if (moduleKey && currentTitleName === moduleKey && detail?.module) return String(detail.module).trim();
                if (functionKey && currentTitleName === functionKey && detail?.function) return String(detail.function).trim();
                if (subFunctionKey && currentTitleName === subFunctionKey && detail?.sub_function) return String(detail.sub_function).trim();
                if (isOwnDetail && isFunctionalKvTable(node.table)) {
                    return String(detail?.name || detail?.sub_function || detail?.function || detail?.module || "").trim();
                }
                return "";
            };
            const hasFunctionalReqDetailDescendant = (node: TreeNode): boolean => (
                isFunctionalKvTable(node.table) ||
                node.label === "__auto_req_detail" ||
                (node.children || []).some((child) => hasFunctionalReqDetailDescendant(child))
            );
            const findDescendantMatch = (list: TreeNode[], ancestors: TreeNode[] = []): { detail: any; matchedKey: string } | undefined => {
                for (const child of list || []) {
                    const matched = pickMatchedDetail(child, ancestors);
                    if (matched) return matched;
                    const childMatched = findDescendantMatch(child.children || [], [...ancestors, child]);
                    if (childMatched) return childMatched;
                }
                return undefined;
            };
            const walk = (list: TreeNode[], ancestors: TreeNode[] = []): TreeNode[] => (list || []).map((node) => {
                const headingDepth = getHeadingDepth(node.title);
                const childMatch = headingDepth > 1 ? (node.children || [])
                    .map((child) => pickMatchedDetail(child, [...ancestors, node]))
                    .find(Boolean) : undefined;
                const children = walk(node.children || [], [...ancestors, node]);
                const ownMatch = pickMatchedDetail(node, ancestors);
                const descendantMatch = headingDepth > 1 && !ownMatch && !childMatch
                    ? findDescendantMatch(node.children || [], [...ancestors, node])
                    : undefined;
                const match = ownMatch || childMatch || descendantMatch;
                if (!match?.detail) {
                    return { ...node, children };
                }
                const detail = match.detail;
                const nextName = getNextTitleName(node, detail, match.matchedKey, !!ownMatch);
                const titlePrefix = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*\s+)/)?.[1] || "";
                const shouldUpdateTitle = !!nextName && !!titlePrefix && (
                    (headingDepth > 1 && isFunctionalKvTable(node.table)) ||
                    (headingDepth > 1 && node.label === "__auto_req_detail") ||
                    (headingDepth > 1 && hasFunctionalReqDetailDescendant({ ...node, children }))
                );
                return {
                    ...node,
                    ...(shouldUpdateTitle ? { title: `${titlePrefix}${nextName}` } : {}),
                    ...(headingDepth > 1 && ownMatch && normalizeSrsCode(detail?.code) ? { srs_code: normalizeSrsCode(detail?.code) } : {}),
                    ...(headingDepth > 1 && ownMatch && getReqStableKey(detail) ? { req_detail_key: getReqStableKey(detail) } : {}),
                    ...(headingDepth > 1 && !ownMatch && !isFunctionalKvTable(node.table) ? { srs_code: null } : {}),
                    table: ownMatch && isFunctionalKvTable(node.table) ? updateReqIdentityInFunctionalTable(node.table, detail) : node.table,
                    children,
                };
            });
            return walk(items);
        };
        const appendMissingStandardReqDetails = (items: TreeNode[], details: any[]): TreeNode[] => {
            if (!details.length) return items;
            const nextItems: TreeNode[] = JSON.parse(JSON.stringify(items || []));
            const existingDetailKeys = new Set<string>();
            const detailByKey = new Map<string, any>();
            const detailByCode = new Map<string, any>();
            details.forEach((detail: any) => {
                const key = getReqDetailKey(detail);
                if (key.replace(/\|/g, "")) detailByKey.set(key, detail);
                const code = normalizeSrsCode(detail?.code);
                if (code) detailByCode.set(code, detail);
            });
            const collectExistingDetailKeys = (list: TreeNode[], ancestors: TreeNode[] = []) => {
                (list || []).forEach((node) => {
                    const code = normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                    const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table) || (node.children || []).some((child) => isFunctionalKvTable(child.table));
                    if (isReqDetailNode) {
                        getExistingReqDetailKeyCandidates(node, ancestors)
                            .filter((key) => (existingReqDetailKeys.has(key) && detailByKey.has(key)) || renamedDetailByPreviousKey.has(key))
                            .forEach((key) => {
                                existingDetailKeys.add(key);
                                const renamedDetail = renamedDetailByPreviousKey.get(key);
                                const renamedDetailKey = renamedDetail ? getReqDetailKey(renamedDetail) : "";
                                if (renamedDetailKey.replace(/\|/g, "")) {
                                    existingDetailKeys.add(renamedDetailKey);
                                }
                            });
                        const matchedByCode = code ? detailByCode.get(code) : undefined;
                        const matchedKey = matchedByCode ? getReqDetailKey(matchedByCode) : "";
                        if (matchedKey.replace(/\|/g, "") && existingReqDetailKeys.has(matchedKey)) {
                            existingDetailKeys.add(matchedKey);
                        }
                    }
                    collectExistingDetailKeys(node.children || [], [...ancestors, node]);
                });
            };
            collectExistingDetailKeys(nextItems);

            const findPathByCode = (list: TreeNode[], code: string, path: TreeNode[] = []): TreeNode[] | undefined => {
                for (const node of list || []) {
                    const nodeCode = normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                    const nextPath = [...path, node];
                    if (nodeCode === code) return nextPath;
                    const childPath = findPathByCode(node.children || [], code, nextPath);
                    if (childPath) return childPath;
                }
                return undefined;
            };
            const findParentListAndIndex = (list: TreeNode[], target: TreeNode): { list: TreeNode[]; index: number } | undefined => {
                const index = (list || []).findIndex((node) => node.id === target.id);
                if (index >= 0) return { list, index };
                for (const node of list || []) {
                    const found = findParentListAndIndex(node.children || [], target);
                    if (found) return found;
                }
                return undefined;
            };
            const getModuleNodeFromPath = (path: TreeNode[], detail: any) => {
                const moduleTitle = normalizeTitleText(detail?.module);
                const matchedByName = [...path].reverse().find((node) => (
                    getHeadingDepth(node.title) > 0 &&
                    normalizeTitleText(stripHeadingNumber(node.title)) === moduleTitle
                ));
                if (matchedByName) return matchedByName;
                return [...path].reverse().find((node) => getHeadingDepth(node.title) > 0);
            };
            const renumberSiblingHeadings = (siblings: TreeNode[]) => {
                const numbered = (siblings || [])
                    .map((node) => String(node.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "")
                    .filter(Boolean);
                if (!numbered.length) return;
                const baseDepth = Math.min(...numbered.map((item) => item.split(".").length));
                const first = numbered.find((item) => item.split(".").length === baseDepth);
                if (!first) return;
                const parentPrefix = first.split(".").slice(0, -1).join(".");
                let nextNo = 1;
                (siblings || []).forEach((node) => {
                    const matched = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/);
                    if (!matched || matched[1].split(".").length !== baseDepth) return;
                    const nextPrefix = parentPrefix ? `${parentPrefix}.${nextNo}` : String(nextNo);
                    if (matched[1] !== nextPrefix) {
                        replaceHeadingPrefix(node, matched[1], nextPrefix);
                    }
                    nextNo += 1;
                });
            };
            const createMissingReqHierarchy = (detail: any, detailIndex: number) => {
                const code = normalizeSrsCode(detail?.code);
                const detailKey = getReqDetailKey(detail);
                if (!code || !detailKey.replace(/\|/g, "") || existingDetailKeys.has(detailKey)) return;
                const moduleText = String(detail?.module || detail?.name || detail?.function || code || "").trim() || code;
                const functionText = String(detail?.function || "").trim();
                const subFunctionText = String(detail?.sub_function || "").trim();
                let targetNode: TreeNode | undefined;
                const reqDetailRoot = findReqDetailRoot(nextItems);
                const existingModuleNode = findExistingModuleNode(nextItems, moduleText);
                if (existingModuleNode) {
                    targetNode = existingModuleNode;
                }
                const previousDetailWithPath = details
                    .slice(0, detailIndex)
                    .reverse()
                    .map((item: any) => ({ detail: item, path: findPathByCode(nextItems, normalizeSrsCode(item?.code)) }))
                    .find((item: any) => item.path?.some((pathNode: TreeNode) => pathNode.id === reqDetailRoot?.id));
                if (!targetNode && previousDetailWithPath?.path?.length) {
                    const previousModuleNode = getModuleNodeFromPath(previousDetailWithPath.path, previousDetailWithPath.detail);
                    const previousModuleDepth = getHeadingDepth(previousModuleNode?.title);
                    const parentInfo = previousModuleNode && previousModuleDepth > 1 ? findParentListAndIndex(nextItems, previousModuleNode) : undefined;
                    const sameModule = normalizeTitleText(previousDetailWithPath.detail?.module) === normalizeTitleText(moduleText);
                    if (sameModule && previousModuleNode && previousModuleDepth > 1) {
                        targetNode = previousModuleNode;
                    } else if (parentInfo) {
                        const previousPrefix = String(previousModuleNode?.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
                        const parentPrefix = previousPrefix.split(".").slice(0, -1).join(".");
                        const nextNo = (parseInt(previousPrefix.split(".").slice(-1)[0] || "0", 10) || 0) + 1;
                        const nextPrefix = parentPrefix ? `${parentPrefix}.${nextNo}` : String(nextNo);
                        targetNode = buildAutoNode(`${nextPrefix} ${moduleText}`, {
                            ...(previousModuleNode || {}),
                            n_id: previousModuleNode?.p_id || 0,
                        } as TreeNode);
                        parentInfo.list.splice(parentInfo.index + 1, 0, targetNode);
                        renumberSiblingHeadings(parentInfo.list);
                    }
                }
                if (!targetNode) {
                    const parent = reqDetailRoot;
                    if (!parent) return;
                    const rootPrefix = String(parent.title || "").trim().match(/^(\d+(?:\.\d+)*)/)?.[1] || "";
                    if (!rootPrefix) return;
                    parent.children = parent.children || [];
                    targetNode = findChildByTitleText(parent.children, rootPrefix, moduleText);
                    if (!targetNode) {
                        const moduleNo = getNextChildNo(parent.children, rootPrefix);
                        targetNode = buildAutoNode(`${rootPrefix}.${moduleNo} ${moduleText}`, parent);
                        parent.children = [...parent.children, targetNode];
                    }
                }
                if (!targetNode) {
                    return;
                }
                if (functionText) {
                    const modulePrefix = String(targetNode.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
                    if (modulePrefix) {
                        targetNode.children = targetNode.children || [];
                        let functionNode = findChildByTitleText(targetNode.children, modulePrefix, functionText);
                        if (!functionNode) {
                            const functionNo = getNextChildNo(targetNode.children, modulePrefix);
                            functionNode = buildAutoNode(`${modulePrefix}.${functionNo} ${functionText}`, targetNode);
                            targetNode.children = [...targetNode.children, functionNode];
                        }
                        targetNode = functionNode;
                    }
                }
                if (subFunctionText) {
                    const functionPrefix = String(targetNode.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
                    if (functionPrefix) {
                        targetNode.children = targetNode.children || [];
                        let subFunctionNode = findChildByTitleText(targetNode.children, functionPrefix, subFunctionText);
                        if (!subFunctionNode) {
                            const subFunctionNo = getNextChildNo(targetNode.children, functionPrefix);
                            subFunctionNode = buildAutoNode(`${functionPrefix}.${subFunctionNo} ${subFunctionText}`, targetNode);
                            targetNode.children = [...targetNode.children, subFunctionNode];
                        }
                        targetNode = subFunctionNode;
                    }
                }
                if (getHeadingDepth(targetNode.title) === 1) {
                    const rootPrefix = String(targetNode.title || "").trim().match(/^(\d+(?:\.\d+)*)/)?.[1] || "";
                    const detailNo = getNextChildNo(targetNode.children || [], rootPrefix);
                    const detailTitle = String(detail?.name || detail?.function || detail?.sub_function || moduleText || code).trim();
                    const detailNode = buildAutoNode(`${rootPrefix}.${detailNo} ${detailTitle}`, targetNode);
                    targetNode.children = [...(targetNode.children || []), detailNode];
                    targetNode = detailNode;
                }
                targetNode.srs_code = code;
                targetNode.req_detail_key = getReqStableKey(detail);
                targetNode.rcm_codes = null;
                targetNode.text = "";
                targetNode.label = "__auto_req_detail";
                targetNode.table = buildReqDetailTable(detail);
                existingDetailKeys.add(detailKey);
            };

            details.forEach(createMissingReqHierarchy);
            return nextItems;
        };
        const sortExistingReqDetailsBySrsCode = (items: TreeNode[]): TreeNode[] => {
            const cloned: TreeNode[] = JSON.parse(JSON.stringify(items || []));
            const hasReqDetail = (node: TreeNode) => (
                node.label === "__auto_req_detail" ||
                isFunctionalKvTable(node.table) ||
                (node.children || []).some((child) => isFunctionalKvTable(child.table))
            );
            const minReqCode = (node: TreeNode): string => {
                const codes = [
                    normalizeSrsCode(node.srs_code || ""),
                    isFunctionalKvTable(node.table) ? normalizeSrsCode(extractSrsCodeFromTable(node.table)) : "",
                    ...(node.children || []).map((child) => minReqCode(child)),
                ].filter(Boolean);
                return minSrsCode(codes);
            };
            const walk = (list: TreeNode[]) => {
                (list || []).forEach((node) => {
                    walk(node.children || []);
                    if (!(node.children || []).some(hasReqDetail)) return;
                    node.children = [...(node.children || [])].sort((left, right) => {
                        const leftCode = minReqCode(left);
                        const rightCode = minReqCode(right);
                        if (!leftCode && !rightCode) return 0;
                        if (!leftCode) return -1;
                        if (!rightCode) return 1;
                        return compareSrsCodes(leftCode, rightCode);
                    });
                    const parentPrefix = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
                    if (parentPrefix) {
                        renumberDirectHeadingChildren(node.children || [], parentPrefix);
                    }
                });
            };
            walk(cloned);
            return cloned;
        };
        const sortReqDetailSiblingsBySrsCode = (items: TreeNode[]): TreeNode[] => {
            const cloned: TreeNode[] = JSON.parse(JSON.stringify(items || []));
            const getNodeCode = (node: TreeNode): string => (
                (isFunctionalKvTable(node.table) ? normalizeSrsCode(extractSrsCodeFromTable(node.table)) : "") ||
                normalizeSrsCode(node.srs_code || "") ||
                minSrsCode((node.children || []).map((child) => getNodeCode(child)).filter(Boolean))
            );
            const isReqDetailLikeNode = (node: TreeNode) => !!getNodeCode(node) && (
                node.label === "__auto_req_detail" ||
                isFunctionalKvTable(node.table) ||
                (node.children || []).some((child) => isFunctionalKvTable(child.table) || child.label === "__auto_req_detail")
            );
            const walk = (list: TreeNode[]) => {
                (list || []).forEach((node) => {
                    walk(node.children || []);
                    const children = node.children || [];
                    const sortableIndexes = children
                        .map((child, index) => ({ child, index, code: getNodeCode(child) }))
                        .filter((item) => isReqDetailLikeNode(item.child) && parseSrsCodeOrder(item.code));
                    if (sortableIndexes.length <= 1) return;
                    const sortedNodes = sortableIndexes
                        .map((item) => item.child)
                        .sort((left, right) => compareSrsCodes(getNodeCode(left), getNodeCode(right)));
                    const nextChildren = [...children];
                    sortableIndexes.forEach((item, idx) => {
                        nextChildren[item.index] = sortedNodes[idx];
                    });
                    node.children = nextChildren;
                    const parentPrefix = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
                    if (parentPrefix) {
                        renumberDirectHeadingChildren(node.children || [], parentPrefix);
                    }
                });
            };
            walk(cloned);
            return cloned;
        };
        const stripIgnoredReqDetailTables = (items: TreeNode[]): TreeNode[] => {
            if (!ignoredStandardReqCodes.size) return items;
            const walk = (list: TreeNode[]): TreeNode[] => (list || []).map((node) => {
                const code = normalizeSrsCode(node.srs_code || "") ||
                    (isFunctionalKvTable(node.table) ? normalizeSrsCode(extractSrsCodeFromTable(node.table)) : "");
                const shouldStrip = !!code && ignoredStandardReqCodes.has(code) && isFunctionalKvTable(node.table);
                return {
                    ...node,
                    ...(shouldStrip ? {
                        table: null,
                        label: node.label === "__auto_req_detail" ? "__auto_req_group" : node.label,
                    } : {}),
                    children: walk(node.children || []),
                };
            });
            return walk(items);
        };
        const syncSrsReqDetailsByKey = (items: TreeNode[], details: any[]): TreeNode[] => {
            if (!details.length) return items;
            const cloned: TreeNode[] = JSON.parse(JSON.stringify(items || []));
            type PreservedDetail = { node: TreeNode; table?: TableData | null; score: number; name: string };
            const scoreFunctionalTable = (table?: TableData | null) => {
                const normalized = normalizeFunctionalHeaderToRow(table);
                if (!normalized || !isFunctionalKvTable(normalized)) return 0;
                const leftCode = normalized.headers?.[0]?.code;
                const rightCode = normalized.headers?.[1]?.code;
                if (!leftCode || !rightCode) return 0;
                return (normalized.rows || []).reduce((score, row) => {
                    const label = normalizeCellText(String(row?.[leftCode] || ""));
                    const value = normalizeReqDisplayText(row?.[rightCode]);
                    if (!value || label.includes("需求编号") || label.includes("需求名称")) return score;
                    return score + 1;
                }, 0);
            };
            const preservedByKey = new Map<string, PreservedDetail>();
            const preservedByCode = new Map<string, PreservedDetail>();
            const headingMap = new Map<string, TreeNode>();
            const walkExisting = (list: TreeNode[], ancestors: TreeNode[] = []) => {
                (list || []).forEach((node) => {
                    const headingPath = [...ancestors, node]
                        .filter((item) => getHeadingDepth(item.title) > 0)
                        .map((item) => normalizeTitleText(stripHeadingNumber(item.title)))
                        .filter(Boolean)
                        .join("|");
                    if (headingPath) headingMap.set(headingPath, node);
                    const normalizedTable = normalizeFunctionalHeaderToRow(node.table);
                    if (normalizedTable && isFunctionalKvTable(normalizedTable)) {
                        const code = normalizeSrsCode(node.srs_code || extractSrsCodeFromTable(normalizedTable));
                        const stableKey = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(normalizedTable) || getLegacyReqDetailKeyByCode(code));
                        const key = stableKey || getExistingReqDetailKey({ ...node, table: normalizedTable }, ancestors);
                        const score = scoreFunctionalTable(normalizedTable);
                        const preservedName = normalizeTitleText(extractReqNameFromFunctionalTable(normalizedTable));
                        const current = preservedByKey.get(key);
                        if (key.replace(/\|/g, "") && (!current || score > current.score)) {
                            preservedByKey.set(key, { node, table: normalizedTable, score, name: preservedName });
                        }
                        const currentByCode = code ? preservedByCode.get(code) : undefined;
                        if (code && (!currentByCode || score > currentByCode.score)) {
                            preservedByCode.set(code, { node, table: normalizedTable, score, name: preservedName });
                        }
                    }
                    walkExisting(node.children || [], [...ancestors, node]);
                });
            };
            const reqRoot = findReqDetailRoot(cloned);
            if (!reqRoot) return restoreFixedTemplateSections(cloned, buildPreviewOtherDetails());
            walkExisting(reqRoot.children || [], [reqRoot]);
            const rootPrefix = String(reqRoot.title || "").trim().match(/^(\d+(?:\.\d+)*)/)?.[1] || "1";
            const usedNodeIds = new Set<number>();
            const makeNode = (title: string, parent: TreeNode, key?: string, extra: Partial<TreeNode> = {}): TreeNode => {
                const reused = key ? headingMap.get(key) : undefined;
                return {
                    ...(reused || buildAutoNode(title, parent)),
                    title,
                    doc_id: reused?.doc_id || parent.doc_id || docId,
                    p_id: parent.n_id || reused?.p_id || 0,
                    text: reused?.text || "",
                    table: reused?.table || null,
                    children: [],
                    ...extra,
                };
            };
            const makeDetailNode = (title: string, parent: TreeNode, detail: any, key: string): TreeNode => {
                const detailCode = normalizeSrsCode(detail?.code);
                const detailName = normalizeTitleText(detail?.name || detail?.sub_function || detail?.function || detail?.module);
                const preservedByCodeCandidate = preservedByCode.get(detailCode);
                const preserved = preservedByKey.get(key) ||
                    (preservedByCodeCandidate?.name && preservedByCodeCandidate.name === detailName ? preservedByCodeCandidate : undefined);
                const base = preserved?.node || buildAutoNode(title, parent);
                if (preserved?.node?.id) usedNodeIds.add(preserved.node.id);
                return {
                    ...base,
                    title,
                    doc_id: base.doc_id || parent.doc_id || docId,
                    p_id: parent.n_id || base.p_id || 0,
                    srs_code: normalizeSrsCode(detail?.code),
                    rcm_codes: null,
                    text: "",
                    label: "__auto_req_detail",
                    table: preserved?.table
                        ? updateReqIdentityInFunctionalTable(preserved.table, detail)
                        : buildReqDetailTable(detail),
                    children: [],
                };
            };
            const moduleMap = new Map<string, TreeNode>();
            const functionMap = new Map<string, TreeNode>();
            const rebuiltChildren: TreeNode[] = [];
            const standardDetailKeys = new Set((details || []).map((detail: any) => getReqStableKey(detail) || getReqDetailKey(detail)).filter(Boolean));
            const standardDetailCodes = new Set((details || []).map((detail: any) => normalizeSrsCode(detail?.code)).filter(Boolean));
            const changeDetailCodes = new Set(buildPreviewChangeDetails().map((detail: any) => normalizeSrsCode(detail?.code)).filter(Boolean));
            const activeManagedCodes = new Set([...standardDetailCodes, ...changeDetailCodes]);
            const containsStandardDetail = (node: TreeNode): boolean => {
                const isStandardDetailCarrier = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                const code = isStandardDetailCarrier
                    ? normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""))
                    : "";
                const key = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table) || getLegacyReqDetailKeyByCode(code));
                return (isStandardDetailCarrier && (
                    (!!key && standardDetailKeys.has(key)) ||
                    (!!code && standardDetailCodes.has(code))
                )) || (node.children || []).some((child) => containsStandardDetail(child));
            };
            const pruneStaleManagedDetails = (items: TreeNode[]): TreeNode[] => (items || [])
                .map((node) => ({
                    ...node,
                    children: pruneStaleManagedDetails(node.children || []),
                }))
                .filter((node) => {
                    const isReqDetailCarrier = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                    const code = normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                    if (isReqDetailCarrier && code && !activeManagedCodes.has(code)) {
                        return false;
                    }
                    const isEmptyAutoGroup = node.label === "__auto_req_group" &&
                        !(node.children || []).length &&
                        !String(node.text || "").trim() &&
                        !hasRenderableTable(node.table);
                    return !isEmptyAutoGroup;
                });
            const preservedNonStandardChildren = pruneStaleManagedDetails(reqRoot.children || []).filter((child) => !containsStandardDetail(child));
            const getDirectChildNo = (node: TreeNode): number => {
                const prefix = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*)(?:\s+|(?=\D|$))/)?.[1] || "";
                const parts = prefix.split(".");
                if (parts.length !== 2 || parts[0] !== rootPrefix) return Number.POSITIVE_INFINITY;
                const childNo = Number(parts[1]);
                return Number.isFinite(childNo) ? childNo : Number.POSITIVE_INFINITY;
            };
            const reservedChildNos = new Set(
                preservedNonStandardChildren
                    .map(getDirectChildNo)
                    .filter((childNo) => Number.isFinite(childNo))
            );
            // 7.1 is the imported "要求" introduction section; functional requirements start at 7.2.
            reservedChildNos.add(1);
            const usedRebuiltChildNos = new Set<number>();
            let nextRebuiltChildNo = 2;
            const allocateRebuiltChildNo = (): number => {
                while (reservedChildNos.has(nextRebuiltChildNo) || usedRebuiltChildNos.has(nextRebuiltChildNo)) {
                    nextRebuiltChildNo += 1;
                }
                const childNo = nextRebuiltChildNo;
                usedRebuiltChildNos.add(childNo);
                nextRebuiltChildNo += 1;
                return childNo;
            };
            const sortedDetails = [...details].sort((left, right) => compareSrsCodes(left?.code, right?.code));
            const otherReqCodeSet = new Set(
                (reqDetails || [])
                    .filter((item: any) => String(item?.type_code || "") === "2")
                    .map((item: any) => normalizeSrsCode(item?.code))
                    .filter(Boolean)
            );
            const isAlgorithmReqDetail = (detail: any) => {
                const text = normalizeTitleText([
                    detail?.module,
                    detail?.name,
                    detail?.function,
                    detail?.sub_function,
                    detail?.location,
                ].filter(Boolean).join(""));
                return text.includes("算法和数据要求") || text.includes("算法需求");
            };
            const isFunctionalReqCodeForDetail = (detail: any) => {
                if (isAlgorithmReqDetail(detail)) return false;
                const code = detail?.code;
                const normalizedCode = normalizeSrsCode(code);
                return !!normalizedCode && !otherReqCodeSet.has(normalizedCode);
            };
            sortedDetails.forEach((detail) => {
                const moduleText = normalizeReqDisplayText(detail?.module || detail?.name || detail?.function || detail?.code);
                const functionText = normalizeReqDisplayText(detail?.function);
                const subFunctionText = normalizeReqDisplayText(detail?.sub_function);
                if (!moduleText) return;
                const detailKey = getReqStableKey(detail) || getReqDetailKey(detail);
                if (!functionText && !subFunctionText) {
                    const preserved = preservedByKey.get(detailKey);
                    if ((!preserved || preserved.score <= 0) && !isFunctionalReqCodeForDetail(detail)) {
                        return;
                    }
                }
                const moduleKey = normalizeTitleText(moduleText);
                let moduleNode = moduleMap.get(moduleKey);
                if (!moduleNode) {
                    const moduleNo = allocateRebuiltChildNo();
                    const title = `${rootPrefix}.${moduleNo} ${moduleText}`;
                    moduleNode = makeNode(title, reqRoot!, moduleKey);
                    moduleMap.set(moduleKey, moduleNode);
                    rebuiltChildren.push(moduleNode);
                }
                if (!functionText) {
                    if (subFunctionText) {
                        moduleNode.children = moduleNode.children || [];
                        const modulePrefix = String(moduleNode.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || `${rootPrefix}.${rebuiltChildren.length}`;
                        const detailNo = moduleNode.children.length + 1;
                        const title = `${modulePrefix}.${detailNo} ${subFunctionText}`;
                        moduleNode.children.push(makeDetailNode(title, moduleNode, detail, detailKey));
                        return;
                    }
                    const title = String(moduleNode.title || "");
                    const detailNode = makeDetailNode(title, reqRoot!, detail, detailKey);
                    Object.assign(moduleNode, {
                        ...moduleNode,
                        ...detailNode,
                        title,
                        children: moduleNode.children || [],
                    });
                    return;
                }
                const functionKey = `${moduleKey}|${normalizeTitleText(functionText)}`;
                let functionNode = functionMap.get(functionKey);
                if (!functionNode) {
                    moduleNode.children = moduleNode.children || [];
                    const functionNo = moduleNode.children.length + 1;
                    const modulePrefix = String(moduleNode.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || `${rootPrefix}.${rebuiltChildren.length}`;
                    const title = `${modulePrefix}.${functionNo} ${functionText}`;
                    functionNode = makeNode(title, moduleNode, functionKey);
                    functionMap.set(functionKey, functionNode);
                    moduleNode.children.push(functionNode);
                }
                if (!subFunctionText) {
                    const title = String(functionNode.title || "");
                    const detailNode = makeDetailNode(title, moduleNode, detail, detailKey);
                    Object.assign(functionNode, {
                        ...functionNode,
                        ...detailNode,
                        title,
                        children: functionNode.children || [],
                    });
                    return;
                }
                functionNode.children = functionNode.children || [];
                const functionPrefix = String(functionNode.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
                const subNo = functionNode.children.length + 1;
                const title = `${functionPrefix}.${subNo} ${subFunctionText}`;
                functionNode.children.push(makeDetailNode(title, functionNode, detail, detailKey));
            });
            reqRoot.children = [...preservedNonStandardChildren, ...rebuiltChildren].sort((left, right) => getDirectChildNo(left) - getDirectChildNo(right));
            const pruneStaleStandardReqNodes = (items: TreeNode[]): TreeNode[] => (
                (items || [])
                    .map((node) => ({ ...node, children: pruneStaleStandardReqNodes(node.children || []) }))
                    .filter((node) => {
                        const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                        if (isReqDetailNode) {
                            const code = normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                            const key = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table) || getLegacyReqDetailKeyByCode(code));
                            if (key.startsWith("change_reqd_")) return true;
                            if (code && standardDetailCodes.has(code)) return true;
                            if (key && standardDetailKeys.has(key)) return true;
                            return false;
                        }
                        const hasChildren = (node.children || []).length > 0;
                        const hasText = !!String(node.text || "").trim();
                        const hasFunctionalTable = isFunctionalKvTable(node.table);
                        const hasTable = hasRenderableTable(node.table);
                        if (hasChildren || hasText || hasFunctionalTable || hasTable) return true;
                        const prefix = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*)(?:\s+|(?=\D|$))/)?.[1] || "";
                        if (prefix.startsWith(`${rootPrefix}.`) && prefix.split(".").length >= 2) return false;
                        if (node.label === "__auto_req_group") return false;
                        return true;
                    })
            );
            reqRoot.children = pruneStaleStandardReqNodes(reqRoot.children || []);
            sortTreeChildrenBySrsCode([reqRoot]);
            return restoreFixedTemplateSections(cloned, buildPreviewOtherDetails());
        };
        const dedupeReqDetailsByKey = (items: TreeNode[], details: any[]): TreeNode[] => {
            if (!details.length) return items;
            const detailByKey = new Map<string, any>();
            const detailByStableKey = new Map<string, any>();
            details.forEach((detail: any) => {
                const key = getReqDetailKey(detail);
                if (key.replace(/\|/g, "")) detailByKey.set(key, detail);
                const stableKey = getReqStableKey(detail);
                if (stableKey) detailByStableKey.set(stableKey, detail);
            });
            const getNodeStableKey = (node: TreeNode) => {
                const code = normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                return normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table) || getLegacyReqDetailKeyByCode(code));
            };
            const scoreNode = (node: TreeNode) => {
                const table = normalizeFunctionalHeaderToRow(node.table);
                if (!table || !isFunctionalKvTable(table)) return 0;
                const leftCode = table.headers?.[0]?.code;
                const rightCode = table.headers?.[1]?.code;
                if (!leftCode || !rightCode) return 0;
                return (table.rows || []).reduce((score, row) => {
                    const label = normalizeCellText(String(row?.[leftCode] || ""));
                    const value = normalizeReqDisplayText(row?.[rightCode]);
                    if (!value) return score;
                    if (label.includes("需求编号") || label.includes("需求名称")) return score;
                    return score + 1;
                }, 0);
            };
            const bestByKey = new Map<string, { id: number; score: number }>();
            const collect = (list: TreeNode[], ancestors: TreeNode[] = []) => {
                (list || []).forEach((node) => {
                    const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                    if (isReqDetailNode) {
                        const key = getExistingReqDetailKey(node, ancestors);
                        const stableKey = getNodeStableKey(node);
                        if (detailByKey.has(key) || (stableKey && detailByStableKey.has(stableKey))) {
                            const score = scoreNode(node);
                            const bestKey = stableKey && detailByStableKey.has(stableKey) ? `stable:${stableKey}` : key;
                            const current = bestByKey.get(bestKey);
                            const isExistingKey = existingReqDetailKeys.has(key) || !!(stableKey && detailByStableKey.has(stableKey));
                            const shouldReplace = !current ||
                                (isExistingKey ? score > current.score : score < current.score);
                            if (shouldReplace) {
                                bestByKey.set(bestKey, { id: node.id, score });
                            }
                        }
                    }
                    collect(node.children || [], [...ancestors, node]);
                });
            };
            collect(items);
            const prune = (list: TreeNode[], ancestors: TreeNode[] = []): TreeNode[] => (list || [])
                .filter((node) => {
                    const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                    if (!isReqDetailNode) return true;
                    const key = getExistingReqDetailKey(node, ancestors);
                    const stableKey = getNodeStableKey(node);
                    const best = (stableKey && bestByKey.get(`stable:${stableKey}`)) || bestByKey.get(key);
                    return !best || best.id === node.id;
                })
                .map((node) => {
                    const children = prune(node.children || [], [...ancestors, node]);
                    const key = getExistingReqDetailKey(node, ancestors);
                    const stableKey = getNodeStableKey(node);
                    const detail = (stableKey ? detailByStableKey.get(stableKey) : undefined) || detailByKey.get(key);
                    const shouldUpdate = detail && (node.label === "__auto_req_detail" || isFunctionalKvTable(node.table));
                    const isExistingKey = existingReqDetailKeys.has(key) || !!(stableKey && detailByStableKey.has(stableKey));
                    const nextName = String(detail?.name || detail?.sub_function || detail?.function || detail?.module || "").trim();
                    const titlePrefix = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*\s+)/)?.[1] || "";
                    return {
                        ...node,
                        ...(shouldUpdate && normalizeSrsCode(detail?.code) ? { srs_code: normalizeSrsCode(detail.code) } : {}),
                        ...(shouldUpdate && getReqStableKey(detail) ? { req_detail_key: getReqStableKey(detail) } : {}),
                        ...(shouldUpdate && nextName && titlePrefix ? { title: `${titlePrefix}${nextName}` } : {}),
                        table: shouldUpdate
                            ? (isExistingKey && isFunctionalKvTable(node.table)
                                ? updateReqIdentityInFunctionalTable(node.table, detail)
                                : buildReqDetailTable(detail))
                            : node.table,
                        children,
                    };
                });
            return prune(items);
        };
        void findRootByTitleText;
        void findRootByNearestPreviousCode;
        void sortExistingReqDetailsBySrsCode;
        void syncSrsReqDetailsByKey;
        const pruneDeletedStandardReqDetails = (items: TreeNode[]): TreeNode[] => {
            if (!isSavingStandardSrsTable || !previousStandardDetails.length) return items;
            const previousStableKeys = new Set<string>();
            previousStandardDetails.forEach((detail: any, index: number) => {
                const rowIndex = getReqRowIndex(detail, index);
                const stableKey = getReqStableKey(detail) || previousStableKeyByIndex.get(rowIndex);
                if (stableKey) previousStableKeys.add(stableKey);
            });
            const currentStableKeys = new Set<string>();
            allStandardDetailsForIdentitySync.forEach((detail: any, index: number) => {
                const rowIndex = getReqRowIndex(detail, index);
                const stableKey = getReqStableKey(detail) || (rowIndex < previousStandardDetails.length ? previousStableKeyByIndex.get(rowIndex) : "");
                if (stableKey) currentStableKeys.add(stableKey);
            });
            const deletedStableKeys = new Set(Array.from(previousStableKeys).filter((key) => !currentStableKeys.has(key)));
            if (!deletedStableKeys.size) return items;
            const getNodeStableKey = (node: TreeNode) => {
                const code = normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                return normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table) || getLegacyReqDetailKeyByCode(code));
            };
            const isEmptyAutoGroup = (node: TreeNode) => (
                node.label === "__auto_req_group" &&
                !(node.children || []).length &&
                !String(node.text || "").trim() &&
                !hasRenderableTable(node.table)
            );
            const walk = (list: TreeNode[]): TreeNode[] => (list || [])
                .map((node) => {
                    const children = walk(node.children || []);
                    return { ...node, children };
                })
                .filter((node) => {
                    const stableKey = getNodeStableKey(node);
                    const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                    if (stableKey && deletedStableKeys.has(stableKey) && isReqDetailNode) return false;
                    if (isEmptyAutoGroup(node)) return false;
                    return true;
                });
            return walk(items);
        };
        const syncChangedModuleTitles = (items: TreeNode[]): TreeNode[] => {
            if (!isSavingStandardSrsTable || !previousStandardDetails.length || !allStandardDetailsForIdentitySync.length) return items;
            const moduleRenameGroups = new Map<string, { oldModuleKey: string; nextModule: string; stableKeys: Set<string> }>();
            allStandardDetailsForIdentitySync.forEach((detail: any, index: number) => {
                const rowIndex = getReqRowIndex(detail, index);
                const previousDetail = previousStandardDetails[rowIndex];
                if (!previousDetail) return;
                const oldModuleKey = normalizeTitleText(previousDetail?.module);
                const nextModule = normalizeReqDisplayText(detail?.module);
                const stableKey = getReqStableKey(detail) ||
                    previousStableKeyByIndex.get(rowIndex) ||
                    getReqStableKey(previousDetail);
                if (stableKey && oldModuleKey && nextModule && oldModuleKey !== normalizeTitleText(nextModule)) {
                    const groupKey = `${oldModuleKey}|${normalizeTitleText(nextModule)}`;
                    const group = moduleRenameGroups.get(groupKey) || { oldModuleKey, nextModule, stableKeys: new Set<string>() };
                    group.stableKeys.add(stableKey);
                    moduleRenameGroups.set(groupKey, group);
                }
            });
            if (!moduleRenameGroups.size) return items;
            const getNodeStableKey = (node: TreeNode) => {
                const code = normalizeSrsCode(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                return normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table) || getLegacyReqDetailKeyByCode(code));
            };
            const containsAnyStableKey = (node: TreeNode, stableKeys: Set<string>): boolean => (
                stableKeys.has(getNodeStableKey(node)) ||
                (node.children || []).some((child) => containsAnyStableKey(child, stableKeys))
            );
            const walk = (list: TreeNode[]): TreeNode[] => (list || []).map((node) => {
                const children = walk(node.children || []);
                const titlePrefix = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*\s+)/)?.[1] || "";
                const titleText = normalizeTitleText(stripHeadingNumber(node.title));
                const currentNode = { ...node, children };
                const matchedRename = Array.from(moduleRenameGroups.values()).find((group) => (
                    group.oldModuleKey === titleText &&
                    containsAnyStableKey(currentNode, group.stableKeys)
                ));
                const nextModule = matchedRename?.nextModule;
                const shouldRename = !!titlePrefix &&
                    !!nextModule &&
                    getHeadingDepth(node.title) > 1;
                return {
                    ...node,
                    ...(shouldRename ? { title: `${titlePrefix} ${nextModule}` } : {}),
                    children,
                };
            });
            return walk(items);
        };
        void syncExistingReqIdentity;
        void appendMissingStandardReqDetails;
        void sortReqDetailSiblingsBySrsCode;
        void stripIgnoredReqDetailTables;
        void dedupeReqDetailsByKey;
        void syncChangedModuleTitles;
        const nextNodes = isSavingStandardSrsTable
            ? pruneDeletedStandardReqDetails(
                syncSrsReqDetailsByKey(newNodes, allStandardDetailsForIdentitySync)
            )
            : newNodes;
        updateNodes(nextNodes);
        setTableCellsBackup(undefined);
    };

    const hiddenSet = new Set(hiddenNodeIds.map((id) => String(id)));
    const getVisibleNodes = (list: TreeNode[]): TreeNode[] => {
        return list
            .filter((node) => {
                const nodeIdHidden = hiddenSet.has(String(node.id));
                const persistedIdHidden = !!node.n_id && hiddenSet.has(String(node.n_id));
                return !nodeIdHidden && !persistedIdHidden;
            })
            .map((node) => ({
                ...node,
                children: getVisibleNodes(node.children || []),
            }));
    };
    const visibleNodes = getVisibleNodes(nodes);
    const collectChangeTableTitles = (items: TreeNode[] = []): string[] => (
        (items || []).flatMap((item) => {
            const title = String(item?.table?.name || item?.title || item?.label || "").trim();
            const ownTitle = /变更/.test(title) && !!item?.table?.headers?.length ? [title] : [];
            return [...ownTitle, ...collectChangeTableTitles(item.children || [])];
        })
    );
    const existingChangeTableTitles = collectChangeTableTitles(visibleNodes);

    // 仅用于左目录导航：按 id 在可见树中查找节点（不改动任何数据）
    const findNavNodeById = (list: TreeNode[], id: string | number | null): TreeNode | null => {
        if (id === null || id === undefined) return null;
        for (const item of list || []) {
            if (String(item.id) === String(id)) return item;
            const inChild = findNavNodeById(item.children || [], id);
            if (inChild) return inChild;
        }
        return null;
    };
    // 额外入口（封面/文件修订记录）：key 以 __extra_ 前缀标识
    const extraKeyPrefix = "__extra_";
    const activeExtra = extraNavSections.find((s) => String(activeNodeId) === `${extraKeyPrefix}${s.key}`) || null;
    // 默认选中：优先第一个额外入口（封面），否则第一个章节
    const defaultActiveNode = visibleNodes[0] || null;
    const activeNode = activeExtra
        ? null
        : (findNavNodeById(visibleNodes, activeNodeId) || (activeNodeId === null && extraNavSections.length > 0 ? null : defaultActiveNode));
    // 没有任何选中时（activeNodeId 为 null），若存在额外入口则默认落在第一个额外入口
    const fallbackToFirstExtra = activeNodeId === null && !activeExtra && extraNavSections.length > 0;
    const effectiveExtra = activeExtra || (fallbackToFirstExtra ? extraNavSections[0] : null);
    const effectiveNode = effectiveExtra ? null : (activeNode || defaultActiveNode);

    // 目录里能否给该节点加子章节：与右侧"添加下一级"按钮的显示条件保持一致
    // （非只读、树深 < 2 支持到三级、排除自动需求组与需求/图片等特殊节点）
    const canAddChildInNav = (node: TreeNode, depth: number): boolean => (
        !readOnly &&
        depth < 2 &&
        node.label !== "__auto_req_group" &&
        node.label !== "__auto_req_detail" &&
        node.ref_type !== "srs_reqs" &&
        node.ref_type !== "srs_reqs_2" &&
        node.ref_type !== "srs_reqds" &&
        !isImgRefType(node.ref_type)
    );
    // 目录里新增子章节：复用 handleAdd，并自动展开父节点、选中新节点
    const handleAddChildFromNav = (parentId: number) => {
        const newId = handleAdd(parentId);
        setNavCollapsedIds((prev) => {
            const next = new Set(prev);
            next.delete(String(parentId));
            return next;
        });
        if (newId !== undefined && newId !== null) {
            setActiveNodeId(newId);
        }
    };

    const isNavChapter = (n: TreeNode): boolean => (
        !isEmbeddedImageNode(n) &&
        !isEmbeddedTableNode(n) &&
        n.ref_type !== "srs_reqs" &&
        n.ref_type !== "srs_reqs_2" &&
        n.ref_type !== "srs_reqds"
    );

    const navChapterNumberMap = extraNavSections.length > 0
        ? computeNavChapterNumberMap(visibleNodes)
        : new Map<string, string>();

    // 递归渲染左目录：展开到子章节都可点击，选中后右侧编辑该章节
    const renderNav = (list: TreeNode[], depth: number): JSX.Element[] => (
        (list || []).filter(isNavChapter).map((node) => {
            const kids = (node.children || []).filter(isNavChapter);
            const hasKids = kids.length > 0;
            const collapsed = navCollapsedIds.has(String(node.id));
            const isActive = !!effectiveNode && String(node.id) === String(effectiveNode.id);
            const chapterNum = navChapterNumberMap.get(String(node.id)) || "";
            const navLabel = `${chapterNum ? `${chapterNum} ` : ""}${stripNavChapterPrefix(node.title) || "(未命名)"}`;
            return (
                <div key={`nav-${node.id}`}>
                    <div
                        className={`srs-nav-item${isActive ? " active" : ""}`}
                        style={{ paddingLeft: 8 + depth * 14 }}
                        onClick={() => setActiveNodeId(node.id)}
                    >
                        {hasKids ? (
                            <span
                                className="srs-nav-caret"
                                onClick={(e) => { e.stopPropagation(); toggleNavCollapse(node.id); }}
                            >
                                {collapsed ? <CaretRightOutlined /> : <CaretDownOutlined />}
                            </span>
                        ) : (
                            <span className="srs-nav-caret-placeholder" />
                        )}
                        <span className="srs-nav-title" title={navLabel}>{navLabel}</span>
                        {!readOnly && (
                            <span className="srs-nav-ops" onClick={(e) => e.stopPropagation()}>
                                {canAddChildInNav(node, depth) && (
                                    <Tooltip title={ts('srs_doc.add_sub_chapter') || '添加子章节'}>
                                        <PlusOutlined
                                            className="srs-nav-add-child"
                                            onClick={() => handleAddChildFromNav(node.id)}
                                        />
                                    </Tooltip>
                                )}
                                <DeleteOutlined
                                    className="srs-nav-delete-child"
                                    title={ts("delete") || "删除章节"}
                                    onClick={() => handleDeleteFromNav(node.id)}
                                />
                            </span>
                        )}
                    </div>
                    {hasKids && !collapsed && renderNav(kids, depth + 1)}
                </div>
            );
        })
    );

    return (
        <>
            <div className="tree-structure-container srs-tree-layout">
                {visibleNodes.length === 0 && extraNavSections.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={ts("srs_doc.empty_directory_structure")}
                        className="tree-structure-empty"
                    />
                ) : (
                    <>
                        <div className="srs-tree-nav">
                            <div className="srs-tree-nav-head">{ts("srs_doc.directory_structure") || ts("srs_doc.directory") || "目录"}</div>
                            {!readOnly && (
                                <div className="srs-tree-nav-hint">封面/修订记录不参与编号；正文章节自动编号。</div>
                            )}
                            <div className="srs-tree-nav-body">
                                {extraNavSections.map((sec) => {
                                    const isActive = !!effectiveExtra && effectiveExtra.key === sec.key;
                                    return (
                                        <div
                                            key={`nav-extra-${sec.key}`}
                                            className={`srs-nav-item${isActive ? " active" : ""}`}
                                            style={{ paddingLeft: 8 }}
                                            onClick={() => setActiveNodeId(`${extraKeyPrefix}${sec.key}`)}
                                        >
                                            <span className="srs-nav-caret-placeholder" />
                                            <span className="srs-nav-title" title={sec.title}>{sec.title}</span>
                                        </div>
                                    );
                                })}
                                {renderNav(visibleNodes, 0)}
                                {!readOnly && onAddRoot && (
                                    <Button
                                        type="dashed"
                                        size="small"
                                        icon={<PlusOutlined />}
                                        className="srs-nav-add-root"
                                        onClick={() => onAddRoot()}
                                    >
                                        {ts('srs_doc.add_root_menu') || '添加根章节'}
                                    </Button>
                                )}
                            </div>
                        </div>
                        <div className="srs-tree-editor">
                            {effectiveExtra ? (
                                <div key={`extra-${effectiveExtra.key}`}>{effectiveExtra.content}</div>
                            ) : effectiveNode ? (
                                <div className="tree-node-item-wrapper" key={effectiveNode.id}>
                                    <TreeNodeItem
                                        node={effectiveNode}
                                        level={0}
                                        renderChildren={false}
                                        disableHierarchyActions
                                        hideLevelPrefix
                                        useNavChapterEditor={!readOnly}
                                        autoNavChapterNo={navChapterNumberMap.get(String(effectiveNode.id)) || ""}
                                        docId={docId}
                                        productId={productId}
                                        docVersion={docVersion}
                                        productVersion={productVersion}
                                        readOnly={readOnly}
                                        rcmOptions={rcmOptions}
                                        onRcmSelectChange={handleRcmSelectChange}
                                        onAdd={handleAdd}
                                        onAddSibling={handleAddSibling}
                                        onDelete={handleDelete}
                                        onTitleChange={handleTitleChange}
                                        onSrsCodeChange={handleSrsCodeChange}
                                        onImageChange={handleImageChange}
                                        onContentChange={handleContentChange}
                                        onAddTable={handleAddTable}
                                        onImportTable={handleImportTable}
                                        onEditTable={handleEditTable}
                                        onDeleteTable={handleDeleteTable}
                                        onOpenSrsTable={onOpenSrsTable}
                                        onOpenReqList={onOpenReqList}
                                        onEditSrsChangeTable={onEditSrsChangeTable}
                                        onDeleteSrsChangeTable={onDeleteSrsChangeTable}
                                        srsReqPreview={srsReqPreview}
                                        reqDetails={reqDetails}
                                        srsReqLoading={srsReqLoading}
                                        existingChangeTableTitles={existingChangeTableTitles}
                                    />
                                </div>
                            ) : (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description={ts("srs_doc.empty_directory_structure")}
                                    className="tree-structure-empty"
                                />
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* 添加/编辑表格弹框 */}
            <EditableTableGenerator
                open={tableModalVisible}
                initialData={initialTableData}
                rcmOptions={rcmOptions}
                lockedRowLabels={lockedTableRowLabels}
                showReqTableHint={showReqTableHint}
                onConfirm={handleTableConfirm}
                onCancel={() => {
                    setTableModalVisible(false);
                    setShowReqTableHint(false);
                    setCurrentNodeId(null);
                    setInitialTableData(undefined);
                    setTableCellsBackup(undefined);
                    setLockedTableRowLabels([]);
                }}
            />
        </>
    );
};
