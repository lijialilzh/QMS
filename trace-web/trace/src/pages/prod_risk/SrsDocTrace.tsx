import "./SrsDocTrace.less";
import { Form, Button, Table, message, Modal, Row, Col, Space, Input } from "antd";
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

    const isChangeTraceRow = (row: any) => {
        const typeCode = String(row?.type_code || "").trim();
        return !!typeCode && typeCode !== "1" && typeCode !== "2";
    };
    const expandTraceRows = (rows: any[], keyPrefix: string) => (rows || []).flatMap((row: any, rowIndex: number) => {
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
            __rowKey: `${keyPrefix}-${row?.srs_code || rowIndex}-${idx}`,
            __rowSpan: idx === 0 ? subCount : 0,
            __sisCode: sisCodes[idx] || "/",
            __unitCode: unitCodes[idx] || "/",
        }));
    });
    const normalTraceRows = (data.traceRows || []).filter((row: any) => !isChangeTraceRow(row));
    const changeTraceRows = (data.traceRows || []).filter((row: any) => isChangeTraceRow(row));
    const expandedTraceRows = expandTraceRows(normalTraceRows, "normal");
    const expandedChangeTraceRows = expandTraceRows(changeTraceRows, "change");
    const productFullVersion = String(data.targetRow?.product_version || "").trim();
    const mainTableScrollY = (() => {
        const threshold = expandedChangeTraceRows.length > 0 ? 12 : 18;
        if (expandedTraceRows.length <= threshold) return undefined;
        return expandedChangeTraceRows.length > 0 ? "32vh" : "64vh";
    })();
    const changeTableScrollY = expandedChangeTraceRows.length > 10 ? "28vh" : undefined;

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
        const numOf = (code: string) => { const m = String(code).match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : 0; };
        const list = Array.from(new Set(raw
            .flatMap((item) => String(item || "").split(/[,\n，]/g))
            .map((item) => item.trim())
            .filter(Boolean)))
            .sort((a, b) => numOf(a) - numOf(b) || String(a).localeCompare(String(b)));
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
    const renderMultilineSdsCodes = (values: any) => {
        const raw = Array.isArray(values) ? values : [values];
        const list = raw
            .flatMap((item) => String(item || "").split(/[,\n，\s]+/g))
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
    const traceColumns = [
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
            render: (values: any) => renderMultilineSdsCodes(values),
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
            onCell: mergedCell,
            render: (values: any) => {
                return renderMultilineCaseCodes(values);
            },
        },
        {
            title: "系统测试记录",
            dataIndex: "tests_sys",
            width: 95,
            onCell: mergedCell,
            render: (values: any) => {
                return renderMultilineCaseCodes(values);
            },
        },
        {
            title: "用户测试记录",
            dataIndex: "tests_user",
            width: 95,
            onCell: mergedCell,
            render: (values: any) => {
                return renderMultilineCaseCodes(values);
            },
        },
        {
            title: "RCM",
            dataIndex: "rcm_codes",
            width: 110,
            onCell: mergedCell,
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
    ];

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
                className="trace-table-box"
                loading={data.loadingTrace}
                dataSource={expandedTraceRows}
                rowKey={(item: any) => item.__rowKey}
                size="small"
                tableLayout="auto"
                columns={traceColumns}
                scroll={mainTableScrollY ? { y: mainTableScrollY } : undefined}
                pagination={false}
            />
            {expandedChangeTraceRows.length > 0 && (
                <>
                    <div className="trace-subtitle">{`${productFullVersion || "产品"}变更追溯`}</div>
                    <Table
                        className="trace-table-box trace-change-table"
                        loading={data.loadingTrace}
                        dataSource={expandedChangeTraceRows}
                        rowKey={(item: any) => item.__rowKey}
                        size="small"
                        tableLayout="auto"
                        columns={traceColumns}
                        scroll={changeTableScrollY ? { y: changeTableScrollY } : undefined}
                        pagination={false}
                    />
                </>
            )}
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
        editingFileNoId: 0,
        editingFileNoValue: "",
        savingFileNoId: 0,
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

    const handleStartEditFileNo = (row: any) => {
        dispatch({
            editingFileNoId: row.id,
            editingFileNoValue: row.file_no || "",
        });
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
            const res: any = await Api.update_srs_doc_file_no({ id: row.id, file_no: nextFileNo });
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
            title: ts("srs_doc.file_no"),
            dataIndex: "file_no",
            width: 220,
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
                            style={{ width: 200 }}
                        />
                    );
                }
                return (
                    <span
                        style={{ cursor: "text", display: "inline-block", minWidth: 80 }}
                        title="单击编辑文件编号"
                        onClick={() => handleStartEditFileNo(row)}>
                        {value || "-"}
                    </span>
                );
            },
        },
        {
            title: ts("action"),
            width: 220,
            render: (_value: any, row: any) => {
                return (
                    <Space size={12} style={{ whiteSpace: "nowrap" }}>
                        <Button type="link" onClick={() => dispatch({ dlgType: DlgTypes.view, targetRow: row })}>
                            {ts("view")}
                        </Button>
                        <Button
                            type="link"
                            loading={data.exportingSet.has(`excel-${row.id}`)}
                            onClick={() => {
                                dispatch({ exportingSet: new Set([...data.exportingSet, `excel-${row.id}`]) });
                                Api.export_doc_trace({ id: row.id }).then((res: any) => {
                                    dispatch({ exportingSet: new Set([...data.exportingSet].filter((item: any) => item !== `excel-${row.id}`)) });
                                    if (res.code !== Api.C_OK) {
                                        message.error(res.msg);
                                    }
                                });
                            }}>
                            导出Excel
                        </Button>
                        <Button
                            type="link"
                            loading={data.exportingSet.has(`word-${row.id}`)}
                            onClick={() => {
                                dispatch({ exportingSet: new Set([...data.exportingSet, `word-${row.id}`]) });
                                Api.export_doc_trace_word({ id: row.id }).then((res: any) => {
                                    dispatch({ exportingSet: new Set([...data.exportingSet].filter((item: any) => item !== `word-${row.id}`)) });
                                    if (res.code !== Api.C_OK) {
                                        message.error(res.msg);
                                    }
                                });
                            }}>
                            导出Word
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
