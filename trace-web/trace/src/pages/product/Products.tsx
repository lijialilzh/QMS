import "./Products.less";
import { Form, Input, Button, Table, message, Row, Col, Modal, Select, Space, Checkbox, Tag } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect, useMemo } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import * as Api from "@/api/ApiProduct";
import * as ApiProdDhf from "@/api/ApiProdDhf";
import * as ApiProject from "@/api/ApiProject";
import * as ApiCompanyInfo from "@/api/ApiCompanyInfo";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
    copy = "copy",
}

const versionSeq = (value?: string) => {
    const matched = String(value || "").match(/(\d+)(?!.*\d)/);
    return matched ? Number(matched[1]) : -1;
};

const bumpVersion = (version?: string) => {
    const raw = String(version || "").trim();
    const matched = raw.match(/(\d+)(?!.*\d)/);
    if (!matched || matched.index === undefined) return raw;
    const start = matched.index;
    const digits = matched[1];
    return `${raw.slice(0, start)}${Number(digits) + 1}${raw.slice(start + digits.length)}`;
};

const suggestFullVersion = (products: any[], targetName: string, sourceRow: any) => {
    const versions = (products || [])
        .filter((item) => item.name === targetName)
        .map((item) => String(item.full_version || "").trim())
        .filter(Boolean);
    if (targetName === sourceRow?.name) {
        return bumpVersion(sourceRow.full_version);
    }
    if (versions.length > 0) {
        const maxVersion = versions.reduce((best, current) => (
            versionSeq(current) >= versionSeq(best) ? current : best
        ));
        return bumpVersion(maxVersion);
    }
    return String(sourceRow?.full_version || "").trim();
};

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

