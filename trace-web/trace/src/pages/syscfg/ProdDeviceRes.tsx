import { Form, Button, Table, message, Row, Col, Modal, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdDeviceRes";
import * as ApiProduct from "@/api/ApiProduct";
import ProdDeviceResDetail from "./ProdDeviceResDetail";
import "../risk_mgmt/RiskMgmtParticipants.less";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    delete = "delete",
}

export default () => {
    const { t: ts } = useTranslation();
    const [queryForm] = Form.useForm();
    const [addForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        loading: false,
        products: [],
        extraMap: new Map<number, any>(),
        addProductId: undefined as number | undefined,
        filterProductId: undefined as number | undefined,
        filterProductName: undefined as string | undefined,
        targetRow: {} as any,
        dlgType: null as string | null,
        expandedKeys: [] as number[],
    });

    const loadSaved = (products: any[]) => {
        return Promise.all((products || []).map((p: any) =>
            Api.get_prod_device_res({ prod_id: p.id }).then((res: any) => {
                if (res && res.code === Api.C_OK && res.data && res.data.id) {
                    return { id: p.id, count: ((res.data.items || []).length) };
                }
                return null;
            }).catch(() => null)
        )).then((items) => {
            const extraMap = new Map<number, any>();
            items.filter(Boolean).forEach((it: any) => extraMap.set(it.id, it));
            dispatch({ extraMap });
            return extraMap;
        });
    };

    const doSearch = (params: any, pageIndex: any, pageSize: any, extraMap?: Map<number, any>) => {
        dispatch({ loading: true });
        ApiProduct.list_product({ page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code !== ApiProduct.C_OK) {
                dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
                message.error(res.msg);
                return;
            }
            const productRows = res.data.rows || [];
            const mapPromise = extraMap ? Promise.resolve(extraMap) : loadSaved(productRows);
            mapPromise.then((map) => {
                let allRows = productRows.filter((row: any) => map.has(row.id));
                const productId = params?.product_id;
                const productName = params?.product_name;
                if (productId) {
                    allRows = allRows.filter((row: any) => Number(row.id) === Number(productId));
                } else if (productName) {
                    allRows = allRows.filter((row: any) => row.name === productName);
                }
                const total = allRows.length;
                const start = (pageIndex - 1) * pageSize;
                dispatch({
                    loading: false,
                    pageIndex,
                    pageSize,
                    total,
                    rows: allRows.slice(start, start + pageSize),
                    products: productRows,
                    extraMap: map,
                });
            });
        }).catch(() => {
            dispatch({ loading: false });
            message.error("加载产品列表失败");
        });
    };

    const toggleExpand = (prodId: number) => {
        if (!prodId) return;
        const keys = data.expandedKeys || [];
        dispatch({ expandedKeys: keys.includes(prodId) ? [] : [prodId] });
    };

    const refreshAfterChange = () => {
        doSearch({ product_id: data.filterProductId, product_name: data.filterProductName }, data.pageIndex, data.pageSize);
    };

    const doAddNavigate = () => {
        addForm.validateFields().then((values) => {
            const prodId = values.prod_id;
            if (!prodId) {
                message.warning(sprintf(ts("msg_select"), { label: ts("product.product") }));
                return;
            }
            const extraMap = new Map(data.extraMap || []);
            if (!extraMap.has(prodId)) extraMap.set(prodId, { id: prodId, count: 0 });
            dispatch({ dlgType: null, expandedKeys: [prodId], extraMap });
            message.success("新增成功");
            doSearch({ product_id: data.filterProductId, product_name: data.filterProductName }, 1, data.pageSize, extraMap);
        });
    };

    const doDelete = () => {
        const row = data.targetRow || {};
        if (!row.id) return;
        dispatch({ loading: true });
        Api.delete_prod_device_res({ prod_id: row.id }).then((res: any) => {
            dispatch({ loading: false });
            if (res.code === Api.C_OK) {
                dispatch({
                    dlgType: null,
                    expandedKeys: (data.expandedKeys || []).filter((id: number) => id !== row.id),
                });
                message.success("删除成功");
                doSearch({ product_id: data.filterProductId, product_name: data.filterProductName }, data.pageIndex, data.pageSize);
            } else {
                message.error(res.msg);
            }
        }).catch(() => {
            dispatch({ loading: false });
            message.error("删除失败");
        });
    };

    useEffect(() => {
        doSearch({}, data.pageIndex, data.pageSize);
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
            title: "条目数",
            dataIndex: "id",
            width: "10%",
            render: (_: any, row: any) => data.extraMap.get(row.id)?.count || 0,
        },
        {
            title: ts("action"),
            width: 140,
            className: "risk-part-list-action-col",
            onCell: () => ({ className: "risk-part-list-action-col" }),
            render: (_: any, row: any) => (
                <Space size={4} className="risk-part-list-row-actions" onClick={(e) => e.stopPropagation()}>
                    <Button type="link" size="small" onClick={() => toggleExpand(row.id)}>
                        {(data.expandedKeys || []).includes(row.id) ? "收起" : ts("edit")}
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
                    onFinish={() => doSearch({ product_id: data.filterProductId, product_name: data.filterProductName }, 1, data.pageSize, data.extraMap)}>
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
                                        doSearch({ product_id: undefined, product_name: name }, 1, data.pageSize, data.extraMap);
                                    }}
                                    onChange={(value) => {
                                        dispatch({ filterProductId: value });
                                        doSearch({ product_id: value, product_name: data.filterProductName }, 1, data.pageSize, data.extraMap);
                                    }}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
                <Button type="primary" onClick={() => { addForm.resetFields(); dispatch({ dlgType: DlgTypes.add, addProductId: undefined }); }}>
                    {ts("add")}
                </Button>
            </div>
            <Table
                className="expand risk-part-list-table"
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
                    onShowSizeChange: (page, pageSize) => dispatch({ pageIndex: page, pageSize }),
                    showTotal: (total: number) => sprintf(ts("total_items"), { total }),
                }}
                onChange={(pager) => {
                    doSearch({ product_id: data.filterProductId, product_name: data.filterProductName }, pager.current, pager.pageSize, data.extraMap);
                }}
                expandable={{
                    expandedRowKeys: data.expandedKeys || [],
                    showExpandColumn: false,
                    expandedRowRender: (row) => (
                        <ProdDeviceResDetail prodId={row.id} onChanged={refreshAfterChange} />
                    ),
                }}
            />
            <Modal
                centered
                width={520}
                title="新增设备资源"
                open={data.dlgType === DlgTypes.add}
                maskClosable={false}
                onOk={doAddNavigate}
                onCancel={() => dispatch({ dlgType: null })}>
                <Form form={addForm} layout="vertical">
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
                    <div style={{ color: "#888" }}>选择产品后在本页展开该产品设备资源；若尚未保存，将预填模板默认值。</div>
                </Form>
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
                    的设备资源吗？删除后该产品将回到模板默认值，需重新保存才会落库。
                </div>
            </Modal>
        </div>
    );
};
