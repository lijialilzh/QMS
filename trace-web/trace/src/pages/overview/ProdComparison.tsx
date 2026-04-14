import "./ProdComparison.less";
import { Form, Button, Table, message, Row, Col, Select } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as ApiDoc from "@/api/ApiSdsDoc";
import { doSearchProducts } from "../prod_risk/util";

const columnsDef = (ts: (key: string) => string) => [
    {
        title: ts("prod_comparison.comparison_name"),
        dataIndex: "column_name",
        width: 200,
    },
    {
        title: ts("prod_comparison.prodA"),
        dataIndex: "values",
        render: (values: string[]) => values?.[0] || "-",
    },
    {
        title: ts("prod_comparison.prodB"),
        dataIndex: "values",
        render: (values: string[]) => values?.[1] || "-",
    },
    {
        title: ts("prod_comparison.comparison_status"),
        dataIndex: "same_flag",
        width: 120,
        render: (same_flag: number) => {
            return same_flag === 1 ? (
                <span
                    style={{
                        display: "inline-block",
                        padding: "4px 12px",
                        backgroundColor: "#52c41a",
                        color: "#fff",
                        borderRadius: "4px",
                        fontSize: "14px",
                    }}>
                    相同
                </span>
            ) : (
                <span
                    style={{
                        display: "inline-block",
                        padding: "4px 12px",
                        backgroundColor: "#faad14",
                        color: "#fff",
                        borderRadius: "4px",
                        fontSize: "14px",
                    }}>
                    不同
                </span>
            );
        },
    },
];

export default () => {
    const { t: ts } = useTranslation();
    const [queryForm] = Form.useForm();
    const [data, dispatch] = useData({
        products: [],
        docsA: [],
        docsB: [],
        rows: [],
        loading: false,
    });

    const doSearchDocsA = (params: { product_id: number }) => {
        ApiDoc.list_sds_doc(params).then((res: any) => {
            if (res.code === ApiDoc.C_OK) {
                dispatch({ docsA: res.data.rows || [] });
            } else {
                dispatch({ docsA: [] });
                message.error(res.msg);
            }
        });
    };

    const doSearchDocsB = (params: { product_id: number }) => {
        ApiDoc.list_sds_doc(params).then((res: any) => {
            if (res.code === ApiDoc.C_OK) {
                dispatch({ docsB: res.data.rows || [] });
            } else {
                dispatch({ docsB: [] });
                message.error(res.msg);
            }
        });
    };

    const doCompare = () => {
        queryForm.validateFields().then((values: any) => {
            const { doc_a_id, doc_b_id } = values;
            if (!doc_a_id || !doc_b_id) {
                message.warning(ts("prod_comparison.select_both"));
                return;
            }
            if (doc_a_id === doc_b_id) {
                message.warning(ts("prod_comparison.select_different"));
                return;
            }
            dispatch({ loading: true });
            ApiDoc.compare_sds_doc({
                id0: doc_a_id,
                id1: doc_b_id,
            }).then((res: any) => {
                if (res.code === ApiDoc.C_OK) {
                    // 处理返回数据：如果是数组直接使用，否则取 rows 属性
                    const rows = Array.isArray(res.data) ? res.data : (res.data?.rows || []);
                    dispatch({
                        loading: false,
                        rows,
                    });
                } else {
                    dispatch({ loading: false, rows: [] });
                    message.error(res.msg);
                }
            });
        });
    };

    useEffect(() => {
        doSearchProducts(data, dispatch);
    }, []);

    const columns = columnsDef(ts);

    return (
        <div className="page div-v prod-comparison">
            <div className="div-v detail-content">
                <div className="searchbar">
                    <Form form={queryForm} onFinish={() => doCompare()}>
                        <Row gutter={24} className="comparison-form-row">
                            <Col span={12}>
                                <div className="comparison-form-block">
                                    <Row gutter={10}>
                                        <Col>
                                            <Form.Item label={ts("prod_comparison.prodA")} name="prod_a_id">
                                                <ProductVersionSelect
                                                    products={data.products}
                                                    allowClear
                                                    namePlaceholder={ts("product.name")}
                                                    versionPlaceholder={ts("product.full_version")}
                                                    onChange={(value) => {
                                                        queryForm.setFieldValue("prod_a_id", value);
                                                        dispatch({ docsA: [] });
                                                        queryForm.setFieldsValue({ doc_a_id: undefined });
                                                        if (value) doSearchDocsA({ product_id: value });
                                                    }}
                                                />
                                            </Form.Item>
                                        </Col>
                                        <Col>
                                            <Form.Item label={ts("sds_doc.version")} name="doc_a_id">
                                                <Select
                                                    allowClear
                                                    placeholder={ts("sds_doc.version")}
                                                    options={data.docsA.map((item: any) => ({
                                                        label: item.version,
                                                        value: item.id,
                                                    }))}
                                                />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                </div>
                            </Col>
                            <Col span={12}>
                                <div className="comparison-form-block">
                                    <Row gutter={10}>
                                        <Col>
                                            <Form.Item label={ts("prod_comparison.prodB")} name="prod_b_id">
                                                <ProductVersionSelect
                                                    products={data.products}
                                                    allowClear
                                                    namePlaceholder={ts("product.name")}
                                                    versionPlaceholder={ts("product.full_version")}
                                                    onChange={(value) => {
                                                        queryForm.setFieldValue("prod_b_id", value);
                                                        dispatch({ docsB: [] });
                                                        queryForm.setFieldsValue({ doc_b_id: undefined });
                                                        if (value) doSearchDocsB({ product_id: value });
                                                    }}
                                                />
                                            </Form.Item>
                                        </Col>
                                        <Col>
                                            <Form.Item label={ts("sds_doc.version")} name="doc_b_id">
                                                <Select
                                                    allowClear
                                                    placeholder={ts("sds_doc.version")}
                                                    options={data.docsB.map((item: any) => ({
                                                        label: item.version,
                                                        value: item.id,
                                                    }))}
                                                />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                </div>
                            </Col>
                        </Row>
                        <div className="compare-btn-wrap">
                            <Button type="primary" htmlType="submit">
                                {ts("prod_comparison.start_compare")}
                            </Button>
                        </div>
                    </Form>
                </div>
                <div className="doc-section">
                    <Table
                        className="expand"
                        columns={columns}
                        rowKey={(item: any) => item.column_code}
                        dataSource={data.rows}
                        loading={data.loading}
                        pagination={false}
                    />
                </div>
            </div>
        </div>
    );
};
