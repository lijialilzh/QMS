import { Form, Input, Button, Table, message, Row, Col, Modal, Select, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiUser";
import * as ApiRole from "@/api/ApiRole";

const MASTER = "master";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
    resetPwd = "resetPwd",
}

const doSearchRoles = (data: any, dispatch: any) => {
    if (data.roles.length === 0) {
        dispatch({ loadingRoles: true });
        ApiRole.list_role({ page_size: 1000 }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loadingRoles: false, roles: res.data.rows || [] });
            } else {
                message.error(res.msg);
                dispatch({ loadingRoles: false });
            }
        });
    }
};

const collectPermLabels = (nodes: any[] = [], dict: any = {}) => {
    for (const node of nodes || []) {
        if (node?.key) {
            dict[node.key] = node.title || node.key;
        }
        if (node?.children?.length) {
            collectPermLabels(node.children, dict);
        }
    }
    return dict;
};

const PREVIEW_MODULES = [
    { name: "仪表盘", match: (code: string) => code === "dashboard" || code.startsWith("dashboard_") },
    { name: "系统配置", match: (code: string) => ["role", "user", "project"].some((k) => code === k || code.startsWith(`${k}_`)) },
    { name: "基础数据", match: (code: string) => ["haz", "rcm", "cst"].some((k) => code === k || code.startsWith(`${k}_`)) },
    { name: "产品版本管理", match: (code: string) => code === "product" || code.startsWith("product_") },
    { name: "产品文件管理", match: (code: string) => code === "prod_dhf" || code.startsWith("prod_dhf_") },
    { name: "需求管理", match: (code: string) => code === "srs_doc" || code.startsWith("srs_doc_") },
    { name: "设计管理", match: (code: string) => code === "sds_doc" || code.startsWith("sds_doc_") },
    { name: "图表文件管理", match: (code: string) => code.startsWith("doc_file_") },
    { name: "风险追溯管理", match: (code: string) => ["prod_haz", "prod_rcm", "prod_cst", "test_set", "test_case"].some((k) => code === k || code.startsWith(`${k}_`)) },
    { name: "全局视图", match: (code: string) => code === "overview" || code.startsWith("overview_") },
];

const buildPermPreview = (codes: string[] = []) => {
    if (!codes.length) return "-";
    const picked = PREVIEW_MODULES.filter((item) => codes.some((code) => item.match(code))).map((item) => item.name);
    return picked.length > 0 ? picked.join("、") : "-";
};

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const doEdit = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            const fn_request = data.dlgType === DlgTypes.edit ? Api.update_user : Api.add_user;
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
            dispatch({ selectedRolePerms: [], rolePermNameDict: {} });
            doSearchRoles(data, dispatch);
            if (data.dlgType === DlgTypes.edit) {
                dispatch({ loading: true });
                Api.get_user({ id: data.targetRow.id }).then((res: any) => {
                    if (res.code === Api.C_OK) {
                        const targetRow = res.data;
                        editForm.setFieldsValue(targetRow);
                        dispatch({ loading: false, targetRow });
                        if (targetRow.role_code) {
                            ApiRole.get_role({ code: targetRow.role_code }).then((roleRes: any) => {
                                if (roleRes.code === ApiRole.C_OK) {
                                    dispatch({
                                        selectedRolePerms: roleRes.data.role_perms || [],
                                        rolePermNameDict: collectPermLabels(roleRes.data.perm_tree || []),
                                    });
                                }
                            });
                        }
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
                        label={ts("account")}
                        name="name"
                        rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("account") }) }]}>
                        <Input allowClear disabled={data.dlgType === DlgTypes.edit} />
                    </Form.Item>
                    <Form.Item
                        label={ts("nick_name")}
                        name="nick_name"
                        rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("nick_name") }) }]}>
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item
                        label={ts("role")}
                        name="role_code"
                        rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("role") }) }]}>
                        <Select
                            disabled={data.targetRow.name === MASTER}
                            allowClear
                            onChange={(value) => {
                                if (!value) {
                                    dispatch({ selectedRolePerms: [], rolePermNameDict: {} });
                                    return;
                                }
                                ApiRole.get_role({ code: value }).then((res: any) => {
                                    if (res.code === ApiRole.C_OK) {
                                        dispatch({
                                            selectedRolePerms: res.data.role_perms || [],
                                            rolePermNameDict: collectPermLabels(res.data.perm_tree || []),
                                        });
                                    }
                                });
                            }}
                            options={data.roles.map((item: any) => ({ label: item.name, value: item.code }))}
                        />
                    </Form.Item>
                    <Form.Item label="权限预览">
                        <div>
                            {buildPermPreview(data.selectedRolePerms || [])}
                        </div>
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
        loadingRoles: false,
        roles: [],
        selectedRolePerms: [],
        rolePermNameDict: {},
        selectedRowKeys: [],
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_user({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_user({ id: data.targetRow.id }).then((res: any) => {
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
                        const res: any = await Api.delete_user({ id });
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

    const doResetPwd = () => {
        dispatch({ loading: true });
        Api.reset_pwd({ id: data.targetRow.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, dlgType: null });
                message.success(res.msg);
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    };

    const columns = [
        {
            title: ts("account"),
            dataIndex: "name",
        },
        {
            title: ts("nick_name"),
            dataIndex: "nick_name",
        },
        {
            title: ts("role_name"),
            dataIndex: "role_name",
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
                        <Button type="link" onClick={() => dispatch({ dlgType: DlgTypes.edit, targetRow: row })}>
                            {ts("edit")}
                        </Button>
                        <Button type="link" disabled={row.name === MASTER} 
                            onClick={() => dispatch({ dlgType: DlgTypes.resetPwd, targetRow: row })}>
                            {ts("reset_pwd")}
                        </Button>
                        <Button
                            type="link"
                            danger
                            disabled={row.name === MASTER}
                            onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
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
        doSearchRoles(data, dispatch);
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
                            <Form.Item label={ts("account")} name="name">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Form.Item label={ts("nick_name")} name="nick_name">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Form.Item label={ts("role")} name="role_code">
                                <Select allowClear options={data.roles.map((item: any) => ({ label: item.name, value: item.code }))} />
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
                    getCheckboxProps: (row: any) => ({ disabled: row.name === MASTER }),
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
                title={ts("action")}
                open={data.dlgType === DlgTypes.resetPwd}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doResetPwd}
                onCancel={() => dispatch({ dlgType: null })}>
                <div>{ts("confirm_reset_pwd")}</div>
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
