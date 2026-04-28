import { Form, Input, Button, Table, message, Row, Col, Modal, Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiSdsTrace";
import * as ApiDoc from "@/api/ApiSdsDoc";
import { doSearchProducts } from "../prod_risk/util";

const pageSizeOptions = [1000, 100, 500];

enum DlgTypes {
    edit = "edit",
    delete = "delete",
}

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const doEdit = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            Api.update_sds_trace(values).then((res: any) => {
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
        if (data.dlgType === DlgTypes.edit) {
            editForm.resetFields();
            dispatch({ files: [] });
            editForm.setFieldsValue(data.targetRow);
            // if (data.dlgType === DlgTypes.edit && data.targetRow.id) {
            //     dispatch({ loading: true });
            //     Api.get_sds_trace({ id: data.targetRow.id }).then((res: any) => {
            //         if (res.code === Api.C_OK) {
            //             const targetRow = res.data;
            //             editForm.setFieldsValue(targetRow);
            //             dispatch({ loading: false, targetRow });
            //         } else {
            //             message.error(res.msg);
            //             dispatch({ loading: false });
            //         }
            //     });
            // }
        }
    }, [data.dlgType, data.targetRow.id]);

    return (
        <Modal
            width={"50%"}
            centered
            title={ts("edit")}
            open={data.dlgType === DlgTypes.edit}
            maskClosable={false}
            confirmLoading={data.loading}
            onOk={doEdit}
            onCancel={() => dispatch({ dlgType: null })}>
            <div className="div-v">
                <Form form={editForm} className="expand" onFinish={(_values) => {}}>
                    <Form.Item hidden name="id">
                        <Input allowClear value={data.targetRow.id} />
                    </Form.Item>
                    <Form.Item hidden name="req_id">
                        <Input allowClear value={data.targetRow.req_id} />
                    </Form.Item>
                    <Form.Item hidden name="doc_id">
                        <Input allowClear value={data.targetRow.doc_id} />
                    </Form.Item>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_trace.srs_code")} name="srs_code">
                                <Input disabled allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item
                                label={ts("sds_trace.sds_code")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("sds_trace.sds_code") }) }]}
                                name="sds_code">
                                <Input.TextArea rows={3} allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_trace.chapter")} name="chapter">
                                <Input.TextArea allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_trace.location")} name="location">
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
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        targetRow: {},
        loading: false,
        products: [],
        docs: [],
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_sds_trace({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, pageIndex, pageSize, total: res.data.total, rows: res.data.rows });
            } else {
                dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
                message.error(res.msg);
            }
        });
    };

    const doSearchDocs = (params: any) => {
        dispatch({ loadingDocs: true });
        ApiDoc.list_sds_doc({ ...params }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loadingDocs: false, docs: res.data.rows });
            } else {
                dispatch({ loadingDocs: false, docs: [] });
                message.error(res.msg);
            }
        });
    };

    const columns = [
        {
            title: ts("sds_trace.srs_code"),
            dataIndex: "srs_code",
        },
        {
            title: ts("sds_trace.sds_code"),
            dataIndex: "sds_code",
        },
        {
            title: ts("sds_trace.type_name"),
            dataIndex: "type_name",
        },
        {
            title: ts("sds_trace.chapter"),
            dataIndex: "chapter",
        },
        {
            title: ts("sds_trace.location"),
            dataIndex: "location",
        },
        {
            title: ts("sds_doc.version"),
            dataIndex: "sdsdoc_version",
        },
        {
            title: ts("action"),
            render: (_value: any, row: any) => {
                return (
                    <div>
                        <Button type="link" onClick={() => dispatch({ dlgType: DlgTypes.edit, targetRow: row })}>
                            {ts("edit")}
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
            <div className="div-h searchbar list-searchbar-align">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={(values) => {
                        doSearch(values, 1, data.pageSize);
                    }}>
                    <Row gutter={10}>
                        <Col>
                            <Form.Item label={ts("srs_doc.select_product")} name="prod_id">
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => {
                                        queryForm.setFieldValue("prod_id", value);
                                        dispatch({ docs: [] });
                                        queryForm.setFieldsValue({ doc_id: null });
                                        doSearchDocs({ product_id: value });
                                    }}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Form.Item label={ts("sds_doc.version")} name="doc_id">
                                <Select allowClear options={data.docs.map((item: any) => ({ label: item.version, value: item.id }))} />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
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
            <DetailDlg
                data={data}
                dispatch={dispatch}
                onSaved={() => {
                    doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
                }}
            />
        </div>
    );
};
