import { Form, Input, Button, Table, message, Row, Col, Modal, Select, Upload, Space } from "antd";
import { SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect, useMemo } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiTestSet";
import * as ApiTestCase from "@/api/ApiTestCase";
import * as ApiProduct from "@/api/ApiProduct";
import TestCases from "./TestCases";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import { sanitizeListQuery } from "../doc_shared/sanitizeListQuery";
import "./TestSets.less";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
    test_cases = "test_cases",
    batch_add = "batch_add",
}

const STAGES = ["单元测试", "集成测试", "系统测试", "用户测试"];

type BatchRow = { key: string; stage: string; files: any[] };

const emptyBatchRows = (): BatchRow[] =>
    STAGES.map((_, i) => ({ key: `batch-${i}`, stage: "", files: [] }));

/** 与后端一致：文件名（去扩展名）→ 编号 + 空格 + 名称 */
const parseUploadFilename = (filename: string): { file_no: string; file_name: string } => {
    let stem = String(filename || "").split(/[/\\]/).pop() || "";
    const lower = stem.toLowerCase();
    if (lower.endsWith(".xlsx")) stem = stem.slice(0, -5);
    else if (lower.endsWith(".xls")) stem = stem.slice(0, -4);
    stem = stem.trim();
    if (!stem) return { file_no: "", file_name: "" };
    const sp = stem.search(/\s/);
    if (sp < 0) return { file_no: stem.slice(0, 256), file_name: "" };
    return { file_no: stem.slice(0, sp).slice(0, 256), file_name: stem.slice(sp + 1).trim().slice(0, 256) };
};

const fileDupKey = (file_no: string, file_name: string) => `${file_no}\t${file_name}`;

