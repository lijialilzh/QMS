import { Button, Col, Form, Row, Select, Spin, message } from "antd";
import { useEffect } from "react";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiDocCompare";
import * as ApiProduct from "@/api/ApiProduct";
import "./ProdComparison.less";

const toCellText = (value: any) => {
    if (value === null || value === undefined || value === "") return "-";
    return String(value);
};

export default () => {
    const [queryForm] = Form.useForm();
    const [data, dispatch] = useData({
        docTypes: [],
        docTypeGroups: [],
        products: [],
        docsA: [],
        docsB: [],
        rows: [],
        loading: false,
        docTypeSelected: false,
    });

    useEffect(() => {
        Api.list_compare_doc_types().then((res: any) => {
            if (res.code === Api.C_OK) {
                const groups = res.data || [];
                dispatch({ docTypeGroups: groups });
            }
        });
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data?.rows || [] });
        });
    }, []);

    const doSearchDocs = (productId: number, side: "A" | "B") => {
        const docType = queryForm.getFieldValue("doc_type");
        if (!docType || !productId) return;
        Api.list_compare_doc_versions({ doc_type: docType, product_id: productId }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const rows = res.data || [];
                const versionMap = new Map<string, any>();
                rows.forEach((item: any) => {
                    const key = (item.version || "").trim();
                    if (key && !versionMap.has(key)) {
                        versionMap.set(key, item);
                    }
                });
                if (side === "A") dispatch({ docsA: Array.from(versionMap.values()) });
                else dispatch({ docsB: Array.from(versionMap.values()) });
            } else {
                if (side === "A") dispatch({ docsA: [] });
                else dispatch({ docsB: [] });
            }
        });
    };

    const doCompare = () => {
        queryForm.validateFields().then((values: any) => {
            const { doc_type, doc_a_id, doc_b_id } = values;
            if (!doc_a_id || !doc_b_id) {
                message.warning("请选择两个版本的文档");
                return;
            }
            if (doc_a_id === doc_b_id) {
                message.warning("请选择两个不同的文档版本");
                return;
            }
            dispatch({ loading: true });
            Api.compare_doc({ doc_type, id0: doc_a_id, id1: doc_b_id }).then((res: any) => {
                if (res.code === Api.C_OK) {
                    const rows = Array.isArray(res.data) ? res.data : (res.data?.rows || []);
                    dispatch({ loading: false, rows });
                } else {
                    dispatch({ loading: false, rows: [] });
                    message.error(res.msg);
                }
            });
        });
    };

    return (
        <div className="page div-v prod-comparison">
            <div className="div-v detail-content">
                <div className="searchbar">
                    <Form className="comparison-form" form={queryForm} onFinish={() => doCompare()}>
                        <Row gutter={24}>
                            <Col span={24}>
                                <Form.Item label="文档名称" name="doc_type" rules={[{ required: true, message: "请选择文档名称" }]}>
                                    <Select
                                        allowClear
                                        placeholder="请选择文档名称"
                                        style={{ maxWidth: 400 }}
                                        onChange={(value) => {
                                            queryForm.setFieldValue("doc_type", value);
                                            dispatch({ docsA: [], docsB: [], rows: [], docTypeSelected: !!value });
                                            queryForm.setFieldsValue({
                                                prod_a_id: undefined, doc_a_id: undefined,
                                                prod_b_id: undefined, doc_b_id: undefined,
                                            });
                                        }}
                                    >
                                        {(data.docTypeGroups || []).map((group: any) => (
                                            <Select.OptGroup key={group.group} label={group.group}>
                                                {(group.types || []).map((t: any) => (
                                                    <Select.Option key={t.doc_type} value={t.doc_type}>{t.name}</Select.Option>
                                                ))}
                                            </Select.OptGroup>
                                        ))}
                                    </Select>
                                </Form.Item>
                            </Col>
                        </Row>
                        <Row gutter={24} className="comparison-form-row">
                            <Col span={12}>
                                <div className="comparison-form-block">
                                    <div className="comparison-form-block-title">产品 A</div>
                                    <Form.Item label="" name="prod_a_id">
                                        <ProductVersionSelect
                                            products={data.products}
                                            allowClear
                                            disabled={!data.docTypeSelected}
                                            namePlaceholder="选择产品名称"
                                            versionPlaceholder="选择完整版本"
                                            onChange={(value) => {
                                                queryForm.setFieldValue("prod_a_id", value);
                                                dispatch({ docsA: [] });
                                                queryForm.setFieldsValue({ doc_a_id: undefined });
                                                if (value) doSearchDocs(value, "A");
                                            }}
                                        />
                                    </Form.Item>
                                    <Form.Item label="文档版本" name="doc_a_id">
                                        <Select
                                            allowClear
                                            disabled={!data.docTypeSelected}
                                            placeholder="选择文档版本"
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
                                    <div className="comparison-form-block-title">产品 B</div>
                                    <Form.Item label="" name="prod_b_id">
                                        <ProductVersionSelect
                                            products={data.products}
                                            allowClear
                                            disabled={!data.docTypeSelected}
                                            namePlaceholder="选择产品名称"
                                            versionPlaceholder="选择完整版本"
                                            onChange={(value) => {
                                                queryForm.setFieldValue("prod_b_id", value);
                                                dispatch({ docsB: [] });
                                                queryForm.setFieldsValue({ doc_b_id: undefined });
                                                if (value) doSearchDocs(value, "B");
                                            }}
                                        />
                                    </Form.Item>
                                    <Form.Item label="文档版本" name="doc_b_id">
                                        <Select
                                            allowClear
                                            disabled={!data.docTypeSelected}
                                            placeholder="选择文档版本"
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
                            <Button type="primary" htmlType="submit" loading={data.loading}>
                                开始比对
                            </Button>
                        </div>
                    </Form>
                </div>
                <div className="doc-section">
                    <Spin spinning={data.loading}>
                        {data.rows.length > 0 && (
                            <div style={{ marginBottom: 8, color: "#888", fontSize: 13 }}>
                                共 {data.rows.length} 项比对结果
                                &nbsp;|&nbsp;
                                不同项：{data.rows.filter((r: any) => r.same_flag !== 1).length} 项
                            </div>
                        )}
                        <div className="comparison-table-wrap">
                            <table className="comparison-plain-table">
                                <thead>
                                    <tr>
                                        <th>比对项目</th>
                                        <th>版本 A（旧版）</th>
                                        <th>版本 B（新版）</th>
                                        <th>状态</th>
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
                                                <span className="comparison-cell-text" style={{ whiteSpace: "pre-wrap" }}>{toCellText(row.values?.[0])}</span>
                                            </td>
                                            <td title={toCellText(row.values?.[1])}>
                                                <span className="comparison-cell-text" style={{ whiteSpace: "pre-wrap" }}>{toCellText(row.values?.[1])}</span>
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
                                            <td colSpan={4} className="comparison-empty-cell">请选择文档名称、产品和版本后点击"开始比对"</td>
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
