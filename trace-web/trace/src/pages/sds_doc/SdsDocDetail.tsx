import "./SdsDocDetail.less";
import { Form, Input, Button, message, Select, Row, Col, Modal, Space, Table } from "antd";
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
import TreeStructure, { TreeNode } from "./components/TreeStructure";

export default () => {
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
    // 将后端数据转换为前端格式
    const parseTreeNode = (node: any): TreeNode => {
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
            // 保留 sds_code：后端有该字段（含空字符串）则带上
            ...(node.sds_code !== undefined && { sds_code: node.sds_code ?? "" }),
            ...(node.ref_type !== undefined && { ref_type: node.ref_type }),
            img_url: node.img_url || "",
            text: node.text || "",
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
        const titleTxt = normalizePlain(node.title);
        const bodyTxt = normalizePlain(node.text);
        const merged = `${titleTxt} ${bodyTxt}`;
        const hasChapter = merged.includes("5.6") || /^5\.6(?:[^0-9]|$)/.test(titleTxt) || /^5\.6(?:[^0-9]|$)/.test(bodyTxt);
        return hasChapter && merged.includes("数据结构");
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
    const isTableImportNode = (node: TreeNode): boolean => {
        const title = String(node.title || "").trim();
        return /^导入表格\d*$/.test(title) && !!node.table && Array.isArray(node.table.headers) && node.table.headers.length > 0;
    };
    const isPlaceholderTitle = (title?: string): boolean => IMPORTED_PLACEHOLDER_RE.test(String(title || "").trim());
    const isNumberableNode = (node: TreeNode): boolean => {
        const title = String(node.title || "").trim();
        if (!title) return false;
        if (IMPORTED_PLACEHOLDER_RE.test(title)) return false;
        const pureTitle = title
            .replace(/^(\d+(?:\.\d+)*)(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "")
            .replace(/\s+/g, "");
        if (/^(目录|需求规格说明|文件修订记录|软件详细设计说明书|软件详细设计)$/.test(pureTitle)) return false;
        return true;
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
        // 目录/封面等前置章节常占用“1”，业务章节应从 1 开始显示
        const rootMajorOffset = firstRootMajor && firstRootMajor > 1 ? (firstRootMajor - 1) : 0;
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
        const flattenedTableNodes: TreeNode[] = [];
        const passthroughNodes: TreeNode[] = [];
        const seen = new Set<string>();
        const pushTableNode = (node: TreeNode) => {
            const key = String(node.n_id || node.id || `${node.title}-${flattenedTableNodes.length}`);
            if (seen.has(key)) return;
            seen.add(key);
            // 扁平化后作为 5.6 的直接子节点，避免多层套娃
            flattenedTableNodes.push({ ...node, children: [] });
        };
        const visit = (node: TreeNode) => {
            if (hasRenderableTable(node.table)) {
                pushTableNode(node);
                return;
            }
            const children = node.children || [];
            if (children.length === 0) {
                passthroughNodes.push(node);
                return;
            }
            if (!hasTableInSubtree(node)) {
                passthroughNodes.push(node);
                return;
            }
            children.forEach(visit);
        };
        allCandidates.forEach(visit);
        dataNode.children = [...passthroughNodes, ...flattenedTableNodes];
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

    useEffect(() => {
        const id = params.id;
        if (id) {
            dispatch({ loading: true, isEdit: !isReadOnly });
            Api.get_sds_doc({ id }).then((res: any) => {
                if (res.code === Api.C_OK) {
                    const targetRow = res.data;

                    // 映射后端字段名到表单字段名
                    editForm.setFieldsValue({
                        id: targetRow.id,
                        product_id: targetRow.product_id,
                        srsdoc_id: targetRow.srsdoc_id,
                        version: targetRow.version, // 后端 version -> 前端 full_version
                        file_no: targetRow.file_no,
                    });

                    // 如果有产品ID，加载需求文档列表
                    if (targetRow.product_id) {
                        loadSrsDocList(targetRow.product_id);
                    }

                    // 解析树状结构数据
                    const parsedTree = (targetRow.content || []).map((node: any) => parseTreeNode(node));
                    const normalizedTree = normalizeFalseSingleDigitHeadings(parsedTree);
                    const relocatedTree = relocateDataStructureTables(normalizedTree);
                    const parsedContent = decorateImportedWordTree(relocatedTree);

                    dispatch({
                        loading: false,
                        changeDescription: targetRow.change_log || "",
                        docNId: targetRow.n_id || 0, // 保存文档级别的 n_id
                        treeStructure: parsedContent,
                        docProductId: targetRow.product_id,
                        docSrsdocId: targetRow.srsdoc_id,
                        docVersion: targetRow.version ?? "",
                    });
                    treeStructureRef.current = parsedContent;
                } else {
                    message.error(res.msg);
                    dispatch({ loading: false });
                    navigate("/sds_docs");
                }
            });
        } else {
            // 新增模式
            editForm.resetFields();
            dispatch({ isEdit: false });
            treeStructureRef.current = [];
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
        ApiSdsReqd.list_sds_reqd({
            doc_id: docId,
            page_index: 0,
            page_size: 10000,
        }).then((res: any) => {
            if (res.code === ApiSdsReqd.C_OK) {
                const rows = res.data?.rows || [];
                const tableData = rows.map((item: any, index: number) => ({
                    key: item.req_id || `reqd_${index}_${Date.now()}`,
                    req_id: item.srs_code,
                    doc_id: item.doc_id,
                    doc_version: item.doc_version || "",
                    name: item.name || "",
                    overview: item.overview || "",
                    function: item.function || "",
                    func_detail: item.func_detail || "",
                    logic_txt: item.logic_txt || "",
                    logic_img: item.logic_img || "",
                    intput: item.intput || "",
                    output: item.output || "",
                    interface: item.interface || "",
                    product_name: item.product_name || "",
                    product_version: item.product_version || "",
                }));
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
                    product_name: item.product_name || "",
                    product_version: item.product_version || "",
                    doc_version: item.doc_version || "",
                }));
                dispatch({ traceListData: tableData, traceListLoading: false });
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

        // 为标准节点生成临时 ID
        const addIdsToNodes = (nodes: any[]): TreeNode[] => {
            return nodes.map((node) => ({
                ...node,
                id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                children: node.children ? addIdsToNodes(node.children) : [],
            }));
        };

        const nodesWithIds = addIdsToNodes(standardNodes as any[]);
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
        const cleanedContent = currentTree.map((node: any) =>
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
                    Api.get_sds_doc({ id: params.id }).then((reloadRes: any) => {
                        if (reloadRes.code === Api.C_OK) {
                            const targetRow = reloadRes.data;

                            // 更新表单数据
                            editForm.setFieldsValue({
                                id: targetRow.id,
                                product_id: targetRow.product_id,
                                srsdoc_id: targetRow.srsdoc_id,
                                version: targetRow.version,
                                file_no: targetRow.file_no,
                            });

                            // 如果有产品ID，加载需求文档列表
                            if (targetRow.product_id) {
                                loadSrsDocList(targetRow.product_id);
                            }

                            const parsedTree = (targetRow.content || []).map((node: any) => parseTreeNode(node));
                            const normalizedTree = normalizeFalseSingleDigitHeadings(parsedTree);
                            const relocatedTree = relocateDataStructureTables(normalizedTree);
                            const parsedContent = decorateImportedWordTree(relocatedTree);
                            dispatch({
                                changeDescription: targetRow.change_log || "",
                                docNId: targetRow.n_id || 0,
                                treeStructure: parsedContent,
                            });
                            treeStructureRef.current = parsedContent;

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
    const chapterOffsetMatch = String(coverRoot?.title || "").trim().match(/^(\d+)/);
    const readOnlyChapterOffset = chapterOffsetMatch ? Number(chapterOffsetMatch[1] || 0) : 0;

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
        <div className={`page div-v sds-doc-detail ${isReadOnly ? 'read-only' : ''}`}>
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
                    {(data.isEdit || isReadOnly) ? (
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
                            <Col span={6}>
                                <Form.Item
                                    label={ts("sds_doc.file_no")}
                                    name="file_no">
                                    <Input allowClear placeholder={ts("sds_doc.file_no")} disabled={isReadOnly} style={{ width: 200 }} />
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
                            <Col span={6}>
                                <Form.Item
                                    label={ts("sds_doc.file_no")}
                                    name="file_no">
                                    <Input allowClear placeholder={ts("sds_doc.file_no")} style={{ width: 200 }} />
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
                        readOnlyChapterOffset={isReadOnly ? readOnlyChapterOffset : 0}
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
                        { title: ts("sds_reqd.logic_img") || "逻辑图", dataIndex: "logic_img", width: 120, ellipsis: true, render: (t: string) => t || "-" },
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
                        { title: ts("sds_trace.srs_code") || "SRS编号", dataIndex: "srs_code", width: 120, render: (t: string) => t || "-" },
                        { title: ts("sds_trace.sds_code") || "SDS编号", dataIndex: "sds_code", width: 120, render: (t: string) => t || "-" },
                        { title: ts("sds_trace.chapter") || "章节", dataIndex: "chapter", width: 300, render: (t: string) => t ? <span style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{t}</span> : "-" },
                    ]}
                    rowKey="key"
                    pagination={false}
                    loading={data.traceListLoading}
                    scroll={{ x: 540 }}
                />
            </Modal>
        </div>
    );
};
