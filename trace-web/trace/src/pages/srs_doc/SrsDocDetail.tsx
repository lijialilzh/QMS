import "./SrsDocDetail.less";
import { Form, Input, Button, message, Row, Col, Modal, Space, Table } from "antd";
import { ArrowLeftOutlined, EditOutlined, DownloadOutlined, FileAddOutlined, PlusOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import standardNodes from "./data/standard_nodes.json";
import * as Api from "@/api/ApiSrsDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiProdRcm from "@/api/ApiProdRcm";
import * as ApiSrsReq from "@/api/ApiSrsReq";
import * as ApiSrsReqd from "@/api/ApiSrsReqd";
import * as ApiSrsType from "@/api/ApiSrsType";
import TreeStructure, {
    TreeNode,
    syncTreeWithOtherReqState,
    remapProductBoundDocImages,
    resolveProductBoundDocImageRefType,
    validateStandardSrsCodeUnique,
    validateStandardSrsRowContentRaw,
    validateStandardSrsDataRows,
    validateStandardSrsHierarchyDuplicates,
    validateChangeReqDataRows,
} from "./components/TreeStructure";
import EditableTableGenerator, { TableDataWithHeaders } from "./components/EditableTableGenerator";

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const params = useParams();
    const location = useLocation();
    const isReadOnly = location.pathname.includes("/srs_docs/view/");
    const [editForm] = Form.useForm();
    const treeStructureRef = useRef<TreeNode[]>([]);
    const initialEditTreeRef = useRef<TreeNode[]>([]);
    const srsTableRefreshAtRef = useRef(0);
    const [data, dispatch] = useData({
        loading: false,
        isEdit: false,
        products: [],
        versions: [],
        changeDescription: "",
        showChangeDescModal: false,
        tempChangeDescription: "",
        exporting: false,
        saving: false,
        docNId: 0, // 文档级别的 n_id
        treeStructure: [],
        rcmOptions: [] as Array<{ value: number; label: string; description?: string }>,
        // SRS表相关（改为弹框展示）
        srsTableExpanded: false, // SRS表是否展开（保留，弹框打开时用）
        srsTableData: [], // SRS表数据
        srsOtherReqData: [], // 其他需求列表（type_code=2）
        srsChangeTables: [] as Array<{ id: number | string; title: string; type_code?: string; data: any[] }>, // 变更表(type_code!=1/2)
        srsTableLoading: false, // SRS表加载状态
        showChangeReqEditModal: false,
        changeReqEditInitialData: undefined as TableDataWithHeaders | undefined,
        changeReqEditTarget: undefined as { id: number | string; title: string; type_code?: string; data: any[] } | undefined,
        savingChangeReq: false,
        showAddChangeTableModal: false,
        newChangeTableName: "",
        showSrsTableModal: false, // SRS表弹框
        // 需求列表相关（改为弹框展示）
        reqListExpanded: false,
        reqListData: [], // 需求列表数据
        reqListLoading: false,
        showReqListModal: false, // 需求列表弹框
        docProductId: undefined as number | undefined,
        docVersion: "" as string,
    });

    const normalizeReqText = (value: any): string => {
        const txt = String(value ?? "").trim();
        if (!txt) return "";
        const invalid = new Set(["/", "\\", "／", "＼", "-", "--", "_", "无", "N/A", "n/a", "NA", "na", "null", "NULL", "None", "none"]);
        return invalid.has(txt) ? "" : txt;
    };
    const REQ_DETAIL_KEY_FIELD = "__req_detail_key";
    const normalizeCellText = (value: any): string => String(value || "")
        .replace(/[\s↩\r\n\t]+/g, "")
        .replace(/[：:，,。.;；、]/g, "")
        .toLowerCase();
    const isReqCodeHeaderText = (text: string): boolean => (
        text.includes("需求编号") || text.includes("需求列表") || text.includes("srscode") || text === "code"
    );
    const normalizeReqDetailKey = (value: any): string => String(value || "").trim();
    const getRowReqDetailKey = (row: any): string => normalizeReqDetailKey(row?.[REQ_DETAIL_KEY_FIELD] || row?.req_detail_key);
    const getTableReqDetailKey = (table?: any): string => {
        const directKey = normalizeReqDetailKey(table?.req_detail_key);
        if (directKey) return directKey;
        for (const row of table?.rows || []) {
            const rowKey = getRowReqDetailKey(row);
            if (rowKey) return rowKey;
        }
        return "";
    };
    const isFunctionalKvTable = (table?: any): boolean => {
        if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) return false;
        if (table.headers.length !== 2 || table.rows.length < 3) return false;
        const fieldLabels = new Set(["需求编号", "需求名称", "需求概述", "主参加者", "前置条件", "触发器", "工作流", "事件流", "后置条件", "异常情况", "约束"]);
        const leftCode = table.headers[0]?.code;
        const fieldHits = (table.rows || [])
            .map((row: any) => normalizeCellText(row?.[leftCode]))
            .filter((txt: string) => fieldLabels.has(txt)).length;
        return fieldHits >= 3;
    };
    const extractSrsCodeFromTable = (table?: any): string => {
        const values = [
            ...(table?.headers || []).map((header: any) => header?.name),
            ...(table?.rows || []).flatMap((row: any) => Object.values(row || {})),
        ];
        for (const value of values) {
            const matched = String(value || "").match(/SRS\s*-\s*[A-Z]+\s*\d+\s*-\s*\d+/i);
            if (matched?.[0]) return normalizeSrsCodeForSync(matched[0]);
        }
        return "";
    };
    const extractSrsCodeFromTableRow = (row?: any): string => {
        for (const value of Object.values(row || {})) {
            const matched = String(value || "").match(/SRS\s*-\s*[A-Z]+\s*\d+\s*-\s*\d+/i);
            if (matched?.[0]) return normalizeSrsCodeForSync(matched[0]);
        }
        return "";
    };

    const buildStandardNodesWithIds = (): TreeNode[] => {
        const addIdsToNodes = (nodes: any[]): TreeNode[] => {
            return nodes.map((node) => ({
                ...node,
                id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                children: node.children ? addIdsToNodes(node.children) : [],
            }));
        };
        return addIdsToNodes(standardNodes as any[]);
    };

    const cloneTree = (nodes: TreeNode[]): TreeNode[] => JSON.parse(JSON.stringify(nodes || []));
    const normalizeTemplateTitle = (title?: string) => String(title || "").replace(/\s+/g, "").trim();
    const ensureStandardTemplateChildren = (nodes: TreeNode[]): { nodes: TreeNode[]; changed: boolean } => {
        const templateNodes = buildStandardNodesWithIds();
        let changed = false;
        const mergeChildren = (currentItems: TreeNode[], templateItems: TreeNode[]): TreeNode[] => {
            return (currentItems || []).map((current) => {
                const matchedTemplate = (templateItems || []).find((tpl: any) => (
                    normalizeTemplateTitle(tpl.title) === normalizeTemplateTitle(current.title)
                ));
                if (!matchedTemplate) {
                    return {
                        ...current,
                        children: mergeChildren(current.children || [], []),
                    };
                }
                const currentChildren = current.children || [];
                const currentChildKeys = new Set(currentChildren.map((child) => normalizeTemplateTitle(child.title)));
                const missingChildren = (matchedTemplate.children || []).filter((tplChild: any) => {
                    const key = normalizeTemplateTitle(tplChild.title);
                    return key && !currentChildKeys.has(key);
                });
                if (missingChildren.length > 0) {
                    changed = true;
                }
                return {
                    ...current,
                    children: mergeChildren([...currentChildren, ...missingChildren], matchedTemplate.children || []),
                };
            });
        };
        return { nodes: mergeChildren(nodes || [], templateNodes), changed };
    };

    // 加载产品列表
    useEffect(() => {
        ApiProduct.list_product({ page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) {
                dispatch({ products: res.data.rows });
            }
        });
    }, []);

    const productId = Form.useWatch("product_id", editForm);
    const docVersion = Form.useWatch("version", editForm);
    const displayProductId = isReadOnly ? (data.docProductId ?? productId) : productId;
    const displayDocVersion = isReadOnly ? (data.docVersion ?? docVersion) : docVersion;
    const currentProduct = (data.products as any[]).find((p: any) => p.id === displayProductId);
    const productLabel = currentProduct ? `${currentProduct.name}-${currentProduct.full_version}` : "";
    const displayProductVersion = currentProduct?.full_version ?? "";
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
        const nextItem = rest.match(
            /(^|[\n\s。；;，,])((?:[0-9０-９]+|[a-zA-Z])[)）.．、](?:\s*|(?=[\u4e00-\u9fff])))/m
        );
        const valueEnd = (nextItem && typeof nextItem.index === "number")
            ? (valueStart + nextItem.index + String(nextItem[1] || "").length)
            : normalized.length;
        const current = normalized.slice(valueStart, valueEnd).trim();
        if (current === scope) return raw;
        const nextText = `${normalized.slice(0, valueStart)}${scope}${normalized.slice(valueEnd)}`;
        return nextText === normalized ? raw : nextText;
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
    const normalizeSrsCodeForSync = (value?: string) => String(value || "").replace(/\s+/g, "").toUpperCase();
    const srsSourceCodeSet = new Set([
        ...(data.srsTableData || []).map((item: any) => normalizeSrsCodeForSync(item?.srs_code || item?.code)),
        ...(data.srsOtherReqData || []).map((item: any) => normalizeSrsCodeForSync(item?.srs_code || item?.code)),
        ...(data.srsChangeTables || []).flatMap((table: any) => (table.data || []).map((item: any) => normalizeSrsCodeForSync(item?.srs_code || item?.code))),
    ].filter(Boolean));
    // useMemo 让 reqListDataForTree 在底层 reqListData / 需求码集合不变时保持同一引用，
    // 避免传给 <TreeStructure> 后让其 useEffect 反复触发 demand 同步、把 7 章节重建。
    const reqListDataForTree = useMemo(() => (
        srsSourceCodeSet.size > 0
            ? (data.reqListData || []).filter((item: any) => srsSourceCodeSet.has(normalizeSrsCodeForSync(item?.code)))
            : (data.reqListData || [])
    ), [data.reqListData, data.srsTableData, data.srsOtherReqData, data.srsChangeTables]);
    const filteredSrsTableData = data.srsTableData as any[];
    const filteredSrsOtherReqData = data.srsOtherReqData as any[];
    const isBaseChangeTypeCode = (typeCode?: string) => ["1", "2", ""].includes(String(typeCode || ""));
    const getChangeTableSortKey = (table: any) => {
        const createTime = table?.create_time ? new Date(table.create_time).getTime() : 0;
        if (Number.isFinite(createTime) && createTime > 0) return createTime;
        return Number(table?.id || 0);
    };
    const sortSrsChangeTables = (tables: any[] = []) => (
        [...(tables || [])]
            .filter((table) => !isBaseChangeTypeCode(table?.type_code))
            .sort((left, right) => getChangeTableSortKey(left) - getChangeTableSortKey(right))
    );
    const moveChangeTableToEnd = (tables: any[] = [], typeCode?: string) => {
        const code = String(typeCode || "");
        if (!code) return sortSrsChangeTables(tables);
        const sorted = sortSrsChangeTables(tables);
        const targetIndex = sorted.findIndex((table) => String(table?.type_code || "") === code);
        if (targetIndex < 0) return sorted;
        const next = [...sorted];
        const [target] = next.splice(targetIndex, 1);
        next.push(target);
        return next;
    };
    const filteredSrsChangeTables = useMemo(() => (
        sortSrsChangeTables(data.srsChangeTables || []).map((table: any) => ({
            ...table,
            data: table.data || [],
        }))
    ), [data.srsChangeTables]);
    // 传给 <TreeStructure> 的 srsReqPreview 也需要稳定引用，否则它的 useEffect 会把
    // "未变化"的 demand 数据当成"变化了"，每次保存普通表都重建 7 章节。
    const srsReqPreviewForTree = useMemo(() => ({
        main: filteredSrsTableData as any[],
        other: filteredSrsOtherReqData as any[],
        changes: filteredSrsChangeTables as Array<{ id: number | string; title: string; data: any[] }>,
    }), [filteredSrsTableData, filteredSrsOtherReqData, filteredSrsChangeTables]);
    const normalizeTableTitle = (value?: string) => normalizeReqText(value).replace(/\s+/g, "");
    const stripChangeTableTitleHeading = (value?: string) => (
        normalizeReqText(value).replace(/^\d+(?:\.\d+)*(?:[\s、.．]+|(?=[\u4e00-\u9fffA-Za-z]))/, "").trim()
    );
    const matchesChangeTableTitle = (left?: string, right?: string) => {
        const leftKey = normalizeTableTitle(left);
        const rightKey = normalizeTableTitle(right);
        if (!leftKey || !rightKey) return false;
        if (leftKey === rightKey) return true;
        const leftBody = normalizeTableTitle(stripChangeTableTitleHeading(left));
        const rightBody = normalizeTableTitle(stripChangeTableTitleHeading(right));
        return !!leftBody && !!rightBody && leftBody === rightBody;
    };
    const getNodeChangeTableTitle = (node: any) => String(node?.table?.name || node?.title || node?.label || "").trim();
    const getChangeRowsByTitle = (changeRowsByTitle: Map<string, any[]>, tableName: string) => {
        for (const [key, rows] of changeRowsByTitle.entries()) {
            if (matchesChangeTableTitle(tableName, key)) return rows;
        }
        return [];
    };
    const normalizeHeaderText = (value?: string) => String(value || "").replace(/\s+/g, "").toLowerCase();
    const isReqMainTable = (table?: any): boolean => {
        if (!table?.headers?.length) return false;
        const hs = table.headers.map((header: any) => normalizeHeaderText(header?.name));
        return hs.some((h: string) => isReqCodeHeaderText(h)) && hs.some((h: string) => h.includes("功能"));
    };
    const isReqOtherTable = (table?: any): boolean => {
        if (!table?.headers?.length) return false;
        const hs = table.headers.map((header: any) => normalizeHeaderText(header?.name));
        return hs.some((h: string) => isReqCodeHeaderText(h)) && hs.some((h: string) => h.includes("章节"));
    };
    const isRenderableTable = (table?: any): boolean => !!(table?.headers?.length && Array.isArray(table?.rows) && table.rows.length > 0);
    const pickTableColumnCode = (headers: any[] = [], matcher: (text: string) => boolean) => (
        headers.find((header: any) => matcher(normalizeHeaderText(header?.name || header?.code)))?.code || ""
    );
    const collectReqRowsFromTree = (items: TreeNode[] = []) => {
        const mainRows: any[] = [];
        const otherRows: any[] = [];
        const walk = (nodes: TreeNode[]) => {
            (nodes || []).forEach((node: any) => {
                const table = node?.table;
                if (isReqMainTable(table)) {
                    const headers = table.headers || [];
                    const codeCol = pickTableColumnCode(headers, (text) => isReqCodeHeaderText(text));
                    const moduleCol = pickTableColumnCode(headers, (text) => text.includes("模块"));
                    const functionCol = pickTableColumnCode(headers, (text) => text.includes("功能") && !text.includes("子功能"));
                    const subFunctionCol = pickTableColumnCode(headers, (text) => text.includes("子功能"));
                    const lastValues: Record<string, string> = {};
                    (table.rows || []).forEach((row: any) => {
                        const code = normalizeSrsCodeForSync(row?.[codeCol] || extractSrsCodeFromTableRow(row));
                        const rawModule = normalizeReqText(row?.[moduleCol]);
                        const rawFunction = normalizeReqText(row?.[functionCol]);
                        const rawSubFunction = normalizeReqText(row?.[subFunctionCol]);
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
                        if (code || rawModule || rawFunction || rawSubFunction) {
                            mainRows.push({
                                srs_code: code,
                                module: rawModule || lastValues.module || "",
                                function: rawFunction || lastValues.function || "",
                                sub_function: rawSubFunction || lastValues.sub_function || "",
                                table_name: table.name || node.title || "",
                            });
                        }
                    });
                }
                if (isReqOtherTable(table)) {
                    const headers = table.headers || [];
                    const codeCol = pickTableColumnCode(headers, (text) => isReqCodeHeaderText(text));
                    const moduleCol = pickTableColumnCode(headers, (text) => text.includes("需求模块") || text.includes("模块"));
                    const locationCol = pickTableColumnCode(headers, (text) => text.includes("章节") || text.includes("位置"));
                    (table.rows || []).forEach((row: any) => {
                        const code = normalizeSrsCodeForSync(row?.[codeCol] || extractSrsCodeFromTableRow(row));
                        const module = normalizeReqText(row?.[moduleCol]);
                        const location = normalizeReqText(row?.[locationCol]);
                        if (code || module || location) {
                            otherRows.push({ srs_code: code, module, location });
                        }
                    });
                }
                walk(node.children || []);
            });
        };
        walk(items || []);
        return { mainRows, otherRows };
    };
    const hasValidTreeContent = (items: TreeNode[] = []): boolean => (items || []).some((node: any) => (
        !!normalizeReqText(node?.title) ||
        !!normalizeReqText(node?.text) ||
        !!node?.img_url ||
        isRenderableTable(node?.table) ||
        hasValidTreeContent(node?.children || [])
    ));
    const getChapterNo = (title?: string): string => String(title || "").trim().match(/^(\d+(?:\.\d+)*)/)?.[1] || "";
    const getReqDisplayName = (row: any): string => (
        normalizeReqText(row?.sub_function) ||
        normalizeReqText(row?.function) ||
        normalizeReqText(row?.module) ||
        normalizeReqText(row?.name) ||
        normalizeReqText(row?.srs_code || row?.code)
    );
    const isAlgorithmReqRow = (row: any): boolean => {
        const text = [row?.module, row?.name, row?.function, row?.sub_function, row?.location]
            .map((item) => normalizeReqText(item))
            .join("");
        return text.includes("算法和数据要求") || text.includes("算法需求");
    };
    const uniqueRowsByCode = (rows: any[]): any[] => {
        const seen = new Set<string>();
        const result: any[] = [];
        (rows || []).forEach((row) => {
            const code = normalizeSrsCodeForSync(row?.srs_code || row?.code);
            if (!code || seen.has(code)) return;
            seen.add(code);
            result.push(row);
        });
        return result;
    };
    const fillMergedMainReqRows = (rows: any[]): any[] => {
        const lastValues: Record<string, string> = {};
        return (rows || []).map((row: any) => {
            const rawModule = normalizeReqText(row?.module);
            const rawFunction = normalizeReqText(row?.function);
            const rawSubFunction = normalizeReqText(row?.sub_function);
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
                ...row,
                module: rawModule || lastValues.module || "",
                function: rawFunction || lastValues.function || "",
                sub_function: rawSubFunction || "",
            };
        });
    };
    const collectChapterMatchState = (items: TreeNode[] = []) => {
        const functionalCodes = new Map<string, string>();
        const anyCodes = new Map<string, string>();
        const headingByLocation = new Map<string, { title: string; srs_code: string }>();
        const walk = (nodes: TreeNode[]) => {
            (nodes || []).forEach((node: any) => {
                const title = String(node?.title || "");
                const locationNo = getChapterNo(title);
                const nodeCode = normalizeSrsCodeForSync(node?.srs_code || "");
                const tableCode = normalizeSrsCodeForSync(isFunctionalKvTable(node?.table) ? extractSrsCodeFromTable(node?.table) : "");
                const code = nodeCode || tableCode;
                if (locationNo) {
                    headingByLocation.set(locationNo, { title, srs_code: nodeCode });
                }
                if (code) {
                    anyCodes.set(code, title);
                }
                if (code && (node?.label === "__auto_req_detail" || isFunctionalKvTable(node?.table))) {
                    functionalCodes.set(code, title);
                }
                walk(node?.children || []);
            });
        };
        walk(items || []);
        return { functionalCodes, anyCodes, headingByLocation };
    };
    const validateReqChapterMatches = (standardRows: any[], changeTables: any[], currentTree: TreeNode[]): string => {
        const chapterState = collectChapterMatchState(currentTree);
        const changeRows = (changeTables || []).flatMap((table: any) => (table.data || []).map((row: any) => ({
            ...row,
            table_title: table?.title || "变更需求表",
        })));
        const expectedFunctionalRows = uniqueRowsByCode([
            ...fillMergedMainReqRows(standardRows).map((row: any) => ({ ...row, __source: "标准需求" })),
            ...changeRows.map((row: any) => ({ ...row, __source: row.table_title || "变更需求" })),
        ].filter((row: any) => normalizeSrsCodeForSync(row?.srs_code || row?.code) && !isAlgorithmReqRow(row)));

        for (const row of expectedFunctionalRows) {
            const code = normalizeSrsCodeForSync(row?.srs_code || row?.code);
            const hasChapter = chapterState.functionalCodes.has(code);
            if (!hasChapter) {
                return `${row.__source || "需求表"} ${code}（${getReqDisplayName(row)}）缺少对应功能描述章节`;
            }
        }

        const expectedFunctionalCodes = new Set(
            expectedFunctionalRows
                .filter((row: any) => !isAlgorithmReqRow(row))
                .map((row: any) => normalizeSrsCodeForSync(row?.srs_code || row?.code))
                .filter(Boolean)
        );
        for (const code of chapterState.functionalCodes.keys()) {
            if (!expectedFunctionalCodes.has(code)) {
                return `功能描述章节 ${code} 未在标准需求或变更需求表中找到对应行`;
            }
        }
        return "";
    };
    const validateSrsDocRequired = (values: any, currentTree: TreeNode[] = []): string => {
        if (!values?.product_id) return "请选择产品";
        if (!normalizeReqText(values?.version)) return "请输入版本号";

        const derivedFolderName = normalizeReqText(values?.folder_name) || normalizeReqText(extractCoverTitleFromTree(currentTree));
        const derivedFileNo = normalizeReqText(values?.file_no) || normalizeReqText(extractFileNoFromTree(currentTree));
        if (!hasValidTreeContent(currentTree)) return "请先维护目录结构或正文内容";

        if (derivedFolderName !== values?.folder_name || derivedFileNo !== values?.file_no) {
            editForm.setFieldsValue({ folder_name: derivedFolderName, file_no: derivedFileNo });
        }

        const treeReqRows = collectReqRowsFromTree(currentTree);
        const treeMainRows = treeReqRows.mainRows.filter((row: any) => !/变更/.test(String(row?.table_name || "")));
        const mainRowsSource = treeMainRows.length ? treeMainRows : ((data.srsTableData || []) as any[]);
        const mainRows = fillMergedMainReqRows(mainRowsSource)
            .filter((row: any) => normalizeReqText(row?.srs_code || row?.code) || normalizeReqText(row?.module) || normalizeReqText(row?.function) || normalizeReqText(row?.sub_function));
        if (!mainRows.length) return "产品需求列表至少需要一条标准需求";

        const standardRows = (mainRowsSource || []).filter((row: any) => (
            normalizeReqText(row?.srs_code || row?.code) ||
            normalizeReqText(row?.module) ||
            normalizeReqText(row?.function) ||
            normalizeReqText(row?.sub_function)
        ));
        const standardValidateMsg = validateStandardSrsDataRows(standardRows);
        if (standardValidateMsg) return standardValidateMsg;

        const noCodeIndex = mainRows.findIndex((row: any) => !normalizeSrsCodeForSync(row?.srs_code || row?.code));
        if (noCodeIndex >= 0) return `产品需求列表第 ${noCodeIndex + 1} 行需填写需求编号`;

        const changeTables = (data.srsChangeTables || []) as any[];
        const invalidChangeTitle = changeTables.find((table: any) => !normalizeReqText(table?.title));
        if (invalidChangeTitle) return "变更需求表名称不能为空";
        for (const table of changeTables) {
            const tableLabel = table.title || "变更需求表";
            const rows = (table.data || []).filter((row: any) => (
                normalizeReqText(row?.srs_code || row?.code) ||
                normalizeReqText(row?.module) ||
                normalizeReqText(row?.function) ||
                normalizeReqText(row?.sub_function)
            ));
            const changeValidateMsg = validateChangeReqDataRows(rows, tableLabel);
            if (changeValidateMsg) return changeValidateMsg;
        }
        // 注意：之前这里还会跑 validateReqChapterMatches，把"功能描述章节缺失"作为致命错误阻止全局保存。
        // 实际场景中，用户在其他普通章节加普通表后做全局保存，并不希望被 7 章节功能描述章节的历史遗留卡死。
        // 现在把"功能描述章节对齐"的校验从这里移出，改为在 doSaveTreeStructure 中以 warning 形式提示，不阻断保存。
        return "";
    };
    const buildExportReqRowState = (state: { srsTableData: any[]; srsOtherReqData: any[]; srsChangeTables: any[] }, sourceTree: TreeNode[] = []) => {
        const stripHeadingNo = (value?: string) => String(value || "").trim().replace(/^\d+(?:\.\d+)*(?:\s+|(?=\D|$))/, "");
        const hierarchyByCode = new Map<string, { module?: string; function?: string; sub_function?: string }>();
        const tableSources = { main: [] as any[], other: [] as any[], changes: [] as Array<{ title: string; data: any[] }> };
        const pickColumn = (headers: any[], matcher: (text: string) => boolean) => (
            (headers || []).find((header: any) => matcher(normalizeHeaderText(header?.name)))?.code || ""
        );
        const rowsFromTable = (table: any) => {
            const headers = table?.headers || [];
            const headerCodes = headers.map((header: any) => header.code);
            if (Array.isArray(table?.cells) && table.cells.length > 1) {
                const rows: any[] = [];
                const activeSpans: Record<number, { value: string; remaining: number }> = {};
                table.cells.slice(1).forEach((cellRow: any[]) => {
                    const row: any = {};
                    headers.forEach((header: any, colIndex: number) => {
                        const active = activeSpans[colIndex];
                        const cell = cellRow?.[colIndex];
                        if (cell?.row_span === 0 || cell?.col_span === 0) {
                            row[header.code] = active?.value || "";
                            if (active) active.remaining -= 1;
                            if (active && active.remaining <= 0) delete activeSpans[colIndex];
                            return;
                        }
                        const value = normalizeReqText(cell?.value);
                        row[header.code] = value;
                        const rowSpan = Number(cell?.row_span || 1);
                        if (rowSpan > 1) activeSpans[colIndex] = { value, remaining: rowSpan - 1 };
                    });
                    rows.push(row);
                });
                return rows;
            }
            return (table?.rows || []).map((row: any) => {
                const normalized: any = {};
                headerCodes.forEach((code: string) => {
                    normalized[code] = normalizeReqText(row?.[code]);
                });
                return normalized;
            });
        };
        const mainRowsFromTable = (table: any) => {
            const headers = table?.headers || [];
            const codeCol = pickColumn(headers, (text) => isReqCodeHeaderText(text));
            const moduleCol = pickColumn(headers, (text) => text.includes("模块"));
            const functionCol = pickColumn(headers, (text) => text.includes("功能") && !text.includes("子功能"));
            const subFunctionCol = pickColumn(headers, (text) => text.includes("子功能"));
            const lastValues: Record<string, string> = {};
            return rowsFromTable(table)
                .map((row: any) => {
                    const code = normalizeSrsCodeForSync(row?.[codeCol] || extractSrsCodeFromTableRow(row));
                    if (!code) return undefined;
                    const rawModule = normalizeReqText(row?.[moduleCol]);
                    const rawFunction = normalizeReqText(row?.[functionCol]);
                    const rawSubFunction = normalizeReqText(row?.[subFunctionCol]);
                    if (rawModule) {
                        lastValues.module = rawModule;
                        lastValues.function = "";
                        lastValues.sub_function = "";
                    }
                    if (rawFunction) {
                        lastValues.function = rawFunction;
                        lastValues.sub_function = "";
                    }
                    if (rawSubFunction) lastValues.sub_function = rawSubFunction;
                    return {
                        srs_code: code,
                        module: rawModule || lastValues.module || "",
                        function: rawFunction || lastValues.function || "",
                        sub_function: rawSubFunction || lastValues.sub_function || "",
                    };
                })
                .filter(Boolean);
        };
        const otherRowsFromTable = (table: any) => {
            const headers = table?.headers || [];
            const codeCol = pickColumn(headers, (text) => isReqCodeHeaderText(text));
            const moduleCol = pickColumn(headers, (text) => text.includes("需求模块") || text.includes("模块"));
            const locationCol = pickColumn(headers, (text) => text.includes("章节") || text.includes("位置"));
            return rowsFromTable(table)
                .map((row: any) => ({
                    srs_code: normalizeSrsCodeForSync(row?.[codeCol] || extractSrsCodeFromTableRow(row)),
                    module: normalizeReqText(row?.[moduleCol]),
                    location: normalizeReqText(row?.[locationCol]),
                }))
                .filter((row: any) => row.srs_code);
        };
        const collectHierarchy = (items: TreeNode[], path: string[] = []) => {
            (items || []).forEach((node: any) => {
                const titleName = normalizeReqText(stripHeadingNo(node.title));
                const nextPath = titleName ? [...path, titleName] : path;
                const code = normalizeSrsCodeForSync(node.srs_code || extractSrsCodeFromTable(node.table));
                const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                if (code && isReqDetailNode && nextPath.length) {
                    const reqPath = nextPath[0] && /^\d*(?:图像显示|功能需求|需求|要求)$/.test(normalizeReqText(nextPath[0]))
                        ? nextPath.slice(1)
                        : nextPath;
                    hierarchyByCode.set(code, {
                        module: reqPath[0] || "",
                        function: reqPath[1] || "",
                        sub_function: reqPath[2] || "",
                    });
                }
                if (isReqMainTable(node.table)) {
                    const tableName = String(node.table?.name || node.title || "");
                    if (/变更/.test(tableName)) {
                        tableSources.changes.push({ title: tableName || "变更需求", data: mainRowsFromTable(node.table) as any[] });
                    } else {
                        tableSources.main = mainRowsFromTable(node.table) as any[];
                    }
                } else if (isReqOtherTable(node.table)) {
                    tableSources.other = otherRowsFromTable(node.table);
                }
                collectHierarchy(node.children || [], nextPath);
            });
        };
        collectHierarchy(sourceTree || []);
        const toMainRows = (rows: any[] = []) => rows.map((row) => ({
            srs_code: row?.srs_code || row?.code || "",
            module: row?.module || "",
            function: row?.function || "",
            sub_function: row?.sub_function || "",
        })).map((row) => {
            const hierarchy = hierarchyByCode.get(normalizeSrsCodeForSync(row.srs_code)) || {};
            return {
                ...row,
                module: row.module || hierarchy.module || "",
                function: row.function || hierarchy.function || "",
                sub_function: row.sub_function || hierarchy.sub_function || "",
            };
        });
        const mergeMainRowsByCode = (primaryRows: any[] = [], fallbackRows: any[] = []) => {
            const fallbackByCode = new Map<string, any>(
                (fallbackRows || [])
                    .map((row: any) => [normalizeSrsCodeForSync(row?.srs_code || row?.code), row] as [string, any])
                    .filter(([code]) => !!code),
            );
            return (primaryRows || []).map((row: any) => {
                const code = normalizeSrsCodeForSync(row?.srs_code || row?.code);
                const fallback: any = fallbackByCode.get(code) || {};
                return {
                    srs_code: row?.srs_code || row?.code || fallback?.srs_code || fallback?.code || "",
                    module: row?.module || fallback?.module || "",
                    function: row?.function || fallback?.function || "",
                    sub_function: row?.sub_function || fallback?.sub_function || "",
                };
            });
        };
        const fillMainRowsForExport = (rows: any[] = []) => {
            const lastValues: Record<string, string> = {};
            return (rows || []).map((row: any) => {
                const code = normalizeSrsCodeForSync(row?.srs_code || row?.code);
                const group = code.match(/^(SRS-[A-Z]+\d+)-\d+$/)?.[1] || code;
                const sameGroup = !!group && group === lastValues.group;
                const rawModule = normalizeReqText(row?.module);
                const rawFunction = normalizeReqText(row?.function);
                const rawSubFunction = normalizeReqText(row?.sub_function);
                if (!sameGroup) {
                    lastValues.group = group;
                    lastValues.module = "";
                    lastValues.function = "";
                    lastValues.sub_function = "";
                }
                if (rawModule) {
                    lastValues.module = rawModule;
                    lastValues.function = "";
                    lastValues.sub_function = "";
                }
                if (rawFunction) {
                    lastValues.function = rawFunction;
                    lastValues.sub_function = "";
                }
                if (rawSubFunction) lastValues.sub_function = rawSubFunction;
                return {
                    ...row,
                    srs_code: code || row?.srs_code || "",
                    module: rawModule || (sameGroup ? lastValues.module : ""),
                    function: rawFunction || (sameGroup ? lastValues.function : ""),
                    sub_function: rawSubFunction || (sameGroup ? lastValues.sub_function : ""),
                };
            });
        };
        const mainRows = fillMainRowsForExport(toMainRows(mergeMainRowsByCode(
            toMainRows(state.srsTableData || []),
            toMainRows(tableSources.main || []),
        )));
        const otherRows = (state.srsOtherReqData || []).length
            ? (state.srsOtherReqData || []).map((row) => ({
                srs_code: row?.srs_code || row?.code || "",
                module: row?.module || "",
                location: row?.location || "",
            }))
            : tableSources.other;
        const changeRowsByTitle = new Map<string, any[]>();
        (state.srsChangeTables || []).forEach((table) => {
            const title = normalizeTableTitle(table?.title || "变更需求");
            const changeRows = fillMainRowsForExport(toMainRows(table?.data || []));
            if (changeRows.length) changeRowsByTitle.set(title, changeRows);
        });
        tableSources.changes.forEach((table) => {
            const title = normalizeTableTitle(table?.title || "变更需求");
            if (changeRowsByTitle.has(title)) return;
            const changeRows = fillMainRowsForExport(toMainRows(table?.data || []));
            if (changeRows.length) changeRowsByTitle.set(title, changeRows);
        });
        return { mainRows, otherRows, changeRowsByTitle };
    };
    const isExportReqTable = (table?: any) => {
        if (!table?.headers?.length) return false;
        if (isReqMainTable(table) || isReqOtherTable(table)) return true;
        const hs = (table.headers || []).map((header: any) => normalizeHeaderText(header?.name));
        return hs.some((h: string) => isReqCodeHeaderText(h)) && hs.some((h: string) => h.includes("模块"));
    };
    const flattenExportReqTable = (table: any) => {
        if (!table?.headers?.length) return table;
        const headers = table.headers || [];
        const headerCodes = headers.map((header: any) => header.code);
        const pickColumn = (matcher: (text: string) => boolean) => (
            headers.find((header: any) => matcher(normalizeHeaderText(header?.name)))?.code || ""
        );
        const codeCol = pickColumn((text) => isReqCodeHeaderText(text));
        const moduleCol = pickColumn((text) => text.includes("模块"));
        const functionCol = pickColumn((text) => text.includes("功能") && !text.includes("子功能"));
        const subFunctionCol = pickColumn((text) => text.includes("子功能"));
        const locationCol = pickColumn((text) => text.includes("章节") || text.includes("位置"));
        const readRows = () => {
            if (Array.isArray(table?.cells) && table.cells.length > 1) {
                const rows: any[] = [];
                const activeSpans: Record<number, { value: string; remaining: number }> = {};
                table.cells.slice(1).forEach((cellRow: any[]) => {
                    const row: any = {};
                    headers.forEach((header: any, colIndex: number) => {
                        const active = activeSpans[colIndex];
                        const cell = cellRow?.[colIndex];
                        if (cell?.row_span === 0 || cell?.col_span === 0) {
                            row[header.code] = active?.value || "";
                            if (active) active.remaining -= 1;
                            if (active && active.remaining <= 0) delete activeSpans[colIndex];
                            return;
                        }
                        const value = normalizeReqText(cell?.value);
                        row[header.code] = value;
                        const rowSpan = Number(cell?.row_span || 1);
                        if (rowSpan > 1) activeSpans[colIndex] = { value, remaining: rowSpan - 1 };
                    });
                    rows.push(row);
                });
                return rows;
            }
            return (table?.rows || []).map((row: any) => {
                const normalized: any = {};
                headerCodes.forEach((code: string) => {
                    normalized[code] = normalizeReqText(row?.[code]);
                });
                return normalized;
            });
        };
        const getSrsExportGroup = (code: string) => {
            const normalized = normalizeSrsCodeForSync(code);
            return normalized.match(/^(SRS-[A-Z]+\d+)-\d+$/)?.[1] || normalized;
        };
        let lastValues: Record<string, string> = {};
        const flatRows = readRows().map((row: any) => {
            const code = normalizeSrsCodeForSync(row?.[codeCol] || extractSrsCodeFromTableRow(row));
            const group = getSrsExportGroup(code);
            const sameGroup = !!group && group === lastValues.group;
            if (!sameGroup) {
                lastValues = { group };
            }
            const rawModule = normalizeReqText(row?.[moduleCol]);
            const rawFunction = normalizeReqText(row?.[functionCol]);
            const rawSubFunction = normalizeReqText(row?.[subFunctionCol]);
            const rawLocation = normalizeReqText(row?.[locationCol]);
            if (rawModule) {
                lastValues.module = rawModule;
                lastValues.function = "";
                lastValues.sub_function = "";
            }
            if (rawFunction) {
                lastValues.function = rawFunction;
                lastValues.sub_function = "";
            }
            if (rawSubFunction) lastValues.sub_function = rawSubFunction;
            if (rawLocation) lastValues.location = rawLocation;
            return {
                ...(codeCol ? { [codeCol]: code || row?.[codeCol] || "" } : {}),
                ...(moduleCol ? { [moduleCol]: rawModule || (sameGroup ? lastValues.module || "" : "") } : {}),
                ...(functionCol ? { [functionCol]: rawFunction || (sameGroup ? lastValues.function || "" : "") } : {}),
                ...(subFunctionCol ? { [subFunctionCol]: rawSubFunction || (sameGroup ? lastValues.sub_function || "" : "") } : {}),
                ...(locationCol ? { [locationCol]: rawLocation || (sameGroup ? lastValues.location || "" : "") } : {}),
            };
        }).filter((row: any) => Object.values(row).some((value) => normalizeReqText(value)));
        return {
            ...table,
            headers,
            rows: flatRows,
            cells: undefined,
        };
    };
    const applyExportRowsToTable = (table: any, exportRows: any[] = []) => {
        if (!table?.headers?.length || !exportRows.length) {
            return flattenExportReqTable(table);
        }
        const headers = table.headers || [];
        const pickColumn = (matcher: (text: string) => boolean) => (
            headers.find((header: any) => matcher(normalizeHeaderText(header?.name)))?.code || ""
        );
        const codeCol = pickColumn((text) => isReqCodeHeaderText(text));
        const moduleCol = pickColumn((text) => text.includes("模块"));
        const functionCol = pickColumn((text) => text.includes("功能") && !text.includes("子功能"));
        const subFunctionCol = pickColumn((text) => text.includes("子功能"));
        const locationCol = pickColumn((text) => text.includes("章节") || text.includes("位置"));
        const rows = exportRows.map((row) => ({
            ...(codeCol ? { [codeCol]: row?.srs_code || row?.code || "" } : {}),
            ...(moduleCol ? { [moduleCol]: row?.module || "" } : {}),
            ...(functionCol ? { [functionCol]: row?.function || "" } : {}),
            ...(subFunctionCol ? { [subFunctionCol]: row?.sub_function || "" } : {}),
            ...(locationCol ? { [locationCol]: row?.location || "" } : {}),
        }));
        return flattenExportReqTable({ ...table, headers, rows, cells: undefined });
    };
    const isImportedTableNode = (node: any) => /^导入表格\d*$/.test(String(node?.title || "").trim());
    const syncExportReqTablesInTree = (
        tree: TreeNode[],
        state: { srsTableData: any[]; srsOtherReqData: any[]; srsChangeTables: any[] },
        sourceTree: TreeNode[] = tree,
    ): TreeNode[] => {
        const { changeRowsByTitle } = buildExportReqRowState(state, sourceTree);
        const walk = (nodes: TreeNode[]): TreeNode[] => (nodes || []).map((node: any) => {
            const text = String(node.text || "");
            const hasOtherMarker = text.includes("其他需求");
            let nextTable = node.table;
            if (isReqOtherTable(node.table)) {
                nextTable = flattenExportReqTable(node.table);
            } else if (isReqMainTable(node.table)) {
                const tableName = getNodeChangeTableTitle(node);
                if (/变更/.test(tableName)) {
                    const changeRows = getChangeRowsByTitle(changeRowsByTitle, tableName);
                    nextTable = changeRows.length ? applyExportRowsToTable(node.table, changeRows) : flattenExportReqTable(node.table);
                } else {
                    nextTable = flattenExportReqTable(node.table);
                }
            } else if (isExportReqTable(node.table)) {
                nextTable = flattenExportReqTable(node.table);
            }
            const walkedChildren = walk(node.children || []);
            const importedIndexes = walkedChildren
                .map((child: any, index: number) => (isImportedTableNode(child) && isExportReqTable(child.table) ? index : -1))
                .filter((index: number) => index >= 0);
            const nextChildren = walkedChildren.map((child: any, index: number) => {
                const importOrder = importedIndexes.indexOf(index);
                if (importOrder < 0) {
                    if (isReqOtherTable(child.table)) {
                        return { ...child, table: flattenExportReqTable(child.table) };
                    }
                    if (isReqMainTable(child.table)) {
                        const tableName = getNodeChangeTableTitle(child);
                        if (/变更/.test(tableName)) {
                            const changeRows = getChangeRowsByTitle(changeRowsByTitle, tableName);
                            if (changeRows.length) {
                                return { ...child, table: applyExportRowsToTable(child.table, changeRows) };
                            }
                        } else {
                            return { ...child, table: flattenExportReqTable(child.table) };
                        }
                    }
                    return child;
                }
                if (isReqOtherTable(child.table) || (hasOtherMarker && importOrder === 1)) {
                    return { ...child, table: flattenExportReqTable(child.table) };
                }
                if (isReqMainTable(child.table)) {
                    const tableName = getNodeChangeTableTitle(child);
                    if (/变更/.test(tableName)) {
                        const changeRows = getChangeRowsByTitle(changeRowsByTitle, tableName);
                        if (changeRows.length) {
                            return { ...child, table: applyExportRowsToTable(child.table, changeRows) };
                        }
                    } else {
                        return { ...child, table: flattenExportReqTable(child.table) };
                    }
                }
                return { ...child, table: flattenExportReqTable(child.table) };
            });
            return { ...node, table: nextTable, children: nextChildren };
        });
        return walk(tree || []);
    };
    const isTreeChangeTableNode = (node: any) => {
        const table = node?.table;
        if (!table || typeof table !== "object") return false;
        const title = getNodeChangeTableTitle(node);
        if (!/变更/.test(title)) return false;
        const headers = Array.isArray(table.headers) ? table.headers : [];
        const rows = Array.isArray(table.rows) ? table.rows : [];
        const cells = Array.isArray(table.cells) ? table.cells : [];
        return headers.length > 0 || rows.length > 0 || cells.length > 0 || !!String(table.name || "").trim();
    };
    const isImportedChangeTableNode = (node: any) => (
        isImportedTableNode(node)
        || /^\d+(?:\.\d+)*\s+\S*变更/.test(getNodeChangeTableTitle(node))
    );
    const pruneDetachedManualChangeTableNodes = (
        items: TreeNode[],
        changeTables: any[] = [],
    ): TreeNode[] => (
        (items || [])
            .map((node: any) => ({
                ...node,
                children: pruneDetachedManualChangeTableNodes(node.children || [], changeTables),
            }))
            .filter((node: any) => {
                if (!isTreeChangeTableNode(node)) return true;
                if (isImportedChangeTableNode(node)) return true;
                const nodeTitle = getNodeChangeTableTitle(node);
                return (changeTables || []).some((table: any) => (
                    matchesChangeTableTitle(nodeTitle, table?.title)
                ));
            })
    );
    const treeHasMatchingChangeTable = (nodes: TreeNode[] = [], candidateTitle = ""): boolean => {
        let found = false;
        const walk = (items: TreeNode[]) => {
            (items || []).forEach((node: any) => {
                if (isTreeChangeTableNode(node) && matchesChangeTableTitle(getNodeChangeTableTitle(node), candidateTitle)) {
                    found = true;
                }
                if (!found) walk(node.children || []);
            });
        };
        walk(nodes);
        return found;
    };
    const collectChangeTableTitlesInTree = (nodes: TreeNode[] = [], titles = new Set<string>()) => {
        (nodes || []).forEach((node: any) => {
            if (isTreeChangeTableNode(node)) {
                titles.add(normalizeTableTitle(getNodeChangeTableTitle(node)));
            }
            collectChangeTableTitlesInTree(node.children || [], titles);
        });
        return titles;
    };
    const mergeChangeTablesForExport = (
        primary: Array<{ id?: number | string; title?: string; type_code?: string; data?: any[] }> = [],
        fallback: Array<{ id?: number | string; title?: string; type_code?: string; data?: any[] }> = [],
    ) => {
        const merged = [...(primary || [])];
        const indexByTitle = new Map<string, number>();
        merged.forEach((table, index) => {
            indexByTitle.set(normalizeTableTitle(table?.title || "变更需求"), index);
        });
        (fallback || []).forEach((table) => {
            const key = normalizeTableTitle(table?.title || "变更需求");
            const rows = Array.isArray(table?.data) ? table.data : [];
            if (!rows.length) return;
            let existingIndex: number | undefined;
            merged.forEach((item, index) => {
                if (existingIndex !== undefined) return;
                if (matchesChangeTableTitle(item?.title, table?.title)) existingIndex = index;
            });
            if (existingIndex === undefined) existingIndex = indexByTitle.get(key);
            if (existingIndex === undefined) {
                indexByTitle.set(key, merged.length);
                merged.push(table);
                return;
            }
            if (!(merged[existingIndex]?.data || []).length) {
                merged[existingIndex] = { ...merged[existingIndex], ...table, data: rows };
            }
        });
        return merged;
    };
    const mergeExportTableState = (
        fetched: { srsTableData: any[]; srsOtherReqData: any[]; srsChangeTables: any[] },
        local: { srsTableData: any[]; srsOtherReqData: any[]; srsChangeTables: any[] },
    ) => ({
        srsTableData: (fetched?.srsTableData?.length ? fetched.srsTableData : local?.srsTableData) || [],
        srsOtherReqData: (fetched?.srsOtherReqData?.length ? fetched.srsOtherReqData : local?.srsOtherReqData) || [],
        srsChangeTables: mergeChangeTablesForExport(fetched?.srsChangeTables, local?.srsChangeTables),
    });
    const scoreReqListExportContainer = (node: any, children: any[] = []) => {
        const textBlob = `${node?.text || ""}\n${node?.label || ""}`;
        let score = 0;
        if (textBlob.includes("产品需求") && textBlob.includes("其他需求")) score += 5;
        if (node?.ref_type === "srs_reqs" || node?.ref_type === "srs_reqs_2") score += 4;
        const importedCount = (children || []).filter((child) => (
            isImportedTableNode(child) && Array.isArray(child?.table?.headers) && child.table.headers.length > 0
        )).length;
        if (importedCount >= 2) score += 3;
        if (importedCount >= 1 && textBlob.includes("其他需求")) score += 2;
        if (textBlob.includes("产品功能") && textBlob.includes("其他需求")) score += 2;
        return score;
    };
    const findReqListContainerPath = (tree: TreeNode[]): number[] | null => {
        let bestPath: number[] | null = null;
        let bestScore = 0;
        const walk = (nodes: TreeNode[], path: number[] = []) => {
            (nodes || []).forEach((node: any, index: number) => {
                const children = node.children || [];
                const score = scoreReqListExportContainer(node, children);
                if (score > bestScore) {
                    bestScore = score;
                    bestPath = [...path, index];
                }
                walk(children, [...path, index]);
            });
        };
        walk(tree || []);
        if (bestPath && bestScore > 0) return bestPath;
        let fallbackPath: number[] | null = null;
        const findImportedPair = (nodes: TreeNode[], path: number[] = []) => {
            (nodes || []).forEach((node: any, index: number) => {
                const importedCount = (node.children || []).filter((child: any) => (
                    isImportedTableNode(child) && Array.isArray(child?.table?.headers) && child.table.headers.length > 0
                )).length;
                if (importedCount >= 2 && !fallbackPath) fallbackPath = [...path, index];
                findImportedPair(node.children || [], [...path, index]);
            });
        };
        findImportedPair(tree || []);
        return fallbackPath;
    };
    const buildChangeExportTableNode = (title: string, rows: any[]): TreeNode => {
        const mainHeaders = [
            { code: "srs_code", name: "需求编号" },
            { code: "module", name: "模块" },
            { code: "function", name: "功能" },
            { code: "sub_function", name: "子功能" },
        ];
        return {
            id: Date.now() + Math.floor(Math.random() * 100000),
            doc_id: params.id ? parseInt(params.id) : 0,
            n_id: 0,
            p_id: 0,
            title: "",
            label: title,
            text: "",
            table: {
                name: title,
                headers: mainHeaders,
                rows: (rows || []).map((row) => ({
                    srs_code: row?.srs_code || row?.code || "",
                    module: row?.module || "",
                    function: row?.function || "",
                    sub_function: row?.sub_function || "",
                })),
                cells: undefined,
            },
            children: [],
        };
    };
    const resolveChangeTableTitleFromTree = (nodes: TreeNode[] = [], candidateTitle = ""): string => {
        let resolved = candidateTitle;
        (nodes || []).forEach((node: any) => {
            const title = getNodeChangeTableTitle(node);
            if (isTreeChangeTableNode(node) && matchesChangeTableTitle(title, candidateTitle)) {
                resolved = title;
            }
            const childResolved = resolveChangeTableTitleFromTree(node.children || [], candidateTitle);
            if (childResolved && childResolved !== candidateTitle) {
                resolved = childResolved;
            }
        });
        return resolved;
    };
    const appendMissingChangeTablesForExport = (
        tree: TreeNode[],
        state: { srsTableData: any[]; srsOtherReqData: any[]; srsChangeTables: any[] },
    ): TreeNode[] => {
        const { changeRowsByTitle } = buildExportReqRowState(state, tree);
        if (!changeRowsByTitle.size) return tree || [];
        const missingEntries: Array<{ title: string; rows: any[] }> = [];
        (state.srsChangeTables || []).forEach((table) => {
            const title = resolveChangeTableTitleFromTree(tree, table?.title || "变更需求");
            const rows = getChangeRowsByTitle(changeRowsByTitle, title);
            if (!rows.length) return;
            missingEntries.push({ title, rows });
        });
        changeRowsByTitle.forEach((rows, normalizedTitle) => {
            if (!rows.length) return;
            if (missingEntries.some((item) => matchesChangeTableTitle(item.title, normalizedTitle))) return;
            const title = resolveChangeTableTitleFromTree(
                tree,
                normalizedTitle === normalizeTableTitle("变更需求") ? "变更需求" : normalizedTitle,
            );
            missingEntries.push({ title, rows });
        });
        if (!missingEntries.length) return tree || [];
        const bestPath = findReqListContainerPath(tree || []);
        if (!bestPath) return tree || [];

        const containerPath: number[] = bestPath;

        const injectIntoContainer = (node: any) => {
            const children = node.children || [];
            const entriesToInject = missingEntries.filter((entry) => (
                !treeHasMatchingChangeTable(tree, entry.title)
            ));
            if (!entriesToInject.length) {
                const rawText = String(node.text || "");
                if (rawText.includes("变更需求")) return node;
                return {
                    ...node,
                    text: `${rawText.replace(/\s+$/, "")}${rawText ? "\n" : ""}变更需求\n`,
                };
            }
            const changeNodes = entriesToInject.map((entry) => buildChangeExportTableNode(entry.title, entry.rows));
            const importedIndexes = children
                .map((child: any, index: number) => (isImportedTableNode(child) ? index : -1))
                .filter((index: number) => index >= 0);
            const insertAt = importedIndexes.length > 0 ? importedIndexes[importedIndexes.length - 1] + 1 : children.length;
            const nextChildren = [...children];
            changeNodes.forEach((changeNode, offset) => {
                nextChildren.splice(insertAt + offset, 0, changeNode);
            });
            const rawText = String(node.text || "");
            const nextText = rawText.includes("变更需求")
                ? rawText
                : `${rawText.replace(/\s+$/, "")}${rawText ? "\n" : ""}变更需求\n`;
            return { ...node, text: nextText, children: nextChildren };
        };

        const applyInjectionAtPath = (nodes: TreeNode[], depth = 0): TreeNode[] => {
            if (depth === containerPath.length - 1) {
                return (nodes || []).map((node, index) => (
                    index === containerPath[depth] ? injectIntoContainer(node) : node
                ));
            }
            return (nodes || []).map((node, index) => {
                if (index !== containerPath[depth]) return node;
                return {
                    ...node,
                    children: applyInjectionAtPath(node.children || [], depth + 1),
                };
            });
        };
        return applyInjectionAtPath(tree || []);
    };
    const syncChangeReqTablesToTree = (tree: TreeNode[], changeTables: any[] = []): TreeNode[] => {
        if (!Array.isArray(tree) || !changeTables.length) return tree || [];
        const findColumn = (headers: any[], matcher: (text: string) => boolean) => (
            (headers || []).find((header: any) => matcher(normalizeHeaderText(header?.name || header?.code)))?.code || ""
        );
        const findMatchedChangeTable = (tableTitle: string) => (
            (changeTables || []).find((item: any) => matchesChangeTableTitle(tableTitle, item?.title))
        );
        const buildSyncedChangeTable = (table: any, tableTitle: string, matched: any) => {
            const headers = (table?.headers || []).length
                ? table.headers
                : [
                    { code: "srs_code", name: "需求编号" },
                    { code: "module", name: "模块" },
                    { code: "function", name: "功能" },
                    { code: "sub_function", name: "子功能" },
                ];
            const codeCol = findColumn(headers, (text) => isReqCodeHeaderText(text)) || "srs_code";
            const moduleCol = findColumn(headers, (text) => text.includes("模块")) || "module";
            const functionCol = findColumn(headers, (text) => text.includes("功能") && !text.includes("子功能")) || "function";
            const subFunctionCol = findColumn(headers, (text) => text.includes("子功能")) || "sub_function";
            return {
                ...table,
                name: table?.name || tableTitle,
                headers,
                rows: (matched.data || []).map((row: any) => ({
                    ...(codeCol ? { [codeCol]: row?.srs_code || row?.code || "" } : {}),
                    ...(moduleCol ? { [moduleCol]: row?.module || "" } : {}),
                    ...(functionCol ? { [functionCol]: row?.function || "" } : {}),
                    ...(subFunctionCol ? { [subFunctionCol]: row?.sub_function || "" } : {}),
                })),
                cells: undefined,
            };
        };
        return (tree || []).map((node: any) => {
            const table = node.table;
            let nextTable = table;
            const tableTitle = getNodeChangeTableTitle(node);
            if (isTreeChangeTableNode(node)) {
                const matched = findMatchedChangeTable(tableTitle);
                if (matched) {
                    nextTable = buildSyncedChangeTable(table, tableTitle, matched);
                }
            }
            return {
                ...node,
                table: nextTable,
                children: syncChangeReqTablesToTree(node.children || [], changeTables),
            };
        });
    };
    const pickPreferredChangeTableNode = (nodes: any[] = []) => {
        return nodes.find((node) => isImportedTableNode(node) && isTreeChangeTableNode(node))
            || nodes.find((node) => String(node?.table?.name || "").trim() && isTreeChangeTableNode(node))
            || nodes[0];
    };
    const dedupeChangeTableNodesInTree = (tree: TreeNode[]): TreeNode[] => {
        const cloned: TreeNode[] = JSON.parse(JSON.stringify(tree || []));
        const grouped = new Map<string, any[]>();
        const collect = (nodes: TreeNode[] = []) => {
            (nodes || []).forEach((node: any) => {
                if (isTreeChangeTableNode(node)) {
                    const title = getNodeChangeTableTitle(node);
                    let groupKey = "";
                    for (const key of grouped.keys()) {
                        if (matchesChangeTableTitle(key, title)) {
                            groupKey = key;
                            break;
                        }
                    }
                    if (!groupKey) groupKey = title;
                    grouped.set(groupKey, [...(grouped.get(groupKey) || []), node]);
                }
                collect(node.children || []);
            });
        };
        collect(cloned);

        const removeSet = new Set<any>();
        grouped.forEach((group) => {
            if (group.length <= 1) return;
            const keep = pickPreferredChangeTableNode(group);
            group.forEach((node) => {
                if (node !== keep) removeSet.add(node);
            });
        });

        const filterRemoved = (nodes: TreeNode[] = []): TreeNode[] => (
            (nodes || [])
                .filter((node: any) => !removeSet.has(node))
                .map((node: any) => ({
                    ...node,
                    children: filterRemoved(node.children || []),
                }))
        );
        return filterRemoved(cloned);
    };
    const looksLikeNumberedChangeTableHeading = (value?: string) => (
        /^\d+(?:\.\d+)*\s+\S*变更/.test(String(value || "").trim())
    );
    const normalizeChangeTableNodeTitles = (tree: TreeNode[]): TreeNode[] => (
        (tree || []).map((node: any) => {
            const tableTitle = getNodeChangeTableTitle(node);
            const nodeTitle = String(node.title || "").trim();
            let nextNode = node;
            if (
                isTreeChangeTableNode(node) &&
                !isImportedTableNode(node) &&
                nodeTitle &&
                (matchesChangeTableTitle(nodeTitle, tableTitle) || looksLikeNumberedChangeTableHeading(nodeTitle))
            ) {
                nextNode = {
                    ...node,
                    title: "",
                    label: node.label || tableTitle,
                    table: {
                        ...(node.table || {}),
                        name: node.table?.name || tableTitle,
                    },
                };
            }
            return {
                ...nextNode,
                children: normalizeChangeTableNodeTitles(nextNode.children || []),
            };
        })
    );
    // 之前这里有 ensureChangeTablesInTree —— 用来"在树里缺失变更需求表时自动补一张到第 7 章"。
    // 它是导致重复表的根因之一：用户手动 + 表格已经把节点放进了树（但保存逻辑读到的是旧 ref），
    // 它又自动补一张，于是出现两份。现在改为只通过手动添加进树，不再隐式补表。
    // 导出流程仍使用 appendMissingChangeTablesForExport 单独处理。
    const pruneEmptyReqChapterShells = (tree: TreeNode[]): TreeNode[] => {
        const cloned: TreeNode[] = JSON.parse(JSON.stringify(tree || []));
        const stripHeadingNo = (value?: string) => String(value || "").trim().replace(/^\d+(?:\.\d+)*\s*/, "");
        const getHeadingDepth = (value?: string) => {
            const matched = String(value || "").trim().match(/^(\d+(?:\.\d+)*)\s+/);
            return matched ? matched[1].split(".").length : 0;
        };
        const hasRenderableTableContent = (table?: any) => !!(
            table &&
            Array.isArray(table.headers) &&
            table.headers.length > 0 &&
            Array.isArray(table.rows) &&
            table.rows.length > 0
        );
        const findReqRoot = (items: TreeNode[]): TreeNode | undefined => {
            for (const node of items || []) {
                const heading = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
                if (heading === "7") return node;
            }
            return (items || []).find((node) => getHeadingDepth(node.title) === 1 && /需求|功能/.test(stripHeadingNo(node.title)));
        };
        const pruneUnder = (items: TreeNode[], rootPrefix: string): TreeNode[] => (
            (items || [])
                .map((node) => ({ ...node, children: pruneUnder(node.children || [], rootPrefix) }))
                .filter((node) => {
                    const hasChildren = (node.children || []).length > 0;
                    const hasText = !!String(node.text || "").trim();
                    const hasFunctionalTable = isFunctionalKvTable(node.table);
                    const hasRenderableTable = hasRenderableTableContent(node.table);
                    if (hasChildren || hasText || hasFunctionalTable || hasRenderableTable) return true;
                    const prefix = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "";
                    if (prefix.startsWith(`${rootPrefix}.`) && prefix.split(".").length >= 2) return false;
                    if (node.label === "__auto_req_group") return false;
                    return true;
                })
        );
        const reqRoot = findReqRoot(cloned);
        if (reqRoot) {
            const rootPrefix = String(reqRoot.title || "").trim().match(/^(\d+(?:\.\d+)*)/)?.[1] || "7";
            reqRoot.children = pruneUnder(reqRoot.children || [], rootPrefix);
        }
        return cloned;
    };
    const flattenRedundantReqDetailLayers = (tree: TreeNode[]): TreeNode[] => {
        const normalizeTitle = (value?: string) => normalizeReqText(value).replace(/\s+/g, "");
        const stripHeadingNo = (value?: string) => String(value || "").trim().replace(/^\d+(?:\.\d+)*\s*/, "");
        const walk = (items: TreeNode[]): TreeNode[] => (items || []).map((node) => {
            const children = walk(node.children || []);
            if (children.length !== 1) {
                return { ...node, children };
            }
            const child = children[0] as any;
            const parentName = normalizeTitle(stripHeadingNo(node.title));
            const childName = normalizeTitle(stripHeadingNo(child.title));
            const childIsDetail = child.label === "__auto_req_detail" || isFunctionalKvTable(child.table);
            const parentIsShell = !isFunctionalKvTable(node.table) && node.label !== "__auto_req_detail";
            if (!parentIsShell || !childIsDetail || !parentName || parentName !== childName) {
                return { ...node, children };
            }
            return {
                ...node,
                srs_code: child.srs_code ?? node.srs_code,
                req_detail_key: child.req_detail_key ?? node.req_detail_key,
                label: "__auto_req_detail",
                table: child.table,
                text: node.text || child.text || "",
                children: walk(child.children || []),
            };
        });
        return walk(tree || []);
    };
    const appendChangeReqDetailsToTree = (tree: TreeNode[], details: any[] = []): TreeNode[] => {
        if (!Array.isArray(tree)) return tree || [];
        if (!details.length) return pruneEmptyReqChapterShells(tree || []);
        const cloned: TreeNode[] = JSON.parse(JSON.stringify(tree || []));
        const normalizeTitle = (value?: string) => normalizeReqText(value).replace(/\s+/g, "");
        const stripHeadingNo = (value?: string) => String(value || "").trim().replace(/^\d+(?:\.\d+)*\s*/, "");
        const isAlgorithmReqDetail = (detail: any) => {
            const text = normalizeTitle([
                detail?.module,
                detail?.name,
                detail?.function,
                detail?.sub_function,
                detail?.location,
            ].filter(Boolean).join(""));
            return text.includes("算法和数据要求") || text.includes("算法需求");
        };
        const excludedAlgorithmCodes = new Set(
            (details || [])
                .filter(isAlgorithmReqDetail)
                .map((detail: any) => normalizeSrsCodeForSync(detail?.code))
                .filter(Boolean)
        );
        const effectiveDetails = (details || []).filter((detail: any) => !isAlgorithmReqDetail(detail));
        if (!effectiveDetails.length && !excludedAlgorithmCodes.size) return cloned;
        const getDepth = (value?: string) => {
            const matched = String(value || "").trim().match(/^(\d+(?:\.\d+)*)(?:\s+|(?=\D|$))/);
            return matched ? matched[1].split(".").length : 0;
        };
        const getPrefix = (value?: string) => String(value || "").trim().match(/^(\d+(?:\.\d+)*)(?:\s+|(?=\D|$))/)?.[1] || "";
        const isFixedReqIntroSection = (node: TreeNode) => {
            const name = normalizeReqText(stripHeadingNo(node.title)).replace(/\s+/g, "");
            return name === "要求" || name.endsWith("要求");
        };
        const nextChildNo = (children: TreeNode[], prefix: string) => {
            const escaped = prefix.replace(/\./g, "\\.");
            return (children || []).reduce((max, child) => {
                const matched = String(child.title || "").trim().match(new RegExp(`^${escaped}\\.(\\d+)(?:\\s+|(?=\\D|$))`));
                return matched ? Math.max(max, parseInt(matched[1], 10)) : max;
            }, 0) + 1;
        };
        const codeSet = new Set<string>();
        const detailNodeByKey = new Map<string, TreeNode>();
        const removeDetailNodeByKey = (items: TreeNode[], key: string): TreeNode | undefined => {
            for (let index = 0; index < (items || []).length; index += 1) {
                const node: any = items[index];
                const nodeCode = normalizeSrsCodeForSync(node.srs_code || extractSrsCodeFromTable(node.table));
                const nodeKey = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table) || (nodeCode ? `legacy_reqd_${nodeCode}` : ""));
                const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                if (isReqDetailNode && nodeKey === key) {
                    items.splice(index, 1);
                    return node;
                }
                const found = removeDetailNodeByKey(node.children || [], key);
                if (found) return found;
            }
            return undefined;
        };
        const collectExistingReqDetails = (items: TreeNode[]) => {
            (items || []).forEach((node: any) => {
                const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                if (isReqDetailNode) {
                    const code = normalizeSrsCodeForSync(node.srs_code || extractSrsCodeFromTable(node.table));
                    const key = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table) || (code ? `legacy_reqd_${code}` : ""));
                if (code) codeSet.add(code);
                    if (key && !detailNodeByKey.has(key)) {
                        detailNodeByKey.set(key, node);
                    }
                }
                collectExistingReqDetails(node.children || []);
            });
        };
        collectExistingReqDetails(cloned);
        const incomingCodes = new Set(effectiveDetails.map((detail: any) => normalizeSrsCodeForSync(detail?.code)).filter(Boolean));
        const changeDetailKeys = new Set(
            effectiveDetails
                .filter((detail: any) => !!String(detail?.type_code || "") && !["1", "2"].includes(String(detail?.type_code || "")))
                .map((detail: any) => normalizeReqDetailKey(detail?.req_detail_key))
                .filter(Boolean)
        );
        const changeDetailCodes = new Set(
            effectiveDetails
                .filter((detail: any) => !!String(detail?.type_code || "") && !["1", "2"].includes(String(detail?.type_code || "")))
                .map((detail: any) => normalizeSrsCodeForSync(detail?.code))
                .filter(Boolean)
        );
        const prunePreviousChangeDetails = (items: TreeNode[]): TreeNode[] => {
            return (items || [])
                .map((node: any) => ({
                    ...node,
                    children: prunePreviousChangeDetails(node.children || []),
                }))
                .filter((node: any) => {
                    const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                    if (!isReqDetailNode) return true;
                    const code = normalizeSrsCodeForSync(node.srs_code || extractSrsCodeFromTable(node.table));
                    const key = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table));
                    if (code && excludedAlgorithmCodes.has(code)) return false;
                    if (code && !incomingCodes.has(code)) return false;
                    const isStandardDetail = key.startsWith("reqd_") || (!key.startsWith("change_reqd_") && !!code && !changeDetailCodes.has(code) && incomingCodes.has(code));
                    if (isStandardDetail) return true;
                    const isChangeDetail = key.startsWith("change_reqd_") || changeDetailKeys.has(key);
                    const isLegacyCurrentChangeDetail = !key && !!code && changeDetailCodes.has(code) && node.label === "__auto_req_detail";
                    if (isChangeDetail || isLegacyCurrentChangeDetail) {
                        return !!(code && incomingCodes.has(code));
                    }
                    return true;
                })
                .filter((node: any) => {
                    if (node.label !== "__auto_req_group") return true;
                    return !!node.srs_code || !!node.table || !!node.text || (node.children || []).length > 0;
                });
        };
        const pruneEmptyGeneratedGroups = (items: TreeNode[]): TreeNode[] => (
            (items || [])
                .map((node: any) => ({ ...node, children: pruneEmptyGeneratedGroups(node.children || []) }))
                .filter((node: any) => {
                    const hasContent = !!node.srs_code ||
                        !!node.table ||
                        !!node.text ||
                        !!node.img_url ||
                        (node.children || []).length > 0;
                    if (hasContent) return true;
                    if (node.label === "__auto_req_group") return false;
                    const titleNo = getPrefix(node.title);
                    const titleText = normalizeTitle(stripHeadingNo(node.title));
                    const isReqHeading = !!titleNo && titleNo.split(".").length > 1;
                    // Older generated change-request headings did not carry __auto_req_group.
                    // Remove empty generated leaves, but keep imported prose placeholders such as "7.1 要求".
                    return !(isReqHeading && titleText !== "要求");
                })
        );
        const reqRootForPrune = (() => {
            for (const node of cloned || []) {
                const heading = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*)(?:\s+|(?=\D|$))/)?.[1] || "";
                if (heading === "7") return node;
            }
            return (cloned || []).find((node) => getDepth(node.title) === 1 && /需求|功能/.test(stripHeadingNo(node.title)));
        })();
        if (reqRootForPrune) {
            reqRootForPrune.children = pruneEmptyGeneratedGroups(prunePreviousChangeDetails(reqRootForPrune.children || []));
        }
        const activeCodeSet = new Set<string>();
        const collectActiveCodes = (items: TreeNode[]) => {
            (items || []).forEach((node: any) => {
                const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                if (isReqDetailNode) {
                    const code = normalizeSrsCodeForSync(node.srs_code || extractSrsCodeFromTable(node.table));
                    if (code) activeCodeSet.add(code);
                }
                collectActiveCodes(node.children || []);
            });
        };
        collectActiveCodes(cloned);
        const buildDetailTable = (detail: any) => ({
            show_header: 1,
            ...(detail.req_detail_key ? { req_detail_key: detail.req_detail_key } : {}),
            headers: [
                { code: "field", name: "字段" },
                { code: "value", name: "内容" },
            ],
            rows: [
                { field: "需求编号", value: detail.code || "", ...(detail.req_detail_key ? { [REQ_DETAIL_KEY_FIELD]: detail.req_detail_key } : {}) },
                { field: "需求名称", value: detail.name || detail.sub_function || detail.function || detail.module || "", ...(detail.req_detail_key ? { [REQ_DETAIL_KEY_FIELD]: detail.req_detail_key } : {}) },
                { field: "需求概述", value: "", ...(detail.req_detail_key ? { [REQ_DETAIL_KEY_FIELD]: detail.req_detail_key } : {}) },
                { field: "主参加者", value: "", ...(detail.req_detail_key ? { [REQ_DETAIL_KEY_FIELD]: detail.req_detail_key } : {}) },
                { field: "前置条件", value: "", ...(detail.req_detail_key ? { [REQ_DETAIL_KEY_FIELD]: detail.req_detail_key } : {}) },
                { field: "触发器", value: "", ...(detail.req_detail_key ? { [REQ_DETAIL_KEY_FIELD]: detail.req_detail_key } : {}) },
                { field: "事件流", value: "", ...(detail.req_detail_key ? { [REQ_DETAIL_KEY_FIELD]: detail.req_detail_key } : {}) },
                { field: "后置条件", value: "", ...(detail.req_detail_key ? { [REQ_DETAIL_KEY_FIELD]: detail.req_detail_key } : {}) },
                { field: "异常情况", value: "", ...(detail.req_detail_key ? { [REQ_DETAIL_KEY_FIELD]: detail.req_detail_key } : {}) },
                { field: "约束", value: "", ...(detail.req_detail_key ? { [REQ_DETAIL_KEY_FIELD]: detail.req_detail_key } : {}) },
            ],
        });
        const makeNode = (title: string, parent?: TreeNode): TreeNode => ({
            id: Date.now() + Math.floor(Math.random() * 100000),
            doc_id: params.id ? parseInt(params.id) : 0,
            n_id: 0,
            p_id: parent?.n_id || 0,
            title,
            text: "",
            label: "__auto_req_group",
            table: null,
            children: [],
        });
        const updateDetailTableIdentity = (table: any, detail: any) => {
            if (!isFunctionalKvTable(table)) return buildDetailTable(detail);
            const leftCode = table.headers?.[0]?.code;
            const rightCode = table.headers?.[1]?.code;
            const key = normalizeReqDetailKey(detail?.req_detail_key);
            return {
                ...table,
                ...(key ? { req_detail_key: key } : {}),
                rows: (table.rows || []).map((row: any) => {
                    const label = normalizeCellText(row?.[leftCode]);
                    const keyed = key ? { ...row, [REQ_DETAIL_KEY_FIELD]: key, req_detail_key: key } : { ...row };
                    if (label.includes("需求编号")) return { ...keyed, [rightCode]: detail.code || "" };
                    if (label.includes("需求名称")) return { ...keyed, [rightCode]: detail.name || detail.sub_function || detail.function || detail.module || "" };
                    return keyed;
                }),
            };
        };
        const findReqDetailRoot = (items: TreeNode[]): TreeNode | undefined => {
            for (const node of items || []) {
                const heading = String(node.title || "").trim().match(/^(\d+(?:\.\d+)*)(?:\s+|(?=\D|$))/)?.[1] || "";
                if (heading === "7") return node;
            }
            return (items || []).find((node) => getDepth(node.title) === 1 && /需求|功能/.test(stripHeadingNo(node.title)));
        };
        const findDirectChildByTitle = (items: TreeNode[], title: string, rootPrefix: string): TreeNode | undefined => {
            const key = normalizeTitle(title);
            return (items || []).find((node) => {
                const prefix = getPrefix(node.title);
                if (prefix.startsWith(`${rootPrefix}.`) && prefix.split(".").length === 2 && normalizeTitle(stripHeadingNo(node.title)) === key) {
                    return true;
                }
                const isReqGeneratedNode = node.label === "__auto_req_group" ||
                    node.label === "__auto_req_detail" ||
                    isFunctionalKvTable(node.table) ||
                    (node.children || []).some((child) => child.label === "__auto_req_detail" || isFunctionalKvTable(child.table));
                return isReqGeneratedNode && getDepth(node.title) > 0 && normalizeTitle(stripHeadingNo(node.title)) === key;
            });
        };
        const minSrsCodeInNode = (node: TreeNode): string => {
            const ownCode = normalizeSrsCodeForSync((node as any).srs_code || extractSrsCodeFromTable((node as any).table));
            const childCodes = (node.children || []).map(minSrsCodeInNode).filter(Boolean);
            return [ownCode, ...childCodes].filter(Boolean).sort((left, right) =>
                left.localeCompare(right, undefined, { numeric: true })
            )[0] || "";
        };
        const isImportedPlaceholderTitle = (value?: string) => /^导入表格\d*$/.test(stripHeadingNo(value));
        const getReqNameFromTable = (table?: any) => {
            if (!isFunctionalKvTable(table)) return "";
            const leftCode = table.headers?.[0]?.code;
            const rightCode = table.headers?.[1]?.code;
            const row = (table.rows || []).find((item: any) => normalizeCellText(item?.[leftCode]).includes("需求名称"));
            return normalizeReqText(row?.[rightCode]);
        };
        const renumberTitle = (title: string, prefix: string) => {
            const name = stripHeadingNo(title);
            return name ? `${prefix} ${name}` : title;
        };
        const sortAndRenumberReqRoot = (root: TreeNode) => {
            const rootPrefixValue = getPrefix(root.title);
            if (!rootPrefixValue) return;
            const fixedChildren: TreeNode[] = [];
            const sortableChildren: TreeNode[] = [];
            (root.children || []).forEach((child) => {
                if (isFixedReqIntroSection(child)) {
                    fixedChildren.push(child);
                    return;
                }
                const code = minSrsCodeInNode(child);
                if (code) sortableChildren.push(child);
                else fixedChildren.push(child);
            });
            sortableChildren.sort((left, right) => minSrsCodeInNode(left).localeCompare(minSrsCodeInNode(right), undefined, { numeric: true }));
            const usedChildNos = new Set<number>();
            const normalizedFixedChildren = fixedChildren.map((child) => {
                if (rootPrefixValue === "7" && isFixedReqIntroSection(child)) {
                    usedChildNos.add(1);
                    const name = stripHeadingNo(child.title) || "要求";
                    return { ...child, title: renumberTitle(name, `${rootPrefixValue}.1`) };
                }
                const prefix = getPrefix(child.title);
                const matched = prefix.match(new RegExp(`^${rootPrefixValue.replace(/\./g, "\\.")}\\.(\\d+)$`));
                if (matched) usedChildNos.add(parseInt(matched[1], 10));
                return child;
            });
            if (rootPrefixValue === "7") {
                usedChildNos.add(1);
            }
            let nextNo = rootPrefixValue === "7" ? 2 : 1;
            const allocate = () => {
                while (usedChildNos.has(nextNo)) nextNo += 1;
                usedChildNos.add(nextNo);
                return nextNo;
            };
            const renumberChildren = (node: TreeNode, parentPrefix: string) => {
                const children = node.children || [];
                children.sort((left, right) => {
                    const leftCode = minSrsCodeInNode(left);
                    const rightCode = minSrsCodeInNode(right);
                    if (!leftCode && !rightCode) return 0;
                    if (!leftCode) return -1;
                    if (!rightCode) return 1;
                    return leftCode.localeCompare(rightCode, undefined, { numeric: true });
                });
                node.children = children.map((child, index) => {
                    const prefix = `${parentPrefix}.${index + 1}`;
                    const fallbackName = getReqNameFromTable((child as any).table);
                    const baseTitle = isImportedPlaceholderTitle(child.title) && fallbackName ? fallbackName : child.title;
                    const nextChild = { ...child, title: renumberTitle(baseTitle, prefix) };
                    renumberChildren(nextChild, prefix);
                    return nextChild;
                });
            };
            const renumberedSortable = sortableChildren.map((child) => {
                const prefix = `${rootPrefixValue}.${allocate()}`;
                const fallbackName = getReqNameFromTable((child as any).table);
                const baseTitle = isImportedPlaceholderTitle(child.title) && fallbackName ? fallbackName : child.title;
                const nextChild = { ...child, title: renumberTitle(baseTitle, prefix) };
                renumberChildren(nextChild, prefix);
                return nextChild;
            });
            root.children = [...normalizedFixedChildren, ...renumberedSortable].sort((left, right) => {
                const leftPrefix = getPrefix(left.title);
                const rightPrefix = getPrefix(right.title);
                const leftNo = parseInt(leftPrefix.split(".").pop() || "0", 10);
                const rightNo = parseInt(rightPrefix.split(".").pop() || "0", 10);
                return (Number.isFinite(leftNo) ? leftNo : 0) - (Number.isFinite(rightNo) ? rightNo : 0);
            });
        };
        const reqRoot = findReqDetailRoot(cloned);
        if (!reqRoot) return cloned;
        const rootPrefix = getPrefix(reqRoot.title);
        effectiveDetails.forEach((detail) => {
            const code = normalizeSrsCodeForSync(detail?.code);
            if (!code) return;
            const detailKey = normalizeReqDetailKey(detail?.req_detail_key);
            const isChangeIncoming = !!String(detail?.type_code || "") && !["1", "2"].includes(String(detail?.type_code || ""));
            if (!isChangeIncoming) return;
            const moduleText = normalizeReqText(detail?.module || detail?.name || detail?.function || detail?.code) || code;
            const functionText = normalizeReqText(detail?.function);
            const subFunctionText = normalizeReqText(detail?.sub_function);
            const detailMatchesNodePath = (
                node: TreeNode,
                ancestors: TreeNode[],
                nodeCode: string,
            ) => {
                if (normalizeSrsCodeForSync(nodeCode) !== code) return false;
                const pathNames = new Set(
                    [...ancestors, node]
                        .map((item) => normalizeTitle(stripHeadingNo(item.title)))
                        .filter(Boolean),
                );
                if (!pathNames.has(normalizeTitle(moduleText))) return false;
                if (functionText && !pathNames.has(normalizeTitle(functionText))) return false;
                if (subFunctionText && !pathNames.has(normalizeTitle(subFunctionText))) return false;
                return true;
            };
            const hasFilledFunctionalDetail = (table: any) => {
                if (!isFunctionalKvTable(table)) return false;
                const leftCode = table.headers?.[0]?.code;
                const rightCode = table.headers?.[1]?.code;
                return (table.rows || []).some((row: any) => {
                    const label = normalizeCellText(row?.[leftCode]);
                    const value = normalizeReqText(row?.[rightCode]);
                    return !!value && !label.includes("需求编号") && !label.includes("需求名称");
                });
            };
            const removeExistingReqDetailForReuse = (items: TreeNode[], ancestors: TreeNode[] = []): TreeNode | undefined => {
                for (let index = 0; index < (items || []).length; index += 1) {
                    const node: any = items[index];
                    const nodeCode = normalizeSrsCodeForSync(node.srs_code || extractSrsCodeFromTable(node.table));
                    const nodeKey = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table));
                    const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                    if (isReqDetailNode && (
                        (detailKey && nodeKey === detailKey) ||
                        detailMatchesNodePath(node, ancestors, nodeCode)
                    )) {
                        return items.splice(index, 1)[0];
                    }
                    const found = removeExistingReqDetailForReuse(node.children || [], [...ancestors, node]);
                    if (found) return found;
                }
                return undefined;
            };
            const existingNodeToMove = removeExistingReqDetailForReuse(cloned);
            let moduleNode = findDirectChildByTitle(reqRoot.children || [], moduleText, rootPrefix);
            if (!moduleNode) {
                moduleNode = makeNode(`${rootPrefix}.${nextChildNo(reqRoot.children || [], rootPrefix)} ${moduleText}`, reqRoot);
                reqRoot.children = [...(reqRoot.children || []), moduleNode];
            }
            let target = moduleNode;
            if (functionText) {
                const modulePrefix = getPrefix(moduleNode.title);
                let functionNode = (moduleNode.children || []).find((child) => normalizeTitle(stripHeadingNo(child.title)) === normalizeTitle(functionText));
                if (!functionNode) {
                    functionNode = makeNode(`${modulePrefix}.${nextChildNo(moduleNode.children || [], modulePrefix)} ${functionText}`, moduleNode);
                    moduleNode.children = [...(moduleNode.children || []), functionNode];
                }
                target = functionNode;
            }
            if (subFunctionText) {
                const functionPrefix = getPrefix(target.title);
                let subNode = (target.children || []).find((child) => normalizeTitle(stripHeadingNo(child.title)) === normalizeTitle(subFunctionText));
                if (!subNode) {
                    subNode = makeNode(`${functionPrefix}.${nextChildNo(target.children || [], functionPrefix)} ${subFunctionText}`, target);
                    target.children = [...(target.children || []), subNode];
                }
                target = subNode;
            }
            const attachReqDetailToTarget = (existingNode?: TreeNode) => {
                const targetCode = normalizeSrsCodeForSync(target.srs_code || extractSrsCodeFromTable(target.table));
                const preserveTargetTable = !existingNode &&
                    isFunctionalKvTable(target.table) &&
                    targetCode === code &&
                    hasFilledFunctionalDetail(target.table);
                const tableSource = existingNode?.table || (preserveTargetTable ? target.table : undefined);
                Object.assign(target, {
                    ...(existingNode ? { id: existingNode.id, n_id: existingNode.n_id } : {}),
                    srs_code: code,
                    req_detail_key: detailKey,
                    label: "__auto_req_detail",
                    text: existingNode?.text || (preserveTargetTable ? target.text : "") || "",
                    table: tableSource
                        ? updateDetailTableIdentity(tableSource, detail)
                        : buildDetailTable(detail),
                    children: (target.children || []).filter((child: any) => child.id !== existingNode?.id),
                });
            };
            if (existingNodeToMove) {
                attachReqDetailToTarget(existingNodeToMove);
            } else {
                attachReqDetailToTarget();
            }
            activeCodeSet.add(code);
        });
        sortAndRenumberReqRoot(reqRoot);
        return pruneEmptyReqChapterShells(cloned);
    };
    const buildActiveReqDetailCodeSets = (srsTableState: { srsTableData?: any[]; srsChangeTables?: any[] }) => {
        const standardKeyByCode = new Map<string, string>();
        (srsTableState.srsTableData || []).forEach((item: any) => {
            const code = normalizeSrsCodeForSync(item?.srs_code || item?.code || "");
            if (code && item?.id) {
                standardKeyByCode.set(code, `reqd_${item.id}`);
            }
        });
        const standardCodes = new Set(
            (srsTableState.srsTableData || [])
                .map((item: any) => normalizeSrsCodeForSync(item?.srs_code || item?.code || ""))
                .filter(Boolean),
        );
        const changeCodes = new Set(
            (srsTableState.srsChangeTables || [])
                .flatMap((table: any) => (table.data || []).map((item: any) => normalizeSrsCodeForSync(item?.srs_code || item?.code || "")))
                .filter(Boolean),
        );
        return {
            standardCodes,
            changeCodes,
            allCodes: new Set([...standardCodes, ...changeCodes]),
            standardKeyByCode,
        };
    };
    const rebindNodeReqDetailKey = (node: any, nextKey: string) => {
        if (!nextKey) return node;
        const table = node.table;
        let nextTable = table;
        if (isFunctionalKvTable(table)) {
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
    const pruneDeletedChangeReqChapters = (
        tree: TreeNode[],
        deletedRows: any[],
        codeSets: {
            standardCodes: Set<string>;
            changeCodes: Set<string>;
            allCodes: Set<string>;
            standardKeyByCode: Map<string, string>;
        },
    ): TreeNode[] => {
        const deletedCodes = new Set((deletedRows || []).map((row: any) => normalizeSrsCodeForSync(row?.srs_code || row?.code)).filter(Boolean));
        const deletedKeys = new Set((deletedRows || []).map((row: any) => row?.id ? `change_reqd_${row.id}` : "").filter(Boolean));
        const getDepth = (value?: string) => {
            const matched = String(value || "").trim().match(/^(\d+(?:\.\d+)*)\s+/);
            return matched ? matched[1].split(".").length : 0;
        };
        const getRootNo = (value?: string) => String(value || "").trim().match(/^(\d+)/)?.[1] || "";
        const stripHeadingNo = (value?: string) => String(value || "").trim().replace(/^\d+(?:\.\d+)*\s*/, "");
        const isEmptyGeneratedHeading = (node: any) => (
            getDepth(node?.title) > 1 &&
            normalizeReqText(stripHeadingNo(node?.title)) !== "要求" &&
            !normalizeReqText(node?.text) &&
            !node?.img_url &&
            !isRenderableTable(node?.table) &&
            !(node?.children || []).length
        );
        const walk = (items: TreeNode[], insideReqRoot = false): TreeNode[] => (items || [])
            .map((node: any) => {
                const nextInsideReqRoot = insideReqRoot || getRootNo(node?.title) === "7";
                let nextNode = {
                    ...node,
                    children: walk(node.children || [], nextInsideReqRoot),
                };
                if (!nextInsideReqRoot) return nextNode;
                const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                const code = normalizeSrsCodeForSync(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                const key = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table));
                if (isReqDetailNode && code && codeSets.standardCodes.has(code) && key.startsWith("change_reqd_")) {
                    const standardKey = codeSets.standardKeyByCode.get(code);
                    if (standardKey) {
                        nextNode = rebindNodeReqDetailKey(nextNode, standardKey);
                    }
                }
                return nextNode;
            })
            .filter((node: any) => {
                const nextInsideReqRoot = insideReqRoot || getRootNo(node?.title) === "7";
                if (!nextInsideReqRoot) return true;
                const isReqDetailNode = node.label === "__auto_req_detail" || isFunctionalKvTable(node.table);
                const code = normalizeSrsCodeForSync(node.srs_code || (isFunctionalKvTable(node.table) ? extractSrsCodeFromTable(node.table) : ""));
                const key = normalizeReqDetailKey(node.req_detail_key || getTableReqDetailKey(node.table));
                if (isReqDetailNode && key && deletedKeys.has(key) && code && codeSets.standardCodes.has(code)) {
                    return true;
                }
                if (isReqDetailNode && key && deletedKeys.has(key)) return false;
                if (isReqDetailNode && key.startsWith("change_reqd_") && code && !codeSets.changeCodes.has(code)) {
                    return codeSets.standardCodes.has(code);
                }
                if (isReqDetailNode && node.label === "__auto_req_detail" && code && !codeSets.changeCodes.has(code) && !codeSets.standardCodes.has(code)) {
                    return false;
                }
                if (isReqDetailNode && code && deletedCodes.has(code) && !codeSets.allCodes.has(code)) return false;
                if ((node.label === "__auto_req_group" || !node.label) && isEmptyGeneratedHeading(node)) return false;
                return true;
            });
        return walk(tree || []);
    };

    // 加载产品相关的 RCM 列表（用于章节 RCM 选择控件）
    const loadProductRcm = (productId?: number) => {
        if (!productId) {
            dispatch({ rcmOptions: [] });
            return;
        }
        ApiProdRcm.list_prod_rcm({
            prod_id: productId,
            page_index: 0,
            page_size: 10000,
        }).then((res: any) => {
            if (res.code === ApiProdRcm.C_OK) {
                const rcmOptions = (res.data?.rows || []).map((item: any) => ({
                    value: item.rcm_id,
                    label: item.code,
                    description: item.description || "",
                }));
                dispatch({ rcmOptions });
            } else {
                dispatch({ rcmOptions: [] });
            }
        }).catch(() => {
            dispatch({ rcmOptions: [] });
        });
    };

    useEffect(() => {
        if (isReadOnly) {
            dispatch({ rcmOptions: [] });
            return;
        }
        loadProductRcm(displayProductId ? Number(displayProductId) : undefined);
    }, [displayProductId, isReadOnly]);

    // 新增：仅自动同步「产品名称 / 产品型号」单行字段，适用范围沿用上方 applyProductScopeToTree，不改动
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
    }, [displayProductId, currentProduct?.scope, currentProduct?.name, currentProduct?.type_code]);

    useEffect(() => {
        if (params.id || data.loading || !(data.treeStructure as TreeNode[] || []).length) return;
        const { nodes, changed } = ensureStandardTemplateChildren(data.treeStructure as TreeNode[]);
        if (changed) {
            treeStructureRef.current = nodes;
            dispatch({ treeStructure: nodes });
        }
    }, [params.id, data.loading, data.treeStructure]);

    // 将后端数据转换为前端格式
    const parseTreeNode = (node: any): TreeNode => {
        const table = node.table;
        const tableName = String(table?.name || node.title || node.label || "").trim();
        const isChangeTableShell = /变更/.test(tableName);
        const hasHeaders = Array.isArray(table?.headers) && table.headers.length > 0;
        const hasRows = Array.isArray(table?.rows) && table.rows.length > 0;
        const hasCells = Array.isArray(table?.cells) && table.cells.length > 0;
        const hasValidTable = !!(
            table &&
            table.headers !== null &&
            table.rows !== null &&
            hasHeaders &&
            (hasRows || hasCells || isChangeTableShell)
        );
        return {
            id: node.n_id || node.id || 0, // 使用后端的n_id作为前端的id
            doc_id: node.doc_id || 0,
            n_id: node.n_id || 0,
            p_id: node.p_id || 0,
            title: node.title || "",
            // 保留 srs_code：后端有该字段（含空字符串）则带上，用于“有该字段就显示输入框”
            ...(node.srs_code !== undefined && { srs_code: node.srs_code }),
            ...(node.rcm_codes !== undefined && { rcm_codes: node.rcm_codes }),
            text: node.text || "",
            ...(node.ref_type !== undefined && { ref_type: node.ref_type }),
            ...(node.img_url !== undefined && { img_url: node.img_url ?? "" }),
            // label 不展示，但需保留以便上传时传给后端
            ...(node.label !== undefined && { label: node.label ?? "" }),
            ...(node.req_detail_key !== undefined && { req_detail_key: node.req_detail_key ?? "" }),
            table: hasValidTable ? table : {},
            children: (node.children || []).map((child: any) => parseTreeNode(child))
        };
    };

    const flattenTreeNodes = (nodes: TreeNode[]): TreeNode[] => {
        const result: TreeNode[] = [];
        const walk = (items: TreeNode[]) => {
            items.forEach((item) => {
                result.push(item);
                if (item.children?.length) walk(item.children);
            });
        };
        walk(nodes || []);
        return result;
    };

    const extractCoverTitleFromTree = (nodes: TreeNode[]): string => {
        const all = flattenTreeNodes(nodes);
        const exact = all.find((n) => /需求规格说明/.test((n.title || "").trim()));
        if (exact?.title) return exact.title.trim();
        const firstChinese = all.find((n) => /[\u4e00-\u9fff]/.test((n.title || "").trim()) && (n.title || "").trim().length <= 20);
        return (firstChinese?.title || "").trim();
    };

    const extractFileNoFromTree = (nodes: TreeNode[]): string => {
        const all = flattenTreeNodes(nodes);
        const textPool = all
            .flatMap((n) => [n.title || "", n.text || ""])
            .filter(Boolean)
            .join("\n");
        const matches = textPool.match(/[A-Za-z0-9]{1,12}(?:-[A-Za-z0-9]{1,16}){3,}/g) || [];
        if (!matches.length) return "";
        return matches.sort((a, b) => b.length - a.length)[0] || "";
    };

    const isIncompleteFileNo = (value?: string) => {
        const v = (value || "").trim();
        return !v || v.length < 8 || !v.includes("-");
    };

    const buildSrsTableState = (reqRes: any, typeRes: any) => {
        if (reqRes.code !== Api.C_OK) {
            throw new Error(reqRes.msg || "加载SRS表数据失败");
        }
        const rows = reqRes.data?.rows || [];
        const mainData = rows
            .filter((item: any) => item.type_code === "1" && !String(item.code || "").startsWith("TMP-SRS-"))
            .map((item: any, index: number) => ({
                key: item.id || `main_${index}_${Date.now()}`,
                id: item.id,
                doc_id: item.doc_id,
                srs_code: item.code || "",
                module: normalizeReqText(item.module),
                function: normalizeReqText(item.function),
                sub_function: normalizeReqText(item.sub_function),
                location: item.location || "",
                type_code: item.type_code || "1",
            }));
        const otherData = rows
            .filter((item: any) => item.type_code === "2")
            .map((item: any, index: number) => ({
                key: item.id || `other_${index}_${Date.now()}`,
                id: item.id,
                doc_id: item.doc_id,
                srs_code: item.code || "",
                module: item.module || "",
                location: item.location || "",
                type_code: item.type_code || "2",
            }));

        const typeRows = typeRes.code === ApiSrsType.C_OK ? (typeRes.data?.rows || []) : [];
        const isBaseReq = (r: any) => r?.type_code === "1" || r?.type_code === "2";
        const toChangeRow = (reqItem: any, keyPrefix: string, reqIndex: number) => ({
            key: reqItem.id || `${keyPrefix}_${reqIndex}_${Date.now()}`,
            id: reqItem.id,
            doc_id: reqItem.doc_id,
            srs_code: reqItem.code || "",
            module: normalizeReqText(reqItem.module),
            function: normalizeReqText(reqItem.function),
            sub_function: normalizeReqText(reqItem.sub_function),
            location: reqItem.location || "",
            type_code: reqItem.type_code || "",
        });
        const allChangeRows = rows.filter((reqItem: any) => !isBaseReq(reqItem));
        const groupedByType = new Map<string, any[]>();
        allChangeRows.forEach((reqItem: any) => {
            const code = String(reqItem.type_code || "");
            if (!code) return;
            const list = groupedByType.get(code) || [];
            list.push(reqItem);
            groupedByType.set(code, list);
        });
        const getTypeSortKey = (item: any) => {
            const createTime = item?.create_time ? new Date(item.create_time).getTime() : 0;
            if (Number.isFinite(createTime) && createTime > 0) return createTime;
            return Number(item?.id || 0);
        };
        const sortedTypeRows = typeRows
            .filter((item: any) => !isBaseChangeTypeCode(item?.type_code))
            .sort((left: any, right: any) => getTypeSortKey(left) - getTypeSortKey(right));
        const seenTypeCodes = new Set<string>();
        const changeTablesData = sortedTypeRows.reduce((result: any[], item: any, index: number) => {
            const code = String(item.type_code || "");
            if (!code || seenTypeCodes.has(code)) return result;
            seenTypeCodes.add(code);
            const tableRows = (groupedByType.get(code) || []).map((reqItem: any, reqIndex: number) =>
                toChangeRow(reqItem, `change_${code || index}`, reqIndex)
            );
            result.push({
                id: item.id || `change_${code || index}`,
                title: item.type_name || `变更表${index + 1}`,
                type_code: code,
                create_time: item.create_time,
                data: tableRows,
            });
            return result;
        }, []);
        const orphanTypeCodes = [...groupedByType.keys()]
            .filter((code) => !seenTypeCodes.has(code))
            .sort((left, right) => {
                const minReqIdForType = (code: string) => {
                    const ids = (groupedByType.get(code) || []).map((item: any) => Number(item?.id || 0)).filter((id) => id > 0);
                    return ids.length ? Math.min(...ids) : Number.MAX_SAFE_INTEGER;
                };
                return minReqIdForType(left) - minReqIdForType(right);
            });
        orphanTypeCodes.forEach((code) => {
            seenTypeCodes.add(code);
            const reqItems = groupedByType.get(code) || [];
            const tableRows = reqItems.map((reqItem: any, reqIndex: number) =>
                toChangeRow(reqItem, `change_${code}`, reqIndex)
            );
            changeTablesData.push({
                id: `change_${code}`,
                title: "变更需求",
                type_code: code,
                data: tableRows,
            });
        });

        return { srsTableData: mainData, srsOtherReqData: otherData, srsChangeTables: sortSrsChangeTables(changeTablesData) };
    };

    const fetchSrsTableState = async (docId: number) => {
        const [reqRes, typeRes]: any[] = await Promise.all([
            ApiSrsReq.list_srs_req({
                doc_id: docId,
                page_index: 0,
                page_size: 10000,
            }),
            ApiSrsType.list_srs_type({
                doc_id: docId,
                page_index: 0,
                page_size: 10000,
            }),
        ]);
        return buildSrsTableState(reqRes, typeRes);
    };

    const buildReqDetailsForTreeSync = (srsTableState: { srsTableData: any[]; srsChangeTables: any[] }) => {
        const getReqIdentityKey = (item: any) => [
            normalizeSrsCodeForSync(item?.srs_code || item?.code || ""),
            normalizeReqText(item?.module),
            normalizeReqText(item?.function),
            normalizeReqText(item?.sub_function),
        ].join("|");
        const standardReqKeyByIdentity = new Map<string, string>();
        (srsTableState.srsTableData || []).forEach((item: any) => {
            const key = getReqIdentityKey(item);
            if (key.replace(/\|/g, "") && item?.id) {
                standardReqKeyByIdentity.set(key, `reqd_${item.id}`);
            }
        });
        return [
            ...(srsTableState.srsTableData || []).map((item: any) => ({
                code: normalizeSrsCodeForSync(item?.srs_code || item?.code || ""),
                name: normalizeReqText(item?.sub_function || item?.function || item?.module),
                module: normalizeReqText(item?.module),
                function: normalizeReqText(item?.function),
                sub_function: normalizeReqText(item?.sub_function),
                type_code: "1",
                req_detail_key: item?.id ? `reqd_${item.id}` : "",
            })),
            ...(srsTableState.srsChangeTables || []).flatMap((changeTable: any) => (changeTable.data || []).map((item: any) => {
                const identityKey = getReqIdentityKey(item);
                const reqId = item?.id || 0;
                const typeCode = item?.type_code || changeTable?.type_code;
                const isChangeType = !!String(typeCode || "") && !["1", "2"].includes(String(typeCode || ""));
                return {
                    code: normalizeSrsCodeForSync(item?.srs_code || item?.code || ""),
                    name: normalizeReqText(item?.sub_function || item?.function || item?.module),
                    module: normalizeReqText(item?.module),
                    function: normalizeReqText(item?.function),
                    sub_function: normalizeReqText(item?.sub_function),
                    type_code: typeCode,
                    req_detail_key: isChangeType && reqId
                        ? `change_reqd_${reqId}`
                        : (standardReqKeyByIdentity.get(identityKey) || ""),
                };
            })),
        ].filter((item: any) => item.code);
    };

    const FIXED_TEMPLATE_SECTIONS: Record<string, string> = {
        "2.1": "软件总体描述",
        "2.2": "物理拓扑图",
        "2.3": "系统结构图",
        "2.4": "运行环境",
        "2.5": "数据库要求",
        "2.6": "算法和数据要求",
        "2.7": "性能要求",
    };
    const extractSrsCodeFromNodeText = (text?: string) => {
        const matched = String(text || "").match(/SRS-[A-Z]+\d+-\d+/i);
        return matched?.[0] || "";
    };
    const isFixedSectionCompatibleCode = (code?: string, headingNo?: string) => {
        const normalized = normalizeSrsCodeForSync(code);
        if (!normalized || !headingNo) return false;
        if (headingNo.split(".")[0] === "2") {
            return /^SRS-RCN30[02]-/i.test(normalized);
        }
        return true;
    };
    const resolveFixedSectionSrsCode = (node: TreeNode, headingNo: string, otherReqCode?: string) => {
        const normalizedOther = normalizeSrsCodeForSync(otherReqCode || "");
        if (normalizedOther) return normalizedOther;
        const candidates = [node.srs_code ?? undefined, extractSrsCodeFromNodeText(node.text)]
            .map((value) => normalizeSrsCodeForSync(value))
            .filter(Boolean);
        return candidates.find((code) => isFixedSectionCompatibleCode(code, headingNo)) || "";
    };
    const otherReqSyncOptions = {
        fixedTemplateSections: FIXED_TEMPLATE_SECTIONS,
        resolveSrsCode: (node: TreeNode, headingNo: string, otherReqCode?: string) => (
            resolveFixedSectionSrsCode(node, headingNo, otherReqCode)
        ),
        isCodeCompatible: (code: string, headingNo: string) => isFixedSectionCompatibleCode(code, headingNo),
    };

    const syncTreeWithSrsTableState = (
        tree: TreeNode[],
        srsTableState: { srsTableData: any[]; srsOtherReqData: any[]; srsChangeTables: any[] },
        options?: { appendMissingChangeTables?: boolean },
    ): TreeNode[] => {
        const normalizedTree = normalizeChangeTableNodeTitles(tree || []);
        const treeAfterChangeTableSync = syncChangeReqTablesToTree(normalizedTree, srsTableState.srsChangeTables);
        const detailsForSync = buildReqDetailsForTreeSync(srsTableState);
        const synced = detailsForSync.length
            ? appendChangeReqDetailsToTree(treeAfterChangeTableSync, detailsForSync)
            : treeAfterChangeTableSync;
        const pruned = dedupeChangeTableNodesInTree(
            flattenRedundantReqDetailLayers(pruneEmptyReqChapterShells(synced)),
        );
        const treeWithChangeTables = options?.appendMissingChangeTables
            ? appendMissingChangeTablesForExport(pruned, srsTableState)
            : pruned;
        return syncTreeWithOtherReqState(
            treeWithChangeTables,
            srsTableState.srsOtherReqData || [],
            otherReqSyncOptions,
        );
    };

    useEffect(() => {
        const id = params.id;
        if (id) {
            // 编辑模式
            dispatch({ loading: true, isEdit: true });
            Promise.all([Api.get_srs_doc({ id }), fetchSrsTableState(parseInt(id))]).then(async ([res, srsTableState]: any[]) => {
                if (res.code === Api.C_OK) {
                    const targetRow = res.data;
                    
                    const parsedContentRaw = (targetRow.content || []).map((node: any) => parseTreeNode(node));
                    const loadProduct = (data.products as any[]).find((p: any) => p.id === targetRow.product_id);
                    const remappedContent = await remapProductBoundDocImages(
                        parsedContentRaw,
                        targetRow.product_id,
                        targetRow.version,
                        loadProduct?.full_version || targetRow.product_version,
                    );
                    const parsedContent = dedupeChangeTableNodesInTree(
                        syncTreeWithSrsTableState(remappedContent, srsTableState),
                    );
                    const derivedCoverTitle = extractCoverTitleFromTree(parsedContent);
                    const derivedFileNo = extractFileNoFromTree(parsedContent);

                    // 映射后端字段名到表单字段名
                    editForm.setFieldsValue({
                        id: targetRow.id,
                        product_id: targetRow.product_id,
                        version: targetRow.version, // 后端 version -> 前端 full_version
                        folder_name: targetRow.folder_name || derivedCoverTitle || "",
                        file_no: isIncompleteFileNo(targetRow.file_no) ? (derivedFileNo || targetRow.file_no || "") : targetRow.file_no,
                    });
                    
                    dispatch({ 
                        loading: false,
                        changeDescription: targetRow.change_log || "",
                        docNId: targetRow.n_id || 0, // 保存文档级别的 n_id
                        treeStructure: parsedContent,
                        docProductId: targetRow.product_id,
                        docVersion: targetRow.version ?? "",
                        srsTableData: srsTableState.srsTableData,
                        srsOtherReqData: srsTableState.srsOtherReqData,
                        srsChangeTables: srsTableState.srsChangeTables,
                        srsTableLoading: false,
                    });
                    treeStructureRef.current = parsedContent;
                    initialEditTreeRef.current = cloneTree(parsedContent);
                    loadReqListData();
                } else {
                    message.error(res.msg);
                    dispatch({ loading: false });
                    navigate("/srs_docs");
                }
            }).catch((error: any) => {
                console.error("加载SRS文档失败:", error);
                message.error(error?.message || "加载SRS文档失败");
                dispatch({ loading: false, srsTableLoading: false });
                navigate("/srs_docs");
            });
        } else {
            // 新增模式
            editForm.resetFields();
            const initialTree = buildStandardNodesWithIds();
            initialEditTreeRef.current = [];
            dispatch({
                isEdit: false,
                srsTableData: [],
                srsOtherReqData: [],
                srsChangeTables: [],
                treeStructure: initialTree,
            });
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

    const buildDuplicateVersionMessage = (version?: string) => {
        const displayVersion = String(version || "").trim();
        return displayVersion ? `该产品下已经有${displayVersion}版本文档存在` : ts("msg_obj_exist");
    };

    const validateSrsDocVersionUnique = async (productId?: number, version?: string, currentDocId: number = 0) => {
        const normalizedVersion = String(version || "").trim();
        if (!productId || !normalizedVersion) return "";
        try {
            const res: any = await Api.list_srs_doc({
                product_id: productId,
                version: normalizedVersion,
                page_index: 0,
                page_size: 1000,
            });
            if (res.code !== Api.C_OK) return "";
            const duplicated = (res.data?.rows || []).some((row: any) => {
                return Number(row.id) !== Number(currentDocId) && String(row.version || "").trim() === normalizedVersion;
            });
            return duplicated ? buildDuplicateVersionMessage(normalizedVersion) : "";
        } catch (error) {
            console.error("校验SRS文档版本失败:", error);
            return "";
        }
    };

    const doSave = () => {
        editForm.validateFields().then(async (values) => {
            const currentTree = ((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) as TreeNode[];
            // 包含变更说明和所有表单字段（包括 product_id 和 version）
            const submitData = {
                ...values,
                change_description: data.changeDescription,
                tree_structure: currentTree,
            };
            // 确保 version 字段被包含
            if (!submitData.version && editForm.getFieldValue("version")) {
                submitData.version = editForm.getFieldValue("version");
            }
            const duplicateMsg = await validateSrsDocVersionUnique(submitData.product_id, submitData.version, params.id ? Number(params.id) : 0);
            if (duplicateMsg) {
                message.error(duplicateMsg);
                return;
            }
            dispatch({ loading: true });
            const fn_request = data.isEdit ? Api.update_srs_doc : Api.add_srs_doc;
            fn_request(submitData).then((res: any) => {
                if (res.code === Api.C_OK) {
                    dispatch({ loading: false });
                    message.success(res.msg);
                    navigate("/srs_docs");
                } else {
                    dispatch({ loading: false });
                    message.error(res.msg === "数据已存在！" ? buildDuplicateVersionMessage(submitData.version) : res.msg);
                }
            });
        });
    };

    const handleExport = () => {
        if (!data.isEdit || !params.id) {
            message.warning(ts("srs_doc.please_save_document_first"));
            return;
        }
        editForm.validateFields().then(async () => {
            const docId = parseInt(params.id as string);
            let exportTableState = {
                srsTableData: data.srsTableData || [],
                srsOtherReqData: data.srsOtherReqData || [],
                srsChangeTables: data.srsChangeTables || [],
            };
            try {
                exportTableState = mergeExportTableState(
                    await fetchSrsTableState(docId),
                    exportTableState,
                );
            } catch {
                // 保留当前页已加载的数据
            }
            const currentTree = syncChangeReqTablesToTree(
                (((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) || []) as TreeNode[],
                exportTableState.srsChangeTables || []
            );
            const exportTree = appendMissingChangeTablesForExport(
                syncExportReqTablesInTree(currentTree, exportTableState, currentTree),
                exportTableState,
            );
            const cleanedContent = exportTree.map((node: any) => cleanTreeNode(node, docId, 0));
            if (!cleanedContent.length) {
                message.error("保存失败：当前文档结构为空，请刷新后重试");
                return;
            }
            const payload = {
                id: docId,
                product_id: editForm.getFieldValue("product_id"),
                version: editForm.getFieldValue("version"),
                file_no: editForm.getFieldValue("file_no"),
                folder_name: editForm.getFieldValue("folder_name"),
                change_log: data.changeDescription || "",
                content: cleanedContent,
                n_id: data.docNId || 0,
            };

            dispatch({ exporting: true });
            Api.export_srs_doc_snapshot(payload).then((res: any) => {
                    dispatch({ exporting: false });
                    if (res.code !== Api.C_OK) {
                        message.error(res.msg);
                    } else {
                        message.success("导出成功");
                    }
            }).catch(() => {
                dispatch({ exporting: false });
                message.error("导出失败");
            });
        }).catch(() => {
            message.error(ts("save_failed"));
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
            message.warning(ts("srs_doc.please_select_product_and_version"));
            return;
        }

        const nodesWithIds = applyProductScopeToTree(buildStandardNodesWithIds(), currentProduct).nodes;
        // dispatch({ treeStructure: [...data.treeStructure, ...nodesWithIds] });
        treeStructureRef.current = nodesWithIds;
        dispatch({ treeStructure: nodesWithIds });
        message.success(ts("srs_doc.load_standard_structure_success"));
    };

    // 删除节点
    const handleNodeDelete = async (docId: number, nodeId: number): Promise<boolean> => {
        try {
            const res = await Api.delete_srs_node({ doc_id: docId, n_id: nodeId });
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
        // - 如果是 null、空对象、或 headers/rows 为 null，设置为空对象 {}
        // - 只有当 headers 和 rows 都有效时才保留
        let tableValue: any = {};
        const changeTableTitle = String(node.table?.name || node.title || node.label || "").trim();
        const isChangeTableNode = /变更/.test(changeTableTitle);
        if (node.table) {
            const hasValidHeaders = node.table.headers && Array.isArray(node.table.headers) && node.table.headers.length > 0;
            const hasValidRows = node.table.rows && Array.isArray(node.table.rows) && node.table.rows.length > 0;
            if (hasValidHeaders && hasValidRows) {
                // 仅「真正含合并单元格」的表格保留 cells（避免导入合并表后保存丢失合并信息）；
                // 普通表格仍剥离 cells，保持原有编辑/保存行为不受影响
                const hasRealMerge = Array.isArray(node.table.cells)
                    && node.table.cells.some((row: any) => Array.isArray(row)
                        && row.some((c: any) => Number(c?.col_span) > 1 || Number(c?.row_span) > 1));
                tableValue = isExportReqTable(node.table)
                    ? flattenExportReqTable(node.table)
                    : (hasRealMerge ? { ...node.table } : { ...node.table, cells: undefined });
            } else if (hasValidHeaders && isChangeTableNode) {
                tableValue = {
                    name: node.table.name || changeTableTitle,
                    headers: node.table.headers,
                    rows: Array.isArray(node.table.rows) ? node.table.rows : [],
                };
            }
        }

        const isProductBoundImageNode = !!resolveProductBoundDocImageRefType(node);
        const cleaned: any = {
            doc_id: node.doc_id || docId || 0,
            n_id: (typeof node.id === 'string' || !node.n_id) ? 0 : node.n_id, // 新节点的n_id为0，让后端生成
            p_id: node.p_id || parentId || 0,
            title: node.title || (isChangeTableNode ? changeTableTitle : ""),
            // 有 srs_code 字段则一并提交，便于后端返回后继续显示输入框
            ...(node.srs_code !== undefined && { srs_code: node.srs_code }),
            // 有 rcm_codes 字段则一并提交，便于后端返回后继续显示章节 RCM 选择结果
            ...(node.rcm_codes !== undefined && { rcm_codes: node.rcm_codes }),
            text: node.text || "",
            ...(node.ref_type !== undefined && { ref_type: node.ref_type }),
            // 物理拓扑图/系统结构图以图表文件库为准，不在节点上持久化 img_url
            ...(node.img_url !== undefined && { img_url: isProductBoundImageNode ? "" : (node.img_url ?? "") }),
            // label 不展示，但需一并提交给后端
            ...(node.label !== undefined && { label: node.label ?? "" }),
            ...(node.req_detail_key !== undefined && { req_detail_key: node.req_detail_key ?? "" }),
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

    // 加载SRS表数据
    const loadSrsTableData = (silent = false) => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId) {
            return;
        }
        if (!silent) {
            dispatch({ srsTableLoading: true });
        }
        fetchSrsTableState(docId).then((srsTableState) => {
            const baseTree = (treeStructureRef.current?.length ? treeStructureRef.current : data.treeStructure) as TreeNode[];
            const syncedTree = baseTree?.length
                ? dedupeChangeTableNodesInTree(
                    pruneDetachedManualChangeTableNodes(
                        syncChangeReqTablesToTree(
                            normalizeChangeTableNodeTitles(baseTree as TreeNode[]),
                            srsTableState.srsChangeTables,
                        ),
                        srsTableState.srsChangeTables,
                    ),
                )
                : baseTree;
            if (syncedTree?.length) {
                treeStructureRef.current = syncedTree;
            }
            dispatch({
                srsTableData: srsTableState.srsTableData,
                srsOtherReqData: srsTableState.srsOtherReqData,
                srsChangeTables: sortSrsChangeTables(srsTableState.srsChangeTables),
                ...(syncedTree?.length ? { treeStructure: syncedTree } : {}),
                ...(silent ? {} : { srsTableLoading: false }),
            });
        }).catch((error: any) => {
            console.error("加载SRS表数据失败:", error);
            if (!silent) {
                message.error("加载SRS表数据失败");
                dispatch({ srsTableData: [], srsOtherReqData: [], srsChangeTables: [], srsTableLoading: false });
            }
        });
    };

    useEffect(() => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId || isReadOnly) return;
        const baseTree = (treeStructureRef.current?.length ? treeStructureRef.current : data.treeStructure) as TreeNode[];
        if (!baseTree?.length || !(data.srsOtherReqData || []).length) return;
        const synced = syncTreeWithOtherReqState(baseTree, data.srsOtherReqData || [], otherReqSyncOptions);
        treeStructureRef.current = synced;
        dispatch({ treeStructure: synced });
    }, [data.srsOtherReqData]);

    useEffect(() => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId) return;
        const refreshLatestSrsTables = () => {
            if (document.hidden) return;
            const now = Date.now();
            if (now - srsTableRefreshAtRef.current < 1500) return;
            srsTableRefreshAtRef.current = now;
            loadSrsTableData(true);
        };
        window.addEventListener("focus", refreshLatestSrsTables);
        document.addEventListener("visibilitychange", refreshLatestSrsTables);
        return () => {
            window.removeEventListener("focus", refreshLatestSrsTables);
            document.removeEventListener("visibilitychange", refreshLatestSrsTables);
        };
    }, [params.id]);

    const openAddChangeTableModal = () => {
        dispatch({
            showAddChangeTableModal: true,
            newChangeTableName: `变更需求${(data.srsChangeTables || []).length + 1}`,
        });
    };

    const handleAddChangeTableInCurrentPage = async () => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId) {
            message.warning("缺少文档信息");
            return;
        }
        const typeName = String(data.newChangeTableName || "").trim();
        if (!typeName) {
            message.warning("请输入表名");
            return;
        }
        const isDuplicateChangeTableName = (data.srsChangeTables || []).some(
            (item: any) => String(item?.title || "").trim() === typeName
        );
        if (isDuplicateChangeTableName) {
            message.warning("表名已存在，不允许重复");
            return;
        }
        try {
            dispatch({ srsTableLoading: true });
            const res: any = await ApiSrsType.add_srs_type({
                doc_id: docId,
                type_name: typeName,
            });
            if (res.code !== ApiSrsType.C_OK) {
                throw new Error(res.msg || "新增变更表格失败");
            }
            const created = res.data || {};
            const srsTableState = await fetchSrsTableState(docId);
            const createdTable = created.type_code
                ? {
                            id: created.id || `change_${created.type_code}`,
                            title: created.type_name || typeName,
                            type_code: created.type_code,
                    create_time: created.create_time,
                            data: [],
                }
                : undefined;
            const nextChangeTables = created.type_code
                ? moveChangeTableToEnd(srsTableState.srsChangeTables, created.type_code)
                : sortSrsChangeTables(srsTableState.srsChangeTables);
            dispatch({
                srsTableData: srsTableState.srsTableData,
                srsOtherReqData: srsTableState.srsOtherReqData,
                srsChangeTables: nextChangeTables,
                srsTableLoading: false,
                showAddChangeTableModal: false,
                newChangeTableName: "",
            });
            if (createdTable) {
                const headers = [
                    { code: "srs_code", name: ts("srs_doc.srs_code") || "需求编号" },
                    { code: "module", name: ts("srs_doc.module") || "模块" },
                    { code: "function", name: ts("srs_doc.function") || "功能" },
                    { code: "sub_function", name: ts("srs_doc.sub_function") || "子功能" },
                ];
                dispatch({
                    changeReqEditTarget: createdTable,
                    changeReqEditInitialData: {
                        tableName: createdTable.title || "",
                        type_code: createdTable.type_code,
                        tableId: createdTable.id,
                        headers,
                        data: [],
                        rowMeta: [],
                    },
                    showChangeReqEditModal: true,
                });
            }
            message.success("变更表格已新增");
        } catch (error: any) {
            dispatch({ srsTableLoading: false });
            message.error(error?.message || "新增变更表格失败");
        }
    };

    const openChangeReqEditModal = (table: { id: number | string; title: string; type_code?: string; data: any[] }) => {
        const headers = [
            { code: "srs_code", name: ts("srs_doc.srs_code") || "需求编号" },
            { code: "module", name: ts("srs_doc.module") || "模块" },
            { code: "function", name: ts("srs_doc.function") || "功能" },
            { code: "sub_function", name: ts("srs_doc.sub_function") || "子功能" },
        ];
        const initialData: TableDataWithHeaders = {
            tableName: table.title || "",
            type_code: table.type_code,
            tableId: table.id,
            headers,
            data: (table.data || []).map((row: any) => [
                row?.srs_code || "",
                row?.module || "",
                row?.function || "",
                row?.sub_function || "",
            ]),
            rowMeta: (table.data || []).map((row: any) => ({
                req_id: row?.id || 0,
                req_detail_key: row?.id ? `change_reqd_${row.id}` : "",
            })),
        };
        dispatch({
            changeReqEditTarget: table,
            changeReqEditInitialData: initialData,
            showChangeReqEditModal: true,
        });
    };

    const handleDeleteChangeReqTableInCurrentPage = async (table: { id: number | string; title: string; type_code?: string; data: any[] }) => {
        const docId = params.id ? parseInt(params.id) : 0;
        const targetTitle = String(table?.title || "").trim();
        // 外部删除按钮传入的 table.data 可能不完整（例如树节点删除路径 data=[]），
        // 以父组件 srsChangeTables 为准，和弹窗保存 deletedOldRows 同一数据来源。
        const matchedChangeTable = (data.srsChangeTables || []).find((item: any) => (
            String(item?.id) === String(table?.id) || matchesChangeTableTitle(item?.title, targetTitle)
        ));
        const deletedRows = [...(matchedChangeTable?.data || table?.data || [])];
        const resolveDeleteTypeId = async (): Promise<number> => {
            let candidate = Number(matchedChangeTable?.id);
            if (Number.isFinite(candidate) && candidate > 0 && candidate < 1_000_000_000) {
                return candidate;
            }
            if (!docId || !targetTitle) return NaN;
            const typeRes: any = await ApiSrsType.list_srs_type({ doc_id: docId, page_index: 0, page_size: 10000 });
            if (typeRes.code !== ApiSrsType.C_OK) return NaN;
            const matched = (typeRes.data?.rows || []).find((item: any) => (
                matchesChangeTableTitle(item?.type_name, targetTitle)
            ));
            return matched?.id ? Number(matched.id) : NaN;
        };
        // 当前被删的变更表，syncChangeReqTablesToTree 只能覆盖 rows、不会删节点。
        // 这里显式地把树里 table.name / title 匹配这张表的变更表节点整个移除，
        // 以及移除"导入表格X"包壳的 Word 导入变更表节点，避免页面 2.1 章节仍展示该表。
        const removeMatchingChangeTableNode = (items: TreeNode[]): TreeNode[] => (
            (items || [])
                .map((node: any) => ({
                    ...node,
                    children: removeMatchingChangeTableNode(node.children || []),
                }))
                .filter((node: any) => {
                    if (!isTreeChangeTableNode(node)) return true;
                    const nodeTitle = getNodeChangeTableTitle(node);
                    return !matchesChangeTableTitle(nodeTitle, targetTitle);
                })
        );
        const removeEmptyMatchingChangeTableShells = (items: TreeNode[]): TreeNode[] => (
            (items || [])
                .map((node: any) => ({
                    ...node,
                    children: removeEmptyMatchingChangeTableShells(node.children || []),
                }))
                .filter((node: any) => {
                    if (!isTreeChangeTableNode(node)) return true;
                    const nodeTitle = getNodeChangeTableTitle(node);
                    if (!matchesChangeTableTitle(nodeTitle, targetTitle)) return true;
                    const rows = node?.table?.rows || [];
                    return Array.isArray(rows) && rows.length > 0;
                })
        );
        const stripDeletedChangeTableArtifacts = (items: TreeNode[]): TreeNode[] => (
            removeEmptyMatchingChangeTableShells(removeMatchingChangeTableNode(items))
        );
        const reloadDocTreeAfterChangeTableDelete = async () => {
            const reloadRes: any = await Api.get_srs_doc({ id: docId });
            if (reloadRes.code !== Api.C_OK) {
                throw new Error(reloadRes.msg || "刷新文档失败");
            }
            const targetRow = reloadRes.data;
            const parsedContentRaw = (targetRow.content || []).map((node: any) => parseTreeNode(node));
            const reloadProduct = (data.products as any[]).find((p: any) => p.id === targetRow.product_id);
            const remappedContent = await remapProductBoundDocImages(
                parsedContentRaw,
                targetRow.product_id,
                targetRow.version,
                reloadProduct?.full_version || targetRow.product_version,
            );
            let syncedTree = dedupeChangeTableNodesInTree(
                stripDeletedChangeTableArtifacts(remappedContent as TreeNode[]),
            );
            const needPersistTree = treeHasMatchingChangeTable(remappedContent as TreeNode[], targetTitle)
                || JSON.stringify(syncedTree) !== JSON.stringify(
                    dedupeChangeTableNodesInTree(remappedContent as TreeNode[]),
                );
            if (needPersistTree) {
                const cleanedContent = syncedTree.map((node: any) => cleanTreeNode(node, docId, 0));
                const saveRes: any = await Api.update_srs_doc({
                    id: docId,
                    product_id: editForm.getFieldValue("product_id"),
                    version: editForm.getFieldValue("version"),
                    file_no: editForm.getFieldValue("file_no"),
                    folder_name: editForm.getFieldValue("folder_name"),
                    change_log: data.changeDescription || "",
                    content: cleanedContent,
                    n_id: targetRow.n_id || 0,
                });
                if (saveRes.code !== Api.C_OK) {
                    throw new Error(saveRes.msg || "删除后文档同步保存失败");
                }
                const reloadRes2: any = await Api.get_srs_doc({ id: docId });
                if (reloadRes2.code === Api.C_OK) {
                    const parsed2 = (reloadRes2.data.content || []).map((node: any) => parseTreeNode(node));
                    const remapped2 = await remapProductBoundDocImages(
                        parsed2,
                        reloadRes2.data.product_id,
                        reloadRes2.data.version,
                        reloadProduct?.full_version || reloadRes2.data.product_version,
                    );
                    syncedTree = dedupeChangeTableNodesInTree(
                        stripDeletedChangeTableArtifacts(remapped2 as TreeNode[]),
                    );
                }
            }
            const srsTableState = docId
                ? await fetchSrsTableState(docId)
                : { srsTableData: [], srsOtherReqData: [], srsChangeTables: [] };
            const stillInDb = (srsTableState.srsChangeTables || []).some((item: any) => (
                matchesChangeTableTitle(item?.title, targetTitle)
            ));
            if (stillInDb) {
                throw new Error(`变更表「${targetTitle}」仍未从数据库删除，请重试`);
            }
            syncedTree = dedupeChangeTableNodesInTree(
                pruneDetachedManualChangeTableNodes(syncedTree, srsTableState.srsChangeTables),
            );
            treeStructureRef.current = syncedTree;
            dispatch({
                srsTableData: srsTableState.srsTableData,
                srsOtherReqData: srsTableState.srsOtherReqData,
                srsChangeTables: srsTableState.srsChangeTables,
                treeStructure: syncedTree,
                docNId: targetRow.n_id || 0,
                srsTableLoading: false,
            });
            return syncedTree;
        };
        const syncTreeAfterDeleteChangeTable = (
            baseTree: TreeNode[],
            srsTableState: { srsTableData: any[]; srsOtherReqData: any[]; srsChangeTables: any[] },
            rowsToPrune: any[] = deletedRows,
        ) => {
            const codeSets = buildActiveReqDetailCodeSets(srsTableState);
            const treeAfterChangeTableSync = syncChangeReqTablesToTree(baseTree, srsTableState.srsChangeTables);
            return dedupeChangeTableNodesInTree(
                pruneEmptyReqChapterShells(
                    pruneDeletedChangeReqChapters(
                        syncTreeWithSrsTableState(treeAfterChangeTableSync, srsTableState),
                        rowsToPrune,
                        codeSets,
                    ),
                ),
            );
        };
        const previewTypeId = Number(matchedChangeTable?.id ?? table?.id);
        if (!Number.isFinite(previewTypeId) || previewTypeId <= 0 || previewTypeId >= 1_000_000_000) {
            const nextChangeTables = (data.srsChangeTables || []).filter((item: any) => item.id !== table?.id);
            const currentTree = removeMatchingChangeTableNode(
                ((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) as TreeNode[],
            );
            const syncedTree = syncTreeAfterDeleteChangeTable(
                currentTree,
                {
                    srsTableData: (data.srsTableData || []) as any[],
                    srsOtherReqData: (data.srsOtherReqData || []) as any[],
                    srsChangeTables: nextChangeTables,
                },
                deletedRows,
            );
            treeStructureRef.current = syncedTree;
            dispatch({
                srsChangeTables: nextChangeTables,
                treeStructure: syncedTree,
            });
            return;
        }
        try {
            const optimisticChangeTables = (data.srsChangeTables || []).filter((item: any) => (
                String(item?.id) !== String(matchedChangeTable?.id ?? table?.id)
                && !matchesChangeTableTitle(item?.title, targetTitle)
            ));
            const optimisticTree = stripDeletedChangeTableArtifacts(
                ((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) as TreeNode[],
            );
            treeStructureRef.current = optimisticTree;
            dispatch({
                srsChangeTables: optimisticChangeTables,
                treeStructure: optimisticTree,
                srsTableLoading: true,
            });
            const typeId = await resolveDeleteTypeId();
            if (!Number.isFinite(typeId) || typeId <= 0) {
                throw new Error("未找到可删除的变更需求表，请刷新后重试");
            }
            // delete_srs_type 在后端会删除 srs_type/srs_req，并清理 srs_node 中变更表 + 7 章节功能描述。
            const res: any = await ApiSrsType.delete_srs_type({ id: typeId });
            if (res.code !== ApiSrsType.C_OK) {
                throw new Error(res.msg || "删除变更表格失败");
            }
            await reloadDocTreeAfterChangeTableDelete();
            message.success(res.msg || "删除成功");
        } catch (error: any) {
            dispatch({ srsTableLoading: false });
            message.error(error?.message || "删除变更表格失败");
        }
    };

    const handleSaveChangeReqInCurrentPage = async (tableData: TableDataWithHeaders) => {
        const docId = params.id ? parseInt(params.id) : 0;
        const target = data.changeReqEditTarget as any;
        const targetTableId = target?.id ?? tableData?.tableId;
        if (!docId) {
            message.error("变更需求保存失败：缺少文档信息");
            return;
        }

        const headers = tableData?.headers || [];
        const getHeaderIndex = (matcher: (text: string) => boolean) => headers.findIndex((header: any) => matcher(normalizeHeaderText(header?.name || header?.code)));
        const codeIndex = getHeaderIndex((text) => isReqCodeHeaderText(text));
        const moduleIndex = getHeaderIndex((text) => text.includes("模块"));
        const functionIndex = getHeaderIndex((text) => text.includes("功能") && !text.includes("子功能"));
        const subFunctionIndex = getHeaderIndex((text) => text.includes("子功能"));
        const readCell = (row: any, index: number, fallbackCode: string) => {
            if (Array.isArray(row)) return String(row?.[index] || "").trim();
            const headerCode = headers[index]?.code;
            return String(row?.[headerCode] || row?.[fallbackCode] || "").trim();
        };
        const rows = (tableData?.data || [])
            .map((row: any, index: number) => ({
                code: readCell(row, codeIndex >= 0 ? codeIndex : 0, "srs_code"),
                module: readCell(row, moduleIndex >= 0 ? moduleIndex : 1, "module"),
                function: readCell(row, functionIndex >= 0 ? functionIndex : 2, "function"),
                sub_function: readCell(row, subFunctionIndex >= 0 ? subFunctionIndex : 3, "sub_function"),
                req_id: Number(tableData.rowMeta?.[index]?.req_id || 0),
            }))
            .filter((row) => row.code || row.module || row.function || row.sub_function);
        const nextTableName = String(tableData?.tableName || "").trim();
        const tableLabel = nextTableName || String(target?.title || "").trim() || "变更需求表";
        const changeValidateMsg = validateChangeReqDataRows(
            rows.map((row) => ({
                code: row.code,
                module: row.module,
                function: row.function,
                sub_function: row.sub_function,
            })),
            tableLabel,
        );
        if (changeValidateMsg) {
            throw new Error(changeValidateMsg);
        }

        if (nextTableName) {
            const selfTypeCode = String(tableData?.type_code || target?.type_code || "");
            const isDuplicateChangeTableName = (data.srsChangeTables || []).some((item: any) => {
                const isSelf =
                    (selfTypeCode && String(item?.type_code || "") === selfTypeCode) ||
                    (targetTableId != null && String(item?.id) === String(targetTableId));
                if (isSelf) return false;
                return String(item?.title || "").trim() === nextTableName;
            });
            if (isDuplicateChangeTableName) {
                throw new Error("表名已存在，不允许重复，请修改后重试");
            }
        }

        try {
            dispatch({ savingChangeReq: true });
                const latestState = await fetchSrsTableState(docId);
            let typeCode = String(tableData?.type_code || target?.type_code || "");
            let resolvedTarget = typeCode
                ? (latestState.srsChangeTables || []).find((table: any) => String(table.type_code || "") === typeCode)
                : undefined;
            if (!resolvedTarget && targetTableId) {
                resolvedTarget = (latestState.srsChangeTables || []).find((table: any) => String(table.id) === String(targetTableId));
                typeCode = String(resolvedTarget?.type_code || typeCode || "");
            }
            if (!resolvedTarget && (nextTableName || target?.title)) {
                resolvedTarget = (latestState.srsChangeTables || []).find((table: any) =>
                    matchesChangeTableTitle(table?.title, nextTableName || target?.title)
                );
                typeCode = String(resolvedTarget?.type_code || typeCode || "");
            }
            if (!typeCode) {
                    const typeRes: any = await ApiSrsType.add_srs_type({
                        doc_id: docId,
                        type_name: nextTableName || String(target?.title || "").trim() || "变更需求",
                    });
                    if (typeRes.code !== ApiSrsType.C_OK || !typeRes.data?.type_code) {
                        throw new Error(typeRes.msg || "变更表格创建失败");
                    }
                    resolvedTarget = {
                        id: typeRes.data.id,
                        title: typeRes.data.type_name || nextTableName || target?.title || "变更需求",
                        type_code: typeRes.data.type_code,
                        data: [],
                    };
                    typeCode = String(typeRes.data.type_code || "");
            }
            if (!typeCode) {
                throw new Error("变更需求保存失败：缺少变更表类型");
            }
            if (!resolvedTarget) {
                resolvedTarget = (latestState.srsChangeTables || []).find((table: any) => String(table.type_code || "") === typeCode) || {
                    id: targetTableId || typeCode,
                    title: nextTableName || target?.title || "变更需求",
                    type_code: typeCode,
                    data: [],
                };
            }
            const targetId = Number(resolvedTarget?.id);
            const preferredTableName = nextTableName || String(target?.title || "").trim();
            if (preferredTableName && preferredTableName !== String(resolvedTarget?.title || "").trim() && Number.isFinite(targetId) && targetId > 0) {
                const typeRes: any = await ApiSrsType.update_srs_type({
                    id: targetId,
                    doc_id: docId,
                    type_name: preferredTableName,
                    type_code: typeCode,
                });
                if (typeRes.code !== ApiSrsType.C_OK) {
                    throw new Error(typeRes.msg || "表名保存失败");
                }
            }
            const oldRows = (resolvedTarget?.data || []).filter((r: any) => !!r?.id);
            const oldRowIdSet = new Set(oldRows.map((row: any) => row.id));
            const usedOldIds = new Set<number | string>();
            const getChangeReqIdentity = (item: any) => [
                normalizeSrsCodeForSync(item?.srs_code || item?.code || ""),
                normalizeReqText(item?.module),
                normalizeReqText(item?.function),
                normalizeReqText(item?.sub_function),
            ].join("|");
            const normalizeReqCode = (value?: string) => String(value || "").replace(/\s+/g, "").toUpperCase();
            const assignments: Array<{ row: any; oldRow?: any; code: string; rowIdentity: string }> = [];
            for (const row of rows) {
                const rowIdentity = getChangeReqIdentity(row);
                const matchedOldRow =
                    oldRows.find((item: any) => getChangeReqIdentity(item) === rowIdentity && !usedOldIds.has(item.id)) ||
                    (row.req_id && oldRowIdSet.has(row.req_id)
                        ? oldRows.find((item: any) => item.id === row.req_id && !usedOldIds.has(item.id))
                        : undefined);
                if (matchedOldRow?.id) {
                    usedOldIds.add(matchedOldRow.id);
                }
                assignments.push({
                    row,
                    oldRow: matchedOldRow,
                    code: normalizeReqCode(row.code),
                    rowIdentity,
                });
            }
            const deletedOldRows = oldRows.filter((oldRow: any) => oldRow?.id && !usedOldIds.has(oldRow.id));
            const normalizeSavedValue = (value: any) => normalizeReqText(value);
            const changedAssignments = assignments.filter(({ row, oldRow, code }) => {
                if (!oldRow?.id) return true;
                return normalizeReqCode(oldRow.srs_code || oldRow.code) !== code ||
                    normalizeSavedValue(oldRow.module) !== row.module ||
                    normalizeSavedValue(oldRow.function) !== row.function ||
                    normalizeSavedValue(oldRow.sub_function) !== row.sub_function;
            });
            if (changedAssignments.length === 0 && deletedOldRows.length === 0) {
                // 弹窗里看到的内容和 DB 完全一致 → 不需要再调 batch_save_srs_req。
                // 但树节点 rows 可能跟 DB 不一致（例如导入时漏入库、或上一次保存只改了 srs_req 但没刷新 srs_node），
                // 所以仍要跑一次 syncTreeWithSrsTableState 把树节点 rows / 章节联动 回到 DB 状态，
                // 否则点完保存关闭弹窗后页面仍是旧数据，看上去像"删除/修改没生效"。
                const baseTreeForRefresh = ((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) as TreeNode[];
                const codeSetsForRefresh = buildActiveReqDetailCodeSets(latestState);
                const refreshedTree = dedupeChangeTableNodesInTree(
                    pruneEmptyReqChapterShells(
                        pruneDeletedChangeReqChapters(
                            syncTreeWithSrsTableState(baseTreeForRefresh, latestState),
                            [],
                            codeSetsForRefresh,
                        ),
                    ),
                );
                treeStructureRef.current = refreshedTree;
                dispatch({
                    srsTableData: latestState.srsTableData,
                    srsOtherReqData: latestState.srsOtherReqData,
                    srsChangeTables: sortSrsChangeTables(latestState.srsChangeTables),
                    treeStructure: refreshedTree,
                    savingChangeReq: false,
                    showChangeReqEditModal: false,
                    changeReqEditInitialData: undefined,
                    changeReqEditTarget: undefined,
                });
                message.success("变更需求已保存");
                return refreshedTree;
            }
            const changedOldIds = new Set(
                changedAssignments.map((assignment) => assignment.oldRow?.id).filter((id): id is number | string => !!id)
            );
            const changedReqCodes = new Set(changedAssignments.map((assignment) => assignment.code));
            const buildSaveData = (item: any, code: string, id = 0) => ({
                id,
                doc_id: docId,
                code,
                module: item.module || "",
                function: item.function || "",
                sub_function: item.sub_function || "",
                location: item.location || "",
                type_code: typeCode,
                rcm_ids: item.rcm_ids || [],
            });
            const tempUpdates: any[] = [];
            for (const assignment of changedAssignments) {
                const oldRow = assignment.oldRow;
                if (!oldRow?.id) continue;
                const oldCode = normalizeReqCode(oldRow.srs_code || (oldRow as any).code);
                if (oldCode === assignment.code) continue;
                tempUpdates.push(buildSaveData(oldRow, `TMP-SRS-${docId}-${oldRow.id}-${Date.now()}`, oldRow.id));
            }
            for (const oldRow of oldRows) {
                if (usedOldIds.has(oldRow.id) || changedOldIds.has(oldRow.id)) continue;
                const oldCode = normalizeReqCode(oldRow.srs_code || (oldRow as any).code);
                if (!changedReqCodes.has(oldCode)) continue;
                tempUpdates.push(buildSaveData(oldRow, `TMP-SRS-${docId}-${oldRow.id}-${Date.now()}`, oldRow.id));
            }
            const upserts = changedAssignments.map(({ row, oldRow, code }) => buildSaveData(row, code, oldRow?.id || 0));
            const deleteIds = deletedOldRows.map((oldRow: any) => oldRow.id).filter(Boolean);
            const batchRes: any = await ApiSrsReq.batch_save_srs_req({
                doc_id: docId,
                type_code: typeCode,
                temp_updates: tempUpdates,
                upserts,
                delete_ids: deleteIds,
            });
            if (batchRes.code !== ApiSrsReq.C_OK) {
                throw new Error(batchRes.msg || "保存失败");
            }
            const srsTableState = await fetchSrsTableState(docId);
            const codeSets = buildActiveReqDetailCodeSets(srsTableState);
            const treeAfterChangeTableSync = syncChangeReqTablesToTree(
                ((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) as TreeNode[],
                srsTableState.srsChangeTables
            );
            // 不再自动补缺失变更表节点：
            // - 用户手动 + 表格 添加的变更表已经存在于树中（由 TreeStructure 在调用本函数前 updateNodes 写入）
            // - 通过右上角"+ 新增变更表格"创建、未在树里挂节点的，则由预览渲染（shouldShowChangeReqTables）展示，
            //   保证"一张表只生成一次"
            const syncedTree = dedupeChangeTableNodesInTree(
                pruneEmptyReqChapterShells(
                    pruneDeletedChangeReqChapters(
                        syncTreeWithSrsTableState(treeAfterChangeTableSync, srsTableState),
                        deletedOldRows,
                        codeSets,
                    ),
                ),
            );
            treeStructureRef.current = syncedTree;
            dispatch({
                srsTableData: srsTableState.srsTableData,
                srsOtherReqData: srsTableState.srsOtherReqData,
                srsChangeTables: sortSrsChangeTables(srsTableState.srsChangeTables),
                treeStructure: syncedTree,
                srsTableLoading: false,
                savingChangeReq: false,
                showChangeReqEditModal: false,
                changeReqEditInitialData: undefined,
                changeReqEditTarget: undefined,
            });
            loadReqListData();
            message.success("变更需求已保存");
            return syncedTree;
        } catch (error: any) {
            dispatch({ savingChangeReq: false });
            message.error(error?.message || "变更需求保存失败");
        }
        return undefined;
    };

    const handleSaveSrsReqTableInCurrentPage = async (table: any) => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId) {
            message.error("SRS表保存失败：缺少文档信息");
            return;
        }
        const headers = table?.headers || [];
        const normalizeHeader = (value?: string) => String(value || "")
            .replace(/[\s↩\r\n\t]+/g, "")
            .replace(/[：:，,。.;；、]/g, "")
            .toLowerCase();
        const pickColumn = (matcher: (text: string) => boolean) => (
            headers.find((header: any) => matcher(normalizeHeader(header?.name)))?.code || ""
        );
        const codeCol = pickColumn((text) => isReqCodeHeaderText(text));
        const moduleCol = pickColumn((text) => text.includes("模块"));
        const functionCol = pickColumn((text) => text.includes("功能") && !text.includes("子功能"));
        const subFunctionCol = pickColumn((text) => text.includes("子功能"));
        if (!codeCol || !moduleCol || !functionCol) {
            return;
        }
        const normalizeReqCode = (value?: string) => String(value || "").replace(/\s+/g, "").toUpperCase();
        const getSrsExportGroup = (code: string) => {
            const normalized = normalizeReqCode(code);
            return normalized.match(/^(SRS-[A-Z]+\d+)-\d+$/)?.[1] || normalized;
        };
        const lastValues: Record<string, string> = {};
        const rows = (table?.rows || [])
            .map((row: any) => {
                const code = normalizeReqCode(row?.[codeCol]);
                const group = getSrsExportGroup(code);
                const sameGroup = !!group && group === lastValues.group;
                if (!sameGroup) {
                    lastValues.group = group;
                    lastValues.module = "";
                    lastValues.function = "";
                    lastValues.sub_function = "";
                }
                const rawModule = normalizeReqText(row?.[moduleCol]);
                const rawFunction = normalizeReqText(row?.[functionCol]);
                const rawSubFunction = normalizeReqText(row?.[subFunctionCol]);
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
            .filter((row: any) => row.code);

        const duplicateStandardCodeMsg = validateStandardSrsCodeUnique(rows.map((row: any) => ({ code: row.code })));
        if (duplicateStandardCodeMsg) {
            throw new Error(duplicateStandardCodeMsg);
        }
        const contentStandardCodeMsg = validateStandardSrsRowContentRaw(headers, table?.rows || []);
        if (contentStandardCodeMsg) {
            throw new Error(contentStandardCodeMsg);
        }
        const hierarchyStandardMsg = validateStandardSrsHierarchyDuplicates(rows);
        if (hierarchyStandardMsg) {
            throw new Error(hierarchyStandardMsg);
        }

        try {
            dispatch({ srsTableLoading: true });
            const localTableState = {
                srsTableData: data.srsTableData || [],
                srsOtherReqData: data.srsOtherReqData || [],
                srsChangeTables: data.srsChangeTables || [],
            };
            const latestBeforeSave = localTableState.srsTableData.length
                ? localTableState
                : await fetchSrsTableState(docId);
            const oldRows = (latestBeforeSave.srsTableData || []).filter((row: any) => !!row?.id);
            const usedOldIds = new Set<number | string>();
            const usedReqCodes = new Set<string>();
            const assignments: Array<{ row: any; oldRow?: any; code: string }> = [];
            rows.forEach((row: any, index: number) => {
                const rowCode = normalizeReqCode(row.code);
                if (!rowCode || usedReqCodes.has(rowCode)) return;
                usedReqCodes.add(rowCode);
                const matchedByCode = oldRows.find((item: any) => normalizeReqCode(item.srs_code || item.code) === rowCode && !usedOldIds.has(item.id));
                const matchedOldRow =
                    matchedByCode ||
                    (oldRows[index] && !usedOldIds.has(oldRows[index].id) ? oldRows[index] : undefined);
                if (matchedOldRow?.id) {
                    usedOldIds.add(matchedOldRow.id);
                }
                assignments.push({ row, oldRow: matchedOldRow, code: rowCode });
            });

            const normalizeSavedValue = (value: any) => normalizeReqText(value);
            const isChangedAssignment = (assignment: { row: any; oldRow?: any; code: string }) => {
                const { row, oldRow, code } = assignment;
                if (!oldRow?.id) return true;
                return normalizeReqCode(oldRow.srs_code || oldRow.code) !== code ||
                    normalizeSavedValue(oldRow.module) !== row.module ||
                    normalizeSavedValue(oldRow.function) !== row.function ||
                    normalizeSavedValue(oldRow.sub_function) !== row.sub_function;
            };
            const changedAssignments = assignments.filter(isChangedAssignment);
            const deletedOldRows = oldRows.filter((oldRow: any) => oldRow?.id && !usedOldIds.has(oldRow.id));
            if (changedAssignments.length === 0 && deletedOldRows.length === 0) {
                dispatch({
                    srsTableData: latestBeforeSave.srsTableData,
                    srsOtherReqData: latestBeforeSave.srsOtherReqData,
                    srsChangeTables: latestBeforeSave.srsChangeTables,
                    srsTableLoading: false,
                });
                return latestBeforeSave.srsTableData;
            }

            const changedOldIds = new Set(
                changedAssignments
                    .map((assignment) => assignment.oldRow?.id)
                    .filter((id): id is number | string => !!id)
            );
            const changedReqCodes = new Set(changedAssignments.map((assignment) => assignment.code));
            const buildSaveData = (item: any, code: string, id = 0) => ({
                id,
                doc_id: docId,
                code,
                module: item.module,
                function: item.function,
                sub_function: item.sub_function,
                location: item.location || "",
                type_code: "1",
                rcm_ids: item.rcm_ids || [],
            });

            const tempUpdates: any[] = [];
            for (const assignment of changedAssignments) {
                const oldRow = assignment.oldRow;
                if (!oldRow?.id) continue;
                const oldCode = normalizeReqCode(oldRow.srs_code || (oldRow as any).code);
                if (oldCode === assignment.code) continue;
                const tempCode = `TMP-SRS-${docId}-${oldRow.id}-${Date.now()}`;
                tempUpdates.push(buildSaveData({
                    module: oldRow.module || "",
                    function: oldRow.function || "",
                    sub_function: oldRow.sub_function || "",
                    location: oldRow.location || "",
                    rcm_ids: oldRow.rcm_ids || [],
                }, tempCode, oldRow.id));
            }
            for (const oldRow of oldRows) {
                if (usedOldIds.has(oldRow.id) || changedOldIds.has(oldRow.id)) continue;
                const oldCode = normalizeReqCode(oldRow.srs_code || (oldRow as any).code);
                if (!changedReqCodes.has(oldCode)) continue;
                const tempCode = `TMP-SRS-${docId}-${oldRow.id}-${Date.now()}`;
                tempUpdates.push(buildSaveData({
                    module: oldRow.module || "",
                    function: oldRow.function || "",
                    sub_function: oldRow.sub_function || "",
                    location: oldRow.location || "",
                    rcm_ids: oldRow.rcm_ids || [],
                }, tempCode, oldRow.id));
            }

            const upserts = changedAssignments.map(({ row, oldRow, code }) => ({
                    id: oldRow?.id || 0,
                    doc_id: docId,
                    code,
                    module: row.module,
                    function: row.function,
                    sub_function: row.sub_function,
                    location: oldRow?.location || "",
                    type_code: "1",
                    rcm_ids: oldRow?.rcm_ids || [],
            }));
            const deleteIds = deletedOldRows.map((oldRow: any) => oldRow.id).filter(Boolean);

            const batchRes: any = await ApiSrsReq.batch_save_srs_req({
                doc_id: docId,
                type_code: "1",
                temp_updates: tempUpdates,
                upserts,
                delete_ids: deleteIds,
            });
            if (batchRes.code !== ApiSrsReq.C_OK) {
                throw new Error(batchRes.msg || "SRS表保存失败");
            }

            const needsReqListRefresh = deleteIds.length > 0 ||
                changedAssignments.some(({ row, oldRow, code }) => {
                    if (!oldRow?.id) return true;
                    const oldCode = normalizeReqCode(oldRow.srs_code || (oldRow as any).code);
                    return oldCode !== code ||
                        normalizeSavedValue(oldRow.module) !== row.module ||
                        normalizeSavedValue(oldRow.function) !== row.function ||
                        normalizeSavedValue(oldRow.sub_function) !== row.sub_function;
                });

            const srsTableState = await fetchSrsTableState(docId);
            const syncedTree = dedupeChangeTableNodesInTree(
                syncTreeWithSrsTableState(
                    ((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) as TreeNode[],
                    srsTableState,
                ),
            );
            treeStructureRef.current = syncedTree;
            dispatch({
                srsTableData: srsTableState.srsTableData,
                srsOtherReqData: srsTableState.srsOtherReqData,
                srsChangeTables: srsTableState.srsChangeTables,
                treeStructure: syncedTree,
                srsTableLoading: false,
            });
            if (needsReqListRefresh) {
            loadReqListData();
            }
            return srsTableState.srsTableData;
        } catch (error: any) {
            dispatch({ srsTableLoading: false });
            message.error(error?.message || "SRS表保存失败");
            throw error;
        }
    };

    const handleSaveOtherReqTableInCurrentPage = async (table: any) => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId) {
            message.error("其他需求表保存失败：缺少文档信息");
            return;
        }
        const headers = table?.headers || [];
        const normalizeHeader = (value?: string) => String(value || "")
            .replace(/[\s↩\r\n\t]+/g, "")
            .replace(/[：:，,。.;；、]/g, "")
            .toLowerCase();
        const pickColumn = (matcher: (text: string) => boolean) => (
            headers.find((header: any) => matcher(normalizeHeader(header?.name)))?.code || ""
        );
        const codeCol = pickColumn((text) => isReqCodeHeaderText(text));
        const moduleCol = pickColumn((text) => text.includes("需求模块") || text.includes("模块"));
        const locationCol = pickColumn((text) => text.includes("章节") || text.includes("位置"));
        if (!codeCol || !moduleCol) {
            return;
        }
        const normalizeReqCode = (value?: string) => String(value || "").replace(/\s+/g, "").toUpperCase();
        const parseOtherReqLocation = (location?: string) => {
            const raw = String(location || "").trim();
            return raw.match(/^(\d+(?:\.\d+)*)$/)?.[1] || raw.match(/^(\d+(?:\.\d+)*)/)?.[1] || "";
        };
        const rows = (table?.rows || [])
            .map((row: any) => ({
                code: normalizeReqCode(row?.[codeCol]),
                module: normalizeReqText(row?.[moduleCol]),
                location: normalizeReqText(row?.[locationCol]),
            }))
            .filter((row: any) => row.code);

        try {
            dispatch({ srsTableLoading: true });
            const latestBeforeSave = await fetchSrsTableState(docId);
            const oldRows = (latestBeforeSave.srsOtherReqData || []).filter((row: any) => !!row?.id);
            const usedOldIds = new Set<number | string>();
            const usedReqCodes = new Set<string>();
            const assignments: Array<{ row: any; oldRow?: any; code: string }> = [];
            rows.forEach((row: any, index: number) => {
                const rowCode = normalizeReqCode(row.code);
                if (!rowCode || usedReqCodes.has(rowCode)) return;
                usedReqCodes.add(rowCode);
                const rowLocation = parseOtherReqLocation(row.location);
                const matchedByCode = oldRows.find((item: any) => (
                    normalizeReqCode(item.srs_code || item.code) === rowCode && !usedOldIds.has(item.id)
                ));
                const matchedByLocation = rowLocation
                    ? oldRows.find((item: any) => (
                        parseOtherReqLocation(item.location) === rowLocation && !usedOldIds.has(item.id)
                    ))
                    : undefined;
                const matchedOldRow =
                    matchedByCode ||
                    matchedByLocation ||
                    (oldRows[index] && !usedOldIds.has(oldRows[index].id) ? oldRows[index] : undefined);
                if (matchedOldRow?.id) {
                    usedOldIds.add(matchedOldRow.id);
                }
                assignments.push({ row, oldRow: matchedOldRow, code: rowCode });
            });

            const isChangedAssignment = (assignment: { row: any; oldRow?: any; code: string }) => {
                const { row, oldRow, code } = assignment;
                if (!oldRow?.id) return true;
                return normalizeReqCode(oldRow.srs_code || oldRow.code) !== code ||
                    normalizeReqText(oldRow.module) !== row.module ||
                    normalizeReqText(oldRow.location) !== row.location;
            };
            const changedAssignments = assignments.filter(isChangedAssignment);
            const deletedOldRows = oldRows.filter((oldRow: any) => oldRow?.id && !usedOldIds.has(oldRow.id));
            if (changedAssignments.length === 0 && deletedOldRows.length === 0) {
                const syncedTree = dedupeChangeTableNodesInTree(
                    syncTreeWithSrsTableState(
                        ((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) as TreeNode[],
                        latestBeforeSave,
                    ),
                );
                treeStructureRef.current = syncedTree;
                dispatch({
                    srsTableData: latestBeforeSave.srsTableData,
                    srsOtherReqData: latestBeforeSave.srsOtherReqData,
                    srsChangeTables: latestBeforeSave.srsChangeTables,
                    treeStructure: syncedTree,
                    srsTableLoading: false,
                });
                return syncedTree;
            }

            const changedOldIds = new Set(
                changedAssignments
                    .map((assignment) => assignment.oldRow?.id)
                    .filter((id): id is number | string => !!id)
            );
            const changedReqCodes = new Set(changedAssignments.map((assignment) => assignment.code));
            const buildSaveData = (item: any, code: string, id = 0) => ({
                id,
                doc_id: docId,
                code,
                module: item.module || "",
                function: "",
                sub_function: "",
                location: item.location || "",
                type_code: "2",
                rcm_ids: item.rcm_ids || [],
            });
            const updateReq = async (payload: any) => {
                const saveRes = payload.id
                    ? await ApiSrsReq.update_srs_req(payload)
                    : await ApiSrsReq.add_srs_req(payload);
                if (saveRes.code !== ApiSrsReq.C_OK) {
                    throw new Error(saveRes.msg || "其他需求表保存失败");
                }
            };

            for (const assignment of changedAssignments) {
                const oldRow = assignment.oldRow;
                if (!oldRow?.id) continue;
                const oldCode = normalizeReqCode(oldRow.srs_code || (oldRow as any).code);
                if (oldCode === assignment.code) continue;
                const tempCode = `TMP-SRS-${docId}-${oldRow.id}-${Date.now()}`;
                await updateReq(buildSaveData({
                    module: oldRow.module || "",
                    location: oldRow.location || "",
                    rcm_ids: oldRow.rcm_ids || [],
                }, tempCode, oldRow.id));
            }
            for (const oldRow of oldRows) {
                if (usedOldIds.has(oldRow.id) || changedOldIds.has(oldRow.id)) continue;
                const oldCode = normalizeReqCode(oldRow.srs_code || (oldRow as any).code);
                if (!changedReqCodes.has(oldCode)) continue;
                const tempCode = `TMP-SRS-${docId}-${oldRow.id}-${Date.now()}`;
                await updateReq(buildSaveData({
                    module: oldRow.module || "",
                    location: oldRow.location || "",
                    rcm_ids: oldRow.rcm_ids || [],
                }, tempCode, oldRow.id));
            }

            for (const assignment of changedAssignments) {
                const { row, oldRow, code } = assignment;
                await updateReq({
                    id: oldRow?.id || 0,
                    doc_id: docId,
                    code,
                    module: row.module,
                    function: "",
                    sub_function: "",
                    location: row.location || oldRow?.location || "",
                    type_code: "2",
                    rcm_ids: oldRow?.rcm_ids || [],
                });
            }
            for (const oldRow of deletedOldRows) {
                const deleteRes: any = await ApiSrsReq.delete_srs_req({ id: oldRow.id });
                if (deleteRes.code !== ApiSrsReq.C_OK) {
                    throw new Error(deleteRes.msg || "删除其他需求失败");
                }
            }
            const srsTableState = await fetchSrsTableState(docId);
            const syncedTree = dedupeChangeTableNodesInTree(
                syncTreeWithSrsTableState(
                    ((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) as TreeNode[],
                    srsTableState,
                ),
            );
            treeStructureRef.current = syncedTree;
            dispatch({
                srsTableData: srsTableState.srsTableData,
                srsOtherReqData: srsTableState.srsOtherReqData,
                srsChangeTables: srsTableState.srsChangeTables,
                treeStructure: syncedTree,
                srsTableLoading: false,
            });
            return syncedTree;
        } catch (error: any) {
            dispatch({ srsTableLoading: false });
            message.error(error?.message || "其他需求表保存失败");
            throw error;
        }
    };

    // 加载需求列表数据
    const loadReqListData = () => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId) {
            return;
        }
        dispatch({ reqListLoading: true });
        ApiSrsReqd.list_srs_reqd({
            doc_id: docId,
            page_index: 0,
            page_size: 10000,
        }).then((res: any) => {
            if (res.code === ApiSrsReqd.C_OK) {
                const rows = res.data?.rows || [];
                const tableData = rows.map((item: any, index: number) => ({
                    key: item.req_id || `req_${index}_${Date.now()}`,
                    req_id: item.req_id,
                    doc_id: item.doc_id,
                    doc_version: item.doc_version || "",
                    code: item.code || "",
                    name: item.name || "",
                    module: item.module || "",
                    function: item.function || "",
                    sub_function: item.sub_function || "",
                    overview: item.overview || "",
                    participant: item.participant || "",
                    pre_condition: item.pre_condition || "",
                    trigger: item.trigger || "",
                    work_flow: item.work_flow || "",
                    post_condition: item.post_condition || "",
                    exception: item.exception || "",
                    constraint: item.constraint || "",
                    rcm_codes: item.rcm_codes || [],
                    type_code: item.type_code || "",
                }));
                dispatch({ reqListData: tableData, reqListLoading: false });
            } else {
                message.error(res.msg || "加载需求列表数据失败");
                dispatch({ reqListData: [], reqListLoading: false });
            }
        }).catch((error: any) => {
            console.error("加载需求列表数据失败:", error);
            message.error("加载需求列表数据失败");
            dispatch({ reqListData: [], reqListLoading: false });
        });
    };

    const handleSaveReqDetailTable = async (detail: any) => {
        const code = normalizeSrsCodeForSync(detail?.code);
        if (!code) {
            throw new Error("功能描述保存失败：缺少需求编号");
        }
        const toReqListTableData = (rows: any[]) => rows.map((item: any, index: number) => ({
            key: item.req_id || `req_${index}_${Date.now()}`,
            req_id: item.req_id,
            doc_id: item.doc_id,
            doc_version: item.doc_version || "",
            code: item.code || "",
            name: item.name || "",
            module: item.module || "",
            function: item.function || "",
            sub_function: item.sub_function || "",
            overview: item.overview || "",
            participant: item.participant || "",
            pre_condition: item.pre_condition || "",
            trigger: item.trigger || "",
            work_flow: item.work_flow || "",
            post_condition: item.post_condition || "",
            exception: item.exception || "",
            constraint: item.constraint || "",
            rcm_codes: item.rcm_codes || [],
            type_code: item.type_code || "",
        }));
        let existed = (data.reqListData || []).find((item: any) => normalizeSrsCodeForSync(item?.code) === code);
        if (!existed?.req_id) {
            const changeReq = (data.srsChangeTables || [])
                .flatMap((table: any) => table.data || [])
                .find((item: any) => normalizeSrsCodeForSync(item?.srs_code || item?.code) === code);
            if (changeReq?.id) {
                existed = {
                    ...changeReq,
                    code: changeReq.srs_code || changeReq.code,
                };
            }
        }
        if (!existed?.req_id) {
            const docId = params.id ? parseInt(params.id) : 0;
            const latestRes: any = await ApiSrsReqd.list_srs_reqd({
                doc_id: docId,
                page_index: 0,
                page_size: 10000,
            });
            if (latestRes.code === ApiSrsReqd.C_OK) {
                const latestRows = latestRes.data?.rows || [];
                existed = latestRows.find((item: any) => normalizeSrsCodeForSync(item?.code) === code);
                dispatch({ reqListData: toReqListTableData(latestRows) });
            }
        }
        if (!existed?.req_id) {
            const sourceReq = (data.srsTableData || []).find((item: any) => normalizeSrsCodeForSync(item?.srs_code || item?.code) === code) ||
                (data.srsOtherReqData || []).find((item: any) => normalizeSrsCodeForSync(item?.srs_code || item?.code) === code) ||
                (data.srsChangeTables || [])
                    .flatMap((table: any) => table.data || [])
                    .find((item: any) => normalizeSrsCodeForSync(item?.srs_code || item?.code) === code);
            existed = {
                ...(sourceReq || {}),
                code: sourceReq?.srs_code || sourceReq?.code || detail.code,
                name: detail.name || sourceReq?.sub_function || sourceReq?.function || sourceReq?.module || "",
            };
        }
        const detailFields = {
            overview: detail.overview ?? "",
            participant: detail.participant ?? "",
            pre_condition: detail.pre_condition ?? "",
            trigger: detail.trigger ?? "",
            work_flow: detail.work_flow ?? "",
            post_condition: detail.post_condition ?? "",
            exception: detail.exception ?? "",
            constraint: detail.constraint ?? "",
        };
        const docId = params.id ? parseInt(params.id) : 0;
        if (!existed.req_id) {
            const latestBeforeSave: any = await ApiSrsReqd.list_srs_reqd({
                doc_id: docId,
                page_index: 0,
                page_size: 10000,
            });
            if (latestBeforeSave.code === ApiSrsReqd.C_OK) {
                const latestRows = latestBeforeSave.data?.rows || [];
                const latestExisted = latestRows.find((item: any) => normalizeSrsCodeForSync(item?.code) === code);
                if (latestExisted?.req_id) {
                    existed = latestExisted;
                    dispatch({ reqListData: toReqListTableData(latestRows) });
                }
            }
        }
        const payload = existed.req_id
            ? {
                req_id: existed.req_id,
                ...detailFields,
            }
            : {
                doc_id: docId,
                code: existed.code || detail.code || "",
                name: detail.name || existed.name || existed.sub_function || existed.function || existed.module || "",
                ...detailFields,
            };
        let res: any = existed.req_id
            ? await ApiSrsReqd.update_srs_reqd(payload)
            : await ApiSrsReqd.add_srs_reqd(payload);
        if (res.code !== ApiSrsReqd.C_OK && !existed.req_id && /已存在/.test(String(res.msg || ""))) {
            const latestWhenDuplicated: any = await ApiSrsReqd.list_srs_reqd({
                doc_id: docId,
                page_index: 0,
                page_size: 10000,
            });
            if (latestWhenDuplicated.code === ApiSrsReqd.C_OK) {
                const latestRows = latestWhenDuplicated.data?.rows || [];
                const latestExisted = latestRows.find((item: any) => normalizeSrsCodeForSync(item?.code) === code);
                if (latestExisted?.req_id) {
                    existed = latestExisted;
                    dispatch({ reqListData: toReqListTableData(latestRows) });
                    res = await ApiSrsReqd.update_srs_reqd({
                        req_id: latestExisted.req_id,
                        ...detailFields,
                    });
                }
            }
            if (res.code !== ApiSrsReqd.C_OK) {
                res = { code: ApiSrsReqd.C_OK, msg: "功能描述已存在，已刷新" };
            }
        }
        if (res.code !== ApiSrsReqd.C_OK) {
            throw new Error(res.msg || "功能描述保存失败");
        }
        const latestAfterSave: any = await ApiSrsReqd.list_srs_reqd({
            doc_id: docId,
            page_index: 0,
            page_size: 10000,
        });
        if (latestAfterSave.code === ApiSrsReqd.C_OK) {
            dispatch({ reqListData: toReqListTableData(latestAfterSave.data?.rows || []) });
        } else {
            const hasExistingReqListItem = (data.reqListData || []).some((item: any) => item.req_id === existed.req_id);
            const nextReqListData = hasExistingReqListItem
                ? (data.reqListData || []).map((item: any) => (
                    item.req_id === existed.req_id ? { ...item, ...detailFields } : item
                ))
                : [...(data.reqListData || []), { ...existed, ...detailFields, code: detail.code }];
            dispatch({ reqListData: nextReqListData });
        }
        message.success(res.msg || "功能描述已保存");
    };

    const normalizeText = (value?: string) => (value || "").replace(/\s+/g, "");
    const hasTableContent = (node: TreeNode) => !!(node.table && Array.isArray(node.table.rows) && node.table.rows.length > 0);
    const getTableText = (node: TreeNode) => {
        if (!hasTableContent(node) || !node.table) return "";
        const headerTxt = (node.table.headers || []).map((h) => h.name || "").join(" ");
        const rowTxt = (node.table.rows || []).map((row) => Object.values(row || {}).join(" ")).join(" ");
        return `${headerTxt} ${rowTxt}`;
    };
    const isApprovalTable = (node: TreeNode) => {
        const txt = getTableText(node);
        return ["编制科室", "编制部门", "文件版本", "编制人", "审核人", "批准人", "生效日期"].filter((k) => txt.includes(k)).length >= 5;
    };
    const isChangeLogTable = (node: TreeNode) => {
        const txt = getTableText(node);
        return ["修改日期", "版本号", "修订说明", "修订人", "批准人"].every((k) => txt.includes(k));
    };
    const isCatalogNode = (node: TreeNode) => normalizeText(node.title).includes("目录");
    const isApprovalNode = (node: TreeNode) => normalizeText(node.title).includes("需求规格说明") || isApprovalTable(node);
    const isChangeLogNode = (node: TreeNode) => normalizeText(node.title).includes("文件修订记录") || isChangeLogTable(node);
    const isImportedCatalogNode = (node: TreeNode) => {
        const title = String(node.title || "").trim();
        const text = String(node.text || "");
        if (/^导入正文$/.test(title) && /目录/.test(text) && /\d+(?:\.\d+)*\.?\s+.+\s+\d+/.test(text)) {
            return true;
        }
        // Word 目录项会带页码，如“1 介绍 1”“2.2 物理拓扑图 6”，正文标题不会带最后的页码。
        if (/^\d+(?:\.\d+)*\.?\s+\S.*\s+\d+$/.test(title)) {
            return true;
        }
        return false;
    };

    const subtreeMatches = (node: TreeNode, matchFn: (n: TreeNode) => boolean): boolean => {
        if (matchFn(node)) return true;
        return (node.children || []).some((child) => subtreeMatches(child, matchFn));
    };
    const collectSubtreeIds = (node: TreeNode): number[] => {
        const ids = [node.id];
        (node.children || []).forEach((child) => ids.push(...collectSubtreeIds(child)));
        return ids;
    };
    const collectMatchedSubtreeIds = (nodes: TreeNode[], matchFn: (n: TreeNode) => boolean): number[] => {
        return (nodes || []).flatMap((node) => {
            if (matchFn(node)) {
                return collectSubtreeIds(node);
            }
            return collectMatchedSubtreeIds(node.children || [], matchFn);
        });
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
    const approvalRoot = treeRoots.find((node) => normalizeText(node.title).includes("需求规格说明"));
    const changeLogRoot = treeRoots.find((node) => normalizeText(node.title).includes("文件修订记录"));
    const approvalRoots = approvalRoot ? [approvalRoot] : treeRoots.filter((node) => subtreeMatches(node, isApprovalNode));
    const changeLogRoots = changeLogRoot ? [changeLogRoot] : treeRoots.filter((node) => subtreeMatches(node, isChangeLogNode));
    const hiddenNodeIds = Array.from(new Set([
        ...collectMatchedSubtreeIds(treeRoots, (node) => isCatalogNode(node) || isImportedCatalogNode(node)),
        ...treeRoots
            .filter((node) => subtreeMatches(node, isApprovalNode) || subtreeMatches(node, isChangeLogNode))
            .flatMap((node) => collectSubtreeIds(node)),
    ]));
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
        dispatch({ treeStructure: updateNode(data.treeStructure as TreeNode[]) });
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
        dispatch({ treeStructure: updateNode(data.treeStructure as TreeNode[]) });
    };

    const renderApprovalTable = (node: TreeNode, keyPrefix: string) => {
        const columns = approvalHeaders.map((header, index) => ({
            title: "",
            dataIndex: header.code,
            key: `${keyPrefix}-col-${header.code}`,
            render: (text: string, _record: any, rowIndex: number) => {
                const isLabel = index === 0 || index === 2;
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
                className={`srs-cover-table${!isReadOnly ? " srs-extracted-edit-table" : ""}`}
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
        if (isApprovalTable(node)) {
            return renderApprovalTable(node, keyPrefix);
        }
        const isChangeRecordTable = isChangeLogTable(node);
        const normalizedRows = [...(node.table.rows || [])];
        if (isChangeRecordTable) {
            while (normalizedRows.length < 5) {
                normalizedRows.push({});
            }
        }
        const columns = node.table.headers.map((header, index) => ({
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
        const dataSource = normalizedRows.map((row, index) => ({ key: `${keyPrefix}-row-${index}`, ...row }));
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

    // 展开/折叠SRS表、需求列表（已改为弹框，此处保留供注释块恢复用）
    // const handleToggleSrsTable = () => { ... };
    // const handleToggleReqList = () => { ... };

    // 保存目录结构
    const handleSaveTreeStructure = () => {
            editForm.validateFields().then(() => {
                doSaveTreeStructure();
            }).catch(() => {
            message.error("请先完善必填项");
            });
    };

    const doSaveTreeStructure = async () => {
        const productId = editForm.getFieldValue("product_id");
        const version = editForm.getFieldValue("version");
        const docId = params.id ? parseInt(params.id) : 0;

        const srsTableState = {
            srsTableData: data.srsTableData || [],
            srsOtherReqData: data.srsOtherReqData || [],
            srsChangeTables: data.srsChangeTables || [],
        };
        const baseTree = ((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) || [];
        // 全局保存只入库当前树结构，不补表、不挪章节；变更表在单独保存时已写入树。
        const currentTree = dedupeChangeTableNodesInTree(
            syncChangeReqTablesToTree(
                normalizeChangeTableNodeTitles(baseTree as TreeNode[]),
                srsTableState.srsChangeTables,
            ),
        );
        treeStructureRef.current = currentTree;
        const values = editForm.getFieldsValue();
        const validationMsg = validateSrsDocRequired({ ...values, product_id: productId, version }, currentTree);
        if (validationMsg) {
            message.error(validationMsg);
            return;
        }
        // 功能描述章节是否齐全只作为提示（warning），不阻断保存；
        // 这样在其他普通章节加普通表后做全局保存时，不会被 7 章节遗留状况卡死。
        const treeReqRowsForWarn = collectReqRowsFromTree(currentTree);
        const mainRowsForWarn = fillMergedMainReqRows(
            treeReqRowsForWarn.mainRows.filter((row: any) => !/变更/.test(String(row?.table_name || ""))).length
                ? treeReqRowsForWarn.mainRows.filter((row: any) => !/变更/.test(String(row?.table_name || "")))
                : ((data.srsTableData || []) as any[])
        ).filter((row: any) => normalizeReqText(row?.srs_code || row?.code) || normalizeReqText(row?.module) || normalizeReqText(row?.function) || normalizeReqText(row?.sub_function));
        const reqChapterMatchMsg = validateReqChapterMatches(mainRowsForWarn, (data.srsChangeTables || []) as any[], currentTree);
        if (reqChapterMatchMsg) {
            message.warning(reqChapterMatchMsg);
        }
        const duplicateMsg = await validateSrsDocVersionUnique(productId, version, docId);
        if (duplicateMsg) {
            message.error(duplicateMsg);
            return;
        }
        dispatch({ saving: true });
        const cleanedContent = currentTree.map((node: any) => 
            cleanTreeNode(node, docId, 0)
        );
        if (!cleanedContent.length) {
            dispatch({ saving: false });
            message.error("保存失败：当前文档结构为空，请刷新后重试");
            return;
        }

        const payload = {
            id: docId,
            product_id: productId,
            version: version,
            file_no: editForm.getFieldValue("file_no"),
            folder_name: editForm.getFieldValue("folder_name"),
            change_log: data.changeDescription || "",
            content: cleanedContent,
            n_id: data.docNId || 0, // 文档级别的 n_id，编辑时使用从后端获取的值，新增时为0
        };
        console.log(payload);

        // 根据是否有 id 判断是新增还是更新
        const apiCall = params.id 
            ? Api.update_srs_doc(payload)
            : Api.add_srs_doc(payload);

        apiCall.then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                message.success("保存成功");
                // 如果是新增，跳转到编辑页面
                if (!params.id && res.data?.id) {
                    navigate(`/srs_docs/edit/${res.data.id}`, { replace: true });
                } else if (params.id) {
                    // 如果是编辑，重新加载数据以获取后端生成的新 n_id
                    Api.get_srs_doc({ id: params.id }).then(async (reloadRes: any) => {
                        if (reloadRes.code === Api.C_OK) {
                            const targetRow = reloadRes.data;
                            const reloadTableState = await fetchSrsTableState(docId);
                            const parsedContentRaw = (targetRow.content || []).map((node: any) => parseTreeNode(node));
                            const reloadProduct = (data.products as any[]).find((p: any) => p.id === targetRow.product_id);
                            const remappedContent = await remapProductBoundDocImages(
                                parsedContentRaw,
                                targetRow.product_id,
                                targetRow.version,
                                reloadProduct?.full_version || targetRow.product_version,
                            );
                            const parsedContent = dedupeChangeTableNodesInTree(
                                syncTreeWithSrsTableState(remappedContent, reloadTableState),
                            );
                            const derivedCoverTitle = extractCoverTitleFromTree(parsedContent);
                            const derivedFileNo = extractFileNoFromTree(parsedContent);

                            // 更新表单数据
                            editForm.setFieldsValue({
                                id: targetRow.id,
                                product_id: targetRow.product_id,
                                version: targetRow.version,
                                folder_name: targetRow.folder_name || derivedCoverTitle || "",
                                file_no: isIncompleteFileNo(targetRow.file_no) ? (derivedFileNo || targetRow.file_no || "") : targetRow.file_no,
                            });

                            dispatch({ 
                                changeDescription: targetRow.change_log || "",
                                docNId: targetRow.n_id || 0,
                                treeStructure: parsedContent,
                                srsTableData: reloadTableState.srsTableData,
                                srsOtherReqData: reloadTableState.srsOtherReqData,
                                srsChangeTables: sortSrsChangeTables(reloadTableState.srsChangeTables),
                            });
                            treeStructureRef.current = parsedContent;
                            
                        }
                    });
                }
            } else {
                message.error(res.msg === "数据已存在！" ? buildDuplicateVersionMessage(version) : (res.msg || ts("save_failed")));
            }
        }).catch((error) => {
            dispatch({ saving: false });
            message.error(ts("save_failed"));
            console.error(ts("save_failed"), error);
        });
    };

    return (
        <div className={`page div-v srs-doc-detail ${isReadOnly ? 'read-only' : ''}`}>
            <div className="div-h center-v page-actions searchbar">
                <Button
                    icon={<ArrowLeftOutlined />}
                    onClick={() => navigate("/srs_docs")}>
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
                        {ts("srs_doc.init_template")}
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
                    <Form.Item hidden name="folder_name">
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item hidden name="file_no">
                        <Input allowClear />
                    </Form.Item>
                    {(data.isEdit || isReadOnly) ? (
                        <Row gutter={24} className="form-display-row">
                            <Col span={8}>
                                {isReadOnly ? (
                                    <>
                                        <span className="form-display-label">{ts("srs_doc.current_product")}：</span>
                                        <span className="form-display-value">{productLabel || "-"}</span>
                                    </>
                                ) : (
                                    <Form.Item
                                        label={ts("srs_doc.current_product")}
                                        name="product_id"
                                        rules={[{ required: true, message: "" }]}>
                                        <ProductVersionSelect
                                            products={data.products}
                                            allowClear
                                            namePlaceholder={ts("product.name")}
                                            versionPlaceholder={ts("product.full_version")}
                                            onChange={(value) => editForm.setFieldValue("product_id", value)}
                                        />
                                    </Form.Item>
                                )}
                            </Col>
                            <Col span={8}>
                                <Form.Item
                                    label={ts("srs_doc.current_version")}
                                    name="version"
                                    rules={[{ required: !isReadOnly, message: "" }]}>
                                    <Input allowClear placeholder={ts("srs_doc.please_input_version")} disabled={isReadOnly} style={{ width: 200 }} />
                                </Form.Item>
                            </Col>
                        </Row>
                    ) : (
                        <Row gutter={24}>
                            <Col span={8}>
                                <Form.Item
                                    label={ts("srs_doc.product")}
                                    name="product_id"
                                    rules={[{ required: true, message: "" }]}>
                                    <ProductVersionSelect
                                        products={data.products}
                                        allowClear
                                        namePlaceholder={ts("product.name")}
                                        versionPlaceholder={ts("product.full_version")}
                                        onChange={(value) => editForm.setFieldValue("product_id", value)}
                                    />
                                </Form.Item>
                            </Col>
                            <Col span={8}>
                                <Form.Item
                                    label={ts("srs_doc.version_label")}
                                    name="version"
                                    rules={[{ required: true, message: "" }]}>
                                    <Input allowClear placeholder={ts("srs_doc.please_input_version")} style={{ width: 200 }} />
                                </Form.Item>
                            </Col>
                        </Row>
                    )}
                </Form>

                {/* 版本变更说明区域 */}
                <div className="doc-section">
                    <div className="doc-section-header">
                        <div className="change-desc-title">
                            {ts("srs_doc.version_change_description")}
                        </div>
                        {!isReadOnly && (
                        <Button 
                            type="primary" 
                            icon={<EditOutlined />}
                            onClick={handleEditChangeDesc}>
                            {ts("srs_doc.edit_change_description")}
                        </Button>
                        )}
                    </div>
                    <div className={`doc-desc-content ${data.changeDescription ? "has-content" : ""}`}>
                        {data.changeDescription || ts("srs_doc.no_change_description")}
                    </div>
                </div>

                <div className="doc-section extracted-doc-section">
                    <div className="doc-section-header">
                        <div className="doc-section-title">封面</div>
                    </div>
                    <div className="extracted-item-title">需求规格说明</div>
                    {approvalRoots.length > 0
                        ? approvalRoots
                            .flatMap((root) => collectTableNodes(root))
                            .filter((node) => isApprovalTable(node))
                            .map((node, idx) => renderExtractedTable(node, `approval-${idx}`))
                        : <div className="extracted-empty">暂无</div>}
                    <div className="extracted-item-title">文件修订记录</div>
                    {changeLogRoots.length > 0
                        ? changeLogRoots
                            .flatMap((root) => collectTableNodes(root))
                            .filter((node) => isChangeLogTable(node))
                            .map((node, idx) => renderExtractedTable(node, `change-${idx}`))
                        : <div className="extracted-empty">暂无</div>}
                </div>

                {/* SRS表区域 - 已改为弹框 */}
                {/* <div className="doc-section">
                    <div className="doc-section-header" onClick={handleToggleSrsTable} style={{ cursor: 'pointer' }}>
                        <div className="doc-section-title">
                            {ts("srs_doc.srs_table") || "SRS表"}
                        </div>
                        <Button 
                            type="link" 
                            icon={data.srsTableExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                        />
                    </div>
                    {data.srsTableExpanded && (
                        <Table 
                            dataSource={data.srsTableData} 
                            columns={[...]}
                            rowKey="key"
                            pagination={false}
                            loading={data.srsTableLoading}
                        />
                    )}
                </div> */}

                {/* 需求列表区域 - 已改为弹框 */}
                {/* <div className="doc-section">
                    <div className="doc-section-header" onClick={handleToggleReqList} style={{ cursor: 'pointer' }}>
                        <div className="doc-section-title">
                            {ts("menu.srs_req") || "需求列表"}
                        </div>
                        <Button 
                            type="link" 
                            icon={data.reqListExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                        />
                    </div>
                    {data.reqListExpanded && (
                        <Table ... />
                    )}
                </div> */}

                <div className="doc-section doc-section-flex">
                    {!isReadOnly && (
                        <div className="doc-section-header">
                            <div className="doc-section-buttons">
                            <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                onClick={handleAddRootNode}>
                                {ts("srs_doc.add_root_menu")}
                            </Button>
                        </div>
                    </div>
                    )}
                        <TreeStructure
                            value={data.treeStructure}
                            onChange={isReadOnly ? undefined : (value) => {
                                treeStructureRef.current = value as TreeNode[];
                                dispatch({ treeStructure: value });
                            }}
                            docId={params.id ? parseInt(params.id) : undefined}
                            productId={displayProductId}
                            docVersion={displayDocVersion}
                            productVersion={displayProductVersion}
                            hiddenNodeIds={hiddenNodeIds}
                            onNodeDelete={isReadOnly ? undefined : handleNodeDelete}
                            readOnly={isReadOnly}
                            rcmOptions={data.rcmOptions}
                            srsReqPreview={srsReqPreviewForTree}
                            enableStandardReqAutoSync={!params.id}
                            reqDetails={reqListDataForTree as any[]}
                            srsReqLoading={data.srsTableLoading}
                            onNodesSnapshot={(nodes) => {
                                treeStructureRef.current = (nodes || []) as TreeNode[];
                            }}
                            onOpenSrsTable={() => {
                                loadSrsTableData();
                                dispatch({ showSrsTableModal: true });
                            }}
                            onOpenReqList={() => {
                                loadSrsTableData();
                                loadReqListData();
                                dispatch({ showReqListModal: true });
                            }}
                            onEditSrsChangeTable={openChangeReqEditModal}
                            onDeleteSrsChangeTable={handleDeleteChangeReqTableInCurrentPage}
                            onSaveReqDetailTable={handleSaveReqDetailTable}
                            onSaveSrsReqTable={handleSaveSrsReqTableInCurrentPage}
                            onSaveOtherReqTable={handleSaveOtherReqTableInCurrentPage}
                            onSaveSrsChangeReqTable={handleSaveChangeReqInCurrentPage}
                        />
                    </div>
            </div>

            {/* 编辑版本变更说明的Modal */}
            <Modal
                title={ts("srs_doc.version_change_description")}
                open={data.showChangeDescModal}
                onOk={handleSaveChangeDesc}
                onCancel={handleCancelChangeDesc}
                okText={ts("save")}
                cancelText={ts("cancel")}
                width={600}>
                <div className="change-desc-modal">
                    <div className="change-desc-label">{ts("srs_doc.change_description_label")}</div>
                    <Input.TextArea
                        className="change-desc-textarea"
                        rows={6}
                        placeholder={ts("srs_doc.please_input_change_description")}
                        value={data.tempChangeDescription}
                        onChange={(e) => {
                            dispatch({ tempChangeDescription: e.target.value });
                        }}
                    />
                </div>
            </Modal>

            {/* SRS表弹框 */}
            <Modal
                className="srs-table-modal"
                title={ts("srs_doc.srs_table") || "SRS表"}
                open={data.showSrsTableModal}
                onCancel={() => dispatch({ showSrsTableModal: false })}
                footer={null}
                width={1200}>
                <div style={{ marginBottom: 12, fontWeight: 600 }}>{ts("srs_doc.srs_table") || "产品需求列表"}</div>
                <Table
                    dataSource={filteredSrsTableData}
                    columns={[
                        { title: ts("srs_doc.srs_code") || "需求编号", dataIndex: "srs_code", width: 160, render: (t: string) => t || "-" },
                        { title: ts("srs_doc.module") || "模块", dataIndex: "module", width: 180, render: (t: string) => t || "-" },
                        { title: ts("srs_doc.function") || "功能", dataIndex: "function", width: 360, render: (t: string) => t ? <span style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{t}</span> : "-" },
                        { title: ts("srs_doc.sub_function") || "子功能", dataIndex: "sub_function", width: 360, render: (t: string) => t ? <span style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{t}</span> : "-" },
                    ]}
                    rowKey="key"
                    pagination={false}
                    loading={data.srsTableLoading}
                    locale={{ emptyText: "暂无数据" }}
                    scroll={{ x: 1060 }}
                />

                <div style={{ marginTop: 20, marginBottom: 12, fontWeight: 600 }}>{ts("srs_doc.other_req_list") || "其他需求列表"}</div>
                <Table
                    dataSource={filteredSrsOtherReqData}
                    columns={[
                        { title: ts("srs_doc.srs_code") || "需求编号", dataIndex: "srs_code", width: 180, render: (t: string) => t || "-" },
                        { title: ts("srs_doc.module") || "需求模块", dataIndex: "module", width: 320, render: (t: string) => t || "-" },
                        { title: ts("srs_doc.chapter_number") || "对应的章节号", dataIndex: "location", width: 320, render: (t: string) => t || "-" },
                    ]}
                    rowKey="key"
                    pagination={false}
                    loading={data.srsTableLoading}
                    locale={{ emptyText: "暂无数据" }}
                    scroll={{ x: 820 }}
                />

                {!isReadOnly && (
                    <div style={{ marginTop: 20, textAlign: "right" }}>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            loading={data.srsTableLoading}
                            onClick={openAddChangeTableModal}
                        >
                            {ts("srs_doc.add_change_table") || "新增变更表格"}
                        </Button>
                    </div>
                )}

                {(filteredSrsChangeTables || []).map((table: any) => (
                    <div key={`change_tbl_${table.id}`} style={{ marginTop: 20 }}>
                        <div style={{ marginBottom: 12, fontWeight: 600 }}>{table.title || "变更表格"}</div>
                        <Table
                            dataSource={table.data || []}
                            columns={[
                                { title: ts("srs_doc.srs_code") || "需求编号", dataIndex: "srs_code", width: 160, render: (t: string) => t || "-" },
                                { title: ts("srs_doc.module") || "模块", dataIndex: "module", width: 180, render: (t: string) => t || "-" },
                                { title: ts("srs_doc.function") || "功能", dataIndex: "function", width: 360, render: (t: string) => t ? <span style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{t}</span> : "-" },
                                { title: ts("srs_doc.sub_function") || "子功能", dataIndex: "sub_function", width: 360, render: (t: string) => t ? <span style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{t}</span> : "-" },
                            ]}
                            rowKey="key"
                            pagination={false}
                            loading={data.srsTableLoading}
                            locale={{ emptyText: "暂无数据" }}
                            scroll={{ x: 1060 }}
                        />
                    </div>
                ))}
            </Modal>

            <Modal
                title="新增变更表格"
                open={data.showAddChangeTableModal}
                onOk={handleAddChangeTableInCurrentPage}
                onCancel={() => dispatch({ showAddChangeTableModal: false, newChangeTableName: "" })}
                confirmLoading={data.srsTableLoading}
                okText={ts("confirm") || "确定"}
                cancelText={ts("cancel") || "取消"}
            >
                <Form layout="vertical">
                    <Form.Item label="表名" required>
                        <Input
                            value={data.newChangeTableName}
                            placeholder="请输入表名，例如：变更列表"
                            onChange={(event) => dispatch({ newChangeTableName: event.target.value })}
                            onPressEnter={handleAddChangeTableInCurrentPage}
                        />
                    </Form.Item>
                </Form>
            </Modal>

            {/* 需求列表弹框 */}
            <Modal
                className="req-list-modal"
                title={ts("srs_doc.req_list") || "需求列表"}
                open={data.showReqListModal}
                onCancel={() => dispatch({ showReqListModal: false })}
                footer={null}
                width={1600}>
                <Table
                    dataSource={data.reqListData}
                    tableLayout="fixed"
                    columns={[
                        {
                            title: ts("srs_doc.srs_code") || "需求编号",
                            dataIndex: "code",
                            width: 120,
                            render: (t: string) => <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t || "-"}</span>,
                        },
                        {
                            title: ts("srs_reqd.name") || "需求名称",
                            dataIndex: "name",
                            width: 160,
                            render: (t: string) => <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t || "-"}</span>,
                        },
                        { title: ts("srs_reqd.overview") || "需求概述", dataIndex: "overview", width: 220, ellipsis: true, render: (t: string) => renderOneLineWithTooltip(t) },
                        { title: ts("srs_doc.main_participant") || "主参加者", dataIndex: "participant", width: 120, ellipsis: true, render: (t: string) => renderOneLineWithTooltip(t) },
                        { title: ts("test_case.precondition") || "前置条件", dataIndex: "pre_condition", width: 200, ellipsis: true, render: (t: string) => renderOneLineWithTooltip(t) },
                        { title: ts("srs_doc.trigger") || "触发器", dataIndex: "trigger", width: 120, ellipsis: true, render: (t: string) => renderOneLineWithTooltip(t) },
                        { title: ts("srs_doc.workflow") || "工作流", dataIndex: "work_flow", width: 200, ellipsis: true, render: (t: string) => renderOneLineWithTooltip(t) },
                        { title: ts("srs_doc.postcondition") || "后置条件", dataIndex: "post_condition", width: 200, ellipsis: true, render: (t: string) => renderOneLineWithTooltip(t) },
                        { title: ts("srs_doc.exception") || "异常情况", dataIndex: "exception", width: 200, ellipsis: true, render: (t: string) => renderOneLineWithTooltip(t) },
                        { title: ts("srs_doc.constraint") || "约束", dataIndex: "constraint", width: 200, ellipsis: true, render: (t: string) => renderOneLineWithTooltip(t) },
                        {
                            title: ts("rcm.code") || "RCM编号",
                            dataIndex: "rcm_codes",
                            width: 160,
                            ellipsis: true,
                            render: (v: string | string[]) => renderOneLineWithTooltip((Array.isArray(v) ? v.join(", ") : v) || "")
                        },
                    ]}
                    rowKey="key"
                    pagination={false}
                    loading={data.reqListLoading}
                    scroll={{ x: 1800 }}
                />
            </Modal>

            {/* 当前页编辑“变更需求” */}
            <EditableTableGenerator
                open={data.showChangeReqEditModal}
                initialData={data.changeReqEditInitialData}
                rcmOptions={[]}
                onConfirm={async (tableData) => {
                    await handleSaveChangeReqInCurrentPage(tableData);
                }}
                onCancel={() => dispatch({ showChangeReqEditModal: false, changeReqEditInitialData: undefined, changeReqEditTarget: undefined })}
            />
        </div>
    );
};
