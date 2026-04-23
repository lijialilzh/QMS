import "./TreeStructure.less";
import { useState, useEffect } from "react";
import { Button, Input, Space, Popconfirm, Upload, Table, message, Empty, Tooltip, Image } from "antd";
import { PlusOutlined, DeleteOutlined, TableOutlined, EditOutlined, UploadOutlined, FileOutlined, CaretRightOutlined, CaretDownOutlined, CloseOutlined } from "@ant-design/icons";
import { numberToChinese } from "@/common";
import { useTranslation } from "react-i18next";
import EditableTableGenerator, { TableDataWithHeaders } from "./EditableTableGenerator";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile, UploadProps } from "antd/es/upload/interface";
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from "xlsx";
import * as Api from "@/api/ApiSdsDoc";

// 表格数据结构（匹配后端接口，允许空对象表示无表格数据）
interface TableData {
    headers?: Array<{ code: string; name: string }>;
    rows?: { [key: string]: string }[];
    cells?: Array<Array<{ value?: string; row_span?: number; col_span?: number; h_align?: string; v_align?: string }>>;
}

export interface TreeNode {
    id: number;          
    doc_id?: number;
    n_id?: number;
    p_id?: number;
    title: string;
    label?: string;
    sds_code?: string;   // 标准模板中需填写 SDS 编码的节点（有该字段则显示输入框，空也显示）
    ref_type?: string;   // topo_1=拓扑图、struct_1=系统结构图 时展示页面级图片，不展示上传和 textarea
    img_url?: string;
    text?: string;
    table?: TableData | null; // 允许空对象/ null 表示无表格数据
    children: TreeNode[];
}

const SDS_REF_TYPE_LABEL_KEYS: Record<string, string> = {
    img_topo: 'sds_doc.ref_type_topo',
    img_struct: 'sds_doc.ref_type_struct',
    img_flow: 'sds_doc.ref_type_flow',
};

function getSdsRefTypeLabel(refType: string | undefined, ts: (key: string) => string): string {
    if (!refType) return '';
    return ts(SDS_REF_TYPE_LABEL_KEYS[refType] || refType);
}

const SDS_IMAGE_REF_TYPES = ['img_topo', 'img_struct', 'img_flow'];
function isDocImageRefType(refType: string | undefined): boolean {
    return !!refType && SDS_IMAGE_REF_TYPES.includes(refType);
}

function getFileNameFromUrl(url: string | undefined): string {
    if (!url) return "";
    const raw = String(url).split("?")[0];
    const seg = raw.split("/").filter(Boolean).pop() || "";
    try {
        return decodeURIComponent(seg).replace(/\.[^.]+$/, "");
    } catch {
        return seg.replace(/\.[^.]+$/, "");
    }
}

interface TreeNodeItemProps {
    node: TreeNode;
    level: number;
    chapterNo?: string;
    docId?: number;
    readOnly?: boolean;
    captionFromParent?: string;
    tableCaptionFromParent?: string;
    onAdd: (parentId: number) => void;
    onAddSibling: (nodeId: number, position: 'before' | 'after', defaultTitle: string) => void;
    onDelete: (id: number) => Promise<void>;
    onTitleChange: (id: number, title: string) => void;
    onSdsCodeChange: (id: number, value: string) => void;
    onImageChange: (id: number, imgUrl: string) => void;
    onContentChange: (id: number, content: string) => void;
    onAddTable: (id: number) => void;
    onImportTable: (id: number, file: File) => Promise<void>;
    onEditTable: (id: number) => void;
    onDeleteTable: (id: number) => void;
    onOpenReqdList?: () => void;   // 打开设计列表弹框（ref_type=sds_reqds）
    onOpenTraceList?: () => void;  // 打开需求追溯表弹框（ref_type=sds_traces）
    readOnlyChapterOffset?: number;
}

function isUuidLike(text: string): boolean {
    const value = String(text || "").trim();
    if (!value) return false;
    return /^[0-9a-f]{32}$/i.test(value) || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function isSystemPlaceholderTitle(text: string): boolean {
    const value = String(text || "").trim();
    return /^导入(?:图片|表格)\d*$/.test(value) || isUuidLike(value);
}

function shouldAssignChapterNo(node: TreeNode): boolean {
    const title = String(node.title || "").trim();
    const label = String(node.label || "").trim();
    if (label) return true;
    if (!title) return false;
    if (isSystemPlaceholderTitle(title)) return false;
    if (isStrictTableCaptionTitle(title)) return false;
    return true;
}

function isImageNodeOnly(node: TreeNode): boolean {
    const hasTable = !!(node.table && Array.isArray(node.table.headers) && node.table.headers.length > 0);
    return !!node.img_url && !node.text && !hasTable && (!node.children || node.children.length === 0);
}

function hasTableInSubtree(node: TreeNode | undefined): boolean {
    if (!node) return false;
    const hasTable = hasRenderableTable(node.table);
    if (hasTable) return true;
    return (node.children || []).some((child) => hasTableInSubtree(child));
}

function hasRenderableTable(table?: TableData | null): boolean {
    if (!table || !Array.isArray(table.headers) || table.headers.length === 0) return false;
    const hasRows = Array.isArray(table.rows) && table.rows.length > 0;
    const hasCells = Array.isArray(table.cells) && table.cells.length > 1;
    return hasRows || hasCells;
}

function extractImageCaptions(rawText: string | undefined): string[] {
    return String(rawText || "")
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^图\s*\d+/.test(line));
}

function isLikelyTableCaptionLine(line: string): boolean {
    const txt = String(line || "").trim();
    if (!txt) return false;
    if (/^(表|table)\s*\d+/i.test(txt)) return true;
    if (/^图\s*\d+/i.test(txt)) return false;
    if (/^[A-Za-z][A-Za-z0-9_]{1,64}\s*[:：]\s*.+$/.test(txt)) return true;
    if (/[:：]/.test(txt) && txt.length <= 80 && !/[。！？]$/.test(txt)) return true;
    return false;
}

function isStrictTableCaptionTitle(line: string): boolean {
    const txt = String(line || "").trim();
    if (!txt) return false;
    return /^(表|table)\s*\d+/i.test(txt);
}

