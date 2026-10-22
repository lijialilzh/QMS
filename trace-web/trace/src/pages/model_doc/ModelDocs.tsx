import { Button, Col, Form, Input, Modal, Row, Select, Space, Table, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import { createDocBatchDelete, getDocTableRowSelection } from "../doc_shared/docBatchDelete";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiModelDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiAlgo from "@/api/ApiProdAlgoModule";
import * as ApiChapter from "@/api/ApiProdAlgoChapter";
import {
    isModelDocGroup, getModelDocNavTitle, isModelModuleType, modelModuleChapterId, modelModuleAddType,
} from "./ModelDocTypes";
import { sanitizeListQuery, isAllProductId } from "../doc_shared/sanitizeListQuery";
import "../risk_mgmt/RiskMgmtDocs.less";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    delete = "delete",
    copy = "copy",
}

const loadProducts = (data: any, dispatch: any) => {
    if (data.products.length > 0) return;
    ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
        if (res.code === Api.C_OK) {
            dispatch({ products: res.data.rows || [] });
        } else {
            message.error(res.msg);
        }
    });
};

const LEGACY_MODULE = "legacy";

/** 导航模块按产品分组，组内按 sort_order。 */
const namesByProduct = (rows: any[]): Record<string, string[]> => {
    const grouped: Record<string, any[]> = {};
    (rows || []).forEach((r) => {
        const id = String(r?.prod_id ?? "");
        if (!id) return;
        (grouped[id] = grouped[id] || []).push(r);
    });
    const out: Record<string, string[]> = {};
    Object.keys(grouped).forEach((id) => {
        out[id] = grouped[id]
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0))
            .map((r) => String(r.name || "").trim())
            .filter(Boolean);
    });
    return out;
};

