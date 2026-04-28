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

    // 加载产品列表
    useEffect(() => {
        ApiProduct.list_product({ page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) {
                dispatch({ products: res.data.rows });
            }
        });
    }, []);

    const productId = Form.useWatch("product_id", editForm);
    const folderName = Form.useWatch("folder_name", editForm);
    const fileNo = Form.useWatch("file_no", editForm);
    const displayProductId = (data.isEdit || isReadOnly) ? (data.docProductId ?? productId) : productId;
    const currentProduct = (data.products as any[]).find((p: any) => p.id === displayProductId);
    const productLabel = currentProduct ? `${currentProduct.name}-${currentProduct.full_version}` : "";

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
        return matches.sort((a, b) => b.length - a.length)[0];
    };

    const isIncompleteFileNo = (value?: string) => {
        const v = (value || "").trim();
        return !v || v.length < 8 || !v.includes("-");
    };

    useEffect(() => {
        const id = params.id;
        if (id) {
            // 编辑模式
            dispatch({ loading: true, isEdit: true });
            Api.get_srs_doc({ id }).then((res: any) => {
                if (res.code === Api.C_OK) {
                    const targetRow = res.data;
                    
                    const parsedContent = (targetRow.content || []).map((node: any) => parseTreeNode(node));
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
                    });
                    treeStructureRef.current = parsedContent;
                    loadSrsTableData();
                } else {
                    message.error(res.msg);
                    dispatch({ loading: false });
                    navigate("/srs_docs");
                }
            });
        } else {
            // 新增模式
            editForm.resetFields();
            dispatch({ isEdit: false, srsTableData: [], srsOtherReqData: [], srsChangeTables: [] });
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
            const currentTree = (((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) || []) as any[];
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
    const loadSrsTableData = () => {
        const docId = params.id ? parseInt(params.id) : 0;
        if (!docId) {
            return;
        }
        dispatch({ srsTableLoading: true });
        Promise.all([
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
        ]).then(([reqRes, typeRes]: any[]) => {
            if (reqRes.code !== Api.C_OK) {
                message.error(reqRes.msg || "加载SRS表数据失败");
                dispatch({ srsTableData: [], srsOtherReqData: [], srsChangeTables: [], srsTableLoading: false });
                return;
            }
            const rows = reqRes.data?.rows || [];
            const mainData = rows
                .filter((item: any) => item.type_code === "1")
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
            const changeTablesData = typeRows.map((item: any, index: number) => {
                const tableRows = rows
                    .filter((reqItem: any) => !isBaseReq(reqItem) && reqItem.type_code === item.type_code)
                    .map((reqItem: any, reqIndex: number) => ({
                        key: reqItem.id || `change_${item.id}_${reqIndex}_${Date.now()}`,
                        id: reqItem.id,
                        doc_id: reqItem.doc_id,
                        srs_code: reqItem.code || "",
                        module: normalizeReqText(reqItem.module),
                        function: normalizeReqText(reqItem.function),
                        sub_function: normalizeReqText(reqItem.sub_function),
                        location: reqItem.location || "",
                        type_code: reqItem.type_code || "",
                    }));
                return {
                    id: item.id || 0,
                    title: item.type_name || `变更表${index + 1}`,
                    type_code: item.type_code || "",
                    data: tableRows,
                };
            });

            dispatch({
                srsTableData: mainData,
                srsOtherReqData: otherData,
                srsChangeTables: changeTablesData,
                srsTableLoading: false,
            });
        }).catch((error: any) => {
            console.error("加载SRS表数据失败:", error);
            message.error("加载SRS表数据失败");
            dispatch({ srsTableData: [], srsOtherReqData: [], srsChangeTables: [], srsTableLoading: false });
        });
    };

    const openChangeReqEditModal = (table: { id: number | string; title: string; type_code?: string; data: any[] }) => {
        const headers = [
            { code: "srs_code", name: ts("srs_doc.srs_code") || "需求编号" },
            { code: "module", name: ts("srs_doc.module") || "模块" },
            { code: "function", name: ts("srs_doc.function") || "功能" },
            { code: "sub_function", name: ts("srs_doc.sub_function") || "子功能" },
        ];
        const initialData: TableDataWithHeaders = {
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
        const typeCode = String(target?.type_code || "");
        if (!docId || !typeCode) {
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
            const oldRows = (target?.data || []).filter((r: any) => !!r?.id);
            for (const item of oldRows) {
                // 先清空原有行，再按编辑后结果重建，保证当前页编辑结果和管理页一致
                await ApiSrsReq.delete_srs_req({ id: item.id });
            }
            for (const row of rows) {
                const saveData = {
                    id: 0,
                    doc_id: docId,
                    code: row.code,
                    module: row.module,
                    function: row.function,
                    sub_function: row.sub_function,
                    location: "",
                    type_code: typeCode,
                    rcm_ids: [],
                };
                const saveRes = await ApiSrsReq.add_srs_req(saveData);
                if (saveRes.code !== ApiSrsReq.C_OK) {
                    throw new Error(saveRes.msg || "保存失败");
                }
            }
            dispatch({ savingChangeReq: false, showChangeReqEditModal: false, changeReqEditInitialData: undefined, changeReqEditTarget: undefined });
            await loadSrsTableData();
            message.success("变更需求已保存");
        } catch (error: any) {
            dispatch({ savingChangeReq: false });
            message.error(error?.message || "变更需求保存失败");
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
                    overview: item.overview || "",
                    participant: item.participant || "",
                    pre_condition: item.pre_condition || "",
                    trigger: item.trigger || "",
                    work_flow: item.work_flow || "",
                    post_condition: item.post_condition || "",
                    exception: item.exception || "",
                    constraint: item.constraint || "",
                    rcm_codes: item.rcm_codes || [],
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
        return ["编制科室", "文件版本", "编制人", "审核人", "批准人", "生效日期"].every((k) => txt.includes(k));
    };
    const isChangeLogTable = (node: TreeNode) => {
        const txt = getTableText(node);
        return ["修改日期", "版本号", "修订说明", "修订人", "批准人"].every((k) => txt.includes(k));
    };
    const isCatalogNode = (node: TreeNode) => normalizeText(node.title).includes("目录");
    const isApprovalNode = (node: TreeNode) => normalizeText(node.title).includes("需求规格说明") || isApprovalTable(node);
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
    const approvalRoot = treeRoots.find((node) => normalizeText(node.title).includes("需求规格说明"));
    const changeLogRoot = treeRoots.find((node) => normalizeText(node.title).includes("文件修订记录"));
    const derivedCoverTitle = extractCoverTitleFromTree(treeRoots);
    const derivedFileNo = extractFileNoFromTree(treeRoots);
    const approvalRoots = approvalRoot ? [approvalRoot] : treeRoots.filter((node) => subtreeMatches(node, isApprovalNode));
    const changeLogRoots = changeLogRoot ? [changeLogRoot] : treeRoots.filter((node) => subtreeMatches(node, isChangeLogNode));
    const hiddenNodeIds = treeRoots
        .filter((node) => isCatalogNode(node) || subtreeMatches(node, isApprovalNode) || subtreeMatches(node, isChangeLogNode))
        .flatMap((node) => collectSubtreeIds(node));
    const cnNameFromDoc = (derivedCoverTitle || approvalRoot?.title || "").trim();
    const extractedFileName = (/[一-龥]/.test(cnNameFromDoc) ? cnNameFromDoc : (folderName || "")).trim();
    const displayFileNo = (isIncompleteFileNo(fileNo) ? (derivedFileNo || fileNo || "") : (fileNo || "")).trim();

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

    const renderExtractedTable = (node: TreeNode, keyPrefix: string) => {
        if (!node.table?.headers || !node.table?.rows) return null;
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
        const currentTree = (((treeStructureRef.current || []).length > 0 ? treeStructureRef.current : data.treeStructure) || []) as any[];
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

                {/* 目录结构区域 */}
                <div className="doc-section doc-section-flex">
                    <div className="doc-section-header">
                        <div className="doc-section-title">
                            {ts("srs_doc.directory_structure")}
                        </div>
                        <div className="doc-section-buttons">
                            {!isReadOnly && (
                            <Button 
                                type="primary" 
                                icon={<PlusOutlined />}
                                onClick={handleAddRootNode}>
                                {ts("srs_doc.add_root_menu")}
                            </Button>
                            )}
                        </div>
                    </div>
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
                            main: data.srsTableData as any[],
                            other: data.srsOtherReqData as any[],
                            changes: data.srsChangeTables as Array<{ id: number | string; title: string; data: any[] }>,
                        }}
                        srsReqLoading={data.srsTableLoading}
                        onNodesSnapshot={(nodes) => {
                            treeStructureRef.current = (nodes || []) as TreeNode[];
                        }}
                        onOpenSrsTable={() => {
                            loadSrsTableData();
                            dispatch({ showSrsTableModal: true });
                        }}
                        onOpenReqList={() => {
                            loadReqListData();
                            dispatch({ showReqListModal: true });
                        }}
                        onEditSrsChangeTable={openChangeReqEditModal}
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
                    dataSource={data.srsTableData}
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
                    dataSource={data.srsOtherReqData}
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

                {(data.srsChangeTables || []).map((table: any) => (
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
