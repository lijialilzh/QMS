import { Button, Table, message, Modal, Space } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import ProdPrevNext from "@/pages/prod_risk/ProdPrevNext";
import * as Api from "@/api/ApiProdRcm";
import * as ApiProduct from "@/api/ApiProduct";
import EditDlg from "./EditDlg";
import "./index.less";
import "../ProdDhfDetail.less";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    delete = "delete",
}

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
        selectedRowKeys: [],
    });

    const doSearch = (pageIndex: any, pageSize: any) => {
        if (!prodId) return;
        dispatch({ loading: true });
        Api.list_prod_rcm({ prod_id: prodId, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_prod_rcms({ id: data.targetRow.id }).then((res: any) => {
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
                        const res: any = await Api.delete_prod_rcms({ id });
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

    const renderCodeList = (value: any, className = "") => {
        const list = (Array.isArray(value) ? value : String(value || "").split(/[,，\n]/g))
            .map((item: any) => String(item || "").trim())
            .filter(Boolean);
        if (list.length === 0) return "";
        return (
            <div className={`prod-rcm-code-list ${className}`}>
                {list.map((item: string) => (
                    <div key={item} className="prod-rcm-code-line">{item}</div>
                ))}
            </div>
        );
    };

    const columns = [
        {
            title: ts("rcm.code"),
            dataIndex: "code",
            width: 90,
        },
        {
            title: ts("rcm.description"),
            dataIndex: "description",
            width: 260,
        },
        {
            title: ts("rcm.srs_flag"),
            dataIndex: "srs_flag",
            width: 110,
            render: (value: any) => {
                return value ? ts("yes") : ts("no");
            },
        },
        {
            title: ts("rcm.srs_codes"),
            dataIndex: "srs_codes",
            className: "prod-rcm-wrap-cell",
            width: 180,
            render: renderCodeList,
        },
        {
            title: ts("rcm.test_codes"),
            dataIndex: "test_codes",
            className: "prod-rcm-wrap-cell prod-rcm-test-cell",
            width: 280,
            render: (value: any) => renderCodeList(value, "prod-rcm-test-list"),
        },
        {
            title: ts("rcm.proof"),
            dataIndex: "proof",
            width: 96,
        },
        {
            title: ts("rcm.note"),
            dataIndex: "note",
            width: 70,
        },
        {
            title: ts("create_time"),
            dataIndex: "create_time",
            width: 160,
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
        <div className={embedded ? "risk-part-nested prod-risk-nested-wide prod-rcm prod-dhf-detail-page" : "page div-v prod-rcm prod-dhf-detail-page"}>
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
                                navigate(`/prod_rcms/${readOnly ? "view" : "edit"}/${value}`);
                            }}
                        />
                    </div>
                    <ProdPrevNext
                        products={data.products}
                        prodId={prodId}
                        onChange={(value) => navigate(`/prod_rcms/${readOnly ? "view" : "edit"}/${value}`)}
                    />
                    <span className="prod-dhf-detail-title">{readOnly ? "查看" : "编辑"}产品 RCM</span>
                    <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/prod_rcms")}>
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
                                Api.export_prod_rcms({ prod_id: prodId, page_index: 0, page_size: 2000 }).then((res: any) => {
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
                className="expand prod-rcm-table"
                rowSelection={readOnly ? undefined : {
                    selectedRowKeys: data.selectedRowKeys || [],
                    onChange: (keys: any) => dispatch({ selectedRowKeys: keys }),
                }}
                columns={columns}
                rowKey={(item: any) => item.id}
                dataSource={data.rows}
                loading={data.loading}
                tableLayout="fixed"
                sticky={!embedded}
                scroll={{ x: 1470, y: "68vh" }}
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
