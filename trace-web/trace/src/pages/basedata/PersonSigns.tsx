import { Form, Input, Button, Table, message, Row, Col, Modal, Space, Upload, Image } from "antd";
import { SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { renderOneLineWithTooltip, useData } from "@/common";
import * as Api from "@/api/ApiPersonSign";

const pageSizeOptions = [20, 50, 100];

enum DlgTypes {
    add = "add",
    edit = "edit",
    delete = "delete",
}

// 图片最大 3MB，读为 base64 dataURL 存储
const MAX_IMG_SIZE = 3 * 1024 * 1024;

const readImage = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("read_error"));
        reader.readAsDataURL(file);
    });

// 表格内图片单元格：预览 + 上传/更换（对已存在行会即时保存）
const ImageCell = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
    const { t: ts } = useTranslation();
    const beforeUpload = (file: File) => {
        if (!file.type.startsWith("image/")) {
            message.error(ts("person_sign.msg_need_image"));
            return false;
        }
        if (file.size > MAX_IMG_SIZE) {
            message.error(ts("person_sign.msg_img_too_large"));
            return false;
        }
        readImage(file).then(onChange).catch(() => message.error(ts("person_sign.msg_read_fail")));
        return false;
    };
    return (
        <div className="div-v" style={{ gap: 4, alignItems: "flex-start" }}>
            {value ? (
                <Image src={value} height={40} style={{ objectFit: "contain", border: "1px solid #eee" }} />
            ) : (
                <span style={{ color: "#bbb" }}>—</span>
            )}
            <Upload accept="image/*" showUploadList={false} beforeUpload={beforeUpload}>
                <Button size="small" icon={<UploadOutlined />}>
                    {value ? ts("person_sign.replace") : ts("person_sign.upload")}
                </Button>
            </Upload>
        </div>
    );
};

const DetailDlg = ({ data, dispatch, onSaved }: any) => {
    const { t: ts } = useTranslation();
    const [editForm] = Form.useForm();

    const doEdit = () => {
        editForm.validateFields().then((values) => {
            dispatch({ loading: true });
            const payload = { ...values, seal_img: data.targetRow.seal_img || "", sign_img: data.targetRow.sign_img || "" };
            const fn_request = data.dlgType === DlgTypes.edit ? Api.update_person_sign : Api.add_person_sign;
            fn_request(payload).then((res: any) => {
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
            if (data.dlgType === DlgTypes.edit) {
                editForm.setFieldsValue(data.targetRow);
            }
        }
    }, [data.dlgType, data.targetRow.id]);

    const setImg = (key: string, v: string) => dispatch({ targetRow: { ...data.targetRow, [key]: v } });

    return (
        <Modal
            width={520}
            centered
            title={data.dlgType === DlgTypes.add ? ts("add") : ts("edit")}
            open={data.dlgType === DlgTypes.add || data.dlgType === DlgTypes.edit}
            maskClosable={false}
            confirmLoading={data.loading}
            onOk={doEdit}
            onCancel={() => dispatch({ dlgType: null })}>
            <Form form={editForm} className="expand" labelCol={{ span: 6 }}>
                <Form.Item hidden name="id">
                    <Input />
                </Form.Item>
                <Form.Item
                    label={ts("person_sign.name")}
                    name="name"
                    rules={[{ required: true, message: sprintf(ts("msg_input"), { label: ts("person_sign.name") }) }]}>
                    <Input allowClear />
                </Form.Item>
                <Form.Item label={ts("person_sign.position")} name="position">
                    <Input.TextArea allowClear autoSize={{ minRows: 1, maxRows: 3 }} />
                </Form.Item>
                <Form.Item label={ts("person_sign.status")} name="status">
                    <Input allowClear />
                </Form.Item>
                <Form.Item label={ts("person_sign.seal_img")}>
                    <ImageCell value={data.targetRow.seal_img} onChange={(v) => setImg("seal_img", v)} />
                </Form.Item>
                <Form.Item label={ts("person_sign.sign_img")}>
                    <ImageCell value={data.targetRow.sign_img} onChange={(v) => setImg("sign_img", v)} />
                </Form.Item>
            </Form>
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
    });

    const doSearch = (params: any, pageIndex: any, pageSize: any) => {
        dispatch({ loading: true });
        Api.list_person_sign({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
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
        Api.delete_person_sign({ id: data.targetRow.id }).then((res: any) => {
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

    // 表格内即时更换图片：直接调用更新接口保存
    const saveImage = (row: any, key: string, value: string) => {
        Api.update_person_sign({ ...row, [key]: value }).then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success(ts("person_sign.msg_img_saved"));
                doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
            } else {
                message.error(res.msg);
            }
        });
    };

    const columns = [
        { title: ts("person_sign.name"), dataIndex: "name", width: 110, ellipsis: true, render: (v: any) => renderOneLineWithTooltip(v, { emptyText: "" }) },
        { title: ts("person_sign.position"), dataIndex: "position", ellipsis: true, render: (v: any) => renderOneLineWithTooltip(v, { emptyText: "" }) },
        {
            title: ts("person_sign.seal_img"),
            dataIndex: "seal_img",
            width: 160,
            render: (v: any, row: any) => <ImageCell value={v} onChange={(nv) => saveImage(row, "seal_img", nv)} />,
        },
        {
            title: ts("person_sign.sign_img"),
            dataIndex: "sign_img",
            width: 160,
            render: (v: any, row: any) => <ImageCell value={v} onChange={(nv) => saveImage(row, "sign_img", nv)} />,
        },
        { title: ts("person_sign.status"), dataIndex: "status", width: 120, ellipsis: true, render: (v: any) => renderOneLineWithTooltip(v, { emptyText: "" }) },
        {
            title: ts("action"),
            width: 110,
            render: (_value: any, row: any) => (
                <Space>
                    <Button type="link" onClick={() => dispatch({ dlgType: DlgTypes.edit, targetRow: row })}>
                        {ts("edit")}
                    </Button>
                    <Button type="link" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>
                        {ts("delete")}
                    </Button>
                </Space>
            ),
        },
    ];

    useEffect(() => {
        doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
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
                            <Form.Item label={ts("fuzzy")} name="fuzzy">
                                <Input allowClear />
                            </Form.Item>
                        </Col>
                        <Col>
                            <Button shape="circle" icon={<SearchOutlined />} htmlType="submit" />
                        </Col>
                    </Row>
                </Form>
                <div className="div-h hspace">
                    <Button type="primary" onClick={() => dispatch({ dlgType: DlgTypes.add, targetRow: {} })}>
                        {ts("add")}
                    </Button>
                </div>
            </div>
            <Table
                className="expand"
                tableLayout="fixed"
                sticky
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
                    showTotal: (total: number) => sprintf(ts("total_items"), { total }),
                }}
                onChange={(pager) => {
                    doSearch(queryForm.getFieldsValue(), pager.current, pager.pageSize);
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
                    doSearch(queryForm.getFieldsValue(), data.pageIndex, data.pageSize);
                }}
            />
        </div>
    );
};
