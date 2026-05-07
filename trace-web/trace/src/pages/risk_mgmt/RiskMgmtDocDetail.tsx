import { Button, Card, Form, Input, Space, Table, message } from "antd";
import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { sprintf } from "sprintf-js";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiRiskMgmtDoc";
import * as ApiProduct from "@/api/ApiProduct";
import "./RiskMgmtDocDetail.less";

const emptyContent = {
    sections: [],
    participants: [],
    riskMatrix: [],
    riskControls: [],
};

const templateContent = {
    sections: [
        { title: "1 目的", children: [] },
        { title: "2 范围", children: [] },
        {
            title: "3 产品描述",
            children: [
                { title: "3.1 产品预期用途", children: [] },
                { title: "3.2 产品功能描述", children: [] },
            ],
        },
        {
            title: "4 评审",
            children: [
                { title: "4.1 评审数据", children: [] },
                { title: "4.2 风险分析参与人员", ref_type: "participants", children: [] },
                { title: "4.3 审评历史", children: [] },
            ],
        },
        {
            title: "5 风险分析方式",
            children: [
                {
                    title: "5.1 危害识别",
                    children: [
                        { title: "5.1.1 与合理可预见相关的环境相关的危害", children: [] },
                        { title: "5.1.2 考虑的危害包括", children: [] },
                        { title: "5.1.3 危害初步原因的考虑应包括", children: [] },
                        { title: "5.1.4 危害重点考虑的原因应包括", children: [] },
                    ],
                },
                {
                    title: "5.2 风险评价准则",
                    children: [
                        { title: "5.2.1 严重度定义", children: [] },
                        { title: "5.2.2 发生概率定义", children: [] },
                        { title: "5.2.3 接受标准", children: [] },
                    ],
                },
            ],
        },
        {
            title: "6 风险分析",
            children: [
                { title: "6.1 与安全有关特征的问题识别", children: [] },
                { title: "6.2 已知或可预见的危险（源）识别", children: [] },
                { title: "6.3 估计每个危险情况的风险", children: [] },
                { title: "6.4 风险评价", ref_type: "risk_analysis", children: [] },
                {
                    title: "6.5 风险控制",
                    ref_type: "risk_controls",
                    children: [
                        { title: "6.5.1 风险控制方案分析", children: [] },
                        { title: "6.5.2 风险控制措施的实施", children: [] },
                        { title: "6.5.3 剩余风险分析和风险/受益分析", children: [] },
                        { title: "6.5.4 由风险控制措施产生的风险", children: [] },
                    ],
                },
            ],
        },
        {
            title: "7 风险的可接受性评价",
            children: [
                { title: "7.1 RCMs实施风险控制措施前/后的风险分布", children: [] },
                { title: "7.2 综合剩余风险评价", children: [] },
                { title: "7.3 软件安全级别判定", children: [] },
            ],
        },
        { title: "8 生产和生产后活动", children: [] },
        { title: "9 结论", children: [] },
        { title: "10 参考标准", children: [] },
        { title: "11 风险管理文件", children: [] },
        { title: "附录A 与安全有关特征的问题识别", children: [] },
        { title: "附录B 风险分析矩阵", ref_type: "risk_analysis", children: [] },
    ],
    participants: [],
    riskMatrix: [],
    riskControls: [],
};

const makeRowKey = () => `${Date.now()}-${Math.random()}`;
const cloneTemplateContent = () => JSON.parse(JSON.stringify(templateContent));

const SectionList = ({ sections, depth = 0 }: { sections: any[]; depth?: number }) => {
    return (
        <>
            {(sections || []).map((section: any) => (
                <div key={section.title}>
                    <div
                        className={`risk-mgmt-section-item ${section.ref_type ? "active" : ""}`}
                        style={{ marginLeft: depth * 14 }}>
                        {section.title}
                    </div>
                    <SectionList sections={section.children || []} depth={depth + 1} />
                </div>
            ))}
        </>
    );
};

