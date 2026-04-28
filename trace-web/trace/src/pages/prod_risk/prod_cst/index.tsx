import { Form, Button, Table, message, Row, Col, Modal, Select, InputNumber, Tag } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdCst";
import { doSearchProducts, doSearchRcms } from "../util";
import EditDlg from "./EditDlg";

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
        rcms: [],
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
                dispatch({ loading: false, dlgType: null });
                message.success(res.msg);
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    };

    const doUpdate = () => {
        dispatch({ updating: true });
        Api.update_prod_cst({ ...data.targetEdit }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ updating: false, targetEdit: {} });
                message.success(res.msg);
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                dispatch({ updating: false });
                message.error(res.msg);
            }
        });
    };

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
                if (data.targetEdit.id !== row.id) {
                    return value;
                }
                return (
                    <InputNumber
                        value={data.targetEdit.prev_score}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, prev_score: v } })}
                    />
                );
            },
        },
        {
            title: ts("cst.prev_severity"),
            dataIndex: "prev_severity",
            render: (value: any, row: any) => {
                if (data.targetEdit.id !== row.id) {
                    return value;
                }
                return (
                    <InputNumber
                        value={data.targetEdit.prev_severity}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, prev_severity: v } })}
                    />
                );
            },
        },
        {
            title: ts("cst.prev_level"),
            dataIndex: "prev_level",
            render: (value: any, row: any) => {
                if (data.targetEdit.id !== row.id) {
                    return value;
                }
                return (
                    <InputNumber
                        value={data.targetEdit.prev_level}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, prev_level: v } })}
                    />
                );
            },
        },
        {
            title: ts("cst.prev_accept"),
            dataIndex: "prev_accept",
            render: (value: any, row: any) => {
                if (data.targetEdit.id !== row.id) {
                    return value;
                }
                return (
                    <Select
                        allowClear
                        style={{ minWidth: "100px" }}
                        value={data.targetEdit.prev_accept}
                        options={ACCEPTS.map((item) => ({ label: item, value: item }))}
                        onChange={(v: any) => {
                            dispatch({ targetEdit: { ...data.targetEdit, prev_accept: v || "" } });
                        }}></Select>
                );
            },
        },
        {
            title: ts("cst.cur_score"),
            dataIndex: "cur_score",
            render: (value: any, row: any) => {
                if (data.targetEdit.id !== row.id) {
                    return value;
                }
                return (
                    <InputNumber
                        value={data.targetEdit.cur_score}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, cur_score: v } })}
                    />
                );
            },
        },
        {
            title: ts("cst.cur_severity"),
            dataIndex: "cur_severity",
            render: (value: any, row: any) => {
                if (data.targetEdit.id !== row.id) {
                    return value;
                }
                return (
                    <InputNumber
                        value={data.targetEdit.cur_severity}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, cur_severity: v } })}
                    />
                );
            },
        },
        {
            title: ts("cst.cur_level"),
            dataIndex: "cur_level",
            render: (value: any, row: any) => {
                if (data.targetEdit.id !== row.id) {
                    return value;
                }
                return (
                    <InputNumber
                        value={data.targetEdit.cur_level}
                        onChange={(v: any) => dispatch({ targetEdit: { ...data.targetEdit, cur_level: v } })}
                    />
                );
            },
        },
        {
            title: ts("cst.cur_accept"),
            dataIndex: "cur_accept",
            render: (value: any, row: any) => {
                if (data.targetEdit.id !== row.id) {
                    return value;
                }
                return (
                    <Select
                        allowClear
                        style={{ minWidth: "100px" }}
                        value={data.targetEdit.cur_accept}
                        options={ACCEPTS.map((item) => ({ label: item, value: item }))}
                        onChange={(v: any) => {
                            dispatch({ targetEdit: { ...data.targetEdit, cur_accept: v || "" } });
                        }}></Select>
                );
            },
        },
        {
            title: ts("cst.rcm_codes"),
            dataIndex: "rcm_codes",
            render: (value: any, row: any) => {
                if (data.targetEdit.id !== row.id) {
                    return value;
                }
                return (
                    <Select
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
                    />
                );
            },
        },
        {
            title: ts("product.product"),
            render: (_value: any, row: any) => {
                return `${row.product_name}-${row.product_version}`;
            },
        },
        {
            title: ts("action"),
            render: (_value: any, row: any) => {
                return (
                    <div>
                        {data.targetEdit.id === row.id && (
                            <Button type="link" onClick={() => dispatch({ targetEdit: {} })}>
                                {ts("cancel")}
                            </Button>
                        )}
                        <Button
                            type="link"
                            loading={data.updating && data.targetEdit.id === row.id}
                            onClick={() => {
                                if (data.targetEdit.id === row.id) {
                                    doUpdate();
                                } else {
                                    doSearchRcms(row.prod_id, data, dispatch);
                                    dispatch({ targetEdit: row });
                                }
                            }}>
                            {data.targetEdit.id === row.id ? ts("save") : ts("edit")}
                        </Button>
                        {data.targetEdit.id !== row.id && (
                            <Button type="link" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
                                {ts("delete")}
                            </Button>
                        )}
                    </div>
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
        <div className="page div-v">
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
                </div>
            </div>
            <Table
                className="expand"
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
