import "./TreeStructure.less";
import { useState, useEffect } from "react";
import { Button, Input, Space, Popconfirm, Table, Empty, Tooltip, Select, Tag, Upload, message, Image } from "antd";
import { PlusOutlined, DeleteOutlined, TableOutlined, EditOutlined, FileOutlined, UploadOutlined, CaretRightOutlined, CaretDownOutlined } from "@ant-design/icons";
import { numberToChinese } from "@/common";
import { useTranslation } from "react-i18next";
import EditableTableGenerator, { TableDataWithHeaders } from "./EditableTableGenerator";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile, UploadProps } from "antd/es/upload/interface";
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from "xlsx";
import * as Api from "@/api/ApiSrsDoc";

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
function isImgRefType(refType: string | undefined): boolean {
    return !!refType && IMG_REF_TYPES.includes(refType);
}

function isDataUrl(url: string | undefined): boolean {
    return !!url && /^data:/i.test(url);
}

function resolveFileUrl(url: string | undefined): string {
    if (!url) return "";
    if (isDataUrl(url) || url.startsWith("http")) return url;
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

function isReqMainTable(table?: TableData | null): boolean {
    if (!table?.headers?.length) return false;
    const hs = table.headers.map((h) => normalizeCellText(h?.name));
    return hs.some((h) => h.includes("需求编号")) && hs.some((h) => h.includes("功能"));
}

function isReqOtherTable(table?: TableData | null): boolean {
    if (!table?.headers?.length) return false;
    const hs = table.headers.map((h) => normalizeCellText(h?.name));
    return hs.some((h) => h.includes("需求编号")) && hs.some((h) => h.includes("章节"));
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
    "主参加者",
    "前置条件",
    "触发器",
    "工作流",
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

function normalizeReqDisplayText(value: any): string {
    const txt = String(value ?? "").trim();
    if (!txt) return "";
    const invalid = new Set(["/", "\\", "／", "＼", "-", "--", "_", "无", "N/A", "n/a", "NA", "na", "null", "NULL", "None", "none"]);
    return invalid.has(txt) ? "" : txt;
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

function extractSrsCodeFromText(value: any): string {
    const matched = String(value || "").match(/SRS\s*-\s*[A-Z]+\s*\d+\s*-\s*\d+/i);
    return matched ? normalizeSrsCodeValue(matched[0]) : "";
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

function isFunctionalKvTable(table?: TableData | null): boolean {
    if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) return false;
    if (table.headers.length !== 2 || table.rows.length < 3) return false;
    const h1 = normalizeCellText(table.headers[0]?.name);
    const h2 = normalizeCellText(table.headers[1]?.name);
    const fieldHits = table.rows
        .map((row) => normalizeCellText(String(row?.[table.headers![0].code] || "")))
        .filter((txt) => KV_FIELD_LABELS.has(txt)).length;
    // 命中多个“需求详情字段”时，按 Word 里的“左列字段+右列内容”无表头表格渲染
    if (fieldHits >= 3) return true;
    // 兜底：第一行常被误解析成表头（如“需求编号 | SRS-XXX”）
    return KV_FIELD_LABELS.has(h1) && !!h2;
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
    return hName.includes("需求编号") || hCode.includes("srscode") || hCode.includes("srs");
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

function extractImageCaptionAndBody(rawText: string | undefined): { caption: string; body: string } {
    const lines = String(rawText || "").replace(/\r/g, "").split("\n");
    let caption = "";
    const bodyLines: string[] = [];
    lines.forEach((line) => {
        const trimmed = line.trim();
        if (!caption && /^图\s*\d+/.test(trimmed)) {
            caption = trimmed;
            return;
        }
        bodyLines.push(line);
    });
    return { caption, body: bodyLines.join("\n") };
}

interface TreeNodeItemProps {
    node: TreeNode;
    level: number;
    docId?: number;
    readOnly?: boolean;
    rcmOptions: Array<{ value: number; label: string; description?: string }>;
    onRcmSelectChange: (nodeId: number, selectedRcmIds: Array<number | string>) => void;
    onAdd: (parentId: number) => void;
    onAddSibling: (nodeId: number, position: 'before' | 'after', defaultTitle: string) => void;
    onDelete: (id: number) => Promise<void>;
    onTitleChange: (id: number, title: string) => void;
    onSrsCodeChange: (id: number, value: string) => void;
    onImageChange: (id: number, imgUrl: string) => void;
    onContentChange: (id: number, content: string) => void;
    onAddTable: (id: number) => void;
    onImportTable: (id: number, file: File) => Promise<void>;
    onEditTable: (id: number) => void;
    onDeleteTable: (id: number) => void;
    onOpenSrsTable?: () => void;  // 打开 SRS 表弹框
    onOpenReqList?: () => void;   // 打开需求列表弹框
    onEditSrsChangeTable?: (table: { id: number | string; title: string; data: any[]; type_code?: string }) => void;
    onSaveReqDetailTable?: (detail: any) => Promise<void>;
    srsReqPreview?: {
        main: any[];
        other: any[];
        changes: Array<{ id: number | string; title: string; data: any[] }>;
    };
    reqDetails?: any[];
    srsReqLoading?: boolean;
    hideLevelPrefix?: boolean;
    disableHierarchyActions?: boolean;
}

const TreeNodeItem = ({
    node,
    level,
    docId,
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
    srsReqPreview,
    reqDetails,
    srsReqLoading,
    hideLevelPrefix = false,
    disableHierarchyActions = false,
}: TreeNodeItemProps) => {
    const { t: ts } = useTranslation();
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [uploadLoading, setUploadLoading] = useState(false);
    // 新增模板需要直接展示二级/三级结构，避免空模板看起来只剩一级菜单。
    const [expanded, setExpanded] = useState(() => level < 2);
    const embeddedImageNode = (node.children || []).find((child) => isEmbeddedImageNode(child));
    const displayImageUrl = node.img_url || embeddedImageNode?.img_url || "";
    const imageTargetId = embeddedImageNode?.id || node.id;

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
    ].filter((row) => String(row.value || "").trim()));
    const renderReqDetailTable = (detail: any, key: string) => (
        <div className="node-table" key={key}>
            <Table
                size="small"
                bordered
                pagination={false}
                rowKey="field"
                dataSource={reqDetailRows(detail)}
                columns={[
                    { title: "字段", dataIndex: "field", width: 160 },
                    { title: "内容", dataIndex: "value", render: (t: string) => <span style={{ whiteSpace: "pre-line", wordBreak: "break-word" }}>{t || "-"}</span> },
                ]}
            />
        </div>
    );
    const renderChangeTableTitle = (title?: string) => {
        const txt = String(title || "").trim();
        return !txt || /^表格\d+$/.test(txt) ? "变更需求" : txt;
    };
    const buildChangeRowsFromRenderedTable = (table?: TableData | null) => {
        if (!table?.headers?.length || !Array.isArray(table.rows)) return [];
        const headers = table.headers;
        const pickColumn = (matcher: (text: string) => boolean) => (
            headers.find((header) => matcher(normalizeCellText(header?.name)))?.code || ""
        );
        const codeCol = pickColumn((text) => text.includes("需求编号") || text.includes("srscode") || text === "code");
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
    const findChangeTableForRenderedTable = (table?: TableData | null, title?: string) => {
        const changeTables = srsReqPreview?.changes || [];
        const currentTitle = normalizeCellText(renderChangeTableTitle(table?.name || title));
        const titleMatched = changeTables.find((item: any) =>
            normalizeCellText(renderChangeTableTitle(item?.title)) === currentTitle
        );
        if (titleMatched) return titleMatched;
        const renderedCodes = new Set(
            buildChangeRowsFromRenderedTable(table)
                .map((row) => normalizeSrsCode(row.srs_code))
                .filter(Boolean)
        );
        if (renderedCodes.size) {
            const codeMatched = changeTables.find((item: any) =>
                (item?.data || []).some((row: any) => renderedCodes.has(normalizeSrsCode(row?.srs_code || row?.code)))
            );
            if (codeMatched) return codeMatched;
        }
        return changeTables.length === 1 ? changeTables[0] : undefined;
    };
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
    const hasNormalChangeReqTable = orderedNormalTables.some((tbl) => (
        isReqMainTable(tbl.table) &&
        /变更/.test(String(tbl.table?.name || tbl.title || ""))
    ));
    const shouldShowSrsReqPreviewTables = !!(
        (isSrsReqRefNode || isImportedReqTableAnchor) &&
        !(hasNormalMainReqTable || hasNormalOtherReqTable) &&
        srsReqPreview &&
        (
            (srsReqPreview.main || []).length > 0 ||
            (srsReqPreview.other || []).length > 0 ||
            (srsReqPreview.changes || []).length > 0
        )
    );
    const shouldShowChangeReqTables = !!(
        (isSrsReqListNode || (isImportedReqTableAnchor && hasNormalOtherReqTable)) &&
        !hasNormalChangeReqTable &&
        (srsReqPreview?.changes || []).some((table) => (table.data || []).length > 0)
    );
    const shouldMoveOtherReqMarker = readOnly && hasOtherReqMarker && otherReqTableIndex >= 0;
    const imageCaptionData = extractImageCaptionAndBody(node.text);
    const hasDisplayedImage = !!displayImageUrl;
    const displayNodeText = (() => {
        let text = shouldMoveOtherReqMarker ? removeOtherReqMarker(node.text) : (node.text || "");
        if (readOnly && hasDisplayedImage && imageCaptionData.caption) {
            text = imageCaptionData.body;
        }
        return text;
    })();
    const buildSafeSrsMainCells = (table?: TableData | null): TableData["cells"] | undefined => {
        if (!table || !isReqMainTable(table) || !Array.isArray(table.headers) || !Array.isArray(table.rows) || table.rows.length === 0) {
            return table?.cells;
        }
        const headers = table.headers || [];
        const rows = table.rows || [];
        const getColumnIndex = (matcher: (text: string) => boolean) => (
            headers.findIndex((header) => matcher(normalizeCellText(header?.name)))
        );
        const codeColIndex = getColumnIndex((text) => text.includes("需求编号") || text.includes("srscode") || text === "code");
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
        const tableCells = buildSafeSrsMainCells(table) || [];
        // 无表头两列表格优先按“数据行”渲染，避免合并单元格分支吞掉首行（需求编号/SRS）
        const hasMergedCells = !hideHeader && Array.isArray(tableCells) && tableCells.length > 1;
        return table.headers.map((header, index) => {
            const codeCol = isSrsCodeColumn(header);
            const col: any = {
                title: hideHeader ? "" : header.name,
                dataIndex: header.code,
                key: `col_${index}`,
                className: codeCol ? "srs-code-col" : "",
            };
            if (codeCol) {
                col.width = 190;
                col.ellipsis = true;
            }
            if (hasMergedCells) {
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
                    rowObj[header.code] = normalizeReqDisplayText(row?.[colIdx]?.value || "");
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

        const rows: any[] = table.rows.map((row, index) => ({
            key: index,
            ...Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [k, normalizeReqDisplayText(v)]))
        }));
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

    return (
        <div style={{ marginLeft: level * 32 }}>
          <div className={`tree-node-item level-${level}`}>
              <div className={`node-row${hasRcm ? " has-rcm" : ""}${hasRcmText ? " has-rcm-text" : ""}`}>
                  {hasVisibleChildren ? (
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
                  {!readOnly && !disableHierarchyActions && !isLockedReqHierarchyNode && (
                    <Tooltip title={ts('srs_doc.add_sibling_before') || '在前面添加同级节点'}>
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        className="node-add-sibling-btn"
                        onClick={() => onAddSibling(node.id, 'before', node.title)}
                      />
                    </Tooltip>
                  )}
                  {!readOnly && !hideLevelPrefix && (
                      <span className="node-title-prefix">{numberToChinese(level + 1)}{ts('level_menu')}</span>
                  )}
                  {readOnly || isLockedReqHierarchyNode ? (
                      <div className={`node-title${hasRcm ? " with-rcm" : ""}${hasRcmText ? " with-rcm-text" : ""}`}>{node.title || "-"}</div>
                  ) : (
                      <Input
                          className={`node-title${hasRcm ? " with-rcm" : ""}${hasRcmText ? " with-rcm-text" : ""}`}
                          value={node.title}
                          onChange={(e) => onTitleChange(node.id, e.target.value)}
                          placeholder={ts('please_input_title')}
                          disabled={readOnly}
                      />
                  )}
                  {
                    !isAutoReqNode && !isLockedReqDetailCodeNode && ('srs_code' in node) && node.srs_code !== null && (
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
                                  size="small"
                                  style={{ width: "100%", minWidth: 0 }}
                              />
                          )}
                      </div>
                  )}
                  {!isSrsReqRefNode && (
                      readOnly || isLockedReqHierarchyNode ? (
                          <div className="node-content node-text-area">
                              {shouldSplitTextForTables ? removeOtherReqMarker(splitText.intro || "") : displayNodeText}
                          </div>
                      ) : (
                          <Input.TextArea
                              className="node-content node-text-area"
                              value={node.text}
                              onChange={(e) => onContentChange(node.id, e.target.value)}
                              placeholder={ts('srs_doc.please_input_content')}
                              size="small"
                              rows={1}
                              autoSize={{ minRows: 1, maxRows: 6 }}
                              disabled={readOnly}
                          />
                      )
                  )}
                  {isImgRefType(node.ref_type) && (
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
                      <div>
                          {readOnly && hasDisplayedImage && !!imageCaptionData.caption && (
                              <div className="node-content" style={{ marginBottom: 6, textAlign: "center", fontSize: 13, fontWeight: 400 }}>
                                  {imageCaptionData.caption}
                              </div>
                          )}
                          <div className="node-pic node-pic-readonly">
                              <Image
                                  src={resolveFileUrl(displayImageUrl)}
                                  alt={node.title || "image"}
                                  preview={true}
                              />
                          </div>
                      </div>
                  )}
                  {isImgRefType(node.ref_type) && !readOnly && (
                      <Upload {...uploadProps} className="node-pic">
                          <Button size="small" icon={<UploadOutlined />}>
                              {displayImageUrl ? "重新上传" : ts("select_file")}
                          </Button>
                      </Upload>
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
                    <Tooltip title={ts('srs_doc.add_sibling_after') || '在后面添加同级节点'}>
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        className="node-add-sibling-btn"
                        onClick={() => onAddSibling(node.id, 'after', node.title)}
                      />
                    </Tooltip>
                  )}
                  {!readOnly && !disableHierarchyActions && !isLockedReqHierarchyNode && (
                  <Space className="node-actions" size={8}>
                      {
                        level < 2 && (
                        <Button
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => onAdd(node.id)}>
                          {ts('add')}{numberToChinese(level + 2)}{ts('level_menu')}
                        </Button>)
                      }
                      {!(node.ref_type && (isImgRefType(node.ref_type) || node.ref_type === 'srs_reqs' || node.ref_type === 'srs_reqs_2')) && (
                      <Button
                          size="small"
                          icon={<TableOutlined />}
                          onClick={() => onAddTable(node.id)}>
                          {ts('srs_doc.table')}
                      </Button>
                      )}
                      {!(node.ref_type && (isImgRefType(node.ref_type) || node.ref_type === 'srs_reqs' || node.ref_type === 'srs_reqs_2')) && (
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
              {!(node.ref_type && (isImgRefType(node.ref_type) || node.ref_type === 'srs_reqs' || node.ref_type === 'srs_reqs_2')) &&
                orderedNormalTables.map((tbl, idx) => (
                    <div className="node-table" key={tbl.key}>
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
                                        const isChangeReqTable = isReqMainTable(tbl.table) && /变更/.test(String(tbl.table?.name || tbl.title || ""));
                                        if (isChangeReqTable) {
                                            const matchedChangeTable = findChangeTableForRenderedTable(tbl.table, tbl.title);
                                            if (onEditSrsChangeTable) {
                                                onEditSrsChangeTable((matchedChangeTable || {
                                                    id: `node_${tbl.ownerNodeId}`,
                                                    title: renderChangeTableTitle(tbl.table?.name || tbl.title),
                                                    data: buildChangeRowsFromRenderedTable(tbl.table),
                                                }) as any);
                                            } else {
                                                message.error("变更需求表未加载完成，请刷新后重试");
                                            }
                                            return;
                                        }
                                        onEditTable(tbl.ownerNodeId);
                                    }}>
                                    {ts('edit')}
                                </Button>
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
              {shouldShowChangeReqTables && (srsReqPreview?.changes || []).filter((table) => (table.data || []).length > 0).map((table) => (
                  <div className="node-table" key={`srs_change_${table.id}`}>
                      <div style={{ marginBottom: 8, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span>{renderChangeTableTitle(table.title)}</span>
                          {!readOnly && (
                              <Button
                                  size="small"
                                  type="default"
                                  icon={<EditOutlined />}
                                  onClick={() => onEditSrsChangeTable?.(table as any)}
                              >
                                  {ts("edit")}
                              </Button>
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

                      {(srsReqPreview.changes || []).map((table) => (
                          <div key={`srs_preview_change_${table.id}`} style={{ marginTop: 16 }}>
                              <div style={{ marginBottom: 8, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                  <span>{renderChangeTableTitle(table.title)}</span>
                                  {!readOnly && (
                                      <Button
                                          size="small"
                                          type="default"
                                          icon={<EditOutlined />}
                                          onClick={() => onEditSrsChangeTable?.(table as any)}
                                      >
                                          {ts("edit")}
                                      </Button>
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
            {expanded && visibleChildren.map((child) => (
                <TreeNodeItem
                    key={child.id}
                    node={child}
                    level={level + 1}
                    docId={docId}
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
                    srsReqPreview={srsReqPreview}
                    reqDetails={reqDetails}
                    srsReqLoading={srsReqLoading}
                />
            ))}
        </div>
    );
};

interface TreeStructureProps {
    value?: TreeNode[];
    onChange?: (value: TreeNode[]) => void;
    docId?: number;
    hiddenNodeIds?: number[];
    readOnly?: boolean;
    rcmOptions: Array<{ value: number; label: string; description?: string }>;
    onNodeDelete?: (docId: number, nodeId: number) => Promise<boolean>; // 删除节点回调
    onOpenSrsTable?: () => void;  // 打开 SRS 表弹框
    onOpenReqList?: () => void;  // 打开需求列表弹框
    onEditSrsChangeTable?: (table: { id: number | string; title: string; data: any[]; type_code?: string }) => void;
    onSaveReqDetailTable?: (detail: any) => Promise<void>;
    onSaveSrsReqTable?: (table: TableData) => Promise<any[] | void>;
    srsReqPreview?: {
        main: any[];
        other: any[];
        changes: Array<{ id: number | string; title: string; data: any[] }>;
    };
    reqDetails?: any[];
    srsReqLoading?: boolean;
    onNodesSnapshot?: (nodes: TreeNode[]) => void;
    enableStandardReqAutoSync?: boolean;
}

export default ({ value = [], onChange, docId, hiddenNodeIds = [], readOnly, rcmOptions, onNodeDelete, onOpenSrsTable, onOpenReqList, onEditSrsChangeTable, onSaveReqDetailTable, onSaveSrsReqTable, srsReqPreview, reqDetails, srsReqLoading, onNodesSnapshot, enableStandardReqAutoSync = false }: TreeStructureProps) => {
    const { t: ts } = useTranslation();
    const [nodes, setNodes] = useState<TreeNode[]>(value);
    const [tableModalVisible, setTableModalVisible] = useState(false);
    const [currentNodeId, setCurrentNodeId] = useState<number | null>(null);
    const [initialTableData, setInitialTableData] = useState<TableDataWithHeaders | undefined>(undefined);
    const [tableCellsBackup, setTableCellsBackup] = useState<TableData["cells"] | undefined>(undefined);
    const [lockedTableRowLabels, setLockedTableRowLabels] = useState<string[]>([]);

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
            { [leftCode]: "需求概述", [rightCode]: detail?.overview || "" },
            { [leftCode]: "主参加者", [rightCode]: detail?.participant || "" },
            { [leftCode]: "前置条件", [rightCode]: detail?.pre_condition || "" },
            { [leftCode]: "触发器", [rightCode]: detail?.trigger || "" },
            { [leftCode]: "事件流", [rightCode]: detail?.work_flow || "" },
            { [leftCode]: "后置条件", [rightCode]: detail?.post_condition || "" },
            { [leftCode]: "异常情况", [rightCode]: detail?.exception || "" },
            { [leftCode]: "约束", [rightCode]: detail?.constraint || "" },
        ];
        const keyedRows = reqDetailKey
            ? rows.map((row) => ({ ...row, [REQ_DETAIL_KEY_FIELD]: reqDetailKey }))
            : rows;
        return {
            show_header: 1,
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
    const syncImportedReqDetailCodes = (items: TreeNode[], standardDetails: any[] = [], ancestors: TreeNode[] = []): TreeNode[] => {
        if (!standardDetails.length) return items || [];
        const parentTitle = normalizeTitleText(stripHeadingNumber(ancestors[ancestors.length - 1]?.title));
        const orderedParentDetails = parentTitle
            ? (standardDetails || []).filter((detail: any) => normalizeTitleText(detail?.module) === parentTitle)
            : [];
        let functionalSiblingIndex = 0;
        const syncedItems: Array<TreeNode | null> = (items || []).map((node): TreeNode | null => {
            let children = syncImportedReqDetailCodes(node.children || [], standardDetails, [...ancestors, node]);
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
            const titleMatched = orderMatched || childMatched;
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
        const matched = title.match(/^(\d+(?:\.\d+)*)\s+(.*)$/);
        if (matched && (matched[1] === oldPrefix || matched[1].startsWith(`${oldPrefix}.`))) {
            const suffix = matched[1] === oldPrefix ? "" : matched[1].slice(oldPrefix.length);
            node.title = `${newPrefix}${suffix} ${matched[2]}`;
        }
        (node.children || []).forEach((child) => replaceHeadingPrefix(child, oldPrefix, newPrefix));
    };
    const renumberDirectHeadingChildren = (children: TreeNode[], parentPrefix: string) => {
        const childDepth = parentPrefix.split(".").length + 1;
        let nextNo = 1;
        (children || []).forEach((child) => {
            const matched = String(child.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/);
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
                    const codeCol = pickColumn(headers, (text) => text.includes("需求编号") || text.includes("srscode") || text === "code");
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
                    const codeCol = pickColumn(headers, (text) => text.includes("需求编号") || text.includes("srscode") || text === "code");
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
                    return false;
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
    const syncOtherReqCodesToChapters = (items: TreeNode[], otherDetails: any[] = []): TreeNode[] => {
        if (!otherDetails.length) return items || [];
        const byModule = new Map<string, string>();
        const byLocation = new Map<string, string>();
        otherDetails.forEach((detail: any) => {
            const code = normalizeSrsCode(detail?.code);
            if (!code) return;
            const moduleKey = normalizeTitleText(detail?.module);
            if (moduleKey) byModule.set(moduleKey, code);
            const locationKey = String(detail?.location || "").trim().match(/^(\d+)/)?.[1] || "";
            if (locationKey) byLocation.set(locationKey, code);
        });
        return (items || []).map((node) => {
            const headingDepth = getHeadingDepth(node.title);
            const titleKey = normalizeTitleText(stripHeadingNumber(node.title));
            const headingNo = String(node.title || "").trim().match(/^(\d+)/)?.[1] || "";
            const matchedCode = headingDepth === 1
                ? (byModule.get(titleKey) || byLocation.get(headingNo) || "")
                : "";
            return {
                ...node,
                ...(matchedCode ? { srs_code: matchedCode } : {}),
                children: syncOtherReqCodesToChapters(node.children || [], otherDetails),
            };
        });
    };
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
            if (isReqMainTable(table) && /变更/.test(String(table?.name || node.title || ""))) {
                const tableTitle = normalizeTitle(table?.name || node.title || "");
                const matchedPreview = previewTables.find((preview: any) => normalizeTitle(preview?.title) === tableTitle) ||
                    (previewTables.length === 1 ? previewTables[0] : undefined);
                if (matchedPreview) {
                    const headers = table?.headers || [];
                    const codeCol = getColumnCode(headers, (text) => text.includes("需求编号") || text.includes("srscode") || text === "code");
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
        const previewOtherDetails = enableStandardReqAutoSync ? buildPreviewOtherDetails() : [];
        const previewSyncedNodeList = syncChangeReqTablesFromPreview(nodeList || []);
        const initialTableDetails = collectReqRowsFromTreeTables(previewSyncedNodeList || []);
        const tableOtherDetails = enableStandardReqAutoSync
            ? initialTableDetails.filter((detail: any) => String(detail?.type_code || "") === "2")
            : [];
        const syncedNodeList = syncOtherReqCodesToChapters(previewSyncedNodeList, [...tableOtherDetails, ...previewOtherDetails]);
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
        setNodes(enableStandardReqAutoSync ? syncReqDetailsToTree(withRcm, reqDetails || []) : withRcm);
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

        // 如果节点有 n_id（已保存到后端），则调用删除API
        if (nodeToDelete?.n_id && docId && onNodeDelete) {
            const success = await onNodeDelete(docId, nodeToDelete.n_id);
            if (!success) return; // 删除失败，不更新前端状态
        }

        const newNodes = deleteNode(nodes, id);
        updateNodes(newNodes);
    };

    const handleTitleChange = (id: number, title: string) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            title
        }));
        updateNodes(newNodes);
    };

    const handleSrsCodeChange = (id: number, srs_code: string) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            srs_code
        }));
        updateNodes(newNodes);
    };

    const handleContentChange = (id: number, text: string) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => {
            if (!Array.isArray(node.rcm_codes)) {
                return {
                    ...node,
                    text,
                };
            }
            const extracted = extractRcmCodesFromText(text);
            const current = (node.rcm_codes || []).map((c) => normalizeRcmCode(c));
            const merged = Array.from(new Set([...current, ...extracted])).filter(Boolean);
            return {
                ...node,
                text,
                rcm_codes: merged,
            };
        });
        updateNodes(newNodes);
    };

    const handleImageChange = (id: number, img_url: string) => {
        const updateImageById = (nodeList: TreeNode[]): TreeNode[] => {
            return nodeList.map((node) => {
                const sameNode = String(node.id) === String(id) || String(node.n_id ?? "") === String(id);
                if (sameNode) {
                    return { ...node, img_url };
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
        const codeCol = pickColumnCode((text) => text.includes("需求编号") || text.includes("srscode") || text === "code");
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

    const handleDeleteTable = (id: number) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            table: {}
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
            const codeColIndex = getColumnIndex((text) => text.includes("需求编号") || text.includes("srscode") || text === "code");
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
                // 存储完整的表头对象（包含code和name）
                headers: tableData.headers.map(header => ({
                    code: header.code,
                    name: header.name.trim()
                })),
                rows: rows,
                cells: mergedCells,
            };
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
                const value = String(row[rightCode] || "");
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
        const isSavingStandardSrsTable = !!(tableFormat && isReqMainTable(tableFormat) && !/变更/.test(String(tableFormat.name || "")));
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
                const previousKeyAtSameIndex = rowIndex < previousStandardDetails.length
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
            details.forEach((detail: any, index: number) => {
                const rowIndex = getReqRowIndex(detail, index);
                const canReuseByRowIndex = rowIndex < previousStandardDetails.length;
                const composite = getReqDetailKey(detail);
                const code = normalizeSrsCode(detail?.code);
                let stableKey = getReqStableKey(detail) ||
                    previousKeyByComposite.get(composite) ||
                    (previousKeySet.has(composite) ? bindings.keyByComposite.get(composite) : "") ||
                    (previousKeySet.has(composite) && code ? previousKeyByCodeStrict.get(code) : "") ||
                    (previousKeySet.has(composite) && code ? bindings.keyByCodeOrder.get(getSrsCodeOrderKey(code)) : "") ||
                    (canReuseByRowIndex ? previousStableKeyByIndex.get(rowIndex) : "") ||
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
        ensureStableReqDetailKeys(standardDetailsForIdentitySync, tableFormat);
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
            const walk = (list: TreeNode[], ancestors: TreeNode[] = []): TreeNode[] => (list || []).map((node) => {
                const headingDepth = getHeadingDepth(node.title);
                const childMatch = headingDepth > 1 ? (node.children || [])
                    .map((child) => pickMatchedDetail(child, [...ancestors, node]))
                    .find(Boolean) : undefined;
                const children = walk(node.children || [], [...ancestors, node]);
                const ownMatch = pickMatchedDetail(node, ancestors);
                const match = ownMatch || childMatch;
                if (!match?.detail) {
                    return { ...node, children };
                }
                const detail = match.detail;
                const nextName = getNextTitleName(node, detail, match.matchedKey, !!ownMatch);
                const titlePrefix = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*\s+)/)?.[1] || "";
                const shouldUpdateTitle = !!nextName && !!titlePrefix && (
                    (headingDepth > 1 && isFunctionalKvTable(node.table)) ||
                    (headingDepth > 1 && node.label === "__auto_req_detail") ||
                    (headingDepth > 1 && (node.children || []).some((child) => isFunctionalKvTable(child.table)))
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
            type PreservedDetail = { node: TreeNode; table?: TableData | null; score: number };
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
            const headingMap = new Map<string, TreeNode>();
            let reqRoot: TreeNode | undefined;
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
                        const key = getExistingReqDetailKey({ ...node, table: normalizedTable }, ancestors);
                        const score = scoreFunctionalTable(normalizedTable);
                        const current = preservedByKey.get(key);
                        if (key.replace(/\|/g, "") && (!current || score > current.score)) {
                            preservedByKey.set(key, { node, table: normalizedTable, score });
                        }
                        const rootAncestor = ancestors.find((item) => getHeadingDepth(item.title) === 1);
                        if (!reqRoot && rootAncestor) reqRoot = rootAncestor;
                    }
                    walkExisting(node.children || [], [...ancestors, node]);
                });
            };
            walkExisting(cloned);
            if (!reqRoot) {
                reqRoot = cloned.find((node) => getHeadingDepth(node.title) === 1) || cloned[0];
            }
            if (!reqRoot) return cloned;
            const rootPrefix = String(reqRoot.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "1";
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
                const preserved = preservedByKey.get(key);
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
            const sortedDetails = [...details].sort((left, right) => compareSrsCodes(left?.code, right?.code));
            sortedDetails.forEach((detail) => {
                const moduleText = normalizeReqDisplayText(detail?.module || detail?.name || detail?.function || detail?.code);
                const functionText = normalizeReqDisplayText(detail?.function);
                const subFunctionText = normalizeReqDisplayText(detail?.sub_function);
                if (!moduleText) return;
                const moduleKey = normalizeTitleText(moduleText);
                let moduleNode = moduleMap.get(moduleKey);
                if (!moduleNode) {
                    const moduleNo = rebuiltChildren.length + 1;
                    const title = `${rootPrefix}.${moduleNo} ${moduleText}`;
                    moduleNode = makeNode(title, reqRoot!, moduleKey);
                    moduleMap.set(moduleKey, moduleNode);
                    rebuiltChildren.push(moduleNode);
                }
                const detailKey = getReqDetailKey(detail);
                if (!functionText) {
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
            reqRoot.children = rebuiltChildren;
            return cloned;
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
        const isSavingReqDetailTable = !!reqDetailPayload;
        const nextNodes = isSavingStandardSrsTable
            ? stripIgnoredReqDetailTables(sortReqDetailSiblingsBySrsCode(dedupeReqDetailsByKey(appendMissingStandardReqDetails(
                syncExistingReqIdentity(newNodes, standardDetailsForIdentitySync),
                standardDetailsForIdentitySync
            ), standardDetailsForIdentitySync)))
            : (isSavingReqDetailTable ? newNodes : syncReqDetailsToTree(newNodes, reqDetails || [], true));
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

    return (
        <>
            <div className="tree-structure-container">
                {visibleNodes.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={ts("srs_doc.empty_directory_structure")}
                        className="tree-structure-empty"
                    />
                ) : visibleNodes.map((node) => (
                  <div key={`content-node-${node.id}`}>
                      <div className="tree-node-item-wrapper" key={node.id}>
                        <TreeNodeItem
                            node={node}
                            level={0}
                            docId={docId}
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
                            srsReqPreview={srsReqPreview}
                            reqDetails={reqDetails}
                            srsReqLoading={srsReqLoading}
                        />
                      </div>
                  </div>
                ))}
            </div>

            {/* 添加/编辑表格弹框 */}
            <EditableTableGenerator
                open={tableModalVisible}
                initialData={initialTableData}
                rcmOptions={rcmOptions}
                lockedRowLabels={lockedTableRowLabels}
                onConfirm={handleTableConfirm}
                onCancel={() => {
                    setTableModalVisible(false);
                    setCurrentNodeId(null);
                    setInitialTableData(undefined);
                    setTableCellsBackup(undefined);
                    setLockedTableRowLabels([]);
                }}
            />
        </>
    );
};
