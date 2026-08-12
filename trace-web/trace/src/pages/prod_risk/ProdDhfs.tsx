import { Form, Input, Button, Table, message, Row, Col, Modal, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdDhf";
import * as ApiProduct from "@/api/ApiProduct";
import "./ProdDhfs.less";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    delete = "delete",
}

const buildDhfCountMap = (rows: any[] = []) => {
    const map = new Map<number, number>();
    rows.forEach((row) => {
        const pid = Number(row.prod_id);
        if (!pid) return;
        map.set(pid, (map.get(pid) || 0) + 1);
    });
    return map;
};

const loadProducts = (data: any, dispatch: any) => {
    if ((data.products || []).length > 0) return;
    ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
        if (res.code === ApiProduct.C_OK) {
            dispatch({ products: res.data.rows || [] });
        } else {
            message.error(res.msg);
        }
    }).catch(() => {
        message.error("加载产品列表失败");
    });
};

export default () => {
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
        dhfCountMap: new Map<number, number>(),
        addProductId: undefined as number | undefined,
        targetRow: {} as any,
        copyProductId: undefined as number | undefined,
        copyModalOpen: false,
        copyLoading: false,
        dlgType: null as string | null,
    });

    const loadDhfCounts = () => {
        return Api.list_prod_dhf({ page_index: 0, page_size: 100000 }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const map = buildDhfCountMap(res.data?.rows || []);
                dispatch({ dhfCountMap: map });
                return map;
            }
            return data.dhfCountMap || new Map<number, number>();
        }).catch(() => data.dhfCountMap || new Map<number, number>());
    };

    const doSearch = (params: any, pageIndex: any, pageSize: any, countMap?: Map<number, number>) => {
        dispatch({ loading: true });
        const mapPromise = countMap ? Promise.resolve(countMap) : loadDhfCounts();
        mapPromise.then((map) => {
            ApiProduct.list_product({ ...params, page_index: 0, page_size: 10000 }).then((res: any) => {
                if (res.code === ApiProduct.C_OK) {
                    const allRows = (res.data.rows || []).filter((row: any) => (map.get(row.id) || 0) > 0);
                    const total = allRows.length;
                    const start = (pageIndex - 1) * pageSize;
                    const rows = allRows.slice(start, start + pageSize);
                    dispatch({
                        loading: false,
                        pageIndex,
                        pageSize,
                        total,
                        rows,
                        dhfCountMap: map,
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

    const loadProductsForModal = () => loadProducts(data, dispatch);

    const openAddModal = () => {
        addForm.resetFields();
        loadProductsForModal();
        dispatch({ dlgType: DlgTypes.add, addProductId: undefined, copyModalOpen: false });
    };

    const doAddNavigate = () => {
        addForm.validateFields().then((values) => {
            const prodId = values.prod_id;
            if (!prodId) {
                message.warning(sprintf(ts("msg_select"), { label: ts("product.product") }));
                return;
            }
            dispatch({ dlgType: null });
            navigate(`/prod_dhfs/edit/${prodId}`);
        });
    };

    const getCopyExcludeProductIds = () => {
        const ids = new Set<number>();
        if (data.targetRow?.id) ids.add(Number(data.targetRow.id));
        data.dhfCountMap.forEach((count, prodId) => {
            if (count > 0) ids.add(Number(prodId));
        });
        return Array.from(ids);
    };

    const openCopyModal = (row: any) => {
        loadProductsForModal();
        loadDhfCounts();
        dispatch({
            copyModalOpen: true,
            dlgType: null,
            targetRow: row,
            copyProductId: undefined,
            copyLoading: false,
        });
    };

    const closeCopyModal = () => {
        dispatch({ copyModalOpen: false, copyProductId: undefined, copyLoading: false });
    };

    const doCopy = () => {
        const row = data.targetRow || {};
        if (!row.id) {
            message.warning("未找到源产品");
            return;
        }
        if (!data.copyProductId) {
            message.warning(sprintf(ts("msg_select"), { label: ts("product.product") }));
            return;
        }
        if (Number(data.copyProductId) === Number(row.id)) {
            message.warning("不能复制到相同产品版本，请选择其他完整版本");
            return;
        }
        if ((data.dhfCountMap.get(Number(data.copyProductId)) || 0) > 0) {
            message.warning("目标产品已有 DHF 清单，不能重复复制");
            return;
        }
        dispatch({ copyLoading: true });
        Api.copy_prod_dhfs({
            source_prod_id: row.id,
            target_product_id: data.copyProductId,
        }).then((res: any) => {
            dispatch({ copyLoading: false });
            if (res.code === Api.C_OK) {
                closeCopyModal();
                message.success(res.msg || "复制成功");
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                message.error(res.msg || "复制失败");
            }
        }).catch(() => {
            dispatch({ copyLoading: false });
            message.error("复制失败");
        });
    };

    const doDelete = () => {
        const row = data.targetRow || {};
        if (!row.id) return;
        const count = data.dhfCountMap.get(row.id) || 0;
        if (count <= 0) {
            message.warning("该产品暂无 DHF 条目");
            dispatch({ dlgType: null });
            return;
        }
        dispatch({ loading: true });
        Api.delete_prod_dhfs_by_prod_id({ prod_id: row.id }).then((res: any) => {
            dispatch({ loading: false });
            if (res.code === Api.C_OK) {
                dispatch({ dlgType: null });
                message.success(res.msg || ts("save_success"));
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                message.error(res.msg);
            }
        }).catch(() => {
            dispatch({ loading: false });
            message.error("删除失败");
        });
    };

    useEffect(() => {
        doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
        loadDhfCounts();
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
            title: "DHF条数",
            dataIndex: "id",
            width: "10%",
            render: (_: any, row: any) => data.dhfCountMap.get(row.id) || 0,
        },
        {
            title: ts("action"),
            width: "28%",
            className: "prod-dhfs-list-action-col",
            onCell: () => ({ className: "prod-dhfs-list-action-col" }),
            render: (_: any, row: any) => {
                const dhfCount = data.dhfCountMap.get(row.id) || 0;
                return (
                <Space size={4}>
                    <Button type="link" size="small" onClick={() => navigate(`/prod_dhfs/view/${row.id}`)}>
                        {ts("view")}
                    </Button>
                    <Button type="link" size="small" onClick={() => navigate(`/prod_dhfs/edit/${row.id}`)}>
                        {ts("edit")}
                    </Button>
                    <Button
                        type="link"
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            openCopyModal(row);
                        }}>
                        复制
                    </Button>
                    <Button
                        type="link"
                        size="small"
                        danger
                        disabled={dhfCount <= 0}
                        onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
                        {ts("delete")}
                    </Button>
                </Space>
                );
            },
        },
    ];

    return (
        <div className="page div-v">
            <div className="div-h searchbar list-searchbar-align">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={(values) => doSearch(values, 1, data.pageSize)}>
                    <Row gutter={10}>
                        <Col>
                            <Form.Item label={ts("fuzzy")} name="fuzzy">
                                <Input allowClear placeholder="产品名称/版本/型号" />
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
                    doSearch(queryForm.getFieldsValue(), pager.current, pager.pageSize);
                }}
            />
            <Modal
                centered
                width={520}
                title="新增产品 DHF"
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
                    <div style={{ color: "#888" }}>选择产品后进入该产品的 DHF 维护页，可新增、导入清单条目。</div>
                </Form>
            </Modal>
            <Modal
                centered
                width={520}
                title="复制产品 DHF"
                open={data.copyModalOpen}
                maskClosable={false}
                destroyOnClose
                confirmLoading={data.copyLoading}
                onOk={doCopy}
                onCancel={closeCopyModal}>
                <div style={{ lineHeight: 1.8 }}>
                    <div style={{ marginBottom: 8 }}>
                        源产品：{data.targetRow?.name || "-"}
                        {data.targetRow?.full_version ? `（${data.targetRow.full_version}）` : ""}
                    </div>
                    <div style={{ marginBottom: 12 }}>复制到目标产品：</div>
                    <ProductVersionSelect
                        key={`copy-${data.targetRow?.id || 0}`}
                        products={data.products}
                        value={data.copyProductId}
                        initialName={data.targetRow?.name}
                        excludeProductIds={getCopyExcludeProductIds()}
                        deferChangeUntilVersionSelect
                        namePlaceholder={ts("product.name")}
                        versionPlaceholder={ts("product.full_version")}
                        onChange={(value: any) => dispatch({ copyProductId: value })}
                    />
                    <div style={{ color: "#888", marginTop: 12 }}>
                        仅可复制到尚无 DHF 清单的产品版本（含同产品名称的其他完整版本）；每个产品版本只能有一套 DHF，不能重复复制。
                    </div>
                </div>
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
                    的全部 DHF 条目（共 {data.dhfCountMap.get(data.targetRow?.id) || 0} 条）吗？
                </div>
            </Modal>
        </div>
    );
};