/** 批量添加：每行选阶段可多选 Excel；选文件时即按编号+名称判重，冲突禁用确定 */
const BatchAddDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [batchForm] = Form.useForm();
    const batchRows: BatchRow[] = data.batchRows || emptyBatchRows();
    const existingKeys: string[] = data.batchExistingKeys || [];
    const productId = Form.useWatch("product_id", batchForm);

    const setRows = (rows: BatchRow[]) => dispatch({ batchRows: rows });

    const loadExistingKeys = (pid: any) => {
        if (!pid) {
            dispatch({ batchExistingKeys: [] });
            return;
        }
        Api.list_test_set({ product_id: pid, page_index: 0, page_size: 500 }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ batchExistingKeys: [] });
                return;
            }
            const keys = (res.data?.rows || []).map((r: any) => fileDupKey(String(r.file_no || ""), String(r.file_name || "")));
            dispatch({ batchExistingKeys: keys });
        });
    };

    // uid -> 冲突说明（已存在于库 / 本批重复）
    const conflictByUid = useMemo(() => {
        const map: Record<string, string> = {};
        const seen = new Set<string>();
        const existing = new Set(existingKeys);
        batchRows.forEach((r) => {
            (r.files || []).forEach((f: any) => {
                const { file_no, file_name } = parseUploadFilename(f.name || "");
                if (!file_no) {
                    map[f.uid] = "文件名格式无效";
                    return;
                }
                const key = fileDupKey(file_no, file_name);
                const ver = (file_no.match(/-(A\d+)\b/i) || file_no.match(/\b(A\d+)\b/i) || [])[1];
                const tip = ver ? `${ver.toUpperCase()}版本已上传，请重新选择` : "该文件已上传，请重新选择";
                if (existing.has(key)) map[f.uid] = tip;
                else if (seen.has(key)) map[f.uid] = tip;
                else seen.add(key);
            });
        });
        return map;
    }, [batchRows, existingKeys]);

    const hasConflict = Object.keys(conflictByUid).length > 0;

    const stageOptionsFor = (idx: number) => {
        const usedInOtherRows = new Set(
            batchRows.filter((_, i) => i !== idx).map((r) => r.stage).filter(Boolean),
        );
        return STAGES
            .filter((s) => s === batchRows[idx]?.stage || !usedInOtherRows.has(s))
            .map((s) => ({ label: s, value: s }));
    };

    const doBatchAdd = () => {
        if (hasConflict) {
            message.error("有文件已上传，请重新选择");
            return;
        }
        batchForm.validateFields().then(async (values) => {
            const jobs: { stage: string; file: any; name: string }[] = [];
            batchRows.forEach((r) => {
                if (!r.stage || !r.files?.length) return;
                r.files.forEach((f: any) => {
                    jobs.push({ stage: r.stage, file: f.originFileObj || f, name: f.name || "" });
                });
            });
            if (!jobs.length) {
                message.error("请至少选阶段并上传文件");
                return;
            }
            dispatch({ loading: true });
            let ok = 0;
            const fail: string[] = [];
            for (const job of jobs) {
                const { file_no, file_name } = parseUploadFilename(job.name);
                const label = file_no ? `${file_no}${file_name ? ` ${file_name}` : ""}` : job.name;
                const res: any = await Api.add_test_set({
                    product_id: values.product_id,
                    stage: job.stage,
                    file: job.file,
                });
                if (res.code === Api.C_OK) ok += 1;
                else fail.push(`${label}：${res.msg || "失败"}`);
            }
            dispatch({ loading: false });
            if (ok) message.success(`成功 ${ok} 条`);
            if (fail.length) message.error(`失败 ${fail.length} 条：${fail.join("；")}`);
            if (ok) {
                dispatch({ dlgType: null, batchRows: emptyBatchRows(), batchExistingKeys: [] });
                onSaved();
            }
        });
    };

    useEffect(() => {
        if (data.dlgType === DlgTypes.batch_add) {
            batchForm.resetFields();
            dispatch({ batchRows: emptyBatchRows(), batchExistingKeys: [] });
        }
    }, [data.dlgType]);

    useEffect(() => {
        if (data.dlgType === DlgTypes.batch_add) loadExistingKeys(productId);
    }, [productId, data.dlgType]);

    return (
        <Modal
            width={"60%"}
            centered
            title="批量添加"
            open={data.dlgType === DlgTypes.batch_add}
            maskClosable={false}
            confirmLoading={data.loading}
            okButtonProps={{ disabled: hasConflict }}
            onOk={doBatchAdd}
            onCancel={() => dispatch({ dlgType: null, batchRows: emptyBatchRows(), batchExistingKeys: [] })}>
            <div className="div-v">
                <Form form={batchForm} className="expand" onFinish={(_values) => {}}>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item
                                label={ts("product.product")}
                                name="product_id"
                                rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => batchForm.setFieldValue("product_id", value)}
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                    {batchRows.map((row, idx) => (
                        <Row gutter={24} key={row.key} align="top">
                            <Col span={8}>
                                <Form.Item label={ts("test_set.stage")}>
                                    <Select
                                        allowClear
                                        placeholder={sprintf(ts("msg_select"), { label: ts("test_set.stage") })}
                                        options={stageOptionsFor(idx)}
                                        value={row.stage || undefined}
                                        onChange={(stage) => {
                                            setRows(batchRows.map((r, i) => (i === idx ? { ...r, stage: stage || "" } : r)));
                                        }}
                                    />
                                </Form.Item>
                            </Col>
                            <Col span={16}>
                                <Form.Item label={ts("excel_file")}>
                                    <Upload
                                        multiple
                                        accept=".xlsx"
                                        fileList={row.files}
                                        onRemove={(file) => {
                                            setRows(batchRows.map((r, i) => (
                                                i === idx ? { ...r, files: r.files.filter((f: any) => f.uid !== file.uid) } : r
                                            )));
                                        }}
                                        beforeUpload={(file, fileList) => {
                                            if (file.uid === fileList[fileList.length - 1].uid) {
                                                const exist = new Set((batchRows[idx]?.files || []).map((f: any) => f.uid));
                                                const additions = fileList.filter((f) => !exist.has(f.uid));
                                                setRows(batchRows.map((r, i) => (
                                                    i === idx ? { ...r, files: [...(r.files || []), ...additions] } : r
                                                )));
                                            }
                                            return false;
                                        }}
                                        itemRender={(_node, file, _list, actions) => {
                                            const tip = conflictByUid[file.uid];
                                            return (
                                                <div style={{ marginTop: 4, lineHeight: 1.4 }}>
                                                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                                        <span style={{ flex: 1, wordBreak: "break-all", color: tip ? "#cf1322" : undefined }}>{file.name}</span>
                                                        <a onClick={(e) => { e.preventDefault(); actions.remove(); }}>删除</a>
                                                    </div>
                                                    {tip ? <div style={{ color: "#cf1322", fontSize: 12 }}>{tip}</div> : null}
                                                </div>
                                            );
                                        }}>
                                        <Button icon={<UploadOutlined />}> {ts("select_file")}</Button>
                                    </Upload>
                                </Form.Item>
                            </Col>
                        </Row>
                    ))}
                </Form>
            </div>
        </Modal>
    );
};

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const doEdit = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            const fn_request = data.dlgType === DlgTypes.edit ? Api.update_test_set : Api.add_test_set;
            fn_request(values).then((res: any) => {
                if (res.code === Api.C_OK) {
                    onSaved();
                    dispatch({ loading: false, dlgType: null });
                    message.success(res.msg);
                } else {
                    dispatch({ loading: false });
                    message.error(res.msg);
                }
            });
        });
    };

    useEffect(() => {
        if (data.dlgType === DlgTypes.add || data.dlgType === DlgTypes.edit) {
            editForm.resetFields();
            dispatch({ files: [] });
            if (data.dlgType === DlgTypes.edit) {
                dispatch({ loading: true });
                Api.get_test_set({ id: data.targetRow.id }).then((res: any) => {
                    if (res.code === Api.C_OK) {
                        const targetRow = res.data;
                        editForm.setFieldsValue(targetRow);
                        dispatch({ loading: false, targetRow });
                    } else {
                        message.error(res.msg);
                        dispatch({ loading: false });
                    }
                });
            }
        }
    }, [data.dlgType, data.targetRow.id]);

    return (
        <Modal
            width={"50%"}
            centered
            title={data.dlgType === DlgTypes.add ? ts("add") : ts("edit")}
            open={data.dlgType === DlgTypes.add || data.dlgType === DlgTypes.edit}
            maskClosable={false}
            confirmLoading={data.loading}
            onOk={doEdit}
            onCancel={() => dispatch({ dlgType: null })}>
            <div className="div-v">
                <Form form={editForm} className="expand" onFinish={(_values) => {}}>
                    <Form.Item hidden name="id">
                        <Input allowClear value={data.targetRow.id} />
                    </Form.Item>
                    <Row gutter={24}>
                        <Col span={12}>
                            <Form.Item
                                label={ts("product.product")}
                                name="product_id"
                                rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("product.product") }) }]}>
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => editForm.setFieldValue("product_id", value)}
                                />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item
                                label={ts("test_set.stage")}
                                name="stage"
                                rules={[{ required: true, message: sprintf(ts("msg_select"), { label: ts("test_set.stage") }) }]}>
                                <Select allowClear options={STAGES.map((item: any) => ({ label: item, value: item }))} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("excel_file")} name="file">
                                <Upload
                                    maxCount={1}
                                    fileList={data.files}
                                    accept=".xlsx"
                                    onRemove={() => {
                                        dispatch({ files: [] });
                                    }}
                                    beforeUpload={(file) => {
                                        dispatch({ files: [file] });
                                        return false;
                                    }}>
                                    <Button icon={<UploadOutlined />}> {ts("select_file")}</Button>
                                </Upload>
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </div>
        </Modal>
    );
};

