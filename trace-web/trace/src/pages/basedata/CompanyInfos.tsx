import { Form, Input, Button, Table, message, Row, Col, Modal, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import * as Api from "@/api/ApiCompanyInfo";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
}

const FIELDS: string[] = [
    "registrant",
    "address",
    "manufacturer",
    "production_address",
    "production_license_no",
    "contact_phone",
    "representative",
];

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const doEdit = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            const fn_request = data.dlgType === DlgTypes.edit ? Api.update_company_info : Api.add_company_info;
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
                Api.get_company_info({ id: data.targetRow.id }).then((res: any) => {
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
                <Form form={editForm} className="expand" labelCol={{ span: 6 }} onFinish={(_values) => {}}>
                    <Form.Item hidden name="id">
                        <Input allowClear value={data.targetRow.id} />
                    </Form.Item>
                    {FIELDS.map((field) => (
                        <Row gutter={24} key={field}>
                            <Col span={24}>
                                <Form.Item
                                    label={ts(`company_info.${field}`)}
                                    name={field}
                                    rules={field === "registrant" ? [{ required: true, message: sprintf(ts("msg_input"), { label: ts("company_info.registrant") }) }] : []}>
                                    <Input.TextArea allowClear autoSize={{ minRows: 1, maxRows: 4 }} />
                                </Form.Item>
                            </Col>
                        </Row>
                    ))}
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
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_company_info({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_company_info({ id: data.targetRow.id }).then((res: any) => {
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
        ...FIELDS.map((field) => ({
            title: ts(`company_info.${field}`),
            dataIndex: field,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value, { emptyText: "" }),
        })),
        {
            title: ts("create_time"),
            dataIndex: "create_time",
            width: 130,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value, { emptyText: "" }),
        },
        {
            title: ts("action"),
            width: 110,
            render: (_value: any, row: any) => {
                return (
                    <Space>
                        <Button type="link" onClick={() => dispatch({ dlgType: DlgTypes.edit, targetRow: row })}>
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
                            <Form.Item label={ts("fuzzy")} name="fuzzy">
                                <Input allowClear />
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
                tableLayout="fixed"
                sticky
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
                    showTotal: (total: number) => {
                        return sprintf(ts("total_items"), { total });
                    },
                }}
                onChange={(pager) => {
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
                    if (data.dlgType === DlgTypes.add) {
                        queryForm.resetFields();
                    }
                    doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
                }}
            />
        </div>
    );
};
