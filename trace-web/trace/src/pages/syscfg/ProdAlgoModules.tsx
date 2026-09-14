import { Button, Table, message, Row, Col, Space, Input, Modal } from "antd";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdAlgoModule";
import * as ApiProduct from "@/api/ApiProduct";

const DEFAULT_MODULES = ["肺栓塞分割", "肺叶分割"];

export default () => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        rows: [],
        loading: false,
        products: [],
        targetProdId: null,
        targetEdit: {},
        editingField: null,
        updating: false,
    });

    const loadProducts = () => {
        ApiProduct.list_product({ page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) {
                dispatch({ products: res.data.rows || [] });
            }
        });
    };

    const loadModules = (prodId: any, allowSeed = true) => {
        if (!prodId) {
            dispatch({ rows: [] });
            return;
        }
        dispatch({ loading: true });
        Api.list_prod_algo_module({ prod_id: prodId, page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false, rows: [] });
                message.error(res.msg);
                return;
            }
            const rows = res.data.rows || [];
            if (allowSeed && !rows.length && DEFAULT_MODULES.length) {
                const jobs = DEFAULT_MODULES.map((name, i) =>
                    Api.add_prod_algo_module({ prod_id: prodId, name, sort_order: i + 1 })
                );
                Promise.all(jobs).then(() => loadModules(prodId, false)).catch(() => {
                    dispatch({ loading: false, rows });
                });
                return;
            }
            dispatch({ loading: false, rows });
        });
    };

    const doAdd = () => {
        if (!data.targetProdId) {
            message.warning("请先选择产品");
            return;
        }
        const maxSort = (data.rows || []).reduce((m: number, r: any) => Math.max(m, r.sort_order || 0), 0);
        Api.add_prod_algo_module({
            prod_id: data.targetProdId,
            name: "",
            sort_order: maxSort + 1,
        }).then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success(res.msg || ts("msg_ok"));
                loadModules(data.targetProdId, false);
            } else {
                message.error(res.msg);
            }
        });
    };

    const doDelete = (row: any) => {
        Modal.confirm({
            title: ts("action"),
            content: ts("confirm_delete"),
            onOk: () => {
                Api.delete_prod_algo_modules({ id: row.id }).then((res: any) => {
                    if (res.code === Api.C_OK) {
                        message.success(res.msg);
                        loadModules(data.targetProdId, false);
                    } else {
                        message.error(res.msg);
                    }
                });
            },
        });
    };

    const startEdit = (row: any, field: string) => {
        if (data.targetEdit.id === row.id && data.editingField === field) return;
        dispatch({ targetEdit: { ...row }, editingField: field });
    };

    const saveCell = () => {
        const edit = { ...data.targetEdit };
        if (!edit?.id || data.updating) return;
        dispatch({ updating: true });
        Api.update_prod_algo_module({ ...edit }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const rows = (data.rows || []).map((r: any) => (r.id === edit.id ? { ...r, ...edit } : r));
                dispatch({ updating: false, targetEdit: {}, editingField: null, rows });
                message.success(res.msg || ts("msg_ok"));
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
            title: "序号",
            dataIndex: "sort_order",
            width: 80,
            render: (_value: any, _row: any, index: number) => index + 1,
        },
        {
            title: "模块",
            dataIndex: "name",
            render: (value: any, row: any) => {
                if (!isEditing(row, "name")) return clickToEdit(row, "name", value);
                return (
                    <Input
                        autoFocus
                        value={data.targetEdit.name}
                        onChange={(e: any) => dispatch({ targetEdit: { ...data.targetEdit, name: e.target.value } })}
                        onBlur={() => saveCell()}
                        onPressEnter={() => saveCell()}
                    />
                );
            },
        },
        {
            title: ts("action"),
            width: 90,
            render: (_value: any, row: any) => (
                <Space>
                    <Button type="link" danger onClick={() => doDelete(row)}>
                        {ts("delete")}
                    </Button>
                </Space>
            ),
        },
    ];

    useEffect(() => {
        loadProducts();
    }, []);

    return (
        <div className="page div-v">
            <div className="div-h searchbar list-searchbar-align">
                <Row gutter={10} className="expand">
                    <Col>
                        <Space>
                            <span>{ts("srs_doc.select_product")}：</span>
                            <div style={{ minWidth: 360 }}>
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    value={data.targetProdId}
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.version")}
                                    onChange={(v: any) => {
                                        dispatch({ targetProdId: v ?? null, targetEdit: {}, editingField: null });
                                        loadModules(v ?? null, true);
                                    }}
                                />
                            </div>
                        </Space>
                    </Col>
                </Row>
                <div className="div-h hspace">
                    <Button disabled={!data.targetProdId} onClick={doAdd}>
                        {ts("add")}
                    </Button>
                </div>
            </div>
            <Table
                className="expand"
                columns={columns}
                rowKey={(item: any) => item.id}
                dataSource={data.rows}
                loading={data.loading}
                pagination={false}
                footer={() => sprintf(ts("total_items"), { total: (data.rows || []).length })}
            />
        </div>
    );
};
