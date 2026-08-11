import "./HldDocDetail.less";
import { ConfigProvider, Form, Input, Button, message, Modal, Space, Table, Spin } from "antd";
import { ArrowLeftOutlined, EditOutlined, DownloadOutlined, FileAddOutlined } from "@ant-design/icons";
import { useEffect, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import standardNodes from "./data/standard_nodes.json";
import * as Api from "@/api/ApiHldDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiDocFile from "@/api/ApiDocFile";
import * as ApiMember from "@/api/ApiProjectMember";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import * as ApiPersonSign from "@/api/ApiPersonSign";
import TreeStructure, { TreeNode } from "../sds_doc/components/TreeStructure";
import { applySdsSyncToTree, hasSdsSyncData, needsLegacyInterfaceRepair, stripLegacyInterfaceText } from "./hldSdsSync";

const HLD_COVER_DATE_KEYWORDS = ["软件概要设计", "概要设计"];

const HLD_APPROVAL_HEADERS = [
    { code: "label1", name: "" },
    { code: "value1", name: "" },
    { code: "label2", name: "" },
    { code: "value2", name: "" },
];

const getHldTableText = (node: TreeNode) => {
    const table = node.table;
    if (!table?.rows?.length) return "";
    const headerTxt = (table.headers || []).map((h: any) => h?.name || "").join(" ");
    const rowTxt = (table.rows || []).map((row: any) => Object.values(row || {}).join(" ")).join(" ");
    return `${headerTxt} ${rowTxt}`;
};

const isHldCoverTableNode = (node: TreeNode) => {
    const txt = getHldTableText(node);
    return ["编制科室", "编制部门", "文件版本", "编制人", "审核人", "批准人", "生效日期"]
        .filter((k) => txt.includes(k)).length >= 3;
};

const isHldChangeLogTableNode = (node: TreeNode) => {
    const txt = getHldTableText(node);
    return ["修改日期", "版本号", "修订说明", "修订人", "批准人"].filter((k) => txt.includes(k)).length >= 3;
};

const normalizeHldApprovalRows = (node: TreeNode) => {
    const headers = node.table?.headers || [];
    const rows = node.table?.rows || [];
    const first = rows[0] || {};
    if (headers.some((header: any) => header.code === "label1")) {
        return rows;
    }
    const getVal = (code: string) => (first as any)[code] || "";
    return [
        { label1: "编制部门", value1: getVal("dept"), label2: "文件版本", value2: getVal("version") },
        { label1: "编制人", value1: getVal("author"), label2: "日期", value2: "" },
        { label1: "审核人", value1: getVal("reviewer"), label2: "日期", value2: "" },
        { label1: "批准人", value1: getVal("approver"), label2: "日期", value2: "" },
        { label1: "生效日期", value1: getVal("effective_date"), label2: "", value2: "" },
    ];
};

const computeHldCoverDate = (rows: any[]): string => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10) || 0;
    const dateKey = (r: any) => num(r.year) * 10000 + num(r.month) * 100 + (num(r.day) || 0);
    const cellVals = (r: any) => Object.values(r.cells || {});
    const match = (r: any, needReview: boolean) => {
        if ((r.row_type || "date") !== "date" || !num(r.year) || !num(r.month)) return false;
        const vals = cellVals(r);
        const hitName = vals.some((v: any) => HLD_COVER_DATE_KEYWORDS.some((k) => String(v || "").includes(k)));
        const hitReview = vals.some((v: any) => String(v || "").includes("评审"));
        return hitName && (needReview ? hitReview : true);
    };
    const pool = (rows || []).filter((r) => match(r, true));
    const candidates = pool.length ? pool : (rows || []).filter((r) => match(r, false));
    if (!candidates.length) return "";
    const best = candidates.reduce((a, b) => (dateKey(b) > dateKey(a) ? b : a));
    return `${num(best.year)}.${String(num(best.month)).padStart(2, "0")}.${String(num(best.day) || 1).padStart(2, "0")}`;
};

type CoverRevisionAutofillInfo = {
    coverDate: string;
    version: string;
    resolveSigner: (label: string) => string;
    reviser: string;
    approver: string;
};

const applyHldCoverRevisionAutofill = (nodes: TreeNode[], info: CoverRevisionAutofillInfo): { nodes: TreeNode[]; changed: boolean } => {
    let changed = false;
    const setIf = (row: Record<string, string>, key: string, val: string) => {
        if (val && !String(row[key] ?? "").trim()) {
            row[key] = val;
            changed = true;
        }
    };
    const walk = (items: TreeNode[]): TreeNode[] => (items || []).map((node) => {
        const children = walk((node.children || []) as TreeNode[]);
        let nextNode: TreeNode = { ...node, children };
        if (nextNode.table && isHldCoverTableNode(nextNode)) {
            const rows = normalizeHldApprovalRows(nextNode).map((r: any) => ({ ...r }));
            if (rows.length) {
                if (info.version && String(rows[0].value2 ?? "") !== info.version) {
                    rows[0].value2 = info.version;
                    changed = true;
                }
                setIf(rows[0], "value1", "研发部");
            }
            (["编制人", "审核人", "批准人"] as const).forEach((label, idx) => {
                const row = rows[idx + 1];
                if (!row) return;
                const sig = info.resolveSigner(label);
                if (sig && !String(row.value1 ?? "").startsWith("data:image") && !String(row.value1 ?? "").trim()) {
                    row.value1 = sig;
                    changed = true;
                }
                setIf(row, "value2", info.coverDate);
            });
            if (rows[4]) {
                setIf(rows[4], "value1", info.coverDate);
            }
            nextNode = { ...nextNode, table: { ...nextNode.table!, headers: HLD_APPROVAL_HEADERS, rows } };
        } else if (nextNode.table && isHldChangeLogTableNode(nextNode)) {
            const rows = [...(nextNode.table.rows || [])].map((r: any) => ({ ...r }));
            while (rows.length < 1) rows.push({});
            const row = rows[0] || {};
            setIf(row, "change_date", info.coverDate);
            if (info.version) setIf(row, "version_no", info.version);
            if (!String(row.change_desc ?? "").trim()) {
                row.change_desc = "首次发布";
                changed = true;
            }
            setIf(row, "changer", info.reviser);
            setIf(row, "approver", info.approver);
            rows[0] = row;
            nextNode = { ...nextNode, table: { ...nextNode.table, rows } };
        }
        return nextNode;
    });
    return { nodes: walk(nodes), changed };
};

const HLD_DOC_DETAIL_THEME = {
    token: {
        fontSize: 13,
        fontSizeSM: 13,
        fontSizeLG: 13,
        fontFamily: '"Times New Roman", "SimSun", "Songti SC", "STSong", serif',
    },
};