/** 章节模块按产品分组，组内按 sort_order。 */
const chaptersOf = (rows: any[]): Record<string, { id: number; name: string }[]> => {
    const grouped: Record<string, any[]> = {};
    (rows || []).forEach((r) => {
        const id = String(r?.prod_id ?? "");
        if (!id || !String(r?.name || "").trim()) return;
        (grouped[id] = grouped[id] || []).push(r);
    });
    const out: Record<string, { id: number; name: string }[]> = {};
    Object.keys(grouped).forEach((id) => {
        out[id] = grouped[id]
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0))
            .map((r) => ({ id: r.id, name: String(r.name).trim() }));
    });
    return out;
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const { type } = useParams();
    const isGroup = isModelDocGroup(type);
    const navTitle = getModelDocNavTitle(type);
    const [queryForm] = Form.useForm();
    const [addForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        targetRow: {},
        products: [],
        modulesByProduct: {} as Record<string, string[]>,
        chaptersByProduct: {} as Record<string, { id: number; name: string }[]>,
        versionOptions: [] as { value: string; label: string }[],
        exportingId: 0,
        editingFileNoId: 0,
        editingFileNoValue: "",
        savingFileNoId: 0,
        copyProductId: undefined,
        adding: false,
    });

    const productId = Form.useWatch("product_id", queryForm);
    const moduleFilter = Form.useWatch("module", queryForm);
    const addProductId = Form.useWatch("product_id", addForm);
    const modulesByProduct = data.modulesByProduct || {};
    const chaptersByProduct = data.chaptersByProduct || {};
    const isNav = (pid: any, name: string) => (modulesByProduct[String(pid)] || []).includes(name);
    const chapterOf = (pid: any, docType: string) =>
        (chaptersByProduct[String(pid)] || []).find((c: any) => c.id === modelModuleChapterId(docType));
    const moduleLabel = (pid: any, docType: string) => {
        if (!isModelModuleType(docType)) return "未对应模块";
        const ch = chapterOf(pid, docType);
        if (!ch) return "已删除的模块";
        return isNav(pid, ch.name) ? ch.name : `${ch.name}（非导航）`;
    };
    /** 筛选：该产品全部章节模块（非导航的带标注）+ 未对应模块；新增：只列导航模块。 */
    const filterOptions = isAllProductId(productId) ? [] : [
        ...(chaptersByProduct[String(productId)] || []).map((c: any) => ({
            value: `m${c.id}`,
            label: isNav(productId, c.name) ? c.name : `${c.name}（非导航）`,
        })),
        { value: LEGACY_MODULE, label: "未对应模块" },
    ];
    const addOptions = isAllProductId(addProductId) ? [] : (chaptersByProduct[String(addProductId)] || [])
        .filter((c: any) => isNav(addProductId, c.name))
        .map((c: any) => ({ value: c.id, label: c.name }));
    useEffect(() => {
        if (!isGroup) {
            dispatch({ modulesByProduct: {}, chaptersByProduct: {} });
            return;
        }
        ApiAlgo.list_prod_algo_module({ page_index: 0, page_size: 10000 }).then((res: any) => {
            const rows = res && res.code === ApiAlgo.C_OK ? (res.data?.rows || []) : [];
            dispatch({ modulesByProduct: namesByProduct(rows) });
        }).catch(() => dispatch({ modulesByProduct: {} }));
        ApiChapter.list_prod_algo_chapter({ page_index: 0, page_size: 10000 }).then((res: any) => {
            const rows = res && res.code === ApiChapter.C_OK ? (res.data?.rows || []) : [];
            dispatch({ chaptersByProduct: chaptersOf(rows) });
        }).catch(() => dispatch({ chaptersByProduct: {} }));
    }, [type]);
    useEffect(() => {
        Api.list_model_doc({
            ...sanitizeListQuery({ product_id: productId }),
            ...(isGroup ? { doc_type_prefix: type } : { doc_type: type }),
            page_index: 0,
            page_size: 10000,
        }).then((res: any) => {
            if (res.code === Api.C_OK && res.data?.rows?.length) {
                const versions = [...new Set((res.data.rows as any[]).map((row: any) => row.version).filter(Boolean))].sort();
                dispatch({ versionOptions: versions.map((version: string) => ({ value: version, label: version })) });
            } else {
                dispatch({ versionOptions: [] });
            }
        }).catch(() => dispatch({ versionOptions: [] }));
    }, [productId, type]);

    const doSearch = (params: any = {}, pageIndex: any = data.pageIndex, pageSize: any = data.pageSize) => {
        dispatch({ loading: true });
        const moduleRaw = isGroup ? String(params.module ?? "") : "";
        const req: any = {
            ...sanitizeListQuery(params),
            page_index: pageIndex - 1,
            page_size: pageSize,
        };
        delete req.module;
        delete req.doc_type;
        delete req.doc_type_prefix;
        if (isGroup) {
            req.doc_type_prefix = type || "";
        } else {
            req.doc_type = type;
        }
        // 按模块筛选：同一模块的模板类型可能是 _01 或 _02，取整组后在本页过滤、分页。
        const keep = moduleRaw === LEGACY_MODULE
            ? (t: string) => !isModelModuleType(t)
            : /^m\d+$/.test(moduleRaw)
                ? (t: string) => modelModuleChapterId(t) === Number(moduleRaw.slice(1))
                : null;
        if (keep) {
            req.page_index = 0;
            req.page_size = 10000;
        }
        Api.list_model_doc(req).then((res: any) => {
            if (res.code === Api.C_OK) {
                if (keep) {
                    const all = (res.data.rows || []).filter((r: any) => keep(r.doc_type));
                    const rows = all.slice((pageIndex - 1) * pageSize, pageIndex * pageSize);
                    dispatch({ loading: false, total: all.length, rows, pageIndex, pageSize });
                    return;
                }
                dispatch({ loading: false, total: res.data.total, rows: res.data.rows || [], pageIndex, pageSize });
            } else {
                dispatch({ loading: false, rows: [], total: 0 });
                message.error(res.msg);
            }
        });
    };

    useEffect(() => {
        loadProducts(data, dispatch);
        queryForm.resetFields();
        dispatch({ versionOptions: [] });
    }, [type]);

    useEffect(() => {
        queryForm.setFieldValue("module", undefined);
        doSearch(queryForm.getFieldsValue(), 1, data.pageSize);
    }, [productId, type]);

    useEffect(() => {
        doSearch(queryForm.getFieldsValue(), 1, data.pageSize);
    }, [moduleFilter]);

    const doAdd = () => {
        addForm.validateFields().then((values) => {
            dispatch({ adding: true });
            let docType = type || "";
            if (isGroup) {
                docType = modelModuleAddType(type || "", Number(values.module));
            }
            const payload = { ...values, doc_type: docType };
            delete payload.module;
            Api.add_model_doc(payload).then((res: any) => {
                dispatch({ adding: false });
                if (res.code === Api.C_OK) {
                    message.success(ts("save_success"));
                    dispatch({ dlgType: null });
                    const newId = res.data?.id;
                    if (newId) {
                        navigate(`/model_docs/${res.data?.doc_type || docType}/edit/${newId}`);
                    } else {
                        doSearch(queryForm.getFieldsValue(), 1, data.pageSize);
                    }
                } else {
                    message.error(res.msg);
                }
            });
        });
    };

    const doDelete = () => {
        dispatch({ loading: true });
        Api.delete_model_doc({ id: data.targetRow.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success(ts("save_success"));
                dispatch({ dlgType: null, loading: false });
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    };

    const doBatchDelete = createDocBatchDelete({
        ts,
        dispatch,
        data,
        deleteFn: Api.delete_model_doc,
        cOk: Api.C_OK,
        onRefresh: () => doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize),
    });

    const doDuplicate = (row: any) => {
        loadProducts(data, dispatch);
        dispatch({ dlgType: DlgTypes.copy, targetRow: row, copyProductId: row.product_id });
    };

    const doCopy = () => {
        const row = data.targetRow || {};
        if (!row.id) return;
        dispatch({ loading: true });
        Api.duplicate_model_doc({ id: row.id, product_id: data.copyProductId }).then((res: any) => {
            dispatch({ loading: false });
            if (res.code === Api.C_OK) {
                dispatch({ dlgType: null });
                message.success("复制成功");
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                message.error(res.msg);
            }
        }).catch(() => {
            dispatch({ loading: false });
            message.error("复制失败");
        });
    };

    const doExport = async (row: any) => {
        if (data.exportingId === row.id) return;
        dispatch({ exportingId: row.id });
        try {
            const res: any = await Api.export_model_doc({ id: row.id });
            if (res.code !== Api.C_OK) {
                message.error(res.msg || "导出失败");
            }
        } catch (_err) {
            message.error("导出失败");
        } finally {
            dispatch({ exportingId: 0 });
        }
    };

    const handleStartEditFileNo = (row: any) => {
        dispatch({ editingFileNoId: row.id, editingFileNoValue: row.file_no || "" });
    };

    const handleSaveFileNo = async (row: any) => {
        if (!data.editingFileNoId || data.editingFileNoId !== row.id) return;
        if (data.savingFileNoId === row.id) return;
        const nextFileNo = String(data.editingFileNoValue || "").trim();
        const currentFileNo = String(row.file_no || "").trim();
        if (nextFileNo === currentFileNo) {
            dispatch({ editingFileNoId: 0, editingFileNoValue: "", savingFileNoId: 0 });
            return;
        }
        dispatch({ savingFileNoId: row.id });
        try {
            const res: any = await Api.update_model_doc({ id: row.id, file_no: nextFileNo });
            if (res.code === Api.C_OK) {
                const rows = (data.rows || []).map((item: any) => (
                    item.id === row.id ? { ...item, file_no: nextFileNo } : item
                ));
                dispatch({ rows, editingFileNoId: 0, editingFileNoValue: "", savingFileNoId: 0 });
                message.success("文件编号已保存");
            } else {
                dispatch({ savingFileNoId: 0 });
                message.error(res.msg || "保存失败");
            }
        } catch (_err) {
            dispatch({ savingFileNoId: 0 });
            message.error("保存失败");
        }
    };

    const columns: any[] = [
        { title: ts("product.name"), dataIndex: "product_name", width: "13%" },
        { title: ts("product.version"), dataIndex: "product_full_version", width: "9%" },
        ...(isGroup ? [{
            title: "算法模块",
            dataIndex: "doc_type",
            width: "12%",
            render: (value: string, row: any) => {
                const name = moduleLabel(row.product_id, value);
                return (
                    <span
                        title={name}
                        style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#1677ff" }}>
                        {name}
                    </span>
                );
            },
        }] : []),
        { title: "文档版本", dataIndex: "version", width: "9%" },
        {
            title: "文件编号",
            dataIndex: "file_no",
            width: "20%",
            render: (value: string, row: any) => {
                const isEditing = data.editingFileNoId === row.id;
                const isSaving = data.savingFileNoId === row.id;
                if (isEditing) {
                    return (
                        <Input
                            autoFocus
                            size="small"
                            value={data.editingFileNoValue}
                            disabled={isSaving}
                            onChange={(e) => dispatch({ editingFileNoValue: e.target.value })}
                            onBlur={() => handleSaveFileNo(row)}
                            onPressEnter={() => handleSaveFileNo(row)}
                            placeholder="请输入文件编号"
                        />
                    );
                }
                return (
                    <span
                        className="risk-doc-file-no-cell"
                        title={value ? `${value}（单击编辑）` : "单击编辑文件编号"}
                        onClick={() => handleStartEditFileNo(row)}>
                        {value || "-"}
                    </span>
                );
            },
        },
        { title: "变更说明", dataIndex: "change_log", width: "9%" },
        { title: ts("create_time"), dataIndex: "create_time", width: "11%" },
        {
            title: ts("action"),
            width: "18%",
            className: "risk-doc-action-col",
            render: (_: any, row: any) => (
                <Space size={4} className="risk-doc-action-space">
                    <Button type="link" size="small" onClick={() => navigate(`/model_docs/${row.doc_type}/view/${row.id}`)}>
                        {ts("view")}
                    </Button>
                    <Button type="link" size="small" onClick={() => navigate(`/model_docs/${row.doc_type}/edit/${row.id}`)}>
                        {ts("edit")}
                    </Button>
                    <Button type="link" size="small" onClick={() => doDuplicate(row)}>
                        复制
                    </Button>
                    <Button type="link" size="small" loading={data.exportingId === row.id} onClick={() => doExport(row)}>
                        导出
                    </Button>
                    <Button type="link" size="small" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
                        {ts("delete")}
                    </Button>
                </Space>
            ),
        },
    ].map((col: any) => ({
        ...col,
        onHeaderCell: () => ({ style: { whiteSpace: "nowrap" } }),
    }));

    return (
        <div className="div-v page">
            <div className="div-h searchbar list-searchbar-align">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={(values) => doSearch(values, 1, data.pageSize)}>
                    <Row gutter={20}>
                        <Col>
                            <Form.Item label={ts("srs_doc.select_product")} name="product_id">
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear includeAll
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => queryForm.setFieldValue("product_id", value)}
                                />
                            </Form.Item>
                        </Col>
                        {isGroup && (
                            <Col>
                                <Form.Item label="算法模块" name="module">
                                    <Select
                                        placeholder="全部模块"
                                        allowClear
                                        style={{ minWidth: 150 }}
                                        options={filterOptions}
                                    />
                                </Form.Item>
                            </Col>
                        )}
                        <Col>
                            <Form.Item label={ts("srs_doc.doc_version")} name="version">
                                <Select
                                    placeholder={ts("srs_doc.please_select_doc_version")}
                                    allowClear
                                    options={data.versionOptions}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
                <Space>
                    <Button type="primary" onClick={() => {
                        addForm.resetFields();
                        addForm.setFieldValue("version", "A0");
                        addForm.setFieldValue("module", undefined);
                        dispatch({ dlgType: DlgTypes.add });
                        loadProducts(data, dispatch);
                    }}>
                        {ts("add")}
                    </Button>
                    <Button disabled={!(data.selectedRowKeys || []).length} danger onClick={doBatchDelete}>
                        {ts("batch_delete")}
                    </Button>
                </Space>
            </div>
            <Table
                rowSelection={getDocTableRowSelection(data, dispatch)}
                className="expand risk-doc-table"
                rowKey="id"
                loading={data.loading}
                columns={columns}
                dataSource={data.rows}
                tableLayout="fixed"
                pagination={{
                    total: data.total,
                    current: data.pageIndex,
                    showSizeChanger: true,
                    defaultPageSize: pageSizeOptions[0],
                    pageSizeOptions,
                    hideOnSinglePage: false,
                    onShowSizeChange: (page, pageSize) => {
                        dispatch({ pageIndex: page, pageSize });
                    },
                    showTotal: (total: number) => sprintf(ts("total_items"), { total }),
                }}
                onChange={(pager) => {
                    doSearch(queryForm.getFieldsValue(), pager.current, pager.pageSize);
                }}
            />
            <Modal
                width={620}
                centered
                title={`新增${navTitle}`}
                open={data.dlgType === DlgTypes.add}
                confirmLoading={data.adding}
                onOk={doAdd}
                maskClosable={false}
                onCancel={() => {
                    dispatch({ dlgType: null });
                    addForm.resetFields();
                }}>
                <Form form={addForm} layout="vertical">
                    <Form.Item
                        label={ts("srs_doc.select_product")}
                        name="product_id"
                        rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                        <ProductVersionSelect
                            products={data.products}
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.full_version")}
                            onChange={(value) => addForm.setFieldValue("product_id", value)}
                        />
                    </Form.Item>
                    {isGroup && (
                        <Form.Item
                            label="算法模块"
                            name="module"
                            rules={[{ required: true, message: sprintf(ts("msg_select"), { label: "算法模块" }) }]}>
                            <Select
                                placeholder="请选择算法模块"
                                options={addOptions}
                            />
                        </Form.Item>
                    )}
                    <Form.Item
                        label="文档版本"
                        name="version"
                        rules={[{ required: true, message: sprintf(ts("msg_input"), { label: "文档版本" }) }]}>
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item label="文件编号" name="file_no">
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item label="变更说明" name="change_log">
                        <Input.TextArea rows={3} allowClear />
                    </Form.Item>
                </Form>
            </Modal>
            <Modal
                centered
                title={ts("action")}
                open={data.dlgType === DlgTypes.delete}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doDelete}
                onCancel={() => dispatch({ dlgType: null })}>
                {ts("confirm_delete")}
            </Modal>
            <Modal
                centered
                width={520}
                title="复制"
                open={data.dlgType === DlgTypes.copy}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doCopy}
                onCancel={() => dispatch({ dlgType: null })}>
                <div style={{ lineHeight: 1.8 }}>
                    <div style={{ marginBottom: 12 }}>复制到目标产品（默认当前产品，可选其它产品）：</div>
                    <ProductVersionSelect
                        products={data.products}
                        value={data.copyProductId}
                        namePlaceholder={ts("product.name")}
                        versionPlaceholder={ts("product.full_version")}
                        onChange={(value: any) => dispatch({ copyProductId: value })}
                    />
                    <div style={{ color: "#888", marginTop: 12 }}>
                        版本号自动生成：同产品在原版本号上递增；跨产品按目标产品现有最大版本递增。
                    </div>
                </div>
            </Modal>
        </div>
    );
};
