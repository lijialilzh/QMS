import "./Products.less";
import { Form, Input, Button, Table, message, Row, Col, Modal, Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import * as Api from "@/api/ApiProduct";
import * as ApiProject from "@/api/ApiProject";

const pageSizeOptions = [10, 20, 50];

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
}

const doSearchProjects = (data: any, dispatch: any) => {
    if (data.projects.length === 0) {
        dispatch({ loadingProjects: true });
        ApiProject.list_project({ page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProject.C_OK) {
                dispatch({ loadingProjects: false, projects: res.data.rows || [] });
            } else {
                message.error(res.msg);
                dispatch({ loadingProjects: false });
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
            const fn_request = data.dlgType === DlgTypes.edit ? Api.update_product : Api.add_product;
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
            doSearchProjects(data, dispatch);
            if (data.dlgType === DlgTypes.edit) {
                dispatch({ loading: true });
                Api.get_product({ id: data.targetRow.id }).then((res: any) => {
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
                <Form form={editForm} className="expand">
                    <Form.Item hidden name="id">
                        <Input allowClear value={data.targetRow.id} />
                    </Form.Item>
                    <Row gutter={24}>
                        <Col span={12}>
                            <Form.Item
                                label={ts("product.name")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("product.name") }) }]}
                                name="name">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item
                                label={ts("product.project")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("product.project") }) }]}
                                name="project_id">
                                <Select
                                    allowClear
                                    options={data.projects.map((item: any) => ({
                                        label: item.country ? `${item.name}（${item.country}）` : item.name,
                                        value: item.id,
                                    }))}
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={12}>
                            <Form.Item
                                label={ts("product.category")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("product.category") }) }]}
                                name="category">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item label={ts("product.type_code")} name="type_code">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={12}>
                            <Form.Item
                                label={ts("product.full_version")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("product.full_version") }) }]}
                                name="full_version">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item
                                label={ts("product.release_version")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("product.release_version") }) }]}
                                name="release_version">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={12}>
                            <Form.Item
                                label={ts("product.udi")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("product.udi") }) }]}
                                name="udi">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item label="产品代码" name="product_code">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item
                                label={ts("product.scope")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("product.scope") }) }]}
                                name="scope">
                                <Input.TextArea allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item
                                label={ts("product.component")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("product.component") }) }]}
                                name="component">
                                <Input.TextArea allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("product.note")} name="note">
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
    const [queryForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        targetRow: {},
        loading: false,
        projects: [],
        selectedRowKeys: [],
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_product({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_product({ id: data.targetRow.id }).then((res: any) => {
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
                        const res: any = await Api.delete_product({ id });
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
            title: ts("product.name"),
            dataIndex: "name",
            width: 130,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.country"),
            dataIndex: "country",
            width: 65,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.category"),
            dataIndex: "category",
            width: 70,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.type_code"),
            dataIndex: "type_code",
            width: 95,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.full_version"),
            dataIndex: "full_version",
            width: 70,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.release_version"),
            dataIndex: "release_version",
            width: 60,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.udi"),
            dataIndex: "udi",
            width: 145,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: "产品代码",
            dataIndex: "product_code",
            width: 60,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.scope"),
            dataIndex: "scope",
            width: 145,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.component"),
            dataIndex: "component",
            width: 145,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.note"),
            dataIndex: "note",
            width: 90,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("create_time"),
            dataIndex: "create_time",
            width: 95,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("action"),
            width: 85,
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
        <div className="page div-v product">
            <div className="div-h searchbar">
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
                    <Button
                        type="primary"
                        loading={data.exporting}
                        onClick={() => {
                            dispatch({ exporting: true });
                            Api.export_products({ ...queryForm.getFieldsValue(), page_index: 0, page_size: 2000 }).then((res: any) => {
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
                tableLayout="fixed"
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