export default () => {
    const DOC_IMAGE_REF_TYPES = ["img_topo", "img_struct"] as const;
    const HEADING_NUM_RE = /^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/;

    const normalizeImgUrl = (url?: string) => {
        const txt = String(url || "").trim();
        if (!txt || txt === "/") return "";
        if (txt.startsWith("http://") || txt.startsWith("https://") || txt.startsWith("data:")) return txt;
        if (txt.startsWith("/data.trace/")) return txt;
        if (txt.startsWith("data.trace/")) return `/${txt}`;
        return txt;
    };
    const withCacheBuster = (url?: string, seed?: string | number) => {
        const base = normalizeImgUrl(url);
        if (!base) return "";
        if (base.startsWith("data:")) return base;
        const token = String(seed ?? Date.now());
        return `${base}${base.includes("?") ? "&" : "?"}_v=${encodeURIComponent(token)}`;
    };

    const remapRefTypeImagesByProduct = async (treeNodes: TreeNode[], productId?: number, docVersion?: string) => {
        if (!productId || !Array.isArray(treeNodes) || treeNodes.length === 0) return treeNodes;
        const fileMaps = new Map<string, string>();
        await Promise.all(
            DOC_IMAGE_REF_TYPES.map(async (fileType) => {
                try {
                    const res: any = await ApiDocFile.list_doc_file(fileType, { product_id: productId, page_index: 0, page_size: 1000 });
                    if (res?.code === ApiDocFile.C_OK) {
                        const rows = res?.data?.rows || [];
                        const normalizedVersion = String(docVersion || "").trim();
                        const scopedRows = normalizedVersion
                            ? rows.filter((row: any) => String(row?.product_version || "").trim() === normalizedVersion)
                            : rows;
                        const sortedRows = [...scopedRows].sort((a: any, b: any) => {
                            const ta = new Date(a?.update_time || a?.create_time || 0).getTime();
                            const tb = new Date(b?.update_time || b?.create_time || 0).getTime();
                            if (ta !== tb) return tb - ta;
                            return Number(b?.id || 0) - Number(a?.id || 0);
                        });
                        const firstRow = sortedRows[0] || rows[0];
                        const fileUrl = withCacheBuster(firstRow?.file_url, `${firstRow?.id || ""}_${firstRow?.update_time || firstRow?.create_time || ""}`);
                        if (fileUrl) fileMaps.set(fileType, fileUrl);
                    }
                } catch (error) {
                    console.error("加载产品图片文件失败:", error);
                }
            })
        );
        if (fileMaps.size === 0) return treeNodes;
        const walk = (nodes: TreeNode[]): TreeNode[] =>
            (nodes || []).map((node) => {
                const refType = String((node as any).ref_type || "");
                const currentUrl = withCacheBuster((node as any).img_url, Date.now());
                const mappedUrl = fileMaps.get(refType);
                const finalUrl = mappedUrl || currentUrl || "";
                return {
                    ...node,
                    ...(finalUrl ? { img_url: finalUrl } : {}),
                    children: walk((node.children || []) as TreeNode[]),
                };
            });
        return walk(treeNodes);
    };

    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const params = useParams();
    const location = useLocation();
    const isReadOnly = location.pathname.includes("/hld_docs/view/");
    const [editForm] = Form.useForm();
    const treeStructureRef = useRef<TreeNode[]>([]);
    const lastProductContextRef = useRef<{ productId?: number; version: string }>({ version: "" });
    const productContextReadyRef = useRef(false);
    const productSyncModalOpenRef = useRef(false);
    const productContextRevertingRef = useRef(false);
    const [data, dispatch] = useData({
        loading: false,
        isEdit: false,
        products: [],
        changeDescription: "",
        showChangeDescModal: false,
        tempChangeDescription: "",
        exporting: false,
        saving: false,
        docNId: 0,
        treeStructure: [] as TreeNode[],
        docProductId: undefined as number | undefined,
        docVersion: "" as string,
        treeRefreshKey: 0,
    });

    useEffect(() => {
        ApiProduct.list_product({ page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) {
                dispatch({ products: res.data.rows });
            }
        });
    }, []);

    const productId = Form.useWatch("product_id", editForm);
    const docVersion = Form.useWatch("version", editForm);
    const displayProductId = productId ?? data.docProductId;
    const displayDocVersion = String(docVersion ?? data.docVersion ?? "").trim();
    const currentProduct = (data.products as any[]).find((p: any) => p.id === displayProductId);
    const productLabel = currentProduct ? `${currentProduct.name}-${currentProduct.full_version}` : "";

    const normalizeScopeTitle = (title?: string) => String(title || "")
        .replace(/^(\d+(?:\.\d+)*\.?)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
        .replace(/[：:\s.．]/g, "")
        .trim();
    const replaceScopeInText = (text: string, scope: string): string => {
        const raw = String(text || "");
        if (!raw.trim() || !scope) return raw;
        const normalized = raw.replace(/\r/g, "");
        const marker = /(适用范围\s*[：:]\s*)/;
        const markerMatch = marker.exec(normalized);
        if (!markerMatch || markerMatch.index < 0) return raw;
        const markerStart = markerMatch.index;
        const markerText = markerMatch[1] || "";
        const valueStart = markerStart + markerText.length;
        const rest = normalized.slice(valueStart);
        const nextItem = rest.match(/(^|[\n\s。；;，,])((?:[0-9０-９]+|[a-zA-Z])[)）.．、](?:\s*|(?=[\u4e00-\u9fff])))/m);
        const valueEnd = (nextItem && typeof nextItem.index === "number")
            ? (valueStart + nextItem.index + String(nextItem[1] || "").length)
            : normalized.length;
        const current = normalized.slice(valueStart, valueEnd).trim();
        if (current === scope) return raw;
        return `${normalized.slice(0, valueStart)}${scope}${normalized.slice(valueEnd)}`;
    };
    const applyProductScopeToTree = (nodes: TreeNode[], product?: any): { nodes: TreeNode[]; changed: boolean } => {
        if (!Array.isArray(nodes) || !product) return { nodes, changed: false };
        const scope = String(product.scope ?? "").trim();
        let changed = false;
        const walk = (items: TreeNode[]): TreeNode[] => (items || []).map((node) => {
            const title = normalizeScopeTitle(node.title);
            const children = walk((node.children || []) as TreeNode[]);
            const nextNode = { ...node, children };
            const replacedText = replaceScopeInText(String(nextNode.text || ""), scope);
            if (replacedText !== String(nextNode.text || "")) {
                nextNode.text = replacedText;
                changed = true;
            } else if ((title === "范围" || title === "适用范围") && !String(nextNode.text || "").trim() && scope) {
                nextNode.text = scope;
                changed = true;
            }
            return nextNode;
        });
        return { nodes: walk(nodes), changed };
    };
    const replaceLabeledLineInText = (text: string, label: string, value: string): string => {
        const raw = String(text || "");
        if (!raw.trim() || !value) return raw;
        const normalized = raw.replace(/\r/g, "");
        const marker = new RegExp(`(${label}\\s*[：:]\\s*)`);
        const markerMatch = marker.exec(normalized);
        if (!markerMatch || markerMatch.index < 0) return raw;
        const markerText = markerMatch[1] || "";
        const valueStart = markerMatch.index + markerText.length;
        const rest = normalized.slice(valueStart);
        const nlIdx = rest.search(/[\n\r]/);
        const valueEnd = nlIdx >= 0 ? valueStart + nlIdx : normalized.length;
        const current = normalized.slice(valueStart, valueEnd).trim();
        if (current === value) return raw;
        return `${normalized.slice(0, valueStart)}${value}${normalized.slice(valueEnd)}`;
    };
    const applyProductBasicInfoToTree = (nodes: TreeNode[], product?: any): { nodes: TreeNode[]; changed: boolean } => {
        if (!Array.isArray(nodes) || !product) return { nodes, changed: false };
        const name = String(product.name ?? "").trim();
        const model = String(product.type_code ?? "").trim();
        let changed = false;
        const walk = (items: TreeNode[]): TreeNode[] => (items || []).map((node) => {
            const children = walk((node.children || []) as TreeNode[]);
            const nextNode = { ...node, children };
            let text = String(nextNode.text || "");
            const afterName = replaceLabeledLineInText(text, "产品名称", name);
            if (afterName !== text) { text = afterName; changed = true; }
            const afterModel = replaceLabeledLineInText(text, "产品型号", model);
            if (afterModel !== text) { text = afterModel; changed = true; }
            nextNode.text = text;
            return nextNode;
        });
        return { nodes: walk(nodes), changed };
    };
    const hasRenderableTable = (table: any): boolean => {
        if (!table || !Array.isArray(table.headers) || table.headers.length === 0) return false;
        const hasRows = Array.isArray(table.rows) && table.rows.length > 0;
        const hasCells = Array.isArray(table.cells) && table.cells.length > 1;
        const hasExtraTables = Array.isArray(table.extra_tables) && table.extra_tables.some((extra: any) => {
            const extraTable = extra?.table;
            if (!extraTable || !Array.isArray(extraTable.headers) || extraTable.headers.length === 0) return false;
            return (Array.isArray(extraTable.rows) && extraTable.rows.length > 0)
                || (Array.isArray(extraTable.cells) && extraTable.cells.length > 1);
        });
        return hasRows || hasCells || hasExtraTables;
    };

    const parseTreeNode = (node: any): TreeNode => {
        const hasValidHeaders = !!(node.table && node.table.headers !== null && Array.isArray(node.table.headers) && node.table.headers.length > 0);
        const hasRowOrCellContent = !!(node.table && (
            (node.table.rows !== null && Array.isArray(node.table.rows) && node.table.rows.length > 0)
            || (Array.isArray(node.table.cells) && node.table.cells.length > 1)
            || (Array.isArray(node.table.extra_tables) && node.table.extra_tables.some((extra: any) => {
                const extraTable = extra?.table;
                return extraTable && Array.isArray(extraTable.headers) && extraTable.headers.length > 0
                    && ((Array.isArray(extraTable.rows) && extraTable.rows.length > 0) || (Array.isArray(extraTable.cells) && extraTable.cells.length > 1));
            }))
        ));
        return {
            id: node.n_id || node.id || 0,
            doc_id: node.doc_id || 0,
            n_id: node.n_id || 0,
            p_id: node.p_id || 0,
            title: node.title || "",
            ...(node.label !== undefined && { label: node.label ?? "" }),
            ...(node.ref_type !== undefined && { ref_type: node.ref_type }),
            img_url: node.img_url || "",
            text: node.text || "",
            table: (hasValidHeaders && hasRowOrCellContent) ? node.table : {},
            children: (node.children || []).map((child: any) => parseTreeNode(child)),
        };
    };

    const parseHeadingNumber = (title?: string): string | undefined => {
        const matched = String(title || "").trim().match(HEADING_NUM_RE);
        return matched?.[1];
    };
    const normalizeEditRootChapterNumbers = (roots: TreeNode[]): TreeNode[] => {
        if (isReadOnly || !Array.isArray(roots) || roots.length === 0) return roots;
        const normalizeBusinessTitle = (title?: string) =>
            String(title || "").trim()
                .replace(/^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
                .replace(/\s+/g, "");
        const isFrontMatterTitle = (title?: string) =>
            /^(目录|需求规格说明|文件修订记录|软件概要设计说明书|软件概要设计)$/.test(normalizeBusinessTitle(title));
        const firstBodyMajor = roots
            .filter((node) => !isFrontMatterTitle(node.title))
            .map((node) => parseHeadingNumber(node.title))
            .map((num) => Number(String(num || "").split(".")[0]))
            .find((major) => Number.isFinite(major) && major > 0) || 0;
        if (firstBodyMajor <= 1) return roots;
        const offset = firstBodyMajor - 1;
        const shiftTitle = (title?: string) => {
            const raw = String(title || "");
            const matched = raw.trim().match(HEADING_NUM_RE);
            if (!matched?.[1]) return raw;
            const parts = matched[1].split(".").map((part) => Number(part));
            if (!parts.length || !Number.isFinite(parts[0]) || parts[0] <= offset) return raw;
            parts[0] -= offset;
            return raw.replace(matched[1], parts.map((part) => String(part)).join("."));
        };
        const walk = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => ({
            ...node,
            title: isFrontMatterTitle(node.title) ? node.title : shiftTitle(node.title),
            children: walk(node.children || []),
        }));
        return walk(roots);
    };

    const rebindFlowImageToFlowChild = (roots: TreeNode[]): TreeNode[] => {
        const walk = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => {
            const nextChildren = walk((node.children || []) as TreeNode[]);
            const merged = `${node.title || ""} ${node.label || ""} ${node.text || ""}`;
            let nextNode: TreeNode = { ...node, children: nextChildren };
            if (/网络安全流程图|安全流程图/.test(merged) && String(node.img_url || "").trim() && nextChildren.length > 0) {
                const pickedIdx = nextChildren.findIndex((child) =>
                    /网络安全流程图|安全流程图/.test(`${child.title || ""} ${child.label || ""}`)
                    || /^导入图片\d+$/i.test(String(child.title || "").trim())
                );
                if (pickedIdx >= 0) {
                    const target = { ...nextChildren[pickedIdx] };
                    if (!String(target.img_url || "").trim()) target.img_url = String(node.img_url || "");
                    const mergedChildren = [...nextChildren];
                    mergedChildren[pickedIdx] = target;
                    nextNode = { ...nextNode, img_url: "", children: mergedChildren };
                }
            }
            return nextNode;
        });
        return walk(roots || []);
    };

    const normalizeImageRefTypes = (roots: TreeNode[]): TreeNode[] => {
        const detectRefType = (txt: string): string | undefined => {
            const normalized = String(txt || "")
                .replace(/^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
                .replace(/^图\s*\d+\s*/, "")
                .replace(/\s+/g, "")
                .trim();
            if (/物理拓扑/.test(normalized)) return "img_topo";
            if (/系统结构|体系结构/.test(normalized)) return "img_struct";
            return undefined;
        };
        const walk = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => {
            const merged = `${node.title || ""} ${node.label || ""}`;
            const guessedRefType = detectRefType(merged);
            const nextChildren = walk((node.children || []) as TreeNode[]);
            const keepExistingRefType = node.ref_type && !DOC_IMAGE_REF_TYPES.includes(node.ref_type as any);
            const keepDocImageRefType = node.ref_type && DOC_IMAGE_REF_TYPES.includes(node.ref_type as any);
            const isMisboundProductImg = !guessedRefType && /\/img_topo\/|\/img_struct\//.test(String((node as any).img_url || ""));
            return {
                ...node,
                ref_type: guessedRefType || (keepDocImageRefType ? node.ref_type : undefined) || (keepExistingRefType ? node.ref_type : undefined),
                ...(isMisboundProductImg ? { img_url: "" } : {}),
                children: nextChildren,
            };
        });
        return walk(roots || []);
    };

    const generateTempNodeId = () => Date.now() + Math.floor(Math.random() * 100000);
    const getTableHitCount = (node: any, keys: string[]) => {
        const headers = Array.isArray(node?.table?.headers) ? node.table.headers : [];
        const rows = Array.isArray(node?.table?.rows) ? node.table.rows : [];
        const txt = `${headers.map((h: any) => String(h?.name || "")).join(" ")} ${rows.map((r: any) => Object.values(r || {}).join(" ")).join(" ")}`;
        return keys.filter((k) => txt.includes(k)).length;
    };
    const createCoverTableNode = (): TreeNode => ({
        id: generateTempNodeId(),
        doc_id: 0,
        n_id: 0,
        p_id: 0,
        title: "软件概要设计",
        text: "",
        table: {
            headers: HLD_APPROVAL_HEADERS,
            rows: [
                { label1: "编制部门", value1: "", label2: "文件版本", value2: "" },
                { label1: "编制人", value1: "", label2: "日期", value2: "" },
                { label1: "审核人", value1: "", label2: "日期", value2: "" },
                { label1: "批准人", value1: "", label2: "日期", value2: "" },
                { label1: "生效日期", value1: "", label2: "", value2: "" },
            ],
        } as any,
        children: [],
    });
    const createChangeLogTableNode = (): TreeNode => ({
        id: generateTempNodeId(),
        doc_id: 0,
        n_id: 0,
        p_id: 0,
        title: "文件修订记录",
        text: "",
        table: {
            headers: [
                { code: "change_date", name: "修改日期" },
                { code: "version_no", name: "版本号" },
                { code: "change_desc", name: "修订说明" },
                { code: "changer", name: "修订人" },
                { code: "approver", name: "批准人" },
            ],
            rows: Array.from({ length: 5 }, () => ({ change_date: "", version_no: "", change_desc: "", changer: "", approver: "" })),
        } as any,
        children: [],
    });
    const ensureFrontMatterTables = (roots: TreeNode[]): TreeNode[] => {
        const list = [...(roots || [])];
        let hasCover = false;
        let hasChange = false;
        const walk = (nodes: TreeNode[]) => {
            (nodes || []).forEach((node) => {
                const title = String(node?.title || "").replace(/\s+/g, "");
                if (title.includes("软件概要设计")) hasCover = true;
                if (title.includes("文件修订记录")) hasChange = true;
                if (getTableHitCount(node, ["编制科室", "编制部门", "文件版本", "编制人", "审核人", "批准人", "生效日期"]) >= 3) hasCover = true;
                if (getTableHitCount(node, ["修改日期", "版本号", "修订说明", "修订人", "批准人"]) >= 3) hasChange = true;
                walk((node.children || []) as TreeNode[]);
            });
        };
        walk(list);
        const prefix: TreeNode[] = [];
        if (!hasCover) prefix.push(createCoverTableNode());
        if (!hasChange) prefix.push(createChangeLogTableNode());
        return prefix.length > 0 ? [...prefix, ...list] : list;
    };
    const buildStandardNodesWithIds = (): TreeNode[] => {
        const addIdsToNodes = (nodes: any[]): TreeNode[] => nodes.map((node) => ({
            ...node,
            id: generateTempNodeId(),
            children: node.children ? addIdsToNodes(node.children) : [],
        }));
        return ensureFrontMatterTables(addIdsToNodes(standardNodes as any[]));
    };

    const isImportedTablePlaceholderTitle = (value?: string) => /^导入表格\d*$/.test(String(value || "").trim());
    const isJsonLikeKeyValueLine = (value?: string): boolean => {
        const txt = String(value || "").trim();
        return !!txt && /^['"]\s*[^'"]+\s*['"]\s*:\s*.+$/.test(txt);
    };
    const isLikelyWrongFieldCaption = (value?: string, table?: any): boolean => {
        const txt = String(value || "").trim();
        if (!txt || !table) return false;
        const headers = Array.isArray(table.headers) ? table.headers : [];
        const rows = Array.isArray(table.rows) ? table.rows : [];
        if (headers.length < 2 || rows.length < 1) return false;
        const firstRow = rows[0] || {};
        const left = String(firstRow?.[headers[0]?.code] ?? "").trim();
        const right = String(firstRow?.[headers[1]?.code] ?? "").trim();
        return !!left && !!right && (txt === `${left}: ${right}` || txt === `${left}:${right}` || txt === `${left}：${right}`);
    };
    const isLikelyTableCaptionLineForPersist = (line?: string) => {
        const txt = String(line || "").trim();
        if (!txt || isJsonLikeKeyValueLine(txt)) return false;
        if (/^(表|table)\s*\d+/i.test(txt)) return true;
        if (/^图\s*\d+/i.test(txt)) return false;
        if (/.+表\s*[:：]?$/.test(txt)) return true;
        if (/^[A-Za-z][A-Za-z0-9_]{1,64}[:：]\s*.+$/.test(txt)) return true;
        if (/[:：]/.test(txt) && txt.length <= 80 && !/[。！？]$/.test(txt)) {
            const parts = txt.split(/[:：]/).map((p) => String(p || "").trim());
            const left = parts[0] || "";
            const right = parts.slice(1).join("").trim();
            if (left && right && (/^[A-Za-z][A-Za-z0-9_]{1,64}$/.test(left) || /表/.test(left))) return true;
            if (left && !right && /表/.test(left)) return true;
        }
        return false;
    };
    const inferTableTitleForPersist = (node: TreeNode): string => {
        if (!hasRenderableTable((node as any).table)) return "";
        const lines = String((node as any).text || "").replace(/\r/g, "").split("\n").map((line) => String(line || "").trim()).filter(Boolean);
        return lines.find((line) => isLikelyTableCaptionLineForPersist(line) && !/^图\s*\d+/i.test(line)) || "";
    };
    const bindTableCaptionsForPersist = (roots: TreeNode[]): TreeNode[] => {
        const walk = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => {
            const nextChildren = walk((node.children || []) as TreeNode[]);
            const tableChildIdx = nextChildren.map((child, idx) => ({ child, idx })).filter(({ child }) => hasRenderableTable((child as any).table));
            let nextText = String(node.text || "");
            if (tableChildIdx.length > 0) {
                const lines = nextText.replace(/\r/g, "").split("\n");
                const captions = lines.map((line, idx) => ({ idx, txt: String(line || "").trim() })).filter((item) => isLikelyTableCaptionLineForPersist(item.txt));
                if (captions.length > 0) {
                    const used = new Set<number>();
                    tableChildIdx.forEach(({ idx }, order) => {
                        const cap = captions[order];
                        if (!cap?.txt || isJsonLikeKeyValueLine(cap.txt)) return;
                        const child = nextChildren[idx];
                        if (!String(child.title || "").trim() || isImportedTablePlaceholderTitle(child.title)) {
                            nextChildren[idx] = { ...child, label: cap.txt };
                        }
                        used.add(cap.idx);
                    });
                    if (used.size > 0) {
                        nextText = lines.filter((_line, idx) => !used.has(idx)).map((line) => String(line || "").trim()).filter(Boolean).join("\n");
                    }
                }
            }
            let nextLabel = String((node as any).label || "").trim();
            if (isLikelyWrongFieldCaption(nextLabel, (node as any).table) || isJsonLikeKeyValueLine(nextLabel)) nextLabel = "";
            if (hasRenderableTable((node as any).table) && !nextLabel) {
                const inferred = inferTableTitleForPersist(node);
                if (inferred) nextLabel = inferred;
            }
            return { ...node, ...(nextLabel ? { label: nextLabel } : {}), text: nextText, children: nextChildren };
        });
        return walk(roots || []);
    };

    const cleanTreeNode = (node: any, docId: number = 0, parentId: number = 0): any => {
        let tableValue: any = {};
        if (node.table) {
            const hasValidHeaders = node.table.headers && Array.isArray(node.table.headers) && node.table.headers.length > 0;
            const hasValidRows = node.table.rows && Array.isArray(node.table.rows) && node.table.rows.length > 0;
            const hasValidCells = node.table.cells && Array.isArray(node.table.cells) && node.table.cells.length > 1;
            if (hasValidHeaders && (hasValidRows || hasValidCells)) tableValue = node.table;
        }
        const cleaned: any = {
            doc_id: node.doc_id || docId || 0,
            n_id: (typeof node.id === "string" || !node.n_id) ? 0 : node.n_id,
            p_id: node.p_id || parentId || 0,
            title: node.title || "",
            ...(node.label !== undefined && { label: node.label ?? "" }),
            ...(node.ref_type !== undefined && { ref_type: node.ref_type }),
            img_url: node.img_url || "",
            text: node.text || "",
            table: tableValue,
            children: [],
        };
        if (node.children && Array.isArray(node.children)) {
            cleaned.children = node.children.map((child: any) => cleanTreeNode(child, docId, cleaned.n_id));
        }
        return cleaned;
    };

    const syncTreeFromSds = async (
        productId: number,
        version: string,
        nodes: TreeNode[],
        options?: { silent?: boolean },
    ): Promise<TreeNode[]> => {
        if (!productId || !String(version || "").trim()) return nodes;
        const silent = !!options?.silent;
        try {
            const res: any = await Api.sync_hld_from_sds({ product_id: productId, version: String(version).trim() });
            if (res.code !== Api.C_OK) {
                if (!silent) message.warning(res?.msg || "未找到同版本详细设计，接口/库表未同步");
                return stripLegacyInterfaceText(nodes);
            }
            if (!hasSdsSyncData(res.data)) {
                if (!silent) message.warning("详细设计中暂无接口汇总表或库表数据");
                return stripLegacyInterfaceText(nodes);
            }
            return applySdsSyncToTree(nodes, res.data);
        } catch (error) {
            console.error("从详细设计同步失败:", error);
            if (!silent) message.warning("从详细设计同步失败，已保留当前目录结构");
            return nodes;
        }
    };

    const applyProductContextToTree = async (
        nodes: TreeNode[],
        targetProductId: number,
        targetVersion: string,
        product?: any,
        options?: { silent?: boolean },
    ): Promise<TreeNode[]> => {
        if (!targetProductId || !String(targetVersion || "").trim() || !Array.isArray(nodes) || nodes.length === 0) {
            return nodes;
        }
        let next = applyProductScopeToTree(nodes, product).nodes;
        next = applyProductBasicInfoToTree(next, product).nodes;
        next = await remapRefTypeImagesByProduct(next, targetProductId, targetVersion);
        next = await syncTreeFromSds(targetProductId, targetVersion, next, options);
        return next;
    };

    const buildStandardTreeForDoc = async (productId: number, version: string, product?: any): Promise<TreeNode[]> => {
        let nodesWithIds = applyProductScopeToTree(buildStandardNodesWithIds(), product).nodes;
        nodesWithIds = rebindFlowImageToFlowChild(nodesWithIds);
        nodesWithIds = normalizeImageRefTypes(nodesWithIds);
        nodesWithIds = await remapRefTypeImagesByProduct(nodesWithIds, productId, version);
        nodesWithIds = await syncTreeFromSds(productId, version, nodesWithIds);
        return nodesWithIds;
    };

    const needsStandardTemplate = (nodes: TreeNode[]): boolean => {
        const list = nodes || [];
        if (list.length === 0) return true;
        const hasMainChapter = (items: TreeNode[]): boolean =>
            (items || []).some((node) => {
                const title = String(node.title || "").trim();
                if (/^1[\s.．、]/.test(title) || /引言/.test(title) || /^2[\s.．、]/.test(title) || /总体设计/.test(title)) {
                    return true;
                }
                return hasMainChapter((node.children || []) as TreeNode[]);
            });
        return !hasMainChapter(list);
    };

    const resolveProductById = async (productId?: number) => {
        if (!productId) return undefined;
        const cached = (data.products as any[]).find((p: any) => p.id === productId);
        if (cached) return cached;
        const res: any = await ApiProduct.list_product({ page_index: 0, page_size: 1000 });
        if (res.code !== ApiProduct.C_OK) return undefined;
        const rows = res.data?.rows || [];
        dispatch({ products: rows });
        return rows.find((p: any) => p.id === productId);
    };

    const formatProductLabel = (pid?: number) => {
        if (!pid) return "-";
        const hit = (data.products as any[]).find((p: any) => p.id === pid);
        return hit ? `${hit.name}-${hit.full_version}` : String(pid);
    };

    const tryPromptProductContextSync = (pid?: number, ver?: string) => {
        if (isReadOnly || productContextRevertingRef.current) return;
        if (!productContextReadyRef.current || productSyncModalOpenRef.current) return;

        const normalizedPid = pid ?? undefined;
        const normalizedVer = String(ver || "").trim();
        const last = lastProductContextRef.current;
        const pidSame = (last.productId ?? undefined) === normalizedPid;
        const verSame = String(last.version || "") === normalizedVer;
        if (pidSame && verSame) return;

        const commitContext = (nextPid?: number, nextVer?: string) => {
            lastProductContextRef.current = {
                productId: nextPid,
                version: String(nextVer || "").trim(),
            };
        };

        const revertForm = () => {
            productContextRevertingRef.current = true;
            editForm.setFieldsValue({
                product_id: last.productId,
                version: last.version,
            });
            window.setTimeout(() => {
                productContextRevertingRef.current = false;
            }, 0);
        };

        const runSync = async (targetPid: number, targetVer: string) => {
            const treeNodes = (treeStructureRef.current || data.treeStructure || []) as TreeNode[];
            dispatch({ loading: true });
            try {
                const product = await resolveProductById(targetPid);
                const synced = await applyProductContextToTree(treeNodes, targetPid, targetVer, product);
                treeStructureRef.current = synced;
                dispatch({
                    treeStructure: synced,
                    treeRefreshKey: Date.now(),
                    docProductId: targetPid,
                    docVersion: targetVer,
                });
                commitContext(targetPid, targetVer);
                message.success(ts("hld_doc.sync_on_product_change_success"));
            } catch (error) {
                console.error("切换产品同步失败:", error);
                message.error(ts("msg_req_fail"));
                revertForm();
            } finally {
                dispatch({ loading: false });
                productSyncModalOpenRef.current = false;
            }
        };

        if (!normalizedPid || !normalizedVer) {
            if (!normalizedPid && !normalizedVer) commitContext(undefined, "");
            return;
        }

        const treeNodes = (treeStructureRef.current || data.treeStructure || []) as TreeNode[];
        if (!treeNodes.length) {
            commitContext(normalizedPid, normalizedVer);
            return;
        }

        productSyncModalOpenRef.current = true;

        const oldLabel = formatProductLabel(last.productId);
        const newLabel = formatProductLabel(normalizedPid);
        const versionChanged = String(last.version || "") !== normalizedVer;
        const productChanged = (last.productId ?? undefined) !== normalizedPid;
        const isFirstSelection = last.productId == null && !last.version;
        const changeHint = isFirstSelection
            ? ts("hld_doc.sync_on_product_change_first", { to: newLabel, version: normalizedVer })
            : productChanged && versionChanged
                ? ts("hld_doc.sync_on_product_change_both", { from: oldLabel, to: newLabel, version: normalizedVer })
                : productChanged
                    ? ts("hld_doc.sync_on_product_change_product", { from: oldLabel, to: newLabel })
                    : ts("hld_doc.sync_on_product_change_version", { from: last.version, to: normalizedVer });

        Modal.confirm({
            title: ts("hld_doc.sync_on_product_change_title"),
            content: (
                <>
                    <div>{changeHint}</div>
                    <div style={{ marginTop: 8 }}>{ts("hld_doc.sync_on_product_change_warning")}</div>
                </>
            ),
            okText: ts("confirm") || "确定",
            cancelText: ts("cancel") || "取消",
            maskClosable: false,
            onOk: () => runSync(normalizedPid, normalizedVer),
            onCancel: () => {
                revertForm();
                productSyncModalOpenRef.current = false;
            },
        });
    };

    const handleProductIdFieldChange = (value?: number) => {
        editForm.setFieldValue("product_id", value);
        const ver = String(editForm.getFieldValue("version") || "").trim();
        if (!value) return;
        if (!ver) {
            message.info(ts("hld_doc.please_fill_version_before_sync"));
            return;
        }
        tryPromptProductContextSync(value, ver);
    };

    const handleDocVersionFieldCommit = () => {
        const pid = editForm.getFieldValue("product_id") as number | undefined;
        const ver = String(editForm.getFieldValue("version") || "").trim();
        if (!pid || !ver) return;
        tryPromptProductContextSync(pid, ver);
    };

    const renderProductVersionSelect = () => (
        <ProductVersionSelect
            products={data.products}
            allowClear
            namePlaceholder={ts("product.name")}
            versionPlaceholder={ts("product.full_version")}
            onChange={handleProductIdFieldChange}
        />
    );

    const renderDocVersionInput = (disabled?: boolean, width = 130) => (
        <Input
            allowClear
            placeholder={ts("hld_doc.please_input_version")}
            disabled={disabled}
            style={{ width }}
            onBlur={handleDocVersionFieldCommit}
            onPressEnter={handleDocVersionFieldCommit}
        />
    );

    const applyLoadedDocTree = async (targetRow: any): Promise<{ nodes: TreeNode[]; autoRepaired: boolean }> => {
        const parsedTree = (targetRow.content || []).map((node: any) => parseTreeNode(node));
        const parsedTreeForView = isReadOnly ? parsedTree : normalizeEditRootChapterNumbers(parsedTree);
        const flowReboundTree = rebindFlowImageToFlowChild(parsedTreeForView);
        const normalizedRefTree = normalizeImageRefTypes(flowReboundTree);
        const parsedContent = isReadOnly ? bindTableCaptionsForPersist(normalizedRefTree) : normalizedRefTree;
        let remappedContent = await remapRefTypeImagesByProduct(parsedContent, targetRow.product_id, targetRow.version);
        remappedContent = ensureFrontMatterTables(remappedContent as TreeNode[]);
        const needRepair = !isReadOnly && needsLegacyInterfaceRepair(remappedContent as TreeNode[]);
        if (needRepair) {
            const before = JSON.stringify(remappedContent);
            remappedContent = await syncTreeFromSds(targetRow.product_id, targetRow.version, remappedContent as TreeNode[]);
            const autoRepaired = before !== JSON.stringify(remappedContent);
            if (autoRepaired) {
                message.info(ts("hld_doc.auto_sync_interface_layout"));
            }
            return { nodes: remappedContent as TreeNode[], autoRepaired };
        }
        return { nodes: remappedContent as TreeNode[], autoRepaired: false };
    };

    useEffect(() => {
        const id = params.id;
        let cancelled = false;
        if (!id) {
            editForm.resetFields();
            const initialTree = buildStandardNodesWithIds();
            dispatch({ isEdit: false, treeStructure: initialTree, treeRefreshKey: Date.now() });
            treeStructureRef.current = initialTree;
            lastProductContextRef.current = { version: "" };
            productContextReadyRef.current = true;
            productSyncModalOpenRef.current = false;
            return () => { cancelled = true; };
        }
        dispatch({ loading: true, isEdit: !isReadOnly });
        productContextReadyRef.current = false;
        productSyncModalOpenRef.current = false;
        (async () => {
            try {
                const res: any = await Api.get_hld_doc({ id });
                if (cancelled) return;
                if (res.code !== Api.C_OK || !res.data) {
                    message.error(res?.msg || ts("msg_req_fail"));
                    return;
                }
                const targetRow = res.data;
                editForm.setFieldsValue({
                    id: targetRow.id,
                    product_id: targetRow.product_id,
                    version: targetRow.version,
                    file_no: targetRow.file_no,
                });
                const loadResult = await applyLoadedDocTree(targetRow);
                let ensuredContent = loadResult.nodes;
                let shouldInitStandard = false;
                const shouldSaveRepaired = loadResult.autoRepaired;
                if (!isReadOnly && needsStandardTemplate(ensuredContent)) {
                    const product = await resolveProductById(targetRow.product_id);
                    if (cancelled) return;
                    ensuredContent = await buildStandardTreeForDoc(targetRow.product_id, targetRow.version, product);
                    shouldInitStandard = true;
                }
                dispatch({
                    loading: false,
                    changeDescription: targetRow.change_log || "",
                    docNId: targetRow.n_id || 0,
                    treeStructure: ensuredContent,
                    docProductId: targetRow.product_id,
                    docVersion: targetRow.version ?? "",
                    treeRefreshKey: Date.now(),
                });
                treeStructureRef.current = ensuredContent;
                lastProductContextRef.current = {
                    productId: targetRow.product_id,
                    version: String(targetRow.version || "").trim(),
                };
                productContextReadyRef.current = true;
                productSyncModalOpenRef.current = false;
                if (!isReadOnly && (shouldInitStandard || shouldSaveRepaired)) {
                    const docId = targetRow.id || parseInt(String(id), 10);
                    try {
                        const contentPayload = (ensuredContent as TreeNode[]).map((node) => cleanTreeNode(node, docId, 0));
                        Api.update_hld_doc({
                            id: docId,
                            product_id: targetRow.product_id,
                            version: targetRow.version,
                            file_no: targetRow.file_no,
                            change_log: targetRow.change_log || "",
                            content: contentPayload,
                            n_id: targetRow.n_id || 0,
                        }).catch((error: any) => console.error("静默保存概要设计目录失败:", error));
                    } catch (error) {
                        console.error("构建概要设计目录保存数据失败:", error);
                    }
                }
            } catch (error) {
                if (!cancelled) {
                    console.error("加载概要设计失败:", error);
                    message.error(ts("msg_req_fail"));
                }
            } finally {
                if (!cancelled) {
                    dispatch({ loading: false });
                }
            }
        })();
        return () => { cancelled = true; };
    }, [params.id, isReadOnly]);

    const handleEditChangeDesc = () => dispatch({ showChangeDescModal: true, tempChangeDescription: data.changeDescription });
    const handleSaveChangeDesc = () => {
        dispatch({ changeDescription: data.tempChangeDescription, showChangeDescModal: false });
        message.success(ts("save"));
    };
    const handleCancelChangeDesc = () => dispatch({ showChangeDescModal: false });

    const handleExport = () => {
        if (!data.isEdit || !params.id) {
            message.warning(ts("hld_doc.please_save_document_first"));
            return;
        }
        dispatch({ exporting: true });
        Api.export_hld_doc({ id: params.id }).then((res: any) => {
            dispatch({ exporting: false });
            if (res.code !== Api.C_OK) message.error(res.msg);
        });
    };

    const handleLoadStandardNode = async () => {
        if (!editForm.getFieldValue("product_id")) {
            message.warning(ts("hld_doc.please_select_product_and_version"));
            return;
        }
        const pid = editForm.getFieldValue("product_id");
        const version = editForm.getFieldValue("version");
        const nodesWithIds = await buildStandardTreeForDoc(pid, version, currentProduct);
        treeStructureRef.current = nodesWithIds;
        dispatch({ treeStructure: nodesWithIds, treeRefreshKey: Date.now() });
        message.success(ts("hld_doc.load_standard_structure_success"));
    };

    const handleSyncFromSds = async () => {
        const pid = editForm.getFieldValue("product_id");
        const version = editForm.getFieldValue("version");
        if (!pid || !String(version || "").trim()) {
            message.warning(ts("hld_doc.please_select_product_and_version"));
            return;
        }
        dispatch({ loading: true });
        try {
            const syncedTree = await syncTreeFromSds(pid, version, (treeStructureRef.current || data.treeStructure || []) as TreeNode[]);
            treeStructureRef.current = syncedTree;
            dispatch({ treeStructure: syncedTree, treeRefreshKey: Date.now() });
            message.success(ts("hld_doc.sync_from_sds_success"));
        } finally {
            dispatch({ loading: false });
        }
    };

    const handleInitTemplate = () => {
        const load = async () => { await handleLoadStandardNode(); };
        if (params.id && data.isEdit) {
            Modal.confirm({
                title: ts("hld_doc.init_template"),
                content: "将用标准模板（含默认值）覆盖当前目录结构，未保存的修改会丢失。是否继续？",
                okText: ts("confirm") || "确定",
                cancelText: ts("cancel") || "取消",
                onOk: load,
            });
            return;
        }
        void load();
    };

    const handleAddRootNode = () => {
        const newNode: TreeNode = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            doc_id: params.id ? parseInt(params.id, 10) : 0,
            n_id: 0,
            p_id: 0,
            title: "新章节",
            img_url: undefined,
            text: "",
            table: {},
            children: [],
        };
        const nextTree = [...(data.treeStructure as TreeNode[]), newNode];
        treeStructureRef.current = nextTree;
        dispatch({ treeStructure: nextTree });
    };

    const handleNodeDelete = async (docId: number, nodeId: number): Promise<boolean> => {
        try {
            const res = await Api.delete_hld_node({ doc_id: docId, n_id: nodeId });
            if (res.code === Api.C_OK) {
                message.success(ts("delete") + ts("save_success"));
                return true;
            }
            message.error(res.msg || ts("delete") + ts("save_failed"));
            return false;
        } catch (error) {
            message.error(ts("delete") + ts("save_failed"));
            console.error("删除节点失败:", error);
            return false;
        }
    };

    const handleSaveTreeStructure = () => {
        const docId = params.id ? parseInt(params.id, 10) : 0;
        if (!docId) {
            editForm.validateFields().then(() => doSaveTreeStructure()).catch((err: any) => {
                const names = (err?.errorFields || []).flatMap((f: any) => f.name || []);
                if (names.includes("product_id")) {
                    message.error(ts("hld_doc.please_select_product_required"));
                } else if (names.includes("version")) {
                    message.error(ts("hld_doc.version_required"));
                } else {
                    message.error(ts("hld_doc.please_select_product_and_version"));
                }
            });
            return;
        }
        doSaveTreeStructure();
    };

    const doSaveTreeStructure = () => {
        const productIdVal = editForm.getFieldValue("product_id");
        const version = String(editForm.getFieldValue("version") || "").trim();
        if (!productIdVal) {
            message.error(ts("hld_doc.please_select_product_required"));
            return;
        }
        if (!version) {
            message.error(ts("hld_doc.version_required"));
            return;
        }
        dispatch({ saving: true });
        const docId = params.id ? parseInt(params.id, 10) : 0;
        const currentTree = ((treeStructureRef.current?.length ? treeStructureRef.current : data.treeStructure) || []) as TreeNode[];
        const payload = {
            id: docId,
            product_id: productIdVal,
            version,
            file_no: editForm.getFieldValue("file_no"),
            change_log: data.changeDescription || "",
            content: currentTree.map((node) => cleanTreeNode(node, docId, 0)),
            n_id: data.docNId || 0,
        };
        const apiCall = params.id ? Api.update_hld_doc(payload) : Api.add_hld_doc(payload);
        apiCall.then(async (res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                message.success(ts("save_success"));
                if (!params.id && res.data?.id) {
                    navigate(`/hld_docs/edit/${res.data.id}`, { replace: true });
                } else if (params.id) {
                    const reloadRes: any = await Api.get_hld_doc({ id: params.id });
                    if (reloadRes.code === Api.C_OK) {
                        const targetRow = reloadRes.data;
                        editForm.setFieldsValue({
                            id: targetRow.id,
                            product_id: targetRow.product_id,
                            version: targetRow.version,
                            file_no: targetRow.file_no,
                        });
                        const loadResult = await applyLoadedDocTree(targetRow);
                        dispatch({
                            changeDescription: targetRow.change_log || "",
                            docNId: targetRow.n_id || 0,
                            treeStructure: loadResult.nodes,
                            treeRefreshKey: Date.now(),
                        });
                        treeStructureRef.current = loadResult.nodes;
                    }
                }
            } else {
                message.error(res.msg || ts("save_failed"));
            }
        }).catch((error) => {
            dispatch({ saving: false });
            message.error(ts("save_failed"));
            console.error(ts("save_failed"), error);
        });
    };

    const normalizeText = (value?: string) => (value || "").replace(/\s+/g, "");
    const hasTableContent = (node: TreeNode) => !!(node.table && Array.isArray(node.table.rows) && node.table.rows.length > 0);
    const getTableText = (node: TreeNode) => {
        if (!hasTableContent(node) || !node.table) return "";
        const headerTxt = (node.table.headers || []).map((h: any) => h?.name || "").join(" ");
        const rowTxt = (node.table.rows || []).map((row: any) => Object.values(row || {}).join(" ")).join(" ");
        return `${headerTxt} ${rowTxt}`;
    };
    const hitCount = (txt: string, keys: string[]) => keys.filter((k) => txt.includes(k)).length;
    const isCoverTable = (node: TreeNode) => hitCount(getTableText(node), ["编制科室", "编制部门", "文件版本", "编制人", "审核人", "批准人", "生效日期"]) >= 3;
    const isChangeLogTable = (node: TreeNode) => hitCount(getTableText(node), ["修改日期", "版本号", "修订说明", "修订人", "批准人"]) >= 3;
    const isCatalogNode = (node: TreeNode) => normalizeText(node.title).includes("目录");
    const isCoverNode = (node: TreeNode) => normalizeText(node.title).includes("软件概要设计") || isCoverTable(node);
    const isChangeLogNode = (node: TreeNode) => normalizeText(node.title).includes("文件修订记录") || isChangeLogTable(node);
    const subtreeMatches = (node: TreeNode, matchFn: (n: TreeNode) => boolean): boolean =>
        matchFn(node) || (node.children || []).some((child) => subtreeMatches(child, matchFn));
    const collectSubtreeIds = (node: TreeNode): number[] => {
        const ids = [node.id];
        (node.children || []).forEach((child) => ids.push(...collectSubtreeIds(child)));
        return ids;
    };
    const collectTableNodes = (node: TreeNode): TreeNode[] => {
        const list: TreeNode[] = [];
        const walk = (item: TreeNode) => {
            if (hasTableContent(item)) list.push(item);
            (item.children || []).forEach(walk);
        };
        walk(node);
        return list;
    };

    const treeRoots = data.treeStructure as TreeNode[];
    const coverRoot = treeRoots.find((node) => normalizeText(node.title).includes("软件概要设计"));
    const changeLogRoot = treeRoots.find((node) => normalizeText(node.title).includes("文件修订记录"));
    const coverRoots = coverRoot ? [coverRoot] : treeRoots.filter((node) => subtreeMatches(node, isCoverNode));
    const changeLogRoots = changeLogRoot ? [changeLogRoot] : treeRoots.filter((node) => subtreeMatches(node, isChangeLogNode));
    const hiddenNodeIds = treeRoots
        .filter((node) => isCatalogNode(node) || subtreeMatches(node, isCoverNode) || subtreeMatches(node, isChangeLogNode))
        .flatMap((node) => collectSubtreeIds(node));

    const approvalHeaders = HLD_APPROVAL_HEADERS;
    const normalizeApprovalRows = (node: TreeNode) => normalizeHldApprovalRows(node);
    const updateTreeCell = (targetNodeId: number, rowIndex: number, colCode: string, value: string, useApproval = false) => {
        const updateNode = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => {
            const isTarget = String(node.id) === String(targetNodeId) || String(node.n_id || "") === String(targetNodeId);
            if (isTarget && node.table) {
                if (useApproval) {
                    const rows = normalizeApprovalRows(node).map((row: any) => ({ ...row }));
                    rows[rowIndex] = { ...(rows[rowIndex] || {}), [colCode]: value };
                    return { ...node, table: { ...node.table, headers: approvalHeaders, rows } };
                }
                const nextRows = [...(node.table.rows || [])];
                while (nextRows.length <= rowIndex) nextRows.push({});
                nextRows[rowIndex] = { ...(nextRows[rowIndex] || {}), [colCode]: value };
                return { ...node, table: { ...node.table, rows: nextRows } };
            }
            return { ...node, children: updateNode(node.children || []) };
        });
        const nextTree = updateNode(data.treeStructure as TreeNode[]);
        treeStructureRef.current = nextTree;
        dispatch({ treeStructure: nextTree });
    };

    const applyVersionToCoverTable = (nodes: TreeNode[], version?: any): { nodes: TreeNode[]; changed: boolean } => {
        const ver = String(version ?? "");
        let changed = false;
        const walk = (items: TreeNode[]): TreeNode[] => (items || []).map((node) => {
            const children = walk((node.children || []) as TreeNode[]);
            let nextNode: TreeNode = { ...node, children };
            if (nextNode.table && isCoverTable(nextNode)) {
                const rows = normalizeApprovalRows(nextNode).map((r: any) => ({ ...r }));
                if (String((rows[0] || {}).value2 ?? "") !== ver) {
                    rows[0] = { ...(rows[0] || {}), value2: ver };
                    nextNode = { ...nextNode, table: { ...nextNode.table, headers: approvalHeaders, rows } };
                    changed = true;
                }
            }
            return nextNode;
        });
        return { nodes: walk(nodes), changed };
    };
    const applyDeptToCoverTable = (nodes: TreeNode[], dept: string): { nodes: TreeNode[]; changed: boolean } => {
        const want = String(dept ?? "");
        if (!want) return { nodes, changed: false };
        let changed = false;
        const walk = (items: TreeNode[]): TreeNode[] => (items || []).map((node) => {
            const children = walk((node.children || []) as TreeNode[]);
            let nextNode: TreeNode = { ...node, children };
            if (nextNode.table && isCoverTable(nextNode)) {
                const rows = normalizeApprovalRows(nextNode).map((r: any) => ({ ...r }));
                if (!String((rows[0] || {}).value1 ?? "").trim()) {
                    rows[0] = { ...(rows[0] || {}), value1: want };
                    nextNode = { ...nextNode, table: { ...nextNode.table, headers: approvalHeaders, rows } };
                    changed = true;
                }
            }
            return nextNode;
        });
        return { nodes: walk(nodes), changed };
    };
    const ensureChangeLogMinRows = (nodes: TreeNode[], minRows = 5): { nodes: TreeNode[]; changed: boolean } => {
        let changed = false;
        const walk = (items: TreeNode[]): TreeNode[] => (items || []).map((node) => {
            const children = walk((node.children || []) as TreeNode[]);
            let nextNode: TreeNode = { ...node, children };
            if (nextNode.table && isChangeLogTable(nextNode)) {
                const rows = [...((nextNode.table as any).rows || [])];
                while (rows.length < minRows) {
                    rows.push({ change_date: "", version_no: "", change_desc: "", changer: "", approver: "" });
                    changed = true;
                }
                if (changed) nextNode = { ...nextNode, table: { ...nextNode.table, rows } as any };
            }
            return nextNode;
        });
        return { nodes: walk(nodes), changed };
    };
    useEffect(() => {
        if (!(data.treeStructure as TreeNode[] || []).length) return;
        const verResult = applyVersionToCoverTable(data.treeStructure as TreeNode[], displayDocVersion);
        const deptResult = applyDeptToCoverTable(verResult.nodes, "研发部");
        const logResult = ensureChangeLogMinRows(deptResult.nodes, 5);
        if (verResult.changed || deptResult.changed || logResult.changed) {
            treeStructureRef.current = logResult.nodes;
            dispatch({ treeStructure: logResult.nodes });
        }
    }, [displayDocVersion, data.treeStructure]);

    useEffect(() => {
        if (!displayProductId || !(data.treeStructure as TreeNode[] || []).length) return;
        let cancelled = false;
        Promise.all([
            ApiTimeline.list_timeline({ prod_id: displayProductId }).catch(() => null),
            ApiMember.list_project_member({ prod_id: displayProductId, page_index: 0, page_size: 1000 }).catch(() => null),
            ApiPersonSign.list_person_sign({ page_index: 0, page_size: 1000 }).catch(() => null),
        ]).then(([tl, mb, ps]: any[]) => {
            if (cancelled) return;
            const tlRows = tl && tl.code === Api.C_OK ? ((tl.data && tl.data.rows) || []) : [];
            const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
            const signRows = ps && ps.code === Api.C_OK ? ((ps.data && ps.data.rows) || []) : [];
            const signMap: Record<string, string> = {};
            signRows.forEach((s: any) => { if (s.name && s.sign_img) signMap[String(s.name).trim()] = s.sign_img; });
            const findRole = (pred: (role: string) => boolean) => {
                const hit = members.find((m: any) => pred(String(m.role || "")));
                return hit ? String(hit.name || "").trim() : "";
            };
            const tpm = findRole((r) => r.includes("TPM"));
            const devLead = findRole((r) => r.includes("研发负责人"));
            const resolveSigner = (label: string) => {
                const who = label === "编制人" ? tpm : label === "审核人" || label === "批准人" ? devLead : "";
                return who ? (signMap[who] || who) : "";
            };
            const result = applyHldCoverRevisionAutofill(data.treeStructure as TreeNode[], {
                coverDate: computeHldCoverDate(tlRows),
                version: String(displayDocVersion || ""),
                resolveSigner,
                reviser: tpm,
                approver: devLead,
            });
            if (result.changed) {
                treeStructureRef.current = result.nodes;
                dispatch({ treeStructure: result.nodes });
            }
        });
        return () => { cancelled = true; };
    }, [displayProductId, displayDocVersion, data.treeStructure]);

    const renderApprovalTable = (node: TreeNode, keyPrefix: string) => {
        const columns = approvalHeaders.map((header: any, index: number) => ({
            title: "",
            dataIndex: header.code,
            key: `${keyPrefix}-col-${header.code}`,
            render: (text: string, _record: any, rowIndex: number) => {
                const isLabel = index === 0 || index === 2;
                if (typeof text === "string" && text.startsWith("data:image")) {
                    return <img src={text} alt="签名" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", display: "inline-block", verticalAlign: "middle" }} />;
                }
                if (isReadOnly || isLabel) return text || "";
                return (
                    <Input.TextArea
                        value={text || ""}
                        onChange={(e) => updateTreeCell(node.id, rowIndex, header.code, e.target.value, true)}
                        autoSize={{ minRows: 1, maxRows: 4 }}
                    />
                );
            },
        }));
        return (
            <Table
                key={`${keyPrefix}-${node.id}`}
                className={`srs-cover-table srs-approval-table${!isReadOnly ? " srs-extracted-edit-table" : ""}`}
                dataSource={normalizeApprovalRows(node).map((row: any, index: number) => ({ key: `${keyPrefix}-row-${index}`, ...row }))}
                columns={columns}
                pagination={false}
                size="small"
                bordered
            />
        );
    };

    const renderExtractedTable = (node: TreeNode, keyPrefix: string) => {
        if (!node.table?.headers || !node.table?.rows) return null;
        if (isCoverTable(node)) return renderApprovalTable(node, keyPrefix);
        const isChangeRecordTable = isChangeLogTable(node);
        const normalizedRows = [...(node.table.rows || [])];
        if (isChangeRecordTable) while (normalizedRows.length < 5) normalizedRows.push({});
        const columns = node.table.headers.map((header: any, index: number) => ({
            title: header.name || `列${index + 1}`,
            dataIndex: header.code,
            key: `${keyPrefix}-col-${header.code}`,
            render: (text: string, _record: any, rowIndex: number) => {
                if (isReadOnly) return text || "-";
                return (
                    <Input.TextArea
                        value={text || ""}
                        onChange={(e) => updateTreeCell(node.id, rowIndex, header.code, e.target.value)}
                        autoSize={{ minRows: 1, maxRows: 4 }}
                    />
                );
            },
        }));
        return (
            <Table
                key={`${keyPrefix}-${node.id}`}
                className={`${isChangeRecordTable ? "srs-change-log-table" : "srs-cover-table"}${!isReadOnly ? " srs-extracted-edit-table" : ""}`}
                dataSource={normalizedRows.map((row: any, index: number) => ({ key: `${keyPrefix}-row-${index}`, ...row }))}
                columns={columns}
                pagination={false}
                size="small"
                bordered
                scroll={{ x: Math.max(800, columns.length * 180) }}
            />
        );
    };

    const coverExtraNavSections = [
        {
            key: "cover",
            title: "封面",
            content: (
                <div className="extracted-doc-section">
                    <div className="extracted-item-title">软件概要设计</div>
                    {coverRoots.length > 0
                        ? coverRoots.flatMap((root) => collectTableNodes(root)).filter((node) => isCoverTable(node)).map((node, idx) => renderExtractedTable(node, `cover-${idx}`))
                        : <div className="extracted-empty">暂无</div>}
                </div>
            ),
        },
        {
            key: "changelog",
            title: "文件修订记录",
            content: (
                <div className="extracted-doc-section">
                    <div className="extracted-item-title">文件修订记录</div>
                    {changeLogRoots.length > 0
                        ? changeLogRoots.flatMap((root) => collectTableNodes(root)).filter((node) => isChangeLogTable(node)).map((node, idx) => renderExtractedTable(node, `change-${idx}`))
                        : <div className="extracted-empty">暂无</div>}
                </div>
            ),
        },
        {
            key: "change_desc",
            title: ts("hld_doc.version_change_description"),
            content: (
                <div className="extracted-doc-section">
                    <div className="doc-section-header">
                        <div className="change-desc-title">{ts("hld_doc.version_change_description")}</div>
                        {!isReadOnly && (
                            <Button type="primary" icon={<EditOutlined />} onClick={handleEditChangeDesc}>
                                {ts("hld_doc.edit_change_description")}
                            </Button>
                        )}
                    </div>
                    <div className={`doc-desc-content ${data.changeDescription ? "has-content" : ""}`}>
                        {data.changeDescription || ts("hld_doc.no_change_description")}
                    </div>
                </div>
            ),
        },
    ];

    return (
        <ConfigProvider theme={HLD_DOC_DETAIL_THEME}>
            <div className={`page div-v hld-doc-detail ${isReadOnly ? "read-only" : ""}`}>
                <Spin spinning={data.loading}>
                    <Form className="hld-toolbar-form" form={editForm} layout="inline">
                        <div className="div-h center-v hld-toolbar">
                            <Form.Item hidden name="id"><Input allowClear /></Form.Item>
                            {(data.isEdit || isReadOnly) ? (
                                <>
                                    {isReadOnly ? (
                                        <span className="hld-toolbar-meta">
                                            <span className="form-display-label">{ts("hld_doc.current_product")}：</span>
                                            <span className="form-display-value">{productLabel || "-"}</span>
                                        </span>
                                    ) : (
                                        <Form.Item className="hld-toolbar-item" label={ts("hld_doc.current_product")} name="product_id" rules={[{ required: true, message: ts("hld_doc.please_select_product_required") }]}>
                                            {renderProductVersionSelect()}
                                        </Form.Item>
                                    )}
                                    <Form.Item
                                        className="hld-toolbar-item"
                                        label={(data.isEdit || isReadOnly) ? ts("hld_doc.current_version") : ts("hld_doc.version_label")}
                                        name="version"
                                        rules={[{ required: !isReadOnly, message: ts("hld_doc.version_required") }]}>
                                        {renderDocVersionInput(isReadOnly)}
                                    </Form.Item>
                                </>
                            ) : (
                                <>
                                    <Form.Item className="hld-toolbar-item" label={ts("hld_doc.product")} name="product_id" rules={[{ required: true, message: ts("hld_doc.please_select_product_required") }]}>
                                        {renderProductVersionSelect()}
                                    </Form.Item>
                                    <Form.Item className="hld-toolbar-item" label={ts("hld_doc.version_label")} name="version" rules={[{ required: true, message: ts("hld_doc.version_required") }]}>
                                        {renderDocVersionInput()}
                                    </Form.Item>
                                </>
                            )}
                            <div className="expand" />
                            {!isReadOnly && (
                                <Space>
                                    <Button type="primary" icon={<DownloadOutlined />} loading={data.exporting} onClick={handleExport} disabled={!data.isEdit}>
                                        {ts("export")}
                                    </Button>
                                    <Button type="primary" icon={<FileAddOutlined />} onClick={handleInitTemplate}>
                                        {ts("hld_doc.init_template")}
                                    </Button>
                                    <Button type="primary" loading={data.saving} onClick={handleSaveTreeStructure}>
                                        {ts("save")}
                                    </Button>
                                </Space>
                            )}
                            <Button className="hld-toolbar-back" icon={<ArrowLeftOutlined />} onClick={() => navigate("/hld_docs")}>
                                {ts("back")}
                            </Button>
                        </div>
                    </Form>
                    <div className="div-v detail-content">
                        <div className="doc-section doc-section-flex">
                            {!isReadOnly && (
                                <div className="doc-section-header">
                                    <div className="doc-section-title">{ts("hld_doc.directory_structure")}</div>
                                    <div className="doc-section-buttons">
                                        <Button type="primary" onClick={handleLoadStandardNode}>
                                            {ts("hld_doc.load_standard_structure")}
                                        </Button>
                                        <Button onClick={handleSyncFromSds}>
                                            {ts("hld_doc.sync_from_sds")}
                                        </Button>
                                        <Button onClick={handleAddRootNode}>{ts("hld_doc.add_root_menu")}</Button>
                                    </div>
                                </div>
                            )}
                            <TreeStructure
                                key={`hld-tree-${params.id || "new"}-${data.treeRefreshKey || 0}`}
                                value={data.treeStructure}
                                onChange={isReadOnly ? undefined : (value) => { treeStructureRef.current = value; }}
                                onNodesSnapshot={(nodes) => { treeStructureRef.current = nodes || []; }}
                                docId={params.id ? parseInt(params.id, 10) : undefined}
                                hiddenNodeIds={hiddenNodeIds}
                                extraNavSections={coverExtraNavSections}
                                onAddRoot={isReadOnly ? undefined : handleAddRootNode}
                                onNodeDelete={isReadOnly ? undefined : handleNodeDelete}
                                readOnly={isReadOnly}
                                readOnlyChapterOffset={0}
                                readOnlyRootWrapper={false}
                                uploadDocFile={Api.add_doc_file}
                            />
                        </div>
                    </div>
                </Spin>
                <Modal
                    title={ts("hld_doc.version_change_description")}
                    open={data.showChangeDescModal}
                    onOk={handleSaveChangeDesc}
                    onCancel={handleCancelChangeDesc}
                    okText={ts("save")}
                    cancelText={ts("cancel")}
                    width={600}>
                    <div className="change-desc-modal">
                        <div className="change-desc-label">{ts("hld_doc.change_description_label")}</div>
                        <Input.TextArea
                            className="change-desc-textarea"
                            rows={6}
                            placeholder={ts("hld_doc.please_input_change_description")}
                            value={data.tempChangeDescription}
                            onChange={(e) => dispatch({ tempChangeDescription: e.target.value })}
                        />
                    </div>
                </Modal>
            </div>
        </ConfigProvider>
    );
};