const loadProducts = (data: any, dispatch: any) => {
    if ((data.products || []).length > 0) return;
    ApiProduct.list_product({ page_index: 0, page_size: 10000 }).then((res: any) => {
        if (res.code === Api.C_OK) {
            dispatch({ products: res.data.rows || [] });
        }
    });
};

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const params = useParams();
    const location = useLocation();
    const isAdd = location.pathname.includes("/add");
    const isView = location.pathname.includes("/view/");
    const [form] = Form.useForm();
    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        detail: {},
        content: emptyContent,
        participants: [],
        products: [],
    });

    useEffect(() => {
        loadProducts(data, dispatch);
        if (isAdd) {
            form.resetFields();
            dispatch({ detail: {}, content: emptyContent, participants: [] });
            return;
        }
        if (!params.id) return;
        dispatch({ loading: true });
        Api.get_risk_mgmt_doc({ id: params.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const detail = res.data || {};
                const content = detail.content || emptyContent;
                const participants = (content.participants || []).map((row: any) => ({ ...row, _rowKey: makeRowKey() }));
                form.setFieldsValue(detail);
                dispatch({ loading: false, detail, content: { ...emptyContent, ...content }, participants });
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    }, [params.id, isAdd]);

    const updateParticipant = (rowKey: string, key: string, value: string) => {
        const participants = (data.participants || []).map((row: any) => (
            row._rowKey === rowKey ? { ...row, [key]: value } : row
        ));
        dispatch({ participants });
    };

    const doSave = () => {
        form.validateFields().then((values) => {
            const participants = (data.participants || []).map(({ _rowKey, ...row }: any) => row);
            const content = { ...(data.content || emptyContent), participants };
            dispatch({ saving: true });
            const request = isAdd
                ? Api.add_risk_mgmt_doc({ ...values, content })
                : Api.update_risk_mgmt_doc({ ...data.detail, ...values, content });
            request.then((res: any) => {
                dispatch({ saving: false });
                if (res.code === Api.C_OK) {
                    message.success(ts("save_success"));
                    navigate("/risk_mgmt_docs");
                } else {
                    message.error(res.msg);
                }
            });
        });
    };

    const initTemplate = () => {
        dispatch({ content: cloneTemplateContent(), participants: [] });
        message.success("初始化模版成功");
    };

    const participantColumns: any[] = [
        { title: "序号", width: 70, render: (_: any, _row: any, index: number) => index + 1 },
        {
            title: "姓名",
            dataIndex: "name",
            width: 180,
            render: (value: string, row: any) => (
                <Input
                    disabled={isView}
                    value={value}
                    onChange={(e) => updateParticipant(row._rowKey, "name", e.target.value)}
                />
            ),
        },
        {
            title: "部门/岗位",
            dataIndex: "role",
            width: 220,
            render: (value: string, row: any) => (
                <Input
                    disabled={isView}
                    value={value}
                    onChange={(e) => updateParticipant(row._rowKey, "role", e.target.value)}
                />
            ),
        },
        {
            title: "职责",
            dataIndex: "responsibility",
            render: (value: string, row: any) => (
                <Input.TextArea
                    disabled={isView}
                    autoSize
                    value={value}
                    onChange={(e) => updateParticipant(row._rowKey, "responsibility", e.target.value)}
                />
            ),
        },
        {
            title: ts("action"),
            width: 90,
            render: (_: any, row: any) => (
                <Button
                    size="small"
                    danger
                    disabled={isView}
                    onClick={() => dispatch({ participants: data.participants.filter((item: any) => item._rowKey !== row._rowKey) })}>
                    {ts("delete")}
                </Button>
            ),
        },
    ];

    return (
        <div className="risk-mgmt-detail div-v">
            <div className="risk-mgmt-detail-toolbar div-h center-v">
                <Button onClick={() => navigate("/risk_mgmt_docs")}>{ts("back")}</Button>
                <div className="expand" />
                {!isView && (
                    <Space>
                        <Button onClick={initTemplate}>初始化模版</Button>
                        <Button type="primary" loading={data.saving} onClick={doSave}>
                            {ts("save")}
                        </Button>
                    </Space>
                )}
            </div>
            <Form form={form} layout="vertical" disabled={isView}>
                <Card title="基础信息" loading={data.loading}>
                    <div className="risk-mgmt-basic-grid">
                        {isAdd ? (
                            <Form.Item
                                label={ts("product.product")}
                                name="product_id"
                                rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                                <ProductVersionSelect
                                    products={data.products}
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => form.setFieldValue("product_id", value)}
                                />
                            </Form.Item>
                        ) : (
                            <>
                                <Form.Item label={ts("product.name")} name="product_name">
                                    <Input disabled />
                                </Form.Item>
                                <Form.Item label={ts("product.type_code")} name="product_type_code">
                                    <Input disabled />
                                </Form.Item>
                                <Form.Item label={ts("product.full_version")} name="product_full_version">
                                    <Input disabled />
                                </Form.Item>
                            </>
                        )}
                        <Form.Item
                            label={ts("risk_mgmt_doc.version")}
                            name="version"
                            rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("risk_mgmt_doc.version") }) }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item label={ts("risk_mgmt_doc.file_no")} name="file_no">
                            <Input />
                        </Form.Item>
                    </div>
                    <Form.Item label={ts("risk_mgmt_doc.change_log")} name="change_log">
                        <Input.TextArea autoSize />
                    </Form.Item>
                </Card>
            </Form>
            <div className="risk-mgmt-body">
                <Card title="目录结构">
                    <div className="risk-mgmt-section-list">
                        {(data.content.sections || []).length ? (
                            <SectionList sections={data.content.sections || []} />
                        ) : (
                            <div className="empty">暂无目录结构，请点击初始化模版</div>
                        )}
                    </div>
                </Card>
                <Card
                    title="风险管理参与人员"
                    extra={!isView && (
                        <Space>
                            <Button
                                type="primary"
                                onClick={() => dispatch({
                                    participants: [
                                        ...(data.participants || []),
                                        { _rowKey: makeRowKey(), name: "", role: "", responsibility: "" },
                                    ],
                                })}>
                                新增参与人员
                            </Button>
                        </Space>
                    )}>
                    <Table
                        rowKey="_rowKey"
                        pagination={false}
                        columns={participantColumns}
                        dataSource={data.participants}
                        scroll={{ x: 900 }}
                    />
                </Card>
            </div>
        </div>
    );
};
