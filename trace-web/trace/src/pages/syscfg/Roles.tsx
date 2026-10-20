import "./Roles.less";
import { Form, Input, Button, Table, message, Row, Col, Modal, Checkbox, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect, useMemo } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import { Root, useSelector } from "@/store";
import * as Api from "@/api/ApiRole";
import { buildAppMenus, codesForBases, scopeModulesFromMenu } from "../navMenu";

const pageSizeOptions = [20, 50, 100];

const ROOT = "root";

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
}

const flattenPermTree = (nodes: any[] = []): Array<{ code: string; name: string }> => {
    const results: Array<{ code: string; name: string }> = [];
    const walk = (list: any[]) => {
        list.forEach((node: any) => {
            if (node?.code) {
                results.push({ code: node.code, name: node.name || "" });
            }
            if (Array.isArray(node?.children) && node.children.length > 0) {
                walk(node.children);
            }
        });
    };
    walk(nodes);
    return results;
};

const RoleDlg = ({ data, dispatch, onSaved }: any) => {
    const user = useSelector((state: Root) => state.user);
    const { t: ts, i18n } = useTranslation();
    const [editForm] = Form.useForm();

    const doEdit = () => {
        if (!data.targetRow.role_perms || data.targetRow.role_perms.length === 0) {
            message.error(ts("msg_select_perms"));
            return;
        }
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            const fn_request = data.dlgType === DlgTypes.edit ? Api.update_role : Api.add_role;
            const params = { ...values, role_perms: data.targetRow.role_perms };
            fn_request(params).then((res: any) => {
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

            dispatch({ loading: true });
            const role_code = data.dlgType === DlgTypes.edit ? data.targetRow.code : user.role_code;
            Api.get_role({ code: role_code }).then((res: any) => {
                if (res.code === Api.C_OK) {
                    const perm_tree = res.data.perm_tree || [];
                    const role_perms = data.dlgType === DlgTypes.edit ? res.data.role_perms || [] : [];
                    const all_perms = res.data.all_perms || [];
                    const fixed_base_perms = res.data.fixed_base_perms || [];
                    const targetRow = { ...data.targetRow, perm_tree, role_perms: role_perms || [], all_perms, fixed_base_perms };
                    editForm.setFieldsValue(targetRow);
                    dispatch({ loading: false, targetRow });
                } else {
                    dispatch({ loading: false });
                    message.error(res.msg);
                }
            });
        }
    }, [data.dlgType, data.targetRow.code]);

    const moduleRows = useMemo(() => {
        const flatPerms = flattenPermTree(data.targetRow.perm_tree || []);
        const menus = buildAppMenus(ts, { role: "root", userId: 1 });
        return scopeModulesFromMenu(menus).map((row) => ({
            moduleName: row.moduleName,
            bases: row.bases,
            exclusiveBases: row.exclusiveBases,
            codes: codesForBases(row.bases, flatPerms),
        }));
    }, [data.targetRow.perm_tree, i18n.language]);

    const allChecked = useMemo(() => {
        const role_perms = new Set(data.targetRow.role_perms || []);
        return (data.targetRow.all_perms || []).every((item: string) => role_perms.has(item));
    }, [data.targetRow.all_perms, data.targetRow.role_perms]);

    const fixedPerms = useMemo(() => new Set(data.targetRow.fixed_base_perms || []), [data.targetRow.fixed_base_perms]);

    return (
        <Modal
            centered
            width={760}
            title={data.dlgType === DlgTypes.add ? ts("add") : ts("edit")}
            open={data.dlgType === DlgTypes.add || data.dlgType === DlgTypes.edit}
            maskClosable={false}
            confirmLoading={data.loading}
            onOk={doEdit}
            onCancel={() => dispatch({ dlgType: null })}>
            <div className="div-v">
                <Form form={editForm} className="expand" onFinish={(_values) => {}}>
                    <Form.Item hidden name="code">
                        <Input allowClear value={data.targetRow.code} />
                    </Form.Item>
                    <Form.Item
                        label={ts("role_name")}
                        rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("role_name") }) }]}
                        name="name">
                        <Input allowClear disabled={fixedPerms.size > 0} />
                    </Form.Item>
                    <Form.Item required label={ts("role_perms")}>
                        <Checkbox
                            checked={allChecked}
                            disabled={data.targetRow.code === ROOT}
                            className="all_perms"
                            onChange={(e) => {
                                const role_perms = e.target.checked ? data.targetRow.all_perms || [] : [];
                                dispatch({ targetRow: { ...data.targetRow, role_perms } });
                            }}>
                            {ts("select_all")}
                        </Checkbox>
                        <div className="perm_scope_grid">
                            {moduleRows.map((item) => {
                                const hasBase = (codes: string[], base: string) => codes.some((code) => code === base || code.startsWith(`${base}_`));
                                const controlBases = item.exclusiveBases.length ? item.exclusiveBases : item.bases;
                                const rolePerms = data.targetRow.role_perms || [];
                                const checked = controlBases.length > 0 && controlBases.every((base: string) => hasBase(rolePerms, base));
                                const disabled = data.targetRow.code === ROOT || item.codes.length === 0;
                                return (
                                    <div key={item.moduleName} className="perm_scope_card">
                                        <div className="perm_scope_card_title">{item.moduleName}</div>
                                        <div className="perm_scope_card_check">
                                            <Checkbox
                                                checked={checked}
                                                disabled={disabled}
                                                onChange={(e) => {
                                                    const before = Array.from(data.targetRow.role_perms || []) as string[];
                                                    const next = new Set<string>(before);
                                                    const sameSet = (row: any) => row.codes.length > 0 && row.codes.every((code: string) => item.codes.includes(code)) && item.codes.every((code: string) => row.codes.includes(code));
                                                    if (e.target.checked) {
                                                        item.codes.forEach((code: string) => next.add(code));
                                                    } else {
                                                        const turningOff = new Set(moduleRows.filter((row) => row.moduleName === item.moduleName || sameSet(row)).map((row) => row.moduleName));
                                                        moduleRows.forEach((row) => {
                                                            if (turningOff.has(row.moduleName)) row.codes.forEach((code: string) => next.delete(code));
                                                        });
                                                        moduleRows.forEach((row) => {
                                                            if (turningOff.has(row.moduleName)) return;
                                                            const control = row.exclusiveBases.length ? row.exclusiveBases : row.bases;
                                                            const wasOn = control.length > 0 && control.every((base: string) => hasBase(before, base));
                                                            if (wasOn) row.codes.forEach((code: string) => next.add(code));
                                                        });
                                                    }
                                                    dispatch({ targetRow: { ...data.targetRow, role_perms: Array.from(next) } });
                                                }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="perm_scope_tip">
                            仅展示导航模块权限范围，不展示查看/编辑等子权限项。
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
        selectedRowKeys: [],
    });

    const doSearch = (params: any, page_index: any, page_size: any) => {
        dispatch({ loading: true });
        Api.list_role({ ...params, page_index: page_index - 1, page_size }).then((res: any) => {
            dispatch({ loading: false, pageIndex: page_index, pageSize: page_size });
            if (res.code === Api.C_OK) {
                dispatch({ total: res.data.total, rows: res.data.rows });
            } else {
                dispatch({ total: 0, rows: [] });
                message.error(res.msg);
            }
        });
    };

    const doDelete = () => {
        dispatch({ loading: true });
        Api.delete_role({ code: data.targetRow.code }).then((res: any) => {
            dispatch({ loading: false, dlgType: null });
            if (res.code === Api.C_OK) {
                message.success(res.msg);
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                message.error(res.msg);
            }
        });
    };

    const doBatchDelete = () => {
        const rows = (data.rows || []).filter((r: any) => (data.selectedRowKeys || []).includes(r.id));
        const codes = rows.map((r: any) => r.code).filter((c: string) => c !== ROOT);
        if (codes.length === 0) {
            message.warning(ts("please_select_items"));
            return;
        }
        Modal.confirm({
            title: ts("action"),
            content: sprintf(ts("batch_delete_confirm"), { count: codes.length }),
            onOk: async () => {
                dispatch({ loading: true });
                const codeToRow = Object.fromEntries((data.rows || []).map((r: any) => [r.code, r]));
                let successCount = 0;
                const failedCodes: any[] = [];
                for (const code of codes) {
                    try {
                        const res: any = await Api.delete_role({ code });
                        if (res.code === Api.C_OK) successCount++;
                        else failedCodes.push(code);
                    } catch {
                        failedCodes.push(code);
                    }
                }
                const failedItems = failedCodes.map((c) => codeToRow[c]?.name ?? c).join("、");
                dispatch({ loading: false, selectedRowKeys: [] });
                if (failedCodes.length === 0) message.success(ts("batch_delete_success"));
                else if (successCount > 0) message.warning(sprintf(ts("batch_delete_partial"), { success: successCount, items: failedItems }));
                else message.error(sprintf(ts("batch_delete_all_failed"), { items: failedItems }));
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            },
        });
    };

    const columns = [
        {
            title: ts("role_name"),
            dataIndex: "name",
        },
        {
            title: ts("create_time"),
            dataIndex: "create_time",
        },
        {
            title: "关联用户数",
            dataIndex: "user_count",
        },
        {
            title: ts("action"),
            render: (_value: any, row: any) => {
                return (
                    <Space>
                        <Button type="link" onClick={() => dispatch({ dlgType: DlgTypes.edit, targetRow: row })}>
                            权限范围
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
                            <Form.Item label={ts("role_name")} name="name">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
                <div className="div-h hspace">
                    <Button type="primary" onClick={() => doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize)}>
                        刷新
                    </Button>
                    <Button disabled={!(data.selectedRowKeys || []).length} danger onClick={doBatchDelete}>
                        {ts("delete")}
                    </Button>
                </div>
            </div>
            <Table
                className="expand"
                rowSelection={{
                    selectedRowKeys: data.selectedRowKeys || [],
                    getCheckboxProps: (row: any) => ({ disabled: row.code === ROOT }),
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
            <RoleDlg
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
