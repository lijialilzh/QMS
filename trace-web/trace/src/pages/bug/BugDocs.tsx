import { Button, Col, Form, Input, Modal, Row, Select, Space, Spin, Table, Tabs, Upload, message } from "antd";
import { SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import { createDocBatchDelete, getDocTableRowSelection } from "../doc_shared/docBatchDelete";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiBugDoc";
import * as ApiProduct from "@/api/ApiProduct";
import "../risk_mgmt/RiskMgmtDocs.less";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
}

const loadProducts = (data: any, dispatch: any) => {
    if (data.products.length > 0) return;
    ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
        if (res.code === Api.C_OK) dispatch({ products: res.data.rows || [] });
        else message.error(res.msg);
    });
};

export default () => {
    const { t: ts } = useTranslation();
    const [queryForm] = Form.useForm();
    const [addForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0, pageIndex: 1, pageSize: pageSizeOptions[0], rows: [], products: [],
        versionOptions: [] as { value: string; label: string }[],
        uploadFile: null as any, targetRow: {} as any, adding: false,
        editingFileNoId: 0, editingFileNoValue: "", savingFileNoId: 0,
        previewOpen: false, previewLoading: false, previewSheets: [] as any[], previewName: "",
    });

    const productId = Form.useWatch("product_id", queryForm);
    useEffect(() => {
        if (!productId) { queryForm.setFieldValue("version", undefined); dispatch({ versionOptions: [] }); return; }
        Api.list_bug_doc({ product_id: productId, page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK && res.data?.rows?.length) {
                const versions = [...new Set((res.data.rows as any[]).map((r: any) => r.version).filter(Boolean))].sort();
                dispatch({ versionOptions: versions.map((v: string) => ({ value: v, label: v })) });
            } else dispatch({ versionOptions: [] });
        }).catch(() => dispatch({ versionOptions: [] }));
    }, [productId]);

    const doSearch = (params: any = {}, pageIndex: any = data.pageIndex, pageSize: any = data.pageSize) => {
        dispatch({ loading: true });
        Api.list_bug_doc({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ loading: false, total: res.data.total, rows: res.data.rows || [], pageIndex, pageSize });
            else { dispatch({ loading: false, rows: [], total: 0 }); message.error(res.msg); }
        });
    };

    useEffect(() => { loadProducts(data, dispatch); doSearch({}, 1, data.pageSize); }, []);

    const openAdd = () => {
        addForm.resetFields();
        addForm.setFieldValue("version", "A0");
        dispatch({ dlgType: DlgTypes.add, uploadFile: null, targetRow: {} });
        loadProducts(data, dispatch);
    };
    const openEdit = (row: any) => {
        loadProducts(data, dispatch);
        addForm.resetFields();
        addForm.setFieldsValue({ product_id: row.product_id, version: row.version, file_no: row.file_no, change_log: row.change_log });
        dispatch({ dlgType: DlgTypes.edit, uploadFile: null, targetRow: row });
    };

    const doSave = () => {
        addForm.validateFields().then((values) => {
            const isEdit = data.dlgType === DlgTypes.edit;
            if (!isEdit && !data.uploadFile) { message.warning("请选择要上传的文件"); return; }
            dispatch({ adding: true });
            const payload: any = { ...values };
            if (data.uploadFile) payload.file = data.uploadFile;
            if (isEdit) payload.id = data.targetRow.id;
            const fn = isEdit ? Api.update_bug_doc : Api.add_bug_doc;
            fn(payload).then((res: any) => {
                dispatch({ adding: false });
                if (res.code === Api.C_OK) {
                    message.success(ts("save_success"));
                    dispatch({ dlgType: null, uploadFile: null });
                    doSearch(queryForm.getFieldsValue(), isEdit ? data.pageIndex : 1, data.pageSize);
                } else message.error(res.msg);
            });
        });
    };

    const doDelete = () => {
        dispatch({ loading: true });
        Api.delete_bug_doc({ id: data.targetRow.id }).then((res: any) => {
            if (res.code === Api.C_OK) { message.success(ts("save_success")); dispatch({ dlgType: null, loading: false }); doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize); }
            else { dispatch({ loading: false }); message.error(res.msg); }
        });
    };

    const doBatchDelete = createDocBatchDelete({
        ts,
        dispatch,
        data,
        deleteFn: Api.delete_bug_doc,
        cOk: Api.C_OK,
        onRefresh: () => doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize),
    });

    const doDownload = (row: any) => {
        // 大文件用浏览器原生下载（带 cookie），边下边显示进度，避免前端 blob 缓冲卡顿
        const a = document.createElement("a");
        a.href = `/trace-api/bug_doc/download_bug_doc?id=${row.id}`;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    const doPreview = async (row: any) => {
        dispatch({ previewOpen: true, previewLoading: true, previewSheets: [], previewName: row.file_name || "" });
        const res: any = await Api.preview_bug_doc({ id: row.id });
        if (res.code === Api.C_OK) dispatch({ previewLoading: false, previewSheets: res.data?.sheets || [], previewName: res.data?.file_name || "" });
        else { dispatch({ previewLoading: false }); message.error(res.msg || "预览失败"); }
    };

    const handleSaveFileNo = async (row: any) => {
        if (!data.editingFileNoId || data.editingFileNoId !== row.id) return;
        const next = String(data.editingFileNoValue || "").trim();
        if (next === String(row.file_no || "").trim()) { dispatch({ editingFileNoId: 0, editingFileNoValue: "" }); return; }
        const res: any = await Api.update_bug_doc({ id: row.id, file_no: next });
        if (res.code === Api.C_OK) {
            dispatch({ rows: (data.rows || []).map((it: any) => (it.id === row.id ? { ...it, file_no: next } : it)), editingFileNoId: 0, editingFileNoValue: "" });
            message.success("文件编号已保存");
        } else message.error(res.msg || "保存失败");
    };

    const statText = (s: any) => (s ? `总${s.total || 0} / 遗留${s.remaining || 0}` : "-");

    const columns: any[] = [
        { title: ts("product.name"), dataIndex: "product_name", width: "15%" },
        { title: ts("product.version"), dataIndex: "product_full_version", width: "10%" },
        { title: "文档版本", dataIndex: "version", width: "7%" },
        {
            title: "文件编号", dataIndex: "file_no", width: "15%",
            render: (value: string, row: any) => (
                data.editingFileNoId === row.id
                    ? <Input autoFocus size="small" value={data.editingFileNoValue}
                        onChange={(e) => dispatch({ editingFileNoValue: e.target.value })}
                        onBlur={() => handleSaveFileNo(row)} onPressEnter={() => handleSaveFileNo(row)} />
                    : <span className="risk-doc-file-no-cell" title="单击编辑文件编号"
                        onClick={() => dispatch({ editingFileNoId: row.id, editingFileNoValue: row.file_no || "" })}>{value || "-"}</span>
            ),
        },
        { title: "原始文件", dataIndex: "file_name", width: "16%", render: (v: string) => v || "-" },
        { title: "缺陷统计", dataIndex: "stats", width: "11%", render: (s: any) => statText(s) },
        { title: ts("create_time"), dataIndex: "create_time", width: "12%" },
        {
            title: ts("action"), width: "20%", className: "risk-doc-action-col",
            render: (_: any, row: any) => (
                <Space size={4} className="risk-doc-action-space">
                    <Button type="link" size="small" onClick={() => doPreview(row)}>查看</Button>
                    <Button type="link" size="small" onClick={() => doDownload(row)}>下载</Button>
                    <Button type="link" size="small" onClick={() => openEdit(row)}>重新上传</Button>
                    <Button type="link" size="small" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>{ts("delete")}</Button>
                </Space>
            ),
        },
    ].map((col: any) => ({ ...col, onHeaderCell: () => ({ style: { whiteSpace: "nowrap" } }) }));

    return (
        <div className="div-v page">
            <div className="div-h searchbar list-searchbar-align">
                <Form form={queryForm} className="expand" onFinish={(values) => doSearch(values, 1, data.pageSize)}>
                    <Row gutter={20}>
                        <Col>
                            <Form.Item label={ts("srs_doc.select_product")} name="product_id">
                                <ProductVersionSelect products={data.products} allowClear namePlaceholder={ts("product.name")} versionPlaceholder={ts("product.full_version")} onChange={(v) => queryForm.setFieldValue("product_id", v)} />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Form.Item label={ts("srs_doc.doc_version")} name="version">
                                <Select placeholder={ts("srs_doc.please_select_doc_version")} allowClear options={data.versionOptions} />
                            </Form.Item>
                        </Col>
                        <Col><Button shape="circle" icon={<SearchOutlined />} htmlType="submit" /></Col>
                    </Row>
                </Form>
                <Space>
                    <Button onClick={async () => { const r: any = await Api.download_bug_template(); if (r && r.code !== Api.C_OK) message.error(r.msg || "下载失败"); }}>下载模版</Button>
                    <Button type="primary" onClick={openAdd}>上传</Button>
                                    <Button disabled={!(data.selectedRowKeys || []).length} danger onClick={doBatchDelete}>
                        {ts("batch_delete")}
                    </Button>
                </Space>
            </div>
            <Table
                rowSelection={getDocTableRowSelection(data, dispatch)}
                className="expand risk-doc-table" rowKey="id" loading={data.loading} columns={columns} dataSource={data.rows} tableLayout="fixed"
                pagination={{
                    total: data.total, current: data.pageIndex, showSizeChanger: true, defaultPageSize: pageSizeOptions[0], pageSizeOptions, hideOnSinglePage: false,
                    onShowSizeChange: (page, pageSize) => dispatch({ pageIndex: page, pageSize }),
                    showTotal: (total: number) => sprintf(ts("total_items"), { total }),
                }}
                onChange={(pager) => doSearch(queryForm.getFieldsValue(), pager.current, pager.pageSize)} />
            <Modal width={620} centered title={data.dlgType === DlgTypes.edit ? "重新上传 / 编辑信息" : "上传Bug管理及回归测试"}
                open={data.dlgType === DlgTypes.add || data.dlgType === DlgTypes.edit} confirmLoading={data.adding} onOk={doSave} maskClosable={false}
                onCancel={() => { dispatch({ dlgType: null, uploadFile: null }); addForm.resetFields(); }}>
                <Form form={addForm} layout="vertical">
                    <Form.Item label={ts("product.product")} name="product_id" rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                        <ProductVersionSelect products={data.products} namePlaceholder={ts("product.name")} versionPlaceholder={ts("product.full_version")} onChange={(v) => addForm.setFieldValue("product_id", v)} />
                    </Form.Item>
                    <Form.Item label="文档版本" name="version" rules={[{ required: true, message: sprintf(ts("msg_input"), { label: "文档版本" }) }]}>
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item label="文件编号" name="file_no"><Input allowClear /></Form.Item>
                    <Form.Item label="变更说明" name="change_log"><Input.TextArea rows={2} allowClear /></Form.Item>
                    <Form.Item label={data.dlgType === DlgTypes.edit ? "重新上传文件（可选，不选则保留原文件）" : "上传文件（.xlsx）"}>
                        <Upload beforeUpload={(f) => { dispatch({ uploadFile: f }); return false; }} maxCount={1} accept=".xlsx,.xls"
                            onRemove={() => dispatch({ uploadFile: null })}
                            fileList={data.uploadFile ? [{ uid: "-1", name: data.uploadFile.name }] as any : []}>
                            <Button icon={<UploadOutlined />}>选择文件</Button>
                        </Upload>
                    </Form.Item>
                </Form>
            </Modal>
            <Modal centered title={ts("action")} open={data.dlgType === DlgTypes.delete} maskClosable={false} confirmLoading={data.loading} onOk={doDelete} onCancel={() => dispatch({ dlgType: null })}>
                {ts("confirm_delete")}
            </Modal>
            <Modal width={"92%"} centered title={`在线查看 ${data.previewName || ""}`} open={data.previewOpen} footer={null}
                onCancel={() => dispatch({ previewOpen: false, previewSheets: [] })}>
                <Spin spinning={data.previewLoading}>
                    <div style={{ maxHeight: "72vh", overflow: "auto" }}>
                        <Tabs items={(data.previewSheets || []).map((sh: any, si: number) => ({
                            key: String(si),
                            label: sh.name,
                            children: (
                                <div style={{ overflow: "auto", maxHeight: "62vh" }}>
                                    <table style={{ borderCollapse: "collapse", fontSize: 12, width: "max-content" }}>
                                        <tbody>
                                            {(sh.rows || []).map((r: any[], ri: number) => (
                                                <tr key={ri}>
                                                    {r.map((c: any, ci: number) => (
                                                        <td key={ci} style={{
                                                            border: "1px solid #e0e0e0", padding: "4px 8px", verticalAlign: "top",
                                                            whiteSpace: "pre-wrap", maxWidth: 320,
                                                            background: ri === 0 ? "#fafafa" : undefined, fontWeight: ri === 0 ? 600 : undefined,
                                                        }}>{typeof c === "string" && c.startsWith("data:image")
                                                            ? <img src={c} alt="签名" style={{ height: 40, objectFit: "contain" }} />
                                                            : c}</td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ),
                        }))} />
                    </div>
                    <div style={{ color: "#999", marginTop: 8 }}>提示：在线预览为文字表格，bug 描述中的截图请点「下载」用 Excel 查看。</div>
                </Spin>
            </Modal>
        </div>
    );
};
