import "./Hazx.less";
import { Form, Input, Button, Table, message, Row, Col, Modal, Switch, Select, Tag, Tooltip, Upload } from "antd";
import { SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import * as Api from "@/api/ApiHaz";
import * as ApiRcm from "@/api/ApiRcm";

const pageSizeOptions = [10, 20, 50];

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
}

export const HAZ_RATES = [1, 2, 3, 4, 5].map((v) => ({ value: v, label: v.toString() }));
export const HAZ_DEGREES = ["A", "B", "C", "D", "E"].map((v) => ({ value: v, label: v }));
export const HAZ_LEVELS = ["不可接受", "进一步降低的研究", "可忽略"].map((v, idx) => ({ value: (idx + 1).toString(), label: v }));

const arr2dict = (arr: any[]) => {
    return arr.reduce((dict: any, item: any) => {
        dict[item.value] = item.label;
        return dict;
    }, {});
};

export const HAZDICT_RATES = arr2dict(HAZ_RATES);
export const HAZDICT_DEGREES = arr2dict(HAZ_DEGREES);
export const HAZDICT_LEVELS = arr2dict(HAZ_LEVELS);

const doSearchRcms = (data: any, dispatch: any) => {
    if (data.rcms.length === 0) {
        dispatch({ loadingRcms: true });
        ApiRcm.list_rcm({ page_size: 1000 }).then((res: any) => {
            if (res.code === ApiRcm.C_OK) {
                dispatch({ loadingRcms: false, rcms: res.data.rows || [] });
            } else {
                message.error(res.msg);
                dispatch({ loadingRcms: false });
            }
        });
    }
};

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const buildDealTextFromRcms = (codes: string[]) => {
        const selectedOptions = (codes || [])
            .map((code) => data.rcms.find((item: any) => item.code === code))
            .filter((item: any) => !!item);
        return selectedOptions
            .map((item: any) => (item.description || "").trim())
            .filter((text: string) => text !== "")
            .join("\n");
    };

    const doEdit = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            const fn_request = data.dlgType === DlgTypes.edit ? Api.update_haz : Api.add_haz;
            const rcms = (values.rcms || []).join(",");
            fn_request({ ...values, rcms }).then((res: any) => {
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
                Api.get_haz({ id: data.targetRow.id }).then((res: any) => {
                    if (res.code === Api.C_OK) {
                        const targetRow = res.data;
                        const rcms = (targetRow.rcms || "").split(",") || [];
                        editForm.setFieldsValue({ ...targetRow, rcms });
                        dispatch({ loading: false, targetRow });
                    } else {
                        message.error(res.msg);
                        dispatch({ loading: false });
                    }
                });
            }
        }
        doSearchRcms(data, dispatch);
    }, [data.dlgType, data.targetRow.id]);

    return (
        <Modal
            width={"70%"}
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
                    <Row gutter={24}>
                        <Col span={12}>
                            <Form.Item
                                label={ts("haz.code")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("haz.code") }) }]}
                                name="code">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item
                                label={ts("haz.source")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("haz.source") }) }]}
                                name="source">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item
                                label={ts("haz.event")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("haz.event") }) }]}
                                name="event">
                                <Input.TextArea allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item
                                label={ts("haz.situation")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("haz.situation") }) }]}
                                name="situation">
                                <Input.TextArea allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item
                                label={ts("haz.damage")}
                                rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("haz.damage") }) }]}
                                name="damage">
                                <Input.TextArea allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={8}>
                            <Form.Item label={ts("haz.init_rate")} name="init_rate">
                                <Select allowClear options={HAZ_RATES} />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item label={ts("haz.init_degree")} name="init_degree">
                                <Select allowClear options={HAZ_DEGREES} />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item label={ts("haz.init_level")} name="init_level">
                                <Select allowClear options={HAZ_LEVELS} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("haz.deal")} name="deal">
                                <Input.TextArea allowClear rows={3} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("haz.rcms")} name="rcms">
                                <Select
                                    showSearch
                                    style={{ minWidth: "300px" }}
                                    tagRender={(item: any) => {
                                        return <Tag color="blue">{item.value}</Tag>;
                                    }}
                                    mode="multiple"
                                    options={data.rcms.map((item: any) => ({ label: item.description, value: item.code }))}
                                    value={(data.targetEdit.rcms || "").split(",").filter((item: any) => item !== "")}
                                    onChange={(values: any) => {
                                        const selectedCodes = (values || []) as string[];
                                        const dealText = buildDealTextFromRcms(selectedCodes);
                                        editForm.setFieldValue("deal", dealText);
                                        dispatch({
                                            targetEdit: {
                                                ...data.targetEdit,
                                                rcms: selectedCodes.join(","),
                                                deal: dealText,
                                            }
                                        });
                                    }}
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("haz.evidence")} name="evidence">
                                <Input.TextArea allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={8}>
                            <Form.Item label={ts("haz.cur_rate")} name="cur_rate">
                                <Select allowClear options={HAZ_RATES} />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item label={ts("haz.cur_degree")} name="cur_degree">
                                <Select allowClear options={HAZ_DEGREES} />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item label={ts("haz.cur_level")} name="cur_level">
                                <Select allowClear options={HAZ_LEVELS} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={12}>
                            <Form.Item normalize={(value) => (value ? 1 : 0)} label={ts("haz.benefit_yn")} name="benefit_flag">
                                <Switch />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item label={ts("haz.category")} name="category">
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
        rcms: [],
        targetEdit: {},
        selectedRowKeys: [],
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_haz({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_haz({ id: data.targetRow.id }).then((res: any) => {
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
                        const res: any = await Api.delete_haz({ id });
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

    const renderRiskTip = (
        row: any,
        rateKey: "init_rate" | "cur_rate",
        degreeKey: "init_degree" | "cur_degree",
        levelKey: "init_level" | "cur_level"
    ) => {
        const rateTxt = HAZDICT_RATES[row[rateKey]] ?? "";
        const degreeTxt = HAZDICT_DEGREES[row[degreeKey]] ?? "";
        const levelTxt = HAZDICT_LEVELS[row[levelKey]] ?? "";
        return (
            <Tooltip
                title={
                    <div className="tip">
                        <div>概率：{rateTxt}</div>
                        <div>程度：{degreeTxt}</div>
                        <div>危险水平：{levelTxt}</div>
                    </div>
                }>
                <div>
                    <div>概率：{rateTxt}</div>
                    <div>程度：{degreeTxt}</div>
                    <div>危险水平：{levelTxt}</div>
                </div>
            </Tooltip>
        );
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
            render: (value: any) => renderOneLineWithTooltip(value, { emptyText: "" }),
        },
        {
            title: ts("haz.event"),
            dataIndex: "event",
            render: (value: any) => renderOneLineWithTooltip(value, { emptyText: "" }),
        },
        {
            title: ts("haz.situation"),
            dataIndex: "situation",
            render: (value: any) => renderOneLineWithTooltip(value, { emptyText: "" }),
        },
        {
            title: ts("haz.damage"),
            dataIndex: "damage",
            render: (value: any) => renderOneLineWithTooltip(value, { emptyText: "" }),
        },
        {
            title: ts("haz.init_risk"),
            width: 180,
            onHeaderCell: () => ({ style: { minWidth: 150 } }),
            onCell: () => ({ style: { minWidth: 150 } }),
            render: (_value: any, row: any) => {
                return renderRiskTip(row, "init_rate", "init_degree", "init_level");
            },
        },
        {
            title: ts("haz.deal"),
            dataIndex: "deal",
            render: (value: any) => renderOneLineWithTooltip(value, { emptyText: "" }),
        },
        {
            title: ts("haz.rcms"),
            dataIndex: "rcms",
            render: (value: any) => renderOneLineWithTooltip(value, { emptyText: "" }),
        },
        {
            title: ts("haz.evidence"),
            dataIndex: "evidence",
            render: (value: any) => renderOneLineWithTooltip(value, { emptyText: "" }),
        },
        {
            title: ts("haz.cur_risk"),
            width: 180,
            onHeaderCell: () => ({ style: { minWidth: 150 } }),
            onCell: () => ({ style: { minWidth: 150 } }),
            dataIndex: "cur_rate",
            render: (_value: any, row: any) => {
                return renderRiskTip(row, "cur_rate", "cur_degree", "cur_level");
            },
        },
        {
            title: ts("haz.benefit_flag"),
            dataIndex: "benefit_flag",
            width: 150,
            onHeaderCell: () => ({ style: { minWidth: 150 } }),
            onCell: () => ({ style: { minWidth: 150 } }),
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
            title: ts("action"),
            width: 140,
            fixed: "right" as const,
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
        <div className="page div-v haz">
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
                    <Upload
                        showUploadList={false}
                        accept=".xlsx"
                        beforeUpload={(file) => {
                            Api.import_hazs({ file }).then((res: any) => {
                                if (res.code === Api.C_OK) {
                                    message.success(res.msg);
                                    doSearch(queryForm.getFieldsValue(), 1, data.pageSize);
                                } else {
                                    message.error(res.msg);
                                }
                            });
                            return false;
                        }}>
                        <Button type="primary" icon={<UploadOutlined />}>导入</Button>
                    </Upload>
                    <Button
                        type="primary"
                        loading={data.exporting}
                        onClick={() => {
                            dispatch({ exporting: true });
                            Api.export_hazs({ ...queryForm.getFieldsValue(), page_index: 0, page_size: 2000 }).then((res: any) => {
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
                rowSelection={{
                    selectedRowKeys: data.selectedRowKeys || [],
                    onChange: (keys: any) => dispatch({ selectedRowKeys: keys }),
                }}
                columns={columns}
                rowKey={(item: any) => item.id}
                dataSource={data.rows}
                loading={data.loading}
                scroll={{ x: 1800 }}
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