const loadCompanies = (data: any, dispatch: any) => {
    if ((data.companies || []).length > 0) return;
    ApiCompanyInfo.list_company_info({ page_index: 0, page_size: 1000 }).then((res: any) => {
        if (res.code === ApiCompanyInfo.C_OK) {
            dispatch({ companies: res.data?.rows || [] });
        }
    });
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
            loadCompanies(data, dispatch);
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
                        <Col span={12}>
                            <Form.Item label="注册人" name="registrant">
                                <Select
                                    allowClear
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="请选择注册人"
                                    options={Array.from(
                                        new Set((data.companies || []).map((c: any) => c.registrant).filter(Boolean))
                                    ).map((registrant: any) => ({ label: registrant, value: registrant }))}
                                />
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
                            <Form.Item label="总体描述" name="overall_desc">
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
        companies: [],
        products: [],
        copyTargetName: "",
        copyFullVersion: "",
        copyDhfRows: [] as any[],
        copyDhfSelectedIds: [] as number[],
        copyDhfSearch: "",
        copyDhfLoading: false,
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

    const handleCopy = (row: any) => {
        const applyCopyDefaults = (products: any[]) => {
            const targetName = row.name || "";
            dispatch({
                dlgType: DlgTypes.copy,
                targetRow: row,
                copyTargetName: targetName,
                copyFullVersion: suggestFullVersion(products, targetName, row),
                copyDhfRows: [],
                copyDhfSelectedIds: [],
                copyDhfSearch: "",
                copyDhfLoading: true,
            });
            ApiProdDhf.list_prod_dhf({ prod_id: row.id, page_index: 0, page_size: 10000 }).then((res: any) => {
                if (res.code === ApiProdDhf.C_OK) {
                    dispatch({ copyDhfRows: res.data?.rows || [], copyDhfLoading: false });
                } else {
                    dispatch({ copyDhfLoading: false });
                    message.error(res.msg || "加载 DHF 清单失败");
                }
            }).catch(() => {
                dispatch({ copyDhfLoading: false });
                message.error("加载 DHF 清单失败");
            });
        };
        if ((data.products || []).length > 0) {
            applyCopyDefaults(data.products);
            return;
        }
        Api.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const products = res.data.rows || [];
                dispatch({ products });
                applyCopyDefaults(products);
            } else {
                message.error(res.msg);
            }
        });
    };

    const copyNameOptions = useMemo(() => {
        const names = new Set<string>();
        (data.products || []).forEach((item: any) => {
            if (item?.name) names.add(item.name);
        });
        return Array.from(names).map((name) => ({ label: name, value: name }));
    }, [data.products]);

    const handleCopyTargetNameChange = (targetName?: string) => {
        const row = data.targetRow || {};
        dispatch({
            copyTargetName: targetName || "",
            copyFullVersion: targetName
                ? suggestFullVersion(data.products || [], targetName, row)
                : "",
        });
    };

    const filteredCopyDhfRows = useMemo(() => {
        const keyword = String(data.copyDhfSearch || "").trim().toLowerCase();
        if (!keyword) return data.copyDhfRows || [];
        return (data.copyDhfRows || []).filter((item: any) => {
            const code = String(item.code || "").toLowerCase();
            const name = String(item.name || "").toLowerCase();
            return code.includes(keyword) || name.includes(keyword);
        });
    }, [data.copyDhfRows, data.copyDhfSearch]);

    const selectedCopyDhfRows = useMemo(() => {
        const selected = new Set(data.copyDhfSelectedIds || []);
        return (data.copyDhfRows || []).filter((item: any) => selected.has(item.id));
    }, [data.copyDhfRows, data.copyDhfSelectedIds]);

    const toggleCopyDhfSelected = (id: number, checked: boolean) => {
        const next = new Set(data.copyDhfSelectedIds || []);
        if (checked) next.add(id);
        else next.delete(id);
        dispatch({ copyDhfSelectedIds: Array.from(next) });
    };

    const doCopy = () => {
        const row = data.targetRow || {};
        if (!row.id) return;
        const targetName = String(data.copyTargetName || "").trim();
        const nextFullVersion = String(data.copyFullVersion || "").trim();
        if (!targetName) {
            message.warning(sprintf(ts("msg_select"), { label: ts("product.name") }));
            return;
        }
        if (!nextFullVersion) {
            message.warning(sprintf(ts("msg_input"), { label: ts("product.full_version") }));
            return;
        }
        const duplicated = (data.products || []).some((item: any) => (
            item.name === targetName && String(item.full_version || "").trim() === nextFullVersion
        ));
        if (duplicated) {
            message.error("完整版本号已存在，请修改后再复制");
            return;
        }
        dispatch({ loading: true });
        const dhfIds = (data.copyDhfSelectedIds || []).filter((id: number) => id > 0);
        Api.duplicate_product({
            id: row.id,
            name: targetName,
            full_version: nextFullVersion,
            dhf_ids: dhfIds.length > 0 ? dhfIds.join(",") : undefined,
        }).then((res: any) => {
            dispatch({ loading: false });
            if (res.code === Api.C_OK) {
                dispatch({ dlgType: null });
                const stats = res.data || {};
                const parts = ["复制成功"];
                if (stats.dhf_count) parts.push(`DHF ${stats.dhf_count} 条`);
                if (stats.doc_count) parts.push(`文档 ${stats.doc_count} 份`);
                if (stats.test_set_count) parts.push(`测试集 ${stats.test_set_count} 个`);
                if (stats.doc_file_count) parts.push(`图表 ${stats.doc_file_count} 个`);
                message.success(parts.join("，"));
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                message.error(res.msg || "复制失败");
            }
        }).catch(() => {
            dispatch({ loading: false });
            message.error("复制失败");
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
            width: 110,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.country"),
            dataIndex: "country",
            width: 45,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.category"),
            dataIndex: "category",
            width: 55,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.type_code"),
            dataIndex: "type_code",
            width: 75,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.full_version"),
            dataIndex: "full_version",
            width: 60,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.release_version"),
            dataIndex: "release_version",
            width: 50,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.udi"),
            dataIndex: "udi",
            width: 110,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: "产品代码",
            dataIndex: "product_code",
            width: 50,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: "注册人",
            dataIndex: "registrant",
            width: 80,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.scope"),
            dataIndex: "scope",
            width: 90,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.component"),
            dataIndex: "component",
            width: 90,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.note"),
            dataIndex: "note",
            width: 70,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("create_time"),
            dataIndex: "create_time",
            width: 80,
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("action"),
            width: 150,
            render: (_value: any, row: any) => {
                return (
                    <Space>
                        <Button type="link" size="small" onClick={() => dispatch({ dlgType: DlgTypes.edit, targetRow: row })}>
                            {ts("edit")}
                        </Button>
                        <Button type="link" size="small" onClick={() => handleCopy(row)}>
                            复制
                        </Button>
                        <Button type="link" size="small" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
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
        <div className="page div-v product">
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
            <Modal
                centered
                width={680}
                title="复制"
                open={data.dlgType === DlgTypes.copy}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doCopy}
                onCancel={() => dispatch({ dlgType: null })}>
                <div style={{ lineHeight: 1.8 }}>
                    <div style={{ marginBottom: 12 }}>复制到目标产品（默认当前产品，可选其它产品）：</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Select
                            style={{ flex: 1, minWidth: 0 }}
                            showSearch
                            optionFilterProp="label"
                            placeholder={ts("product.name")}
                            value={data.copyTargetName || undefined}
                            options={copyNameOptions}
                            onChange={handleCopyTargetNameChange}
                        />
                        <Input
                            style={{ flex: 1, minWidth: 0 }}
                            allowClear
                            placeholder={ts("product.full_version")}
                            value={data.copyFullVersion}
                            onChange={(e) => dispatch({ copyFullVersion: e.target.value })}
                        />
                    </div>
                    <div style={{ color: "#888", marginTop: 12, marginBottom: 12 }}>
                        完整版本需手动填写且不能与目标产品下已有版本重复；发布版本仍自动生成。
                    </div>
                    <div style={{ marginBottom: 8, fontWeight: 500 }}>联动复制 DHF（可选，手动勾选）</div>
                    <Input
                        allowClear
                        placeholder="搜索文件编号 / 文件名称"
                        value={data.copyDhfSearch}
                        onChange={(e) => dispatch({ copyDhfSearch: e.target.value })}
                        style={{ marginBottom: 8 }}
                    />
                    <div
                        style={{
                            maxHeight: 260,
                            overflow: "auto",
                            border: "1px solid #f0f0f0",
                            borderRadius: 4,
                            padding: "8px 12px",
                            background: "#fafafa",
                        }}>
                        {data.copyDhfLoading ? (
                            <div style={{ color: "#888" }}>加载 DHF 清单中...</div>
                        ) : (data.copyDhfRows || []).length === 0 ? (
                            <div style={{ color: "#888" }}>源产品暂无 DHF 条目，将仅复制产品主数据。</div>
                        ) : filteredCopyDhfRows.length === 0 ? (
                            <div style={{ color: "#888" }}>无匹配结果，请调整搜索关键字。</div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {filteredCopyDhfRows.map((item: any) => (
                                    <Checkbox
                                        key={item.id}
                                        checked={(data.copyDhfSelectedIds || []).includes(item.id)}
                                        onChange={(e) => toggleCopyDhfSelected(item.id, e.target.checked)}>
                                        <span style={{ marginRight: 12 }}>{item.code || "-"}</span>
                                        <span style={{ color: "#666" }}>{item.name || "-"}</span>
                                    </Checkbox>
                                ))}
                            </div>
                        )}
                    </div>
                    {selectedCopyDhfRows.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                            <div style={{ color: "#888", marginBottom: 6 }}>已选条目（切换搜索仍保留）：</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {selectedCopyDhfRows.map((item: any) => (
                                    <Tag
                                        key={item.id}
                                        closable
                                        onClose={() => toggleCopyDhfSelected(item.id, false)}>
                                        {(item.code || "-") + " " + (item.name || "-")}
                                    </Tag>
                                ))}
                            </div>
                        </div>
                    )}
                    <div style={{ color: "#888", marginTop: 8 }}>
                        已选 {(data.copyDhfSelectedIds || []).length} 条；勾选后将同步复制对应模块文档（编号 + 名称双重匹配）。
                    </div>
                </div>
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
