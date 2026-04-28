import "./ProdComparison.less";
import { Form, Button, message, Row, Col, Select, Radio, Spin } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as ApiDoc from "@/api/ApiSdsDoc";
import * as ApiSrsDoc from "@/api/ApiSrsDoc";
import { doSearchProducts } from "../prod_risk/util";

const toCellText = (value: any) => {
    if (value === null || value === undefined || value === "") return "-";
    return String(value);
};

export default () => {
    const { t: ts } = useTranslation();
    const [queryForm] = Form.useForm();
    const [data, dispatch] = useData({
        docType: "srs",
        products: [],
        docsA: [],
        docsB: [],
        rows: [],
        loading: false,
    });

    const doSearchDocsA = (params: { product_id: number }) => {
        const fn = data.docType === "srs" ? ApiSrsDoc.list_srs_doc : ApiDoc.list_sds_doc;
        fn({ ...params, page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiDoc.C_OK) {
                const rows = res.data.rows || [];
                const versionMap = new Map<string, any>();
                rows.forEach((item: any) => {
                    const key = (item.version || "").trim();
                    if (key && !versionMap.has(key)) {
                        versionMap.set(key, item);
                    }
                });
                dispatch({ docsA: Array.from(versionMap.values()) });
            } else {
                dispatch({ docsA: [] });
                message.error(res.msg);
            }
        });
    };

    const doSearchDocsB = (params: { product_id: number }) => {
        const fn = data.docType === "srs" ? ApiSrsDoc.list_srs_doc : ApiDoc.list_sds_doc;
        fn({ ...params, page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiDoc.C_OK) {
                const rows = res.data.rows || [];
                const versionMap = new Map<string, any>();
                rows.forEach((item: any) => {
                    const key = (item.version || "").trim();
                    if (key && !versionMap.has(key)) {
                        versionMap.set(key, item);
                    }
                });
                dispatch({ docsB: Array.from(versionMap.values()) });
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
            const fn = data.docType === "srs" ? ApiSrsDoc.compare_srs_doc : ApiDoc.compare_sds_doc;
            fn({
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

    return (
        <div className="page div-v prod-comparison">
            <div className="div-v detail-content">
                <div className="searchbar">
                    <Form className="comparison-form" form={queryForm} onFinish={() => doCompare()}>
                        <Row gutter={24}>
                            <Col span={24}>
                                <Form.Item label="文档类型" name="doc_type" initialValue="srs">
                                    <Radio.Group
                                        optionType="button"
                                        buttonStyle="solid"
                                        onChange={(e) => {
                                            const docType = e.target.value;
                                            dispatch({ docType, docsA: [], docsB: [], rows: [] });
                                            queryForm.setFieldsValue({
                                                prod_a_id: undefined,
                                                doc_a_id: undefined,
                                                prod_b_id: undefined,
                                                doc_b_id: undefined,
                                            });
                                        }}>
                                        <Radio.Button value="srs">需求规格说明</Radio.Button>
                                        <Radio.Button value="sds">软件详细设计</Radio.Button>
                                    </Radio.Group>
                                </Form.Item>
                            </Col>
                        </Row>
                        <Row gutter={24} className="comparison-form-row">
                            <Col span={12}>
                                <div className="comparison-form-block">
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
                                    <Form.Item label={data.docType === "srs" ? ts("srs_doc.version") : ts("sds_doc.version")} name="doc_a_id">
                                        <Select
                                            allowClear
                                            placeholder={data.docType === "srs" ? ts("srs_doc.version") : ts("sds_doc.version")}
                                            options={data.docsA.map((item: any) => ({
                                                label: item.version,
                                                value: item.id,
                                            }))}
                                        />
                                    </Form.Item>
                                </div>
                            </Col>
                            <Col span={12}>
                                <div className="comparison-form-block">
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
                                    <Form.Item label={data.docType === "srs" ? ts("srs_doc.version") : ts("sds_doc.version")} name="doc_b_id">
                                        <Select
                                            allowClear
                                            placeholder={data.docType === "srs" ? ts("srs_doc.version") : ts("sds_doc.version")}
                                            options={data.docsB.map((item: any) => ({
                                                label: item.version,
                                                value: item.id,
                                            }))}
                                        />
                                    </Form.Item>
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
                    <Spin spinning={data.loading}>
                        <div className="comparison-table-wrap">
                            <table className="comparison-plain-table">
                                <thead>
                                    <tr>
                                        <th>{ts("prod_comparison.comparison_name")}</th>
                                        <th>{ts("prod_comparison.prodA")}</th>
                                        <th>{ts("prod_comparison.prodB")}</th>
                                        <th>{ts("prod_comparison.comparison_status")}</th>
                                    </tr>
                                </thead>
                                <colgroup>
                                    <col style={{ width: "18%" }} />
                                    <col style={{ width: "34%" }} />
                                    <col style={{ width: "34%" }} />
                                    <col style={{ width: "14%" }} />
                                </colgroup>
                                <tbody>
                                    {(data.rows || []).map((row: any) => (
                                        <tr key={row.column_code}>
                                            <td title={toCellText(row.column_name)}>
                                                <span className="comparison-cell-text">{toCellText(row.column_name)}</span>
                                            </td>
                                            <td title={toCellText(row.values?.[0])}>
                                                <span className="comparison-cell-text">{toCellText(row.values?.[0])}</span>
                                            </td>
                                            <td title={toCellText(row.values?.[1])}>
                                                <span className="comparison-cell-text">{toCellText(row.values?.[1])}</span>
                                            </td>
                                            <td title={row.same_flag === 1 ? "相同" : "不同"}>
                                                {row.same_flag === 1 ? (
                                                    <span className="comparison-tag same">相同</span>
                                                ) : (
                                                    <span className="comparison-tag diff">不同</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {(!data.rows || data.rows.length === 0) && !data.loading && (
                                        <tr>
                                            <td colSpan={4} className="comparison-empty-cell">-</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Spin>
                </div>
            </div>
        </div>
    );
};
