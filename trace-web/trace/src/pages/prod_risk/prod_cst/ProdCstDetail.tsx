import { Button, Table, message, Modal, Select, InputNumber, Tag, Space } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import ProdPrevNext from "@/pages/prod_risk/ProdPrevNext";
import * as Api from "@/api/ApiProdCst";
import * as ApiProduct from "@/api/ApiProduct";
import { doSearchRcms } from "../util";
import EditDlg from "./EditDlg";
import "./index.less";
import "../ProdDhfDetail.less";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    delete = "delete",
}

const ACCEPTS = ["可接受", "不可接受", "可忽略"];

export default ({ prodId: prodIdProp, readOnly: readOnlyProp, embedded, onChanged }: {
    prodId?: number;
    readOnly?: boolean;
    embedded?: boolean;
    onChanged?: () => void;
} = {}) => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const { prodId: prodIdParam } = useParams();
    const prodId = Number(prodIdProp ?? prodIdParam);
    const readOnly = readOnlyProp ?? location.pathname.includes("/view/");
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        targetRow: {},
        loading: false,
        products: [],
        targetEdit: {},
        editingField: null,
        rcms: [],
        selectedRowKeys: [],
    });

    const doSearch = (pageIndex: any, pageSize: any) => {
        if (!prodId) return;
        dispatch({ loading: true });
        Api.list_prod_cst({ prod_id: prodId, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
                doSearch(data.pageIndex, data.pageSize);
                onChanged?.();
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
                doSearch(data.pageIndex, data.pageSize);
            },
        });
    };

    // 点击单元格进入单字段编辑
    const startEdit = (row: any, field: string) => {
        if (readOnly) return;
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
        ...(!readOnly ? [{
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
        }] : []),
    ];

    useEffect(() => {
        if (!embedded) {
            ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
                if (res.code === ApiProduct.C_OK) dispatch({ products: res.data.rows || [] });
            });
        }
        doSearch(data.pageIndex, data.pageSize);
    }, [prodId]);

    return (
        <div className={embedded ? "risk-part-nested prod-risk-nested-wide prod-cst prod-dhf-detail-page" : "page div-v prod-cst prod-dhf-detail-page"}>
            <div className="div-h searchbar list-searchbar-align prod-dhf-detail-toolbar">
                {!embedded && (
                <Space align="center" className="prod-dhf-detail-header-left">
                    <div className="prod-dhf-product-select">
                        <ProductVersionSelect
                            products={data.products}
                            value={prodId}
                            allowClear={false}
                            deferChangeUntilVersionSelect
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.full_version")}
                            onChange={(value?: number) => {
                                if (!value || value === prodId) return;
                                navigate(`/prod_csts/${readOnly ? "view" : "edit"}/${value}`);
                            }}
                        />
                    </div>
                    <ProdPrevNext
                        products={data.products}
                        prodId={prodId}
                        onChange={(value) => navigate(`/prod_csts/${readOnly ? "view" : "edit"}/${value}`)}
                    />
                    <span className="prod-dhf-detail-title">{readOnly ? "查看" : "编辑"}产品 THREAT</span>
                    <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/prod_csts")}>
                        返回列表
                    </Button>
                </Space>
                )}
                {!readOnly && (
                    <div className="div-h hspace">
                        <Button
                            type="primary"
                            loading={data.exporting}
                            onClick={() => {
                                dispatch({ exporting: true });
                                Api.export_prod_csts({ prod_id: prodId, page_index: 0, page_size: 2000 }).then((res: any) => {
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
                )}
            </div>
            <Table
                className="expand prod-cst-table"
                rowSelection={readOnly ? undefined : {
                    selectedRowKeys: data.selectedRowKeys || [],
                    onChange: (keys: any) => dispatch({ selectedRowKeys: keys }),
                }}
                columns={columns}
                rowKey={(item: any) => item.id}
                dataSource={data.rows}
                loading={data.loading}
                sticky={!embedded}
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
                onChange={(pager) => {
                    doSearch(pager.current, pager.pageSize);
                }}
            />
            <Modal
                centered
                title={ts("action")}
                open={!readOnly && data.dlgType === DlgTypes.delete}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doDelete}
                onCancel={() => dispatch({ dlgType: null })}>
                <div>{ts("confirm_delete")}</div>
            </Modal>
            <EditDlg
                isOpen={!readOnly && data.dlgType === DlgTypes.add}
                onClose={(saved: boolean) => {
                    dispatch({ dlgType: null });
                    if (saved) {
                        doSearch(data.pageIndex, data.pageSize);
                        onChanged?.();
                    }
                }}
                prod_id={prodId}
            />
        </div>
    );
};
