import { Form, Button, Table, message, Row, Col, Modal } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdRcm";
import { doSearchProducts } from "../util";
import EditDlg from "./EditDlg";

const pageSizeOptions = [10, 20, 50];

enum DlgTypes {
    add = "add",
    delete = "delete",
}

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
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_prod_rcm({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
                dispatch({ loading: false, dlgType: null });
                message.success(res.msg);
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    };

    const columns = [
        {
            title: ts("rcm.code"),
            dataIndex: "code",
        },
        {
            title: ts("rcm.description"),
            dataIndex: "description",
        },
        {
            title: ts("rcm.srs_flag"),
            dataIndex: "srs_flag",
            render: (value: any) => {
                return value ? ts("yes") : ts("no");
            },
        },
        {
            title: ts("rcm.srs_codes"),
            dataIndex: "srs_codes",
            render: (value: any) => {
                return value.join(", ");
            },
        },
        {
            title: ts("rcm.test_codes"),
            dataIndex: "test_codes",
            render: (value: any) => {
                return value.join(", ");
            },
        },
        {
            title: ts("rcm.proof"),
            dataIndex: "proof",
        },
        {
            title: ts("rcm.note"),
            dataIndex: "note",
        },
        {
            title: ts("product.product"),
            render: (_value: any, row: any) => {
                return `${row.product_name}-${row.product_version}`;
            },
        },
        {
            title: ts("create_time"),
            dataIndex: "create_time",
        },
        {
            title: ts("action"),
            render: (_value: any, row: any) => {
                return (
                    <div>
                        <Button type="link" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
                            {ts("delete")}
                        </Button>
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
            <div className="div-h searchbar">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={(values) => {
                        doSearch(values, 1, data.pageSize);
                    }}>
                    <Row gutter={10}>
                        <Col>
                            <Form.Item label={ts("product.product")} name="prod_id">
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
                            Api.export_prod_rcms({ ...queryForm.getFieldsValue(), page_index: 0, page_size: 2000 }).then((res: any) => {
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
