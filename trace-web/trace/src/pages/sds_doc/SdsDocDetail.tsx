import "./SdsDocDetail.less";
import { ConfigProvider, Form, Input, Button, message, Select, Modal, Space, Table, Spin } from "antd";
import { ArrowLeftOutlined, EditOutlined, DownloadOutlined, FileAddOutlined } from "@ant-design/icons";
import { useEffect, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import standardNodes from "./data/standard_nodes.json";
import * as Api from "@/api/ApiSdsDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiSrsDoc from "@/api/ApiSrsDoc";
import * as ApiSdsReqd from "@/api/ApiSdsReqd";
import * as ApiSdsTrace from "@/api/ApiSdsTrace";
import * as ApiDocFile from "@/api/ApiDocFile";
import * as ApiMember from "@/api/ApiProjectMember";
import * as ApiTimeline from "@/api/ApiProjectTimeline";
import * as ApiPersonSign from "@/api/ApiPersonSign";
import TreeStructure, { TreeNode } from "./components/TreeStructure";

const SDS_COVER_DATE_KEYWORDS = ["软件详细设计", "详细设计"];

const SDS_APPROVAL_HEADERS = [
    { code: "label1", name: "" },
    { code: "value1", name: "" },
    { code: "label2", name: "" },
    { code: "value2", name: "" },
];

const getSdsTableText = (node: TreeNode) => {
    const table = node.table;
    if (!table?.rows?.length) return "";
    const headerTxt = (table.headers || []).map((h: any) => h?.name || "").join(" ");
    const rowTxt = (table.rows || []).map((row: any) => Object.values(row || {}).join(" ")).join(" ");
    return `${headerTxt} ${rowTxt}`;
};

const isSdsCoverTableNode = (node: TreeNode) => {
    const txt = getSdsTableText(node);
    return ["编制科室", "编制部门", "文件版本", "编制人", "审核人", "批准人", "生效日期"]
        .filter((k) => txt.includes(k)).length >= 3;
};

const isSdsChangeLogTableNode = (node: TreeNode) => {
    const txt = getSdsTableText(node);
    return ["修改日期", "版本号", "修订说明", "修订人", "批准人"].filter((k) => txt.includes(k)).length >= 3;
};

const normalizeSdsApprovalRows = (node: TreeNode) => {
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

const computeSdsCoverDate = (rows: any[]): string => {
    const num = (v: any) => parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10) || 0;
    const dateKey = (r: any) => num(r.year) * 10000 + num(r.month) * 100 + (num(r.day) || 0);
    const cellVals = (r: any) => Object.values(r.cells || {});
    const match = (r: any, needReview: boolean) => {
        if ((r.row_type || "date") !== "date" || !num(r.year) || !num(r.month)) return false;
        const vals = cellVals(r);
        const hitName = vals.some((v: any) => SDS_COVER_DATE_KEYWORDS.some((k) => String(v || "").includes(k)));
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

const applySdsCoverRevisionAutofill = (nodes: TreeNode[], info: CoverRevisionAutofillInfo): { nodes: TreeNode[]; changed: boolean } => {
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
        if (nextNode.table && isSdsCoverTableNode(nextNode)) {
            const rows = normalizeSdsApprovalRows(nextNode).map((r: any) => ({ ...r }));
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
            nextNode = { ...nextNode, table: { ...nextNode.table!, headers: SDS_APPROVAL_HEADERS, rows } };
        } else if (nextNode.table && isSdsChangeLogTableNode(nextNode)) {
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

const SDS_REVIEW_ROLE_KWS: Record<string, string[]> = {
    产品经理: ["产品经理"],
    产品开发部经理: ["研发负责人", "产品开发部经理"],
    开发负责人: ["开发负责人", "TPM"],
    QA: ["QA", "质量"],
};

const isSdsSignImg = (value: any) => String(value || "").startsWith("data:image");

const applySdsReviewPersonAutofill = (
    nodes: TreeNode[],
    info: {
        coverDate: string;
        resolveName: (role: string) => string;
        resolveSign: (name: string) => string;
        approverName: string;
        approverSign: string;
    },
): { nodes: TreeNode[]; changed: boolean } => {
    let changed = false;
    const fillPerson = (row: any, nameKey: string, signKey: string, role: string) => {
        const name = info.resolveName(role);
        const sign = name ? info.resolveSign(name) : "";
        const nameVal = String(row[nameKey] || "");
        const signVal = String(row[signKey] || "");
        if (isSdsSignImg(nameVal)) {
            if (!signVal.trim()) {
                row[signKey] = nameVal;
            }
            row[nameKey] = name || "";
            changed = true;
        } else if (name && !nameVal.trim()) {
            row[nameKey] = name;
            changed = true;
        }
        if (sign && !String(row[signKey] || "").trim()) {
            row[signKey] = sign;
            changed = true;
        }
    };
    const fillTable = (table: any) => {
        if (!table?.rows?.length) return table;
        const headerTxt = (table.headers || []).map((h: any) => h?.name || "").join(" ");
        const rowTxt = (table.rows || []).map((row: any) => Object.values(row || {}).join(" ")).join(" ");
        if (!/人员角色|参评人员签字|批准人员签字/.test(`${headerTxt} ${rowTxt}`)) return table;
        const rows = (table.rows || []).map((r: any) => ({ ...r }));
        rows.forEach((row: any) => {
            const r1 = String(row.role1 || "").trim();
            if (r1.startsWith("评审时间")) {
                if (info.coverDate) {
                    const next = `评审时间：${info.coverDate}`;
                    if (r1 !== next) {
                        row.role1 = next;
                        changed = true;
                    }
                }
                return;
            }
            if (r1.startsWith("批准人员签字")) {
                const approverVal = info.approverSign || info.approverName;
                if (approverVal && !String(row.name1 || "").trim()) {
                    row.name1 = approverVal;
                    changed = true;
                }
                if (info.coverDate && !String(row.sign1 || "").trim()) {
                    row.sign1 = info.coverDate;
                    changed = true;
                }
                return;
            }
            if (!r1 || r1.startsWith("参评人员") || r1 === "人员角色" || r1.startsWith("其他")) return;
            fillPerson(row, "name1", "sign1", r1);
            const r2 = String(row.role2 || "").trim();
            if (r2 && r2 !== "人员角色") {
                fillPerson(row, "name2", "sign2", r2);
            }
        });
        return { ...table, rows };
    };
    const walk = (items: TreeNode[]): TreeNode[] => (items || []).map((node) => {
        const children = walk((node.children || []) as TreeNode[]);
        let table: any = node.table;
        if (table) {
            table = fillTable({ ...table });
            if (Array.isArray(table.extra_tables)) {
                table = {
                    ...table,
                    extra_tables: table.extra_tables.map((ex: any) => ({
                        ...ex,
                        table: ex?.table ? fillTable({ ...ex.table }) : ex?.table,
                    })),
                };
            }
        }
        return { ...node, table, children };
    });
    return { nodes: walk(nodes), changed };
};

/** 详细设计页：antd Input/TextArea 字号来自 theme token.inputFontSize（= token.fontSize），需在此统一为 13 */
const SDS_DOC_DETAIL_THEME = {
    token: {
        fontSize: 13,
        fontSizeSM: 13,
        fontSizeLG: 13,
        fontFamily: '"Times New Roman", "SimSun", "Songti SC", "STSong", serif',
    },
};

export default () => {
    const DOC_IMAGE_REF_TYPES = ["img_topo", "img_struct", "img_flow"] as const;
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
        const token = String(seed ?? Date.now());
        return `${base}${base.includes("?") ? "&" : "?"}_v=${encodeURIComponent(token)}`;
    };
    const normalizeLooseText = (value?: string) => String(value || "")
        .toLowerCase()
        .replace(/[\s\u3000\-_.:：，,。；;、()（）【】\[\]/\\]+/g, "");
    const resolveLogicImgFromTree = (item: any, treeNodes: TreeNode[]): string => {
        if (!Array.isArray(treeNodes) || treeNodes.length === 0) return "";
        const logicTxtRaw = String(item?.logic_txt || "");
        const targetFigureNo = (logicTxtRaw.match(/图\s*(\d+)/) || [])[1] || "";
        const figureCaptionNames = Array.from(logicTxtRaw.matchAll(/图\s*\d+\s*([^\n，。；;]*)/g))
            .map((m) => normalizeLooseText(String(m?.[1] || "").trim()))
            .filter(Boolean);
        const fallbackName = normalizeLooseText(item?.name || "");
        const targetNames = Array.from(new Set(
            (figureCaptionNames.length > 0 ? figureCaptionNames : [fallbackName]).filter(Boolean)
        ));
        if (targetNames.length === 0) return "";
        let bestByName: { score: number; img: string } = { score: 0, img: "" };

        const extractExactCandidates = (txt?: string): string[] => {
            const raw = String(txt || "");
            const result = [normalizeLooseText(raw)];
            const matchedList = Array.from(raw.matchAll(/图\s*\d+\s*([^\n，。；;]*)/g)).map((m) => String(m?.[1] || "").trim());
            matchedList.forEach((name) => result.push(normalizeLooseText(name)));
            return result.filter((v) => !!v);
        };
        const extractImageCaptionsFromText = (txt?: string): string[] => {
            const lines = String(txt || "").replace(/\r/g, "").split("\n").map((line) => String(line || "").trim()).filter(Boolean);
            return lines.filter((line) => /^图\s*\d+/i.test(line));
        };
        const extractFigureNo = (txt?: string): string => {
            const matched = String(txt || "").match(/图\s*(\d+)/);
            return matched?.[1] || "";
        };
        const applyExactMatch = (img: string, candidates: string[], baseScore = 100) => {
            if (!img || candidates.length === 0) return;
            if (candidates.some((name) => targetNames.includes(name))) {
                if (baseScore > bestByName.score) bestByName = { score: baseScore, img };
            }
        };

        const walk = (nodes: TreeNode[]) => {
            for (const node of nodes || []) {
                const titleTxt = String((node as any).title || "");
                const labelTxt = String((node as any).label || "");
                const bodyTxt = String((node as any).text || "");
                const img = normalizeImgUrl((node as any).img_url);
                if (img) {
                    const nodeFigureNo = extractFigureNo(`${titleTxt}\n${labelTxt}\n${bodyTxt}`);
                    if (targetFigureNo && nodeFigureNo && nodeFigureNo !== targetFigureNo) {
                        walk((node.children || []) as TreeNode[]);
                        continue;
                    }
                    const candidates = [
                        ...extractExactCandidates(titleTxt),
                        ...extractExactCandidates(labelTxt),
                        ...extractExactCandidates(bodyTxt),
                        ...extractExactCandidates(`${titleTxt}${labelTxt}`),
                    ];
                    let score = 100;
                    if (targetNames.includes(normalizeLooseText(titleTxt)) || targetNames.includes(normalizeLooseText(`${titleTxt}${labelTxt}`))) score += 30;
                    if (/逻辑|流程/.test(`${titleTxt}${labelTxt}${bodyTxt}`)) score += 10;
                    applyExactMatch(img, candidates, score);
                }
                // 导入文档常见结构：父节点正文写“图X 标题”，子节点仅存 img_url；按顺序绑定标题与子图
                const imageChildren = (node.children || []).filter((child) => !!normalizeImgUrl((child as any).img_url));
                const captions = extractImageCaptionsFromText(bodyTxt);
                imageChildren.forEach((child, idx) => {
                    const childImg = normalizeImgUrl((child as any).img_url);
                    if (!childImg) return;
                    const childTitle = String((child as any).title || "");
                    const childLabel = String((child as any).label || "");
                    const caption = captions[idx] || "";
                    const captionFigureNo = extractFigureNo(caption);
                    const childFigureNo = extractFigureNo(`${childTitle}\n${childLabel}`);
                    if (targetFigureNo) {
                        const figureNo = captionFigureNo || childFigureNo;
                        if (figureNo && figureNo !== targetFigureNo) return;
                    }
                    const candidates = [
                        ...extractExactCandidates(caption),
                        ...extractExactCandidates(childTitle),
                        ...extractExactCandidates(childLabel),
                    ];
                    applyExactMatch(childImg, candidates, 140);
                });
                walk((node.children || []) as TreeNode[]);
            }
        };

        walk(treeNodes);
        return bestByName.img;
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
                            ? (rows.filter((row: any) => String(row?.product_version || "").trim() === normalizedVersion))
                            : rows;
                        const sortedRows = [...scopedRows].sort((a: any, b: any) => {
                            const ta = new Date(a?.update_time || a?.create_time || 0).getTime();
                            const tb = new Date(b?.update_time || b?.create_time || 0).getTime();
                            if (ta !== tb) return tb - ta;
                            return Number(b?.id || 0) - Number(a?.id || 0);
                        });
                        const firstRow = sortedRows[0] || rows[0];
                        const fileUrl = withCacheBuster(firstRow?.file_url, `${firstRow?.id || ""}_${firstRow?.update_time || firstRow?.create_time || ""}`);
                        if (fileUrl) {
                            fileMaps.set(fileType, fileUrl);
                        }
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
                // 网络安全流程图严格使用详细设计树内图片，避免被图表文件管理旧记录覆盖
                const finalUrl = refType === "img_flow"
                    ? (currentUrl || mappedUrl || "")
                    : (mappedUrl || currentUrl || "");
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
    const isReadOnly = location.pathname.includes("/sds_docs/view/");
    const debug56Enabled = (() => {
        const searchParams = new URLSearchParams(location.search || "");
        const byUrl = searchParams.get("debug56") === "1";
        const byStorage = typeof window !== "undefined" && window.localStorage.getItem("sds_debug_56") === "1";
        return byUrl || byStorage;
    })();
    const [editForm] = Form.useForm();
    const treeStructureRef = useRef<TreeNode[]>([]);
    const initialEditTreeRef = useRef<TreeNode[]>([]);
    const [data, dispatch] = useData({
        loading: false,
        isEdit: false,
        products: [],
        versions: [],
        srsDocList: [], // 需求文档列表
        changeDescription: "",
        showChangeDescModal: false,
        tempChangeDescription: "",
        exporting: false,
        saving: false,
        docNId: 0, // 文档级别的 n_id
        treeStructure: [],
        // 设计列表相关（改为弹框展示）
        reqdListData: [], // 设计列表数据
        reqdListLoading: false,
        showReqdListModal: false, // 设计列表弹框
        // 需求追溯表相关（改为弹框展示）
        traceListData: [], // 需求追溯表数据
        traceListLoading: false,
        traceSyncing: false,
        traceTreeRefreshKey: 0,
        showTraceListModal: false, // 需求追溯表弹框
        docProductId: undefined as number | undefined,
        docSrsdocId: undefined as number | undefined,
        docVersion: "" as string,
        requireRebindSrs: false,
    });

    // 加载产品列表
    useEffect(() => {
        ApiProduct.list_product({ page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) {
                dispatch({ products: res.data.rows });
            }
        });
    }, []);

    const productId = Form.useWatch("product_id", editForm);
    const srsdocId = Form.useWatch("srsdoc_id", editForm);
    const docVersion = Form.useWatch("version", editForm);
    const displayProductId = (data.isEdit || isReadOnly) ? (data.docProductId ?? productId) : productId;
    const displaySrsdocId = (data.isEdit || isReadOnly) ? (data.docSrsdocId ?? srsdocId) : srsdocId;
    const displayDocVersion = (data.isEdit || isReadOnly) ? (data.docVersion ?? docVersion) : docVersion;
    const currentProduct = (data.products as any[]).find((p: any) => p.id === displayProductId);
    const productLabel = currentProduct ? `${currentProduct.name}-${currentProduct.full_version}` : "";
    const currentSrsdoc = (data.srsDocList as any[]).find((s: any) => s.id === displaySrsdocId);
    const srsdocLabel = currentSrsdoc ? (currentSrsdoc.version || currentSrsdoc.full_version || "") : "";
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
        // 截断到“下一个编号条目”：
        // 支持换行、空格，或紧跟中文标点后的“4）操作人群”这类格式。
        const nextItem = rest.match(
            /(^|[\n\s。；;，,])((?:[0-9０-９]+|[a-zA-Z])[)）.．、](?:\s*|(?=[\u4e00-\u9fff])))/m
        );
        const valueEnd = (nextItem && typeof nextItem.index === "number")
            ? (valueStart + nextItem.index + String(nextItem[1] || "").length)
            : normalized.length;
        const current = normalized.slice(valueStart, valueEnd).trim();
        if (current === scope) return raw;
        const nextText = `${normalized.slice(0, valueStart)}${scope}${normalized.slice(valueEnd)}`;
        if (nextText === normalized) return raw;
        return nextText;
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
    // 新增：自动同步「产品名称 / 产品型号」单行字段（适用范围沿用上方 applyProductScopeToTree，不改动）
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
        const nextText = `${normalized.slice(0, valueStart)}${value}${normalized.slice(valueEnd)}`;
        return nextText === normalized ? raw : nextText;
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
    // 新增：全文产品名称同步（程序推断旧名 + 负向先行防重复，幂等、不写库；推断不出旧名则不动）
    const collectTreeText = (nodes: TreeNode[]): string => {
        const chunks: string[] = [];
        const walk = (items: TreeNode[]) => (items || []).forEach((n) => {
            chunks.push(String((n as any).text || ""));
            walk((n.children || []) as TreeNode[]);
        });
        walk(nodes || []);
        return chunks.join("\n");
    };
    const inferPreviousProductName = (nodes: TreeNode[], currentName: string): string => {
        const allText = collectTreeText(nodes);
        const candidates = Array.from(new Set([
            currentName.replace(/[0-9０-９]+$/, ""),
            currentName.replace(/[A-Za-z0-9０-９._\-（）()]+$/, ""),
        ].map((s) => s.trim()).filter((s) => s && s !== currentName && s.length >= 4 && currentName.startsWith(s))));
        return candidates.find((c) => allText.includes(c)) || "";
    };
    const applyProductNameAcrossTree = (nodes: TreeNode[], product?: any): { nodes: TreeNode[]; changed: boolean } => {
        if (!Array.isArray(nodes) || !product) return { nodes, changed: false };
        const currentName = String(product.name ?? "").trim();
        if (!currentName) return { nodes, changed: false };
        const previousName = inferPreviousProductName(nodes, currentName);
        if (!previousName || previousName === currentName || !currentName.startsWith(previousName)) {
            return { nodes, changed: false };
        }
        const suffix = currentName.slice(previousName.length);
        if (!suffix) return { nodes, changed: false };
        const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`${escapeReg(previousName)}(?!${escapeReg(suffix)})`, "g");
        let changed = false;
        const walk = (items: TreeNode[]): TreeNode[] => (items || []).map((node) => {
            const children = walk((node.children || []) as TreeNode[]);
            const nextNode = { ...node, children };
            const text = String(nextNode.text || "");
            if (text) {
                const replaced = text.replace(pattern, currentName);
                if (replaced !== text) { nextNode.text = replaced; changed = true; }
            }
            return nextNode;
        });
        return { nodes: walk(nodes), changed };
    };
    useEffect(() => {
        const scopeResult = applyProductScopeToTree(data.treeStructure as TreeNode[], currentProduct);
        const basicResult = applyProductBasicInfoToTree(scopeResult.nodes as TreeNode[], currentProduct);
        const nameResult = applyProductNameAcrossTree(basicResult.nodes as TreeNode[], currentProduct);
        if (scopeResult.changed || basicResult.changed || nameResult.changed) {
            treeStructureRef.current = nameResult.nodes;
            dispatch({ treeStructure: nameResult.nodes });
        }
    }, [displayProductId, currentProduct?.scope, currentProduct?.name, currentProduct?.type_code, data.treeStructure]);
    const extractSdsCodeToken = (txt?: string): string => {
        const raw = String(txt || "");
        const matched = raw.match(/SDS\s*-\s*[A-Za-z0-9._-]+(?:\s*[-_]\s*[A-Za-z0-9._-]+)*/i);
        if (!matched) return "";
        return String(matched[0] || "").replace(/\s+/g, "").toUpperCase();
    };
    const extractSdsCodeFromText = (txt?: string): { code: string; nextText: string } => {
        const raw = String(txt || "");
        const lines = raw.replace(/\r/g, "").split("\n");
        if (lines.length === 0) return { code: "", nextText: raw };
        let hitIndex = -1;
        let consumedCount = 1;
        let extractedCode = "";
        for (let i = 0; i < lines.length; i++) {
            const line = String(lines[i] || "").trim();
            const matched = line.match(/设计编号\s*[：:]\s*(.*)$/);
            if (!matched) continue;
            hitIndex = i;
            let codePart = String(matched[1] || "").trim();
            extractedCode = extractSdsCodeToken(codePart);
            if (!extractedCode && i + 1 < lines.length) {
                const nextLine = String(lines[i + 1] || "").trim();
                if (nextLine) {
                    codePart = `${codePart}\n${nextLine}`;
                    consumedCount = 2;
                }
            }
            if (!extractedCode) {
                extractedCode = extractSdsCodeToken(codePart);
            }
            break;
        }
        if (hitIndex < 0 || !extractedCode) return { code: "", nextText: raw };
        const remained = lines.filter((_line, idx) => idx < hitIndex || idx >= (hitIndex + consumedCount));
        const nextText = remained.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
        return { code: extractedCode, nextText };
    };
    const stripRedundantSdsCodeFromText = (text?: string, sdsCode?: string): string => {
        const raw = String(text || "");
        const code = String(sdsCode || "").replace(/\s+/g, "").toUpperCase();
        if (!raw) return raw;
        let next = extractSdsCodeFromText(raw).nextText;
        if (!code) return next;
        const lines = next.replace(/\r/g, "").split("\n");
        const filtered = lines.filter((line) => {
            const trimmed = String(line || "").trim();
            if (!trimmed) return true;
            const compact = trimmed.replace(/\s+/g, "").toUpperCase();
            if (compact === code) return false;
            const designMatch = trimmed.match(/^设计编号\s*[：:]\s*(.*)$/);
            if (designMatch) {
                const designCode = String(extractSdsCodeToken(designMatch[1]) || designMatch[1] || "")
                    .replace(/\s+/g, "")
                    .toUpperCase();
                if (designCode === code) return false;
            }
            return true;
        });
        return filtered.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
    };
    // 将后端数据转换为前端格式
    const parseTreeNode = (node: any): TreeNode => {
        const fallbackFromText = extractSdsCodeFromText(node.text);
        const hasExplicitSdsCodeField = node.sds_code !== undefined;
        const explicitSdsCode = String(node.sds_code ?? "").trim();
        const resolvedSdsCode = explicitSdsCode || fallbackFromText.code || "";
        const shouldStripCodeLineFromText = !!resolvedSdsCode;
        const hasValidHeaders = !!(
            node.table &&
            node.table.headers !== null &&
            Array.isArray(node.table.headers) &&
            node.table.headers.length > 0
        );
        const hasRowOrCellContent = !!(
            node.table &&
            (
                (node.table.rows !== null && Array.isArray(node.table.rows) && node.table.rows.length > 0) ||
                (Array.isArray(node.table.cells) && node.table.cells.length > 1) ||
                (
                    Array.isArray(node.table.extra_tables) &&
                    node.table.extra_tables.some((extra: any) => {
                        const extraTable = extra?.table;
                        return !!(
                            extraTable &&
                            Array.isArray(extraTable.headers) &&
                            extraTable.headers.length > 0 &&
                            (
                                (Array.isArray(extraTable.rows) && extraTable.rows.length > 0) ||
                                (Array.isArray(extraTable.cells) && extraTable.cells.length > 1)
                            )
                        );
                    })
                )
            )
        );
        return {
            id: node.n_id || node.id || 0, // 使用后端的n_id作为前端的id
            doc_id: node.doc_id || 0,
            n_id: node.n_id || 0,
            p_id: node.p_id || 0,
            title: node.title || "",
            ...(node.label !== undefined && { label: node.label ?? "" }),
            // 兼容历史数据：未返回 sds_code 时，从正文“设计编号：xxx”兜底提取
            ...((hasExplicitSdsCodeField || !!fallbackFromText.code) && { sds_code: resolvedSdsCode }),
            ...(node.ref_type !== undefined && { ref_type: node.ref_type }),
            img_url: node.img_url || "",
            text: shouldStripCodeLineFromText
                ? stripRedundantSdsCodeFromText(
                    explicitSdsCode ? (node.text || "") : fallbackFromText.nextText,
                    resolvedSdsCode
                )
                : (node.text || ""),
            // 处理 table：有表头且存在行或单元格结构时保留（避免 rows 为空时误丢合并单元格表格）
            table: (hasValidHeaders && hasRowOrCellContent) ? node.table : {},
            children: (node.children || []).map((child: any) => parseTreeNode(child))
        };
    };

    const normalizePlain = (value?: string) => String(value || "").replace(/\s+/g, "").toLowerCase();
    const stripTitlePrefixMarks = (value?: string) => String(value || "").replace(/^[\s\u3000•·▪■◆●○□◇\-–—]+/, "").trim();
    const IMPORTED_PLACEHOLDER_RE = /^导入(表格|图片)\d*$/;
    const CHAPTER_PREFIX_RE = /^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/;
    const HEADING_NUM_RE = CHAPTER_PREFIX_RE;
    const TABLE_CAPTION_RE = /^\s*(?:表|table)\s*\d+(?:[.\-_]\d+)*\s*[:：、.．-]?\s*.*$/i;
    const JSON_KV_LINE_RE = /^\s*['"]\s*[^'"]+\s*['"]\s*:\s*.+$/;
    const hasChapterTitle = (title?: string) => /^\d+(?:\.\d+)+(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))\S+|^\d{1,2}(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))\S+/.test(stripTitlePrefixMarks(title));
    const hasRenderableTable = (table: any): boolean => {
        if (!table || !Array.isArray(table.headers) || table.headers.length === 0) return false;
        const hasRows = Array.isArray(table.rows) && table.rows.length > 0;
        const hasCells = Array.isArray(table.cells) && table.cells.length > 1;
        const hasExtraTables = Array.isArray(table.extra_tables) && table.extra_tables.some((extra: any) => {
            const extraTable = extra?.table;
            if (!extraTable || !Array.isArray(extraTable.headers) || extraTable.headers.length === 0) return false;
            const extraRows = Array.isArray(extraTable.rows) && extraTable.rows.length > 0;
            const extraCells = Array.isArray(extraTable.cells) && extraTable.cells.length > 1;
            return extraRows || extraCells;
        });
        return hasRows || hasCells || hasExtraTables;
    };
    const hasTableInSubtree = (node: TreeNode): boolean => {
        if (hasRenderableTable(node.table)) return true;
        return (node.children || []).some((child) => hasTableInSubtree(child));
    };
    const isPureTableSubtree = (node: TreeNode): boolean => {
        const children = node.children || [];
        const ownText = String(node.text || "").trim();
        if (hasRenderableTable(node.table)) {
            // 表格节点允许带简短标题/说明，但不应该再挂复杂正文段落
            return ownText.length === 0 || ownText.length <= 120;
        }
        if (children.length === 0) return false;
        if (ownText) return false;
        return children.every((child) => isPureTableSubtree(child));
    };
    const isLikelyRealSectionNode = (node: TreeNode): boolean => {
        const title = stripTitlePrefixMarks(node.title);
        if (!title) return false;
        if (hasChapterTitle(title)) return true;
        // 系统生成占位标题不当作真实章节
        if (/^导入(正文|表格\d+|图片\d+)$/i.test(title)) return false;
        // 表题/图题不当作章节
        if (/^(表|table|图|figure)\s*\d+/i.test(title)) return false;
        if (/[：:]/.test(title)) return false;
        // 有子节点且自身不是表格，视为可能章节（如“接口”）
        return !hasRenderableTable(node.table) && (node.children || []).length > 0;
    };
    const isDataStructureChapter = (node: TreeNode) => {
        const rawTitle = String(node.title || "").trim();
        const titleTxt = normalizePlain(rawTitle);
        const bodyTxt = normalizePlain(node.text);
        const merged = `${titleTxt} ${bodyTxt}`;
        // 兼容 5.6 / 6.6 / 7.6 ... 等任意“章节号 + 数据结构”场景，避免写死 5.6 导致规则失效
        const hasChapterPrefix = /^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/.test(rawTitle);
        return hasChapterPrefix && merged.includes("数据结构");
    };
    const isLikelyFalseSingleDigitHeading = (title?: string): boolean => {
        const txt = stripTitlePrefixMarks(title);
        const matched = txt.match(/^(\d+)\s+(.+)$/);
        if (!matched) return false;
        const major = matched[1] || "";
        const tail = (matched[2] || "").trim();
        if (major.length !== 1 || !tail) return false;
        if (tail.length > 24) return true;
        return /[，,。；;：:！？!?“”"'‘’]/.test(tail);
    };
    const normalizeFalseSingleDigitHeadings = (nodes: TreeNode[]): TreeNode[] => {
        if (!Array.isArray(nodes) || nodes.length === 0) return nodes;
        const out: TreeNode[] = [];
        for (const raw of nodes) {
            const normalizedChildren = normalizeFalseSingleDigitHeadings(raw.children || []);
            const node: TreeNode = { ...raw, children: normalizedChildren };
            if (isLikelyFalseSingleDigitHeading(node.title) && out.length > 0) {
                const prev = out[out.length - 1];
                const matched = stripTitlePrefixMarks(node.title).match(/^\d+\s+(.+)$/);
                const pseudoTitleLine = (matched?.[1] || "").trim();
                const extraTextParts = [
                    pseudoTitleLine,
                    String(node.text || "").trim(),
                ].filter((item) => !!item);
                const mergedText = [
                    String(prev.text || "").trim(),
                    ...extraTextParts,
                ].filter((item) => !!item).join("\n");
                out[out.length - 1] = {
                    ...prev,
                    text: mergedText,
                    children: [...(prev.children || []), ...(node.children || [])],
                };
                continue;
            }
            out.push(node);
        }
        return out;
    };
    const parseHeadingNumber = (title?: string): string | undefined => {
        const matched = String(title || "").trim().match(HEADING_NUM_RE);
        return matched?.[1];
    };
    const normalizeEditRootChapterNumbers = (roots: TreeNode[]): TreeNode[] => {
        if (isReadOnly || !Array.isArray(roots) || roots.length === 0) return roots;
        const normalizeBusinessTitle = (title?: string) =>
            String(title || "")
                .trim()
                .replace(/^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
                .replace(/\s+/g, "");
        const isFrontMatterTitle = (title?: string) =>
            /^(目录|需求规格说明|文件修订记录|软件详细设计说明书|软件详细设计|评审记录|附件一评审结论)$/.test(normalizeBusinessTitle(title));
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
            const nextNo = parts.map((part) => String(part)).join(".");
            return raw.replace(matched[1], nextNo);
        };
        const walk = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => ({
            ...node,
            title: isFrontMatterTitle(node.title) ? node.title : shiftTitle(node.title),
            children: walk(node.children || []),
        }));
        return walk(roots);
    };
    const stripHeadingPrefix = (value?: string): string => {
        return String(value || "")
            .trim()
            .replace(/^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z"']))/, "")
            .trim();
    };
    const isJsonLikeBodyLine = (value?: string): boolean => {
        const txt = String(value || "").trim();
        if (!txt) return false;
        if (JSON_KV_LINE_RE.test(txt)) return true;
        const noChapter = stripHeadingPrefix(txt);
        return !!noChapter && JSON_KV_LINE_RE.test(noChapter);
    };
    const insertJsonLineBeforeFirstJsonKv = (parentText: string, jsonLine: string): string => {
        const normalizedLine = String(jsonLine || "").trim();
        if (!normalizedLine) return String(parentText || "").trim();
        const lines = String(parentText || "")
            .replace(/\r/g, "")
            .split("\n");
        const targetIdx = lines.findIndex((line) => isJsonLikeBodyLine(line));
        if (targetIdx >= 0) {
            const nextLines = [...lines];
            nextLines.splice(targetIdx, 0, normalizedLine);
            return nextLines.map((line) => String(line || "").trim()).filter(Boolean).join("\n");
        }
        // 若尚未出现键值行，则尽量放在第一个 "{" 之后
        const braceIdx = lines.findIndex((line) => String(line || "").trim() === "{");
        if (braceIdx >= 0) {
            const nextLines = [...lines];
            nextLines.splice(braceIdx + 1, 0, normalizedLine);
            return nextLines.map((line) => String(line || "").trim()).filter(Boolean).join("\n");
        }
        return [...lines, normalizedLine].map((line) => String(line || "").trim()).filter(Boolean).join("\n");
    };
    const isPlaceholderTitle = (title?: string): boolean => IMPORTED_PLACEHOLDER_RE.test(String(title || "").trim());
    const stripHeadingEmphasis = (value?: string): string => {
        return String(value || "")
            .trim()
            .replace(/^(\*\*|__)\s*/, "")
            .replace(/\s*(\*\*|__)$/, "")
            .replace(/^<\s*(strong|b)\b[^>]*>/i, "")
            .replace(/<\/\s*(strong|b)\s*>$/i, "")
            .trim();
    };
    const isLikelyBoldStyledHeading = (value?: string): boolean => {
        const txt = String(value || "").trim();
        if (!txt) return false;
        if (/^(\*\*|__).+(\*\*|__)$/.test(txt)) return true;
        if (/^<\s*(strong|b)\b[^>]*>.+<\/\s*(strong|b)\s*>$/i.test(txt)) return true;
        // 导入文本里常见「短标题 + 冒号」样式；仅作为补号兜底，不影响查看页渲染
        if (/^[^，,。；;！？!?]{1,40}[:：]$/.test(txt)) return true;
        return false;
    };
    const isNumberableNode = (node: TreeNode): boolean => {
        const title = String(node.title || "").trim();
        if (!title) return false;
        if (IMPORTED_PLACEHOLDER_RE.test(title)) return false;
        if (isJsonLikeBodyLine(title)) return false;
        const pureTitleRaw = stripHeadingEmphasis(title
            .replace(/^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
        );
        const pureTitle = pureTitleRaw.replace(/\s+/g, "");
        const pureTitleWithoutTrailingColon = pureTitle.replace(/[:：]+$/, "");
        if (/^(目录|需求规格说明|文件修订记录|软件详细设计说明书|软件详细设计|评审记录|附件一评审结论)$/.test(pureTitle)) return false;
        // 句子型文本（含逗号/句号/分号/冒号等）不是章节，不自动补编号（避免出现“7.1 ...”误识别）
        if (/[，,。；;！？!?]/.test(pureTitle)) return false;
        const hasInnerColon = /[:：]/.test(pureTitleWithoutTrailingColon);
        if (hasInnerColon) return false;
        if (/[:：]$/.test(pureTitle) && !isLikelyBoldStyledHeading(stripHeadingEmphasis(title))) return false;
        // 过长标题更像正文段落，不自动编号
        if (pureTitleWithoutTrailingColon.length > 24) return false;
        return true;
    };
    const normalizeJsonLikeHeadings = (nodes: TreeNode[], parent?: TreeNode): TreeNode[] => {
        if (!Array.isArray(nodes) || nodes.length === 0) return nodes;
        const out: TreeNode[] = [];
        for (const raw of nodes) {
            const normalizedChildren = normalizeJsonLikeHeadings(raw.children || [], raw);
            const node: TreeNode = { ...raw, children: normalizedChildren };
            const title = String(node.title || "").trim();
            if (isJsonLikeBodyLine(title) && out.length > 0) {
                const prev = out[out.length - 1];
                const normalizedJsonLine = stripHeadingPrefix(title) || title;
                let mergedText = insertJsonLineBeforeFirstJsonKv(String(prev.text || ""), normalizedJsonLine);
                const nodeText = String(node.text || "").trim();
                if (nodeText) {
                    mergedText = [mergedText, nodeText].filter(Boolean).join("\n");
                }
                const mergedPrev: TreeNode = {
                    ...prev,
                    text: mergedText,
                    children: [...(prev.children || []), ...(node.children || [])],
                };
                const hasOwnPayload = !!(
                    hasRenderableTable(node.table)
                    || !!String(node.img_url || "").trim()
                );
                if (hasOwnPayload) {
                    mergedPrev.children = [
                        ...(mergedPrev.children || []),
                        {
                            ...node,
                            title: "",
                            label: isJsonLikeBodyLine(node.label) ? "" : node.label,
                            text: "",
                            children: node.children || [],
                        },
                    ];
                }
                out[out.length - 1] = mergedPrev;
                continue;
            }
            if (isJsonLikeBodyLine(title) && parent) {
                const normalizedJsonLine = stripHeadingPrefix(title) || title;
                let mergedParentText = insertJsonLineBeforeFirstJsonKv(String(parent.text || ""), normalizedJsonLine);
                const nodeText = String(node.text || "").trim();
                if (nodeText) {
                    mergedParentText = [mergedParentText, nodeText].filter(Boolean).join("\n");
                }
                parent.text = mergedParentText;
                const hasOwnPayload = !!(
                    hasRenderableTable(node.table)
                    || !!String(node.img_url || "").trim()
                    || (node.children || []).length > 0
                );
                if (hasOwnPayload) {
                    out.push({
                        ...node,
                        title: "",
                        label: isJsonLikeBodyLine(node.label) ? "" : node.label,
                        text: "",
                        children: node.children || [],
                    });
                }
                continue;
            }
            out.push(node);
        }
        return out;
    };
    const isBodyLikeHeadingLine = (value?: string): boolean => {
        const txt = stripTitlePrefixMarks(value);
        if (!txt) return false;
        // 带明确章节号前缀（如 5.6.1 / 7.2.3）的标题按 Word 原样保留为章节，
        // 不因末尾冒号等标点被误降级为正文。
        if (HEADING_NUM_RE.test(txt)) return false;
        const bodyPart = txt
            .replace(/^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z"']))/, "")
            .trim();
        const probe = bodyPart || txt;
        // 数据结构章节下常见二级标题（如“Postgresql库1数据库:”“库2数据库:”）需要保留为节点
        if (/数据库\s*[:：]?$/.test(probe) && probe.length <= 40) return false;
        if (isJsonLikeBodyLine(probe) || isJsonLikeBodyLine(txt)) return true;
        // 即使带章节号前缀，只要是句子型长文本（含标点）也视为正文，不当作章节
        if (/[，,。；;：:！？!?]/.test(probe)) return true;
        return probe.length > 24;
    };
    const normalizeBodyLikeHeadingNodes = (nodes: TreeNode[], parent?: TreeNode): TreeNode[] => {
        if (!Array.isArray(nodes) || nodes.length === 0) return nodes;
        const out: TreeNode[] = [];
        for (const raw of nodes) {
            const normalizedChildren = normalizeBodyLikeHeadingNodes(raw.children || [], raw);
            const node: TreeNode = { ...raw, children: normalizedChildren };
            const title = String(node.title || "").trim();
            const shouldDemote = !!(
                title
                && isBodyLikeHeadingLine(title)
                && !isPlaceholderTitle(title)
                && !isJsonLikeBodyLine(title)
            );
            if (!shouldDemote) {
                out.push(node);
                continue;
            }
            const normalizedLine = stripHeadingPrefix(title) || title;
            const hasOwnPayload = !!(
                hasRenderableTable(node.table)
                || !!String(node.img_url || "").trim()
                || !!String(node.text || "").trim()
                || (node.children || []).length > 0
            );
            if (out.length > 0) {
                const prev = out[out.length - 1];
                const mergedPrevText = [String(prev.text || "").trim(), normalizedLine].filter(Boolean).join("\n");
                const nextPrev: TreeNode = { ...prev, text: mergedPrevText };
                if (hasOwnPayload) {
                    nextPrev.children = [
                        ...(nextPrev.children || []),
                        {
                            ...node,
                            title: "",
                            label: "",
                            text: String(node.text || "").trim(),
                            children: node.children || [],
                        },
                    ];
                }
                out[out.length - 1] = nextPrev;
                continue;
            }
            if (parent) {
                parent.text = [String(parent.text || "").trim(), normalizedLine].filter(Boolean).join("\n");
                if (hasOwnPayload) {
                    out.push({
                        ...node,
                        title: "",
                        label: "",
                        text: String(node.text || "").trim(),
                        children: node.children || [],
                    });
                }
                continue;
            }
            out.push(node);
        }
        return out;
    };
    const decorateImportedWordTree = (roots: TreeNode[]): TreeNode[] => {
        const counters = [0, 0, 0, 0, 0];
        const normalizeBusinessTitle = (title?: string) =>
            String(title || "")
                .trim()
                .replace(/^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
                .replace(/\s+/g, "");
        const isFrontMatterTitle = (title?: string) => {
            const t = normalizeBusinessTitle(title);
            return /^(目录|需求规格说明|文件修订记录|软件详细设计说明书|软件详细设计|评审记录|附件一评审结论)$/.test(t);
        };
        const rootExistingNumbers = (roots || [])
            .filter((node) => isNumberableNode(node) && !isFrontMatterTitle(node.title))
            .map((node) => parseHeadingNumber(node.title))
            .filter((n): n is string => !!n);
        const firstRootMajor = rootExistingNumbers
            .map((num) => Number(String(num).split(".")[0]))
            .find((n) => Number.isFinite(n) && n > 0);
        // 仅编辑页做“首章归一到1”，查看页保持原文编号
        const rootMajorOffset = !isReadOnly && firstRootMajor && firstRootMajor > 1
            ? (firstRootMajor - 1)
            : 0;
        const normalizeExistingNumber = (number: string): string => {
            if (!rootMajorOffset) return number;
            const parts = String(number || "").split(".").map((p) => Number(p));
            if (!parts.length || !Number.isFinite(parts[0])) return number;
            const shiftedMajor = parts[0] - rootMajorOffset;
            if (shiftedMajor <= 0) return number;
            parts[0] = shiftedMajor;
            return parts.map((n) => String(n)).join(".");
        };
        const syncByNumber = (number: string) => {
            const parts = number.split(".").map((p) => Number(p)).filter((n) => Number.isFinite(n) && n > 0);
            if (!parts.length) return;
            const depth = Math.min(parts.length, 5);
            for (let i = 0; i < depth; i++) counters[i] = parts[i];
            for (let i = depth; i < 5; i++) counters[i] = 0;
        };
        const nextNumber = (depth: number): string => {
            const d = Math.max(1, Math.min(depth, 5));
            for (let i = 0; i < d - 1; i++) {
                if (counters[i] <= 0) counters[i] = 1;
            }
            counters[d - 1] = counters[d - 1] > 0 ? counters[d - 1] + 1 : 1;
            for (let i = d; i < 5; i++) counters[i] = 0;
            return counters.slice(0, d).join(".");
        };
        const walk = (nodes: TreeNode[], depth: number): TreeNode[] => {
            return (nodes || []).map((raw) => {
                const node: TreeNode = { ...raw, children: [] };
                const existing = parseHeadingNumber(node.title);
                if (existing) {
                    const normalizedExisting = normalizeExistingNumber(existing);
                    syncByNumber(normalizedExisting);
                    if (normalizedExisting !== existing) {
                        node.title = String(node.title || "").replace(existing, normalizedExisting);
                    }
                } else if (isNumberableNode(node)) {
                    const generated = nextNumber(depth);
                    node.title = `${generated} ${String(node.title || "").trim()}`.trim();
                }
                const children = walk(raw.children || [], depth + 1);
                const tableChildren = children.filter((child) => hasRenderableTable(child.table));
                if (tableChildren.length > 0) {
                    const lines = String(node.text || "").split(/\r?\n/);
                    const captionIdx = lines
                        .map((line, idx) => ({ line: String(line || "").trim(), idx }))
                        .filter((item) => !!item.line && TABLE_CAPTION_RE.test(item.line))
                        .map((item) => item.idx);
                    if (captionIdx.length > 0) {
                        let cursor = 0;
                        const used = new Set<number>();
                        node.children = children.map((child) => {
                            if (!hasRenderableTable(child.table) || cursor >= captionIdx.length) return child;
                            const idx = captionIdx[cursor++];
                            const caption = String(lines[idx] || "").trim();
                            if (!caption) return child;
                            const childTitle = String(child.title || "").trim();
                            const childText = String(child.text || "").trim();
                            const canWriteToTitle = !childTitle || isPlaceholderTitle(childTitle);
                            const canWriteToText = !childText;
                            if (!canWriteToTitle && !canWriteToText) return child;
                            used.add(idx);
                            if (canWriteToTitle) {
                                return { ...child, title: caption };
                            }
                            return { ...child, text: caption };
                        });
                        if (used.size > 0) {
                            node.text = lines
                                .filter((_line, idx) => !used.has(idx))
                                .map((line) => String(line || "").trim())
                                .filter(Boolean)
                                .join("\n");
                        }
                    } else {
                        node.children = children;
                    }
                } else {
                    node.children = children;
                }
                return node;
            });
        };
        return walk(roots || [], 1);
    };
    const relocateDataStructureTables = (roots: TreeNode[]): TreeNode[] => {
        if (!Array.isArray(roots) || roots.length === 0) return roots;
        const targetRootIndex = roots.findIndex((node) => isDataStructureChapter(node));
        if (targetRootIndex < 0) return roots;
        const dataNode = roots[targetRootIndex];
        const trailingNodes: TreeNode[] = [];
        let scanIndex = targetRootIndex + 1;
        while (scanIndex < roots.length) {
            const candidate = roots[scanIndex];
            const candidateTitle = String(candidate?.title || "").trim();
            if (hasChapterTitle(candidateTitle)) {
                break;
            }
            if (isLikelyRealSectionNode(candidate)) {
                break;
            }
            // 只并入“纯表格子树”，遇到非表内容立即停止，避免把 5.7 等后续章节吞并进 5.6
            if (isPureTableSubtree(candidate)) {
                trailingNodes.push(candidate);
                scanIndex += 1;
                continue;
            }
            break;
        }
        if (trailingNodes.length > 0) {
            roots.splice(targetRootIndex + 1, trailingNodes.length);
        }

        const allCandidates = [...(dataNode.children || []), ...trailingNodes];
        // 5.6 数据结构需保持原始 Word 层级（如 5.6.1 库1 / 5.6.2 库2 各自挂对应表），不做扁平化
        const keepHierarchy = (node: TreeNode): TreeNode => ({
            ...node,
            children: (node.children || []).map((child) => keepHierarchy(child)),
        });
        dataNode.children = allCandidates.map((node) => keepHierarchy(node));
        // 兜底：后端已拆出“库X数据库:”子标题但未带章节号时，补成 5.6.1 / 5.6.2 ...
        // 仅作用于“数据结构”章节下数据库标题，避免影响其它章节。
        const baseChapterMatch = String(dataNode.title || "").trim().match(HEADING_NUM_RE);
        const baseChapterNo = baseChapterMatch?.[1] || "";
        if (baseChapterNo) {
            let dbHeadingIdx = 0;
            const ensureDbHeadingNo = (nodes: TreeNode[]): TreeNode[] => {
                return (nodes || []).map((raw) => {
                    const node: TreeNode = { ...raw, children: ensureDbHeadingNo(raw.children || []) };
                    const rawTitle = String(node.title || "").trim();
                    if (!rawTitle) return node;
                    const hasNo = !!rawTitle.match(HEADING_NUM_RE);
                    const plain = rawTitle.replace(/^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "").trim();
                    const isDbHeading = /数据库\s*[:：]?$/.test(plain) && plain.length <= 80;
                    if (isDbHeading && !hasNo) {
                        dbHeadingIdx += 1;
                        node.title = `${baseChapterNo}.${dbHeadingIdx} ${plain}`.trim();
                    }
                    return node;
                });
            };
            dataNode.children = ensureDbHeadingNo(dataNode.children || []);
        }

        // 数据结构章节：将正文中的“库X数据库:”短标题提升为真实子标题节点（三级），并绑定到后续表格节点
        const dataTextRaw = String(dataNode.text || "").replace(/\r/g, "\n");
        const dbHeadingFromLine = dataTextRaw
            .split("\n")
            .map((line) => String(line || "").trim())
            .filter((line) => /数据库\s*[:：]?$/.test(line) && line.length <= 60);
        // 兼容“库标题在同一段中而非独占一行”的导入场景（例如：...存储。Postgresql库1数据库：库2数据库：）
        const dbHeadingFromInline = Array.from(
            dataTextRaw.matchAll(/((?:[A-Za-z]+\s*)?库[0-9一二三四五六七八九十]+数据库\s*[:：])/gi)
        )
            .map((m) => String(m?.[1] || "").trim())
            .filter(Boolean);
        const dbHeadingLines = Array.from(new Set([...dbHeadingFromLine, ...dbHeadingFromInline]));
        if (dbHeadingLines.length > 0 && Array.isArray(dataNode.children) && dataNode.children.length > 0) {
            const chapterMatch = String(dataNode.title || "").trim().match(HEADING_NUM_RE);
            const baseChapter = chapterMatch?.[1] || "";
            const children = [...dataNode.children];
            const hasExistingDbHeadingNode = children.some((child) => {
                const titleTxt = String(child.title || "").trim();
                return /数据库\s*[:：]?$/.test(titleTxt) && hasTableInSubtree(child);
            });
            const carrierIndexes = children
                .map((child, idx) => ({ child, idx }))
                .filter(({ child }) => hasTableInSubtree(child))
                .map((item) => item.idx);

            const useCount = !hasExistingDbHeadingNode ? Math.min(dbHeadingLines.length, carrierIndexes.length) : 0;
            if (useCount > 0) {
                const nextChildren: TreeNode[] = [];
                let cursor = 0;
                for (let i = 0; i < useCount; i++) {
                    const start = carrierIndexes[i];
                    const end = i + 1 < useCount ? carrierIndexes[i + 1] : children.length;
                    if (start > cursor) {
                        nextChildren.push(...children.slice(cursor, start));
                    }
                    const groupChildren = children.slice(start, end);
                    const headingText = String(dbHeadingLines[i] || "")
                        .replace(/^[\s\u3000•·▪■◆●○□◇\-–—]+/, "")
                        .trim();
                    const numberedHeading = HEADING_NUM_RE.test(headingText)
                        ? headingText
                        : `${baseChapter ? `${baseChapter}.${i + 1}` : `${i + 1}`}. ${headingText}`;
                    const syntheticId = Number(`${Date.now()}${i + 1}`);
                    nextChildren.push({
                        id: syntheticId,
                        doc_id: dataNode.doc_id || 0,
                        n_id: 0,
                        p_id: dataNode.n_id || 0,
                        title: numberedHeading,
                        label: "",
                        img_url: "",
                        text: "",
                        table: {},
                        children: groupChildren,
                    });
                    cursor = end;
                }
                if (cursor < children.length) {
                    nextChildren.push(...children.slice(cursor));
                }
                dataNode.children = nextChildren;
            }

            if (useCount > 0) {
                const usedLines = dbHeadingLines.slice(0, useCount);
                const escapeRegExp = (value: string) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                let nextText = String(dataNode.text || "");
                usedLines.forEach((line) => {
                    if (!line) return;
                    const reg = new RegExp(escapeRegExp(line), "g");
                    nextText = nextText.replace(reg, "");
                });
                dataNode.text = nextText
                    .replace(/\r/g, "")
                    .split("\n")
                    .map((line) => String(line || "").trim())
                    .filter(Boolean)
                    .join("\n");
            }
            // 二次兜底：若数据库子标题已成为子节点，确保父节点正文中不再重复显示这些标题文本
            const dbHeadingTitles = (dataNode.children || [])
                .map((child) => String(child.title || "").trim())
                .map((title) => title.replace(/^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "").trim())
                .filter((title) => /数据库\s*[:：]?$/.test(title));
            if (dbHeadingTitles.length > 0) {
                const escapeRegExp = (value: string) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                let nextText = String(dataNode.text || "");
                dbHeadingTitles.forEach((title) => {
                    const reg = new RegExp(escapeRegExp(title), "g");
                    nextText = nextText.replace(reg, "");
                });
                dataNode.text = nextText
                    .replace(/\r/g, "")
                    .split("\n")
                    .map((line) => String(line || "").trim())
                    .filter(Boolean)
                    .join("\n");
            }
        }
        if (debug56Enabled) {
            const levelRows: Array<{ level: number; title: string; hasTable: boolean; childCount: number }> = [];
            const walk = (nodes: TreeNode[], level: number) => {
                (nodes || []).forEach((node) => {
                    levelRows.push({
                        level,
                        title: String(node.title || node.label || "(空标题)"),
                        hasTable: hasRenderableTable(node.table),
                        childCount: (node.children || []).length,
                    });
                    if (node.children?.length) walk(node.children, level + 1);
                });
            };
            walk(dataNode.children || [], 1);
            const tableCount = levelRows.filter((item) => item.hasTable).length;
            // 通过 `?debug56=1` 或 localStorage.sds_debug_56=1 打开
            console.groupCollapsed(`[SDS 5.6调试] doc=${params.id || "-"} children=${(dataNode.children || []).length} tables=${tableCount}`);
            console.table(levelRows);
            console.groupEnd();
        }
        return roots;
    };
    const relocateReviewTablesToStandalonePage = (roots: TreeNode[]): TreeNode[] => {
        if (!Array.isArray(roots) || roots.length === 0) return roots;
        const isReviewTable = (table: any): boolean => {
            if (!hasRenderableTable(table)) return false;
            const headerText = String((table.headers || []).map((h: any) => String(h?.name || "").trim()).join("|"));
            if (!headerText) return false;
            return /(评审|审查|结论|法规标准引用)/.test(headerText);
        };
        const isNodeMeaningfulWithoutTable = (node: TreeNode): boolean => {
            const hasText = !!String(node.text || "").trim();
            const hasLabel = !!String(node.label || "").trim();
            const hasImage = !!String(node.img_url || "").trim();
            const hasChildren = Array.isArray(node.children) && node.children.length > 0;
            const title = String(node.title || "").trim();
            const hasChapterLikeTitle = /^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/.test(title);
            return hasText || hasLabel || hasImage || hasChildren || hasChapterLikeTitle;
        };
        const detachedTables: TreeNode[] = [];
        let detachedSeed = 1;
        const walk = (nodes: TreeNode[]): TreeNode[] => {
            const next: TreeNode[] = [];
            for (const raw of (nodes || [])) {
                const node: TreeNode = { ...raw, children: walk(raw.children || []) };
                if (isReviewTable(node.table)) {
                    detachedTables.push({
                        ...node,
                        id: node.id ? Number(`${node.id}${detachedSeed}`) : Date.now() + detachedSeed,
                        n_id: 0,
                        p_id: 0,
                        title: String(node.title || "").trim() || "评审记录",
                        text: "",
                        img_url: "",
                        children: [],
                    });
                    detachedSeed += 1;
                    node.table = {} as any;
                    if (!isNodeMeaningfulWithoutTable(node)) {
                        continue;
                    }
                }
                next.push(node);
            }
            return next;
        };
        const cleanedRoots = walk(roots);
        if (detachedTables.length === 0) return cleanedRoots;
        const reviewRoot: TreeNode = {
            id: Date.now(),
            doc_id: cleanedRoots[0]?.doc_id || 0,
            n_id: 0,
            p_id: 0,
            title: "评审记录",
            label: "",
            img_url: "",
            text: "",
            table: {} as any,
            children: detachedTables,
        };
        return [...cleanedRoots, reviewRoot];
    };
    // 保留历史函数实现（便于回滚），当前按“Word层级直出”路径不启用。
    void decorateImportedWordTree;
    void relocateDataStructureTables;
    const rebindFlowImageToFlowChild = (roots: TreeNode[]): TreeNode[] => {
        const walk = (nodes: TreeNode[]): TreeNode[] => {
            return (nodes || []).map((node) => {
                const nextChildren = walk((node.children || []) as TreeNode[]);
                const nodeTitle = String(node.title || "");
                const nodeLabel = String(node.label || "");
                const nodeText = String(node.text || "");
                const nodeHasFlowHint = /网络安全流程图|安全流程图/.test(`${nodeTitle} ${nodeLabel} ${nodeText}`);
                let nextNode: TreeNode = { ...node, children: nextChildren };
                if (nodeHasFlowHint && String(node.img_url || "").trim() && nextChildren.length > 0) {
                    const targetIdx = nextChildren.findIndex((child) => /网络安全流程图|安全流程图/.test(`${child.title || ""} ${child.label || ""}`));
                    const placeholderIdx = nextChildren.findIndex((child) => /^导入图片\d+$/i.test(String(child.title || "").trim()));
                    const pickedIdx = targetIdx >= 0 ? targetIdx : placeholderIdx;
                    if (pickedIdx >= 0) {
                        const target = { ...nextChildren[pickedIdx] };
                        if (!String(target.img_url || "").trim()) {
                            target.img_url = String(node.img_url || "");
                        }
                        target.ref_type = "img_flow";
                        if (/^导入图片\d+$/i.test(String(target.title || "").trim())) {
                            target.title = "网络安全流程图";
                        }
                        const mergedChildren = [...nextChildren];
                        mergedChildren[pickedIdx] = target;
                        nextNode = { ...nextNode, img_url: "", children: mergedChildren };
                    }
                }
                return nextNode;
            });
        };
        return walk(roots || []);
    };
    const normalizeImageRefTypes = (roots: TreeNode[]): TreeNode[] => {
        const detectRefType = (txt: string): string | undefined => {
            const normalized = String(txt || "")
                .replace(/^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
                .replace(/^图\s*\d+\s*/, "")
                .replace(/\s+/g, "")
                .trim();
            if (/^(网络安全流程图|安全流程图)$/.test(normalized)) return "img_flow";
            if (/^(物理拓扑图|拓扑图)$/.test(normalized)) return "img_topo";
            if (/^(系统结构图|体系结构图)$/.test(normalized)) return "img_struct";
            return undefined;
        };
        const walk = (nodes: TreeNode[]): TreeNode[] => {
            return (nodes || []).map((node) => {
                const merged = `${node.title || ""} ${node.label || ""}`;
                const guessedRefType = detectRefType(merged);
                const nextChildren = walk((node.children || []) as TreeNode[]);
                const keepExistingRefType = node.ref_type && !DOC_IMAGE_REF_TYPES.includes(node.ref_type as any);
                // 修复：非图片章节（标题识别不出拓扑图/结构图/流程图）却误绑了产品库拓扑图/结构图，清空脏 img_url
                const isMisboundProductImg = !guessedRefType
                    && /\/img_topo\/|\/img_struct\//.test(String((node as any).img_url || ""));
                return {
                    ...node,
                    ref_type: guessedRefType || (keepExistingRefType ? node.ref_type : undefined),
                    ...(isMisboundProductImg ? { img_url: "" } : {}),
                    children: nextChildren,
                };
            });
        };
        return walk(roots || []);
    };

    const generateTempNodeId = () => Date.now() + Math.floor(Math.random() * 100000);
    const getTableHitCount = (node: any, keys: string[]) => {
        const headers = Array.isArray(node?.table?.headers) ? node.table.headers : [];
        const rows = Array.isArray(node?.table?.rows) ? node.table.rows : [];
        const headerTxt = headers.map((h: any) => String(h?.name || "")).join(" ");
        const rowTxt = rows.map((r: any) => Object.values(r || {}).join(" ")).join(" ");
        const txt = `${headerTxt} ${rowTxt}`;
        return keys.filter((k) => txt.includes(k)).length;
    };
    const createCoverTableNode = (): TreeNode => ({
        id: generateTempNodeId(),
        doc_id: 0,
        n_id: 0,
        p_id: 0,
        title: "软件详细设计",
        text: "",
        table: {
            headers: [
                { code: "label1", name: "" },
                { code: "value1", name: "" },
                { code: "label2", name: "" },
                { code: "value2", name: "" },
            ],
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
            rows: [
                { change_date: "", version_no: "", change_desc: "", changer: "", approver: "" },
                { change_date: "", version_no: "", change_desc: "", changer: "", approver: "" },
                { change_date: "", version_no: "", change_desc: "", changer: "", approver: "" },
                { change_date: "", version_no: "", change_desc: "", changer: "", approver: "" },
                { change_date: "", version_no: "", change_desc: "", changer: "", approver: "" },
            ],
        } as any,
        children: [],
    });
    const createReviewAppendixNode = (): TreeNode => {
        const check = "☑通过 □存在问题";
        const contentItems: Array<[string, string]> = [
            ["法规标准引用", "是否明确"],
            ["法规标准引用", "是否合理"],
            ["法规标准引用", "是否完整"],
            ["法规标准引用", "是否符合法规"],
            ["文档完整程度", "文档结构清楚、内容详尽"],
            ["文档完整程度", "包含架构设计"],
            ["文档完整程度", "包含模块设计"],
            ["文档完整程度", "包含接口设计"],
            ["文档完整程度", "包含功能详细设计"],
            ["文档完整程度", "包含必要的数据结构"],
            ["文档完整程度", "软件整体输入、输出接口清晰"],
            ["文档完整程度", "是否可追溯"],
            ["功能覆盖程度", "设计中考虑了整体功能需求"],
            ["功能覆盖程度", "性能要求清晰、明确"],
            ["功能覆盖程度", "接口定义清晰、明确"],
            ["功能覆盖程度", "模块设计覆盖所有功能要求"],
            ["功能覆盖程度", "针对每一项功能都有详细设计"],
            ["功能覆盖程度", "功能设计中具备输入、输出项明确"],
            ["功能覆盖程度", "功能设计中具备逻辑或结构图"],
            ["功能覆盖程度", "能实现软件系统结构"],
            ["功能覆盖程度", "设计的内容不与软件系统结构互相矛盾"],
        ];
        let prevCat = "";
        const contentRows = contentItems.map(([cat, item]) => {
            const row = { cat: cat === prevCat ? "" : cat, item, result: check };
            prevCat = cat;
            return row;
        });
        contentRows.push({
            cat: "评审结论：\n通过，详细设计包含架构设计、包含模块设计、包含接口设计、包含必要的数据结构，输入、输出接口清晰，模块设计覆盖了所有功能要求，针对需求完成了可追溯。",
            item: "",
            result: "",
        });
        return {
            id: generateTempNodeId(),
            doc_id: 0,
            n_id: 0,
            p_id: 0,
            title: "附件一 评审结论",
            ref_type: "review",
            text: "",
            table: {
                name: "评审内容",
                headers: [
                    { code: "cat", name: "评审内容" },
                    { code: "item", name: "评审项" },
                    { code: "result", name: "评审结论" },
                ],
                rows: contentRows,
                extra_tables: [
                    {
                        title: "参评人员签字",
                        table: {
                            headers: [
                                { code: "role1", name: "人员角色" },
                                { code: "name1", name: "姓名" },
                                { code: "sign1", name: "签字" },
                                { code: "role2", name: "人员角色" },
                                { code: "name2", name: "姓名" },
                                { code: "sign2", name: "签字" },
                            ],
                            rows: [
                                { role1: "参评人员签字", name1: "", sign1: "", role2: "", name2: "", sign2: "" },
                                { role1: "评审时间：", name1: "", sign1: "", role2: "", name2: "", sign2: "" },
                                { role1: "人员角色", name1: "姓名", sign1: "签字", role2: "人员角色", name2: "姓名", sign2: "签字" },
                                { role1: "产品经理", name1: "", sign1: "", role2: "产品开发部经理", name2: "", sign2: "" },
                                { role1: "开发负责人", name1: "", sign1: "", role2: "QA", name2: "", sign2: "" },
                                { role1: "其他参评人员", name1: "/", sign1: "", role2: "", name2: "", sign2: "" },
                                { role1: "批准人员签字/日期", name1: "", sign1: "", role2: "", name2: "", sign2: "" },
                            ],
                        },
                    },
                ],
            } as any,
            children: [],
        };
    };
    const ensureFrontMatterTables = (roots: TreeNode[]): TreeNode[] => {
        const list = [...(roots || [])];
        let hasCover = false;
        let hasChange = false;
        let hasReview = false;
        const isReviewTitle = (title?: string) => {
            const t = String(title || "").replace(/\s+/g, "");
            return t === "评审记录" || t === "附件一评审结论" || t.startsWith("附件一");
        };
        const walk = (nodes: TreeNode[]) => {
            (nodes || []).forEach((node) => {
                const title = String(node?.title || "").replace(/\s+/g, "");
                if (title.includes("软件详细设计")) hasCover = true;
                if (title.includes("文件修订记录")) hasChange = true;
                if (isReviewTitle(node?.title) || String((node as any)?.ref_type || "") === "review") hasReview = true;
                if (getTableHitCount(node, ["编制科室", "编制部门", "文件版本", "编制人", "审核人", "批准人", "生效日期"]) >= 3) hasCover = true;
                if (getTableHitCount(node, ["修改日期", "版本号", "修订说明", "修订人", "批准人"]) >= 3) hasChange = true;
                walk((node.children || []) as TreeNode[]);
            });
        };
        walk(list);
        const prefix: TreeNode[] = [];
        if (!hasCover) prefix.push(createCoverTableNode());
        if (!hasChange) prefix.push(createChangeLogTableNode());
        const withPrefix = prefix.length > 0 ? [...prefix, ...list] : list;
        if (hasReview) return withPrefix;
        return [...withPrefix, createReviewAppendixNode()];
    };
    const buildStandardNodesWithIds = (): TreeNode[] => {
        const addIdsToNodes = (nodes: any[]): TreeNode[] => {
            return nodes.map((node) => ({
                ...node,
                id: generateTempNodeId(),
                children: node.children ? addIdsToNodes(node.children) : [],
            }));
        };
        return ensureFrontMatterTables(addIdsToNodes(standardNodes as any[]));
    };

    const needsStandardTemplate = (nodes: TreeNode[]): boolean => {
        const list = nodes || [];
        if (list.length === 0) return true;
        const hasMainChapter = (items: TreeNode[]): boolean =>
            (items || []).some((node) => {
                const title = String(node.title || "").trim();
                if (/^1[\s.．、]/.test(title) || /介绍/.test(title) || /^2[\s.．、]/.test(title)) {
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

    const buildStandardTreeForDoc = async (productId: number, version: string, product?: any): Promise<TreeNode[]> => {
        let nodesWithIds = applyProductScopeToTree(buildStandardNodesWithIds(), product).nodes;
        nodesWithIds = rebindFlowImageToFlowChild(nodesWithIds);
        nodesWithIds = normalizeImageRefTypes(nodesWithIds);
        nodesWithIds = await remapRefTypeImagesByProduct(nodesWithIds, productId, version);
        return nodesWithIds;
    };

    const normalizeReqCode = (value?: string) => String(value || "").trim().toUpperCase().replace(/\s+/g, "");
    const toSdsCode = (srsCode?: string) => {
        const code = normalizeReqCode(srsCode);
        return code.startsWith("SRS-") ? `SDS-${code.slice(4)}` : code;
    };
    const compareReqCode = (a?: string, b?: string) => {
        const ax = normalizeReqCode(a).match(/\d+/g)?.map(Number) || [];
        const bx = normalizeReqCode(b).match(/\d+/g)?.map(Number) || [];
        const len = Math.max(ax.length, bx.length);
        for (let i = 0; i < len; i += 1) {
            const diff = (ax[i] || 0) - (bx[i] || 0);
            if (diff !== 0) return diff;
        }
        return normalizeReqCode(a).localeCompare(normalizeReqCode(b));
    };
    const normalizeReqNamePart = (value?: string) => {
        const txt = String(value || "").trim();
        const invalid = new Set(["/", "\\", "／", "＼", "-", "--", "_", "无", "N/A", "n/a", "NA", "na", "null", "NULL", "None", "none"]);
        return invalid.has(txt) ? "" : txt;
    };
    const normalizeReqTitle = (value?: string) => normalizeReqNamePart(value)
        .trim()
        .replace(/^(\d+(?:\.\d+)+|\d{1,2})(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
        .replace(/\s+/g, "")
        .toLowerCase();
    const getReqSubFunctionTitle = (row: any) => [row.sub_function, row.function, row.module, row.name, row.srs_code]
        .map((value) => normalizeReqNamePart(String(value || "")))
        .find(Boolean) || "";
    const resolveReqChapter = (row: any) => {
        const composed = getReqSubFunctionTitle(row);
        if (composed) return composed;
        return normalizeReqNamePart(String(row?.chapter || ""));
    };
    const syncMissingReqdNodes = async (roots: TreeNode[], docId?: number): Promise<TreeNode[]> => {
        if (isReadOnly || !docId || !Array.isArray(roots) || roots.length === 0) return roots;
        try {
            const res: any = await ApiSdsReqd.list_sds_reqd({
                doc_id: docId,
                page_index: 0,
                page_size: 10000,
                _ts: Date.now(),
            });
            if (res?.code !== ApiSdsReqd.C_OK) return roots;
            const rows = res?.data?.rows || [];
            if (!rows.length) return roots;

            const getDesignCode = (row: any) => normalizeReqCode(row?.sds_code) || toSdsCode(row?.srs_code || row?.req_id);
            const rowBySdsCode = new Map<string, any>();
            rows.forEach((row: any) => {
                const code = getDesignCode(row);
                if (code) rowBySdsCode.set(code, row);
            });
            if (rowBySdsCode.size === 0) return roots;

            const codeByTitle = new Map<string, string>();
            const rowByCode = new Map<string, any>();
            rows.forEach((row: any) => {
                const code = getDesignCode(row);
                if (!code) return;
                rowByCode.set(code, row);
                [row.sub_function, row.name]
                    .map((value) => normalizeReqTitle(String(value || "")))
                    .filter(Boolean)
                    .forEach((title) => {
                        if (!codeByTitle.has(title)) codeByTitle.set(title, code);
                    });
            });
            const composeReqDescription = (row: any) => {
                const overview = String(row?.overview || "").trim();
                const funcDetail = String(row?.func_detail || "").trim();
                const logicTxt = String(row?.logic_txt || "").trim();
                const intput = String(row?.intput || "").trim();
                const output = String(row?.output || "").trim();
                const interfaceText = String(row?.interface || "").trim();
                return [
                    `(1) 总体描述\n${overview || "无"}`,
                    `(2) 功能\n${funcDetail || "无"}`,
                    `(3) 程序逻辑\n${logicTxt || "无"}`,
                    `(4) 输入项\n${intput || "无"}`,
                    `(5) 输出项\n${output || "无"}`,
                    `(6) 接口\n${interfaceText || "无"}`,
                ].join("\n");
            };
            const getReqHierarchyTitles = (row: any) => {
                const titles = [row.module, row.function, row.sub_function]
                    .map((value) => normalizeReqNamePart(String(value || "")))
                    .filter(Boolean);
                const uniqueTitles: string[] = [];
                titles.forEach((title) => {
                    if (!uniqueTitles.some((item) => normalizeReqTitle(item) === normalizeReqTitle(title))) {
                        uniqueTitles.push(title);
                    }
                });
                return uniqueTitles.length ? uniqueTitles : [getReqSubFunctionTitle(row)].filter(Boolean);
            };
            const validReqTitleSet = new Set<string>();
            const validReqTitlesWithRows: Array<{ title: string; row: any; code: string }> = [];
            const reqRootTitleSet = new Set<string>();
            rows.forEach((row: any) => {
                const code = getDesignCode(row);
                const hierarchyTitles = getReqHierarchyTitles(row);
                const rootTitle = normalizeReqTitle(hierarchyTitles[0]);
                if (rootTitle) reqRootTitleSet.add(rootTitle);
                [row.name, row.module, row.function, row.sub_function]
                    .map((value) => normalizeReqTitle(String(value || "")))
                    .filter(Boolean)
                    .forEach((title) => {
                        validReqTitleSet.add(title);
                    });
                [row.name, row.function, row.sub_function]
                    .map((value) => normalizeReqTitle(String(value || "")))
                    .filter(Boolean)
                    .forEach((title) => {
                        if (code) validReqTitlesWithRows.push({ title, row, code });
                    });
            });
            const stripHeadingNumber = (title?: string) => String(title || "")
                .trim()
                .replace(HEADING_NUM_RE, "")
                .trim();
            const getHeadingDepth = (title?: string) => {
                const matched = String(title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/);
                return matched ? matched[1].split(".").length : 0;
            };
            const getHeadingSectionMinor = (title?: string) => {
                const matched = String(title || "").trim().match(/^(\d+)\.(\d+)/);
                return matched ? Number(matched[2]) : null;
            };
            const isInFixedTemplateZone = (node: TreeNode) => {
                const minor = getHeadingSectionMinor(node.title);
                // 产品模块标准二级章节 3.1~3.10 / 4.1~4.10 等：保留模板默认值，不被需求同步覆盖或剪枝
                return minor != null && minor <= 10;
            };
            const fixedSdsChapterTitles = new Set([
                "总体描述",
                "功能",
                "性能",
                "模块结构",
                "程序逻辑",
                "输入项",
                "输出项",
                "数据结构",
                "接口",
                "neoviewer",
                "功能设计",
                "限制条件",
                "尚未解决的问题",
            ].map((item) => normalizeReqTitle(item)));
            const isFunctionStopperTitle = (title?: string) => {
                const normalizedTitle = normalizeReqTitle(stripHeadingNumber(title));
                return normalizedTitle.includes("限制条件") || normalizedTitle.includes("尚未解决的问题");
            };
            const withCurrentReqTitle = (node: TreeNode, row: any) => {
                const heading = parseHeadingNumber(node.title);
                const titleText = getReqSubFunctionTitle(row);
                return heading && titleText ? `${heading} ${titleText}` : (titleText || node.title);
            };
            const matchRowByNodeTitle = (node: TreeNode) => {
                const normalizedTitle = normalizeReqTitle(stripHeadingNumber(node.title));
                if (!normalizedTitle) return undefined;
                return validReqTitlesWithRows.find(({ title }) => title === normalizedTitle)
                    || validReqTitlesWithRows.find(({ title }) => title && (normalizedTitle.includes(title) || title.includes(normalizedTitle)));
            };
            const isFunctionalReqHeading = (node: TreeNode) => {
                const minor = getHeadingSectionMinor(node.title);
                if (minor != null && minor <= 5) return false;
                const normalizedTitle = normalizeReqTitle(stripHeadingNumber(node.title));
                return minor != null &&
                    minor >= 6 &&
                    getHeadingDepth(node.title) >= 2 &&
                    !fixedSdsChapterTitles.has(normalizedTitle);
            };
            const pruneAndRefreshReqdNodes = (nodes: TreeNode[], parentIsFunctionStopper = false, parentHeadingDepth = 0): TreeNode[] => {
                return (nodes || [])
                    .map((node) => {
                        const rawCode = normalizeReqCode((node as any).sds_code);
                        const hasReqChild = ((node.children || []) as TreeNode[]).some((child) =>
                            normalizeReqCode((child as any).sds_code) || isFunctionalReqHeading(child)
                        );
                        const rawCodeStillValid = rawCode && (rowByCode.has(rawCode) || rowBySdsCode.has(rawCode));
                        const titleMatch = !hasReqChild && isFunctionalReqHeading(node) && (!rawCode || !rawCodeStillValid) ? matchRowByNodeTitle(node) : undefined;
                        const matchedCode = hasReqChild ? "" : (rawCodeStillValid ? rawCode : (titleMatch?.code || rawCode || ""));
                        const matchedRow = matchedCode ? rowByCode.get(matchedCode) || rowBySdsCode.get(matchedCode) || titleMatch?.row : undefined;
                        const children = pruneAndRefreshReqdNodes(
                            (node.children || []) as TreeNode[],
                            isFunctionStopperTitle(node.title),
                            getHeadingDepth(node.title)
                        );
                        const nextNode: TreeNode = {
                            ...node,
                            children,
                        };
                        if (hasReqChild && rawCode) {
                            delete (nextNode as any).sds_code;
                        }
                        if (matchedCode && matchedRow && !isInFixedTemplateZone(node)) {
                            const cleanedText = stripRedundantSdsCodeFromText(node.text, matchedCode);
                            nextNode.text = cleanedText || composeReqDescription(matchedRow);
                            nextNode.sds_code = matchedCode;
                            nextNode.title = withCurrentReqTitle(node, matchedRow);
                        }
                        return nextNode;
                    })
                    .filter((node) => {
                        const code = normalizeReqCode((node as any).sds_code);
                        if (code && !rowByCode.has(code) && !rowBySdsCode.has(code)) {
                            return false;
                        }
                        const normalizedTitle = normalizeReqTitle(stripHeadingNumber(node.title));
                        const misplacedModuleRoot =
                            !code &&
                            parentHeadingDepth >= 2 &&
                            normalizedTitle &&
                            reqRootTitleSet.has(normalizedTitle);
                        if (misplacedModuleRoot) {
                            return false;
                        }
                        if (parentIsFunctionStopper && (
                            (code && (rowByCode.has(code) || rowBySdsCode.has(code))) ||
                            (normalizedTitle && validReqTitleSet.has(normalizedTitle))
                        )) {
                            return false;
                        }
                        const staleReqTitle =
                            isFunctionalReqHeading(node) &&
                            normalizedTitle &&
                            !validReqTitleSet.has(normalizedTitle) &&
                            !matchRowByNodeTitle(node);
                        return !staleReqTitle;
                    });
            };
            const hydrateExistingReqdNodes = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => {
                const children = hydrateExistingReqdNodes((node.children || []) as TreeNode[]);
                if (isInFixedTemplateZone(node)) {
                    return { ...node, children };
                }
                const currentCode = normalizeReqCode((node as any).sds_code);
                if (currentCode) {
                    return { ...node, children };
                }
                const matchedCode = codeByTitle.get(normalizeReqTitle(node.title));
                return matchedCode
                    ? {
                        ...node,
                        sds_code: matchedCode,
                        text: stripRedundantSdsCodeFromText(node.text, matchedCode),
                        children,
                    }
                    : { ...node, children };
            });
            const rootsWithCodes = pruneAndRefreshReqdNodes(hydrateExistingReqdNodes(roots));

            const buildLeafNode = (row: any, code: string, existing?: TreeNode): TreeNode => ({
                ...(existing || {}),
                id: existing?.id || generateTempNodeId(),
                doc_id: existing?.doc_id || 0,
                n_id: existing?.n_id || 0,
                p_id: existing?.p_id || 0,
                title: existing?.title || getReqSubFunctionTitle(row),
                sds_code: code,
                img_url: existing?.img_url || "",
                text: composeReqDescription(row) || existing?.text || "",
                table: existing?.table || ({} as any),
                children: (existing?.children || []) as TreeNode[],
            });

            const existingCodes = new Set<string>();
            const existingTitles = new Set<string>();
            const collectExistingNodes = (nodes: TreeNode[]) => {
                (nodes || []).forEach((node) => {
                    const code = normalizeReqCode((node as any).sds_code);
                    if (code) existingCodes.add(code);
                    const title = normalizeReqTitle(node.title);
                    if (title) existingTitles.add(title);
                    collectExistingNodes((node.children || []) as TreeNode[]);
                });
            };
            collectExistingNodes(rootsWithCodes);
            const codeNumbers = (code?: string) => normalizeReqCode(code).match(/\d+/g)?.map(Number) || [];
            const codeMajor = (code?: string) => codeNumbers(code)[0];
            const codeDistance = (a?: string, b?: string) => {
                const ax = codeNumbers(a);
                const bx = codeNumbers(b);
                const len = Math.max(ax.length, bx.length);
                let score = 0;
                for (let i = 0; i < len; i += 1) {
                    score += Math.abs((ax[i] || 0) - (bx[i] || 0)) * Math.pow(1000, len - i);
                }
                return score;
            };
            const pathKey = (path: number[]) => path.join(".");
            const anchors: Array<{ code: string; parentPath: number[] }> = [];
            const collectAnchors = (nodes: TreeNode[], parentPath: number[] = []) => {
                (nodes || []).forEach((node, index) => {
                    const code = normalizeReqCode((node as any).sds_code);
                    if (code) anchors.push({ code, parentPath });
                    collectAnchors((node.children || []) as TreeNode[], [...parentPath, index]);
                });
            };
            collectAnchors(rootsWithCodes);
            if (anchors.length === 0) return rootsWithCodes;
            const maxExistingMajor = Math.max(...anchors.map((anchor) => codeMajor(anchor.code) || 0));
            const shouldInsertRow = (code: string, row: any) => {
                if (existingCodes.has(code)) return false;
                const title = normalizeReqTitle(getReqSubFunctionTitle(row));
                if (title && existingTitles.has(title)) return false;
                const major = codeMajor(code) || 0;
                return major >= maxExistingMajor;
            };
            if (!Array.from(rowBySdsCode.entries()).some(([code, row]) => shouldInsertRow(code, row))) return rootsWithCodes;

            const findFunctionAreaInsertTarget = (nodes: TreeNode[], currentPath: number[] = []): { parentPath: number[]; afterIndex?: number } | undefined => {
                for (let index = 0; index < (nodes || []).length; index += 1) {
                    const node = nodes[index];
                    const heading = parseHeadingNumber(node.title);
                    const title = normalizeReqTitle(stripHeadingNumber(node.title));
                    const isFunctionAreaRoot = heading === "6" || title.includes("功能设计");
                    if (isFunctionAreaRoot) {
                        const children = ((node.children || []) as TreeNode[]);
                        const firstStopperIndex = children.findIndex((child) => isFunctionStopperTitle(child.title));
                        return {
                            parentPath: [...currentPath, index],
                            afterIndex: firstStopperIndex >= 0 ? firstStopperIndex - 1 : children.length - 1,
                        };
                    }
                    const childTarget = findFunctionAreaInsertTarget((node.children || []) as TreeNode[], [...currentPath, index]);
                    if (childTarget) return childTarget;
                }
                return undefined;
            };
            const functionAreaInsertTarget = findFunctionAreaInsertTarget(rootsWithCodes);

            const findInsertTargetByCode = (code: string): { parentPath: number[]; afterIndex?: number } | undefined => {
                if (functionAreaInsertTarget) {
                    return functionAreaInsertTarget;
                }
                const major = codeMajor(code);
                const sameMajor = anchors.filter((anchor) => codeMajor(anchor.code) === major);
                if (sameMajor.length) {
                    return {
                        parentPath: [...sameMajor].sort((a, b) => codeDistance(a.code, code) - codeDistance(b.code, code))[0].parentPath,
                    };
                }
                const nearest = [...anchors].sort((a, b) => codeDistance(a.code, code) - codeDistance(b.code, code))[0];
                if (!nearest) return undefined;
                const nearestParentPath = nearest.parentPath || [];
                if (nearestParentPath.length === 0) return { parentPath: [] };
                return {
                    parentPath: nearestParentPath.slice(0, -1),
                    afterIndex: nearestParentPath[nearestParentPath.length - 1],
                };
            };

            const insertionsByParent = new Map<string, Array<{ code: string; row: any; afterIndex?: number }>>();
            Array.from(rowBySdsCode.entries())
                .filter(([code, row]) => shouldInsertRow(code, row))
                .sort(([a], [b]) => compareReqCode(a, b))
                .forEach(([code, row]) => {
                    const target = findInsertTargetByCode(code);
                    if (!target) return;
                    const key = pathKey(target.parentPath);
                    const list = insertionsByParent.get(key) || [];
                    list.push({ code, row, afterIndex: target.afterIndex });
                    insertionsByParent.set(key, list);
                });
            if (insertionsByParent.size === 0) return rootsWithCodes;

            const nextHeadingAfter = (siblings: TreeNode[], beforeIndex: number, offset: number) => {
                for (let index = beforeIndex; index >= 0; index -= 1) {
                    const heading = parseHeadingNumber(siblings[index]?.title);
                    if (!heading) continue;
                    const parts = heading.split(".").map((part) => Number(part));
                    if (!parts.length || parts.some((part) => !Number.isFinite(part))) continue;
                    parts[parts.length - 1] += offset;
                    return parts.join(".");
                }
                return "";
            };
            const withSiblingChapterNo = (node: TreeNode, siblings: TreeNode[], insertIndex: number, offset: number, force = false): TreeNode => {
                if (!force && parseHeadingNumber(node.title)) return node;
                const heading = nextHeadingAfter(siblings, insertIndex - 1, offset);
                if (!heading) return node;
                const titleText = force ? String(node.title || "").trim() : stripHeadingNumber(node.title);
                return { ...node, title: `${heading} ${titleText}`.trim() };
            };
            const withChildChapterNos = (node: TreeNode, force = false): TreeNode => {
                const parentHeading = parseHeadingNumber(node.title);
                const children = ((node.children || []) as TreeNode[]).map((child, index) => {
                    const childWithNumber = (!force && parseHeadingNumber(child.title)) || !parentHeading
                        ? child
                        : { ...child, title: `${parentHeading}.${index + 1} ${force ? String(child.title || "").trim() : stripHeadingNumber(child.title)}`.trim() };
                    return withChildChapterNos(childWithNumber, force);
                });
                return { ...node, children };
            };
            const appendHierarchyRow = (nodes: TreeNode[], row: any, code: string) => {
                const titles = getReqHierarchyTitles(row);
                let levelNodes = nodes;
                titles.forEach((title, index) => {
                    const isLeaf = index === titles.length - 1;
                    let target = levelNodes.find((node) => normalizeReqTitle(node.title) === normalizeReqTitle(title));
                    if (!target) {
                        target = {
                            id: generateTempNodeId(),
                            doc_id: 0,
                            n_id: 0,
                            p_id: 0,
                            title,
                            ...(isLeaf && { sds_code: code }),
                            img_url: "",
                            text: isLeaf ? composeReqDescription(row) : "",
                            table: {} as any,
                            children: [],
                        } as TreeNode;
                        levelNodes.push(target);
                    } else if (isLeaf && !(target as any).sds_code) {
                        (target as any).sds_code = code;
                        target.text = composeReqDescription(row) || stripRedundantSdsCodeFromText(target.text, code) || "";
                    } else if (isLeaf) {
                        const cleanedText = stripRedundantSdsCodeFromText(target.text, code);
                        target.text = composeReqDescription(row) || cleanedText || target.text || "";
                    }
                    levelNodes = (target.children || []) as TreeNode[];
                });
            };
            const buildHierarchyNodes = (insertions: Array<{ code: string; row: any }>) => {
                const nodes: TreeNode[] = [];
                insertions.forEach(({ code, row }) => appendHierarchyRow(nodes, row, code));
                return nodes;
            };
            const renumberFollowingSiblings = (siblings: TreeNode[]) => {
                const result = siblings.map((child) => ({ ...child }));
                let previousHeading = "";
                result.forEach((child, index) => {
                    const currentHeading = parseHeadingNumber(child.title);
                    if (!currentHeading) return;
                    if (previousHeading) {
                        const previousParts = previousHeading.split(".").map((part) => Number(part));
                        const currentParts = currentHeading.split(".").map((part) => Number(part));
                        if (
                            previousParts.length === currentParts.length
                            && previousParts.slice(0, -1).every((part, partIndex) => part === currentParts[partIndex])
                            && currentParts[currentParts.length - 1] <= previousParts[previousParts.length - 1]
                        ) {
                            currentParts[currentParts.length - 1] = previousParts[previousParts.length - 1] + 1;
                            const nextHeading = currentParts.join(".");
                            result[index] = {
                                ...child,
                                title: `${nextHeading} ${stripHeadingNumber(child.title)}`.trim(),
                            };
                            previousHeading = nextHeading;
                            return;
                        }
                    }
                    previousHeading = parseHeadingNumber(result[index].title) || currentHeading;
                });
                return result;
            };

            const insertReqdNodes = (children: TreeNode[], insertions: Array<{ code: string; row: any; afterIndex?: number }>) => {
                let nextChildren = (children || []).map((child) => ({ ...child }));
                let afterIndexOffset = 0;
                const groupedInsertions = insertions.reduce<Array<Array<{ code: string; row: any; afterIndex?: number }>>>((groups, item) => {
                    const lastGroup = groups[groups.length - 1];
                    if (lastGroup && lastGroup[0]?.afterIndex === item.afterIndex) {
                        lastGroup.push(item);
                    } else {
                        groups.push([item]);
                    }
                    return groups;
                }, []);
                groupedInsertions.forEach((group) => {
                    const afterIndex = group[0]?.afterIndex;
                    const pendingRows = group.filter(({ code }) => !existingCodes.has(code));
                    if (!pendingRows.length) return;
                    if (afterIndex !== undefined) {
                        const insertIndex = afterIndex + 1 + afterIndexOffset;
                        const previewChildren = [...nextChildren];
                        const hierarchyNodes = buildHierarchyNodes(pendingRows).map((node, index) => {
                            const targetIndex = insertIndex + index;
                            const numberedNode = withChildChapterNos(withSiblingChapterNo(node, previewChildren, targetIndex, 1, true), true);
                            previewChildren.splice(targetIndex, 0, numberedNode);
                            return numberedNode;
                        });
                        nextChildren.splice(insertIndex, 0, ...hierarchyNodes);
                        afterIndexOffset += hierarchyNodes.length;
                        pendingRows.forEach(({ code }) => existingCodes.add(code));
                        return;
                    }
                    pendingRows.forEach(({ code, row }) => {
                        if (existingCodes.has(code)) return;
                    const baseLeafNode = buildLeafNode(row, code);
                    const greaterIndex = nextChildren.findIndex((child) => {
                        const childCode = normalizeReqCode((child as any).sds_code);
                        return childCode && compareReqCode(childCode, code) > 0;
                    });
                    if (greaterIndex >= 0) {
                        const leafNode = withSiblingChapterNo(baseLeafNode, nextChildren, greaterIndex, 1);
                        nextChildren.splice(greaterIndex, 0, leafNode);
                    } else {
                        const lastCodeIndex = nextChildren.reduce((lastIndex, child, index) =>
                            normalizeReqCode((child as any).sds_code) ? index : lastIndex, -1);
                        const insertIndex = lastCodeIndex + 1;
                        const leafNode = withSiblingChapterNo(baseLeafNode, nextChildren, insertIndex, 1);
                        nextChildren.splice(insertIndex, 0, leafNode);
                    }
                    existingCodes.add(code);
                    });
                });
                nextChildren = renumberFollowingSiblings(nextChildren);
                return nextChildren;
            };

            const applyInsertions = (nodes: TreeNode[], currentPath: number[] = []): TreeNode[] => {
                const directInsertions = insertionsByParent.get(pathKey(currentPath));
                const currentNodes = directInsertions ? insertReqdNodes(nodes, directInsertions) : (nodes || []).map((node) => ({ ...node }));
                return currentNodes.map((node, index) => ({
                    ...node,
                    children: applyInsertions((node.children || []) as TreeNode[], [...currentPath, index]),
                }));
            };
            return applyInsertions(rootsWithCodes);
        } catch (error) {
            console.error("同步新增设计需求节点失败:", error);
            return roots;
        }
    };

    const cloneTree = (nodes: TreeNode[]): TreeNode[] => JSON.parse(JSON.stringify(nodes || []));

    const isWordImportedDoc = (nodes: TreeNode[]): boolean => {
        const walk = (items: TreeNode[]): boolean => (items || []).some((node) => {
            const rawTitle = String(node.title || "").trim();
            const title = rawTitle.replace(/\s+/g, "");
            if (title === "目录" || title.startsWith("目录")) return true;
            if (/^导入(?:图片|表格)\d*$/i.test(rawTitle) || /^图\s*\d+/.test(rawTitle)) return true;
            if (String(node.img_url || "").trim()) return true;
            if (hasRenderableTable(node.table)) return true;
            return walk((node.children || []) as TreeNode[]);
        });
        return walk(nodes);
    };

    const isTraceSyncedOnTree = (nodes: TreeNode[]): boolean => {
        let synced = false;
        const walk = (items: TreeNode[]) => {
            (items || []).forEach((node) => {
                const title = String(node.title || "").replace(/\s+/g, "");
                const refType = String((node as any).ref_type || "");
                const isTraceNode = refType === "sds_traces"
                    || title.includes("设计与需求追溯表")
                    || title.includes("设计与需求追溯列表")
                    || !!(node.table as any)?.trace_synced;
                const table = (node.table || {}) as any;
                const hasTraceRows = Array.isArray(table.rows) && table.rows.length > 0;
                if (isTraceNode && ((node.table as any)?.trace_synced || hasTraceRows)) {
                    synced = true;
                }
                walk((node.children || []) as TreeNode[]);
            });
        };
        walk(nodes);
        return synced;
    };

    const applyLoadedDocTree = async (targetRow: any): Promise<TreeNode[]> => {
        const parsedTree = (targetRow.content || []).map((node: any) => parseTreeNode(node));
        const wordImported = isWordImportedDoc(parsedTree);
        const parsedTreeForView = isReadOnly || wordImported
            ? (isReadOnly ? relocateReviewTablesToStandalonePage(parsedTree) : parsedTree)
            : normalizeEditRootChapterNumbers(parsedTree);
        const flowReboundTree = rebindFlowImageToFlowChild(parsedTreeForView);
        const normalizedRefTree = normalizeImageRefTypes(flowReboundTree);
        const parsedContent = isReadOnly
            ? bindTableCaptionsForPersist(normalizedRefTree)
            : normalizedRefTree;
        const remappedContent = await remapRefTypeImagesByProduct(
            parsedContent,
            targetRow.product_id,
            targetRow.version
        );
        const docIdForSync = targetRow.id || (params.id ? parseInt(params.id) : undefined);
        const ensuredReqdContent = ensureFrontMatterTables(remappedContent as TreeNode[]);
        return isTraceSyncedOnTree(ensuredReqdContent as TreeNode[])
            ? await syncTraceTableNodes(
                ensuredReqdContent as TreeNode[],
                docIdForSync
            ) as TreeNode[]
            : ensuredReqdContent as TreeNode[];
    };

    const refreshSdsDocTree = async (docId: number) => {
        const docRes: any = await Api.get_sds_doc({ id: docId, _ts: Date.now() });
        if (docRes?.code !== Api.C_OK) {
            throw new Error(docRes?.msg || "刷新章节失败");
        }
        const latestRow = docRes.data || {};
        const latestTree = await applyLoadedDocTree(latestRow);
        treeStructureRef.current = latestTree;
        dispatch({
            treeStructure: latestTree,
            traceTreeRefreshKey: Date.now(),
        });
        return latestTree;
    };

    const fetchSrsTrace = async (options?: { openModal?: boolean }) => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId || isReadOnly) return;
        dispatch({ traceSyncing: true, traceListLoading: true });
        try {
            const res: any = await Api.sync_srs_trace({ doc_id: docId });
            if (res?.code !== Api.C_OK) {
                throw new Error(res?.msg || "获取SRS追溯失败");
            }
            // 明确刷新章节树：同步接口负责写库，这里重新拉取最新 SDS 树并强制重挂载树组件。
            await refreshSdsDocTree(docId);
            const rows = res.data?.trace_rows || [];
            const tableData = rows.map((item: any, index: number) => ({
                key: item.id || `trace_${index}_${Date.now()}`,
                id: item.id,
                doc_id: item.doc_id,
                srs_code: item.srs_code || "",
                sds_code: item.sds_code || "",
                chapter: resolveReqChapter(item) || item.chapter || "",
                location: item.location || "",
                product_name: item.product_name || "",
                product_version: item.product_version || "",
                type_code: item.type_code || "",
                type_name: item.type_name || "",
            }));
            dispatch({
                traceListData: expandTraceRows(tableData),
                traceListLoading: false,
                traceSyncing: false,
                showTraceListModal: options?.openModal ? true : data.showTraceListModal,
            });
            message.success("已从SRS获取追溯数据");
        } catch (error: any) {
            console.error("获取SRS追溯失败:", error);
            message.error(error?.message || "获取SRS追溯失败");
            dispatch({ traceSyncing: false, traceListLoading: false });
        }
    };

    useEffect(() => {
        const id = params.id;
        if (id) {
            dispatch({ loading: true, isEdit: !isReadOnly });
            Api.get_sds_doc({ id }).then(async (res: any) => {
                if (res.code === Api.C_OK) {
                    const targetRow = res.data;
                    const needRebindSrs = !targetRow.srsdoc_id;

                    // 映射后端字段名到表单字段名
                    editForm.setFieldsValue({
                        id: targetRow.id,
                        product_id: targetRow.product_id,
                        srsdoc_id: targetRow.srsdoc_id || undefined,
                        version: targetRow.version, // 后端 version -> 前端 full_version
                        file_no: targetRow.file_no,
                    });

                    // 如果有产品ID，加载需求文档列表
                    if (targetRow.product_id) {
                        loadSrsDocList(targetRow.product_id);
                    }

                    // 解析树状结构数据
                    const parsedTreeRaw = (targetRow.content || []).map((node: any) => parseTreeNode(node));
                    let ensuredContent = await applyLoadedDocTree(targetRow);
                    let shouldInitStandard = false;
                    if (!isReadOnly && needsStandardTemplate(ensuredContent)) {
                        const product = await resolveProductById(targetRow.product_id);
                        ensuredContent = await buildStandardTreeForDoc(
                            targetRow.product_id,
                            targetRow.version,
                            product,
                        );
                        shouldInitStandard = true;
                    }
                    const shouldPersistSyncedContent =
                        !isReadOnly &&
                        (shouldInitStandard ||
                            JSON.stringify(parsedTreeRaw || []) !== JSON.stringify(ensuredContent || []));

                    dispatch({
                        loading: false,
                        requireRebindSrs: needRebindSrs,
                        changeDescription: targetRow.change_log || "",
                        docNId: targetRow.n_id || 0, // 保存文档级别的 n_id
                        treeStructure: ensuredContent,
                        docProductId: targetRow.product_id,
                        docSrsdocId: targetRow.srsdoc_id || undefined,
                        docVersion: targetRow.version ?? "",
                    });
                    treeStructureRef.current = ensuredContent;
                    initialEditTreeRef.current = cloneTree(ensuredContent as TreeNode[]);
                    if (shouldPersistSyncedContent) {
                        const docId = targetRow.id || (params.id ? parseInt(params.id) : 0);
                        const cleanedContent = (ensuredContent as TreeNode[]).map((node: any) => cleanTreeNode(node, docId, 0));
                        Api.update_sds_doc({
                            id: docId,
                            product_id: targetRow.product_id,
                            srsdoc_id: targetRow.srsdoc_id || undefined,
                            version: targetRow.version,
                            file_no: targetRow.file_no,
                            change_log: targetRow.change_log || "",
                            content: cleanedContent,
                            n_id: targetRow.n_id || 0,
                        }).catch((error: any) => {
                            console.error("静默保存详细设计同步目录失败:", error);
                        });
                    }
                    // 进入/刷新页面自动同步功能设计：仅对内容为空的章节从 SRS 补全，
                    // 已有内容一律不动（以详细设计为准），不重排结构/编号/标题。
                    if (!isReadOnly && !needRebindSrs && targetRow.srsdoc_id) {
                        const syncDocId = targetRow.id || (params.id ? parseInt(params.id) : 0);
                        if (syncDocId) {
                            Api.sync_design_text_only({ doc_id: syncDocId })
                                .then(async (syncRes: any) => {
                                    if (syncRes?.code === Api.C_OK && (syncRes.data?.updated || 0) > 0) {
                                        await refreshSdsDocTree(syncDocId);
                                    }
                                })
                                .catch((error: any) => {
                                    console.error("自动补全功能设计内容失败:", error);
                                });
                        }
                    }
                    if (needRebindSrs) {
                        message.warning("该详细设计未绑定需求规格说明版本，请先绑定该产品下需求规格说明后再进行操作。");
                        if (isReadOnly) {
                            navigate("/sds_docs");
                        }
                    }
                } else {
                    message.error(res.msg);
                    dispatch({ loading: false });
                    navigate("/sds_docs");
                }
            });
        } else {
            // 新增模式
            editForm.resetFields();
            const initialTree = buildStandardNodesWithIds();
            initialEditTreeRef.current = [];
            dispatch({ isEdit: false, requireRebindSrs: false, treeStructure: initialTree });
            treeStructureRef.current = initialTree;
        }
    }, [params.id]);

    const handleEditChangeDesc = () => {
        dispatch({
            showChangeDescModal: true,
            tempChangeDescription: data.changeDescription,
        });
    };

    const handleSaveChangeDesc = () => {
        dispatch({
            changeDescription: data.tempChangeDescription,
            showChangeDescModal: false
        });
        editForm.setFieldValue("change_description", data.tempChangeDescription);
        message.success(ts("save"));
    };

    const handleCancelChangeDesc = () => {
        dispatch({ showChangeDescModal: false });
    };

    // 加载需求文档列表
    const loadSrsDocList = (productId: number) => {
        ApiSrsDoc.list_srs_doc({
            product_id: productId,
            page_index: 0,
            page_size: 10000,
        }).then((res: any) => {
            if (res.code === ApiSrsDoc.C_OK) {
                dispatch({ srsDocList: res.data?.rows || [] });
            } else {
                dispatch({ srsDocList: [] });
                message.error(res.msg || "加载需求文档列表失败");
            }
        }).catch((error: any) => {
            console.error("加载需求文档列表失败:", error);
            dispatch({ srsDocList: [] });
        });
    };

    // 加载设计列表数据
    const loadReqdListData = () => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId) {
            return;
        }
        dispatch({ reqdListLoading: true });
        Promise.all([
            Api.get_sds_doc({ id: docId }),
            ApiSdsReqd.list_sds_reqd({
                doc_id: docId,
                page_index: 0,
                page_size: 10000,
                _ts: Date.now(),
            }),
        ]).then(async ([docRes, res]: any[]) => {
            if (res.code === ApiSdsReqd.C_OK) {
                const rows = res.data?.rows || [];
                let currentTree = (((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) || []) as TreeNode[];
                if (docRes?.code === Api.C_OK) {
                    const latestRow = docRes.data || {};
                    const parsedTree = (latestRow.content || []).map((node: any) => parseTreeNode(node));
                    // 严格按 Word 导入层级展示：不做前端二次“章节重排/补号/拆分”
                    const parsedTreeForView = isReadOnly
                        ? relocateReviewTablesToStandalonePage(parsedTree)
                        : normalizeEditRootChapterNumbers(parsedTree);
                    const flowReboundTree = rebindFlowImageToFlowChild(parsedTreeForView);
                    const normalizedRefTree = normalizeImageRefTypes(flowReboundTree);
                    const parsedContent = isReadOnly
                        ? bindTableCaptionsForPersist(normalizedRefTree)
                        : normalizedRefTree;
                    const remappedContent = await remapRefTypeImagesByProduct(parsedContent, latestRow.product_id, latestRow.version);
                    const ensuredReqdContent = await syncMissingReqdNodes(
                        ensureFrontMatterTables(remappedContent as TreeNode[]),
                        latestRow.id || docId
                    );
                    const ensuredContent = isTraceSyncedOnTree(ensuredReqdContent as TreeNode[])
                        ? await syncTraceTableNodes(
                            ensuredReqdContent as TreeNode[],
                            latestRow.id || docId
                        )
                        : ensuredReqdContent as TreeNode[];
                    currentTree = ensuredContent as TreeNode[];
                    treeStructureRef.current = ensuredContent;
                    dispatch({ treeStructure: ensuredContent });
                }
                const flowDebugRows: any[] = [];
                const tableData = rows.map((item: any, index: number) => {
                    const backendLogicImg = normalizeImgUrl(item.logic_img);
                    const logicTxtRaw = String(item?.logic_txt || "");
                    const hasFigureCaption = /图\s*\d+\s*[^\n，。；;]*/.test(logicTxtRaw);
                    const matchedTreeImg = resolveLogicImgFromTree(item, currentTree);
                    // 若逻辑文本已明确给出“图X 名称”，仅接受按图名命中的树内图片，避免回退到历史错误图。
                    const logicImg = withCacheBuster(
                        matchedTreeImg || (hasFigureCaption ? "" : backendLogicImg) || "",
                        `${item.id || item.req_id || index}_${Date.now()}`
                    );
                    if (/流程图|网络安全/.test(logicTxtRaw) || /流程图|网络安全/.test(String(item?.name || ""))) {
                        flowDebugRows.push({
                            req_id: item.srs_code || item.req_id || item.id,
                            name: item.name || "",
                            logic_txt: logicTxtRaw,
                            matchedTreeImg,
                            backendLogicImg,
                            finalLogicImg: logicImg,
                        });
                    }
                    return {
                        key: item.req_id || `reqd_${index}_${Date.now()}`,
                        req_id: item.srs_code,
                        doc_id: item.doc_id,
                        doc_version: item.doc_version || "",
                        name: item.name || "",
                        overview: item.overview || "",
                        function: item.function || "",
                        func_detail: item.func_detail || "",
                        logic_txt: item.logic_txt || "",
                        logic_img: logicImg,
                        intput: item.intput || "",
                        output: item.output || "",
                        interface: item.interface || "",
                        product_name: item.product_name || "",
                        product_version: item.product_version || "",
                    };
                });
                if (flowDebugRows.length > 0 && typeof window !== "undefined") {
                    (window as any).__sdsFlowDebugRows = flowDebugRows;
                    console.table(flowDebugRows);
                }
                dispatch({ reqdListData: tableData, reqdListLoading: false });
            } else {
                message.error(res.msg || "加载设计列表数据失败");
                dispatch({ reqdListData: [], reqdListLoading: false });
            }
        }).catch((error: any) => {
            console.error("加载设计列表数据失败:", error);
            message.error("加载设计列表数据失败");
            dispatch({ reqdListData: [], reqdListLoading: false });
        });
    };

    const splitTraceLines = (value?: string) => {
        const lines = String(value || "")
            .replace(/\r/g, "")
            .split("\n")
            .map((line) => line.trim());
        while (lines.length > 1 && !lines[lines.length - 1]) {
            lines.pop();
        }
        return lines.length > 0 ? lines : [""];
    };

    const expandTraceRows = (rows: any[], locationBySdsCode?: Map<string, string>) => {
        return (rows || []).flatMap((row: any, rowIndex: number) => {
            const sdsCodes = splitTraceLines(row.sds_code);
            const chapters = splitTraceLines(row.chapter);
            const locations = splitTraceLines(row.location);
            const count = Math.max(1, sdsCodes.length, chapters.length, locations.length);
            return Array.from({ length: count }).map((_, index) => ({
                ...row,
                key: `${row.id || row.key || rowIndex}_${index}`,
                sds_code: sdsCodes[index] ?? "",
                chapter: chapters[index] ?? "",
                location: locations[index] || locationBySdsCode?.get(normalizeReqCode(sdsCodes[index] ?? "")) || "",
                _splitIndex: index,
                _rowSpan: index === 0 ? count : 0,
            }));
        });
    };

    const buildSdsLocationMapFromTree = (nodes: TreeNode[]) => {
        const map = new Map<string, string>();
        const headingDepth = (value: string) => String(value || "").split(".").filter(Boolean).length;
        const putCode = (code: string, heading: string) => {
            const normalizedCode = normalizeReqCode(code);
            if (!normalizedCode || !heading) return;
            const prev = map.get(normalizedCode);
            if (!prev || headingDepth(heading) >= headingDepth(prev)) {
                map.set(normalizedCode, heading);
            }
        };
        const walk = (items: TreeNode[]) => {
            (items || []).forEach((node) => {
                const heading = parseHeadingNumber(node.title) || "";
                if (heading) {
                    const explicitCode = normalizeReqCode((node as any).sds_code);
                    if (explicitCode) {
                        putCode(explicitCode, heading);
                    }
                    const fromText = extractSdsCodeFromText(node.text).code;
                    if (fromText) {
                        putCode(fromText, heading);
                    }
                }
                walk((node.children || []) as TreeNode[]);
            });
        };
        walk(nodes || []);
        return map;
    };

    const isTraceTableNode = (node: TreeNode) => {
        const title = normalizeReqTitle(node.title);
        const refType = String((node as any).ref_type || "");
        return refType === "sds_traces" || title.includes("设计与需求追溯表") || title.includes("设计与需求追溯列表");
    };

    const buildTraceTableFromRows = (rows: any[], locationBySdsCode?: Map<string, string>) => {
        const buildChapterCell = (row: any) => {
            const sdsCodes = splitTraceLines(row.sds_code);
            const locations = splitTraceLines(row.location);
            const rawChapters = splitTraceLines(row.chapter);
            const isMultiTrace = sdsCodes.length > 1 || rawChapters.length > 1 || locations.length > 1;
            const reqChapter = isMultiTrace ? "" : resolveReqChapter(row);
            const chapters = reqChapter ? [reqChapter] : rawChapters;
            const count = Math.max(1, sdsCodes.length, chapters.length, locations.length);
            return Array.from({ length: count }).map((_, index) => {
                const chapter = String(chapters[index] ?? chapters[0] ?? "").trim();
                const sdsCode = normalizeReqCode(sdsCodes[index] ?? "");
                const location = String(
                    locations[index]
                    || locationBySdsCode?.get(sdsCode)
                    || ""
                ).trim();
                return `${chapter}${location ? `（章节 ${location}）` : ""}`;
            }).join("\n");
        };
        return {
            headers: [
                { code: "srs_code", name: "需求编号" },
                { code: "sds_code", name: "设计编号" },
                { code: "chapter", name: "需求/代码" },
            ],
            rows: (rows || []).map((row: any) => {
                return {
                    srs_code: row.srs_code || "",
                    sds_code: row.sds_code || "",
                    chapter: buildChapterCell(row),
                };
            }),
        };
    };

    const isChangeTraceRow = (row: any) => {
        const typeCode = String(row?.type_code || "").trim();
        return !!typeCode && typeCode !== "1" && typeCode !== "2";
    };

    const buildTraceChangeExtraTables = (rows: any[], locationBySdsCode?: Map<string, string>) => {
        const groups: Array<{ typeCode: string; title: string; rows: any[] }> = [];
        const groupIndex = new Map<string, number>();
        const normalizeTypeNameKey = (value?: string) => String(value || "")
            .replace(/：/g, ":")
            .replace(/:$/g, "")
            .replace(/\s+/g, "")
            .trim();
        (rows || []).forEach((row: any) => {
            const typeCode = String(row?.type_code || "").trim();
            if (!typeCode) return;
            const title = String(row?.type_name || "").trim() || "变更需求";
            const groupKey = normalizeTypeNameKey(title) || typeCode;
            if (!groupIndex.has(groupKey)) {
                groupIndex.set(groupKey, groups.length);
                groups.push({ typeCode: groupKey, title, rows: [] });
            }
            groups[groupIndex.get(groupKey)!].rows.push(row);
        });
        return groups.map((group) => ({
            title: group.title,
            table: buildTraceTableFromRows(group.rows, locationBySdsCode),
        }));
    };

    const syncTraceTableNodes = async (roots: TreeNode[], docId?: number): Promise<TreeNode[]> => {
        if (!docId || !Array.isArray(roots) || roots.length === 0) return roots;
        const hasTraceNode = (nodes: TreeNode[]): boolean => (nodes || []).some((node) =>
            isTraceTableNode(node) || hasTraceNode((node.children || []) as TreeNode[])
        );
        if (!hasTraceNode(roots)) return roots;
        try {
            const res: any = await ApiSdsTrace.list_sds_trace({
                doc_id: docId,
                page_index: 0,
                page_size: 10000,
            });
            if (res?.code !== ApiSdsTrace.C_OK) return roots;
            const locationBySdsCode = buildSdsLocationMapFromTree(roots);
            const rows = res.data?.rows || [];
            const normalRows = rows.filter((row: any) => !isChangeTraceRow(row));
            const changeRows = rows.filter((row: any) => isChangeTraceRow(row));
            const table = buildTraceTableFromRows(normalRows, locationBySdsCode);
            const changeExtraTables = buildTraceChangeExtraTables(changeRows, locationBySdsCode);
            let traceTableApplied = false;
            const updateNodes = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => {
                if (!isTraceTableNode(node)) {
                    const children = updateNodes((node.children || []) as TreeNode[]);
                    return { ...node, children };
                }
                const shouldApplyTraceTable = !traceTableApplied;
                traceTableApplied = true;
                const children = updateNodes((node.children || []) as TreeNode[]);
                const nextChildren = children.filter((child) => !hasRenderableTraceTableChild(child));
                if (!shouldApplyTraceTable) {
                    return {
                        ...node,
                        ref_type: "",
                        table: {} as any,
                        children: nextChildren,
                    };
                }
                const traceTable = {
                    ...(table as any),
                    extra_tables: changeExtraTables,
                    trace_synced: true,
                };
                return {
                    ...node,
                    ref_type: "",
                    table: traceTable as any,
                    children: nextChildren,
                };
            });
            return updateNodes(roots);
        } catch (error) {
            console.error("同步设计与需求追溯表失败:", error);
            return roots;
        }
    };

    const hasRenderableTraceTableChild = (node: TreeNode) => {
        const title = String(node.title || "")
            .trim()
            .replace(/^\d+(?:\.\d+)*\.?\s*/, "");
        const table = node.table as any;
        const hasTable = !!(table && Array.isArray(table.headers) && table.headers.length > 0);
        return hasTable && (
            /^导入表格\d*$/i.test(title) ||
            /变更需求\d*$/.test(title) ||
            /设计与需求追溯/.test(title)
        );
    };

    const renderMergedCell = (children: any, row: any) => ({
        children,
        props: {
            rowSpan: row._rowSpan,
        },
    });

    // 加载需求追溯表数据
    const loadTraceListData = async () => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId) {
            return;
        }
        const currentTree = (((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) || []) as TreeNode[];
        if (!isTraceSyncedOnTree(currentTree)) {
            message.warning("请先点击「获取SRS追溯」");
            return;
        }
        dispatch({ traceListLoading: true });
        ApiSdsTrace.list_sds_trace({
            doc_id: docId,
            page_index: 0,
            page_size: 10000,
            from_sync: 1,
        }).then((res: any) => {
            if (res.code === ApiSdsTrace.C_OK) {
                const rows = res.data?.rows || [];
                const tableData = rows.map((item: any, index: number) => ({
                    key: item.id || `trace_${index}_${Date.now()}`,
                    id: item.id,
                    doc_id: item.doc_id,
                    srs_code: item.srs_code || "",
                    sds_code: item.sds_code || "",
                    chapter: resolveReqChapter(item) || item.chapter || "",
                    location: item.location || "",
                    product_name: item.product_name || "",
                    product_version: item.product_version || "",
                    doc_version: item.doc_version || "",
                }));
                dispatch({ traceListData: expandTraceRows(tableData), traceListLoading: false });
            } else {
                message.error(res.msg || "加载需求追溯表数据失败");
                dispatch({ traceListData: [], traceListLoading: false });
            }
        }).catch((error: any) => {
            console.error("加载需求追溯表数据失败:", error);
            message.error("加载需求追溯表数据失败");
            dispatch({ traceListData: [], traceListLoading: false });
        });
    };

    const doSave = () => {
        editForm.validateFields().then((values) => {
            const currentTree = (((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) || []) as TreeNode[];
            // 包含变更说明
            const submitData = {
                ...values,
                change_description: data.changeDescription,
                tree_structure: currentTree,
            };
            dispatch({ loading: true });
            const fn_request = data.isEdit ? Api.update_sds_doc : Api.add_sds_doc;
            fn_request(submitData).then((res: any) => {
                if (res.code === Api.C_OK) {
                    dispatch({ loading: false });
                    message.success(res.msg);
                    navigate("/sds_docs");
                } else {
                    dispatch({ loading: false });
                    message.error(res.msg);
                }
            });
        });
    };

    const handleExport = () => {
        if (!data.isEdit || !params.id) {
            message.warning(ts("sds_doc.please_save_document_first"));
            return;
        }
        dispatch({ exporting: true });
        Api.export_sds_doc({ id: params.id }).then((res: any) => {
            dispatch({ exporting: false });
            if (res.code !== Api.C_OK) {
                message.error(res.msg);
            }
        });
    };

    const handleInitTemplate = () => {
        const load = async () => {
            await handleLoadStandardNode();
        };
        if (params.id && data.isEdit) {
            Modal.confirm({
                title: ts("sds_doc.init_template"),
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
            id: Date.now() + Math.floor(Math.random() * 1000), // 前端临时ID
            doc_id: params.id ? parseInt(params.id) : 0,
            n_id: 0, // 新节点，后端生成
            p_id: 0, // 根节点，无父节点
            title: "新章节",
            img_url: undefined,
            text: "",
            table: {},
            children: []
        };

        const nextTree = [...data.treeStructure, newNode];
        treeStructureRef.current = nextTree as TreeNode[];
        dispatch({ treeStructure: nextTree });
    };

    // 加载标准结构
    const handleLoadStandardNode = async () => {
        if (!editForm.getFieldValue("product_id")) {
            message.warning(ts("sds_doc.please_select_product_and_version"));
            return;
        }

        const productId = editForm.getFieldValue("product_id");
        const version = editForm.getFieldValue("version");
        let nodesWithIds = applyProductScopeToTree(buildStandardNodesWithIds(), currentProduct).nodes;
        nodesWithIds = rebindFlowImageToFlowChild(nodesWithIds);
        nodesWithIds = normalizeImageRefTypes(nodesWithIds);
        nodesWithIds = await remapRefTypeImagesByProduct(nodesWithIds, productId, version);
        treeStructureRef.current = nodesWithIds;
        dispatch({ treeStructure: nodesWithIds, traceTreeRefreshKey: Date.now() });
        message.success(ts("sds_doc.load_standard_structure_success"));
    };

    // 删除节点
    const handleNodeDelete = async (docId: number, nodeId: number): Promise<boolean> => {
        try {
            const res = await Api.delete_sds_node({ doc_id: docId, n_id: nodeId });
            if (res.code === Api.C_OK) {
                message.success(ts("delete") + ts("save_success"));
                return true;
            } else {
                message.error(res.msg || ts("delete") + ts("save_failed"));
                return false;
            }
        } catch (error) {
            message.error(ts("delete") + ts("save_failed"));
            console.error("删除节点失败:", error);
            return false;
        }
    };

    // 清理树节点数据，确保符合后端接口要求
    const isImportedTablePlaceholderTitle = (value?: string) => /^导入表格\d*$/.test(String(value || "").trim());
    const isJsonLikeKeyValueLine = (value?: string): boolean => {
        const txt = String(value || "").trim();
        if (!txt) return false;
        return /^['"]\s*[^'"]+\s*['"]\s*:\s*.+$/.test(txt);
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
        if (!left || !right) return false;
        return txt === `${left}: ${right}` || txt === `${left}:${right}` || txt === `${left}：${right}`;
    };
    const inferTableTitleForPersist = (node: TreeNode): string => {
        if (!hasRenderableTable((node as any).table)) return "";
        // 仅在文本中存在“明确表名行”时回填，避免把字段值误识别成表名
        const lines = String((node as any).text || "")
            .replace(/\r/g, "")
            .split("\n")
            .map((line) => String(line || "").trim())
            .filter(Boolean);
        const candidate = lines.find((line) => isLikelyTableCaptionLineForPersist(line) && !/^图\s*\d+/i.test(line)) || "";
        if (candidate) return candidate;
        return "";
    };
    const isLikelyTableCaptionLineForPersist = (line?: string) => {
        const txt = String(line || "").trim();
        if (!txt) return false;
        // JSON 键值行不是表题（如 "code":0, / "filename":"x.zip"）
        if (isJsonLikeKeyValueLine(txt)) return false;
        if (/^(表|table)\s*\d+/i.test(txt)) return true;
        if (/^图\s*\d+/i.test(txt)) return false;
        if (/.+表\s*[:：]?$/.test(txt)) return true;
        if (/^[A-Za-z][A-Za-z0-9_]{1,64}[:：]\s*.+$/.test(txt)) return true;
        if (/[:：]/.test(txt) && txt.length <= 80 && !/[。！？]$/.test(txt)) {
            const parts = txt.split(/[:：]/).map((p) => String(p || "").trim());
            const left = parts[0] || "";
            const right = parts.slice(1).join("").trim();
            const leftIsIdentifier = /^[A-Za-z][A-Za-z0-9_]{1,64}$/.test(left);
            if (left && right && (leftIsIdentifier || /表/.test(left))) return true;
            if (left && !right && /表/.test(left)) return true;
            return false;
        }
        return false;
    };
    const bindTableCaptionsForPersist = (roots: TreeNode[]): TreeNode[] => {
        const walk = (nodes: TreeNode[]): TreeNode[] => {
            return (nodes || []).map((node) => {
                const nextChildren = walk((node.children || []) as TreeNode[]);
                const tableChildIdx = nextChildren
                    .map((child, idx) => ({ child, idx }))
                    .filter(({ child }) => hasRenderableTable((child as any).table));
                let nextText = String(node.text || "");
                if (tableChildIdx.length > 0) {
                    const lines = nextText.replace(/\r/g, "").split("\n");
                    const captions = lines
                        .map((line, idx) => ({ idx, txt: String(line || "").trim() }))
                        .filter((item) => isLikelyTableCaptionLineForPersist(item.txt));
                    if (captions.length > 0) {
                        const used = new Set<number>();
                        tableChildIdx.forEach(({ idx }, order) => {
                            const cap = captions[order];
                            if (!cap?.txt) return;
                            if (isJsonLikeKeyValueLine(cap.txt)) return;
                            const child = nextChildren[idx];
                            const titleTxt = String(child.title || "").trim();
                            if (!titleTxt || isImportedTablePlaceholderTitle(titleTxt)) {
                                // 表名用于表格展示，不塞进“菜单标题”输入框
                                nextChildren[idx] = { ...child, label: cap.txt };
                            }
                            used.add(cap.idx);
                        });
                        if (used.size > 0) {
                            nextText = lines
                                .filter((_line, idx) => !used.has(idx))
                                .map((line) => String(line || "").trim())
                                .filter(Boolean)
                                .join("\n");
                        }
                    }
                }
                let nextLabel = String((node as any).label || "").trim();
                if (isLikelyWrongFieldCaption(nextLabel, (node as any).table)) {
                    nextLabel = "";
                }
                if (isJsonLikeKeyValueLine(nextLabel)) {
                    nextLabel = "";
                }
                if (hasRenderableTable((node as any).table) && !nextLabel) {
                    const inferred = inferTableTitleForPersist(node);
                    if (inferred) nextLabel = inferred;
                }
                return { ...node, ...(nextLabel ? { label: nextLabel } : {}), text: nextText, children: nextChildren };
            });
        };
        return walk((roots || []) as TreeNode[]);
    };

    const cleanTreeNode = (node: any, docId: number = 0, parentId: number = 0): any => {
        // 处理 table 数据：
        // - 如果是 null、空对象、或 headers 无效，设置为空对象 {}
        // - 只要有有效 headers，且存在 rows 或 cells 结构，就保留
        let tableValue: any = {};
        if (node.table) {
            const hasValidHeaders = node.table.headers && Array.isArray(node.table.headers) && node.table.headers.length > 0;
            const hasValidRows = node.table.rows && Array.isArray(node.table.rows) && node.table.rows.length > 0;
            const hasValidCells = node.table.cells && Array.isArray(node.table.cells) && node.table.cells.length > 1;
            if (hasValidHeaders && (hasValidRows || hasValidCells)) {
                tableValue = node.table;
            }
        }

        const cleaned: any = {
            doc_id: node.doc_id || docId || 0,
            n_id: (typeof node.id === 'string' || !node.n_id) ? 0 : node.n_id, // 新节点的n_id为0，让后端生成
            p_id: node.p_id || parentId || 0,
            title: node.title || "",
            ...(node.label !== undefined && { label: node.label ?? "" }),
            // 有 sds_code 字段则一并提交
            ...(node.sds_code !== undefined && { sds_code: node.sds_code ?? "" }),
            ...(node.ref_type !== undefined && { ref_type: node.ref_type }),
            img_url: node.img_url || "",
            text: node.text || "",
            table: tableValue,
            children: [] // 初始化为空数组，下面会填充
        };

        // 递归清理子节点，传递当前节点的n_id作为子节点的p_id
        if (node.children && Array.isArray(node.children)) {
            cleaned.children = node.children.map((child: any) =>
                cleanTreeNode(child, docId, cleaned.n_id)
            );
        }

        return cleaned;
    };

    // 保存目录结构
    const handleSaveTreeStructure = () => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId) {
            editForm.validateFields().then(() => {
                doSaveTreeStructure();
            }).catch(() => {
                message.error(ts("sds_doc.version_required"));
            });
            return;
        }
        doSaveTreeStructure();
    };

    const doSaveTreeStructure = () => {
        const productId = editForm.getFieldValue("product_id");
        const srsdocId = editForm.getFieldValue("srsdoc_id");
        const version = editForm.getFieldValue("version");
        if (!productId) {
            message.error(ts("sds_doc.please_select_product_required"));
            return;
        }
        if (!srsdocId) {
            message.error(ts("sds_doc.please_select_req_doc_required"));
            return;
        }
        dispatch({ saving: true });
        const docId = params.id ? parseInt(params.id) : 0;

        // 清理树状结构数据，传入文档ID和根节点的父ID（0表示无父节点）
        const currentTree = (((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) || []) as any[];
        const normalizedTree = currentTree as TreeNode[];
        const cleanedContent = normalizedTree.map((node: any) =>
            cleanTreeNode(node, docId, 0)
        );

        const payload = {
            id: docId,
            product_id: productId,
            srsdoc_id: srsdocId,
            version: version,
            file_no: editForm.getFieldValue("file_no"),
            change_log: data.changeDescription || "",
            content: cleanedContent,
            n_id: data.docNId || 0, // 文档级别的 n_id，编辑时使用从后端获取的值，新增时为0
        };
        console.log(payload);

        // 根据是否有 id 判断是新增还是更新
        const apiCall = params.id
            ? Api.update_sds_doc(payload)
            : Api.add_sds_doc(payload);

        apiCall.then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                message.success(ts("save_success"));
                // 如果是新增，跳转到编辑页面
                if (!params.id && res.data?.id) {
                    navigate(`/sds_docs/edit/${res.data.id}`, { replace: true });
                } else if (params.id) {
                    // 如果是编辑，重新加载数据以获取后端生成的新 n_id
                    Api.get_sds_doc({ id: params.id }).then(async (reloadRes: any) => {
                        if (reloadRes.code === Api.C_OK) {
                            const targetRow = reloadRes.data;

                            // 更新表单数据
                            editForm.setFieldsValue({
                                id: targetRow.id,
                                product_id: targetRow.product_id,
                                srsdoc_id: targetRow.srsdoc_id || undefined,
                                version: targetRow.version,
                                file_no: targetRow.file_no,
                            });

                            // 如果有产品ID，加载需求文档列表
                            if (targetRow.product_id) {
                                loadSrsDocList(targetRow.product_id);
                            }

                            const parsedTree = (targetRow.content || []).map((node: any) => parseTreeNode(node));
                            // 严格按 Word 导入层级展示：不做前端二次“章节重排/补号/拆分”
                            const parsedTreeForView = isReadOnly
                                ? relocateReviewTablesToStandalonePage(parsedTree)
                                : normalizeEditRootChapterNumbers(parsedTree);
                            const flowReboundTree = rebindFlowImageToFlowChild(parsedTreeForView);
                            const normalizedRefTree = normalizeImageRefTypes(flowReboundTree);
                            const parsedContent = isReadOnly
                                ? bindTableCaptionsForPersist(normalizedRefTree)
                                : normalizedRefTree;
                            const remappedContent = await remapRefTypeImagesByProduct(parsedContent, targetRow.product_id, targetRow.version);
                            const ensuredReqdContent = await syncMissingReqdNodes(
                                ensureFrontMatterTables(remappedContent as TreeNode[]),
                                targetRow.id || (params.id ? parseInt(params.id) : undefined)
                            );
                            const ensuredContent = isTraceSyncedOnTree(ensuredReqdContent as TreeNode[])
                                ? await syncTraceTableNodes(
                                    ensuredReqdContent as TreeNode[],
                                    targetRow.id || (params.id ? parseInt(params.id) : undefined)
                                )
                                : ensuredReqdContent as TreeNode[];
                            dispatch({
                                changeDescription: targetRow.change_log || "",
                                docNId: targetRow.n_id || 0,
                                treeStructure: ensuredContent,
                                requireRebindSrs: !targetRow.srsdoc_id,
                            });
                            treeStructureRef.current = ensuredContent;

                        }
                    });
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
    const isCoverTable = (node: TreeNode) => {
        const txt = getTableText(node);
        return hitCount(txt, ["编制科室", "编制部门", "文件版本", "编制人", "审核人", "批准人", "生效日期"]) >= 3;
    };
    const isChangeLogTable = (node: TreeNode) => {
        const txt = getTableText(node);
        return hitCount(txt, ["修改日期", "版本号", "修订说明", "修订人", "批准人"]) >= 3;
    };
    const isCatalogNode = (node: TreeNode) => normalizeText(node.title).includes("目录");
    const isCoverNode = (node: TreeNode) => normalizeText(node.title).includes("软件详细设计") || isCoverTable(node);
    const isChangeLogNode = (node: TreeNode) => normalizeText(node.title).includes("文件修订记录") || isChangeLogTable(node);
    const subtreeMatches = (node: TreeNode, matchFn: (n: TreeNode) => boolean): boolean => {
        if (matchFn(node)) return true;
        return (node.children || []).some((child) => subtreeMatches(child, matchFn));
    };
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
    const coverRoot = treeRoots.find((node) => normalizeText(node.title).includes("软件详细设计"));
    const changeLogRoot = treeRoots.find((node) => normalizeText(node.title).includes("文件修订记录"));
    const coverRoots = coverRoot ? [coverRoot] : treeRoots.filter((node) => subtreeMatches(node, isCoverNode));
    const changeLogRoots = changeLogRoot ? [changeLogRoot] : treeRoots.filter((node) => subtreeMatches(node, isChangeLogNode));
    const hiddenNodeIds = treeRoots
        .filter((node) => isCatalogNode(node) || subtreeMatches(node, isCoverNode) || subtreeMatches(node, isChangeLogNode))
        .flatMap((node) => collectSubtreeIds(node));

    const updateExtractedTableCell = (targetNodeId: number, rowIndex: number, colCode: string, value: string) => {
        const updateNode = (nodes: TreeNode[]): TreeNode[] => {
            return (nodes || []).map((node) => {
                const isTarget = String(node.id) === String(targetNodeId) || String(node.n_id || "") === String(targetNodeId);
                if (isTarget && node.table?.rows) {
                    const nextRows = [...node.table.rows];
                    while (nextRows.length <= rowIndex) {
                        nextRows.push({});
                    }
                    const currentRow = { ...(nextRows[rowIndex] || {}) };
                    currentRow[colCode] = value;
                    nextRows[rowIndex] = currentRow;
                    return {
                        ...node,
                        table: {
                            ...node.table,
                            rows: nextRows,
                        },
                    };
                }
                return {
                    ...node,
                    children: updateNode(node.children || []),
                };
            });
        };
        const nextTree = updateNode(data.treeStructure as TreeNode[]);
        treeStructureRef.current = nextTree;
        dispatch({ treeStructure: nextTree });
    };

    const approvalHeaders = [
        { code: "label1", name: "" },
        { code: "value1", name: "" },
        { code: "label2", name: "" },
        { code: "value2", name: "" },
    ];

    const normalizeApprovalRows = (node: TreeNode) => {
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

    const updateApprovalTableCell = (targetNodeId: number, rowIndex: number, colCode: string, value: string) => {
        const updateNode = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => {
            const isTarget = String(node.id) === String(targetNodeId) || String(node.n_id || "") === String(targetNodeId);
            if (isTarget && node.table) {
                const rows = normalizeApprovalRows(node).map((row: any) => ({ ...row }));
                rows[rowIndex] = { ...(rows[rowIndex] || {}), [colCode]: value };
                return { ...node, table: { ...node.table, headers: approvalHeaders, rows } };
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
                const cur = String((rows[0] || {}).value2 ?? "");
                if (cur !== ver) {
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
                const cur = String((rows[0] || {}).value1 ?? "").trim();
                if (!cur) {
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
                if (rows.length < minRows) {
                    while (rows.length < minRows) {
                        rows.push({ change_date: "", version_no: "", change_desc: "", changer: "", approver: "" });
                    }
                    nextNode = { ...nextNode, table: { ...nextNode.table, rows } as any };
                    changed = true;
                }
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
            signRows.forEach((s: any) => {
                if (s.name && s.sign_img) signMap[String(s.name).trim()] = s.sign_img;
            });
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
            const resolveReviewName = (role: string) => {
                const kws = SDS_REVIEW_ROLE_KWS[role] || [role];
                for (const kw of kws) {
                    const nm = findRole((r) => r.includes(kw));
                    if (nm) return nm;
                }
                return "";
            };
            const coverResult = applySdsCoverRevisionAutofill(data.treeStructure as TreeNode[], {
                coverDate: computeSdsCoverDate(tlRows),
                version: String(displayDocVersion || ""),
                resolveSigner,
                reviser: tpm,
                approver: devLead,
            });
            const reviewResult = applySdsReviewPersonAutofill(coverResult.nodes, {
                coverDate: computeSdsCoverDate(tlRows),
                resolveName: resolveReviewName,
                resolveSign: (name: string) => (name ? (signMap[name] || "") : ""),
                approverName: devLead,
                approverSign: signMap[devLead] || "",
            });
            if (coverResult.changed || reviewResult.changed) {
                treeStructureRef.current = reviewResult.nodes;
                dispatch({ treeStructure: reviewResult.nodes });
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
                        onChange={(e) => updateApprovalTableCell(node.id, rowIndex, header.code, e.target.value)}
                        autoSize={{ minRows: 1, maxRows: 4 }}
                    />
                );
            },
        }));
        const dataSource = normalizeApprovalRows(node).map((row: any, index: number) => ({ key: `${keyPrefix}-row-${index}`, ...row }));
        return (
            <Table
                key={`${keyPrefix}-${node.id}`}
                className={`srs-cover-table srs-approval-table${!isReadOnly ? " srs-extracted-edit-table" : ""}`}
                dataSource={dataSource}
                columns={columns}
                pagination={false}
                size="small"
                bordered
            />
        );
    };

    const renderExtractedTable = (node: TreeNode, keyPrefix: string) => {
        if (!node.table?.headers || !node.table?.rows) return null;
        if (isCoverTable(node)) {
            return renderApprovalTable(node, keyPrefix);
        }
        const isChangeRecordTable = isChangeLogTable(node);
        const normalizedRows = [...(node.table.rows || [])];
        if (isChangeRecordTable) {
            while (normalizedRows.length < 5) {
                normalizedRows.push({});
            }
        }
        const columns = node.table.headers.map((header: any, index: number) => ({
            title: header.name || `列${index + 1}`,
            dataIndex: header.code,
            key: `${keyPrefix}-col-${header.code}`,
            render: (text: string, _record: any, rowIndex: number) => {
                if (isReadOnly) return text || "-";
                return (
                    <Input.TextArea
                        value={text || ""}
                        onChange={(e) => updateExtractedTableCell(node.id, rowIndex, header.code, e.target.value)}
                        autoSize={{ minRows: 1, maxRows: 4 }}
                    />
                );
            },
        }));
        const dataSource = normalizedRows.map((row: any, index: number) => ({ key: `${keyPrefix}-row-${index}`, ...row }));
        return (
            <Table
                key={`${keyPrefix}-${node.id}`}
                className={`${isChangeRecordTable ? "srs-change-log-table" : "srs-cover-table"}${!isReadOnly ? " srs-extracted-edit-table" : ""}`}
                dataSource={dataSource}
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
                    <div className="extracted-item-title">软件详细设计</div>
                    {coverRoots.length > 0
                        ? coverRoots
                            .flatMap((root) => collectTableNodes(root))
                            .filter((node) => isCoverTable(node))
                            .map((node, idx) => renderExtractedTable(node, `cover-${idx}`))
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
                        ? changeLogRoots
                            .flatMap((root) => collectTableNodes(root))
                            .filter((node) => isChangeLogTable(node))
                            .map((node, idx) => renderExtractedTable(node, `change-${idx}`))
                        : <div className="extracted-empty">暂无</div>}
                </div>
            ),
        },
        {
            key: "change_desc",
            title: ts("sds_doc.version_change_description"),
            content: (
                <div className="extracted-doc-section">
                    <div className="doc-section-header">
                        <div className="change-desc-title">
                            {ts("sds_doc.version_change_description")}
                        </div>
                        {!isReadOnly && (
                            <Button
                                type="primary"
                                icon={<EditOutlined />}
                                onClick={handleEditChangeDesc}>
                                {ts("sds_doc.edit_change_description")}
                            </Button>
                        )}
                    </div>
                    <div className={`doc-desc-content ${data.changeDescription ? "has-content" : ""}`}>
                        {data.changeDescription || ts("sds_doc.no_change_description")}
                    </div>
                </div>
            ),
        },
    ];

    return (
        <ConfigProvider theme={SDS_DOC_DETAIL_THEME}>
        <div
            className={`page div-v sds-doc-detail ${isReadOnly ? 'read-only' : ''}`}
            data-sds-build="sds-font-fix-20260421-1"
        >
            <Form
                className="sds-toolbar-form"
                form={editForm}
                onFinish={doSave}
                layout="inline">
                <div className="div-h center-v sds-toolbar">
                    <Form.Item hidden name="id">
                        <Input allowClear />
                    </Form.Item>
                    {(data.isEdit || isReadOnly) && !data.requireRebindSrs ? (
                        <>
                            {isReadOnly ? (
                                <span className="sds-toolbar-meta">
                                    <span className="form-display-label">{ts("sds_doc.current_product")}：</span>
                                    <span className="form-display-value">{productLabel || "-"}</span>
                                </span>
                            ) : (
                                <Form.Item
                                    className="sds-toolbar-item"
                                    label={ts("sds_doc.current_product")}
                                    name="product_id"
                                    rules={[{ required: true, message: "" }]}>
                                    <ProductVersionSelect
                                        products={data.products}
                                        allowClear
                                        namePlaceholder={ts("product.name")}
                                        versionPlaceholder={ts("product.full_version")}
                                        onChange={(value) => {
                                            editForm.setFieldValue("product_id", value);
                                            editForm.setFieldsValue({ srsdoc_id: undefined });
                                            dispatch({ srsDocList: [] });
                                            if (value) loadSrsDocList(value);
                                        }}
                                    />
                                </Form.Item>
                            )}
                            {isReadOnly ? (
                                <span className="sds-toolbar-meta">
                                    <span className="form-display-label">{ts("sds_doc.req_doc")}：</span>
                                    <span className="form-display-value">{srsdocLabel || "-"}</span>
                                </span>
                            ) : (
                                <Form.Item
                                    className="sds-toolbar-item"
                                    label={ts("sds_doc.req_doc")}
                                    name="srsdoc_id"
                                    rules={[{ required: true, message: "" }]}>
                                    <Select
                                        placeholder={ts("sds_doc.please_select_req_doc")}
                                        showSearch
                                        allowClear
                                        optionFilterProp="label"
                                        disabled={!data.srsDocList.length}
                                        style={{ width: 160 }}
                                        options={data.srsDocList.map((item: any) => ({
                                            label: `${item.version || item.full_version || ""}`,
                                            value: item.id,
                                        }))}
                                    />
                                </Form.Item>
                            )}
                            <Form.Item
                                className="sds-toolbar-item"
                                label={(data.isEdit || isReadOnly) ? ts("sds_doc.current_version") : ts("sds_doc.version_label")}
                                name="version"
                                rules={[{ required: !isReadOnly, message: "" }]}>
                                <Input allowClear placeholder={ts("sds_doc.please_input_version")} disabled={isReadOnly} style={{ width: 130 }} />
                            </Form.Item>
                        </>
                    ) : (
                        <>
                            <Form.Item
                                className="sds-toolbar-item"
                                label={ts("sds_doc.product")}
                                name="product_id"
                                rules={[{ required: true, message: "" }]}>
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => {
                                        editForm.setFieldValue("product_id", value);
                                        editForm.setFieldsValue({ srsdoc_id: undefined });
                                        dispatch({ srsDocList: [] });
                                        if (value) loadSrsDocList(value);
                                    }}
                                />
                            </Form.Item>
                            <Form.Item
                                className="sds-toolbar-item"
                                label={ts("sds_doc.req_doc")}
                                name="srsdoc_id"
                                rules={[{ required: true, message: "" }]}>
                                <Select
                                    placeholder={ts("sds_doc.please_select_req_doc")}
                                    showSearch
                                    allowClear
                                    optionFilterProp="label"
                                    disabled={!data.srsDocList.length}
                                    style={{ width: 160 }}
                                    options={data.srsDocList.map((item: any) => ({
                                        label: `${item.version || item.full_version || ""}`,
                                        value: item.id,
                                    }))}
                                />
                            </Form.Item>
                            <Form.Item
                                className="sds-toolbar-item"
                                label={ts("sds_doc.version_label")}
                                name="version"
                                rules={[{ required: true, message: "" }]}>
                                <Input allowClear placeholder={ts("sds_doc.please_input_version")} style={{ width: 130 }} />
                            </Form.Item>
                        </>
                    )}
                    <div className="expand"></div>
                    {!isReadOnly && (
                        <Space>
                            <Button
                                type="primary"
                                icon={<DownloadOutlined />}
                                loading={data.exporting}
                                onClick={handleExport}
                                disabled={!data.isEdit}>
                                {ts("export")}
                            </Button>
                            <Button
                                type="primary"
                                icon={<FileAddOutlined />}
                                onClick={handleInitTemplate}>
                                {ts("sds_doc.init_template")}
                            </Button>
                            <Button
                                type="primary"
                                loading={data.saving}
                                onClick={handleSaveTreeStructure}>
                                {ts("save")}
                            </Button>
                        </Space>
                    )}
                    <Button
                        className="sds-toolbar-back"
                        icon={<ArrowLeftOutlined />}
                        onClick={() => navigate("/sds_docs")}>
                        {ts("back")}
                    </Button>
                </div>
            </Form>
            <div className="div-v detail-content">
                <div className="doc-section doc-section-flex">
                    {!isReadOnly && (
                        <div className="doc-section-header">
                            <div className="doc-section-title">{ts("sds_doc.directory_structure")}</div>
                            <div className="doc-section-buttons">
                                <Button
                                    type="primary"
                                    loading={data.traceSyncing}
                                    onClick={() => fetchSrsTrace()}
                                >
                                    获取SRS追溯
                                </Button>
                            </div>
                        </div>
                    )}
                    <Spin spinning={data.traceSyncing} tip="正在同步 SRS 追溯与章节…">
                    <TreeStructure
                        key={`sds-tree-${params.id || "new"}-${data.traceTreeRefreshKey || 0}`}
                        value={data.treeStructure}
                        onChange={isReadOnly ? undefined : (value) => { treeStructureRef.current = value; }}
                        onNodesSnapshot={(nodes) => {
                            treeStructureRef.current = nodes || [];
                        }}
                        docId={params.id ? parseInt(params.id) : undefined}
                        hiddenNodeIds={hiddenNodeIds}
                        extraNavSections={coverExtraNavSections}
                        onAddRoot={isReadOnly ? undefined : handleAddRootNode}
                        onNodeDelete={isReadOnly ? undefined : handleNodeDelete}
                        readOnly={isReadOnly}
                        readOnlyChapterOffset={0}
                        readOnlyRootWrapper={false}
                        onOpenReqdList={() => {
                            loadReqdListData();
                            dispatch({ showReqdListModal: true });
                        }}
                        onOpenTraceList={() => {
                            const tree = (treeStructureRef.current || data.treeStructure || []) as TreeNode[];
                            if (!isTraceSyncedOnTree(tree)) {
                                fetchSrsTrace({ openModal: true });
                                return;
                            }
                            loadTraceListData();
                            dispatch({ showTraceListModal: true });
                        }}
                        onFetchSrsTrace={() => fetchSrsTrace()}
                        traceSynced={isTraceSyncedOnTree((treeStructureRef.current || data.treeStructure || []) as TreeNode[])}
                    />
                    </Spin>
                </div>
            </div>

            {/* 编辑版本变更说明的Modal */}
            <Modal
                title={ts("sds_doc.version_change_description")}
                open={data.showChangeDescModal}
                onOk={handleSaveChangeDesc}
                onCancel={handleCancelChangeDesc}
                okText={ts("save")}
                cancelText={ts("cancel")}
                width={600}>
                <div className="change-desc-modal">
                    <div className="change-desc-label">{ts("sds_doc.change_description_label")}</div>
                    <Input.TextArea
                        className="change-desc-textarea"
                        rows={6}
                        placeholder={ts("sds_doc.please_input_change_description")}
                        value={data.tempChangeDescription}
                        onChange={(e) => {
                            dispatch({ tempChangeDescription: e.target.value });
                        }}
                    />
                </div>
            </Modal>

            {/* 设计列表弹框 */}
            <Modal
                className="reqd-list-modal"
                title={ts("menu.sds_reqds") || "设计列表"}
                open={data.showReqdListModal}
                onCancel={() => dispatch({ showReqdListModal: false })}
                footer={null}
                width={1400}
                styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}>
                <Table
                    dataSource={data.reqdListData}
                    columns={[
                        {
                            title: ts("srs_req.code") || "需求编号",
                            dataIndex: "req_id",
                            width: 180,
                            onHeaderCell: () => ({ style: { minWidth: 180 } }),
                            onCell: () => ({ style: { minWidth: 180 } }),
                            render: (t: any) => t || "-",
                        },
                        {
                            title: ts("sds_reqd.name") || "需求名称",
                            dataIndex: "name",
                            width: 180,
                            onHeaderCell: () => ({ style: { minWidth: 180 } }),
                            onCell: () => ({ style: { minWidth: 180 } }),
                            render: (t: any) => t || "-",
                        },
                        { title: ts("sds_reqd.overview") || "总体描述", dataIndex: "overview", width: 200, render: (t: string) => (t ? renderOneLineWithTooltip(t, { emptyText: "" }) : "-") },
                        { title: ts("sds_reqd.func_detail") || "功能", dataIndex: "func_detail", width: 200, render: (t: string) => (t ? renderOneLineWithTooltip(t, { emptyText: "" }) : "-") },
                        { title: ts("sds_reqd.logic_txt") || "逻辑文本", dataIndex: "logic_txt", width: 200, render: (t: string) => t ? <span style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{t}</span> : "-" },
                        {
                            title: ts("sds_reqd.logic_img") || "逻辑图",
                            dataIndex: "logic_img",
                            width: 160,
                            render: (t: string) => {
                                const img = normalizeImgUrl(t);
                                if (!img) return "/";
                                return <img src={img} alt="logic" style={{ maxWidth: 140, maxHeight: 80, objectFit: "contain" }} />;
                            },
                        },
                        { title: ts("sds_reqd.intput") || "输入项", dataIndex: "intput", width: 200, render: (t: string) => (t ? renderOneLineWithTooltip(t, { emptyText: "" }) : "-") },
                        { title: ts("sds_reqd.output") || "输出项", dataIndex: "output", width: 200, render: (t: string) => (t ? renderOneLineWithTooltip(t, { emptyText: "" }) : "-") },
                        { title: ts("sds_reqd.interface") || "接口", dataIndex: "interface", width: 200, render: (t: string) => (t ? renderOneLineWithTooltip(t, { emptyText: "" }) : "-") },
                    ]}
                    rowKey="key"
                    pagination={false}
                    loading={data.reqdListLoading}
                    scroll={{ x: 1600 }}
                />
            </Modal>

            {/* 需求追溯表弹框 */}
            <Modal
                className="trace-list-modal"
                title={ts("menu.sds_traces") || "需求追溯表"}
                open={data.showTraceListModal}
                onCancel={() => dispatch({ showTraceListModal: false })}
                footer={null}
                width={720}>
                <Table
                    dataSource={data.traceListData}
                    columns={[
                        { title: ts("sds_trace.srs_code") || "SRS编号", dataIndex: "srs_code", width: 120, render: (t: string, row: any) => renderMergedCell(t || "-", row) },
                        { title: ts("sds_trace.sds_code") || "SDS编号", dataIndex: "sds_code", width: 120, render: (t: string) => t ? <span style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{t}</span> : "-" },
                        { title: ts("sds_trace.chapter") || "需求代码", dataIndex: "chapter", width: 220, render: (t: string) => t ? <span style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{t}</span> : "-" },
                        { title: ts("sds_trace.location") || "章节号", dataIndex: "location", width: 120, render: (t: string) => t ? <span style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{t}</span> : "-" },
                    ]}
                    rowKey="key"
                    pagination={false}
                    loading={data.traceListLoading}
                    bordered
                    scroll={{ x: 680 }}
                />
            </Modal>
        </div>
        </ConfigProvider>
    );
};
