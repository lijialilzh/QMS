import { Button, Col, Form, Input, Modal, Row, Select, Space, Table, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiQaDoc";
import * as ApiProduct from "@/api/ApiProduct";
import { sanitizeListQuery } from "../doc_shared/sanitizeListQuery";
import "../risk_mgmt/RiskMgmtDocs.less";

const pageSizeOptions = [20, 50, 100];

export const QA_KINDS: Record<string, string> = {
    output_review: "设计开发输出评审",
    inspect_spec: "成品检验规程",
    inspect_record: "成品检验记录",
    change_close: "变更评估及关闭表",
};

export default () => {
    const { t: ts } = useTranslation();
    const { kind = "" } = useParams();
    const navigate = useNavigate();
    const [queryForm] = Form.useForm();
    const [addForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [] as any[],
        products: [] as any[],
        versionOptions: [] as { value: string; label: string }[],
        open: false,
        adding: false,
        exportingId: 0,
        editingFileNoId: 0,
        editingFileNoValue: "",
        savingFileNoId: 0,
    });
    const title = QA_KINDS[kind] || "质量文件";

    useEffect(() => {
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data.rows || [] });
        });
    }, []);

    const doSearch = (params: any = {}, pageIndex = data.pageIndex, pageSize = data.pageSize) => {
        if (!QA_KINDS[kind]) return;
        dispatch({ loading: true });
        Api.list_qa_doc({ ...sanitizeListQuery(params), kind, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, total: res.data.total, rows: res.data.rows || [], pageIndex, pageSize });
            } else {
                dispatch({ loading: false, rows: [], total: 0 });
                message.error(res.msg);
            }
        }).catch(() => dispatch({ loading: false }));
    };

    const productId = Form.useWatch("product_id", queryForm);
    useEffect(() => {
        if (!productId || !QA_KINDS[kind]) {
            queryForm.setFieldValue("version", undefined);
            dispatch({ versionOptions: [] });
            return;
        }
        Api.list_qa_doc({ kind, product_id: productId, page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK && res.data?.rows?.length) {
                const versions = [...new Set((res.data.rows as any[]).map((row: any) => row.version).filter(Boolean))].sort();
                dispatch({ versionOptions: versions.map((version: string) => ({ value: version, label: version })) });
            } else {
                dispatch({ versionOptions: [] });
            }
        }).catch(() => dispatch({ versionOptions: [] }));
    }, [productId, kind]);

    useEffect(() => {
        queryForm.resetFields();
        doSearch({}, 1, data.pageSize);
    }, [kind]);

    const doAdd = () => {
        addForm.validateFields().then((values) => {
            dispatch({ adding: true });
            Api.add_qa_doc({ ...values, kind }).then((res: any) => {
                dispatch({ adding: false });
                if (res.code === Api.C_OK) {
                    dispatch({ open: false });
                    message.success("已创建");
                    navigate(`/qa_docs/${kind}/edit/${res.data.id}`);
                } else {
                    message.error(res.msg);
                }
            }).catch(() => dispatch({ adding: false }));
        });
    };

    const doDelete = (row: any) => {
        Modal.confirm({
            title: `删除${title} ${row.version || ""}？`,
            onOk: () => Api.delete_qa_doc({ id: row.id }).then((res: any) => {
                if (res.code === Api.C_OK) {
                    message.success("已删除");
                    doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
                } else {
                    message.error(res.msg);
                }
            }),
        });
    };

    const handleStartEditFileNo = (row: any) => {
        dispatch({ editingFileNoId: row.id, editingFileNoValue: row.file_no || "" });
    };

    const handleSaveFileNo = async (row: any) => {
        if (!data.editingFileNoId || data.editingFileNoId !== row.id) return;
        if (data.savingFileNoId === row.id) return;
        const nextFileNo = String(data.editingFileNoValue || "").trim();
        const currentFileNo = String(row.file_no || "").trim();
        if (nextFileNo === currentFileNo) {
            dispatch({ editingFileNoId: 0, editingFileNoValue: "", savingFileNoId: 0 });
            return;
        }
        dispatch({ savingFileNoId: row.id });
        try {
            const res: any = await Api.update_qa_doc({ id: row.id, file_no: nextFileNo });
            if (res.code === Api.C_OK) {
                const rows = (data.rows || []).map((item: any) => (
                    item.id === row.id ? { ...item, file_no: nextFileNo } : item
                ));
                dispatch({ rows, editingFileNoId: 0, editingFileNoValue: "", savingFileNoId: 0 });
                message.success("文件编号已保存");
            } else {
                dispatch({ savingFileNoId: 0 });
                message.error(res.msg || "保存失败");
            }
        } catch (_err) {
            dispatch({ savingFileNoId: 0 });
            message.error("保存失败");
        }
    };

    const doExport = async (row: any) => {
        dispatch({ exportingId: row.id });
        try {
            const res: any = await Api.export_qa_doc({ id: row.id });
            if (res && res.code && res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_err) {
            message.error("导出失败");
        } finally {
            dispatch({ exportingId: 0 });
        }
    };

    if (!QA_KINDS[kind]) return <div>未知文档类型</div>;

    return (
        <div className="div-v page">
            <div className="div-h searchbar list-searchbar-align">
                <Form form={queryForm} className="expand" onFinish={(values) => doSearch(values, 1, data.pageSize)}>
                    <Row gutter={20}>
                        <Col>
                            <Form.Item label={ts("srs_doc.select_product")} name="product_id">
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear includeAll
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => { queryForm.setFieldValue("product_id", value); doSearch({ ...queryForm.getFieldsValue(), product_id: value }, 1, data.pageSize); }}
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
                <Button type="primary" onClick={() => { addForm.resetFields(); addForm.setFieldsValue({ version: "A0" }); dispatch({ open: true }); }}>新增</Button>
            </div>
            <Table
                className="expand risk-doc-table"
                rowKey="id"
                loading={data.loading}
                dataSource={data.rows}
                pagination={{
                    current: data.pageIndex,
                    pageSize: data.pageSize,
                    total: data.total,
                    showSizeChanger: true,
                    pageSizeOptions,
                    onChange: (page, size) => doSearch(queryForm.getFieldsValue(), page, size),
                }}
                columns={[
                    { title: "产品名称", dataIndex: "product_name" },
                    { title: "完整版本", dataIndex: "product_full_version" },
                    { title: "文档版本", dataIndex: "version" },
                    {
                        title: "文件编号",
                        dataIndex: "file_no",
                        width: "22%",
                        render: (value: string, row: any) => {
                            const isEditing = data.editingFileNoId === row.id;
                            const isSaving = data.savingFileNoId === row.id;
                            if (isEditing) {
                                return (
                                    <Input
                                        autoFocus
                                        size="small"
                                        value={data.editingFileNoValue}
                                        disabled={isSaving}
                                        onChange={(e) => dispatch({ editingFileNoValue: e.target.value })}
                                        onBlur={() => handleSaveFileNo(row)}
                                        onPressEnter={() => handleSaveFileNo(row)}
                                        placeholder="请输入文件编号"
                                    />
                                );
                            }
                            return (
                                <span
                                    className="risk-doc-file-no-cell"
                                    title="单击编辑文件编号"
                                    onClick={() => handleStartEditFileNo(row)}>
                                    {value || "-"}
                                </span>
                            );
                        },
                    },
                    {
                        title: "操作",
                        render: (_v, row) => (
                            <Space>
                                <Button type="link" onClick={() => navigate(`/qa_docs/${kind}/view/${row.id}`)}>查看</Button>
                                <Button type="link" onClick={() => navigate(`/qa_docs/${kind}/edit/${row.id}`)}>编辑</Button>
                                <Button type="link" loading={data.exportingId === row.id} onClick={() => doExport(row)}>导出</Button>
                                <Button type="link" danger onClick={() => doDelete(row)}>删除</Button>
                            </Space>
                        ),
                    },
                ]}
            />
            <Modal
                width={620}
                centered
                title={`新增${title}`}
                open={data.open}
                confirmLoading={data.adding}
                onCancel={() => dispatch({ open: false })}
                onOk={doAdd}>
                <Form form={addForm} layout="vertical">
                    <Form.Item name="product_id" label={ts("srs_doc.select_product")} rules={[{ required: true, message: "请选择产品" }]}>
                        <ProductVersionSelect
                            products={data.products}
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.full_version")}
                            onChange={(value) => addForm.setFieldValue("product_id", value)}
                        />
                    </Form.Item>
                    <Form.Item name="version" label="文档版本" rules={[{ required: true, message: "请填写文档版本" }]}>
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item name="change_log" label="变更说明">
                        <Input.TextArea rows={3} allowClear />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};