const doSearchProducts = (data: any, dispatch: any) => {
    if (data.products.length === 0) {
        dispatch({ loadingProducts: true });
        ApiProduct.list_product({ page_size: 1000 }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loadingProducts: false, products: res.data.rows || [] });
            } else {
                message.error(res.msg);
                dispatch({ loadingProducts: false });
            }
        });
    }
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
        loadingProducts: false,
        files: [],
        batchRows: emptyBatchRows(),
        batchExistingKeys: [] as string[],
        exportingSet: new Set(),
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_test_set({ ...sanitizeListQuery(params), page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_test_set({ id: data.targetRow.id }).then((res: any) => {
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
            ellipsis: true,
            width: 160,
        },
        {
            title: ts("product.full_version"),
            dataIndex: "product_version",
            width: 90,
        },
        {
            title: ts("test_set.stage"),
            dataIndex: "stage",
            width: 96,
            onCell: () => ({ style: { whiteSpace: "nowrap" } }),
        },
        {
            title: "文件编号",
            dataIndex: "file_no",
            // 单行完整显示，不截断、不换行
            onCell: () => ({ style: { whiteSpace: "nowrap", overflow: "visible" } }),
            render: (v: string) => <span style={{ whiteSpace: "nowrap" }}>{v || "—"}</span>,
        },
        {
            title: "文件名称",
            dataIndex: "file_name",
            width: 120,
            onCell: () => ({ style: { whiteSpace: "nowrap" } }),
            render: (v: string) => v || "—",
        },
        {
            title: ts("create_time"),
            dataIndex: "create_time",
            width: 168,
            onCell: () => ({ style: { whiteSpace: "nowrap" } }),
        },
        {
            title: ts("action"),
            width: 300,
            onCell: () => ({ style: { whiteSpace: "nowrap", paddingLeft: 4, paddingRight: 4 } }),
            render: (_value: any, row: any) => {
                return (
                    <Space size={0} wrap={false} style={{ flexWrap: "nowrap", whiteSpace: "nowrap" }}>
                        <Button type="link" size="small" style={{ paddingInline: 4 }} onClick={() => dispatch({ dlgType: DlgTypes.test_cases, targetRow: row })}>
                            {ts("test_set.view_test_cases")}
                        </Button>
                        <Button type="link" size="small" style={{ paddingInline: 4 }} onClick={() => dispatch({ dlgType: DlgTypes.edit, targetRow: row })}>
                            {ts("edit")}
                        </Button>
                        <Button type="link" size="small" danger style={{ paddingInline: 4 }} onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
                            {ts("delete")}
                        </Button>
                        <Button
                            loading={data.exportingSet.has(row.id)}
                            type="link"
                            size="small"
                            style={{ paddingInline: 4 }}
                            onClick={() => {
                                dispatch({ exportingSet: new Set([...data.exportingSet, row.id]) });
                                ApiTestCase.export_test_cases({ set_id: row.id }).then((res: any) => {
                                    dispatch({ exportingSet: new Set([...data.exportingSet].filter((item: any) => item !== row.id)) });
                                    if (res.code !== Api.C_OK) {
                                        message.error(res.msg);
                                    }
                                });
                            }}>
                            {ts("test_set.export_test_cases")}
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
                    <Row gutter={10}>
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
                            <Form.Item label={ts("test_set.stage")} name="stage">
                                <Select allowClear options={STAGES.map((item: any) => ({ label: item, value: item }))} />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
                <div className="div-h hspace">
                    <Space>
                        <Button onClick={() => dispatch({ dlgType: DlgTypes.batch_add, targetRow: {}, batchRows: emptyBatchRows(), batchExistingKeys: [] })}>
                            批量添加
                        </Button>
                        <Button type="primary" onClick={() => dispatch({ dlgType: DlgTypes.add, targetRow: {} })}>
                            {ts("add")}
                        </Button>
                    </Space>
                </div>
            </div>
            <Table
                className="expand test-set-list-table"
                tableLayout="auto"
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
            <DetailDlg
                data={data}
                dispatch={dispatch}
                onSaved={() => {
                    queryForm.resetFields();
                    doSearch({}, 1, data.pageSize);
                }}
            />
            <BatchAddDlg
                data={data}
                dispatch={dispatch}
                onSaved={() => {
                    queryForm.resetFields();
                    doSearch({}, 1, data.pageSize);
                }}
            />
            <Modal
                width="95%"
                title={data.targetRow.stage || ""}
                open={data.dlgType === DlgTypes.test_cases}
                maskClosable={false}
                footer={null}
                destroyOnClose
                onCancel={() => dispatch({ dlgType: null })}>
                <TestCases set_id={data.targetRow.id} />
            </Modal>
        </div>
    );
};
