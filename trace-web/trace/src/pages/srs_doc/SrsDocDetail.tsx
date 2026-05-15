import "./SrsDocDetail.less";
import { Form, Input, Button, message, Row, Col, Modal, Space, Table } from "antd";
import { ArrowLeftOutlined, EditOutlined, DownloadOutlined, FileAddOutlined, PlusOutlined } from "@ant-design/icons";
import { useEffect, useRef } from "react";
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
import TreeStructure, { TreeNode } from "./components/TreeStructure";
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
    const displayProductId = (data.isEdit || isReadOnly) ? (data.docProductId ?? productId) : productId;
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
    const reqListDataForTree = srsSourceCodeSet.size > 0
        ? (data.reqListData || []).filter((item: any) => srsSourceCodeSet.has(normalizeSrsCodeForSync(item?.code)))
        : (data.reqListData || []);
    const filteredSrsTableData = data.srsTableData as any[];
    const filteredSrsOtherReqData = data.srsOtherReqData as any[];
    const filteredSrsChangeTables = (data.srsChangeTables || []).map((table: any) => ({
        ...table,
        data: table.data || [],
    }));
    const normalizeTableTitle = (value?: string) => normalizeReqText(value).replace(/\s+/g, "");
    const normalizeHeaderText = (value?: string) => String(value || "").replace(/\s+/g, "").toLowerCase();
    const isReqMainTable = (table?: any): boolean => {
        if (!table?.headers?.length) return false;
        const hs = table.headers.map((header: any) => normalizeHeaderText(header?.name));
        return hs.some((h: string) => h.includes("需求编号")) && hs.some((h: string) => h.includes("功能"));
    };
    const syncChangeReqTablesToTree = (tree: TreeNode[], changeTables: any[] = []): TreeNode[] => {
        if (!Array.isArray(tree) || !changeTables.length) return tree || [];
        const findColumn = (headers: any[], matcher: (text: string) => boolean) => (
            (headers || []).find((header: any) => matcher(normalizeHeaderText(header?.name)))?.code || ""
        );
        return (tree || []).map((node: any) => {
            const table = node.table;
            let nextTable = table;
            if (isReqMainTable(table) && /变更/.test(String(table?.name || node.title || ""))) {
                const currentTitle = normalizeTableTitle(table?.name || node.title || "");
                const matched = (changeTables || []).find((item: any) => normalizeTableTitle(item?.title) === currentTitle) ||
                    ((changeTables || []).length === 1 ? changeTables[0] : undefined);
                if (matched) {
                    const headers = table?.headers || [];
                    const codeCol = findColumn(headers, (text) => text.includes("需求编号") || text.includes("srscode") || text === "code");
                    const moduleCol = findColumn(headers, (text) => text.includes("模块"));
                    const functionCol = findColumn(headers, (text) => text.includes("功能") && !text.includes("子功能"));
                    const subFunctionCol = findColumn(headers, (text) => text.includes("子功能"));
                    nextTable = {
                        ...table,
                        rows: (matched.data || []).map((row: any) => ({
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
                children: syncChangeReqTablesToTree(node.children || [], changeTables),
            };
        });
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

    useEffect(() => {
        const { nodes, changed } = applyProductScopeToTree(data.treeStructure as TreeNode[], currentProduct);
        if (changed) {
            treeStructureRef.current = nodes;
            dispatch({ treeStructure: nodes });
        }
    }, [displayProductId, currentProduct?.scope]);

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
            // 处理 table：如果是 { headers: null, rows: null } 或无效数据，设置为空对象
            table: (node.table && 
                   node.table.headers !== null && 
                   node.table.rows !== null &&
                   Array.isArray(node.table.headers) && 
                   Array.isArray(node.table.rows) &&
                   node.table.headers.length > 0 &&
                   node.table.rows.length > 0) ? node.table : {},
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
        const typeNameMap = new Map<string, { id: number | string; title: string }>();
        typeRows.forEach((item: any, index: number) => {
            const code = String(item.type_code || "");
            if (!code) return;
            typeNameMap.set(code, {
                id: item.id || `type_${index}`,
                title: item.type_name || `变更表${index + 1}`,
            });
        });
        const groupedByType = new Map<string, any[]>();
        allChangeRows.forEach((reqItem: any) => {
            const code = String(reqItem.type_code || "");
            if (!code) return;
            const list = groupedByType.get(code) || [];
            list.push(reqItem);
            groupedByType.set(code, list);
        });
        const typeCodes = Array.from(new Set([
            ...Array.from(typeNameMap.keys()),
            ...Array.from(groupedByType.keys()),
        ]));
        const changeTablesData = typeCodes.map((code, index) => {
            const meta = typeNameMap.get(code);
            const tableRows = (groupedByType.get(code) || []).map((reqItem: any, reqIndex: number) =>
                toChangeRow(reqItem, `change_${code || index}`, reqIndex)
            );
            return {
                id: meta?.id || `change_${code || index}`,
                title: meta?.title || "变更需求",
                type_code: code,
                data: tableRows,
            };
        });

        return { srsTableData: mainData, srsOtherReqData: otherData, srsChangeTables: changeTablesData };
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

    useEffect(() => {
        const id = params.id;
        if (id) {
            // 编辑模式
            dispatch({ loading: true, isEdit: true });
            Promise.all([Api.get_srs_doc({ id }), fetchSrsTableState(parseInt(id))]).then(([res, srsTableState]: any[]) => {
                if (res.code === Api.C_OK) {
                    const targetRow = res.data;
                    
                    const parsedContentRaw = (targetRow.content || []).map((node: any) => parseTreeNode(node));
                    const parsedContent = parsedContentRaw;
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

    const doSave = () => {
        editForm.validateFields().then((values) => {
            // 包含变更说明和所有表单字段（包括 product_id 和 version）
            const submitData = {
                ...values,
                change_description: data.changeDescription,
                tree_structure: data.treeStructure,
            };
            // 确保 version 字段被包含
            if (!submitData.version && editForm.getFieldValue("version")) {
                submitData.version = editForm.getFieldValue("version");
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
                    message.error(res.msg);
                }
            });
        });
    };

    const handleExport = () => {
        if (!data.isEdit || !params.id) {
            message.warning(ts("srs_doc.please_save_document_first"));
            return;
        }
        editForm.validateFields().then(() => {
            const docId = parseInt(params.id as string);
            const currentTree = syncChangeReqTablesToTree(
                (((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) || []) as TreeNode[],
                data.srsChangeTables || []
            );
            treeStructureRef.current = currentTree;
            const cleanedContent = currentTree.map((node: any) => cleanTreeNode(node, docId, 0));
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
            Api.update_srs_doc(payload).then((saveRes: any) => {
                if (saveRes.code !== Api.C_OK) {
                    dispatch({ exporting: false });
                    message.error(saveRes.msg || ts("save_failed"));
                    return;
                }
                Api.export_srs_doc({ id: params.id }).then((res: any) => {
                    dispatch({ exporting: false });
                    if (res.code !== Api.C_OK) {
                        message.error(res.msg);
                    } else {
                        message.success("导出成功");
                    }
                });
            }).catch(() => {
                dispatch({ exporting: false });
                message.error(ts("save_failed"));
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
        if (node.table) {
            const hasValidHeaders = node.table.headers && Array.isArray(node.table.headers) && node.table.headers.length > 0;
            const hasValidRows = node.table.rows && Array.isArray(node.table.rows) && node.table.rows.length > 0;
            if (hasValidHeaders && hasValidRows) {
                tableValue = node.table;
            }
        }

        const cleaned: any = {
            doc_id: node.doc_id || docId || 0,
            n_id: (typeof node.id === 'string' || !node.n_id) ? 0 : node.n_id, // 新节点的n_id为0，让后端生成
            p_id: node.p_id || parentId || 0,
            title: node.title || "",
            // 有 srs_code 字段则一并提交，便于后端返回后继续显示输入框
            ...(node.srs_code !== undefined && { srs_code: node.srs_code }),
            // 有 rcm_codes 字段则一并提交，便于后端返回后继续显示章节 RCM 选择结果
            ...(node.rcm_codes !== undefined && { rcm_codes: node.rcm_codes }),
            text: node.text || "",
            ...(node.ref_type !== undefined && { ref_type: node.ref_type }),
            ...(node.img_url !== undefined && { img_url: node.img_url ?? "" }),
            // label 不展示，但需一并提交给后端
            ...(node.label !== undefined && { label: node.label ?? "" }),
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
            dispatch({
                srsTableData: srsTableState.srsTableData,
                srsOtherReqData: srsTableState.srsOtherReqData,
                srsChangeTables: srsTableState.srsChangeTables,
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
            const hasCreatedTable = created.type_code && (srsTableState.srsChangeTables || []).some((table: any) => table.type_code === created.type_code);
            dispatch({
                srsTableData: srsTableState.srsTableData,
                srsOtherReqData: srsTableState.srsOtherReqData,
                srsChangeTables: hasCreatedTable
                    ? srsTableState.srsChangeTables
                    : [
                        ...(srsTableState.srsChangeTables || []),
                        ...(created.type_code ? [{
                            id: created.id || `change_${created.type_code}`,
                            title: created.type_name || typeName,
                            type_code: created.type_code,
                            data: [],
                        }] : []),
                    ],
                srsTableLoading: false,
                showAddChangeTableModal: false,
                newChangeTableName: "",
            });
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
            headers,
            data: (table.data || []).map((row: any) => [
                row?.srs_code || "",
                row?.module || "",
                row?.function || "",
                row?.sub_function || "",
            ]),
        };
        dispatch({
            changeReqEditTarget: table,
            changeReqEditInitialData: initialData,
            showChangeReqEditModal: true,
        });
    };

    const handleSaveChangeReqInCurrentPage = async (tableData: TableDataWithHeaders) => {
        const docId = params.id ? parseInt(params.id) : 0;
        const target = data.changeReqEditTarget as any;
        let typeCode = String(target?.type_code || "");
        if (!docId) {
            message.error("变更需求保存失败：缺少文档信息");
            return;
        }

        const rows = (tableData?.data || [])
            .map((row) => ({
                code: String(row?.[0] || "").trim(),
                module: String(row?.[1] || "").trim(),
                function: String(row?.[2] || "").trim(),
                sub_function: String(row?.[3] || "").trim(),
            }))
            .filter((row) => row.code || row.module || row.function || row.sub_function);

        try {
            dispatch({ savingChangeReq: true });
            const nextTableName = String(tableData?.tableName || "").trim();
            let resolvedTarget = target;
            if (!typeCode) {
                const latestState = await fetchSrsTableState(docId);
                const rowCodes = new Set(rows.map((row) => normalizeSrsCodeForSync(row.code)).filter(Boolean));
                const normalizeTitle = (value?: string) => normalizeReqText(value).replace(/\s+/g, "");
                const matchedTable = (latestState.srsChangeTables || []).find((table: any) =>
                    normalizeTitle(table?.title) === normalizeTitle(nextTableName || target?.title)
                ) || (rowCodes.size ? (latestState.srsChangeTables || []).find((table: any) =>
                    (table.data || []).some((row: any) => rowCodes.has(normalizeSrsCodeForSync(row?.srs_code || row?.code)))
                ) : undefined);
                if (matchedTable?.type_code) {
                    resolvedTarget = matchedTable;
                    typeCode = String(matchedTable.type_code || "");
                } else {
                    const typeRes: any = await ApiSrsType.add_srs_type({
                        doc_id: docId,
                        type_name: nextTableName || String(target?.title || "").trim() || "变更需求",
                    });
                    if (typeRes.code !== ApiSrsType.C_OK || !typeRes.data?.type_code) {
                        throw new Error(typeRes.msg || "变更表格创建失败");
                    }
                    resolvedTarget = {
                        ...target,
                        id: typeRes.data.id,
                        title: typeRes.data.type_name || nextTableName || target?.title || "变更需求",
                        type_code: typeRes.data.type_code,
                        data: [],
                    };
                    typeCode = String(typeRes.data.type_code || "");
                }
            }
            if (!typeCode) {
                throw new Error("变更需求保存失败：缺少变更表类型");
            }
            const targetId = Number(resolvedTarget?.id);
            if (nextTableName && nextTableName !== String(resolvedTarget?.title || "").trim() && Number.isFinite(targetId) && targetId > 0) {
                const typeRes: any = await ApiSrsType.update_srs_type({
                    id: targetId,
                    doc_id: docId,
                    type_name: nextTableName,
                    type_code: typeCode,
                });
                if (typeRes.code !== ApiSrsType.C_OK) {
                    throw new Error(typeRes.msg || "表名保存失败");
                }
            }
            const oldRows = (resolvedTarget?.data || []).filter((r: any) => !!r?.id);
            const usedOldIds = new Set<number | string>();
            for (const [index, row] of rows.entries()) {
                const matchedOldRow =
                    oldRows.find((item: any) => item.srs_code === row.code && !usedOldIds.has(item.id)) ||
                    (oldRows[index] && !usedOldIds.has(oldRows[index].id) ? oldRows[index] : undefined);
                const saveData = {
                    id: matchedOldRow?.id || 0,
                    doc_id: docId,
                    code: row.code,
                    module: row.module,
                    function: row.function,
                    sub_function: row.sub_function,
                    location: "",
                    type_code: typeCode,
                    rcm_ids: [],
                };
                if (matchedOldRow?.id) {
                    usedOldIds.add(matchedOldRow.id);
                }
                const saveRes = saveData.id
                    ? await ApiSrsReq.update_srs_req(saveData)
                    : await ApiSrsReq.add_srs_req(saveData);
                if (saveRes.code !== ApiSrsReq.C_OK) {
                    throw new Error(saveRes.msg || "保存失败");
                }
            }
            const srsTableState = await fetchSrsTableState(docId);
            const syncedTree = syncChangeReqTablesToTree(
                ((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) as TreeNode[],
                srsTableState.srsChangeTables
            );
            treeStructureRef.current = syncedTree;
            dispatch({
                srsTableData: srsTableState.srsTableData,
                srsOtherReqData: srsTableState.srsOtherReqData,
                srsChangeTables: srsTableState.srsChangeTables,
                treeStructure: syncedTree,
                srsTableLoading: false,
                savingChangeReq: false,
                showChangeReqEditModal: false,
                changeReqEditInitialData: undefined,
                changeReqEditTarget: undefined,
            });
            loadReqListData();
            message.success("变更需求已保存");
        } catch (error: any) {
            dispatch({ savingChangeReq: false });
            message.error(error?.message || "变更需求保存失败");
        }
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
        const codeCol = pickColumn((text) => text.includes("需求编号") || text.includes("srscode") || text === "code");
        const moduleCol = pickColumn((text) => text.includes("模块"));
        const functionCol = pickColumn((text) => text.includes("功能") && !text.includes("子功能"));
        const subFunctionCol = pickColumn((text) => text.includes("子功能"));
        if (!codeCol || !moduleCol || !functionCol) {
            return;
        }
        const normalizeReqCode = (value?: string) => String(value || "").replace(/\s+/g, "").toUpperCase();
        const lastValues: Record<string, string> = {};
        const rows = (table?.rows || [])
            .map((row: any) => {
                const code = normalizeReqCode(row?.[codeCol]);
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
                    module: rawModule || lastValues.module || "",
                    function: rawFunction || lastValues.function || "",
                    sub_function: rawSubFunction || lastValues.sub_function || "",
                };
            })
            .filter((row: any) => row.code);

        try {
            dispatch({ srsTableLoading: true });
            const latestBeforeSave = await fetchSrsTableState(docId);
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
                    (oldRows[index] && !usedOldIds.has(oldRows[index].id) ? oldRows[index] : undefined) ||
                    matchedByCode;
                if (matchedOldRow?.id) {
                    usedOldIds.add(matchedOldRow.id);
                }
                assignments.push({ row, oldRow: matchedOldRow, code: rowCode });
            });

            const buildSaveData = (item: any, code: string, id = 0) => ({
                id,
                doc_id: docId,
                code,
                module: item.module,
                function: item.function,
                sub_function: item.sub_function,
                location: "",
                type_code: "1",
                rcm_ids: [],
            });
            const updateReq = async (payload: any) => {
                const saveRes = payload.id
                    ? await ApiSrsReq.update_srs_req(payload)
                    : await ApiSrsReq.add_srs_req(payload);
                if (saveRes.code !== ApiSrsReq.C_OK) {
                    throw new Error(saveRes.msg || "SRS表保存失败");
                }
            };

            // 先把本次要保留的旧行移到临时编号，避免 A/B 两行互换编号时触发唯一约束。
            for (const assignment of assignments) {
                const oldRow = assignment.oldRow;
                if (!oldRow?.id) continue;
                const oldCode = normalizeReqCode(oldRow.srs_code || oldRow.code);
                if (oldCode === assignment.code) continue;
                const tempCode = `TMP-SRS-${docId}-${oldRow.id}-${Date.now()}`;
                await updateReq(buildSaveData({
                    module: oldRow.module || "",
                    function: oldRow.function || "",
                    sub_function: oldRow.sub_function || "",
                }, tempCode, oldRow.id));
            }
            // 当前表格复用了某个未分配旧行的编号时，也先释放该编号，随后按当前表格删除旧行。
            for (const oldRow of oldRows) {
                if (usedOldIds.has(oldRow.id)) continue;
                const oldCode = normalizeReqCode(oldRow.srs_code || oldRow.code);
                if (!usedReqCodes.has(oldCode)) continue;
                const tempCode = `TMP-SRS-${docId}-${oldRow.id}-${Date.now()}`;
                await updateReq(buildSaveData({
                    module: oldRow.module || "",
                    function: oldRow.function || "",
                    sub_function: oldRow.sub_function || "",
                }, tempCode, oldRow.id));
            }

            for (const assignment of assignments) {
                const { row, oldRow, code } = assignment;
                const saveData = {
                    id: oldRow?.id || 0,
                    doc_id: docId,
                    code,
                    module: row.module,
                    function: row.function,
                    sub_function: row.sub_function,
                    location: "",
                    type_code: "1",
                    rcm_ids: [],
                };
                await updateReq(saveData);
            }
            const staleStandardRows = oldRows.filter((item: any) => {
                return !usedOldIds.has(item.id);
            });
            for (const item of staleStandardRows) {
                await ApiSrsReq.delete_srs_req({ id: item.id });
            }
            const srsTableState = await fetchSrsTableState(docId);
            dispatch({
                srsTableData: srsTableState.srsTableData,
                srsOtherReqData: srsTableState.srsOtherReqData,
                srsChangeTables: srsTableState.srsChangeTables,
                srsTableLoading: false,
            });
            loadReqListData();
            return srsTableState.srsTableData;
        } catch (error: any) {
            dispatch({ srsTableLoading: false });
            message.error(error?.message || "SRS表保存失败");
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
                    req_id: changeReq.id,
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
            throw new Error(`功能描述保存失败：未找到需求 ${detail.code}`);
        }
        const payload = {
            req_id: existed.req_id,
            overview: detail.overview ?? "",
            participant: detail.participant ?? "",
            pre_condition: detail.pre_condition ?? "",
            trigger: detail.trigger ?? "",
            work_flow: detail.work_flow ?? "",
            post_condition: detail.post_condition ?? "",
            exception: detail.exception ?? "",
            constraint: detail.constraint ?? "",
        };
        const res: any = await ApiSrsReqd.update_srs_reqd(payload);
        if (res.code !== ApiSrsReqd.C_OK) {
            throw new Error(res.msg || "功能描述保存失败");
        }
        const docId = params.id ? parseInt(params.id) : 0;
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
                    item.req_id === existed.req_id ? { ...item, ...payload } : item
                ))
                : [...(data.reqListData || []), { ...existed, ...payload, code: detail.code }];
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
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId) {
            editForm.validateFields().then(() => {
                doSaveTreeStructure();
            }).catch(() => {
                message.error(ts("srs_doc.version_required"));
            });
            return;
        }
        doSaveTreeStructure();
    };

    const doSaveTreeStructure = () => {
        const productId = editForm.getFieldValue("product_id");
        const version = editForm.getFieldValue("version");
        dispatch({ saving: true });
        const docId = params.id ? parseInt(params.id) : 0;

        // 清理树状结构数据，传入文档ID和根节点的父ID（0表示无父节点）
        const currentTree = syncChangeReqTablesToTree(
            (((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) || []) as TreeNode[],
            data.srsChangeTables || []
        );
        treeStructureRef.current = currentTree;
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
                    Api.get_srs_doc({ id: params.id }).then((reloadRes: any) => {
                        if (reloadRes.code === Api.C_OK) {
                            const targetRow = reloadRes.data;
                            
                            const parsedContent = (targetRow.content || []).map((node: any) => parseTreeNode(node));
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
                    {(data.isEdit || isReadOnly) ? (
                        <Row gutter={24} className="form-display-row">
                            <Col span={8}>
                                <span className="form-display-label">{ts("srs_doc.current_product")}：</span>
                                <span className="form-display-value">{productLabel || "-"}</span>
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
                            hiddenNodeIds={hiddenNodeIds}
                            onNodeDelete={isReadOnly ? undefined : handleNodeDelete}
                            readOnly={isReadOnly}
                            rcmOptions={data.rcmOptions}
                            srsReqPreview={{
                                main: filteredSrsTableData as any[],
                                other: filteredSrsOtherReqData as any[],
                                changes: filteredSrsChangeTables as Array<{ id: number | string; title: string; data: any[] }>,
                            }}
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
                            onSaveReqDetailTable={handleSaveReqDetailTable}
                            onSaveSrsReqTable={handleSaveSrsReqTableInCurrentPage}
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
                onConfirm={handleSaveChangeReqInCurrentPage}
                onCancel={() => dispatch({ showChangeReqEditModal: false, changeReqEditInitialData: undefined, changeReqEditTarget: undefined })}
            />
        </div>
    );
};
