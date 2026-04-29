import "./SrsDocTrace.less";
import { Form, Button, Table, message, Modal, Row, Col, Select, Tooltip, Space } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import { doSearchProducts } from "./util";
import * as Api from "@/api/ApiSrsDoc";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    delete = "delete",
    view = "view",
}

const DetailDlg = ({ data, dispatch }: any) => {
    const { t: ts } = useTranslation();

    const doSearch = (id: any) => {
        dispatch({ loadingTrace: true });
        Api.list_doc_trace({ id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loadingTrace: false, traceRows: res.data || [] });
            } else {
                dispatch({ loadingTrace: false, traceRows: [] });
                message.error(res.msg);
            }
        });
    };

    useEffect(() => {
        if (data.targetRow.id && data.dlgType === DlgTypes.view) {
            doSearch(data.targetRow.id);
        }
    }, [data.targetRow.id, data.dlgType]);

    const expandedTraceRows = (data.traceRows || []).flatMap((row: any, rowIndex: number) => {
        const sisCodes = Array.isArray(row?.sis_codes) ? row.sis_codes : [];
        const rawUnitCodes = Array.isArray(row?.test_codes) && row.test_codes.length > 0
            ? row.test_codes
            : (Array.isArray(row?.tests_unit) ? row.tests_unit : []);
        const unitCodes = (rawUnitCodes.length === 2 && sisCodes.length <= 1)
            ? [`${rawUnitCodes[0]} ~ ${rawUnitCodes[1]}`]
            : rawUnitCodes;
        const subCount = Math.max(sisCodes.length, unitCodes.length, 1);
        return Array.from({ length: subCount }).map((_, idx) => ({
            ...row,
            __rowKey: `${row?.srs_code || rowIndex}-${idx}`,
            __rowSpan: idx === 0 ? subCount : 0,
            __sisCode: sisCodes[idx] || "/",
            __unitCode: unitCodes[idx] || "/",
        }));
    });

    const mergedCell = (row: any) => ({ rowSpan: row?.__rowSpan ?? 1 });
    const renderMultilineCaseCodes = (values: any) => {
        const list = Array.isArray(values) ? values.filter(Boolean) : [];
        if (list.length === 0) return "/";
        if (list.length === 1) return list[0];
        return (
            <>
                <div className="stxt">{list[0]} ~</div>
                <div className="stxt">{list[list.length - 1]}</div>
            </>
        );
    };
    const renderMultilineRcmCodes = (values: any) => {
        const raw = Array.isArray(values) ? values : [values];
        const list = raw
            .flatMap((item) => String(item || "").split(/[,\n，]/g))
            .map((item) => item.trim())
            .filter(Boolean);
        if (list.length === 0) return "/";
        if (list.length === 1) return list[0];
        return (
            <>
                {list.map((code) => (
                    <div key={code} className="stxt">{code}</div>
                ))}
            </>
        );
    };
    const renderMultilineNote = (value: any) => {
        const text = String(value || "").trim();
        if (!text) return "/";
        const parts = text.split("、").map((item) => item.trim()).filter(Boolean);
        if (parts.length <= 1) return <div className="trace-note-line">{text}</div>;
        return (
            <>
                {parts.map((item) => (
                    <div key={item} className="trace-note-line">{item}</div>
                ))}
            </>
        );
    };

    return (
        <Modal
            width={"98vw"}
            centered
            title={`${data.targetRow.product_name}-${data.targetRow.product_version}: ${data.targetRow.version}`}
            open={data.dlgType === DlgTypes.view}
            maskClosable={false}
            footer={null}
            styles={{ body: { overflowX: "hidden" } }}
            onCancel={() => dispatch({ dlgType: null })}>
            <Table
                className="table-box"
                loading={data.loadingTrace}
                dataSource={expandedTraceRows}
                rowKey={(item: any) => item.__rowKey}
                size="small"
                tableLayout="auto"
                columns={[
                    {
                        title: ts("srs_req.code"),
                        dataIndex: "srs_code",
                        onCell: mergedCell,
                        width: 105,
                    },
                    {
                        title: ts("srs_req.rcm_flag"),
                        dataIndex: "rcm_flag",
                        render: (rcm_flag: any) => (rcm_flag ? ts("yes") : ts("no")),
                        width: 60,
                    },
                    {
                        title: "软件详细设计",
                        dataIndex: "sds_code",
                        onCell: mergedCell,
                        width: 120,
                    },
                    {
                        title: "接口编号",
                        dataIndex: "__sisCode",
                        render: (value: any) => value || "/",
                        width: 95,
                    },
                    {
                        title: "单元测试记录",
                        dataIndex: "__unitCode",
                        width: 95,
                        render: (value: any) => {
                            const text = String(value || "").trim();
                            if (!text) return "/";
                            if (!text.includes("~")) return text;
                            const parts = text.split("~").map((item) => item.trim()).filter(Boolean);
                            if (parts.length < 2) return text;
                            return (
                                <>
                                    <div className="stxt">{parts[0]} ~</div>
                                    <div className="stxt">{parts[parts.length - 1]}</div>
                                </>
                            );
                        },
                    },
                    {
                        title: "集成测试记录",
                        dataIndex: "tests_integ",
                        width: 95,
                        render: (values: any) => {
                            return renderMultilineCaseCodes(values);
                        },
                    },
                    {
                        title: "系统测试记录",
                        dataIndex: "tests_sys",
                        width: 95,
                        render: (values: any) => {
                            return renderMultilineCaseCodes(values);
                        },
                    },
                    {
                        title: "用户测试记录",
                        dataIndex: "tests_user",
                        width: 95,
                        render: (values: any) => {
                            return renderMultilineCaseCodes(values);
                        },
                    },
                    {
                        title: "RCM",
                        dataIndex: "rcm_codes",
                        width: 110,
                        render: (values: any) => {
                            return renderMultilineRcmCodes(values);
                        },
                    },
                    {
                        title: "备注",
                        dataIndex: "note",
                        className: "trace-note-col",
                        onCell: mergedCell,
                        render: (value: any) => renderMultilineNote(value),
                    },
                ]}
                pagination={false}
            />
        </Modal>
    );
};

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
        products: [],
        traceRows: [],
        exportingSet: new Set(),
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_srs_doc({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_srs_doc({ id: data.targetRow.id }).then((res: any) => {
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
            title: ts("product.name"),
            dataIndex: "product_name",
        },
        {
            title: ts("product.version"),
            dataIndex: "product_version",
        },
        {
            title: ts("srs_doc.version"),
            dataIndex: "version",
        },
        {
            title: ts("action"),
            width: 140,
            render: (_value: any, row: any) => {
                return (
                    <Space size={12} style={{ whiteSpace: "nowrap" }}>
                        <Button type="link" onClick={() => dispatch({ dlgType: DlgTypes.view, targetRow: row })}>
                            {ts("view")}
                        </Button>
                        <Button
                            type="link"
                            loading={data.exportingSet.has(row.id)}
                            onClick={() => {
                                dispatch({ exportingSet: new Set([...data.exportingSet, row.id]) });
                                Api.export_doc_trace({ id: row.id }).then((res: any) => {
                                    dispatch({ exportingSet: new Set([...data.exportingSet].filter((item: any) => item !== row.id)) });
                                    if (res.code !== Api.C_OK) {
                                        message.error(res.msg);
                                    }
                                });
                            }}>
                            {ts("export")}
                        </Button>
                    </Space>
                );
            },
        },
    ];

    useEffect(() => {
        const form = queryForm.getFieldsValue();
        doSearch(form, data.pageIndex, data.pageSize);
        doSearchProducts(data, dispatch);
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
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
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
            <DetailDlg data={data} dispatch={dispatch} />
        </div>
    );
};
