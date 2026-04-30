import "./SdsDocDetail.less";
import { ConfigProvider, Form, Input, Button, message, Select, Row, Col, Modal, Space, Table } from "antd";
import { ArrowLeftOutlined, EditOutlined, DownloadOutlined, FileAddOutlined, PlusOutlined } from "@ant-design/icons";
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
import TreeStructure, { TreeNode } from "./components/TreeStructure";

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
                    ? (currentUrl || "")
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
    const displayProductId = (data.isEdit || isReadOnly) ? (data.docProductId ?? productId) : productId;
    const displaySrsdocId = (data.isEdit || isReadOnly) ? (data.docSrsdocId ?? srsdocId) : srsdocId;
    const currentProduct = (data.products as any[]).find((p: any) => p.id === displayProductId);
    const productLabel = currentProduct ? `${currentProduct.name}-${currentProduct.full_version}` : "";
    const currentSrsdoc = (data.srsDocList as any[]).find((s: any) => s.id === displaySrsdocId);
    const srsdocLabel = currentSrsdoc ? (currentSrsdoc.version || currentSrsdoc.full_version || "") : "";
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
    // 将后端数据转换为前端格式
    const parseTreeNode = (node: any): TreeNode => {
        const fallbackFromText = extractSdsCodeFromText(node.text);
        const hasExplicitSdsCodeField = node.sds_code !== undefined;
        const explicitSdsCode = String(node.sds_code ?? "").trim();
        const resolvedSdsCode = explicitSdsCode || fallbackFromText.code || "";
        const shouldStripCodeLineFromText = !!fallbackFromText.code && !explicitSdsCode;
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
                (Array.isArray(node.table.cells) && node.table.cells.length > 1)
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
            text: (shouldStripCodeLineFromText ? fallbackFromText.nextText : (node.text || "")),
            // 处理 table：有表头且存在行或单元格结构时保留（避免 rows 为空时误丢合并单元格表格）
            table: (hasValidHeaders && hasRowOrCellContent) ? node.table : {},
            children: (node.children || []).map((child: any) => parseTreeNode(child))
        };
    };

    const normalizePlain = (value?: string) => String(value || "").replace(/\s+/g, "").toLowerCase();
    const stripTitlePrefixMarks = (value?: string) => String(value || "").replace(/^[\s\u3000•·▪■◆●○□◇\-–—]+/, "").trim();
    const IMPORTED_PLACEHOLDER_RE = /^导入(表格|图片)\d*$/;
    const HEADING_NUM_RE = /^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/;
    const TABLE_CAPTION_RE = /^\s*(?:表|table)\s*\d+(?:[.\-_]\d+)*\s*[:：、.．-]?\s*.*$/i;
    const JSON_KV_LINE_RE = /^\s*['"]\s*[^'"]+\s*['"]\s*:\s*.+$/;
    const hasChapterTitle = (title?: string) => /^\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))\S+/.test(stripTitlePrefixMarks(title));
    const hasRenderableTable = (table: any): boolean => {
        if (!table || !Array.isArray(table.headers) || table.headers.length === 0) return false;
        const hasRows = Array.isArray(table.rows) && table.rows.length > 0;
        const hasCells = Array.isArray(table.cells) && table.cells.length > 1;
        return hasRows || hasCells;
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
        const hasChapterPrefix = /^\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/.test(rawTitle);
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
                .replace(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
                .replace(/\s+/g, "");
        const isFrontMatterTitle = (title?: string) =>
            /^(目录|需求规格说明|文件修订记录|软件详细设计说明书|软件详细设计)$/.test(normalizeBusinessTitle(title));
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
    const normalizeTraceMatchText = (value?: string) => String(value || "")
        .replace(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
        .replace(/^[（(]?\s*(?:\d+|[一二三四五六七八九十]+)\s*[）)]?/, "")
        .replace(/[\s\u3000:：，,。；;、()（）【】\[\]/\\\-_.]+/g, "")
        .toLowerCase();
    const applySdsCodesFromTraceRows = (roots: TreeNode[], traceRows: any[]): TreeNode[] => {
        if (isReadOnly || !Array.isArray(roots) || roots.length === 0 || !Array.isArray(traceRows) || traceRows.length === 0) return roots;
        const codeByLocation = new Map<string, string>();
        const codeByName = new Map<string, string>();
        traceRows.forEach((row: any) => {
            const sdsCode = String(row?.sds_code || "").trim();
            if (!sdsCode) return;
            const location = String(row?.location || "").trim();
            if (location && !codeByLocation.has(location)) {
                codeByLocation.set(location, sdsCode);
            }
            [row?.chapter, row?.name, row?.sub_function, row?.function, row?.module]
                .map((item) => normalizeTraceMatchText(String(item || "")))
                .filter(Boolean)
                .forEach((key) => {
                    if (!codeByName.has(key)) codeByName.set(key, sdsCode);
                });
        });
        if (codeByLocation.size === 0 && codeByName.size === 0) return roots;
        const findMatchedCode = (node: TreeNode): string => {
            const title = String(node.title || "").trim();
            const headingNo = parseHeadingNumber(title) || "";
            const nameKey = normalizeTraceMatchText(title);
            return (headingNo && codeByLocation.get(headingNo)) || (nameKey && codeByName.get(nameKey)) || "";
        };
        const subtreeHasMatchedCode = (nodes: TreeNode[], code: string): boolean => {
            if (!code) return false;
            return (nodes || []).some((child) => {
                if (findMatchedCode(child) === code) return true;
                return subtreeHasMatchedCode((child.children || []) as TreeNode[], code);
            });
        };
        const walk = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node) => {
            const children = walk((node.children || []) as TreeNode[]);
            const currentCode = String((node as any).sds_code ?? "").trim();
            if (currentCode) {
                return { ...node, children };
            }
            const matchedCode = findMatchedCode(node);
            if (!matchedCode || subtreeHasMatchedCode(children, matchedCode)) {
                return { ...node, children };
            }
            return {
                ...node,
                sds_code: matchedCode,
                children,
            };
        });
        return walk(roots);
    };
    const hydrateSdsCodesFromTrace = async (roots: TreeNode[], docId?: number): Promise<TreeNode[]> => {
        if (isReadOnly || !docId || !Array.isArray(roots) || roots.length === 0) return roots;
        try {
            const res: any = await ApiSdsTrace.list_sds_trace({
                doc_id: docId,
                page_index: 0,
                page_size: 10000,
                _ts: Date.now(),
            });
            if (res?.code !== ApiSdsTrace.C_OK) return roots;
            return applySdsCodesFromTraceRows(roots, res?.data?.rows || []);
        } catch (error) {
            console.error("加载需求追溯表回填SDS编号失败:", error);
            return roots;
        }
    };
    const stripHeadingPrefix = (value?: string): string => {
        return String(value || "")
            .trim()
            .replace(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z"']))/, "")
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
            .replace(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
        );
        const pureTitle = pureTitleRaw.replace(/\s+/g, "");
        const pureTitleWithoutTrailingColon = pureTitle.replace(/[:：]+$/, "");
        if (/^(目录|需求规格说明|文件修订记录|软件详细设计说明书|软件详细设计)$/.test(pureTitle)) return false;
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
            .replace(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z"']))/, "")
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
                .replace(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
                .replace(/\s+/g, "");
        const isFrontMatterTitle = (title?: string) => {
            const t = normalizeBusinessTitle(title);
            return /^(目录|需求规格说明|文件修订记录|软件详细设计说明书|软件详细设计)$/.test(t);
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
                    const plain = rawTitle.replace(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "").trim();
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
                .map((title) => title.replace(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "").trim())
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
            const hasChapterLikeTitle = /^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/.test(title);
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
                .replace(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
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
                return {
                    ...node,
                    ref_type: guessedRefType || (keepExistingRefType ? node.ref_type : undefined),
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
                { code: "dept", name: "编制科室" },
                { code: "version", name: "文件版本" },
                { code: "author", name: "编制人" },
                { code: "reviewer", name: "审核人" },
                { code: "approver", name: "批准人" },
                { code: "effective_date", name: "生效日期" },
            ],
            rows: [{ dept: "", version: "", author: "", reviewer: "", approver: "", effective_date: "" }],
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
            rows: [{ change_date: "", version_no: "", change_desc: "", changer: "", approver: "" }],
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
                if (title.includes("软件详细设计")) hasCover = true;
                if (title.includes("文件修订记录")) hasChange = true;
                if (getTableHitCount(node, ["编制科室", "文件版本", "编制人", "审核人", "批准人", "生效日期"]) >= 3) hasCover = true;
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
        const addIdsToNodes = (nodes: any[]): TreeNode[] => {
            return nodes.map((node) => ({
                ...node,
                id: generateTempNodeId(),
                children: node.children ? addIdsToNodes(node.children) : [],
            }));
        };
        return ensureFrontMatterTables(addIdsToNodes(standardNodes as any[]));
    };

    const cloneTree = (nodes: TreeNode[]): TreeNode[] => JSON.parse(JSON.stringify(nodes || []));

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
                    const ensuredContent = await hydrateSdsCodesFromTrace(
                        ensureFrontMatterTables(remappedContent as TreeNode[]),
                        targetRow.id || (params.id ? parseInt(params.id) : undefined)
                    );

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
                    const ensuredContent = await hydrateSdsCodesFromTrace(
                        ensureFrontMatterTables(remappedContent as TreeNode[]),
                        latestRow.id || docId
                    );
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

    const expandTraceRows = (rows: any[]) => {
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
                location: locations[index] ?? "",
                _splitIndex: index,
                _rowSpan: index === 0 ? count : 0,
            }));
        });
    };

    const renderMergedCell = (children: any, row: any) => ({
        children,
        props: {
            rowSpan: row._rowSpan,
        },
    });

    // 加载需求追溯表数据
    const loadTraceListData = () => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId) {
            return;
        }
        dispatch({ traceListLoading: true });
        ApiSdsTrace.list_sds_trace({
            doc_id: docId,
            page_index: 0,
            page_size: 10000,
        }).then((res: any) => {
            if (res.code === ApiSdsTrace.C_OK) {
                const rows = res.data?.rows || [];
                const tableData = rows.map((item: any, index: number) => ({
                    key: item.id || `trace_${index}_${Date.now()}`,
                    id: item.id,
                    doc_id: item.doc_id,
                    srs_code: item.srs_code || "",
                    sds_code: item.sds_code || "",
                    chapter: item.chapter || "",
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
            // 包含变更说明
            const submitData = {
                ...values,
                change_description: data.changeDescription,
                tree_structure: data.treeStructure,
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
        if (params.id && data.isEdit) {
            const originalTree = cloneTree(initialEditTreeRef.current || []);
            if (!originalTree.length) {
                message.warning("暂无可恢复的初始内容，请刷新页面后重试");
                return;
            }
            treeStructureRef.current = originalTree;
            dispatch({ treeStructure: originalTree });
            message.success("已恢复到进入编辑页时的内容");
            return;
        }
        handleLoadStandardNode();
    };

    const handleAddRootNode = () => {
        const newNode: TreeNode = {
            id: Date.now() + Math.floor(Math.random() * 1000), // 前端临时ID
            doc_id: params.id ? parseInt(params.id) : 0,
            n_id: 0, // 新节点，后端生成
            p_id: 0, // 根节点，无父节点
            title: "",
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
    const handleLoadStandardNode = () => {
        if (!editForm.getFieldValue("product_id")) {
            message.warning(ts("sds_doc.please_select_product_and_version"));
            return;
        }

        const nodesWithIds = buildStandardNodesWithIds();
        // dispatch({ treeStructure: [...data.treeStructure, ...nodesWithIds] });
        treeStructureRef.current = nodesWithIds;
        dispatch({ treeStructure: nodesWithIds });
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
                            const ensuredContent = await hydrateSdsCodesFromTrace(
                                ensureFrontMatterTables(remappedContent as TreeNode[]),
                                targetRow.id || (params.id ? parseInt(params.id) : undefined)
                            );
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
    const stripChapterPrefix = (value?: string) =>
        String(value || "")
            .trim()
            .replace(/^[\s\u3000•·▪■◆●○□◇\-–—]*/, "")
            // 先清理标准章节号（1 / 1.2 / 1.2.3）
            .replace(/^([0-9０-９]+(?:[.．][0-9０-９]+)*)(?:[\s、.．\u00a0\u2002\u2003\u2009]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
            // 兜底：清理任意残留前导数字（含全角）
            .replace(/^[0-9０-９]+(?:[\s\u00a0\u2002\u2003\u2009.．、-]*)/, "")
            .trim();
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
        return hitCount(txt, ["编制科室", "文件版本", "编制人", "审核人", "批准人", "生效日期"]) >= 3;
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
    const coverTitle = stripChapterPrefix(coverRoot?.title) || "软件详细设计";

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

    const renderExtractedTable = (node: TreeNode, keyPrefix: string) => {
        if (!node.table?.headers || !node.table?.rows) return null;
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
        const dataSource = (node.table.rows || []).map((row: any, index: number) => ({ key: `${keyPrefix}-row-${index}`, ...row }));
        return (
            <Table
                key={`${keyPrefix}-${node.id}`}
                dataSource={dataSource}
                columns={columns}
                pagination={false}
                size="small"
                bordered
                scroll={{ x: Math.max(800, columns.length * 180) }}
            />
        );
    };

    return (
        <ConfigProvider theme={SDS_DOC_DETAIL_THEME}>
        <div
            className={`page div-v sds-doc-detail ${isReadOnly ? 'read-only' : ''}`}
            data-sds-build="sds-font-fix-20260421-1"
        >
            <div className="div-h center-v page-actions searchbar">
                <Button
                    icon={<ArrowLeftOutlined />}
                    onClick={() => navigate("/sds_docs")}>
                    {ts("back")}
                </Button>
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
                        size="large"
                        loading={data.saving}
                        onClick={handleSaveTreeStructure}>
                        {ts("save")}
                    </Button>
                </Space>
                )}
            </div>
            <div className="div-v detail-content">
                <Form
                    className="detail-form"
                    form={editForm}
                    onFinish={doSave}
                    layout="horizontal"
                    labelAlign="left">
                    <Form.Item hidden name="id">
                        <Input allowClear />
                    </Form.Item>
                    {(data.isEdit || isReadOnly) && !data.requireRebindSrs ? (
                        <Row gutter={24} className="form-display-row">
                            <Col span={6}>
                                <span className="form-display-label">{ts("sds_doc.current_product")}：</span>
                                <span className="form-display-value">{productLabel || "-"}</span>
                            </Col>
                            <Col span={6}>
                                <span className="form-display-label">{ts("sds_doc.req_doc")}：</span>
                                <span className="form-display-value">{srsdocLabel || "-"}</span>
                            </Col>
                            <Col span={6}>
                                <Form.Item
                                    label={ts("sds_doc.current_version")}
                                    name="version"
                                    rules={[{ required: !isReadOnly, message: "" }]}>
                                    <Input allowClear placeholder={ts("sds_doc.please_input_version")} disabled={isReadOnly} style={{ width: 200 }} />
                                </Form.Item>
                            </Col>
                        </Row>
                    ) : (
                        <Row gutter={24}>
                            <Col span={6}>
                                <Form.Item
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
                            </Col>
                            <Col span={6}>
                                <Form.Item
                                    label={ts("sds_doc.req_doc")}
                                    name="srsdoc_id"
                                    rules={[{ required: true, message: "" }]}>
                                    <Select
                                        placeholder={ts("sds_doc.please_select_req_doc")}
                                        showSearch
                                        allowClear
                                        optionFilterProp="label"
                                        disabled={!data.srsDocList.length}
                                        options={data.srsDocList.map((item: any) => ({
                                            label: `${item.version || item.full_version || ''}`,
                                            value: item.id
                                        }))}
                                    />
                                </Form.Item>
                            </Col>
                            <Col span={6}>
                                <Form.Item
                                    label={ts("sds_doc.version_label")}
                                    name="version"
                                    rules={[{ required: true, message: "" }]}>
                                    <Input allowClear placeholder={ts("sds_doc.please_input_version")} style={{ width: 200 }} />
                                </Form.Item>
                            </Col>
                        </Row>
                    )}
                </Form>

                <div className="doc-section extracted-doc-section">
                    <div className="doc-section-header">
                        <div className="doc-section-title">封面</div>
                    </div>
                    <div className="extracted-item-title">标题</div>
                    <div className="extracted-file-name">{coverTitle || "-"}</div>
                    <div className="extracted-item-title">封面信息</div>
                    {coverRoots.length > 0
                        ? coverRoots
                            .flatMap((root) => collectTableNodes(root))
                            .filter((node) => isCoverTable(node))
                            .map((node, idx) => renderExtractedTable(node, `cover-${idx}`))
                        : <div className="extracted-empty">暂无</div>}
                    <div className="extracted-item-title">文件修订记录</div>
                    {changeLogRoots.length > 0
                        ? changeLogRoots
                            .flatMap((root) => collectTableNodes(root))
                            .filter((node) => isChangeLogTable(node))
                            .map((node, idx) => renderExtractedTable(node, `change-${idx}`))
                        : <div className="extracted-empty">暂无</div>}
                </div>

                {/* 版本变更说明区域 */}
                <div className="doc-section">
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

                {/* 设计列表区域 - 已改为弹框，由目录节点 ref_type=sds_reqds 的按钮打开 */}
                {/* <div className="doc-section">...</div> */}

                {/* 需求追溯表区域 - 已改为弹框，由目录节点 ref_type=sds_traces 的按钮打开 */}
                {/* <div className="doc-section">...</div> */}

                {/* 目录结构区域 */}
                <div className="doc-section doc-section-flex">
                    <div className="doc-section-header">
                        <div className="doc-section-title">
                            {ts("sds_doc.directory_structure")}
                        </div>
                        {!isReadOnly && (
                        <div className="doc-section-buttons">
                            <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                onClick={handleAddRootNode}>
                                {ts("sds_doc.add_root_menu")}
                            </Button>
                        </div>
                        )}
                    </div>
                    <TreeStructure
                        value={data.treeStructure}
                        onChange={isReadOnly ? undefined : (value) => { treeStructureRef.current = value; }}
                        onNodesSnapshot={(nodes) => {
                            treeStructureRef.current = nodes || [];
                        }}
                        docId={params.id ? parseInt(params.id) : undefined}
                        hiddenNodeIds={hiddenNodeIds}
                        onNodeDelete={isReadOnly ? undefined : handleNodeDelete}
                        readOnly={isReadOnly}
                        readOnlyChapterOffset={0}
                        readOnlyRootWrapper={false}
                        onOpenReqdList={() => {
                            loadReqdListData();
                            dispatch({ showReqdListModal: true });
                        }}
                        onOpenTraceList={() => {
                            loadTraceListData();
                            dispatch({ showTraceListModal: true });
                        }}
                    />
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
