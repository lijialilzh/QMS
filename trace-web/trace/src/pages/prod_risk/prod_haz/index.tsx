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

    const doUpdate = () => {
        dispatch({ updating: true });
        Api.update_prod_haz({ ...data.targetEdit }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ updating: false, targetEdit: {} });
                message.success(res.msg);
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                dispatch({ updating: false });
                message.error(res.msg);
            }
        });
    };

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
                if (data.targetEdit.id !== row.id) {
                    return renderOneLineWithTooltip(value, { emptyText: "" });
                }
                return (
                    <Input.TextArea
                        rows={3}
                        value={data.targetEdit.situation}
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
                if (data.targetEdit.id !== row.id) {
                    return renderOneLineWithTooltip(value, { emptyText: "" });
                }
                return (
                    <Input.TextArea
                        rows={3}
                        value={data.targetEdit.damage}
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
                if (data.targetEdit.id !== row.id) {
                    return renderRiskTip(row, "init");
                }
                return (
                    <div>
                        <div>
                            概率：
                            <Select
                                allowClear
                                options={HAZ_RATES}
                                value={data.targetEdit.init_rate}
                                onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, init_rate: evt } })}
                            />
                        </div>
                        <div>
                            程度：
                            <Select
                                allowClear
                                options={HAZ_DEGREES}
                                value={data.targetEdit.init_degree}
                                onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, init_degree: evt } })}
                            />
                        </div>
                        <div>
                            危险水平：
                            <Select
                                allowClear
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
                if (data.targetEdit.id !== row.id) {
                    const text = value || "";
                    const lines = buildDealLines(text);
                    return (
                        <div className="deal-wrap" title={text}>
                            {lines.map((item, idx) => (
                                <div key={`${item}-${idx}`} className="deal-item">
                                    {item}
                                </div>
                            ))}
                        </div>
                    );
                }
                return (
                    <Input.TextArea
                        rows={3}
                        value={data.targetEdit.deal}
                        onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, deal: evt.target.value } })}
                    />
                );
            },
        },
        {
            title: ts("haz.rcms"),
            dataIndex: "rcms",
            width: 240,
            className: "wrap-cell",
            render: (value: any, row: any) => {
                if (data.targetEdit.id !== row.id) {
                    const rcms = String(value || "")
                        .split(/[\s,，]+/)
                        .map((item) => item.trim())
                        .filter((item) => item !== "");
                    return (
                        <div className="wrap-list-cell" title={value || ""}>
                            {rcms.map((item, idx) => (
                                <div key={`${item}-${idx}`} className="wrap-list-item">
                                    {item}
                                </div>
                            ))}
                        </div>
                    );
                }
                return (
                    <Select
                        showSearch
                        className="rcms-select"
                        style={{ width: "100%", minWidth: "200px" }}
                        maxTagCount={999}
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
                );
            },
        },
        {
            title: ts("haz.evidence"),
            dataIndex: "evidence",
            width: 200,
            className: "wrap-cell",
            render: (value: any, row: any) => {
                if (data.targetEdit.id !== row.id) {
                    const evidences = buildEvidenceLines(value);
                    return (
                        <div className="wrap-list-cell" title={value || ""}>
                            {evidences.map((item, idx) => (
                                <div key={`${item}-${idx}`} className="wrap-list-item">
                                    {item}
                                </div>
                            ))}
                        </div>
                    );
                }
                return (
                    <Input.TextArea
                        rows={2}
                        value={data.targetEdit.evidence}
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
                if (data.targetEdit.id !== row.id) {
                    return renderRiskTip(row, "cur");
                }
                return (
                    <div>
                        <div>
                            概率：
                            <Select
                                allowClear
                                options={HAZ_RATES}
                                value={data.targetEdit.cur_rate}
                                onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, cur_rate: evt } })}
                            />
                        </div>
                        <div>
                            程度：
                            <Select
                                allowClear
                                options={HAZ_DEGREES}
                                value={data.targetEdit.cur_degree}
                                onChange={(evt: any) => dispatch({ targetEdit: { ...data.targetEdit, cur_degree: evt } })}
                            />
                        </div>
                        <div>
                            危险水平：
                            <Select
                                allowClear
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
                        {data.targetEdit.id === row.id && (
                            <Button type="link" onClick={() => dispatch({ targetEdit: {} })}>
                                {ts("cancel")}
                            </Button>
                        )}
                        <Button
                            type="link"
                            loading={data.updating && data.targetEdit.id === row.id}
                            onClick={() => {
                                if (data.targetEdit.id === row.id) {
                                    doUpdate();
                                } else {
                                    dispatch({ targetEdit: row });
                                    doSearchRcms(row.prod_id, data, dispatch);
                                }
                            }}>
                            {data.targetEdit.id === row.id ? ts("save") : ts("edit")}
                        </Button>
                        {data.targetEdit.id !== row.id && (
                            <Button type="link" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
                                {ts("delete")}
                            </Button>
                        )}
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
