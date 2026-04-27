import { Form, Input, Button, Table, message, Row, Col, Modal, Select, Space, Upload } from "antd";
import { SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useData } from "@/common";
import * as Api from "@/api/ApiSdsDoc";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiSrsDoc from "@/api/ApiSrsDoc";
import ProductVersionSelect from "@/common/ProductVersionSelect";

const pageSizeOptions = [10, 20, 50];

enum DlgTypes {
    delete = "delete",
    add = "add",
    edit = "edit",
    import = "import",
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

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const doEdit = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            const fn_request = data.dlgType === DlgTypes.edit ? Api.update_sds_doc : Api.add_sds_doc;
            fn_request(values).then((res: any) => {
                if (res.code === Api.C_OK) {
                    onSaved();
                    dispatch({ loading: false, dlgType: null });
                    message.success(res.msg);
                } else {
                    dispatch({ loading: false });
                    message.error(res.msg);
                }
            });
        });
    };

    useEffect(() => {
        if (data.dlgType === DlgTypes.add || data.dlgType === DlgTypes.edit) {
            editForm.resetFields();
            doSearchProducts(data, dispatch);
            if (data.dlgType === DlgTypes.edit) {
                dispatch({ loading: true });
                Api.get_sds_doc({ id: data.targetRow.id }).then((res: any) => {
                    if (res.code === Api.C_OK) {
                        const targetRow = res.data;
                        editForm.setFieldsValue(targetRow);
                        dispatch({ loading: false, targetRow });
                    } else {
                        message.error(res.msg);
                        dispatch({ loading: false });
                    }
                });
            }
        }
    }, [data.dlgType, data.targetRow.id]);

    return (
        <Modal
            width={"50%"}
            centered
            title={data.dlgType === DlgTypes.add ? ts("add") : ts("edit")}
            open={data.dlgType === DlgTypes.add || data.dlgType === DlgTypes.edit}
            maskClosable={false}
            confirmLoading={data.loading}
            onOk={doEdit}
            onCancel={() => dispatch({ dlgType: null })}>
            <div className="div-v">
                <Form form={editForm} className="expand" onFinish={(_values) => {}}>
                    <Form.Item hidden name="id">
                        <Input allowClear value={data.targetRow.id} />
                    </Form.Item>
                    <Row gutter={24}>
                        <Col span={12}>
                            <Form.Item
                                label={ts("product.product")}
                                rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}
                                name="product_id">
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => editForm.setFieldValue("product_id", value)}
                                />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item
                                label={ts("sds_doc.version")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("sds_doc.version") }) }]}
                                name="version">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_doc.change_log")} name="change_log">
                                <Input.TextArea allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </div>
        </Modal>
    );
};
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
        loadingProducts: false,
        products: [],
        versionOptions: [] as { value: string; label: string }[],
        importSrsDocList: [] as any[],
        importFiles: [],
    });

    const productId = Form.useWatch("product_id", queryForm);
    useEffect(() => {
        if (!productId) {
            queryForm.setFieldValue("version", undefined);
            dispatch({ versionOptions: [] });
            return;
        }
        Api.list_sds_doc({ product_id: productId, page_index: 0, page_size: 10000 }).then((res: any) => {
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
        Api.list_sds_doc({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_sds_doc({ id: data.targetRow.id }).then((res: any) => {
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
            Api.import_sds_doc_word({
                product_id: values.product_id,
                srsdoc_id: values.srsdoc_id,
                version: values.version,
                change_log: values.change_log || "",
                file,
            }).then((res: any) => {
                dispatch({ loading: false });
                if (res.code === Api.C_OK) {
                    dispatch({ dlgType: null, importFiles: [], importSrsDocList: [] });
                    importForm.resetFields();
                    message.success(res.msg || "导入成功");
                    doSearch(queryForm.getFieldsValue(), 1, data.pageSize);
                } else {
                    Modal.error({
                        title: "导入失败",
                        content: res.msg || "Word导入失败，请检查文档格式后重试。",
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

    const loadImportSrsDocList = (productId: number) => {
        ApiSrsDoc.list_srs_doc({ product_id: productId, page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ importSrsDocList: res.data?.rows || [] });
            } else {
                dispatch({ importSrsDocList: [] });
                message.error(res.msg || "加载需求文档列表失败");
            }
        }).catch(() => {
            dispatch({ importSrsDocList: [] });
            message.error("加载需求文档列表失败");
        });
    };

    const handleCopy = (row: any) => {
        const productName = row.product_name || "";
        const productVersion = row.product_version || "";
        const version = row.version || "";
        Modal.confirm({
            title: ts("sds_doc.copy_confirm_title") || "确认复制",
            content: sprintf(ts("sds_doc.copy_confirm_content"), productName, productVersion, version),
            okText: ts("confirm"),
            cancelText: ts("cancel"),
            onOk: () => {
                dispatch({ loading: true });
                Api.duplicate_sds_doc({ id: row.id })
                    .then((res: any) => {
                        dispatch({ loading: false });
                        if (res.code === Api.C_OK) {
                            message.success(ts("sds_doc.copy_success") || "复制成功");
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
            dataIndex: "srs_version",
        },
        {
            title: ts("sds_doc.version"),
            dataIndex: "version",
        },
        {
            title: ts("sds_doc.file_no"),
            dataIndex: "file_no",
        },
        {
            title: ts("sds_doc.change_log"),
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
                        <Button type="link" size="small" onClick={() => navigate(`/sds_docs/view/${row.id}`)}>
                            {ts("view")}
                        </Button>
                        <Button type="link" size="small" onClick={() => handleCopy(row)}>
                            {ts("sds_doc.copy")}
                        </Button>
                        <Button type="link" onClick={() => navigate(`/sds_docs/edit/${row.id}`)}>
                            {ts("edit")}
                        </Button>
                        <Button type="link" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
                            {ts("delete")}
                        </Button>
                    </Space>
                );
            },
        },
    ];

    useEffect(() => {
        const form = queryForm.getFieldsValue();
        doSearch(form, data.pageIndex, data.pageSize);
        doSearchProducts(data, dispatch);
    }, []);

    return (
        <div className="page div-v">
            <div className="div-h searchbar">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={(values) => {
                        doSearch(values, 1, data.pageSize);
                    }}>
                    <Row gutter={20}>
                        <Col>
                            <Form.Item label={ts("product.product")} name="product_id">
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
                            <Form.Item label={ts("sds_doc.doc_version")} name="version">
                                <Select
                                    placeholder={ts("sds_doc.please_select_doc_version")}
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
                    <Button type="primary" onClick={() => navigate("/sds_docs/add")}>
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
                <div>{ts("confirm_delete")}</div>
            </Modal>
            <Modal
                centered
                width={680}
                title="导入Word详细设计"
                open={data.dlgType === DlgTypes.import}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doImportWord}
                onCancel={() => {
                    dispatch({ dlgType: null, importFiles: [], importSrsDocList: [] });
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
                            onChange={(value) => {
                                importForm.setFieldValue("product_id", value);
                                importForm.setFieldValue("srsdoc_id", undefined);
                                if (value) {
                                    loadImportSrsDocList(value);
                                } else {
                                    dispatch({ importSrsDocList: [] });
                                }
                            }}
                        />
                    </Form.Item>
                    <Form.Item
                        label={ts("sds_doc.req_doc")}
                        name="srsdoc_id"
                        rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("sds_doc.req_doc") }) }]}>
                        <Select
                            placeholder={ts("sds_doc.please_select_req_doc")}
                            showSearch
                            allowClear
                            optionFilterProp="label"
                            disabled={!data.importSrsDocList.length}
                            options={data.importSrsDocList.map((item: any) => ({
                                label: `${item.version || item.full_version || ""}`,
                                value: item.id,
                            }))}
                        />
                    </Form.Item>
                    <Form.Item
                        label={ts("sds_doc.version")}
                        name="version"
                        rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("sds_doc.version") }) }]}>
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item label={ts("sds_doc.change_log")} name="change_log">
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
            <DetailDlg
                data={data}
                dispatch={dispatch}
                onSaved={() => {
                    if (data.dlgType === DlgTypes.add) {
                        queryForm.resetFields();
                    }
                    doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
                }}
            />
        </div>
    );
};
