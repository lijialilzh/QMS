import { Form, Input, Button, Table, message, Row, Col, Modal, Select, Space, Upload, Checkbox } from "antd";
import { SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useData } from "@/common";
import * as Api from "@/api/ApiHldDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    delete = "delete",
    add = "add",
    import = "import",
    copy = "copy",
}

const doSearchProducts = (data: any, dispatch: any) => {
    if (data.products.length === 0) {
        dispatch({ loadingProducts: true });
        ApiProduct.list_product({ page_size: 1000 }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loadingProducts: false, products: res.data.rows || [] });
            } else {
                message.error(res.msg);
                dispatch({ loadingProducts: false });
            }
        });
    }
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const [queryForm] = Form.useForm();
    const [addForm] = Form.useForm();
    const [importForm] = Form.useForm();
    const [data, dispatch] = useData({
        dlgType: null as string | null,
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        targetRow: {},
        loading: false,
        loadingProducts: false,
        products: [],
        versionOptions: [] as { value: string; label: string }[],
        importFiles: [],
        editingFileNoId: 0,
        editingFileNoValue: "",
        savingFileNoId: 0,
        exportingId: 0,
        copyProductId: undefined,
        adding: false,
    });

    const handleStartEditFileNo = (row: any) => {
        dispatch({ editingFileNoId: row.id, editingFileNoValue: row.file_no || "" });
    };

    const handleSaveFileNo = async (row: any) => {
        if (!data.editingFileNoId || data.editingFileNoId !== row.id) return;
        if (data.savingFileNoId === row.id) return;
        const nextFileNo = (data.editingFileNoValue || "").trim();
        const currentFileNo = (row.file_no || "").trim();
        if (nextFileNo === currentFileNo) {
            dispatch({ editingFileNoId: 0, editingFileNoValue: "", savingFileNoId: 0 });
            return;
        }
        dispatch({ savingFileNoId: row.id });
        try {
            const res: any = await Api.update_hld_doc_file_no({ id: row.id, file_no: nextFileNo });
            if (res.code === Api.C_OK) {
                const rows = (data.rows || []).map((item: any) => (item.id === row.id ? { ...item, file_no: nextFileNo } : item));
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

    const productId = Form.useWatch("product_id", queryForm);
    useEffect(() => {
        if (!productId) {
            queryForm.setFieldValue("version", undefined);
            dispatch({ versionOptions: [] });
            return;
        }
        Api.list_hld_doc({ product_id: productId, page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK && res.data?.rows?.length) {
                const versions = [...new Set((res.data.rows as any[]).map((r: any) => r.version).filter(Boolean))].sort();
                dispatch({ versionOptions: versions.map((v: string) => ({ value: v, label: v })) });
            } else {
                dispatch({ versionOptions: [] });
            }
        }).catch(() => dispatch({ versionOptions: [] }));
    }, [productId]);

    const doAdd = () => {
        addForm.validateFields().then((values) => {
            dispatch({ adding: true });
            Api.add_hld_doc({ ...values, version: String(values.version || "").trim() }).then((res: any) => {
                dispatch({ adding: false });
                if (res.code === Api.C_OK) {
                    message.success(ts("save_success"));
                    dispatch({ dlgType: null });
                    addForm.resetFields();
                    const newId = res.data?.id;
                    if (newId) {
                        navigate(`/hld_docs/edit/${newId}`);
                    } else {
                        doSearch(queryForm.getFieldsValue(), 1, data.pageSize);
                    }
                } else {
                    message.error(res.msg);
                }
            }).catch(() => {
                dispatch({ adding: false });
                message.error(ts("save_failed"));
            });
        });
    };

    const openAddModal = () => {
        addForm.resetFields();
        addForm.setFieldValue("version", "A0");
        doSearchProducts(data, dispatch);
        dispatch({ dlgType: DlgTypes.add });
    };

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_hld_doc({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, pageIndex, pageSize, total: res.data.total, rows: res.data.rows });
            } else {
                dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
                message.error(res.msg);
            }
        });
    };

    const doDelete = () => {
        dispatch({ loading: true });
        Api.delete_hld_doc({ id: data.targetRow.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, dlgType: null });
                message.success(res.msg);
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    };

    const doImportWord = () => {
        importForm.validateFields().then((values) => {
            const file = (data.importFiles || [])[0];
            if (!file) {
                message.warning(ts("select_file"));
                return;
            }
            dispatch({ loading: true });
            (async () => {
                if (values.clear_before_import) {
                    const listRes: any = await Api.list_hld_doc({ product_id: values.product_id, page_index: 0, page_size: 10000 });
                    if (listRes.code !== Api.C_OK) throw new Error(listRes.msg || "清空历史数据失败");
                    for (const row of listRes.data?.rows || []) {
                        const delRes: any = await Api.delete_hld_doc({ id: row.id });
                        if (delRes.code !== Api.C_OK) throw new Error(delRes.msg || `删除失败(id=${row.id})`);
                    }
                }
                const res: any = await Api.import_hld_doc_word({
                    product_id: values.product_id,
                    version: values.version,
                    change_log: values.change_log || "",
                    file,
                });
                dispatch({ loading: false });
                if (res.code === Api.C_OK) {
                    dispatch({ dlgType: null, importFiles: [] });
                    importForm.resetFields();
                    message.success(res.msg || "导入成功");
                    doSearch(queryForm.getFieldsValue(), 1, data.pageSize);
                } else {
                    Modal.error({ title: "导入失败", content: res.msg || "Word导入失败，请检查文档格式后重试。" });
                }
            })().catch((err: any) => {
                dispatch({ loading: false });
                Modal.error({ title: "导入失败", content: err?.message || "导入请求异常，请稍后重试。" });
            });
        });
    };

    const handleCopy = (row: any) => {
        doSearchProducts(data, dispatch);
        dispatch({ dlgType: DlgTypes.copy, targetRow: row, copyProductId: row.product_id });
    };

    const doCopy = () => {
        const row = data.targetRow || {};
        if (!row.id) return;
        dispatch({ loading: true });
        Api.duplicate_hld_doc({ id: row.id, product_id: data.copyProductId })
            .then((res: any) => {
                dispatch({ loading: false });
                if (res.code === Api.C_OK) {
                    dispatch({ dlgType: null });
                    message.success(ts("hld_doc.copy_success") || "复制成功");
                    doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
                } else {
                    message.error(res.msg || "复制失败");
                }
            })
            .catch(() => {
                dispatch({ loading: false });
                message.error("复制失败");
            });
    };

    const handleExport = async (row: any) => {
        if (data.exportingId === row.id) return;
        dispatch({ exportingId: row.id });
        try {
            const res: any = await Api.export_hld_doc({ id: row.id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_err) {
            message.error("导出失败");
        } finally {
            dispatch({ exportingId: 0 });
        }
    };

    const columns = [
        { title: ts("product.name"), dataIndex: "product_name" },
        { title: ts("product.version"), dataIndex: "product_version" },
        { title: ts("hld_doc.version"), dataIndex: "version" },
        {
            title: ts("hld_doc.file_no"),
            dataIndex: "file_no",
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
                            style={{ width: 220 }}
                        />
                    );
                }
                return (
                    <span style={{ cursor: "text", display: "inline-block", minWidth: 80 }} title="单击编辑文件编号" onClick={() => handleStartEditFileNo(row)}>
                        {value || "-"}
                    </span>
                );
            },
        },
        { title: ts("hld_doc.change_log"), dataIndex: "change_log" },
        { title: ts("create_time"), dataIndex: "create_time" },
        {
            title: ts("action"),
            render: (_value: any, row: any) => (
                <Space>
                    <Button type="link" size="small" onClick={() => navigate(`/hld_docs/view/${row.id}`)}>{ts("view")}</Button>
                    <Button type="link" size="small" onClick={() => navigate(`/hld_docs/edit/${row.id}`)}>{ts("edit")}</Button>
                    <Button type="link" size="small" onClick={() => handleCopy(row)}>{ts("hld_doc.copy")}</Button>
                    <Button type="link" size="small" loading={data.exportingId === row.id} onClick={() => handleExport(row)}>{ts("export")}</Button>
                    <Button type="link" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>{ts("delete")}</Button>
                </Space>
            ),
        },
    ];

    useEffect(() => {
        doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
        doSearchProducts(data, dispatch);
    }, []);

    return (
        <div className="page div-v">
            <div className="div-h searchbar list-searchbar-align">
                <Form form={queryForm} className="expand" onFinish={(values) => doSearch(values, 1, data.pageSize)}>
                    <Row gutter={20}>
                        <Col>
                            <Form.Item label={ts("srs_doc.select_product")} name="product_id">
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => queryForm.setFieldValue("product_id", value)}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Form.Item label={ts("hld_doc.doc_version")} name="version">
                                <Select placeholder={ts("hld_doc.please_select_doc_version")} allowClear options={data.versionOptions} />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
                <Space>
                    <Button type="primary" onClick={() => dispatch({ dlgType: DlgTypes.import })}>导入</Button>
                    <Button type="primary" onClick={openAddModal}>{ts("add")}</Button>
                </Space>
            </div>
            <Table
                className="expand"
                columns={columns}
                rowKey={(item: any) => item.id}
                dataSource={data.rows}
                loading={data.loading}
                pagination={{
                    total: data.total,
                    current: data.pageIndex,
                    showSizeChanger: true,
                    defaultPageSize: pageSizeOptions[0],
                    pageSizeOptions,
                    hideOnSinglePage: false,
                    onShowSizeChange: (page, pageSize) => dispatch({ pageIndex: page, pageSize }),
                    showTotal: (total: number) => sprintf(ts("total_items"), { total }),
                }}
                onChange={(pager) => doSearch(queryForm.getFieldsValue(), pager.current, pager.pageSize)}
            />
            <Modal
                width={620}
                centered
                title="新增软件概要设计"
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
                        label={ts("product.product")}
                        name="product_id"
                        rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                        <ProductVersionSelect
                            products={data.products}
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.full_version")}
                            onChange={(value) => addForm.setFieldValue("product_id", value)}
                        />
                    </Form.Item>
                    <Form.Item
                        label={ts("hld_doc.version")}
                        name="version"
                        rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("hld_doc.version") }) }]}>
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item label={ts("hld_doc.file_no")} name="file_no">
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item label={ts("hld_doc.change_log")} name="change_log">
                        <Input.TextArea rows={3} allowClear />
                    </Form.Item>
                </Form>
            </Modal>
            <Modal centered title={ts("action")} open={data.dlgType === DlgTypes.delete} maskClosable={false} confirmLoading={data.loading} onOk={doDelete} onCancel={() => dispatch({ dlgType: null })}>
                <div>{ts("confirm_delete")}</div>
            </Modal>
            <Modal
                centered
                width={680}
                title="导入Word概要设计"
                open={data.dlgType === DlgTypes.import}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doImportWord}
                onCancel={() => { dispatch({ dlgType: null, importFiles: [] }); importForm.resetFields(); }}>
                <Form form={importForm} layout="vertical">
                    <Form.Item label={ts("product.product")} name="product_id" rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                        <ProductVersionSelect
                            products={data.products}
                            allowClear
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.full_version")}
                            onChange={(value) => importForm.setFieldValue("product_id", value)}
                        />
                    </Form.Item>
                    <Form.Item label={ts("hld_doc.version")} name="version" rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("hld_doc.version") }) }]}>
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item label={ts("hld_doc.change_log")} name="change_log">
                        <Input.TextArea rows={3} allowClear />
                    </Form.Item>
                    <Form.Item name="clear_before_import" valuePropName="checked">
                        <Checkbox>导入前清空该产品历史概要设计</Checkbox>
                    </Form.Item>
                    <Form.Item label="Word文件" required>
                        <Upload
                            maxCount={1}
                            accept=".docx"
                            fileList={data.importFiles}
                            onRemove={() => dispatch({ importFiles: [] })}
                            beforeUpload={(file) => { dispatch({ importFiles: [file] }); return false; }}>
                            <Button icon={<UploadOutlined />}>{ts("select_file")}</Button>
                        </Upload>
                    </Form.Item>
                </Form>
            </Modal>
            <Modal
                centered
                width={520}
                title={ts("hld_doc.copy") || "复制"}
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
