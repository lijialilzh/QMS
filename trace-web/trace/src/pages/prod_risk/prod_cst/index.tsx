import { Form, Button, Table, message, Row, Col, Modal, Select, InputNumber, Tag, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdCst";
import { doSearchProducts, doSearchRcms } from "../util";
import EditDlg from "./EditDlg";
import "./index.less";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    delete = "delete",
}

const ACCEPTS = ["可接受", "不可接受", "可忽略"];

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
        Api.list_prod_cst({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_prod_csts({ id: data.targetRow.id }).then((res: any) => {
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
                        const res: any = await Api.delete_prod_csts({ id });
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

    // 点击单元格进入单字段编辑
    const startEdit = (row: any, field: string) => {
        if (data.targetEdit.id === row.id && data.editingField === field) return;
        dispatch({ targetEdit: { ...row }, editingField: field });
        if (field === "rcm_codes") doSearchRcms(row.prod_id, data, dispatch);
    };

    // 该格失焦时实时保存（保存后本地更新该行，避免整表刷新闪烁）
    const saveCell = (override?: any) => {
        const edit = { ...data.targetEdit, ...(override || {}) };
        if (!edit?.id || data.updating) return;
        dispatch({ updating: true });
        Api.update_prod_cst({ ...edit }).then((res: any) => {
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

    const isEditing = (row: any, field: string) => data.targetEdit.id === row.id && data.editingField === field;

    const clickToEdit = (row: any, field: string, value: any) => (
        <div style={{ cursor: "pointer", minHeight: 22 }} title="点击编辑" onClick={() => startEdit(row, field)}>
            {value !== null && value !== undefined && String(value) !== "" ? value : <span style={{ color: "#d9d9d9" }}>—</span>}
        </div>
    );

    const columns = [
        {
            title: ts("cst.code"),
            dataIndex: "code",
        },
        {
            title: ts("cst.category"),
            dataIndex: "category",
        },
        {
            title: ts("cst.description"),
            dataIndex: "description",
        },
        {
            title: ts("cst.prev_score"),
            dataIndex: "prev_score",
            render: (value: any, row: any) => {
                if (!isEditing(row, "prev_score")) return clickToEdit(row, "prev_score", value);
                return (
                    <InputNumber
                        autoFocus
                        value={data.targetEdit.prev_score}
                        onBlur={saveCell}
                        onPressEnter={saveCell}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, prev_score: v } })}
                    />
                );
            },
        },
        {
            title: ts("cst.prev_severity"),
            dataIndex: "prev_severity",
            render: (value: any, row: any) => {
                if (!isEditing(row, "prev_severity")) return clickToEdit(row, "prev_severity", value);
                return (
                    <InputNumber
                        autoFocus
                        value={data.targetEdit.prev_severity}
                        onBlur={saveCell}
                        onPressEnter={saveCell}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, prev_severity: v } })}
                    />
                );
            },
        },
        {
            title: ts("cst.prev_level"),
            dataIndex: "prev_level",
            render: (value: any, row: any) => {
                if (!isEditing(row, "prev_level")) return clickToEdit(row, "prev_level", value);
                return (
                    <InputNumber
                        autoFocus
                        value={data.targetEdit.prev_level}
                        onBlur={saveCell}
                        onPressEnter={saveCell}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, prev_level: v } })}
                    />
                );
            },
        },
        {
            title: ts("cst.prev_accept"),
            dataIndex: "prev_accept",
            render: (value: any, row: any) => {
                if (!isEditing(row, "prev_accept")) return clickToEdit(row, "prev_accept", value);
                return (
                    <Select
                        autoFocus
                        defaultOpen
                        allowClear
                        style={{ minWidth: "100px" }}
                        value={data.targetEdit.prev_accept}
                        options={ACCEPTS.map((item) => ({ label: item, value: item }))}
                        onChange={(v: any) => saveCell({ prev_accept: v || "" })}
                        onBlur={() => dispatch({ targetEdit: {}, editingField: null })}></Select>
                );
            },
        },
        {
            title: ts("cst.cur_score"),
            dataIndex: "cur_score",
            render: (value: any, row: any) => {
                if (!isEditing(row, "cur_score")) return clickToEdit(row, "cur_score", value);
                return (
                    <InputNumber
                        autoFocus
                        value={data.targetEdit.cur_score}
                        onBlur={saveCell}
                        onPressEnter={saveCell}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, cur_score: v } })}
                    />
                );
            },
        },
        {
            title: ts("cst.cur_severity"),
            dataIndex: "cur_severity",
            render: (value: any, row: any) => {
                if (!isEditing(row, "cur_severity")) return clickToEdit(row, "cur_severity", value);
                return (
                    <InputNumber
                        autoFocus
                        value={data.targetEdit.cur_severity}
                        onBlur={saveCell}
                        onPressEnter={saveCell}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, cur_severity: v } })}
                    />
                );
            },
        },
        {
            title: ts("cst.cur_level"),
            dataIndex: "cur_level",
            render: (value: any, row: any) => {
                if (!isEditing(row, "cur_level")) return clickToEdit(row, "cur_level", value);
                return (
                    <InputNumber
                        autoFocus
                        value={data.targetEdit.cur_level}
                        onBlur={saveCell}
                        onPressEnter={saveCell}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, cur_level: v } })}
                    />
                );
            },
        },
        {
            title: ts("cst.cur_accept"),
            dataIndex: "cur_accept",
            render: (value: any, row: any) => {
                if (!isEditing(row, "cur_accept")) return clickToEdit(row, "cur_accept", value);
                return (
                    <Select
                        autoFocus
                        defaultOpen
                        allowClear
                        style={{ minWidth: "100px" }}
                        value={data.targetEdit.cur_accept}
                        options={ACCEPTS.map((item) => ({ label: item, value: item }))}
                        onChange={(v: any) => saveCell({ cur_accept: v || "" })}
                        onBlur={() => dispatch({ targetEdit: {}, editingField: null })}></Select>
                );
            },
        },
        {
            title: ts("cst.rcm_codes"),
            dataIndex: "rcm_codes",
            render: (value: any, row: any) => {
                if (!isEditing(row, "rcm_codes")) return clickToEdit(row, "rcm_codes", value);
                return (
                    <Select
                        autoFocus
                        defaultOpen
                        showSearch
                        style={{ minWidth: "300px" }}
                        tagRender={(item: any) => {
                            return <Tag color="blue">{item.value}</Tag>;
                        }}
                        mode="multiple"
                        options={data.rcms.map((item: any) => ({ label: item.description, value: item.code }))}
                        value={(data.targetEdit.rcm_codes || "").split(",").filter((item: any) => item !== "")}
                        onChange={(values: any) => {
                            dispatch({ targetEdit: { ...data.targetEdit, rcm_codes: values.join(",") } });
                        }}
                        onBlur={() => saveCell()}
                    />
                );
            },
        },
        {
            title: ts("action"),
            width: 90,
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
        <div className="page div-v prod-cst">
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
                            Api.export_prod_csts({ ...queryForm.getFieldsValue(), page_index: 0, page_size: 2000 }).then((res: any) => {
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
                className="expand prod-cst-table"
                rowSelection={{
                    selectedRowKeys: data.selectedRowKeys || [],
                    onChange: (keys: any) => dispatch({ selectedRowKeys: keys }),
                }}
                columns={columns}
                rowKey={(item: any) => item.id}
                dataSource={data.rows}
                loading={data.loading}
                sticky
                scroll={{ x: 1600, y: "68vh" }}
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
