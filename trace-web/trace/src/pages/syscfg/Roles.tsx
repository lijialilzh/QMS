import "./Roles.less";
import { Form, Input, Button, Table, message, Row, Col, Modal, Checkbox, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect, useMemo } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import { Root, useSelector } from "@/store";
import * as Api from "@/api/ApiRole";

const pageSizeOptions = [20, 50, 100];

const ROOT = "root";

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
}

const SCOPE_MODULES = [
    "仪表盘",
    "系统配置",
    "基础数据",
    "产品版本管理",
    "产品文件管理",
    "需求管理",
    "设计管理",
    "图表文件管理",
    "风险追溯管理",
    "全局视图",
];

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

const matchModuleCodes = (moduleName: string, items: Array<{ code: string; name: string }>) => {
    const hit = (item: { code: string; name: string }) => {
        const name = item.name || "";
        const code = item.code || "";
        if (moduleName === "仪表盘") return name.startsWith("仪表盘") || code.startsWith("dashboard");
        if (moduleName === "系统配置") return name.startsWith("系统管理/") || ["role", "user", "project"].some((k) => code.startsWith(k));
        if (moduleName === "基础数据") return name.startsWith("基础数据/") || ["haz", "rcm", "cst"].some((k) => code.startsWith(k));
        if (moduleName === "产品版本管理") return name.startsWith("产品版本/产品管理") || code.startsWith("product");
        if (moduleName === "产品文件管理") return name.startsWith("产品版本/产品DHF管理") || code.startsWith("prod_dhf");
        if (moduleName === "需求管理") return name.includes("需求") || code.startsWith("srs_doc");
        if (moduleName === "设计管理") return name.includes("设计") || code.startsWith("sds_doc");
        if (moduleName === "图表文件管理") return name.startsWith("图表文件/") || code.startsWith("doc_file_");
        if (moduleName === "风险追溯管理") return ["prod_haz", "prod_rcm", "prod_cst", "test_set", "test_case"].some((k) => code.startsWith(k));
        if (moduleName === "全局视图") return code.startsWith("overview") || name.includes("全局视图");
        return false;
    };
    return Array.from(new Set(items.filter(hit).map((item) => item.code)));
};

const RoleDlg = ({ data, dispatch, onSaved }: any) => {
    const user = useSelector((state: Root) => state.user);
    const { t: ts } = useTranslation();
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
                    const mergedRolePerms = Array.from(new Set([...(role_perms || []), ...fixed_base_perms]));
                    const targetRow = { ...data.targetRow, perm_tree, role_perms: mergedRolePerms, all_perms, fixed_base_perms };
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
        return SCOPE_MODULES.map((moduleName) => {
            return {
                moduleName,
                codes: matchModuleCodes(moduleName, flatPerms),
            };
        });
    }, [data.targetRow.perm_tree]);

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
                                const role_perms = e.target.checked ? data.targetRow.all_perms || [] : Array.from(fixedPerms);
                                dispatch({ targetRow: { ...data.targetRow, role_perms } });
                            }}>
                            {ts("select_all")}
                        </Checkbox>
                        <div className="perm_scope_grid">
                            {moduleRows.map((item) => {
                                const checked = item.codes.length > 0 && item.codes.every((code) => (data.targetRow.role_perms || []).includes(code));
                                const disabled = data.targetRow.code === ROOT || item.codes.length === 0;
                                return (
                                    <div key={item.moduleName} className="perm_scope_card">
                                        <div className="perm_scope_card_title">{item.moduleName}</div>
                                        <div className="perm_scope_card_check">
                                            <Checkbox
                                                checked={checked}
                                                disabled={disabled}
                                                onChange={(e) => {
                                                    const current = new Set(data.targetRow.role_perms || []);
                                                    if (e.target.checked) {
                                                        item.codes.forEach((code) => current.add(code));
                                                    } else {
                                                        item.codes.forEach((code) => {
                                                            if (!fixedPerms.has(code)) current.delete(code);
                                                        });
                                                    }
                                                    const merged = Array.from(new Set([...Array.from(current), ...Array.from(fixedPerms)]));
                                                    dispatch({ targetRow: { ...data.targetRow, role_perms: merged } });
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
                        {fixedPerms.size > 0 && (
                            <div style={{ marginTop: 8, color: "#999" }}>
                                固定角色默认权限不可取消，可在此基础上新增权限。
                            </div>
                        )}
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
