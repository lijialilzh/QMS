import "./SrsManage.less";
import { Form, Input, Button, Select, Row, Col, Table, Space, message, Tooltip, Tag } from "antd";
import { PlusOutlined, DeleteOutlined, SearchOutlined, EditOutlined, CheckOutlined, CloseOutlined, CopyOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as ApiProduct from "@/api/ApiProduct";
import * as Api from "@/api/ApiSrsDoc";
import * as ApiSrsReq from "@/api/ApiSrsReq";
import * as ApiSrsType from "@/api/ApiSrsType";
import * as ApiProdRcm from "@/api/ApiProdRcm";

export default () => {
    const { t: ts } = useTranslation();
    const location = useLocation();
    const [editForm] = Form.useForm();
    const [data, dispatch] = useData({
        products: [],
        srsDocs: [], // SRS文档列表
        rcmOptions: [] as Array<{ value: number; label: string; description?: string }>,
        loading: false,
        mainTableData: [], // 主表格数据 (type_code: 1)
        otherReqData: [], // 其他需求列表数据 (type_code: 2)
        changeTables: [] as Array<{ id: string | number; title: string; type_code?: string; data: any[] }>, // 变更表格数组，每个表格有id、标题和数据
        isAddingRow: false, // 是否正在添加行
        targetEdit: {} as any, // 正在编辑的行数据（主表格）
        targetEditOther: {} as any, // 正在编辑的行数据（其他需求列表）
        targetEditChange: {} as any, // 正在编辑的行数据（变更表格），格式：{ tableId: { key, id, ... } }
        updating: false, // 是否正在更新
        updatingOther: false, // 是否正在更新其他需求列表
        updatingChange: {} as Record<string | number, boolean>, // 是否正在更新变更表格，格式：{ tableId: true/false }
        editingTableId: null as string | number | null, // 正在编辑的表格ID
        editingTableTitle: "", // 编辑中的表格标题
        initedByDocDetail: false,
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

    // 从“文档编辑页”跳转过来时，自动定位到当前产品/版本，便于直接编辑其他需求和变更需求
    useEffect(() => {
        const state: any = location.state || {};
        if (!state?.fromDocDetail || data.initedByDocDetail) {
            return;
        }
        const productId = Number(state.product_id || 0);
        const docId = Number(state.doc_id || 0);
        if (productId) {
            editForm.setFieldValue("product_id", productId);
            handleProductChange(productId);
        }
        if (docId) {
            editForm.setFieldValue("doc_id", docId);
            handleDocIdChange(docId);
        }
        dispatch({ initedByDocDetail: true });
    }, [location.state, data.initedByDocDetail]);

    // 加载产品相关的 RCM 数据
    const loadProductRcm = (productId: number) => {
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

    // 当产品ID变化时，加载该产品下的SRS文档列表
    const handleProductChange = (productId: number) => {
        // 产品变化时，清空当前版本和已加载的数据
        editForm.setFieldValue("doc_id", undefined);
        dispatch({ 
            srsDocs: [], 
            rcmOptions: [],
            mainTableData: [], 
            otherReqData: [], 
            changeTables: [],
            targetEdit: {},
            targetEditOther: {},
            targetEditChange: {},
            isAddingRow: false,
            editingTableId: null,
            editingTableTitle: "",
        });
        
        if (!productId) {
            return;
        }
        
        Api.list_srs_doc({ product_id: productId, page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ srsDocs: res.data.rows || [] });
            }
        });
        loadProductRcm(productId);
    };

    // 当文档ID变化时，加载该文档的需求数据
    const handleDocIdChange = (docId: number) => {
        if (!docId) {
            dispatch({ 
                mainTableData: [], 
                otherReqData: [], 
                changeTables: [],
                targetEdit: {},
                targetEditOther: {},
                targetEditChange: {},
                isAddingRow: false,
                editingTableId: null,
                editingTableTitle: "",
            });
            return;
        }
        dispatch({ loading: true, targetEdit: {}, targetEditOther: {}, targetEditChange: {}, isAddingRow: false, editingTableId: null, editingTableTitle: "" });
        
        // 并行加载需求数据和变更表格数据
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
            })
        ]).then(([reqRes, typeRes]: any[]) => {
            // 处理需求数据
            if (reqRes.code === ApiSrsReq.C_OK) {
                const rows = reqRes.data?.rows || [];
                console.log("加载的需求数据:", rows);
                
                // type_code 为 1 的数据显示在 SRS 表（主表格）
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
                        rcm_codes: item.rcm_codes || [],
                        rcm_ids: item.rcm_ids || [],
                    }));
                console.log("转换后的主表格数据:", mainData);
                
                // type_code 为 2 的数据显示在其他需求列表
                const otherData = rows
                    .filter((item: any) => item.type_code === "2")
                    .map((item: any, index: number) => ({
                        key: item.id || `other_${index}_${Date.now()}`,
                        id: item.id,
                        srs_code: item.code || "",
                        module: item.module || "",
                        location: item.location || "",
                        rcm_codes: item.rcm_codes || [],
                        rcm_ids: item.rcm_ids || [],
                    }));
                
                dispatch({ mainTableData: mainData, otherReqData: otherData });
            } else {
                message.error(reqRes.msg || "加载数据失败");
                dispatch({ mainTableData: [], otherReqData: [] });
            }
            
            // 处理变更表格数据
            if (typeRes.code === ApiSrsType.C_OK) {
                const typeRows = typeRes.data?.rows || [];
                console.log("加载的变更表格数据:", typeRows);
                
                // 从需求数据中根据 type_code 过滤出每个变更表格的行数据
                // - 主表/其他需求：type_code === "1"/"2"
                // - 变更表格：用 list_srs_type 的 type_code 承接“剩余”的行，避免重复显示
                const allReqRows = reqRes.code === ApiSrsReq.C_OK ? reqRes.data?.rows || [] : [];
                const isBaseReq = (r: any) => r?.type_code === "1" || r?.type_code === "2";
                
                // 将返回的 rows 数组转换为变更表格数据，支持多个表格
                const changeTablesData = typeRows.map((item: any, index: number) => {
                    // 根据 type_code 过滤出该表格的行数据
                    const tableRows = allReqRows
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
                            rcm_codes: reqItem.rcm_codes || [],
                            rcm_ids: reqItem.rcm_ids || [],
                        }));
                    
                    return {
                        id: item.id || 0, // 处理 id 为 0 的情况
                        title: item.type_name || `表格${index + 1}`,
                        type_code: item.type_code || "",
                        data: tableRows, // 从 list_srs_req 中获取的行数据
                    };
                });
                console.log("转换后的变更表格数据:", changeTablesData);
                dispatch({ changeTables: changeTablesData });
            } else {
                message.error(typeRes.msg || "加载变更表格数据失败");
                dispatch({ changeTables: [] });
            }
            
            dispatch({ loading: false });
        }).catch((error: any) => {
            console.error("加载数据失败:", error);
            message.error("加载数据失败");
            dispatch({ loading: false, mainTableData: [], otherReqData: [], changeTables: [] });
        });
    };

    // 搜索按钮点击事件
    const handleSearch = () => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        handleDocIdChange(docId);
    };

    // 构建可编辑表格的列定义（不包含操作列）
    const buildEditableColumns = (isEditing: (row: any) => boolean, onCellChange: (field: string, value: string | number[]) => void) => [
        {
            title: ts("srs_doc.srs_code") || "需求编号",
            dataIndex: "srs_code",
            render: (value: any, record: any) => {
                if (!isEditing(record)) {
                    return value || "";
                }
                return (
                    <Input
                        value={data.targetEdit.srs_code || ""}
                        onChange={(e) => onCellChange("srs_code", e.target.value)}
                        placeholder="请输入需求编号"
                        size="small"
                        style={{ width: "100%" }}
                    />
                );
            },
        },
        {
            title: ts("srs_doc.module") || "模块",
            dataIndex: "module",
            render: (value: any, record: any) => {
                if (!isEditing(record)) {
                    return value || "";
                }
                return (
                    <Input
                        value={data.targetEdit.module || ""}
                        onChange={(e) => onCellChange("module", e.target.value)}
                        placeholder="请输入模块"
                        size="small"
                        style={{ width: "100%" }}
                    />
                );
            },
        },
        {
            title: ts("srs_doc.function") || "功能",
            dataIndex: "function",
            render: (value: any, record: any) => {
                if (!isEditing(record)) {
                    return value || "";
                }
                return (
                    <Input
                        value={data.targetEdit.function || ""}
                        onChange={(e) => onCellChange("function", e.target.value)}
                        placeholder="请输入功能"
                        size="small"
                        style={{ width: "100%" }}
                    />
                );
            },
        },
        {
            title: ts("srs_doc.sub_function") || "子功能",
            dataIndex: "sub_function",
            render: (value: any, record: any) => {
                if (!isEditing(record)) {
                    return value || "";
                }
                return (
                    <Input
                        value={data.targetEdit.sub_function || ""}
                        onChange={(e) => onCellChange("sub_function", e.target.value)}
                        placeholder="请输入子功能"
                        size="small"
                        style={{ width: "100%" }}
                    />
                );
            },
        },
    ];

    // 主表格单元格变更处理
    const handleMainTableCellChange = (field: string, value: string | number[]) => {
        dispatch({ targetEdit: { ...data.targetEdit, [field]: value } });
    };

    // 变更表格单元格变更处理
    const handleChangeTableCellChange = (tableId: string | number, field: string, value: string | number[]) => {
        const currentEdit = data.targetEditChange[tableId] || {};
        dispatch({ 
            targetEditChange: { 
                ...data.targetEditChange, 
                [tableId]: { ...currentEdit, [field]: value } 
            } 
        });
    };

    // 保存单行数据
    const handleSaveRow = () => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        
        const code = (data.targetEdit.srs_code || "").trim();
        const module = (data.targetEdit.module || "").trim();
        const function_ = (data.targetEdit.function || "").trim();
        const subFunction = (data.targetEdit.sub_function || "").trim();
        
        // 验证至少有一个字段不为空
        if (!code && !module && !function_ && !subFunction) {
            message.warning("至少需要填写一个字段（需求编号、模块、功能、子功能）");
            return;
        }
        
        const saveData = {
            id: data.targetEdit.id || 0,
            doc_id: docId,
            code: code,
            module: module,
            function: function_,
            sub_function: subFunction,
            location: (data.targetEdit.location || "").trim(),
            type_code: "1", // SRS表固定为 1
            rcm_ids: Array.isArray(data.targetEdit.rcm_ids) ? data.targetEdit.rcm_ids : [],
        };

        // 根据是否有 id 判断是新增还是更新
        const isNew = !data.targetEdit.id || data.targetEdit.id === 0;
        dispatch({ updating: true });
        const apiCall = isNew ? ApiSrsReq.add_srs_req(saveData) : ApiSrsReq.update_srs_req(saveData);

        apiCall.then((res: any) => {
            if (res.code === ApiSrsReq.C_OK) {
                message.success(res.msg || "保存成功");
                dispatch({ updating: false, targetEdit: {}, isAddingRow: false });
                // 重新加载数据
                handleDocIdChange(docId);
            } else {
                dispatch({ updating: false });
                message.error(res.msg || "保存失败");
            }
        }).catch((error: any) => {
            console.error("保存失败:", error);
            dispatch({ updating: false });
            message.error("保存失败");
        });
    };

    // 复制主表格行到下一条并进入编辑状态
    const handleCopyRow = (row: any) => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        if (data.targetEdit.key) {
            message.warning("请先保存或取消当前正在编辑的行");
            return;
        }
        if (data.targetEditOther.key) {
            message.warning("请先保存或取消其他需求列表中正在编辑的行");
            return;
        }

        const copiedRow = {
            key: Date.now() + Math.random(),
            id: 0,
            doc_id: docId,
            srs_code: row.srs_code || "",
            module: row.module || "",
            function: row.function || "",
            sub_function: row.sub_function || "",
            location: row.location || "",
            type_code: "1",
            rcm_codes: row.rcm_codes || [],
            rcm_ids: row.rcm_ids || [],
        };

        const rowIndex = data.mainTableData.findIndex((r: any) => r.key === row.key);
        const newData = [...data.mainTableData];
        newData.splice(rowIndex >= 0 ? rowIndex + 1 : newData.length, 0, copiedRow);
        dispatch({ mainTableData: newData, isAddingRow: true, targetEdit: { ...copiedRow } });
    };

    // 在当前行下方插入空行并进入编辑状态（主表格）
    const handleAddRowBelow = (row: any) => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        if (data.targetEdit.key) {
            message.warning("请先保存或取消当前正在编辑的行");
            return;
        }
        if (data.targetEditOther.key) {
            message.warning("请先保存或取消其他需求列表中正在编辑的行");
            return;
        }

        const newRow = {
            key: Date.now() + Math.random(),
            id: 0,
            doc_id: docId,
            srs_code: "",
            module: "",
            function: "",
            sub_function: "",
            location: "",
            type_code: "1",
            rcm_codes: [],
            rcm_ids: [],
        };

        const rowIndex = data.mainTableData.findIndex((r: any) => r.key === row.key);
        const newData = [...data.mainTableData];
        newData.splice(rowIndex >= 0 ? rowIndex + 1 : newData.length, 0, newRow);
        dispatch({ mainTableData: newData, isAddingRow: true, targetEdit: { ...newRow } });
    };

    // 删除单行数据
    const handleDeleteRow = (row: any) => {
        // 如果是新增的行（没有 id），直接从前端删除
        if (!row.id || row.id === 0) {
            const newData = data.mainTableData.filter((item: any) => item.key !== row.key);
            dispatch({ mainTableData: newData, isAddingRow: false, targetEdit: {} });
            return;
        }

        // 如果有 id，调用删除接口
        ApiSrsReq.delete_srs_req({ id: row.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success(res.msg || "删除成功");
                const docId = editForm.getFieldValue("doc_id");
                if (docId) {
                    handleDocIdChange(docId);
                }
            } else {
                message.error(res.msg || "删除失败");
            }
        }).catch((error: any) => {
            console.error("删除失败:", error);
            message.error("删除失败");
        });
    };

    // 其他需求列表单元格变更处理
    const handleOtherTableCellChange = (field: string, value: string | number[]) => {
        dispatch({ targetEditOther: { ...data.targetEditOther, [field]: value } });
    };

    // 保存其他需求列表单行数据
    const handleSaveOtherRow = () => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        
        const code = (data.targetEditOther.srs_code || "").trim();
        const module = (data.targetEditOther.module || "").trim();
        const location = (data.targetEditOther.location || "").trim();
        
        // 验证至少有一个字段不为空
        if (!code && !module && !location) {
            message.warning("至少需要填写一个字段（需求编号、模块、对应的章节号）");
            return;
        }
        
        const saveData = {
            id: data.targetEditOther.id || 0,
            doc_id: docId,
            code: code,
            module: module,
            location: location,
            type_code: "2", // 其他需求列表固定为 2
            rcm_ids: Array.isArray(data.targetEditOther.rcm_ids) ? data.targetEditOther.rcm_ids : [],
        };

        // 根据是否有 id 判断是新增还是更新
        const isNew = !data.targetEditOther.id || data.targetEditOther.id === 0;
        dispatch({ updatingOther: true });
        const apiCall = isNew ? ApiSrsReq.add_srs_req(saveData) : ApiSrsReq.update_srs_req(saveData);

        apiCall.then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success(res.msg || "保存成功");
                dispatch({ updatingOther: false, targetEditOther: {}, isAddingRow: false });
                // 重新加载数据
                handleDocIdChange(docId);
            } else {
                dispatch({ updatingOther: false });
                message.error(res.msg || "保存失败");
            }
        }).catch((error: any) => {
            console.error("保存失败:", error);
            dispatch({ updatingOther: false });
            message.error("保存失败");
        });
    };

    // 删除其他需求列表单行数据
    const handleDeleteOtherRow = (row: any) => {
        // 如果是新增的行（没有 id），直接从前端删除
        if (!row.id || row.id === 0) {
            const newData = data.otherReqData.filter((item: any) => item.key !== row.key);
            dispatch({ otherReqData: newData, isAddingRow: false, targetEditOther: {} });
            return;
        }

        // 如果有 id，调用删除接口
        ApiSrsReq.delete_srs_req({ id: row.id }).then((res: any) => {
            if (res.code === ApiSrsReq.C_OK) {
                message.success(res.msg || "删除成功");
                const docId = editForm.getFieldValue("doc_id");
                if (docId) {
                    handleDocIdChange(docId);
                }
            } else {
                message.error(res.msg || "删除失败");
            }
        }).catch((error: any) => {
            console.error("删除失败:", error);
            message.error("删除失败");
        });
    };

    // 复制其他需求列表行到下一条并进入编辑状态
    const handleCopyOtherRow = (row: any) => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        if (data.targetEditOther.key) {
            message.warning("请先保存或取消当前正在编辑的行");
            return;
        }
        if (data.targetEdit.key) {
            message.warning("请先保存或取消SRS表中正在编辑的行");
            return;
        }

        const copiedRow = {
            key: Date.now() + Math.random(),
            id: 0,
            doc_id: docId,
            srs_code: row.srs_code || "",
            module: row.module || "",
            location: row.location || "",
            type_code: "2",
            rcm_codes: row.rcm_codes || [],
            rcm_ids: row.rcm_ids || [],
        };

        const currentIndex = data.otherReqData.findIndex((r: any) => r.key === row.key);
        const insertIndex = currentIndex >= 0 ? currentIndex + 1 : data.otherReqData.length;
        const newData = [...data.otherReqData];
        newData.splice(insertIndex, 0, copiedRow);
        dispatch({ otherReqData: newData, isAddingRow: true, targetEditOther: { ...copiedRow } });
    };

    // 在当前行下方插入空行并进入编辑状态（其他需求列表）
    const handleAddOtherRowBelow = (row: any) => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        if (data.targetEditOther.key) {
            message.warning("请先保存或取消当前正在编辑的行");
            return;
        }
        if (data.targetEdit.key) {
            message.warning("请先保存或取消SRS表中正在编辑的行");
            return;
        }

        const newRow = {
            key: Date.now() + Math.random(),
            id: 0,
            doc_id: docId,
            srs_code: "",
            module: "",
            location: "",
            type_code: "2",
            rcm_codes: [],
            rcm_ids: [],
        };

        const currentIndex = data.otherReqData.findIndex((r: any) => r.key === row.key);
        const insertIndex = currentIndex >= 0 ? currentIndex + 1 : data.otherReqData.length;
        const newData = [...data.otherReqData];
        newData.splice(insertIndex, 0, newRow);
        dispatch({ otherReqData: newData, isAddingRow: true, targetEditOther: { ...newRow } });
    };

    // 添加其他需求列表行
    const handleAddOtherRow = () => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        
        if (data.targetEditOther.key) {
            message.warning("请先保存或取消当前正在编辑的行");
            return;
        }
        
        if (data.targetEdit.key) {
            message.warning("请先保存或取消SRS表中正在编辑的行");
            return;
        }
        
        const newRow = {
            key: Date.now() + Math.random(),
            id: 0, // 新增行 id 为 0
            doc_id: docId,
            srs_code: "",
            module: "",
            location: "",
            type_code: "2", // 其他需求列表固定为 2
            rcm_codes: [],
            rcm_ids: [],
        };
        dispatch({ 
            otherReqData: [...data.otherReqData, newRow], 
            isAddingRow: true,
            targetEditOther: { ...newRow }
        });
    };

    // 构建其他需求列表可编辑列定义
    const buildOtherEditableColumns = () => [
        {
            title: ts("srs_doc.srs_code") || "需求编号",
            dataIndex: "srs_code",
            render: (value: any, record: any) => {
                if (data.targetEditOther.key !== record.key) {
                    return value || "";
                }
                return (
                    <Input
                        value={data.targetEditOther.srs_code || ""}
                        onChange={(e) => handleOtherTableCellChange("srs_code", e.target.value)}
                        placeholder="请输入需求编号"
                        size="small"
                        style={{ width: "100%" }}
                    />
                );
            },
        },
        {
            title: ts("srs_doc.module") || "需求模块",
            dataIndex: "module",
            render: (value: any, record: any) => {
                if (data.targetEditOther.key !== record.key) {
                    return value || "";
                }
                return (
                    <Input
                        value={data.targetEditOther.module || ""}
                        onChange={(e) => handleOtherTableCellChange("module", e.target.value)}
                        placeholder="请输入模块"
                        size="small"
                        style={{ width: "100%" }}
                    />
                );
            },
        },
        {
            title: ts("srs_doc.chapter_number") || "对应的章节号",
            dataIndex: "location",
            render: (value: any, record: any) => {
                if (data.targetEditOther.key !== record.key) {
                    return value || "";
                }
                return (
                    <Input
                        value={data.targetEditOther.location || ""}
                        onChange={(e) => handleOtherTableCellChange("location", e.target.value)}
                        placeholder="请输入章节号"
                        size="small"
                        style={{ width: "100%" }}
                    />
                );
            },
        },
    ];

    // 其他需求列表列定义
    const otherColumns = [
        ...buildOtherEditableColumns(),
        {
            title: ts("action"),
            width: 180,
            render: (_value: any, row: any) => {
                const isEditing = data.targetEditOther.key === row.key;
                return (
                    <Space>
                        {!isEditing && (
                            <Button
                                type="link"
                                icon={<CopyOutlined />}
                                onClick={() => handleCopyOtherRow(row)}>
                                复制
                            </Button>
                        )}
                        {isEditing && (
                            <Button 
                                type="link" 
                                icon={<CloseOutlined />}
                                onClick={() => {
                                    // 若是新增未保存的行，取消时从数据中移除
                                    if (data.targetEditOther.id === 0) {
                                        dispatch({
                                            otherReqData: data.otherReqData.filter((r: any) => r.key !== data.targetEditOther.key),
                                            targetEditOther: {},
                                            isAddingRow: false,
                                        });
                                    } else {
                                        dispatch({ targetEditOther: {}, isAddingRow: false });
                                    }
                                }}>
                                {ts("cancel")}
                            </Button>
                        )}
                        <Button
                            type="link"
                            icon={isEditing ? <CheckOutlined /> : <EditOutlined />}
                            loading={data.updatingOther && isEditing}
                            onClick={() => {
                                if (isEditing) {
                                    handleSaveOtherRow();
                                } else {
                                    if (data.targetEditOther.key && (data.targetEditOther.id === 0 || !data.targetEditOther.id)) {
                                        dispatch({
                                            otherReqData: data.otherReqData.filter((r: any) => r.key !== data.targetEditOther.key),
                                            targetEditOther: { ...row },
                                            isAddingRow: false,
                                        });
                                    } else {
                                        dispatch({ targetEditOther: { ...row } });
                                    }
                                }
                            }}>
                            {isEditing ? ts("save") : ts("edit")}
                        </Button>
                        {!isEditing && (
                            <Button 
                                type="link" 
                                danger 
                                icon={<DeleteOutlined />}
                                onClick={() => handleDeleteOtherRow(row)}>
                                {ts("delete")}
                            </Button>
                        )}
                    </Space>
                );
            },
        },
        {
            title: "",
            width: 48,
            align: "center" as const,
            render: (_value: any, row: any) => (
                <Tooltip title={ts("srs_doc.add_row") || "添加行"}>
                    <Button
                        type="link"
                        size="small"
                        icon={<PlusOutlined />}
                        disabled={!!data.targetEditOther.key || !!data.targetEdit.key || !editForm.getFieldValue("doc_id")}
                        onClick={() => handleAddOtherRowBelow(row)}
                    />
                </Tooltip>
            ),
        },
    ];

    // 主表格列定义
    const mainColumns = [
        ...buildEditableColumns(
            (row: any) => data.targetEdit.key === row.key,
            handleMainTableCellChange
        ),
        {
            title: ts("action"),
            width: 180,
            render: (_value: any, row: any) => {
                const isEditing = data.targetEdit.key === row.key;
                return (
                    <Space>
                        {!isEditing && (
                            <Button
                                type="link"
                                icon={<CopyOutlined />}
                                onClick={() => handleCopyRow(row)}>
                                复制
                            </Button>
                        )}
                        {isEditing && (
                            <Button 
                                type="link" 
                                icon={<CloseOutlined />}
                                onClick={() => {
                                    // 若是新增未保存的行，取消时从数据中移除
                                    if (data.targetEdit.id === 0) {
                                        dispatch({
                                            mainTableData: data.mainTableData.filter((r: any) => r.key !== data.targetEdit.key),
                                            targetEdit: {},
                                            isAddingRow: false,
                                        });
                                    } else {
                                        dispatch({ targetEdit: {}, isAddingRow: false });
                                    }
                                }}>
                                {ts("cancel")}
                            </Button>
                        )}
                        <Button
                            type="link"
                            icon={isEditing ? <CheckOutlined /> : <EditOutlined />}
                            loading={data.updating && isEditing}
                            onClick={() => {
                                if (isEditing) {
                                    handleSaveRow();
                                } else {
                                    if (data.targetEdit.key && (data.targetEdit.id === 0 || !data.targetEdit.id)) {
                                        dispatch({
                                            mainTableData: data.mainTableData.filter((r: any) => r.key !== data.targetEdit.key),
                                            targetEdit: { ...row },
                                            isAddingRow: false,
                                        });
                                    } else {
                                        dispatch({ targetEdit: { ...row } });
                                    }
                                }
                            }}>
                            {isEditing ? ts("save") : ts("edit")}
                        </Button>
                        {!isEditing && (
                            <Button 
                                type="link" 
                                danger 
                                icon={<DeleteOutlined />}
                                onClick={() => handleDeleteRow(row)}>
                                {ts("delete")}
                            </Button>
                        )}
                    </Space>
                );
            },
        },
        {
            title: "",
            width: 48,
            align: "center" as const,
            render: (_value: any, row: any) => (
                <Tooltip title={ts("srs_doc.add_row") || "添加行"}>
                    <Button
                        type="link"
                        size="small"
                        icon={<PlusOutlined />}
                        disabled={!!data.targetEdit.key || !!data.targetEditOther.key || !editForm.getFieldValue("doc_id")}
                        onClick={() => handleAddRowBelow(row)}
                    />
                </Tooltip>
            ),
        },
    ];

    // 保存变更表格单行数据
    const handleSaveChangeRow = (tableId: string | number) => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        
        const table = data.changeTables.find((t: any) => t.id === tableId);
        if (!table || !table.type_code) {
            message.warning("表格数据异常");
            return;
        }
        
        const currentEdit = data.targetEditChange[tableId] || {};
        const code = (currentEdit.srs_code || "").trim();
        const module = (currentEdit.module || "").trim();
        const function_ = (currentEdit.function || "").trim();
        const subFunction = (currentEdit.sub_function || "").trim();
        
        // 验证至少有一个字段不为空
        if (!code && !module && !function_ && !subFunction) {
            message.warning("至少需要填写一个字段（需求编号、模块、功能、子功能）");
            return;
        }
        
        const saveData = {
            id: currentEdit.id || 0,
            doc_id: docId,
            code: code,
            module: module,
            function: function_,
            sub_function: subFunction,
            location: (currentEdit.location || "").trim(),
            type_code: table.type_code, // 使用表格的 type_code
            rcm_ids: Array.isArray(currentEdit.rcm_ids) ? currentEdit.rcm_ids : [],
        };

        // 根据是否有 id 判断是新增还是更新
        const isNew = !currentEdit.id || currentEdit.id === 0;
        dispatch({ updatingChange: { ...data.updatingChange, [tableId]: true } });
        const apiCall = isNew ? ApiSrsReq.add_srs_req(saveData) : ApiSrsReq.update_srs_req(saveData);

        apiCall.then((res: any) => {
            if (res.code === ApiSrsReq.C_OK) {
                message.success(res.msg || "保存成功");
                // 清空编辑状态
                const newTargetEditChange = { ...data.targetEditChange };
                delete newTargetEditChange[tableId];
                dispatch({ 
                    targetEditChange: newTargetEditChange,
                    updatingChange: { ...data.updatingChange, [tableId]: false }
                });
                // 重新加载数据
                handleDocIdChange(docId);
            } else {
                dispatch({ updatingChange: { ...data.updatingChange, [tableId]: false } });
                message.error(res.msg || "保存失败");
            }
        }).catch((error: any) => {
            console.error("保存失败:", error);
            dispatch({ updatingChange: { ...data.updatingChange, [tableId]: false } });
            message.error("保存失败");
        });
    };

    // 复制变更表格行到下一条并进入编辑状态
    const handleCopyChangeRow = (tableId: string | number, row: any) => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }

        const table = data.changeTables.find((t: any) => t.id === tableId);
        if (!table || !table.type_code) {
            message.warning("表格数据异常");
            return;
        }

        const currentEdit = data.targetEditChange[tableId];
        if (currentEdit && currentEdit.key) {
            message.warning("请先保存或取消当前正在编辑的行");
            return;
        }

        const copiedRow = {
            key: Date.now() + Math.random(),
            id: 0,
            doc_id: docId,
            srs_code: row.srs_code || "",
            module: row.module || "",
            function: row.function || "",
            sub_function: row.sub_function || "",
            location: row.location || "",
            type_code: table.type_code,
            rcm_codes: row.rcm_codes || [],
            rcm_ids: row.rcm_ids || [],
        };

        const tableData = table.data || [];
        const rowIndex = tableData.findIndex((r: any) => r.key === row.key);
        const newTableData = [...tableData];
        newTableData.splice(rowIndex >= 0 ? rowIndex + 1 : newTableData.length, 0, copiedRow);

        const newTables = data.changeTables.map((t: any) =>
            t.id === tableId ? { ...t, data: newTableData } : t
        );
        dispatch({
            changeTables: newTables,
            targetEditChange: { ...data.targetEditChange, [tableId]: { ...copiedRow } },
        });
    };

    // 在当前行下方插入空行并进入编辑状态（变更表格）
    const handleAddChangeRowBelow = (tableId: string | number, row: any) => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }

        const table = data.changeTables.find((t: any) => t.id === tableId);
        if (!table || !table.type_code) {
            message.warning("表格数据异常");
            return;
        }

        const currentEdit = data.targetEditChange[tableId];
        if (currentEdit && currentEdit.key) {
            message.warning("请先保存或取消当前正在编辑的行");
            return;
        }

        const newRow = {
            key: Date.now() + Math.random(),
            id: 0,
            doc_id: docId,
            srs_code: "",
            module: "",
            function: "",
            sub_function: "",
            location: "",
            type_code: table.type_code,
            rcm_codes: [],
            rcm_ids: [],
        };

        const tableData = table.data || [];
        const rowIndex = tableData.findIndex((r: any) => r.key === row.key);
        const newTableData = [...tableData];
        newTableData.splice(rowIndex >= 0 ? rowIndex + 1 : newTableData.length, 0, newRow);

        const newTables = data.changeTables.map((t: any) =>
            t.id === tableId ? { ...t, data: newTableData } : t
        );
        dispatch({
            changeTables: newTables,
            targetEditChange: { ...data.targetEditChange, [tableId]: { ...newRow } },
        });
    };

    // 删除变更表格单行数据
    const handleDeleteChangeRow = (tableId: string | number, row: any) => {
        // 如果是新增的行（没有 id），直接从前端删除
        if (!row.id || row.id === 0) {
            const newTables = data.changeTables.map((table: any) => {
                if (table.id === tableId) {
                    const newData = table.data.filter((item: any) => item.key !== row.key);
                    return { ...table, data: newData };
                }
                return table;
            });
            dispatch({ changeTables: newTables });
            // 如果正在编辑这一行，清空编辑状态
            const currentEdit = data.targetEditChange[tableId];
            if (currentEdit && currentEdit.key === row.key) {
                const newTargetEditChange = { ...data.targetEditChange };
                delete newTargetEditChange[tableId];
                dispatch({ targetEditChange: newTargetEditChange });
            }
            return;
        }

        // 如果有 id，调用删除接口
        ApiSrsReq.delete_srs_req({ id: row.id }).then((res: any) => {
            if (res.code === ApiSrsReq.C_OK) {
                message.success(res.msg || "删除成功");
                const docId = editForm.getFieldValue("doc_id");
                if (docId) {
                    handleDocIdChange(docId);
                }
            } else {
                message.error(res.msg || "删除失败");
            }
        }).catch((error: any) => {
            console.error("删除失败:", error);
            message.error("删除失败");
        });
    };

    // 构建变更表格列定义（需要传入tableId）
    const buildChangeColumns = (tableId: string | number) => {
        const currentEdit = data.targetEditChange[tableId] || {};
        const isEditing = (row: any) => currentEdit.key === row.key;
        
        return [
            {
                title: ts("srs_doc.srs_code") || "需求编号",
                dataIndex: "srs_code",
                render: (value: any, record: any) => {
                    if (!isEditing(record)) {
                        return value || "";
                    }
                    return (
                        <Input
                            value={currentEdit.srs_code || ""}
                            onChange={(e) => handleChangeTableCellChange(tableId, "srs_code", e.target.value)}
                            placeholder="请输入需求编号"
                            size="small"
                            style={{ width: "100%" }}
                        />
                    );
                },
            },
            {
                title: ts("srs_doc.module") || "模块",
                dataIndex: "module",
                render: (value: any, record: any) => {
                    if (!isEditing(record)) {
                        return value || "";
                    }
                    return (
                        <Input
                            value={currentEdit.module || ""}
                            onChange={(e) => handleChangeTableCellChange(tableId, "module", e.target.value)}
                            placeholder="请输入模块"
                            size="small"
                            style={{ width: "100%" }}
                        />
                    );
                },
            },
            {
                title: ts("srs_doc.function") || "功能",
                dataIndex: "function",
                render: (value: any, record: any) => {
                    if (!isEditing(record)) {
                        return value || "";
                    }
                    return (
                        <Input
                            value={currentEdit.function || ""}
                            onChange={(e) => handleChangeTableCellChange(tableId, "function", e.target.value)}
                            placeholder="请输入功能"
                            size="small"
                            style={{ width: "100%" }}
                        />
                    );
                },
            },
            {
                title: ts("srs_doc.sub_function") || "子功能",
                dataIndex: "sub_function",
                render: (value: any, record: any) => {
                    if (!isEditing(record)) {
                        return value || "";
                    }
                    return (
                        <Input
                            value={currentEdit.sub_function || ""}
                            onChange={(e) => handleChangeTableCellChange(tableId, "sub_function", e.target.value)}
                            placeholder="请输入子功能"
                            size="small"
                            style={{ width: "100%" }}
                        />
                    );
                },
            },
            {
                title: ts("action"),
                width: 180,
                render: (_value: any, row: any) => {
                    const editing = isEditing(row);
                    return (
                        <Space>
                            {!editing && (
                                <Button
                                    type="link"
                                    icon={<CopyOutlined />}
                                    onClick={() => handleCopyChangeRow(tableId, row)}>
                                    复制
                                </Button>
                            )}
                            {editing && (
                                <Button 
                                    type="link" 
                                    icon={<CloseOutlined />}
                                    onClick={() => {
                                        const currentEdit = data.targetEditChange[tableId] || {};
                                        const newTargetEditChange = { ...data.targetEditChange };
                                        delete newTargetEditChange[tableId];
                                        // 若是新增未保存的行，取消时从该表格数据中移除
                                        if (currentEdit.id === 0) {
                                            const newTables = data.changeTables.map((t: any) => {
                                                if (t.id === tableId) {
                                                    return { ...t, data: (t.data || []).filter((r: any) => r.key !== currentEdit.key) };
                                                }
                                                return t;
                                            });
                                            dispatch({ changeTables: newTables, targetEditChange: newTargetEditChange });
                                        } else {
                                            dispatch({ targetEditChange: newTargetEditChange });
                                        }
                                    }}>
                                    {ts("cancel")}
                                </Button>
                            )}
                            <Button
                                type="link"
                                icon={editing ? <CheckOutlined /> : <EditOutlined />}
                                loading={data.updatingChange[tableId] && editing}
                                onClick={() => {
                                    if (editing) {
                                        handleSaveChangeRow(tableId);
                                    } else {
                                        const currentEdit = data.targetEditChange[tableId] || {};
                                        if (currentEdit.key && (currentEdit.id === 0 || !currentEdit.id)) {
                                            const newTables = data.changeTables.map((t: any) => {
                                                if (t.id === tableId) {
                                                    return { ...t, data: (t.data || []).filter((r: any) => r.key !== currentEdit.key) };
                                                }
                                                return t;
                                            });
                                            dispatch({
                                                changeTables: newTables,
                                                targetEditChange: { ...data.targetEditChange, [tableId]: { ...row } },
                                            });
                                        } else {
                                            dispatch({
                                                targetEditChange: {
                                                    ...data.targetEditChange,
                                                    [tableId]: { ...row }
                                                }
                                            });
                                        }
                                    }
                                }}>
                                {editing ? ts("save") : ts("edit")}
                            </Button>
                            {!editing && (
                                <Button 
                                    type="link" 
                                    danger 
                                    icon={<DeleteOutlined />}
                                    onClick={() => handleDeleteChangeRow(tableId, row)}>
                                    {ts("delete")}
                                </Button>
                            )}
                        </Space>
                    );
                },
            },
            {
                title: "",
                width: 48,
                align: "center" as const,
                render: (_value: any, row: any) => (
                    <Tooltip title={ts("srs_doc.add_row") || "添加行"}>
                        <Button
                            type="link"
                            size="small"
                            icon={<PlusOutlined />}
                            disabled={!!(data.targetEditChange[tableId]?.key) || !editForm.getFieldValue("doc_id")}
                            onClick={() => handleAddChangeRowBelow(tableId, row)}
                        />
                    </Tooltip>
                ),
            },
        ];
    };

    // 添加主表格行
    const handleAddRow = () => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        
        if (data.targetEdit.key) {
            message.warning("请先保存或取消当前正在编辑的行");
            return;
        }
        
        if (data.targetEditOther.key) {
            message.warning("请先保存或取消其他需求列表中正在编辑的行");
            return;
        }
        
        const newRow = {
            key: Date.now() + Math.random(),
            id: 0, // 新增行 id 为 0
            doc_id: docId,
            srs_code: "",
            module: "",
            function: "",
            sub_function: "",
            location: "",
            type_code: "1", // SRS表固定为 1
            rcm_codes: [],
            rcm_ids: [],
        };
        dispatch({ 
            mainTableData: [...data.mainTableData, newRow], 
            isAddingRow: true,
            targetEdit: { ...newRow }
        });
    };

    // 添加变更表格
    const handleAddTable = () => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        
        const tableCount = data.changeTables.length;
        const typeName = `表格${tableCount + 1}`;
        
        // 调用添加接口
        ApiSrsType.add_srs_type({
            doc_id: docId,
            type_name: typeName,
        }).then((res: any) => {
            if (res.code === ApiSrsType.C_OK) {
                message.success(res.msg || "添加成功");
                // 重新加载数据以获取后端返回的 id
                handleDocIdChange(docId);
            } else {
                message.error(res.msg || "添加失败");
            }
        }).catch((error: any) => {
            console.error("添加变更表格失败:", error);
            message.error("添加失败");
        });
    };

    // 删除变更表格
    const handleDeleteTable = (tableId: string | number) => {
        // 如果是数字ID（后端数据）且不为0，调用删除接口
        const numId = typeof tableId === 'number' ? tableId : Number(tableId);
        if ((typeof tableId === 'number' || (typeof tableId === 'string' && !isNaN(numId))) && numId !== 0) {
            ApiSrsType.delete_srs_type({
                id: numId,
            }).then((res: any) => {
                if (res.code === ApiSrsType.C_OK) {
                    message.success(res.msg || "删除成功");
                    // 重新加载数据以确保数据同步
                    const docId = editForm.getFieldValue("doc_id");
                    if (docId) {
                        handleDocIdChange(docId);
                    }
                } else {
                    message.error(res.msg || "删除失败");
                }
            }).catch((error: any) => {
                console.error("删除变更表格失败:", error);
                message.error("删除失败");
            });
        } else {
            // 如果是临时ID（前端数据）或 id 为 0，直接删除
            const newTables = data.changeTables.filter((table: any) => table.id !== tableId);
            dispatch({ changeTables: newTables });
        }
    };

    // 添加变更表格行
    const handleAddChangeRow = (tableId: string | number) => {
        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        
        const table = data.changeTables.find((t: any) => t.id === tableId);
        if (!table || !table.type_code) {
            message.warning("表格数据异常");
            return;
        }
        
        // 检查是否已有正在编辑的行
        const currentEdit = data.targetEditChange[tableId];
        if (currentEdit && currentEdit.key) {
            message.warning("请先保存或取消当前正在编辑的行");
            return;
        }
        
        const newRow = {
            key: Date.now() + Math.random(),
            id: 0, // 新增行 id 为 0
            doc_id: docId,
            srs_code: "",
            module: "",
            function: "",
            sub_function: "",
            location: "",
            type_code: table.type_code,
            rcm_codes: [],
            rcm_ids: [],
        };
        
        const newTables = data.changeTables.map((t: any) => {
            if (t.id === tableId) {
                return { ...t, data: [...t.data, newRow] };
            }
            return t;
        });
        dispatch({ 
            changeTables: newTables,
            targetEditChange: { 
                ...data.targetEditChange, 
                [tableId]: { ...newRow } 
            } 
        });
    };

    // 开始编辑表格标题
    const handleStartEditTableTitle = (tableId: string | number) => {
        const table = data.changeTables.find((t: any) => t.id === tableId);
        if (table) {
            dispatch({ 
                editingTableId: tableId,
                editingTableTitle: table.title,
            });
        }
    };

    // 取消编辑表格标题
    const handleCancelEditTableTitle = () => {
        dispatch({ 
            editingTableId: null,
            editingTableTitle: "",
        });
    };

    // 更新编辑中的表格标题（仅更新本地状态）
    const handleEditTableTitleChange = (newTitle: string) => {
        dispatch({ editingTableTitle: newTitle });
    };

    // 保存变更表格标题（调用更新接口）
    const handleSaveTableTitle = () => {
        if (data.editingTableId === null) {
            return;
        }

        const docId = editForm.getFieldValue("doc_id");
        if (!docId) {
            message.warning("请先选择当前版本");
            return;
        }
        
        const table = data.changeTables.find((t: any) => t.id === data.editingTableId);
        if (!table) {
            return;
        }
        
        const newTitle = data.editingTableTitle.trim();
        if (!newTitle) {
            message.warning("表格标题不能为空");
            return;
        }
        
        // 如果是数字ID（后端数据）且不为0，调用更新接口
        const numId = typeof data.editingTableId === 'number' ? data.editingTableId : Number(data.editingTableId);
        if ((typeof data.editingTableId === 'number' || (typeof data.editingTableId === 'string' && !isNaN(numId))) && numId !== 0) {
            ApiSrsType.update_srs_type({
                id: numId,
                doc_id: docId,
                type_name: newTitle,
                type_code: table.type_code || "",
            }).then((res: any) => {
                if (res.code === ApiSrsType.C_OK) {
                    message.success(res.msg || "更新成功");
                    // 清空编辑状态
                    dispatch({ 
                        editingTableId: null,
                        editingTableTitle: "",
                    });
                    // 重新加载数据以获取后端返回的最新数据
                    handleDocIdChange(docId);
                } else {
                    message.error(res.msg || "更新失败");
                }
            }).catch((error: any) => {
                console.error("更新变更表格标题失败:", error);
                message.error("更新失败");
            });
        } else {
            // 如果是临时ID（前端数据）或 id 为 0，直接更新本地状态
            const newTables = data.changeTables.map((t: any) => {
                if (t.id === data.editingTableId) {
                    return { ...t, title: newTitle };
                }
                return t;
            });
            dispatch({ 
                changeTables: newTables,
                editingTableId: null,
                editingTableTitle: "",
            });
        }
    };


    return (
        <div className="page div-v srs-manage">
            {/* 搜索框 */}
            <div className="div-h searchbar list-searchbar-align">
                <Form 
                    form={editForm} 
                    className="expand"
                    onFinish={handleSearch}>
                    <Row gutter={10}>
                        <Col>
                            <Form.Item label={ts("srs_doc.select_product")} name="product_id">
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => {
                                        editForm.setFieldValue("product_id", value);
                                        handleProductChange(value);
                                    }}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Form.Item label={ts("srs_doc.current_version")} name="doc_id">
                                <Select
                                    placeholder={ts("srs_doc.please_select_current_version") || "请选择当前版本"}
                                    showSearch
                                    allowClear
                                    optionFilterProp="label"
                                    disabled={!editForm.getFieldValue("product_id")}
                                    options={data.srsDocs.map((item: any) => ({ 
                                        label: item.version || "", 
                                        value: item.id 
                                    }))}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                        {/* 与需求列表统一：右侧放新增变更表格按钮 */}
                        <Col flex="auto" style={{ textAlign: "right" }}>
                            <Button 
                                type="primary" 
                                icon={<PlusOutlined />}
                                onClick={handleAddTable}>
                                {ts("srs_doc.add_change_table") || "新增变更表格"}
                            </Button>
                        </Col>
                    </Row>
                </Form>
            </div>
            <div className="div-v detail-content">

                {/* 主表格 */}
