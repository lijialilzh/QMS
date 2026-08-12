import { Button, Col, Form, Input, Modal, Row, Select, Space, Table, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import { createDocBatchDelete, getDocTableRowSelection } from "../doc_shared/docBatchDelete";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiNsrDoc";
import * as ApiProduct from "@/api/ApiProduct";
import "../risk_mgmt/RiskMgmtDocs.less";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    delete = "delete",
    copy = "copy",
}

const loadProducts = (data: any, dispatch: any) => {
    if (data.products.length > 0) return;
    ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
        if (res.code === Api.C_OK) {
            dispatch({ products: res.data.rows || [] });
        } else {
            message.error(res.msg);
        }
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
        targetRow: {},
        products: [],
        versionOptions: [] as { value: string; label: string }[],
        exportingId: 0,
        copyProductId: undefined,
        adding: false,
    });

    const productId = Form.useWatch("product_id", queryForm);
    useEffect(() => {
        if (!productId) {
            queryForm.setFieldValue("version", undefined);
            dispatch({ versionOptions: [] });
            return;
        }
        Api.list_nsr_doc({ product_id: productId, page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK && res.data?.rows?.length) {
                const versions = [...new Set((res.data.rows as any[]).map((row: any) => row.version).filter(Boolean))].sort();
                dispatch({ versionOptions: versions.map((version: string) => ({ value: version, label: version })) });
            } else {
                dispatch({ versionOptions: [] });
            }
        }).catch(() => dispatch({ versionOptions: [] }));
    }, [productId]);

    const doSearch = (params: any = {}, pageIndex: any = data.pageIndex, pageSize: any = data.pageSize) => {
        dispatch({ loading: true });
        Api.list_nsr_doc({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, total: res.data.total, rows: res.data.rows || [], pageIndex, pageSize });
            } else {
                dispatch({ loading: false, rows: [], total: 0 });
                message.error(res.msg);
            }
        });
    };

    useEffect(() => {
        loadProducts(data, dispatch);
        doSearch({}, 1, data.pageSize);
    }, []);

    const doAdd = () => {
        addForm.validateFields().then((values) => {
            dispatch({ adding: true });
            Api.add_nsr_doc({ ...values }).then((res: any) => {
                dispatch({ adding: false });
                if (res.code === Api.C_OK) {
                    message.success(ts("save_success"));
                    dispatch({ dlgType: null });
                    const newId = res.data?.id;
                    if (newId) {
                        navigate(`/nsr_docs/edit/${newId}`);
                    } else {
                        doSearch(queryForm.getFieldsValue(), 1, data.pageSize);
                    }
                } else {
                    message.error(res.msg);
                }
            });
        });
    };

    const doDelete = () => {
        dispatch({ loading: true });
        Api.delete_nsr_doc({ id: data.targetRow.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success(ts("save_success"));
                dispatch({ dlgType: null, loading: false });
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    };

    const doBatchDelete = createDocBatchDelete({
        ts,
        dispatch,
        data,
        deleteFn: Api.delete_nsr_doc,
        cOk: Api.C_OK,
        onRefresh: () => doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize),
    });

    const doDuplicate = (row: any) => {
        loadProducts(data, dispatch);
        dispatch({ dlgType: DlgTypes.copy, targetRow: row, copyProductId: row.product_id });
    };

    const doCopy = () => {
        const row = data.targetRow || {};
        if (!row.id) return;
        dispatch({ loading: true });
        Api.duplicate_nsr_doc({ id: row.id, product_id: data.copyProductId }).then((res: any) => {
            dispatch({ loading: false });
            if (res.code === Api.C_OK) {
                dispatch({ dlgType: null });
                message.success("复制成功");
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                message.error(res.msg);
            }
        }).catch(() => {
            dispatch({ loading: false });
            message.error("复制失败");
        });
    };

    const doExport = async (row: any) => {
        if (data.exportingId === row.id) return;
        dispatch({ exportingId: row.id });
        try {
            const res: any = await Api.export_nsr_doc({ id: row.id });
            if (res.code !== Api.C_OK) {
                message.error(res.msg || "导出失败");
            }
        } catch (_err) {
            message.error("导出失败");
        } finally {
            dispatch({ exportingId: 0 });
        }
    };

    const columns: any[] = [
        { title: ts("product.name"), dataIndex: "product_name", width: "18%" },
        { title: ts("product.version"), dataIndex: "product_full_version", width: "11%" },
        { title: "文档版本", dataIndex: "version", width: "8%" },
        { title: "文件编号", dataIndex: "file_no", width: "16%", render: (v: string) => v || "-" },
        { title: "变更说明", dataIndex: "change_log", width: "11%" },
        { title: ts("create_time"), dataIndex: "create_time", width: "14%" },
        {
            title: ts("action"),
            width: "24%",
            className: "risk-doc-action-col",
            render: (_: any, row: any) => (
                <Space size={4} className="risk-doc-action-space">
                    <Button type="link" size="small" onClick={() => navigate(`/nsr_docs/view/${row.id}`)}>
                        {ts("view")}
                    </Button>
                    <Button type="link" size="small" onClick={() => navigate(`/nsr_docs/edit/${row.id}`)}>
                        {ts("edit")}
                    </Button>
                    <Button type="link" size="small" onClick={() => doDuplicate(row)}>
                        复制
                    </Button>
                    <Button type="link" size="small" loading={data.exportingId === row.id} onClick={() => doExport(row)}>
                        导出
                    </Button>
                    <Button type="link" size="small" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
                        {ts("delete")}
                    </Button>
                </Space>
            ),
        },
    ].map((col: any) => ({
        ...col,
        onHeaderCell: () => ({ style: { whiteSpace: "nowrap" } }),
    }));

    return (
        <div className="div-v page">
            <div className="div-h searchbar list-searchbar-align">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={(values) => doSearch(values, 1, data.pageSize)}>
                    <Row gutter={20}>
                        <Col>
                            <Form.Item label={ts("srs_doc.select_product")} name="product_id">
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => queryForm.setFieldValue("product_id", value)}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Form.Item label={ts("srs_doc.doc_version")} name="version">
                                <Select
                                    placeholder={ts("srs_doc.please_select_doc_version")}
                                    allowClear
                                    options={data.versionOptions}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
                <Space>
                    <Button type="primary" onClick={() => {
                        addForm.resetFields();
                        addForm.setFieldValue("version", "A0");
                        dispatch({ dlgType: DlgTypes.add });
                        loadProducts(data, dispatch);
                    }}>
                        {ts("add")}
                    </Button>
                                    <Button disabled={!(data.selectedRowKeys || []).length} danger onClick={doBatchDelete}>
                        {ts("batch_delete")}
                    </Button>
                </Space>
            </div>
            <Table
                rowSelection={getDocTableRowSelection(data, dispatch)}
                className="expand risk-doc-table"
                rowKey="id"
                loading={data.loading}
                columns={columns}
                dataSource={data.rows}
                tableLayout="fixed"
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
                width={620}
                centered
                title="新增自研软件网络安全研究报告"
                open={data.dlgType === DlgTypes.add}
                confirmLoading={data.adding}
                onOk={doAdd}
                maskClosable={false}
                onCancel={() => {
                    dispatch({ dlgType: null });
                    addForm.resetFields();
                }}>
                <Form form={addForm} layout="vertical">
                    <Form.Item
                        label={ts("product.product")}
                        name="product_id"
                        rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                        <ProductVersionSelect
                            products={data.products}
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.full_version")}
                            onChange={(value) => addForm.setFieldValue("product_id", value)}
                        />
                    </Form.Item>
                    <Form.Item
                        label="文档版本"
                        name="version"
                        rules={[{ required: true, message: sprintf(ts("msg_input"), { label: "文档版本" }) }]}>
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item label="文件编号" name="file_no">
                        <Input allowClear placeholder="留空将自动从产品DHF获取" />
                    </Form.Item>
                    <Form.Item label="变更说明" name="change_log">
                        <Input.TextArea rows={3} allowClear />
                    </Form.Item>
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
                {ts("confirm_delete")}
            </Modal>
            <Modal
                centered
                width={520}
                title="复制"
                open={data.dlgType === DlgTypes.copy}
                maskClosable={false}
                confirmLoading={data.loading}
                onOk={doCopy}
                onCancel={() => dispatch({ dlgType: null })}>
                <div style={{ lineHeight: 1.8 }}>
                    <div style={{ marginBottom: 12 }}>复制到目标产品（默认当前产品，可选其它产品）：</div>
                    <ProductVersionSelect
                        products={data.products}
                        value={data.copyProductId}
                        namePlaceholder={ts("product.name")}
                        versionPlaceholder={ts("product.full_version")}
                        onChange={(value: any) => dispatch({ copyProductId: value })}
                    />
                    <div style={{ color: "#888", marginTop: 12 }}>
                        版本号自动生成：同产品在原版本号上递增；跨产品按目标产品现有最大版本递增。
                    </div>
                </div>
            </Modal>
        </div>
    );
};
