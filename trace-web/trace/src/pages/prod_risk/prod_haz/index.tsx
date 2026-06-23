import { Form, Button, Table, message, Row, Col, Modal, Select, Input, Tag, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import { HAZ_RATES, HAZ_DEGREES, HAZ_LEVELS, HAZDICT_RATES, HAZDICT_DEGREES, HAZDICT_LEVELS } from "@/pages/basedata/Hazs";
import * as Api from "@/api/ApiProdHaz";
import { doSearchProducts, doSearchRcms } from "../util";
import EditDlg from "./EditDlg";
import "./index.less";


const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    delete = "delete",
}

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
        loadingProducts: false,
        products: [],
        targetProdId: null,
        targetEdit: {},
        editingField: null,
        rcms: [],
        selectedRowKeys: [],
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_prod_haz({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, pageIndex, pageSize, total: res.data.total, rows: res.data.rows });
            } else {
                dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
                message.error(res.msg);
            }
        });
    };

    // 点击单元格进入单字段编辑
    const startEdit = (row: any, field: string) => {
        if (data.targetEdit.id === row.id && data.editingField === field) return;
        dispatch({ targetEdit: { ...row }, editingField: field });
        if (field === "rcms") doSearchRcms(row.prod_id, data, dispatch);
    };

    // 该格失焦时实时保存（保存后本地更新该行，避免整表刷新闪烁）
    const saveCell = () => {
        const edit = data.targetEdit;
        if (!edit?.id || data.updating) return;
        dispatch({ updating: true });
        Api.update_prod_haz({ ...edit }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const rows = (data.rows || []).map((r: any) => (r.id === edit.id ? { ...r, ...edit } : r));
                dispatch({ updating: false, targetEdit: {}, editingField: null, rows });
                message.success(res.msg);
            } else {
                dispatch({ updating: false });
                message.error(res.msg);
            }
        });
    };

    // 一格多控件（风险三个下拉、RCM 多选）：焦点离开该格时统一保存
    const cellBlurSave = (evt: any) => {
        if (!evt.currentTarget.contains(evt.relatedTarget as Node)) saveCell();
    };

    const isEditing = (row: any, field: string) => data.targetEdit.id === row.id && data.editingField === field;

    const doDelete = () => {
        dispatch({ loading: true });
        Api.delete_prod_hazs({ id: data.targetRow.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, dlgType: null, selectedRowKeys: [] });
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
                        const res: any = await Api.delete_prod_hazs({ id });
                        if (res.code === Api.C_OK) successCount++;
                        else failedIds.push(id);
                    } catch {
                        failedIds.push(id);
                    }
                }
                const failedItems = failedIds.map((id) => idToRow[id]?.code ?? id).join("、");
                dispatch({ loading: false, selectedRowKeys: [] });
                if (failedIds.length === 0) message.success(ts("batch_delete_success"));
                else if (successCount > 0) message.warning(sprintf(ts("batch_delete_partial"), { success: successCount, items: failedItems }));
                else message.error(sprintf(ts("batch_delete_all_failed"), { items: failedItems }));
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            },
        });
    };

    const renderRiskTip = (row: any, type: "init" | "cur") => {
        const rateTxt = (type === "init" ? HAZDICT_RATES[row.init_rate] ?? row.init_rate : HAZDICT_RATES[row.cur_rate] ?? row.cur_rate) ?? "";
        const degreeTxt = (type === "init" ? HAZDICT_DEGREES[row.init_degree] ?? row.init_degree : HAZDICT_DEGREES[row.cur_degree] ?? row.cur_degree) ?? "";
        const levelTxt = (type === "init" ? HAZDICT_LEVELS[row.init_level] ?? row.init_level : HAZDICT_LEVELS[row.cur_level] ?? row.cur_level) ?? "";
        const tipText = `概率：${rateTxt}\n程度：${degreeTxt}\n危险水平：${levelTxt}`;
        return (
            <div title={tipText} className="risk-tip" style={{ lineHeight: "20px" }}>
                <div>概率：{rateTxt}</div>
                <div>程度：{degreeTxt}</div>
                <div>危险水平：{levelTxt}</div>
            </div>
        );
    };

    const buildDealTextFromRcms = (codes: string[]) => {
        const selectedOptions = (codes || [])
            .map((code) => data.rcms.find((item: any) => item.code === code))
            .filter((item: any) => !!item);
        return selectedOptions
            .map((item: any) => (item.description || "").trim())
            .filter((text: string) => text !== "")
            .join("\n");
    };

    const buildEvidenceLines = (value: any) => {
        const tokens = String(value || "")
            .split(/[\s、]+/)
            .map((item) => item.trim())
            .filter((item) => item !== "");
        const lines: string[] = [];
        for (let i = 0; i < tokens.length; i += 1) {
            const token = tokens[i];
            if (token === "至" && lines.length > 0 && i + 1 < tokens.length) {
                const prev = lines.pop() as string;
                const next = tokens[i + 1];
                lines.push(`${prev} 至 ${next}`);
                i += 1;
                continue;
            }
            lines.push(token);
        }
        return lines;
    };

    const buildDealLines = (value: any) => {
        const text = String(value || "").trim();
        if (!text) {
            return [];
        }
        const normalized = text.replace(/\r?\n+/g, " ").replace(/\s+/g, " ");
        const lines: string[] = [];
        const regex = /(RCM\d+)\s*[.:：]?\s*([\s\S]*?)(?=(?:RCM\d+\s*[.:：]?)|$)/gi;
        let match = regex.exec(normalized);
        while (match) {
            const code = (match[1] || "").trim().toUpperCase();
            const content = (match[2] || "").replace(/^[-,，。；;:：\s]+/, "").trim();
            lines.push(content ? `${code}: ${content}` : code);
            match = regex.exec(normalized);
        }
        return lines.length > 0 ? lines : [normalized];
    };

    const columns = [
        {
            title: ts("haz.code"),
            dataIndex: "code",
            width: 150,
            onHeaderCell: () => ({ style: { minWidth: 150 } }),
            onCell: () => ({ style: { minWidth: 150 } }),
        },
        {
            title: ts("haz.source"),
            dataIndex: "source",
            width: 150,
            render: (value: any) => renderOneLineWithTooltip(value, { emptyText: "" }),
        },
        {
            title: ts("haz.event"),
            dataIndex: "event",
            width: 150,
            render: (value: any) => renderOneLineWithTooltip(value, { emptyText: "" }),
        },
        {
            title: ts("haz.situation"),
            dataIndex: "situation",
            width: 200,
            render: (value: any, row: any) => {
                if (!isEditing(row, "situation")) {
                    return (
                        <div className="haz-click-cell" style={{ cursor: "pointer", minHeight: 22 }} title="点击编辑" onClick={() => startEdit(row, "situation")}>
                            {renderOneLineWithTooltip(value, { emptyText: "点击编辑" })}
                        </div>
                    );
                }
                return (
                    <Input.TextArea
                        autoFocus
                        rows={3}
                        value={data.targetEdit.situation}
                        onBlur={saveCell}
                        onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, situation: evt.target.value } })}
                    />
                );
            },
        },
        {
            title: ts("haz.damage"),
            dataIndex: "damage",
            width: 200,
            render: (value: any, row: any) => {
                if (!isEditing(row, "damage")) {
                    return (
                        <div className="haz-click-cell" style={{ cursor: "pointer", minHeight: 22 }} title="点击编辑" onClick={() => startEdit(row, "damage")}>
                            {renderOneLineWithTooltip(value, { emptyText: "点击编辑" })}
                        </div>
                    );
                }
                return (
                    <Input.TextArea
                        autoFocus
                        rows={3}
                        value={data.targetEdit.damage}
                        onBlur={saveCell}
                        onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, damage: evt.target.value } })}
                    />
                );
            },
        },
        {
            title: ts("haz.init_risk"),
            width: 220,
            className: "risk-cell",
            onHeaderCell: () => ({ style: { width: 220, minWidth: 220, maxWidth: 220 } }),
            onCell: () => ({
                style: {
                    width: 220,
                    minWidth: 220,
                    maxWidth: 220,
                    whiteSpace: "normal",
                    overflow: "visible",
                    textOverflow: "unset",
                    height: "auto",
                    lineHeight: "20px",
                    paddingTop: 4,
                    paddingBottom: 4,
                    verticalAlign: "top",
                },
            }),
            render: (_value: any, row: any) => {
                if (!isEditing(row, "init_risk")) {
                    return (
                        <div style={{ cursor: "pointer" }} title="点击编辑" onClick={() => startEdit(row, "init_risk")}>
                            {renderRiskTip(row, "init")}
                        </div>
                    );
                }
                return (
                    <div tabIndex={-1} onBlur={cellBlurSave}>
                        <div>
                            概率：
                            <Select
                                autoFocus
                                allowClear
                                getPopupContainer={(t: any) => t.parentElement}
                                options={HAZ_RATES}
                                value={data.targetEdit.init_rate}
                                onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, init_rate: evt } })}
                            />
                        </div>
                        <div>
                            程度：
                            <Select
                                allowClear
                                getPopupContainer={(t: any) => t.parentElement}
                                options={HAZ_DEGREES}
                                value={data.targetEdit.init_degree}
                                onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, init_degree: evt } })}
                            />
                        </div>
                        <div>
                            危险水平：
                            <Select
                                allowClear
                                getPopupContainer={(t: any) => t.parentElement}
                                options={HAZ_LEVELS}
                                value={data.targetEdit.init_level}
                                onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, init_level: evt } })}
                            />
                        </div>
                    </div>
                );
            },
        },
        {
            title: ts("haz.deal"),
            dataIndex: "deal",
            width: 360,
            className: "deal-cell",
            onHeaderCell: () => ({ style: { minWidth: 320 } }),
            onCell: () => ({
                className: "deal-cell",
                style: {
                    minWidth: 320,
                    maxWidth: 420,
                    whiteSpace: "normal",
                    overflow: "visible",
                    textOverflow: "unset",
                    height: "auto",
                    lineHeight: "20px",
                    paddingTop: 4,
                    paddingBottom: 4,
                    verticalAlign: "top",
                },
            }),
            render: (value: any, row: any) => {
                if (!isEditing(row, "deal")) {
                    const text = value || "";
                    const lines = buildDealLines(text);
                    return (
                        <div className="deal-wrap" style={{ cursor: "pointer", minHeight: 22 }} title={text || "点击编辑"} onClick={() => startEdit(row, "deal")}>
                            {lines.length ? lines.map((item, idx) => (
                                <div key={`${item}-${idx}`} className="deal-item">
                                    {item}
                                </div>
                            )) : <span style={{ color: "#bbb" }}>点击编辑</span>}
                        </div>
                    );
                }
                return (
                    <Input.TextArea
                        autoFocus
                        rows={3}
                        value={data.targetEdit.deal}
                        onBlur={saveCell}
                        onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, deal: evt.target.value } })}
                    />
                );
            },
        },
        {
            title: ts("haz.rcms"),
            dataIndex: "rcms",
            width: 120,
            className: "wrap-cell",
            render: (value: any, row: any) => {
                if (!isEditing(row, "rcms")) {
                    const rcms = String(value || "")
                        .split(/[\s,，]+/)
                        .map((item) => item.trim())
                        .filter((item) => item !== "");
                    return (
                        <div className="wrap-list-cell" style={{ cursor: "pointer", minHeight: 22 }} title={value || "点击编辑"} onClick={() => startEdit(row, "rcms")}>
                            {rcms.length ? rcms.map((item, idx) => (
                                <div key={`${item}-${idx}`} className="wrap-list-item">
                                    {item}
                                </div>
                            )) : <span style={{ color: "#bbb" }}>点击编辑</span>}
                        </div>
                    );
                }
                return (
                    <div tabIndex={-1} onBlur={cellBlurSave}>
                        <Select
                            autoFocus
                            showSearch
                            className="rcms-select"
                            style={{ width: "100%", minWidth: "200px" }}
                            maxTagCount={999}
                            getPopupContainer={(t: any) => t.parentElement}
                            tagRender={(item: any) => {
                                return <Tag color="blue">{item.value}</Tag>;
                            }}
                            mode="multiple"
                            options={data.rcms.map((item: any) => ({ label: item.description, value: item.code }))}
                            value={(data.targetEdit.rcms || "").split(",").filter((item: any) => item !== "")}
                            onChange={(values: any) => {
                                const selectedCodes = (values || []) as string[];
                                dispatch({
                                    targetEdit: {
                                        ...data.targetEdit,
                                        rcms: selectedCodes.join(","),
                                        deal: buildDealTextFromRcms(selectedCodes),
                                    }
                                });
                            }}
                        />
                    </div>
                );
            },
        },
        {
            title: ts("haz.evidence"),
            dataIndex: "evidence",
            width: 320,
            className: "wrap-cell evidence-cell",
            onHeaderCell: () => ({ style: { minWidth: 320 } }),
            onCell: () => ({ style: { minWidth: 320 } }),
            render: (value: any, row: any) => {
                if (!isEditing(row, "evidence")) {
                    const evidences = buildEvidenceLines(value);
                    return (
                        <div className="wrap-list-cell" style={{ cursor: "pointer", minHeight: 22 }} title={value || "点击编辑"} onClick={() => startEdit(row, "evidence")}>
                            {evidences.length ? evidences.map((item, idx) => (
                                <div key={`${item}-${idx}`} className="wrap-list-item evidence-list-item">
                                    {item}
                                </div>
                            )) : <span style={{ color: "#bbb" }}>点击编辑</span>}
                        </div>
                    );
                }
                return (
                    <Input.TextArea
                        autoFocus
                        rows={2}
                        value={data.targetEdit.evidence}
                        onBlur={saveCell}
                        onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, evidence: evt.target.value } })}
                    />
                );
            },
        },
        {
            title: ts("haz.cur_risk"),
            width: 220,
            dataIndex: "cur_rate",
            className: "risk-cell",
            onHeaderCell: () => ({ style: { width: 220, minWidth: 220, maxWidth: 220 } }),
            onCell: () => ({
                style: {
                    width: 220,
                    minWidth: 220,
                    maxWidth: 220,
                    whiteSpace: "normal",
                    overflow: "visible",
                    textOverflow: "unset",
                    height: "auto",
                    lineHeight: "20px",
                    paddingTop: 4,
                    paddingBottom: 4,
                    verticalAlign: "top",
                },
            }),
            render: (_value: any, row: any) => {
                if (!isEditing(row, "cur_risk")) {
                    return (
                        <div style={{ cursor: "pointer" }} title="点击编辑" onClick={() => startEdit(row, "cur_risk")}>
                            {renderRiskTip(row, "cur")}
                        </div>
                    );
                }
                return (
                    <div tabIndex={-1} onBlur={cellBlurSave}>
                        <div>
                            概率：
                            <Select
                                autoFocus
                                allowClear
                                getPopupContainer={(t: any) => t.parentElement}
                                options={HAZ_RATES}
                                value={data.targetEdit.cur_rate}
                                onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, cur_rate: evt } })}
                            />
                        </div>
                        <div>
                            程度：
                            <Select
                                allowClear
                                getPopupContainer={(t: any) => t.parentElement}
                                options={HAZ_DEGREES}
                                value={data.targetEdit.cur_degree}
                                onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, cur_degree: evt } })}
                            />
                        </div>
                        <div>
                            危险水平：
                            <Select
                                allowClear
                                getPopupContainer={(t: any) => t.parentElement}
                                options={HAZ_LEVELS}
                                value={data.targetEdit.cur_level}
                                onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, cur_level: evt } })}
                            />
                        </div>
                    </div>
                );
            },
        },
        {
            title: ts("haz.benefit_flag"),
            dataIndex: "benefit_flag",
            width: 110,
            onHeaderCell: () => ({ style: { minWidth: 110 } }),
            onCell: () => ({ style: { minWidth: 110 } }),
            render: (_value: any, row: any) => {
                return row.benefit_flag ? ts("yes") : ts("no");
            },
        },
        {
            title: ts("haz.category"),
            dataIndex: "category",
            width: 150,
            onHeaderCell: () => ({ style: { minWidth: 150 } }),
            onCell: () => ({ style: { minWidth: 150 } }),
        },
        {
            title: ts("product.product"),
            dataIndex: "product_name",
            render: (_value: any, row: any) => {
                return renderOneLineWithTooltip(`${row.product_name}-${row.product_version}`, { emptyText: "" });
            },
        },
        {
            title: ts("action"),
            width: 140,
            fixed: "right" as const,
            render: (_value: any, row: any) => {
                return (
                    <Space size={8} style={{ whiteSpace: "nowrap" }}>
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
        doSearchProducts(data, dispatch);
        doSearch(form, data.pageIndex, data.pageSize);
    }, []);

    return (
        <div className="page div-v prod_haz">
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
                                    versionPlaceholder={ts("product.version")}
                                    onChange={(value) => {
                                        queryForm.setFieldValue("prod_id", value);
                                        dispatch({ targetProdId: value ?? null });
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
                    <Button
                        type="primary"
                        loading={data.exporting}
                        onClick={() => {
                            dispatch({ exporting: true });
                            Api.export_prod_hazs({ ...queryForm.getFieldsValue(), page_index: 0, page_size: 2000 }).then((res: any) => {
                                dispatch({ exporting: false });
                                if (res.code !== Api.C_OK) {
                                    message.error(res.msg);
                                }
                            });
                        }}>
                        {ts("export")}
                    </Button>
                    <Button
                        type="primary"
                        onClick={() => {
                            if (!data.targetProdId) {
                                message.error("请选择产品!");
                                return;
                            }
                            dispatch({ dlgType: DlgTypes.add, targetRow: {} });
                        }}>
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
                sticky
                scroll={{ x: 1800, y: "68vh" }}
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
            <EditDlg
                isOpen={data.dlgType === DlgTypes.add}
                onClose={(saved: boolean) => {
                    dispatch({ dlgType: null });
                    if (saved) {
                        doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
                    }
                }}
                prod_id={data.targetProdId}
            />
        </div>
    );
};