function normalizeKeywordText(value?: string): string {
    return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function extractSdsCodeToken(text?: string): string {
    const raw = String(text || "")
        .replace(/[\u00a0\u2002\u2003\u2009]/g, " ")
        .replace(/[－–—]/g, "-")
        .replace(/[：]/g, ":")
        .replace(/Ｓ/g, "S")
        .replace(/Ｄ/g, "D")
        .replace(/ｓ/g, "s")
        .replace(/ｄ/g, "d");
    const matched = raw.match(/S\s*D\s*S\s*[-_:：]?\s*[A-Za-z0-9]+(?:\s*[._-]\s*[A-Za-z0-9]+)*/i);
    if (!matched) return "";
    const normalized = String(matched[0] || "")
        .replace(/\s+/g, "")
        .replace(/[－–—]/g, "-")
        .replace(/[:：_]/g, "-")
        .toUpperCase();
    const tail = normalized.replace(/^SDS-?/, "");
    return tail ? `SDS-${tail}` : "";
}

function extractCodeAfterDesignMarker(text?: string): string {
    const raw = String(text || "")
        .replace(/[\u00a0\u2002\u2003\u2009]/g, " ")
        .replace(/[：]/g, ":")
        .replace(/[－–—]/g, "-");
    const markerMatch = raw.match(/设\s*计\s*编\s*号\s*:?\s*([\s\S]{0,120})/);
    if (!markerMatch) return "";
    const chunk = String(markerMatch[1] || "").trim();
    const sdsCode = extractSdsCodeToken(chunk);
    if (sdsCode) return sdsCode;
    // 兜底：即使不是标准 SDS，也先把“设计编号”后的首段文本放进 SDS 输入框
    const fallback = chunk
        .split(/\n/)
        .map((line) => String(line || "").trim())
        .filter(Boolean)[0] || "";
    return fallback.replace(/\s+/g, "").toUpperCase();
}

function extractSdsCodeFromNodeText(text?: string): { code: string; nextText: string } {
    const raw = String(text || "");
    const normalizedRaw = raw
        .replace(/[\u00a0\u2002\u2003\u2009]/g, " ")
        .replace(/[：]/g, ":")
        .replace(/[－–—]/g, "-");
    const lines = raw.replace(/\r/g, "").split("\n");
    if (lines.length === 0) return { code: "", nextText: raw };
    // 先走全量兜底：按“设计编号”标识后截取，再提取 SDS token
    const markerMatched = normalizedRaw.match(/设\s*计\s*编\s*号/);
    const markerIdx = markerMatched ? markerMatched.index ?? -1 : -1;
    if (markerIdx >= 0) {
        const markerTail = normalizedRaw.slice(markerIdx);
        const maybeCode = extractCodeAfterDesignMarker(markerTail) || extractSdsCodeToken(markerTail);
        if (maybeCode) {
            let nextText = raw.replace(/设计编号[\s\S]{0,80}?S\s*D\s*S\s*[-－–—]\s*[A-Za-z0-9._-]+(?:\s*[-_]\s*[A-Za-z0-9._-]+)*/i, "");
            if (nextText === raw) {
                nextText = raw.replace(/设\s*计\s*编\s*号[\s\S]{0,120}/, "");
            }
            nextText = nextText.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
            return { code: maybeCode, nextText };
        }
    }
    for (let i = 0; i < lines.length; i++) {
        const line = String(lines[i] || "").trim();
        const matched = line.match(/设计编号\s*[：:]?\s*(.*)$/);
        if (!matched) continue;
        let consumedCount = 1;
        const mergedChunks: string[] = [String(matched[1] || "").trim()];
        for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
            const nextLine = String(lines[j] || "").trim();
            if (!nextLine) break;
            // 遇到新段落标题时停止，避免吞正文
            if (/^\d+(?:\.\d+)*[\s、.．]/.test(nextLine) || /^(图|表)\s*\d+/.test(nextLine)) break;
            mergedChunks.push(nextLine);
            consumedCount += 1;
            if (extractSdsCodeToken(mergedChunks.join("\n"))) break;
        }
        const mergedText = mergedChunks.join("\n").trim();
        let code = extractSdsCodeToken(mergedText);
        if (!code) {
            // 按“设计编号”标识做兜底：即使不是标准 SDS 格式也先回填到 SDS 输入框，避免留空
            const fallback = mergedText
                .replace(/^[:：\s-]+/, "")
                .replace(/\s+/g, "")
                .toUpperCase();
            if (fallback) {
                code = fallback;
            }
        }
        if (!code) return { code: "", nextText: raw };
        const remained = lines.filter((_row, idx) => idx < i || idx >= (i + consumedCount));
        const nextText = remained.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
        return { code, nextText };
    }
    return { code: "", nextText: raw };
}

function inferDataTableDisplayTitle(node: TreeNode): string {
    const headers = (node.table?.headers || [])
        .map((h: any) => `${String(h?.code || "")} ${String(h?.name || "")}`)
        .join(" ");
    const rows = (node.table?.rows || [])
        .map((row: any) => Object.values(row || {}).map((v) => String(v || "")).join(" "))
        .join(" ");
    const merged = normalizeKeywordText(`${node.title || ""} ${node.text || ""} ${headers} ${rows}`);
    const valueTokens = new Set(
        String(`${headers} ${rows}`)
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, " ")
            .split(/\s+/)
            .filter(Boolean)
    );

    const hasAny = (...keys: string[]) => keys.some((k) => merged.includes(k) || valueTokens.has(k));
    if (merged.includes("clinical_stage") || merged.includes("clinicalstage") || merged.includes("clinial_stage") || merged.includes("clinialstage") || merged.includes("分期")) {
        return "clinical_stage: 分期表";
    }
    if (hasAny("eng_name", "is_default", "level", "等级", "是否默认", "英文名称")) {
        return "clinical_stage: 分期表";
    }
    if (merged.includes("departmentnotice") || merged.includes("department_notice") || merged.includes("科室通知")) {
        return "department: 科室通知";
    }
    if (hasAny("notice_title", "notice_content", "notice_type", "通知标题", "通知内容", "通知类型")) {
        return "department: 科室通知";
    }
    if (merged.includes("department") || merged.includes("departement") || merged.includes("科室")) {
        return "department: 科室表";
    }
    if (hasAny(
        "department_code",
        "departmentcode",
        "diagnose_nums",
        "diagnose_num",
        "diagnosenums",
        "solutions",
        "科室代码",
        "判断数量",
        "解决方案"
    )) {
        return "department: 科室表";
    }
    const snakeCaseToken = Array.from(valueTokens).find((token) => /^[a-z]+(?:_[a-z0-9]+)+$/.test(token));
    if (snakeCaseToken) {
        return `${snakeCaseToken}: 数据表`;
    }
    return "";
}

function isSyntheticTableCaption(value?: string): boolean {
    const txt = String(value || "").trim().toLowerCase();
    if (!txt) return false;
    if (/^col_\d+\s*[:：]/.test(txt)) return true;
    if (/^col_\d+$/.test(txt)) return true;
    if (/^数据表\d*$/.test(txt)) return true;
    return false;
}

function isInterfaceLikeTable(node: TreeNode): boolean {
    const titleText = normalizeKeywordText(`${node.title || ""} ${node.text || ""}`);
    const headerText = normalizeKeywordText(
        (node.table?.headers || []).map((h: any) => `${String(h?.code || "")} ${String(h?.name || "")}`).join(" ")
    );
    const merged = `${titleText} ${headerText}`;
    return merged.includes("接口")
        || merged.includes("接口url")
        || merged.includes("接口设计编号")
        || merged.includes("sds-if");
}

function pickTableCaptions(rawText: string | undefined, tableCount: number): { captions: string[]; body: string } {
    const lines = String(rawText || "").replace(/\r/g, "").split("\n");
    if (tableCount <= 0) {
        return { captions: [], body: lines.join("\n") };
    }
    const entries = lines
        .map((line, index) => ({ line: String(line || "").trim(), index }))
        .filter((item) => isLikelyTableCaptionLine(item.line));
    const selected = entries.slice(-tableCount);
    const selectedIndexSet = new Set(selected.map((item) => item.index));
    const body = lines.filter((_line, index) => !selectedIndexSet.has(index)).join("\n");
    return {
        captions: selected.map((item) => item.line),
        body,
    };
}

function getInlineHeadingType(line: string): "" | "h2" | "h3" | "h4" {
    const txt = String(line || "").trim();
    if (!txt) return "";
    const chapterMatch = txt.match(/^(\d+(?:\.\d+)+)\s+\S+/);
    if (chapterMatch) {
        const segCount = chapterMatch[1].split(".").length;
        if (segCount <= 2) return "h2";
        if (segCount === 3) return "h3";
        return "h4";
    }
    if (/^[（(]\d+[）)]\s*\S+/.test(txt)) {
        return "h4";
    }
    return "";
}

