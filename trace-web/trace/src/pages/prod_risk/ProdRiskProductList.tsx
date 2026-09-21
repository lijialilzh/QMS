import { Form, Button, Table, message, Row, Col, Modal, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as ApiProduct from "@/api/ApiProduct";
import { C_OK } from "@/api/http";
import "./ProdDhfs.less";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    delete = "delete",
}

const buildCountMap = (rows: any[] = []) => {
    const map = new Map<number, number>();
    rows.forEach((row) => {
        const pid = Number(row.prod_id || row.product_id);
        if (!pid) return;
        map.set(pid, (map.get(pid) || 0) + 1);
    });
    return map;
};

export default ({
    listApi,
    deleteApi,
    basePath,
    addTitle,
    hint,
    countLabel,
    itemLabel,
    MasterPicker,
    addItemsApi,
    idsParam,
    selectEmptyMsg,
}: {
    listApi: (params: any) => Promise<any>;
    deleteApi: (params: any) => Promise<any>;
    basePath: string;
    addTitle: string;
    hint: string;
    countLabel: string;
    itemLabel: string;
    MasterPicker: any;
    addItemsApi: (params: any) => Promise<any>;
    idsParam: string;
    selectEmptyMsg: string;
}) => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const [queryForm] = Form.useForm();
    const [addForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        loading: false,
        products: [],
        countMap: new Map<number, number>(),
        addProductId: undefined as number | undefined,
        addItemIds: [] as any[],
        adding: false,
        filterProductId: undefined as number | undefined,
        filterProductName: undefined as string | undefined,
        targetRow: {} as any,
        dlgType: null as string | null,
    });

    const loadCounts = () => {
        return listApi({ page_index: 0, page_size: 100000 }).then((res: any) => {
            if (res.code === C_OK) {
                const map = buildCountMap(res.data?.rows || []);
                dispatch({ countMap: map });
                return map;
            }
            if (res?.msg) message.error(res.msg);
            return data.countMap || new Map<number, number>();
        }).catch(() => data.countMap || new Map<number, number>());
    };

    const doSearch = (params: any, pageIndex: any, pageSize: any, countMap?: Map<number, number>) => {
        dispatch({ loading: true });
        const mapPromise = countMap ? Promise.resolve(countMap) : loadCounts();
        mapPromise.then((map) => {
            ApiProduct.list_product({ page_index: 0, page_size: 10000 }).then((res: any) => {
                if (res.code === ApiProduct.C_OK) {
                    const productRows = res.data.rows || [];
                    let allRows = productRows.filter((row: any) => (map.get(row.id) || 0) > 0);
                    const productId = params?.product_id;
                    const productName = params?.product_name;
                    if (productId) {
                        allRows = allRows.filter((row: any) => Number(row.id) === Number(productId));
                    } else if (productName) {
                        allRows = allRows.filter((row: any) => row.name === productName);
                    }
                    const total = allRows.length;
                    const start = (pageIndex - 1) * pageSize;
                    const rows = allRows.slice(start, start + pageSize);
                    dispatch({
                        loading: false,
                        pageIndex,
                        pageSize,
                        total,
                        rows,
                        products: productRows,
                        countMap: map,
                    });
                } else {
                    dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
                    message.error(res.msg);
                }
            }).catch(() => {
                dispatch({ loading: false });
                message.error("加载产品列表失败");
            });
        });
    };

    const openAddModal = () => {
        addForm.resetFields();
        dispatch({ dlgType: DlgTypes.add, addProductId: undefined, addItemIds: [], adding: false });
    };

    const doAddItems = () => {
        addForm.validateFields().then((values) => {
            const prodId = values.prod_id;
            if (!prodId) {
                message.warning(sprintf(ts("msg_select"), { label: ts("product.product") }));
                return;
            }
            const ids = data.addItemIds || [];
            if (!ids.length) {
                message.error(selectEmptyMsg);
                return;
            }
            dispatch({ adding: true });
            addItemsApi({ prod_id: prodId, [idsParam]: ids }).then((res: any) => {
                dispatch({ adding: false });
                if (res.code === C_OK) {
                    dispatch({ dlgType: null, addItemIds: [] });
                    message.success(res.msg || "新增成功");
                    navigate(`${basePath}/edit/${prodId}`);
                } else {
                    message.error(res.msg);
                }
            }).catch(() => {
                dispatch({ adding: false });
                message.error("新增失败");
            });
        });
    };

    const doDelete = () => {
        const row = data.targetRow || {};
        if (!row.id) return;
        dispatch({ loading: true });
        listApi({ prod_id: row.id, page_index: 0, page_size: 100000 }).then((res: any) => {
            const ids = ((res && res.data && res.data.rows) || []).map((r: any) => r.id).filter(Boolean);
            if (!ids.length) {
                dispatch({ loading: false, dlgType: null });
                doSearch({ product_id: data.filterProductId, product_name: data.filterProductName }, data.pageIndex, data.pageSize);
                return;
            }
            return deleteApi({ id: ids.join(",") }).then((del: any) => {
                dispatch({ loading: false });
                if (del.code === C_OK) {
                    dispatch({ dlgType: null });
                    message.success("删除成功");
                    doSearch({ product_id: data.filterProductId, product_name: data.filterProductName }, data.pageIndex, data.pageSize);
                } else {
                    message.error(del.msg);
                }
            });
        }).catch(() => {
            dispatch({ loading: false });
            message.error("删除失败");
        });
    };

    useEffect(() => {
        doSearch({}, data.pageIndex, data.pageSize);
        loadCounts();
    }, []);

    const columns = [
        {
            title: ts("product.name"),
            dataIndex: "name",
            width: "22%",
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.full_version"),
            dataIndex: "full_version",
            width: "14%",
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.release_version"),
            dataIndex: "release_version",
            width: "12%",
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: ts("product.type_code"),
            dataIndex: "type_code",
            width: "14%",
            ellipsis: true,
            render: (value: any) => renderOneLineWithTooltip(value),
        },
        {
            title: countLabel,
            dataIndex: "id",
            width: "10%",
            render: (_: any, row: any) => data.countMap.get(row.id) || 0,
        },
        {
            title: ts("action"),
            width: "28%",
            className: "prod-dhfs-list-action-col",
            onCell: () => ({ className: "prod-dhfs-list-action-col" }),
            render: (_: any, row: any) => (
                <Space size={4}>
                    <Button type="link" size="small" onClick={() => navigate(`${basePath}/view/${row.id}`)}>
                        {ts("view")}
                    </Button>
                    <Button type="link" size="small" onClick={() => navigate(`${basePath}/edit/${row.id}`)}>
                        {ts("edit")}
                    </Button>
                    <Button
                        type="link"
                        size="small"
                        danger
                        onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
                        {ts("delete")}
                    </Button>
                </Space>
            ),
        },
    ];

    return (
        <div className="page div-v">
            <div className="div-h searchbar list-searchbar-align">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={() => doSearch({ product_id: data.filterProductId, product_name: data.filterProductName }, 1, data.pageSize)}>
                    <Row gutter={20}>
                        <Col>
                            <Form.Item label={ts("srs_doc.select_product")}>
                                <ProductVersionSelect
                                    products={data.products}
                                    value={data.filterProductId}
                                    initialName={data.filterProductName}
                                    allowClear
                                    includeAll
                                    deferChangeUntilVersionSelect
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onNameChange={(name) => {
                                        dispatch({ filterProductName: name, filterProductId: undefined });
                                        doSearch({ product_id: undefined, product_name: name }, 1, data.pageSize);
                                    }}
                                    onChange={(value) => {
                                        dispatch({ filterProductId: value });
                                        doSearch({ product_id: value, product_name: data.filterProductName }, 1, data.pageSize);
                                    }}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
                <Button type="primary" onClick={openAddModal}>
                    {ts("add")}
                </Button>
            </div>
            <Table
                className="expand prod-dhfs-list-table"
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
                    doSearch({ product_id: data.filterProductId, product_name: data.filterProductName }, pager.current, pager.pageSize);
                }}
            />
            <Modal
                centered
                width="95%"
                wrapClassName="prod-risk-add-modal"
                title={addTitle}
                open={data.dlgType === DlgTypes.add}
                maskClosable={false}
                confirmLoading={data.adding}
                onOk={doAddItems}
                onCancel={() => dispatch({ dlgType: null, addItemIds: [], adding: false })}>
                <Form form={addForm} layout="vertical" style={{ marginBottom: 8 }}>
                    <Form.Item
                        label={ts("product.product")}
                        name="prod_id"
                        rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                        <ProductVersionSelect
                            products={data.products}
                            value={data.addProductId}
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.full_version")}
                            onChange={(value: any) => {
                                addForm.setFieldValue("prod_id", value);
                                dispatch({ addProductId: value });
                            }}
                        />
                    </Form.Item>
                    <div style={{ color: "#888", marginBottom: 8 }}>{hint}</div>
                </Form>
                <MasterPicker
                    embedded
                    isOpen={data.dlgType === DlgTypes.add}
                    prod_id={data.addProductId}
                    onIdsChange={(ids: any[]) => dispatch({ addItemIds: ids })}
                    onClose={() => {}}
                />
            </Modal>
            <Modal
                centered
                title={ts("action")}
                open={data.dlgType === DlgTypes.delete}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doDelete}
                onCancel={() => dispatch({ dlgType: null })}>
                <div>
                    确定删除产品「{data.targetRow?.name || "-"}」
                    {data.targetRow?.full_version ? `（${data.targetRow.full_version}）` : ""}
                    的全部{itemLabel}（共 {data.countMap.get(data.targetRow?.id) || 0} 条）吗？
                </div>
            </Modal>
        </div>
    );
};