<div className="doc-section srs-main-table-section">
<div className="doc-section-header">
    <div className="srs-table-title">
                            {ts("srs_doc.srs_table") || "SRS表"}
    </div>
                        <Space>
                            <Button 
                                type="primary" 
                                icon={<PlusOutlined />}
                                onClick={handleAddRow}
                                disabled={!!data.targetEdit.key || !!data.targetEditOther.key || !editForm.getFieldValue("doc_id")}>
                                {ts("srs_doc.add_row") || "添加行"}
                            </Button>
                        </Space>
</div>
<div>
                        <Table 
                            dataSource={data.mainTableData} 
                            columns={mainColumns}
                            rowKey="key"
                            bordered
                            pagination={false}
                            loading={data.loading}
                        />
</div>
</div>

                {/* 变更表格 - 支持多个表格，显示在其他需求列表上面 */}
                {data.changeTables.map((table: any) => {
                    const isEditing = data.editingTableId === table.id;
                    return (
                        <div key={table.id} className="doc-section">
                            <div className="doc-section-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {isEditing ? (
                                        <>
                                            <Input
                                                value={data.editingTableTitle}
                                                onChange={(e) => handleEditTableTitleChange(e.target.value)}
                                                onPressEnter={handleSaveTableTitle}
                                                placeholder="请输入表格标题"
                                                style={{ width: 200, fontWeight: 500 }}
                                                autoFocus
                                            />
                                            <Button 
                                                type="link" 
                                                size="small"
                                                icon={<CheckOutlined style={{ color: '#1890ff' }} />}
                                                onClick={handleSaveTableTitle}>
                                            </Button>
                                            <Button 
                                                type="link" 
                                                icon={<CloseOutlined style={{ color: '#999' }} />}
                                                onClick={handleCancelEditTableTitle}>
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <span style={{ fontWeight: 500, fontSize: 16 }}>
                                                {table.title || "未命名表格"}
                                            </span>
                                            <Button 
                                                type="link" 
                                                size="small"
                                                icon={<EditOutlined />}
                                                onClick={() => handleStartEditTableTitle(table.id)}>
                                            </Button>
                                        </>
                                    )}
                                </div>
                                <Space>
                                    <Button 
                                        type="primary" 
                                        icon={<PlusOutlined />}
                                        onClick={() => handleAddChangeRow(table.id)}
                                        disabled={isEditing || !!(data.targetEditChange[table.id]?.key)}>
                                        {ts("srs_doc.add_row") || "添加行"}
                                    </Button>
                                    <Button 
                                        type="primary" 
                                        icon={<DeleteOutlined />}
                                        onClick={() => handleDeleteTable(table.id)}
                                        disabled={isEditing}>
                                        {ts("srs_doc.delete_table") || "删除表格"}
                                    </Button>
                                </Space>
                            </div>
                            <div>
                                <Table 
                                    dataSource={table.data} 
                                    columns={buildChangeColumns(table.id)}
                                    rowKey="key"
                                    bordered
                                    pagination={false}
                                    loading={data.loading}
                                />
                            </div>
                        </div>
                    );
                })}

                {/* 其他需求列表 */}
                <div className="doc-section">
                    <div className="doc-section-header">
                        <div className="srs-table-title">
                            {ts("srs_doc.other_req_list") || "其他需求列表"}
                        </div>
                        <Space>
                            <Button 
                                type="primary" 
                                icon={<PlusOutlined />}
                                onClick={handleAddOtherRow}
                                disabled={!!data.targetEditOther.key || !!data.targetEdit.key || !editForm.getFieldValue("doc_id")}>
                                {ts("srs_doc.add_row") || "添加行"}
                            </Button>
                        </Space>
                    </div>
                    <div>
                        <Table 
                            dataSource={data.otherReqData} 
                            columns={otherColumns}
                            rowKey="key"
                            bordered
                            pagination={false}
                            loading={data.loading}
                        />
                    </div>
                </div>
</div>
</div>
    );
};
