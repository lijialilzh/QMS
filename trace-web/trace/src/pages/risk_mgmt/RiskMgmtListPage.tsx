import { Button, Col, Form, Input, Modal, Row, Select, Space, Table, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiRiskMgmtDoc";
import * as ApiProduct from "@/api/ApiProduct";

const pageSizeOptions = [20, 50, 100];

type PageKind = "analysis" | "control";

type Props = {
    kind: PageKind;
};

const riskRates = [1, 2, 3, 4, 5].map((value) => ({ label: String(value), value }));
const yesNoOptions = [
    { label: "是", value: 1 },
    { label: "否", value: 0 },
];

enum DlgTypes {
    edit = "edit",
    delete = "delete",
}

const loadProducts = (data: any, dispatch: any) => {
    if ((data.products || []).length > 0) return;
    ApiProduct.list_product({ page_index: 0, page_size: 10000 }).then((res: any) => {
        if (res.code === Api.C_OK) {
            dispatch({ products: res.data.rows || [] });
        } else {
            message.error(res.msg);
        }
    });
};

const loadDocs = (productId: number | undefined, dispatch: any) => {
    if (!productId) {
        dispatch({ docs: [] });
        return;
    }
    Api.list_risk_mgmt_doc({ product_id: productId, page_index: 0, page_size: 10000 }).then((res: any) => {
        if (res.code === Api.C_OK) {
            dispatch({ docs: res.data.rows || [] });
        } else {
            dispatch({ docs: [] });
            message.error(res.msg);
        }
    });
};

const field = (name: string, label: string, node?: any, rules?: any[]) => (
    <Col span={12}>
        <Form.Item name={name} label={label} rules={rules}>
            {node || <Input allowClear />}
        </Form.Item>
    </Col>
);

export default ({ kind }: Props) => {
    const { t: ts } = useTranslation();
    const [queryForm] = Form.useForm();
    const [editForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        products: [],
        docs: [],
        targetRow: {},
    });

    const apiList = kind === "analysis" ? Api.list_risk_analysis : Api.list_risk_control;
    const apiAdd = kind === "analysis" ? Api.add_risk_analysis : Api.add_risk_control;
    const apiUpdate = kind === "analysis" ? Api.update_risk_analysis : Api.update_risk_control;
    const apiDelete = kind === "analysis" ? Api.delete_risk_analysis : Api.delete_risk_control;
    const title = kind === "analysis" ? "风险分析矩阵" : "风险控制措施库";
    const codeField = kind === "analysis" ? "haz_code" : "rcm_code";
    const codeLabel = kind === "analysis" ? "HAZ编号" : "RCM编号";

    const doSearch = (params: any = queryForm.getFieldsValue(), pageIndex = data.pageIndex, pageSize = data.pageSize) => {
        dispatch({ loading: true });
        apiList({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, total: res.data.total, rows: res.data.rows || [], pageIndex, pageSize });
            } else {
                dispatch({ loading: false, total: 0, rows: [] });
                message.error(res.msg);
            }
        });
    };

    useEffect(() => {
        loadProducts(data, dispatch);
        doSearch({}, 1, data.pageSize);
    }, []);

    const openEdit = (row?: any) => {
        const isAdd = !row;
        editForm.resetFields();
        const queryValues = queryForm.getFieldsValue();
        const formValues = isAdd ? { product_id: queryValues.product_id, doc_id: queryValues.doc_id } : row;
        if (formValues.product_id) {
            loadDocs(formValues.product_id, dispatch);
        }
        editForm.setFieldsValue(formValues);
        dispatch({ dlgType: DlgTypes.edit, targetRow: row || {}, editMode: isAdd ? "add" : "edit" });
    };

    const doSave = () => {
        editForm.validateFields().then((values) => {
            dispatch({ saving: true });
            const request = data.editMode === "edit" ? apiUpdate({ ...data.targetRow, ...values }) : apiAdd(values);
            request.then((res: any) => {
                dispatch({ saving: false });
                if (res.code === Api.C_OK) {
                    message.success(ts("save_success"));
                    dispatch({ dlgType: null });
                    doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
                } else {
                    message.error(res.msg);
                }
            });
        });
    };

    const doDelete = () => {
        dispatch({ loading: true });
        apiDelete({ id: data.targetRow.id }).then((res: any) => {
            dispatch({ loading: false });
            if (res.code === Api.C_OK) {
                message.success(ts("save_success"));
                dispatch({ dlgType: null });
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                message.error(res.msg);
            }
        });
    };

    const commonColumns: any[] = [
        { title: "产品名称", dataIndex: "product_name", width: 160 },
        { title: "完整版本", dataIndex: "product_full_version", width: 150 },
        { title: "报告版本", dataIndex: "doc_version", width: 120 },
        { title: codeLabel, dataIndex: codeField, width: 130 },
    ];

    const columns: any[] = kind === "analysis" ? [
        ...commonColumns,
        { title: "危险源", dataIndex: "source", width: 160, render: (v: any) => renderOneLineWithTooltip(v) },
        { title: "事件序列", dataIndex: "event_sequence", width: 180, render: (v: any) => renderOneLineWithTooltip(v) },
        { title: "危险情况", dataIndex: "hazard_situation", width: 180, render: (v: any) => renderOneLineWithTooltip(v) },
        { title: "伤害", dataIndex: "harm", width: 160, render: (v: any) => renderOneLineWithTooltip(v) },
        { title: "初始风险", width: 160, render: (_: any, row: any) => [row.init_rate, row.init_degree, row.init_level].filter(Boolean).join(" / ") },
        { title: "风险控制措施", dataIndex: "control_measures", width: 200, render: (v: any) => renderOneLineWithTooltip(v) },
        { title: "RCM ID", dataIndex: "rcm_codes", width: 150, render: (v: any) => renderOneLineWithTooltip(v) },
        { title: "验证证据", dataIndex: "verification_evidence", width: 180, render: (v: any) => renderOneLineWithTooltip(v) },
        { title: "剩余风险", width: 160, render: (_: any, row: any) => [row.residual_rate, row.residual_degree, row.residual_level].filter(Boolean).join(" / ") },
        { title: "收益>风险", dataIndex: "benefit_flag", width: 110, render: (v: any) => (v ? "是" : "否") },
        { title: "分类", dataIndex: "category", width: 120 },
    ] : [
        ...commonColumns,
        { title: "控制措施描述", dataIndex: "description", width: 260, render: (v: any) => renderOneLineWithTooltip(v) },
        { title: "关联HAZ编号", dataIndex: "hazard_codes", width: 180, render: (v: any) => renderOneLineWithTooltip(v) },
        { title: "验证证据", dataIndex: "verification_evidence", width: 220, render: (v: any) => renderOneLineWithTooltip(v) },
        { title: "是否引入新风险", dataIndex: "new_risk_flag", width: 140, render: (v: any) => (v ? "是" : "否") },
        { title: "备注", dataIndex: "note", width: 180, render: (v: any) => renderOneLineWithTooltip(v) },
    ];

    columns.push({
        title: ts("action"),
        width: 130,
        fixed: "right",
        render: (_: any, row: any) => (
            <Space size={4}>
                <Button size="small" type="primary" onClick={() => openEdit(row)}>{ts("edit")}</Button>
                <Button size="small" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>{ts("delete")}</Button>
            </Space>
        ),
    });

    return (
        <div className="page div-v">
            <div className="div-h searchbar list-searchbar-align">
                <Form form={queryForm} className="expand" onFinish={(values) => doSearch(values, 1, data.pageSize)}>
                    <Row gutter={10}>
                        <Col span={8}>
                            <Form.Item name="product_id">
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => {
                                        queryForm.setFieldValue("product_id", value);
                                        queryForm.setFieldValue("doc_id", undefined);
                                        loadDocs(value, dispatch);
                                    }}
                                />
                            </Form.Item>
                        </Col>
                        <Col span={6}>
                            <Form.Item name="doc_id">
                                <Select
                                    allowClear
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="风险管理报告版本"
                                    options={(data.docs || []).map((doc: any) => ({ label: doc.version, value: doc.id }))}
                                />
                            </Form.Item>
                        </Col>
                        <Col span={5}>
                            <Form.Item name="keyword">
                                <Input allowClear placeholder="编号/内容" />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button icon={<SearchOutlined />} type="primary" htmlType="submit">{ts("fuzzy")}</Button>
                        </Col>
                    </Row>
                </Form>
                <Button type="primary" onClick={() => openEdit()}>{ts("add")}</Button>
            </div>
            <Table
                className="expand"
                rowKey="id"
                loading={data.loading}
                columns={columns}
                dataSource={data.rows}
                scroll={{ x: kind === "analysis" ? 2450 : 1500, y: "calc(100vh - 250px)" }}
                pagination={{
                    current: data.pageIndex,
                    total: data.total,
                    pageSize: data.pageSize,
                    showSizeChanger: true,
                    pageSizeOptions,
                    onChange: (page, pageSize) => doSearch(queryForm.getFieldsValue(), page, pageSize),
                }}
            />
            <Modal
                width={kind === "analysis" ? "78%" : "62%"}
                centered
                title={`${data.editMode === "edit" ? ts("edit") : ts("add")}${title}`}
                open={data.dlgType === DlgTypes.edit}
                confirmLoading={data.saving}
                onOk={doSave}
                onCancel={() => dispatch({ dlgType: null })}>
                <Form form={editForm} layout="vertical">
                    <Row gutter={16}>
                        {field("product_id", "产品", <ProductVersionSelect
                            products={data.products}
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.full_version")}
                            onChange={(value) => {
                                editForm.setFieldValue("product_id", value);
                                editForm.setFieldValue("doc_id", undefined);
                                loadDocs(value, dispatch);
                            }}
                        />, [{ required: true, message: sprintf(ts("msg_select"), { label: "产品" }) }])}
                        {field("doc_id", "风险管理报告版本", <Select
                            showSearch
                            optionFilterProp="label"
                            placeholder="请选择风险管理报告版本"
                            options={(data.docs || []).map((doc: any) => ({ label: doc.version, value: doc.id }))}
                        />, [{ required: true, message: sprintf(ts("msg_select"), { label: "风险管理报告版本" }) }])}
                        {field(codeField, codeLabel, undefined, [{ required: true, message: sprintf(ts("msg_input"), { label: codeLabel }) }])}
                        {kind === "analysis" ? (
                            <>
                                {field("source", "危险源")}
                                {field("event_sequence", "事件序列", <Input.TextArea rows={2} />)}
                                {field("hazard_situation", "危险情况", <Input.TextArea rows={2} />)}
                                {field("harm", "伤害", <Input.TextArea rows={2} />)}
                                {field("init_rate", "初始风险概率", <Select allowClear options={riskRates} />)}
                                {field("init_degree", "初始危害程度")}
                                {field("init_level", "初始风险水平")}
                                {field("control_measures", "风险控制措施", <Input.TextArea rows={3} />)}
                                {field("rcm_codes", "RCM ID")}
                                {field("verification_evidence", "验证证据", <Input.TextArea rows={2} />)}
                                {field("residual_rate", "剩余风险概率", <Select allowClear options={riskRates} />)}
                                {field("residual_degree", "剩余危害程度")}
                                {field("residual_level", "剩余风险水平")}
                                {field("benefit_flag", "收益是否大于风险", <Select allowClear options={yesNoOptions} />)}
                                {field("category", "分类")}
                            </>
                        ) : (
                            <>
                                {field("description", "控制措施描述", <Input.TextArea rows={4} />)}
                                {field("hazard_codes", "关联HAZ编号")}
                                {field("verification_evidence", "验证证据", <Input.TextArea rows={3} />)}
                                {field("new_risk_flag", "是否引入新风险", <Select allowClear options={yesNoOptions} />)}
                                {field("note", "备注", <Input.TextArea rows={2} />)}
                            </>
                        )}
                    </Row>
                </Form>
            </Modal>
            <Modal
                title={ts("tips")}
                open={data.dlgType === DlgTypes.delete}
                confirmLoading={data.loading}
                onOk={doDelete}
                onCancel={() => dispatch({ dlgType: null })}>
                {ts("confirm_delete")}
            </Modal>
        </div>
    );
};
