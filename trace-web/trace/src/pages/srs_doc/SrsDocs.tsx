import { Form, Button, Select, Table, message, Modal, Row, Col, Space, Input, Upload } from "antd";
import { SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useData } from "@/common";
import * as Api from "@/api/ApiSrsDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    delete = "delete",
    import = "import",
}

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const [queryForm] = Form.useForm();
    const [importForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        targetRow: {},
        loading: false,
        products: [],
        versionOptions: [] as { value: string; label: string }[],
        importFiles: [],
        editingFileNoId: 0,
        editingFileNoValue: "",
        savingFileNoId: 0,
        exportingId: 0,
    });

    const handleStartEditFileNo = (row: any) => {
        dispatch({
            editingFileNoId: row.id,
            editingFileNoValue: row.file_no || "",
        });
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
            const res: any = await Api.update_srs_doc_file_no({ id: row.id, file_no: nextFileNo });
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

    useEffect(() => {
        ApiProduct.list_product({ page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) {
                dispatch({ products: res.data.rows || [] });
            }
        });
    }, []);

    const productId = Form.useWatch("product_id", queryForm);
    useEffect(() => {
        if (!productId) {
            queryForm.setFieldValue("version", undefined);
            dispatch({ versionOptions: [] });
            return;
        }
        Api.list_srs_doc({ product_id: productId, page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK && res.data?.rows?.length) {
                const versions = [...new Set((res.data.rows as any[]).map((r: any) => r.version).filter(Boolean))].sort();
                dispatch({ versionOptions: versions.map((v: string) => ({ value: v, label: v })) });
            } else {
                dispatch({ versionOptions: [] });
            }
        }).catch(() => dispatch({ versionOptions: [] }));
    }, [productId]);

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_srs_doc({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_srs_doc({ id: data.targetRow.id }).then((res: any) => {
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
            Api.import_srs_doc_word({
                product_id: values.product_id,
                version: values.version,
                change_log: values.change_log || "",
                file,
            }).then((res: any) => {
                dispatch({ loading: false });
                if (res.code === Api.C_OK) {
                    dispatch({ dlgType: null, importFiles: [] });
                    importForm.resetFields();
                    message.success(res.msg);
                    doSearch(queryForm.getFieldsValue(), 1, data.pageSize);
                } else {
                    Modal.error({
                        title: "导入失败",
                        content: res.msg || "Word导入校验未通过，请检查文档标题编号与内容格式。",
                    });
                }
            }).catch(() => {
                dispatch({ loading: false });
                Modal.error({
                    title: "导入失败",
                    content: "Word导入请求异常，请稍后重试。",
                });
            });
        });
    };

    const handleCopy = (row: any) => {
        const productName = row.product_name || "";
        const productVersion = row.product_version || "";
        const version = row.version || '';
        Modal.confirm({
            title: ts("srs_doc.copy_confirm_title") || "确认复制",
            content: sprintf(ts("sds_doc.copy_confirm_content"), productName, productVersion, version),
            okText: ts("confirm"),
            cancelText: ts("cancel"),
            onOk: () => {
                dispatch({ loading: true });
                Api.duplicate_srs_doc({ id: row.id })
                    .then((res: any) => {
                        dispatch({ loading: false });
                        if (res.code === Api.C_OK) {
                            message.success(ts("srs_doc.copy_success") || "复制成功");
                            doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
                        } else {
                            message.error(res.msg || "复制失败");
                        }
                    })
                    .catch(() => {
                        dispatch({ loading: false });
                        message.error("复制失败");
                    });
            },
        });
    };

    const handleExport = async (row: any) => {
        if (data.exportingId === row.id) return;
        dispatch({ exportingId: row.id });
        try {
            const res: any = await Api.export_srs_doc({ id: row.id });
            if (res.code !== Api.C_OK) {
                message.error(res.msg || "导出失败");
            }
        } catch (_err) {
            message.error("导出失败");
        } finally {
            dispatch({ exportingId: 0 });
        }
    };

    const columns = [
        {
            title: ts("product.name"),
            dataIndex: "product_name",
        },
        {
            title: ts("product.version"),
            dataIndex: "product_version",
        },
        {
            title: ts("srs_doc.version"),
            dataIndex: "version",
        },
        {
            title: ts("srs_doc.file_no"),
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
                    <span
                        style={{ cursor: "text", display: "inline-block", minWidth: 80 }}
                        title="单击编辑文件编号"
                        onClick={() => handleStartEditFileNo(row)}>
                        {value || "-"}
                    </span>
                );
            },
        },
        {
            title: "文件夹名称",
            dataIndex: "folder_name",
        },
        {
            title: ts("srs_doc.change_log"),
            dataIndex: "change_log",
        },
        {
            title: ts("create_time"),
            dataIndex: "create_time",
        },
        {
            title: ts("action"),
            render: (_value: any, row: any) => {
                return (
                    <Space>
                        <Button type="link" size="small" onClick={() => navigate(`/srs_docs/view/${row.id}`)}>
                            {ts("view")}
                        </Button>
                        <Button
                            type="link"
                            size="small"
                            loading={data.exportingId === row.id}
                            onClick={() => handleExport(row)}>
                            {ts("export")}
                        </Button>
                        <Button type="link" size="small" onClick={() => handleCopy(row)}>
                            {ts("srs_doc.copy")}
                        </Button>
                        <Button type="link" onClick={() => navigate(`/srs_docs/edit/${row.id}`)}>
                            {ts("edit")}
                        </Button>
                        <Button type="link" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
                            {ts("delete")}
                        </Button>
                    </Space>
                );
            },
        },
    ].map((col: any) => ({
        ...col,
        onHeaderCell: () => ({
            style: { whiteSpace: "nowrap" },
        }),
    }));

    useEffect(() => {
        const form = queryForm.getFieldsValue();
        doSearch(form, data.pageIndex, data.pageSize);
    }, []);

    return (
        <div className="page div-v">
            <div className="div-h searchbar list-searchbar-align">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={(values) => {
                        doSearch(values, 1, data.pageSize);
                    }}>
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
                    <Button type="primary" onClick={() => dispatch({ dlgType: DlgTypes.import })}>
                        导入
                    </Button>
                    <Button type="primary" onClick={() => navigate("/srs_docs/add")}>
                        {ts("add")}
                    </Button>
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
                    onShowSizeChange: (page, pageSize) => {
                        dispatch({ pageIndex: page, pageSize: pageSize });
                    },
                    showTotal: (total: number) => {
                        return sprintf(ts("total_items"), { total });
                    },
                }}
                onChange={(pager, _, _sorter: any) => {
                    const form = queryForm.getFieldsValue();
                    doSearch(form, pager.current, pager.pageSize);
                }}
            />
            <Modal
                centered
                title={ts("action")}
                open={data.dlgType === DlgTypes.delete}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doDelete}
                onCancel={() => dispatch({ dlgType: null })}>
                <div style={{ lineHeight: 1.8 }}>
                    <div style={{ marginBottom: 8 }}>确认要删除吗？</div>
                    <div style={{ color: "#d4380d" }}>
                        提醒：删除后对应SRS管理及需求列表一起清空，并且已绑定的详细设计文档解除绑定，
                        如需操作设计管理需重新上传或新增需求。
                    </div>
                </div>
            </Modal>
            <Modal
                centered
                width={680}
                title="导入Word需求"
                open={data.dlgType === DlgTypes.import}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doImportWord}
                onCancel={() => {
                    dispatch({ dlgType: null, importFiles: [] });
                    importForm.resetFields();
                }}>
                <Form form={importForm} layout="vertical">
                    <Form.Item
                        label={ts("product.product")}
                        name="product_id"
                        rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                        <ProductVersionSelect
                            products={data.products}
                            allowClear
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.full_version")}
                            onChange={(value) => importForm.setFieldValue("product_id", value)}
                        />
                    </Form.Item>
                    <Form.Item
                        label={ts("srs_doc.version")}
                        name="version"
                        rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("srs_doc.version") }) }]}>
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item label={ts("srs_doc.change_log")} name="change_log">
                        <Input.TextArea rows={3} allowClear />
                    </Form.Item>
                    <Form.Item label="Word文件" required>
                        <Upload
                            maxCount={1}
                            accept=".docx"
                            fileList={data.importFiles}
                            onRemove={() => dispatch({ importFiles: [] })}
                            beforeUpload={(file) => {
                                dispatch({ importFiles: [file] });
                                return false;
                            }}>
                            <Button icon={<UploadOutlined />}>{ts("select_file")}</Button>
                        </Upload>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};
