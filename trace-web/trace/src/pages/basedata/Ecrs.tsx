import { Button, Table, message, Space, Input, Popconfirm, Form, Row, Col, Modal } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import { Root, useSelector } from "@/store";
import { canWriteProduct } from "../productWrite";
import * as Api from "./ecrApi";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    edit = "edit",
}

const FIELDS: { name: string; label: string; area?: boolean; required?: boolean }[] = [
    { name: "ecr_no", label: "ECR编号", required: true },
    { name: "product_name", label: "变更后产品名称", area: true },
    { name: "version", label: "变更后版本号" },
    { name: "apply_date", label: "编号申请日期" },
    { name: "applicant", label: "申请人" },
    { name: "content", label: "变更申请内容", area: true },
    { name: "note", label: "备注", area: true },
];

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();
    const open = data.dlgType === DlgTypes.add || data.dlgType === DlgTypes.edit;

    const doSave = () => {
        editForm.validateFields().then((values) => {
            dispatch({ saving: true });
            const isEdit = data.dlgType === DlgTypes.edit;
            const payload = { ...values, ecr_no: String(values.ecr_no || "").trim() };
            const request = isEdit ? Api.update_ecr({ ...payload, id: data.targetRow.id }) : Api.add_ecr(payload);
            request.then((res: any) => {
                if (res.code === Api.C_OK) {
                    dispatch({ saving: false, dlgType: null, targetRow: {} });
                    message.success(res.msg || ts("msg_ok"));
                    onSaved(isEdit);
                } else {
                    dispatch({ saving: false });
                    message.error(res.msg);
                }
            }).catch(() => {
                dispatch({ saving: false });
                message.error("保存失败");
            });
        });
    };

    useEffect(() => {
        if (!open) return;
        editForm.resetFields();
        if (data.dlgType === DlgTypes.edit) {
            editForm.setFieldsValue(data.targetRow || {});
        }
    }, [data.dlgType, data.targetRow?.id]);

    return (
        <Modal
            width={640}
            centered
            title={data.dlgType === DlgTypes.add ? ts("add") : ts("edit")}
            open={open}
            maskClosable={false}
            confirmLoading={data.saving}
            onOk={doSave}
            onCancel={() => dispatch({ dlgType: null, targetRow: {} })}
            okText={ts("save")}
            cancelText={ts("cancel")}
        >
            <Form form={editForm} labelCol={{ span: 6 }} wrapperCol={{ span: 16 }}>
                {FIELDS.map((field) => (
                    <Form.Item
                        key={field.name}
                        label={field.label}
                        name={field.name}
                        rules={field.required ? [{ required: true, message: sprintf(ts("msg_input"), { label: field.label }) }] : []}
                    >
                        {field.area ? (
                            <Input.TextArea allowClear autoSize={{ minRows: 2, maxRows: 6 }} />
                        ) : (
                            <Input allowClear />
                        )}
                    </Form.Item>
                ))}
            </Form>
        </Modal>
    );
};

export default () => {
    const { t: ts } = useTranslation();
    const user = useSelector((state: Root) => state.user);
    const canWrite = canWriteProduct(user?.role_code, user?.id, "baseInfo");
    const [queryForm] = Form.useForm();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [] as any[],
        loading: false,
        saving: false,
        keyword: "",
        dlgType: null as string | null,
        targetRow: {} as any,
    });

    const doSearch = (keyword: string, pageIndex: number, pageSize: number) => {
        dispatch({ loading: true, keyword, pageIndex, pageSize });
        Api.list_ecr({
            keyword: keyword || undefined,
            page_index: pageIndex - 1,
            page_size: pageSize,
        }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({
                    loading: false,
                    total: res.data?.total || 0,
                    rows: res.data?.rows || [],
                    pageIndex,
                    pageSize,
                    keyword,
                });
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        }).catch(() => {
            dispatch({ loading: false });
            message.error("加载失败");
        });
    };

    const doDelete = (row: any) => {
        if (!canWrite) return;
        Api.delete_ecr({ id: row.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success(res.msg || ts("msg_ok"));
                const pageIndex = data.rows.length <= 1 && data.pageIndex > 1 ? data.pageIndex - 1 : data.pageIndex;
                doSearch(data.keyword, pageIndex, data.pageSize);
            } else {
                message.error(res.msg);
            }
        });
    };

    const showText = (value: any) => (
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {value !== null && value !== undefined && String(value) !== "" ? value : <span style={{ color: "#d9d9d9" }}>—</span>}
        </div>
    );

    const columns: any[] = [
        { title: "ECR编号", dataIndex: "ecr_no", width: 128, render: showText },
        { title: "变更后产品名称", dataIndex: "product_name", width: 220, render: showText },
        { title: "变更后版本号", dataIndex: "version", width: 120, render: showText },
        { title: "编号申请日期", dataIndex: "apply_date", width: 120, render: showText },
        { title: "申请人", dataIndex: "applicant", width: 90, render: showText },
        { title: "变更申请内容", dataIndex: "content", render: showText },
        { title: "备注", dataIndex: "note", width: 160, render: showText },
    ];
    if (canWrite) {
        columns.push({
            title: ts("action"),
            width: 140,
            align: "center" as const,
            render: (_value: any, row: any) => (
                <Space size={0}>
                    <Button type="link" size="small" onClick={() => dispatch({ dlgType: DlgTypes.edit, targetRow: row })}>
                        {ts("edit")}
                    </Button>
                    <Popconfirm title={ts("confirm_delete")} onConfirm={() => doDelete(row)}>
                        <Button type="link" size="small" danger>
                            {ts("delete")}
                        </Button>
                    </Popconfirm>
                </Space>
            ),
        });
    }

    useEffect(() => {
        doSearch("", 1, pageSizeOptions[0]);
    }, []);

    return (
        <div className="page div-v">
            <div className="div-h searchbar list-searchbar-align">
                <Form
                    form={queryForm}
                    className="expand"
                    onFinish={(values) => doSearch((values.keyword || "").trim(), 1, data.pageSize)}
                >
                    <Row gutter={20}>
                        <Col>
                            <Form.Item name="keyword" label="ECR">
                                <Input allowClear placeholder="编号 / 产品名称 / 申请人" style={{ width: 280 }} />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
                {canWrite ? (
                    <Button type="primary" onClick={() => dispatch({ dlgType: DlgTypes.add, targetRow: {} })}>
                        {ts("add")}
                    </Button>
                ) : null}
            </div>
            <Table
                className="expand"
                tableLayout="fixed"
                size="small"
                columns={columns}
                rowKey={(item: any) => item.id}
                dataSource={data.rows}
                loading={data.loading}
                pagination={{
                    total: data.total,
                    current: data.pageIndex,
                    pageSize: data.pageSize,
                    showSizeChanger: true,
                    pageSizeOptions,
                    showTotal: (total: number) => sprintf(ts("total_items"), { total }),
                }}
                onChange={(pager) => doSearch(data.keyword, pager.current || 1, pager.pageSize || data.pageSize)}
            />
            <DetailDlg
                data={data}
                dispatch={dispatch}
                onSaved={(isEdit: boolean) => {
                    if (isEdit) {
                        doSearch(data.keyword, data.pageIndex, data.pageSize);
                        return;
                    }
                    const last = Math.max(1, Math.ceil((data.total + 1) / data.pageSize));
                    doSearch(data.keyword, data.keyword ? 1 : last, data.pageSize);
                }}
            />
        </div>
    );
};
