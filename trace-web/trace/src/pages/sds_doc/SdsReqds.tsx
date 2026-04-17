import "./SdsReqds.less";

import { Form, Input, Button, Table, message, Row, Col, Modal, Select, Upload } from "antd";
import { SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiSdsReqd";
import * as ApiDoc from "@/api/ApiSdsDoc";
import { doSearchProducts } from "../prod_risk/util";

const pageSizeOptions = [1000, 100, 500];

enum DlgTypes {
    edit = "edit",
}

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const doEdit = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            const params = { ...values, new_logics: JSON.stringify(values.new_logics) || "", alt_logics: JSON.stringify(values.alt_logics) || "" };
            Api.update_sds_reqd(params).then((res: any) => {
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
        if (data.dlgType === DlgTypes.edit && data.targetRow.id) {
            editForm.resetFields();
            dispatch({ files: [], logics: [] });
            if (data.dlgType === DlgTypes.edit && data.targetRow.id) {
                dispatch({ loading: true });
                Api.get_sds_reqd({ id: data.targetRow.id }).then((res: any) => {
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
            width={"60%"}
            centered
            title={ts("edit")}
            open={data.dlgType === DlgTypes.edit}
            maskClosable={false}
            confirmLoading={data.loading}
            onOk={doEdit}
            onCancel={() => dispatch({ dlgType: null })}>
            <div className="div-v">
                <Form form={editForm} className="expand" onFinish={(_values) => {}}>
                    <Form.Item hidden name="id">
                        <Input allowClear value={data.targetRow.id} />
                    </Form.Item>
                    <Form.Item hidden name="req_id">
                        <Input allowClear value={data.targetRow.req_id} />
                    </Form.Item>
                    <Form.Item hidden name="doc_id">
                        <Input allowClear value={data.targetRow.doc_id} />
                    </Form.Item>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_reqd.overview")} name="overview">
                                <Input.TextArea rows={3} allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_reqd.func_detail")} name="func_detail">
                                <Input.TextArea rows={3} allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_reqd.logic_img")} name="new_imgs">
                                <Upload
                                    fileList={data.files}
                                    accept=".png,.jpg,.jpeg"
                                    showUploadList={false}
                                    multiple
                                    beforeUpload={(file) => {
                                        dispatch({
                                            files: [...data.files, file],
                                            logics: [...data.logics, { uid: file.uid, filename: file.name }],
                                        });
                                        return false;
                                    }}>
                                    <Button icon={<UploadOutlined />}> {ts("select_file")}</Button>
                                </Upload>
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            {(data.targetRow.logics || []).map((item: any, index: number) => (
                                <Row key={item.uid} gutter={1}>
                                    <Col span={6}>{item.filename}</Col>
                                    <Col span={16}>
                                        <Form.Item initialValue={item.txt} name={["alt_logics", index, "txt"]}>
                                            <Input
                                                allowClear
                                                onChange={(evt) => {
                                                    const logics = [...data.targetRow.logics].map((temp: any) => ({ ...temp }));
                                                    logics[index].txt = evt.target.value;
                                                    dispatch({ targetRow: { ...data.targetRow, logics: logics } });
                                                }}
                                            />
                                        </Form.Item>
                                        <Form.Item initialValue={item.id} hidden name={["alt_logics", index, "id"]}>
                                            <Input allowClear value={item.id} />
                                        </Form.Item>
                                    </Col>
                                    <Col span={2}>
                                        <Button
                                            type="link"
                                            onClick={() => {
                                                dispatch({ targetLogic: item });
                                            }}>
                                            删除
                                        </Button>
                                    </Col>
                                </Row>
                            ))}
                            {data.logics.map((item: any, index: number) => (
                                <Row key={item.uid} gutter={1}>
                                    <Col span={6}>{item.filename}</Col>
                                    <Col span={16}>
                                        <Form.Item name={["new_logics", index, "txt"]}>
                                            <Input allowClear />
                                        </Form.Item>
                                    </Col>
                                    <Col span={2}>
                                        <Button
                                            type="link"
                                            onClick={() => {
                                                const files = data.files.filter((temp: any) => temp.uid !== item.uid);
                                                const logics = data.logics.filter((temp: any) => temp.uid !== item.uid);
                                                dispatch({ files, logics });
                                            }}>
                                            删除
                                        </Button>
                                    </Col>
                                </Row>
                            ))}
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_reqd.logic_txt")} name="logic_txt">
                                <Input.TextArea rows={3} allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_reqd.intput")} name="intput">
                                <Input.TextArea rows={3} allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_reqd.output")} name="output">
                                <Input.TextArea rows={3} allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={24}>
                        <Col span={24}>
                            <Form.Item label={ts("sds_reqd.interface")} name="interface">
                                <Input.TextArea rows={3} allowClear />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </div>
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
        targetLogic: { id: null },
        loading: false,
        products: [],
        docs: [],
        files: [],
        logics: [],
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_sds_reqd({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, pageIndex, pageSize, total: res.data.total, rows: res.data.rows });
            } else {
                dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
                message.error(res.msg);
            }
        });
    };

    const doSearchDocs = (params: any) => {
        dispatch({ loadingDocs: true });
        ApiDoc.list_sds_doc({ ...params }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loadingDocs: false, docs: res.data.rows });
            } else {
                dispatch({ loadingDocs: false, docs: [] });
                message.error(res.msg);
            }
        });
    };

    const doDeleteLogic = () => {
        dispatch({ removingLogic: true });
        const logic_id = data.targetLogic.id;
        Api.delete_sds_logic({ logic_id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success(res.msg);
                const logics = data.targetRow.logics.filter((temp: any) => temp.id !== logic_id);
                const targetRow = { ...data.targetRow, logics };
                dispatch({ removingLogic: false, targetRow, targetLogic: { id: null } });
            } else {
                message.error(res.msg);
                dispatch({ removingLogic: false, dlgType: null });
            }
        });
    };

    const normalizeImgUrl = (url?: string) => {
        const txt = String(url || "").trim();
        if (!txt || txt === "/") return "";
        if (txt.startsWith("http://") || txt.startsWith("https://") || txt.startsWith("data:")) return txt;
        if (txt.startsWith("/data.trace/")) return txt;
        if (txt.startsWith("data.trace/")) return `/${txt}`;
        return txt;
    };

    const columns = [
        {
            title: ts("srs_req.code"),
            dataIndex: "srs_code",
            width: 180,
            onHeaderCell: () => ({ style: { minWidth: 180 } }),
            onCell: () => ({ style: { minWidth: 180 } }),
            render: (t: any) => <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t || "-"}</span>,
        },
        {
            title: ts("sds_reqd.name"),
            dataIndex: "name",
            width: 180,
            onHeaderCell: () => ({ style: { minWidth: 180 } }),
            onCell: () => ({ style: { minWidth: 180 } }),
            render: (t: any) => <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t || "-"}</span>,
        },
        {
            title: ts("sds_reqd.overview"),
            dataIndex: "overview",
            render: (t: any) => (t ? renderOneLineWithTooltip(t, { emptyText: "" }) : "-"),
        },
        {
            title: ts("sds_reqd.func_detail"),
            dataIndex: "func_detail",
            render: (t: any) => (t ? renderOneLineWithTooltip(t, { emptyText: "" }) : "-"),
        },
        {
            title: ts("sds_reqd.logic_txt"),
            dataIndex: "logic_txt",
            render: (_t: any, row: any) => {
                const img = normalizeImgUrl(row?.logic_img);
                if (img) {
                    return <img src={img} alt="logic" style={{ maxWidth: 160, maxHeight: 80, objectFit: "contain" }} />;
                }
                return "/";
            },
        },
        {
            title: ts("sds_reqd.intput"),
            dataIndex: "intput",
            render: (t: any) => (t ? renderOneLineWithTooltip(t, { emptyText: "" }) : "-"),
        },
        {
            title: ts("sds_reqd.output"),
            dataIndex: "output",
            render: (t: any) => (t ? renderOneLineWithTooltip(t, { emptyText: "" }) : "-"),
        },
        {
            title: ts("sds_reqd.interface"),
            dataIndex: "interface",
            render: (t: any) => (t ? renderOneLineWithTooltip(t, { emptyText: "" }) : "-"),
        },
        {
            title: ts("product.product"),
            render: (_value: any, row: any) => {
                return `${row.product_name}-${row.product_version}`;
            },
        },
        {
            title: ts("sds_doc.version"),
            dataIndex: "sdsdoc_version",
        },
        {
            title: ts("action"),
            width: 140,
            fixed: "right" as const,
            render: (_value: any, row: any) => {
                return (
                    <div>
                        <Button type="link" onClick={() => dispatch({ dlgType: DlgTypes.edit, targetRow: row })}>
                            {ts("edit")}
                        </Button>
                    </div>
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
        <div className="page div-v sdsreqds">
            <div className="div-h searchbar">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={(values) => {
                        doSearch(values, 1, data.pageSize);
                    }}>
                    <Row gutter={10}>
                        <Col>
                            <Form.Item label={ts("product.product")} name="prod_id">
                                <ProductVersionSelect
                                    products={data.products}
                                    allowClear
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(value) => {
                                        queryForm.setFieldValue("prod_id", value);
                                        dispatch({ docs: [] });
                                        queryForm.setFieldsValue({ doc_id: null });
                                        doSearchDocs({ product_id: value });
                                    }}
                                />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Form.Item label={ts("sds_doc.version")} name="doc_id">
                                <Select allowClear options={data.docs.map((item: any) => ({ label: item.version, value: item.id }))} />
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
                scroll={{ x: 1800 }}
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
            <DetailDlg
                data={data}
                dispatch={dispatch}
                onSaved={() => {
                    doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
                }}
            />
            <Modal
                centered
                title={ts("action")}
                open={data.targetLogic.id !== null}
                maskClosable={false}
                confirmLoading={data.removingLogic}
                onOk={doDeleteLogic}
                onCancel={() => dispatch({ targetLogic: { id: null } })}>
                <div>{ts("confirm_delete")}</div>
            </Modal>
        </div>
    );
};
