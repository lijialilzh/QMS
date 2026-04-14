import { Form, Input, Button, Table, message, Row, Col, Modal, Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiProject";

const pageSizeOptions = [10, 20, 50];

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
}

const COUNTRIES = ["FDA", "NMPA", "PMDA", "CE", "MDR"];

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const doEdit = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            const fn_request = data.dlgType === DlgTypes.edit ? Api.update_project : Api.add_project;
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
                Api.get_project({ id: data.targetRow.id }).then((res: any) => {
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
                    <Form.Item
                        label={ts("project.name")}
                        rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("project.name") }) }]}
                        name="name">
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item
                        label={ts("project.country")}
                        rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("project.country") }) }]}
                        name="country">
                        <Select allowClear options={COUNTRIES.map((item) => ({ label: item, value: item }))} />
                    </Form.Item>
                    <Form.Item label={ts("project.note")} name="note">
                        <Input allowClear />
                    </Form.Item>
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
        selectedRowKeys: [],
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_project({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_project({ id: data.targetRow.id }).then((res: any) => {
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
        const keys = data.selectedRowKeys || [];
        if (keys.length === 0) {
            message.warning(ts("please_select_items"));
            return;
        }
        Modal.confirm({
            title: ts("action"),
            content: sprintf(ts("batch_delete_confirm"), { count: keys.length }),
            onOk: async () => {
                dispatch({ loading: true });
                const idToRow = Object.fromEntries((data.rows || []).map((r: any) => [r.id, r]));
                let successCount = 0;
                const failedIds: any[] = [];
                for (const id of keys) {
                    try {
                        const res: any = await Api.delete_project({ id });
                        if (res.code === Api.C_OK) successCount++;
                        else failedIds.push(id);
                    } catch {
                        failedIds.push(id);
                    }
                }
                const failedItems = failedIds.map((id) => idToRow[id]?.name ?? id).join("、");
                dispatch({ loading: false, selectedRowKeys: [] });
                if (failedIds.length === 0) message.success(ts("batch_delete_success"));
                else if (successCount > 0) message.warning(sprintf(ts("batch_delete_partial"), { success: successCount, items: failedItems }));
                else message.error(sprintf(ts("batch_delete_all_failed"), { items: failedItems }));
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            },
        });
    };

    const columns = [
        {
            title: ts("project.name"),
            dataIndex: "name",
        },
        {
            title: ts("project.country"),
            dataIndex: "country",
        },
        {
            title: ts("project.note"),
            dataIndex: "note",
        },
        {
            title: "关联产品数",
            dataIndex: "product_count",
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
                    </div>
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
            <div className="div-h searchbar">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={(values) => {
                        doSearch(values, 1, data.pageSize);
                    }}>
                    <Row gutter={10}>
                        <Col>
                            <Form.Item label={ts("project.name")} name="name">
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
