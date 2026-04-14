import { Form, Input, Button, Table, message, Row, Col, Modal, Upload } from "antd";
import { SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdDhf";
import { doSearchProducts } from "./util";

const pageSizeOptions = [10, 20, 50];

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
    import = "import",
}

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const doEdit = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            const fn_request = data.dlgType === DlgTypes.edit ? Api.update_prod_dhf : Api.add_prod_dhf;
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
            if (data.dlgType === DlgTypes.edit) {
                dispatch({ loading: true });
                Api.get_prod_dhf({ id: data.targetRow.id }).then((res: any) => {
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
                        <Col span={24}>
                            <Form.Item
                                label={ts("product.product")}
                                rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}
                                name="prod_id">
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.version")}
                                    onChange={(value) => editForm.setFieldValue("prod_id", value)}
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item
                                label={ts("prod_dhf.code")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("prod_dhf.code") }) }]}
                                name="code">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item
                                label={ts("prod_dhf.name")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("prod_dhf.name") }) }]}
                                name="name">
                                <Input allowClear />
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
        selectedRowKeys: [],
        importFiles: [],
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_prod_dhf({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_prod_dhf({ id: data.targetRow.id }).then((res: any) => {
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

    const doBatchDelete = () => {
        const ids = data.selectedRowKeys || [];
        if (ids.length === 0) {
            message.warning(ts("please_select_items"));
            return;
        }
        dispatch({ loading: true });
        Api.delete_prod_dhfs({ ids }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, selectedRowKeys: [] });
                message.success(res.msg);
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    };

    const doImport = () => {
        importForm.validateFields().then((values) => {
            const file = (data.importFiles || [])[0];
            if (!file) {
                message.warning(ts("select_file"));
                return;
            }
            dispatch({ loading: true });
            Api.import_prod_dhfs({ prod_id: values.prod_id, file }).then((res: any) => {
                dispatch({ loading: false });
                if (res.code === Api.C_OK) {
                    message.success(res.msg);
                    dispatch({ dlgType: null, importFiles: [] });
                    importForm.resetFields();
                    doSearch(queryForm.getFieldsValue(), 1, data.pageSize);
                } else {
                    message.error(res.msg);
                }
            });
        });
    };

    const columns = [
        {
            title: ts("prod_dhf.code"),
            dataIndex: "code",
        },
        {
            title: ts("prod_dhf.name"),
            dataIndex: "name",
        },
        {
            title: ts("product.name"),
            dataIndex: "product_name",
        },
        {
            title: ts("product.version"),
            dataIndex: "product_version",
        },
        {
            title: ts("action"),
            render: (_value: any, row: any) => {
                return (
                    <div>
                        <Button type="link" onClick={() => dispatch({ dlgType: DlgTypes.edit, targetRow: row })}>
                            {ts("edit")}
                        </Button>
                        <Button type="link" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
                            {ts("delete")}
                        </Button>
                    </div>
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
                    <Row gutter={10}>
                        <Col>
                            <Form.Item label={ts("product.product")} name="prod_id">
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.version")}
                                    onChange={(value) => {
                                        queryForm.setFieldValue("prod_id", value);
                                        const form = { ...queryForm.getFieldsValue(), prod_id: value };
                                        doSearch(form, 1, data.pageSize);
                                    }}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
                <div className="div-h hspace">
                    <Button type="primary" icon={<UploadOutlined />} onClick={() => dispatch({ dlgType: DlgTypes.import, importFiles: [] })}>
                        导入
                    </Button>
                    <Button
                        type="primary"
                        loading={data.exporting}
                        onClick={() => {
                            dispatch({ exporting: true });
                            Api.export_prod_dhfs({ ...queryForm.getFieldsValue(), page_index: 0, page_size: 2000 }).then((res: any) => {
                                dispatch({ exporting: false });
                                if (res.code !== Api.C_OK) {
                                    message.error(res.msg);
                                }
                            });
                        }}>
                        {ts("export")}
                    </Button>
                    <Button type="primary" onClick={() => dispatch({ dlgType: DlgTypes.add, targetRow: {} })}>
                        {ts("add")}
                    </Button>
                    <Button disabled={!(data.selectedRowKeys || []).length} danger onClick={doBatchDelete}>
                        {ts("batch_delete")}
                    </Button>
                </div>
            </div>
            <Table
                className="expand"
                rowSelection={{
                    selectedRowKeys: data.selectedRowKeys || [],
                    onChange: (keys: any) => dispatch({ selectedRowKeys: keys }),
                }}
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
                width={640}
                title="导入DHF"
                open={data.dlgType === DlgTypes.import}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doImport}
                onCancel={() => {
                    dispatch({ dlgType: null, importFiles: [] });
                    importForm.resetFields();
                }}>
                <Form form={importForm} layout="vertical">
                    <Form.Item
                        label={ts("product.product")}
                        name="prod_id"
                        rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                        <ProductVersionSelect
                            products={data.products}
                            allowClear
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.version")}
                            onChange={(value) => importForm.setFieldValue("prod_id", value)}
                        />
                    </Form.Item>
                    <Form.Item label="Excel文件" required>
                        <Upload
                            maxCount={1}
                            accept=".xlsx"
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
                    if(data.dlgType === DlgTypes.add){
                        queryForm.resetFields();
                    }
                    doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
                }}
            />
        </div>
    );
};