function shiftChapterMajor(chapter: string, offset: number): string {
    const txt = String(chapter || "").trim();
    if (!txt || offset <= 0) return txt;
    const m = txt.match(/^(\d+)(.*)$/);
    if (!m) return txt;
    const major = Number(m[1]);
    if (!Number.isFinite(major)) return txt;
    const nextMajor = major - offset;
    if (nextMajor <= 0) return txt;
    return `${nextMajor}${m[2] || ""}`;
}

const TreeNodeItem = ({ node, level, chapterNo, docId, readOnly, captionFromParent, tableCaptionFromParent, onAdd, onAddSibling, onDelete, onTitleChange, onSdsCodeChange, onImageChange, onContentChange, onAddTable, onImportTable, onEditTable, onDeleteTable, onOpenReqdList, onOpenTraceList, readOnlyChapterOffset = 0 }: TreeNodeItemProps) => {
    const { t: ts } = useTranslation();
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [uploadLoading, setUploadLoading] = useState(false);
    // 性能优化：默认仅展开前两级，减少初始渲染压力
    const [expanded, setExpanded] = useState(level <= 0);
    const normalizedNodeSdsCode = String(node.sds_code ?? "").trim();
    const sdsCodeFallbackFromText = extractSdsCodeFromNodeText(node.text);
    const resolvedSdsCode = normalizedNodeSdsCode || extractCodeAfterDesignMarker(node.text) || extractSdsCodeToken(node.text) || sdsCodeFallbackFromText.code;

    // 当节点的 img_url 变化时，更新 fileList
    useEffect(() => {
        if (node.img_url) {
            setFileList([{
                uid: '-1',
                name: 'image.png',
                status: 'done',
                url: `${window.location.origin}/${node.img_url}`,
            }]);
        } else {
            setFileList([]);
        }
    }, [node.img_url]);

    // 图片上传配置（Upload 无 loading 属性，通过 disabled 在上传时禁用）
    const uploadProps: UploadProps = {
        maxCount: 1,
        fileList: fileList,
        disabled: uploadLoading,
        beforeUpload: async (file) => {
            try {
                setUploadLoading(true);
                const formData = new FormData();
                formData.append('file', file);
                formData.append('doc_id', String(docId ?? 0));
                
                // 调用add_doc_file接口上传图片
                const res = await Api.add_doc_file(formData); // 第一个参数根据实际fileType调整
                if (res.code === Api.C_OK || res.code === 1) { // 兼容1表示成功的情况
                    const imgUrl = res.data; // 接口返回的data就是图片服务器地址
                    onImageChange(node.id, imgUrl);
                    setFileList([{
                        uid: file.uid,
                        name: file.name,
                        status: 'done',
                        url: `${window.location.origin}/${imgUrl}`
                    }]);
                    message.success(ts('upload_success'));
                } else {
                    message.error(res.msg || ts('upload_failed'));
                }
            } catch (error) {
                console.error('图片上传失败:', error);
                message.error(ts('upload_failed'));
            } finally {
                setUploadLoading(false);
            }
            return false; // 阻止自动上传
        },
        onRemove: () => {
            onImageChange(node.id, '');
            setFileList([]);
        },
        accept: "image/*",
        showUploadList: false,
    };

    const tableImportProps: UploadProps = {
        showUploadList: false,
        accept: ".xlsx,.xls,.csv,text/csv",
        beforeUpload: async (file) => {
            await onImportTable(node.id, file as File);
            return false;
        },
    };

    // 构建表格列配置：列少时加大列宽，列多时缩小并启用横向滚动
    const buildTableColumns = (targetTable?: TableData | null): ColumnsType<any> => {
        const table = targetTable || node.table;
        if (!table || !table.headers || table.headers.length === 0) {
            return [];
        }
        const tableCells = table.cells || [];
        const hasMergedCells = Array.isArray(tableCells) && tableCells.length > 1;
        const colCount = table.headers.length;
        const colWidth = Math.max(150, Math.min(380, 1200 / colCount));
        return table.headers.map((header, index) => {
            const col: any = {
                title: header.name,
                dataIndex: header.code,
                key: `col_${index}`,
                width: readOnly ? undefined : colWidth,
            };
            if (hasMergedCells) {
                col.render = (_val: any, _row: any, rowIndex: number) => {
                    const bodyCells = tableCells.slice(1);
                    const cell = bodyCells[rowIndex]?.[index];
                    const rowSpan = cell?.row_span ?? 1;
                    const colSpan = cell?.col_span ?? 1;
                    const hAlign = (cell?.h_align || "left") as "left" | "center" | "right";
                    const vAlign = (cell?.v_align || "top") as "top" | "middle" | "bottom";
                    return {
                        children: <div className="table-cell-content">{cell?.value || ""}</div>,
                        props: { rowSpan, colSpan, style: { textAlign: hAlign, verticalAlign: vAlign } },
                    };
                };
            } else {
                col.render = (val: any) => <div className="table-cell-content">{val || ""}</div>;
            }
            return col;
        });
    };

    // 构建表格数据源
    const buildTableDataSource = (targetTable?: TableData | null) => {
        const table = targetTable || node.table;
        if (!table || !table.headers || table.headers.length === 0) {
            return [];
        }
        const tableCells = table.cells || [];
        const hasMergedCells = Array.isArray(tableCells) && tableCells.length > 1;
        if (hasMergedCells && table.headers) {
            const bodyCells = tableCells.slice(1);
            return bodyCells.map((row, rowIndex) => {
                const rowObj: any = { key: rowIndex };
                table!.headers!.forEach((header, colIdx) => {
                    rowObj[header.code] = row?.[colIdx]?.value || "";
                });
                return rowObj;
            });
        }
        if (!table.rows || table.rows.length === 0) {
            return [];
        }

        return table.rows.map((row, index) => ({
            key: index,
            ...row
        }));
    };

    const title = String(node.title || "").trim();
    const normalizedTitle = title.replace(/^[\s\u3000•·▪■◆●○□◇\-–—]+/, "").trim();
    const chapterMatch = normalizedTitle.match(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))?(.*)$/);
    const chapterFromDoc = chapterMatch ? chapterMatch[1] : "";
    const displayChapterFromDoc = readOnly ? shiftChapterMajor(chapterFromDoc, readOnlyChapterOffset) : chapterFromDoc;
    const titleWithoutChapter = chapterMatch ? (chapterMatch[2] || "").trim() : normalizedTitle;
    const effectiveChapter = String(chapterFromDoc || (readOnly ? chapterNo || "" : "")).trim();
    const isInterfaceSubSection = !!(
        readOnly &&
        /^\d+\.\d+\.\d+(?:\.\d+)*$/.test(effectiveChapter)
    );

    const hasTable = hasRenderableTable(node.table);
    const hideImportedTablePlaceholderTitle = !readOnly && hasTable && isSystemPlaceholderTitle(title);
    const editDisplayTitle = hideImportedTablePlaceholderTitle ? "" : node.title;
    const isDataStructureSection = (() => {
        const merged = normalizeKeywordText(`${node.title || ""} ${node.text || ""}`);
        return merged.includes("5.6") && merged.includes("数据结构");
    })();
    const childCaptions = extractImageCaptions(node.text);
    const imageOnlyChildren = (node.children || []).filter((child) => isImageNodeOnly(child));
    const childCaptionById = new Map<string, string>();
    imageOnlyChildren.forEach((child, idx) => {
        const cap = childCaptions[idx];
        if (cap) {
            childCaptionById.set(String(child.id), cap);
            if (child.n_id) childCaptionById.set(String(child.n_id), cap);
        }
    });
    const mergedImageOnlyChildren = imageOnlyChildren.filter((child) => {
        const childTitle = String(child.title || "").trim();
        const cap = childCaptionById.get(String(child.id)) || childCaptionById.get(String(child.n_id || ""));
        return isSystemPlaceholderTitle(childTitle) || !!cap;
    });
    const embeddedImageChild = readOnly ? imageOnlyChildren.find((child) => {
        const cap = childCaptionById.get(String(child.id)) || childCaptionById.get(String(child.n_id || ""));
        return !!(cap || child.label || child.img_url);
    }) : undefined;
    const firstImageChild = mergedImageOnlyChildren.find((child) => !!child.img_url) || imageOnlyChildren.find((child) => !!child.img_url);
    const embeddedImageChildIdSet = new Set<string>(
        embeddedImageChild ? [String(embeddedImageChild.id), String(embeddedImageChild.n_id || "")] : []
    );
    const mergedImageChildIdSet = new Set(
        mergedImageOnlyChildren.flatMap((child) => [String(child.id), String(child.n_id || "")])
    );
    const tableChildren = (node.children || []).filter((child) => hasRenderableTable(child.table) && !child.img_url);
    const inlineTableChildren = (readOnly)
        ? (node.children || []).filter((child) => {
            const childHasTable = hasRenderableTable(child.table);
            const childTitle = String(child.title || "").trim();
            const isPureTableChild = childHasTable && !child.img_url && !String(child.text || "").trim() && (!child.children || child.children.length === 0);
            if (isInterfaceSubSection) return childHasTable && !child.img_url;
            return childHasTable && (
                (isStrictTableCaptionTitle(childTitle) && !child.img_url && !String(child.text || "").trim())
                || (isDataStructureSection && isPureTableChild)
            );
        })
        : [];
    const inlineTableChildIdSet = new Set(
        inlineTableChildren.flatMap((child) => [String(child.id), String(child.n_id || "")])
    );
    const tableTargetCount = (readOnly && !isInterfaceSubSection) ? ((hasTable ? 1 : 0) + tableChildren.length) : 0;
    const tableCaptionPack = readOnly
        ? pickTableCaptions(node.text, tableTargetCount)
        : { captions: [] as string[], body: node.text || "" };
    const ownTableCaption = hasTable
        ? (tableCaptionPack.captions[0] || tableCaptionFromParent || "")
        : "";
    const childTableCaptions = hasTable
        ? tableCaptionPack.captions.slice(1)
        : tableCaptionPack.captions;
    const childTableCaptionById = new Map<string, string>();
    tableChildren.forEach((child, idx) => {
        const cap = childTableCaptions[idx];
        if (cap) {
            childTableCaptionById.set(String(child.id), cap);
            if (child.n_id) childTableCaptionById.set(String(child.n_id), cap);
        }
    });
    const displayImageUrl = node.img_url || embeddedImageChild?.img_url || firstImageChild?.img_url || "";
    const hasDisplayImage = !!String(displayImageUrl || "").trim();
    const compactWithImage = !readOnly && hasDisplayImage;
    const imageSourceNodeId = node.img_url
        ? node.id
        : (embeddedImageChild?.id || firstImageChild?.id || node.id);
    const visibleChildren = (node.children || []).filter((child) => {
        if (!readOnly) {
            if (mergedImageChildIdSet.has(String(child.id)) || mergedImageChildIdSet.has(String(child.n_id || ""))) {
                return false;
            }
            return true;
        }
        if (inlineTableChildIdSet.has(String(child.id)) || inlineTableChildIdSet.has(String(child.n_id || ""))) {
            return false;
        }
        if (embeddedImageChildIdSet.has(String(child.id)) || embeddedImageChildIdSet.has(String(child.n_id || ""))) {
            return false;
        }
        const cap = childCaptionById.get(String(child.id)) || childCaptionById.get(String(child.n_id || ""));
        if (isInterfaceSubSection) {
            return !(isImageNodeOnly(child) && !!cap);
        }
        // 父节点正文已有“图X 标题”时，图片子节点并入父节点展示，不再单独列出。
        return !(isImageNodeOnly(child) && !!cap);
    });
    const finalVisibleChildren = visibleChildren;
    const hasChildren = finalVisibleChildren.length > 0;
    const displayNodeText = readOnly
        ? (tableTargetCount > 0 ? tableCaptionPack.body : (node.text || ""))
        : (node.text || "");
    const interfaceOutputSplit = (() => {
        if (!(readOnly && isInterfaceSubSection && (hasTable || inlineTableChildren.length > 0) && String(displayNodeText || "").trim())) return null;
        const raw = String(displayNodeText || "");
        const idx = raw.search(/[（(]2[）)]\s*输出项/);
        if (idx <= 0) return null;
        return {
            before: raw.slice(0, idx).trimEnd(),
            after: raw.slice(idx).trimStart(),
        };
    })();
    const displayTextBeforeTable = interfaceOutputSplit?.before ?? displayNodeText;
    const displayTextAfterTable = interfaceOutputSplit?.after ?? "";
    const anchoredInlineTables = (readOnly && isInterfaceSubSection && interfaceOutputSplit)
        ? inlineTableChildren
        : [];
    const trailingInlineTables = anchoredInlineTables.length > 0 ? [] : inlineTableChildren;
    const hasDisplayTextContent = !!String(displayNodeText || "").trim();
    const isPureTableCarrierNode = !!(
        hasTable &&
        !displayImageUrl &&
        !hasDisplayTextContent &&
        !hasChildren
    );
    const displayTitle = (() => {
        const label = String(node.label || "").trim();
        if (!readOnly) return title;
        if (isSystemPlaceholderTitle(title) && displayImageUrl) {
            return captionFromParent || label || getFileNameFromUrl(displayImageUrl) || "图片";
        }
        if (isSystemPlaceholderTitle(title) && hasTable) {
            return inferDataTableDisplayTitle(node) || captionFromParent || tableCaptionFromParent || label || "数据表";
        }
        if (isSystemPlaceholderTitle(title)) {
            return "";
        }
        const baseTitle = titleWithoutChapter || captionFromParent || label || "";
        if (baseTitle) return baseTitle;
        if (hasTable) {
            return inferDataTableDisplayTitle(node) || "数据表";
        }
        return "-";
    })();
    const isTableCaptionCarrierNode = !!(
        readOnly &&
        !isInterfaceSubSection &&
        (hasTable || visibleChildren.some((child) => hasTableInSubtree(child))) &&
        isStrictTableCaptionTitle(titleWithoutChapter || title) &&
        !hasDisplayTextContent
    );
    const hasDisplayTitle = !!String(displayTitle || "").trim() && displayTitle !== "-";
    const hideNodeRow = !!(
        isTableCaptionCarrierNode
        || (readOnly && isPureTableCarrierNode)
    );
    /** 只读：同一节点内「标题/正文行」之后紧跟表格时，去掉首张表顶部的分割线留白，避免像多套了一层容器 */
    const flushOwnTableTop = readOnly && hasDisplayTextContent && hasTable;
    const flushFirstInlineTableTop = readOnly
        && !hasTable
        && inlineTableChildren.length > 0
        && (hasDisplayTextContent || (hasDisplayTitle && !hideNodeRow));
    const resolvedTableCaption = readOnly
        ? (
            ownTableCaption ||
            (
                isPureTableCarrierNode && !hasDisplayTitle
                    ? (displayTitle || inferDataTableDisplayTitle(node))
                    : ""
            )
        )
        : "";
    const normalizedResolvedCaption = String(resolvedTableCaption || "").trim();
    const isInterfaceChapter = /接口/.test(titleWithoutChapter || title);
    const finalTableCaption = readOnly
        ? (
            (normalizedResolvedCaption && normalizedResolvedCaption !== "-" ? normalizedResolvedCaption : "")
            || (hasTable && (isInterfaceChapter || isInterfaceLikeTable(node)) ? "接口列表" : "")
            || inferDataTableDisplayTitle(node)
            || (hasTable ? "数据表" : "")
        )
        : "";
    const sanitizedFinalTableCaption = isSyntheticTableCaption(finalTableCaption) ? "" : finalTableCaption;
    // 性能优化：编辑态也按展开状态渲染子内容，避免大文档首屏一次性挂载全部节点。
    const showExpandedBody = !hasChildren || expanded || isTableCaptionCarrierNode;
    const showChapterNo = !!(
        readOnly &&
        chapterNo &&
        displayTitle &&
        displayTitle !== "-" &&
        !isTableCaptionCarrierNode &&
        !isPureTableCarrierNode
    );
    const chapterTextStyle = {
        fontSize: 13,
        lineHeight: 1.5,
        fontWeight: 400 as const,
        fontFamily: '"Times New Roman", "SimSun", "Songti SC", serif',
    };
    // 编辑态输入框兜底：直接落在组件 style，避免外层 less/theme 被覆盖导致一级和二级观感不一致
    const unifiedInputStyle = {
        font: '400 13px/1.5 "Times New Roman", "SimSun", "Songti SC", "STSong", serif',
        height: 28,
        paddingTop: 3,
        paddingBottom: 3,
        letterSpacing: 0,
    };
    const titleInputStyle = compactWithImage
        ? { ...unifiedInputStyle, flex: "0 0 110px", maxWidth: 110, marginRight: 6 }
        : unifiedInputStyle;
    const sdsInputStyle = compactWithImage
        ? { ...unifiedInputStyle, flex: "0 0 86px", maxWidth: 86, marginRight: 6 }
        : unifiedInputStyle;
    const stackContentBelowTitle = !!(
        readOnly &&
        !hideNodeRow
    );
    const alignSplitTailWithNodeRow = !!(
        readOnly &&
        isInterfaceSubSection &&
        !hideNodeRow &&
        !stackContentBelowTitle
    );
    let childChapterCounter = 0;
    const inlineImageUrlForText = (readOnly && displayImageUrl)
        ? (displayImageUrl.startsWith('http') ? displayImageUrl : `${window.location.origin}/${displayImageUrl.replace(/^\//, '')}`)
        : "";
    const renderReadOnlyText = (raw: string, options?: { inlineImageUrl?: string }) => {
        const lines = String(raw || "").replace(/\r/g, "").split("\n");
        const inlineImageUrl = String(options?.inlineImageUrl || "").trim();
        let injected = false;
        const chunks: JSX.Element[] = [];
        lines.forEach((line, idx) => {
            const headingType = getInlineHeadingType(line);
            const trimmed = String(line || "").trim();
            const isImageCaptionLine = /^图\s*\d+/.test(trimmed);
            if (!trimmed) {
                chunks.push(<div key={`line-${idx}`} style={{ height: 8 }} />);
                return;
            }
            if (headingType) {
                if (!!inlineImageUrl && !injected && isImageCaptionLine) {
                    chunks.push(
                        <div className="node-pic node-pic-readonly node-pic-inline" key={`line-image-${idx}`}>
                            <Image
                                src={inlineImageUrl}
                                alt={displayTitle || "image"}
                                preview={true}
                            />
                        </div>
                    );
                    injected = true;
                }
                chunks.push(
                    <div key={`line-${idx}`} className={`node-inline-heading ${headingType}`}>
                        {line}
                    </div>
                );
                return;
            }
            if (!!inlineImageUrl && !injected && isImageCaptionLine) {
                chunks.push(
                    <div className="node-pic node-pic-readonly node-pic-inline" key={`line-image-${idx}`}>
                        <Image
                            src={inlineImageUrl}
                            alt={displayTitle || "image"}
                            preview={true}
                        />
                    </div>
                );
                injected = true;
            }
            chunks.push(
                <div key={`line-${idx}`} className="node-inline-line">
                    {line}
                </div>
            );
        });
        if (!!inlineImageUrl && !injected) {
            chunks.push(
                <div className="node-pic node-pic-readonly node-pic-inline" key="line-image-fallback">
                    <Image
                        src={inlineImageUrl}
                        alt={displayTitle || "image"}
                        preview={true}
                    />
                </div>
            );
        }
        return <div className="node-content node-text-area">{chunks}</div>;
    };

    return (
        <div style={{ marginLeft: level * 32 }}>
          <div className={`tree-node-item level-${level}`}>
              {!hideNodeRow && (
              <div className={`node-row ${!readOnly && hasDisplayImage ? "node-row-has-image" : ""}`}>
                  {hasChildren ? (
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
                  {!readOnly && (
                    <Tooltip title={ts('sds_doc.add_sibling_before') || '在前面添加同级节点'}>
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        className="node-add-sibling-btn"
                        onClick={() => onAddSibling(node.id, 'before', node.title)}
                      />
                    </Tooltip>
                  )}
                  {readOnly ? (
                      <span className="node-title-prefix">{displayChapterFromDoc || (showChapterNo ? chapterNo : "")}</span>
                  ) : (
                      <span
                          className="node-title-prefix"
                          style={compactWithImage ? { ...chapterTextStyle, marginRight: 8 } : chapterTextStyle}
                      >
                          {numberToChinese(level + 1)}{ts('level_menu')}
                      </span>
                  )}
                  {readOnly ? (
                      <div className="node-title">{displayTitle}</div>
                  ) : (
                      <input
                          className="node-title node-input-native"
                          type="text"
                          style={titleInputStyle as React.CSSProperties}
                          value={editDisplayTitle}
                          onChange={(e) => onTitleChange(node.id, e.target.value)}
                          placeholder={ts('please_input_title')}
                          disabled={readOnly}
                      />
                  )}
                  {
                    ('sds_code' in node) && !readOnly && (
                        <input
                            className="node-sds-code node-input-native"
                            type="text"
                            style={sdsInputStyle as React.CSSProperties}
                            value={resolvedSdsCode}
                            onChange={(e) => onSdsCodeChange(node.id, e.target.value)}
                            placeholder={ts('please_input_sds_code')}
                            disabled={readOnly}
                        />
                    )
                  }
                  {isDocImageRefType(node.ref_type) && (
                      <div className="node-file-ref node-content">
                          {node.img_url ? (
                              <a
                                  href={`/${node.img_url}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="node-file-link"
                              >
                                  <FileOutlined /> {getSdsRefTypeLabel(node.ref_type, ts)}
                              </a>
                          ) : (
                              <Tooltip title={ts('srs_doc.no_file')}>
                                  <span className="node-file-empty">
                                      <FileOutlined /> {getSdsRefTypeLabel(node.ref_type, ts)}
                                  </span>
                              </Tooltip>
                          )}
                      </div>
                  )}
                  {readOnly ? (
                      (String(displayTextBeforeTable || "").trim() || !!inlineImageUrlForText)
                          ? (stackContentBelowTitle ? null : renderReadOnlyText(displayTextBeforeTable, { inlineImageUrl: inlineImageUrlForText }))
                          : null
                  ) : (
                      <Input.TextArea
                          className="node-content node-text-area"
                          styles={{ textarea: chapterTextStyle }}
                          style={compactWithImage ? { marginRight: 8 } : undefined}
                          value={node.text}
                          onChange={(e) => onContentChange(node.id, e.target.value)}
                          placeholder={ts('srs_doc.please_input_content')}
                          size="small"
                          rows={1}
                          autoSize={{ minRows: 1, maxRows: 6 }}
                          disabled={readOnly}
                      />
                  )}
                  {/* 编辑态：沿用原有逻辑，展示已上传图片预览和上传按钮 */}
                  {level <= 2 && !readOnly && displayImageUrl && (
                      <div
                          className="node-pic node-pic-readonly node-pic-editable"
                          style={compactWithImage ? {
                              width: 128,
                              height: 128,
                              minWidth: 128,
                              minHeight: 128,
                              maxWidth: 128,
                              maxHeight: 128,
                              marginRight: 8,
                          } : undefined}
                      >
                          <Image
                              src={displayImageUrl.startsWith('http') ? displayImageUrl : `${window.location.origin}/${displayImageUrl.replace(/^\//, '')}`}
                              alt={displayTitle || 'image'}
                              preview={true}
                          />
                          <Button
                              type="text"
                              size="small"
                              className="node-pic-remove-btn"
                              icon={<CloseOutlined />}
                              onClick={() => {
                                  onImageChange(imageSourceNodeId, "");
                                  setFileList([]);
                              }}
                              title="删除图片"
                              style={{
                                  position: "absolute",
                                  top: 2,
                                  right: 2,
                                  zIndex: 999,
                                  width: 22,
                                  height: 22,
                                  minWidth: 22,
                                  borderRadius: "50%",
                                  color: "rgba(0,0,0,0.65)",
                                  background: "transparent",
                                  border: "none",
                                  boxShadow: "none",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                              }}
                          />
                      </div>
                  )}
                  {level <= 2 && !readOnly && (
                      <Space className="node-pic" size={compactWithImage ? 4 : 8} style={compactWithImage ? { marginRight: 6 } : undefined}>
                          <Upload {...uploadProps}>
                              <Button
                                  size="small"
                                  icon={<UploadOutlined />}
                                  style={compactWithImage ? { height: 28, padding: "0 8px", fontSize: 13 } : undefined}
                              >
                                  {hasDisplayImage ? "重新上传" : ts("select_file")}
                              </Button>
                          </Upload>
                      </Space>
                  )}
                  {node.ref_type === 'sds_reqds' && onOpenReqdList && (
                      <Button
                          type="primary"
                          size="small"
                          className="node-srsreq-btn"
                          onClick={onOpenReqdList}
                          style={compactWithImage ? { marginRight: 6, height: 28, padding: "0 8px", fontSize: 13 } : undefined}
                      >
                          {ts('menu.sds_reqds') || '设计列表'}
                      </Button>
                  )}
                  {node.ref_type === 'sds_traces' && onOpenTraceList && (
                      <Button
                          type="primary"
                          size="small"
                          className="node-srsreq-btn"
                          onClick={onOpenTraceList}
                          style={compactWithImage ? { marginRight: 6, height: 28, padding: "0 8px", fontSize: 13 } : undefined}
                      >
                          {ts('menu.sds_traces') || '需求追溯表'}
                      </Button>
                  )}
                  {!readOnly && (
                    <Tooltip title={ts('sds_doc.add_sibling_after') || '在后面添加同级节点'}>
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        className="node-add-sibling-btn"
                        onClick={() => onAddSibling(node.id, 'after', node.title)}
                      />
                    </Tooltip>
                  )}
                  {!readOnly && (
                  <Space className="node-actions" size={compactWithImage ? 4 : 8}>
                      {
                        level < 2 && (
                        <Button
                          size="small"
                          icon={<PlusOutlined />}
                          style={compactWithImage ? { height: 28, padding: "0 8px", fontSize: 13 } : undefined}
                          onClick={() => onAdd(node.id)}>
                          {ts('add')}{numberToChinese(level + 2)}{ts('level_menu')}
                        </Button>)
                      }
                      {!isDocImageRefType(node.ref_type) && node.ref_type !== 'sds_reqds' && node.ref_type !== 'sds_traces' && (
                      <Button
                          size="small"
                          icon={<TableOutlined />}
                          style={compactWithImage ? { height: 28, padding: "0 8px", fontSize: 13 } : undefined}
                          onClick={() => onAddTable(node.id)}>
                          {ts('srs_doc.table')}
                      </Button>
                      )}
                      {!isDocImageRefType(node.ref_type) && node.ref_type !== 'sds_reqds' && node.ref_type !== 'sds_traces' && (
                      <Upload {...tableImportProps}>
                          <Button
                              size="small"
                              icon={<UploadOutlined />}
                              style={compactWithImage ? { height: 28, padding: "0 8px", fontSize: 13 } : undefined}>
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
                              style={compactWithImage ? { height: 28, padding: "0 8px", fontSize: 13 } : undefined}
                              icon={<DeleteOutlined />}>
                              {ts('delete')}
                          </Button>
                      </Popconfirm>
                  </Space>
                  )}
              </div>
              )}

              {showExpandedBody && readOnly && stackContentBelowTitle && (
                  <div className="node-row node-row-follow node-row-content-below">
                      <span className="node-expand-placeholder" />
                      <span className="node-title-prefix" style={{ visibility: "hidden" }}>
                          {displayChapterFromDoc || (showChapterNo ? chapterNo : "") || "-"}
                      </span>
                      <div className="node-content-below-title">
                          {(String(displayTextBeforeTable || "").trim() || !!inlineImageUrlForText)
                              ? renderReadOnlyText(displayTextBeforeTable, { inlineImageUrl: inlineImageUrlForText })
                              : null}
                      </div>
                  </div>
              )}
              
              {/* 显示表格数据（ref_type 节点不展示表格） */}
              {showExpandedBody && hasTable && !isDocImageRefType(node.ref_type) && node.ref_type !== 'sds_reqds' && node.ref_type !== 'sds_traces' && (
                  <div className={`node-table${flushOwnTableTop ? " node-table--flush-top" : ""}`}>
                      {readOnly && hideNodeRow && !!sanitizedFinalTableCaption && (
                          <div className="node-content" style={{ marginBottom: 8, textAlign: "center", fontSize: 13, fontWeight: 400 }}>
                              {sanitizedFinalTableCaption}
                          </div>
                      )}
                      <div className="node-table-header">
                          <div className="node-table-scroll">
                          <Table
                              columns={buildTableColumns(node.table)}
                              dataSource={buildTableDataSource(node.table)}
                              pagination={false}
                              size="small"
                              bordered
                              tableLayout="fixed"
                          />
                          </div>
                          {!readOnly && (
                          <Space className="node-table-actions" size={8}>
                              <Button
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => onEditTable(node.id)}>
                                  {ts('edit')}
                              </Button>
                              <Popconfirm
                                  title={ts('srs_doc.confirm_delete_table')}
                                  onConfirm={() => onDeleteTable(node.id)}
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
              )}
              {showExpandedBody && readOnly && anchoredInlineTables.map((child, idx) => {
                  const caption = childTableCaptionById.get(String(child.id))
                      || childTableCaptionById.get(String(child.n_id || ""))
                      || String(child.title || "").trim()
                      || inferDataTableDisplayTitle(child)
                      || `数据表${idx + 1}`;
                  const sanitizedCaption = isSyntheticTableCaption(caption) ? "" : caption;
                  return (
                      <div
                          className={`node-table${flushFirstInlineTableTop && idx === 0 ? " node-table--flush-top" : ""}`}
                          key={`anchored-inline-table-${child.id}-${idx}`}
                      >
                          {!!sanitizedCaption && (
                              <div className="node-content" style={{ marginBottom: 8, textAlign: "center", fontSize: 13, fontWeight: 400 }}>
                                  {sanitizedCaption}
                              </div>
                          )}
                          <div className="node-table-header">
                              <div className="node-table-scroll">
                                  <Table
                                      columns={buildTableColumns(child.table)}
                                      dataSource={buildTableDataSource(child.table)}
                                      pagination={false}
                                      size="small"
                                      bordered
                                      tableLayout="fixed"
                                  />
                              </div>
                          </div>
                      </div>
                  );
              })}
              {showExpandedBody && readOnly && !!String(displayTextAfterTable || "").trim() && (
                  alignSplitTailWithNodeRow ? (
                      <div className="node-row node-row-follow">
                          <span className="node-expand-placeholder" />
                          <span className="node-title-prefix" style={{ visibility: "hidden" }}>
                              {displayChapterFromDoc || (showChapterNo ? chapterNo : "") || "-"}
                          </span>
                          <span className="node-title" style={{ visibility: "hidden" }}>
                              {displayTitle || "-"}
                          </span>
                          {renderReadOnlyText(displayTextAfterTable)}
                      </div>
                  ) : (
                      renderReadOnlyText(displayTextAfterTable)
                  )
              )}
              {showExpandedBody && readOnly && trailingInlineTables.map((child, idx) => {
                  const caption = childTableCaptionById.get(String(child.id))
                      || childTableCaptionById.get(String(child.n_id || ""))
                      || String(child.title || "").trim()
                      || inferDataTableDisplayTitle(child)
                      || `数据表${idx + 1}`;
                  const sanitizedCaption = isSyntheticTableCaption(caption) ? "" : caption;
                  return (
                      <div
                          className={`node-table${flushFirstInlineTableTop && idx === 0 ? " node-table--flush-top" : ""}`}
                          key={`inline-table-${child.id}-${idx}`}
                      >
                          {!!sanitizedCaption && (
                              <div className="node-content" style={{ marginBottom: 8, textAlign: "center", fontSize: 13, fontWeight: 400 }}>
                                  {sanitizedCaption}
                              </div>
                          )}
                          <div className="node-table-header">
                              <div className="node-table-scroll">
                                  <Table
                                      columns={buildTableColumns(child.table)}
                                      dataSource={buildTableDataSource(child.table)}
                                      pagination={false}
                                      size="small"
                                      bordered
                                      tableLayout="fixed"
                                  />
                              </div>
                          </div>
                      </div>
                  );
              })}
          </div>
            {showExpandedBody && finalVisibleChildren.map((child) => {
                const childTitle = String(child.title || "").trim();
                const childHasTable = hasRenderableTable(child.table);
                const childIsPureTableCarrier = !!(
                    childHasTable &&
                    !child.img_url &&
                    !String(child.text || "").trim() &&
                    (!child.children || child.children.length === 0)
                );
                const childHasTableDesc = hasTableInSubtree(child);
                const childIsTableCaptionCarrier = !!(
                    childHasTableDesc &&
                    isStrictTableCaptionTitle(childTitle) &&
                    !String(child.text || "").trim()
                );
                const childHasMeaningfulTitle = !childIsPureTableCarrier && !childIsTableCaptionCarrier && shouldAssignChapterNo(child);
                const nextChapterNo = childHasMeaningfulTitle ? `${chapterNo || ""}.${++childChapterCounter}`.replace(/^\./, "") : chapterNo;
                return (
                    <TreeNodeItem
                        key={child.id}
                        node={child}
                        level={level + 1}
                        chapterNo={nextChapterNo}
                        docId={docId}
                        readOnly={readOnly}
                        onAdd={onAdd}
                        onAddSibling={onAddSibling}
                        onDelete={onDelete}
                        onTitleChange={onTitleChange}
                        onSdsCodeChange={onSdsCodeChange}
                        onImageChange={onImageChange}
                        onContentChange={onContentChange}
                        onAddTable={onAddTable}
                        onImportTable={onImportTable}
                        onEditTable={onEditTable}
                        onDeleteTable={onDeleteTable}
                        onOpenReqdList={onOpenReqdList}
                        onOpenTraceList={onOpenTraceList}
                        readOnlyChapterOffset={readOnlyChapterOffset}
                        captionFromParent={childCaptionById.get(String(child.id)) || childCaptionById.get(String(child.n_id || ""))}
                        tableCaptionFromParent={childTableCaptionById.get(String(child.id)) || childTableCaptionById.get(String(child.n_id || ""))}
                    />
                );
            })}
        </div>
    );
};

interface TreeStructureProps {
    value?: TreeNode[];
    onChange?: (value: TreeNode[]) => void;
    onNodesSnapshot?: (value: TreeNode[]) => void;
    docId?: number;
    hiddenNodeIds?: number[];
    onNodeDelete?: (docId: number, nodeId: number) => Promise<boolean>; // 删除节点回调
    readOnly?: boolean;
    readOnlyChapterOffset?: number;
    /** 只读模式下是否为每个根节点再包一层 `.tree-node-item-wrapper`（SDS 详情为 false，避免“盒中盒”） */
    readOnlyRootWrapper?: boolean;
    onOpenReqdList?: () => void;   // 打开设计列表弹框
    onOpenTraceList?: () => void;  // 打开需求追溯表弹框
}

export default ({ value = [], onChange, onNodesSnapshot, docId, hiddenNodeIds = [], onNodeDelete, readOnly, readOnlyChapterOffset = 0, readOnlyRootWrapper = true, onOpenReqdList, onOpenTraceList }: TreeStructureProps) => {
    const { t: ts } = useTranslation();
    const [nodes, setNodes] = useState<TreeNode[]>(value);
    const [tableModalVisible, setTableModalVisible] = useState(false);
    const [currentNodeId, setCurrentNodeId] = useState<number | null>(null);
    const [initialTableData, setInitialTableData] = useState<TableDataWithHeaders | undefined>(undefined);
    const [tableCellsBackup, setTableCellsBackup] = useState<TableData["cells"] | undefined>(undefined);
    const hydrateSdsCodeFallback = (nodeList: TreeNode[]): TreeNode[] => {
        return (nodeList || []).map((node) => {
            const nextChildren = hydrateSdsCodeFallback(node.children || []);
            let nextNode: TreeNode = { ...node, children: nextChildren };
            if ("sds_code" in nextNode) {
                const currentCode = String(nextNode.sds_code ?? "").trim();
                if (!currentCode) {
                    const fallback = extractSdsCodeFromNodeText(nextNode.text);
                    const markerCode = extractCodeAfterDesignMarker(nextNode.text);
                    const directCode = extractSdsCodeToken(nextNode.text);
                    const finalCode = markerCode || directCode || fallback.code;
                    if (fallback.code) {
                        nextNode = {
                            ...nextNode,
                            sds_code: finalCode,
                            text: fallback.nextText || nextNode.text,
                        };
                    } else if (directCode) {
                        nextNode = { ...nextNode, sds_code: directCode };
                    }
                }
            }
            return nextNode;
        });
    };

    // 同步外部传入的 value 到内部状态
    useEffect(() => {
        setNodes(hydrateSdsCodeFallback(value));
    }, [value]);
    useEffect(() => {
        onNodesSnapshot?.(nodes);
    }, [nodes, onNodesSnapshot]);

    const updateNodes = (newNodes: TreeNode[]) => {
        const normalizedNodes = hydrateSdsCodeFallback(newNodes);
        onNodesSnapshot?.(normalizedNodes);
        setNodes(normalizedNodes);
        onChange?.(normalizedNodes);
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
            img_url: undefined,
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
                    img_url: undefined,
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

    const handleSdsCodeChange = (id: number, sds_code: string) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            sds_code
        }));
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

    const handleContentChange = (id: number, text: string) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            text
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
            const insertImportedSheets = (nodeList: TreeNode[]): TreeNode[] => {
                const idx = nodeList.findIndex((n) => n.id === id);
                if (idx >= 0) {
                    const target = nodeList[idx];
                    const currentSheet = importedTables[0];
                    const siblingSheets = importedTables.slice(1);
                    const getSheetTitle = (sheetName: string, fallbackIndex: number) => {
                        const normalized = String(sheetName || "").trim();
                        return normalized || `导入表格${fallbackIndex}`;
                    };
                    const currentNode: TreeNode = {
                        ...target,
                        table: currentSheet.table,
                    };
                    const childNodes: TreeNode[] = siblingSheets.map((sheet, sheetIdx) => ({
                        id: generateId(),
                        doc_id: target.doc_id || 0,
                        n_id: 0,
                        p_id: target.n_id || 0,
                        title: getSheetTitle(sheet.sheetName, sheetIdx + 2),
                        ...(("sds_code" in target) ? { sds_code: target.sds_code ?? "" } : {}),
                        img_url: undefined,
                        text: "",
                        table: sheet.table,
                        children: [],
                    }));
                    return [
                        ...nodeList.slice(0, idx),
                        {
                            ...currentNode,
                            children: [...(currentNode.children || []), ...childNodes],
                        },
                        ...nodeList.slice(idx + 1),
                    ];
                }
                return nodeList.map((node) => ({
                    ...node,
                    children: insertImportedSheets(node.children || []),
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

        const tableData: TableDataWithHeaders = {
            headers,
            data: rows.map(row => 
                headers.map(header => row[header.code] || '')
            )
        };

        setCurrentNodeId(id);
        setInitialTableData(tableData);
        setTableCellsBackup(targetNode.table.cells);
        setTableModalVisible(true);
    };

    const handleDeleteTable = (id: number) => {
        const newNodes = findNodeAndUpdate(nodes, id, (node) => ({
            ...node,
            table: {}
        }));
        updateNodes(newNodes);
    };

    const handleTableConfirm = (tableData: TableDataWithHeaders) => {
        if (currentNodeId === null) return;

        const rebuildMergedCells = () => {
            const cells = tableCellsBackup;
            if (!cells || !Array.isArray(cells) || cells.length < 2) return undefined;
            const rowCount = tableData.data.length;
            const colCount = tableData.headers.length;
            if (cells.length !== rowCount + 1) return undefined;
            if (!cells.every((r) => Array.isArray(r) && r.length === colCount)) return undefined;
            const next = cells.map((r) => r.map((c) => ({ ...c })));
            for (let c = 0; c < colCount; c++) {
                next[0][c].value = tableData.headers[c]?.name || "";
                next[0][c].row_span = next[0][c].row_span ?? 1;
                next[0][c].col_span = next[0][c].col_span ?? 1;
            }
            for (let r = 0; r < rowCount; r++) {
                for (let c = 0; c < colCount; c++) {
                    const cell = next[r + 1][c];
                    const rs = cell?.row_span ?? 1;
                    const cs = cell?.col_span ?? 1;
                    if (rs === 0 || cs === 0) continue;
                    next[r + 1][c].value = tableData.data[r]?.[c] || "";
                }
            }
            return next;
        };
    
        // 转换为父组件存储的格式：rows 是对象数组，键为表头name（或code），值为单元格内容
        const rows: { [key: string]: string }[] = tableData.data
            .map(row => {
                const rowObj: { [key: string]: string } = {};
                tableData.headers.forEach((header, index) => {
                    rowObj[header.code] = row[index] || ''; // 键=code，值=单元格内容
                });
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

        const newNodes = findNodeAndUpdate(nodes, currentNodeId, (node) => ({
            ...node,
            table: tableFormat
        }));
        updateNodes(newNodes);
        setTableCellsBackup(undefined);
    };

    const hiddenSet = new Set(hiddenNodeIds.map((id) => String(id)));
    const getVisibleNodes = (list: TreeNode[]): TreeNode[] => {
        return list
            .filter((node) => !hiddenSet.has(String(node.id)) && !hiddenSet.has(String(node.n_id || "")))
            .map((node) => ({
                ...node,
                children: getVisibleNodes(node.children || []),
            }));
    };
    const visibleNodes = getVisibleNodes(nodes);

    return (
        <>
            <div
                className={`tree-structure-container ${readOnly ? "read-only-mode" : ""}${
                    readOnly && !readOnlyRootWrapper ? " read-only-flat-roots" : ""
                }`}
            >
                {visibleNodes.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={ts("sds_doc.empty_directory_structure")}
                        className="tree-structure-empty"
                    />
                ) : (() => {
                    let rootChapterCounter = 0;
                    return visibleNodes.map((node) => {
                        const nodeTitle = String(node.title || "").trim();
                        const nodeHasTable = hasRenderableTable(node.table);
                        const nodeIsPureTableCarrier = !!(
                            nodeHasTable &&
                            !node.img_url &&
                            !String(node.text || "").trim() &&
                            (!node.children || node.children.length === 0)
                        );
                        const nodeHasTableDesc = hasTableInSubtree(node);
                        const nodeIsTableCaptionCarrier = !!(
                            nodeHasTableDesc &&
                            isStrictTableCaptionTitle(nodeTitle) &&
                            !String(node.text || "").trim()
                        );
                        const hasMeaningfulTitle = !nodeIsPureTableCarrier && !nodeIsTableCaptionCarrier && shouldAssignChapterNo(node);
                        const rootChapterNo = hasMeaningfulTitle ? `${++rootChapterCounter}` : "";
                        const rootItemProps = {
                            node,
                            level: 0,
                            chapterNo: rootChapterNo,
                            docId,
                            readOnly,
                            onAdd: handleAdd,
                            onAddSibling: handleAddSibling,
                            onDelete: handleDelete,
                            onTitleChange: handleTitleChange,
                            onSdsCodeChange: handleSdsCodeChange,
                            onImageChange: handleImageChange,
                            onContentChange: handleContentChange,
                            onAddTable: handleAddTable,
                            onImportTable: handleImportTable,
                            onEditTable: handleEditTable,
                            onDeleteTable: handleDeleteTable,
                            onOpenReqdList,
                            onOpenTraceList,
                            readOnlyChapterOffset,
                        };
                        return readOnly && !readOnlyRootWrapper ? (
                            <TreeNodeItem key={node.id} {...rootItemProps} />
                        ) : (
                            <div className="tree-node-item-wrapper" key={node.id}>
                                <TreeNodeItem {...rootItemProps} />
                            </div>
                        );
                    });
                })()}
            </div>

            {/* 添加/编辑表格弹框 */}
            <EditableTableGenerator
                open={tableModalVisible}
                initialData={initialTableData}
                onConfirm={handleTableConfirm}
                onCancel={() => {
                    setTableModalVisible(false);
                    setCurrentNodeId(null);
                    setInitialTableData(undefined);
                    setTableCellsBackup(undefined);
                }}
            />
        </>
    );
};