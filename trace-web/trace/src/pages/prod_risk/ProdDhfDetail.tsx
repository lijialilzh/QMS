import { Form, Input, Button, Table, message, Modal, Upload, Space, Tooltip, Popconfirm } from "antd";
import { UploadOutlined, ArrowLeftOutlined, PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdDhf";
import * as ApiProduct from "@/api/ApiProduct";
import "./ProdDhfDetail.less";

const pageSizeOptions = [20, 50, 100];

const mergeProductRows = (rows: any[] = [], extra?: any) => {
    const map = new Map<number, any>();
    rows.forEach((row) => {
        if (row?.id) map.set(Number(row.id), row);
    });
    if (extra?.id) map.set(Number(extra.id), extra);
    return Array.from(map.values());
};

enum DlgTypes {
    add = "add",
    import = "import",
}

type EditField = "code" | "name";

const AddDlg = ({ prodId, data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const doAdd = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            Api.add_prod_dhf({ ...values, prod_id: prodId }).then((res: any) => {
                if (res.code === Api.C_OK) {
                    onSaved();
                    dispatch({ loading: false, dlgType: null });
                    message.success(res.msg);
                    editForm.resetFields();
                } else {
                    dispatch({ loading: false });
                    message.error(res.msg);
                }
            });
        });
    };

    useEffect(() => {
        if (data.dlgType === DlgTypes.add) {
            editForm.resetFields();
            editForm.setFieldValue("prod_id", prodId);
        }
    }, [data.dlgType, prodId]);

    return (
        <Modal
            width={"50%"}
            centered
            title={ts("add")}
            open={data.dlgType === DlgTypes.add}
            maskClosable={false}
            confirmLoading={data.loading}
            onOk={doAdd}
            onCancel={() => dispatch({ dlgType: null })}>
            <Form form={editForm} className="expand">
                <Form.Item hidden name="prod_id">
                    <Input />
                </Form.Item>
                <Form.Item
                    label={ts("prod_dhf.code")}
                    rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("prod_dhf.code") }) }]}
                    name="code">
                    <Input allowClear />
                </Form.Item>
                <Form.Item
                    label={ts("prod_dhf.name")}
                    rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("prod_dhf.name") }) }]}
                    name="name">
                    <Input allowClear />
                </Form.Item>
            </Form>
        </Modal>
    );
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const { prodId: prodIdParam } = useParams();
    const prodId = Number(prodIdParam);
    const readOnly = location.pathname.includes("/view/");

    const [importForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        targetRow: {},
        loading: false,
        products: [] as any[],
        productsLoading: false,
        selectedRowKeys: [],
        importFiles: [],
        exporting: false,
        editingCell: null as { id: number; field: EditField } | null,
        editingValue: "",
        savingCellKey: "",
    });

    const loadProducts = (currentProdId?: number) => {
        dispatch({ productsLoading: true });
        const requests: Promise<any>[] = [
            ApiProduct.list_product({ page_size: 10000 }),
        ];
        if (currentProdId) {
            requests.push(ApiProduct.get_product({ id: currentProdId }));
        }
        Promise.all(requests).then(([listRes, getRes]) => {
            let products: any[] = [];
            if (listRes?.code === ApiProduct.C_OK) {
                products = listRes.data?.rows || [];
            }
            if (getRes?.code === ApiProduct.C_OK) {
                products = mergeProductRows(products, getRes.data);
            } else if (listRes?.code !== ApiProduct.C_OK) {
                message.error(listRes?.msg || "加载产品列表失败");
            }
            dispatch({ products, productsLoading: false });
        }).catch(() => {
            dispatch({ productsLoading: false });
            message.error("加载产品列表失败");
        });
    };

    const handleProductChange = (value?: number) => {
        if (!value || value === prodId) return;
        const mode = readOnly ? "view" : "edit";
        navigate(`/prod_dhfs/${mode}/${value}`);
    };

    const doSearch = (pageIndex: any, pageSize: any) => {
        if (!prodId) return;
        dispatch({ loading: true });
        Api.list_prod_dhf({ prod_id: prodId, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, pageIndex, pageSize, total: res.data.total, rows: res.data.rows });
            } else {
                dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
                message.error(res.msg);
            }
        });
    };

    const handleStartEdit = (row: any, field: EditField) => {
        if (readOnly) return;
        if (data.editingCell?.id === row.id && data.editingCell?.field === field) return;
        dispatch({
            editingCell: { id: row.id, field },
            editingValue: row[field] || "",
        });
    };

    const isCellEditing = (row: any, field: EditField) => (
        data.editingCell?.id === row.id && data.editingCell?.field === field
    );

    const handleSaveCell = async (row: any, field: EditField) => {
        if (readOnly) return;
        if (!isCellEditing(row, field)) return;
        const cellKey = `${row.id}-${field}`;
        if (data.savingCellKey === cellKey) return;

        const nextValue = String(data.editingValue || "").trim();
        const currentValue = String(row[field] || "").trim();
        if (nextValue === currentValue) {
            dispatch({ editingCell: null, editingValue: "" });
            return;
        }
        if (!nextValue) {
            message.warning(sprintf(ts("msg_input"), { label: field === "code" ? ts("prod_dhf.code") : ts("prod_dhf.name") }));
            return;
        }

        const nextCode = field === "code" ? nextValue : String(row.code || "").trim();
        const nextName = field === "name" ? nextValue : String(row.name || "").trim();
        dispatch({ savingCellKey: cellKey });
        try {
            const res: any = await Api.update_prod_dhf({
                id: row.id,
                prod_id: prodId,
                code: nextCode,
                name: nextName,
            });
            if (res.code === Api.C_OK) {
                const rows = (data.rows || []).map((item: any) => (
                    item.id === row.id ? { ...item, code: nextCode, name: nextName } : item
                ));
                dispatch({ rows, editingCell: null, editingValue: "", savingCellKey: "" });
            } else {
                dispatch({ savingCellKey: "" });
                message.error(res.msg || "保存失败");
            }
        } catch (_err) {
            dispatch({ savingCellKey: "" });
            message.error("保存失败");
        }
    };

    const renderEditableCell = (field: EditField, value: string, row: any) => {
        const displayValue = value || "-";
        if (readOnly) {
            return <span className="prod-dhf-cell-text is-readonly">{displayValue}</span>;
        }
        const isEditing = isCellEditing(row, field);
        const isSaving = data.savingCellKey === `${row.id}-${field}`;
        if (!isEditing) {
            return (
                <span
                    className="prod-dhf-cell-text"
                    onClick={() => handleStartEdit(row, field)}>
                    {displayValue}
                </span>
            );
        }
        return (
            <div className="prod-dhf-inline-cell is-editing">
                <Input
                    size="small"
                    autoFocus
                    disabled={isSaving}
                    className="prod-dhf-inline-cell-input"
                    value={data.editingValue}
                    onChange={(e) => dispatch({ editingValue: e.target.value })}
                    onBlur={() => handleSaveCell(row, field)}
                    onPressEnter={(e) => {
                        e.preventDefault();
                        handleSaveCell(row, field);
                        (e.target as HTMLInputElement).blur();
                    }}
                />
            </div>
        );
    };

    const doDeleteRow = (row: any) => {
        dispatch({ loading: true });
        Api.delete_prod_dhf({ id: row.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false });
                message.success(res.msg);
                doSearch(data.pageIndex, data.pageSize);
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    };

    const doBatchDelete = () => {
        const ids = data.selectedRowKeys || [];
        if (ids.length === 0) {
            message.warning(ts("please_select_items"));
            return;
        }
        dispatch({ loading: true });
        Api.delete_prod_dhfs({ ids }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, selectedRowKeys: [] });
                message.success(res.msg);
                doSearch(data.pageIndex, data.pageSize);
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    };

    const doImport = () => {
        const file = (data.importFiles || [])[0];
        if (!file) {
            message.warning(ts("select_file"));
            return;
        }
        dispatch({ loading: true });
        Api.import_prod_dhfs({ prod_id: prodId, file }).then((res: any) => {
            dispatch({ loading: false });
            if (res.code === Api.C_OK) {
                message.success(res.msg);
                dispatch({ dlgType: null, importFiles: [] });
                importForm.resetFields();
                doSearch(1, data.pageSize);
            } else {
                message.error(res.msg);
            }
        });
    };

    useEffect(() => {
        if (!prodId) {
            message.error("无效的产品 ID");
            navigate("/prod_dhfs");
            return;
        }
        loadProducts(prodId);
        dispatch({
            selectedRowKeys: [],
            editingCell: null,
            editingValue: "",
            pageIndex: 1,
        });
        doSearch(1, data.pageSize);
    }, [prodId, location.pathname]);

    const renderRowActions = (_row: any) => (
        <Space size={0} className="prod-dhf-row-actions">
            <Tooltip title={ts("add")}>
                <Button
                    type="text"
                    size="small"
                    className="prod-dhf-action-btn"
                    icon={<PlusOutlined />}
                    onClick={() => dispatch({ dlgType: DlgTypes.add, targetRow: {} })}
                />
            </Tooltip>
            <Popconfirm title={ts("confirm_delete")} onConfirm={() => doDeleteRow(_row)}>
                <Button
                    type="text"
                    size="small"
                    danger
                    className="prod-dhf-action-btn"
                    icon={<DeleteOutlined />}
                    title={ts("delete")}
                />
            </Popconfirm>
        </Space>
    );

    const columns = [
        {
            title: ts("prod_dhf.code"),
            dataIndex: "code",
            width: "36%",
            ellipsis: true,
            render: (value: string, row: any) => renderEditableCell("code", value, row),
        },
        {
            title: ts("prod_dhf.name"),
            dataIndex: "name",
            ellipsis: true,
            render: (value: string, row: any) => renderEditableCell("name", value, row),
        },
        ...(!readOnly ? [{
            title: ts("action"),
            width: 96,
            align: "center" as const,
            className: "prod-dhf-action-col",
            onCell: () => ({ className: "prod-dhf-action-col" }),
            render: (_value: any, row: any) => renderRowActions(row),
        }] : []),
    ];

    return (
        <div className="page div-v prod-dhf-detail-page">
            <div className="div-h searchbar list-searchbar-align prod-dhf-detail-toolbar">
                <Space align="center" className="prod-dhf-detail-header-left">
                    <div className="prod-dhf-product-select">
                        <ProductVersionSelect
                            products={data.products}
                            value={prodId}
                            allowClear={false}
                            deferChangeUntilVersionSelect
                            disabled={data.productsLoading}
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.full_version")}
                            onChange={handleProductChange}
                        />
                    </div>
                    <span className="prod-dhf-detail-title">{readOnly ? "查看" : "编辑"}产品 DHF</span>
                    <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/prod_dhfs")}>
                        返回列表
                    </Button>
                </Space>
                <div className="div-h hspace">
                    {!readOnly && (
                        <>
                            <Button type="primary" icon={<UploadOutlined />} onClick={() => dispatch({ dlgType: DlgTypes.import, importFiles: [] })}>
                                导入
                            </Button>
                            <Button disabled={!(data.selectedRowKeys || []).length} danger onClick={doBatchDelete}>
                                {ts("batch_delete")}
                            </Button>
                        </>
                    )}
                    <Button
                        type="primary"
                        loading={data.exporting}
                        onClick={() => {
                            dispatch({ exporting: true });
                            Api.export_prod_dhfs({ prod_id: prodId, page_index: 0, page_size: 2000 }).then((res: any) => {
                                dispatch({ exporting: false });
                                if (res.code !== Api.C_OK) {
                                    message.error(res.msg);
                                }
                            });
                        }}>
                        {ts("export")}
                    </Button>
                </div>
            </div>
            <Table
                className="expand prod-dhf-detail-table"
                tableLayout="fixed"
                size="small"
                rowSelection={readOnly ? undefined : {
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
                        dispatch({ pageIndex: page, pageSize });
                    },
                    showTotal: (total: number) => sprintf(ts("total_items"), { total }),
                }}
                onChange={(pager) => {
                    dispatch({ editingCell: null, editingValue: "" });
                    doSearch(pager.current, pager.pageSize);
                }}
            />
            <Modal
                centered
                width={640}
                title="导入DHF"
                open={!readOnly && data.dlgType === DlgTypes.import}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doImport}
                onCancel={() => {
                    dispatch({ dlgType: null, importFiles: [] });
                    importForm.resetFields();
                }}>
                <Form form={importForm} layout="vertical">
                    <Form.Item label="Excel文件" required>
                        <Upload
                            maxCount={1}
                            accept=".xlsx"
                            fileList={data.importFiles}
                            onRemove={() => dispatch({ importFiles: [] })}
                            beforeUpload={(file) => {
                                dispatch({ importFiles: [file] });
                                return false;
                            }}>
                            <Button icon={<UploadOutlined />}>{ts("select_file")}</Button>
                        </Upload>
                    </Form.Item>
                </Form>
            </Modal>
            <AddDlg
                prodId={prodId}
                data={data}
                dispatch={dispatch}
                onSaved={() => doSearch(data.pageIndex, data.pageSize)}
            />
        </div>
    );
};
