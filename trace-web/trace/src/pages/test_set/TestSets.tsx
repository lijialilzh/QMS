import { Form, Input, Button, Table, message, Row, Col, Modal, Select, Upload } from "antd";
import { SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiTestSet";
import * as ApiTestCase from "@/api/ApiTestCase";
import * as ApiProduct from "@/api/ApiProduct";
import TestCases from "./TestCases";
import ProductVersionSelect from "@/common/ProductVersionSelect";

const pageSizeOptions = [10, 20, 50];

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
    test_cases = "test_cases",
}

const STAGES = ["单元测试", "集成测试", "系统测试", "用户测试"];

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const doEdit = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            const fn_request = data.dlgType === DlgTypes.edit ? Api.update_test_set : Api.add_test_set;
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
            dispatch({ files: [] });
            if (data.dlgType === DlgTypes.edit) {
                dispatch({ loading: true });
                Api.get_test_set({ id: data.targetRow.id }).then((res: any) => {
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
                                name="product_id"
                                rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
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
                                label={ts("test_set.stage")}
                                name="stage"
                                rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("test_set.stage") }) }]}>
                                <Select allowClear options={STAGES.map((item: any) => ({ label: item, value: item }))} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("excel_file")} name="file">
                                <Upload
                                    maxCount={1}
                                    fileList={data.files}
                                    accept=".xlsx"
                                    onRemove={() => {
                                        dispatch({ files: [] });
                                    }}
                                    beforeUpload={(file) => {
                                        dispatch({ files: [file] });
                                        return true;
                                    }}>
                                    <Button icon={<UploadOutlined />}> {ts("select_file")}</Button>
                                </Upload>
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </div>
        </Modal>
    );
};

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
    const [queryForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        targetRow: {},
        loading: false,
        products: [],
        loadingProducts: false,
        files: [],
        exportingSet: new Set(),
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_test_set({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_test_set({ id: data.targetRow.id }).then((res: any) => {
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

    const columns = [
        {
            title: ts("product.name"),
            dataIndex: "product_name",
        },
        {
            title: ts("product.full_version"),
            dataIndex: "product_version",
        },
        {
            title: ts("test_set.stage"),
            dataIndex: "stage",
        },
        {
            title: ts("create_time"),
            dataIndex: "create_time",
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
                        <Button type="link" onClick={() => dispatch({ dlgType: DlgTypes.test_cases, targetRow: row })}>
                            {ts("test_set.view_test_cases")}
                        </Button>
                        <Button
                            loading={data.exportingSet.has(row.id)}
                            type="link"
                            onClick={() => {
                                dispatch({ exportingSet: new Set([...data.exportingSet, row.id]) });
                                ApiTestCase.export_test_cases({ set_id: row.id }).then((res: any) => {
                                    dispatch({ exportingSet: new Set([...data.exportingSet].filter((item: any) => item !== row.id)) });
                                    if (res.code !== Api.C_OK) {
                                        message.error(res.msg);
                                    }
                                });
                            }}>
                            {ts("test_set.export_test_cases")}
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
                            <Form.Item label={ts("test_set.stage")} name="stage">
                                <Select allowClear options={STAGES.map((item: any) => ({ label: item, value: item }))} />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
                <div className="div-h hspace">
                    <Button type="primary" onClick={() => dispatch({ dlgType: DlgTypes.add, targetRow: {} })}>
                        {ts("add")}
                    </Button>
                </div>
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
            <Modal
                width="95%"
                title={`${ts("test_set.test_cases")}: ${data.targetRow.product_name}-${data.targetRow.product_version}/${data.targetRow.stage}`}
                open={data.dlgType === DlgTypes.test_cases}
                maskClosable={false}
                footer={null}
                onCancel={() => dispatch({ dlgType: null })}>
                <TestCases set_id={data.targetRow.id} />
            </Modal>
        </div>
    );
};
