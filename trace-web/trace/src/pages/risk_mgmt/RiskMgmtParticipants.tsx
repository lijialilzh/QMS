import { Button, Form, Input, Modal, Space, Table, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiRiskMgmtDoc";

enum DlgTypes {
    edit = "edit",
    delete = "delete",
}

const makeRowKey = () => `${Date.now()}-${Math.random()}`;
const pageSizeOptions = [20, 50, 100];

export default () => {
    const { t: ts } = useTranslation();
    const [queryForm] = Form.useForm();
    const [editForm] = Form.useForm();
    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [] as any[],
        targetRow: {},
        editMode: "add",
    });

    useEffect(() => {
        doSearch({}, 1, data.pageSize);
    }, []);

    const doSearch = (params: any = queryForm.getFieldsValue(), pageIndex = data.pageIndex, pageSize = data.pageSize) => {
        dispatch({ loading: true });
        Api.list_risk_participant({ ...params, page_index: pageIndex - 1, page_size: pageSize }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({
                    loading: false,
                    total: res.data?.total || 0,
                    rows: (res.data?.rows || []).map((row: any) => ({ ...row, _rowKey: makeRowKey() })),
                    pageIndex,
                    pageSize,
                });
            } else {
                dispatch({ loading: false, total: 0, rows: [] });
                message.error(res.msg || "加载失败");
            }
        }).catch(() => {
            dispatch({ loading: false, total: 0, rows: [] });
            message.error("加载失败");
        });
    };

    const openEdit = (row?: any) => {
        editForm.resetFields();
        editForm.setFieldsValue(row || { role: "", name: "" });
        dispatch({ dlgType: DlgTypes.edit, targetRow: row || {}, editMode: row ? "edit" : "add" });
    };

    const doSave = () => {
        editForm.validateFields().then((values) => {
            dispatch({ saving: true });
            const request = data.editMode === "edit"
                ? Api.update_risk_participant({ ...data.targetRow, ...values })
                : Api.add_risk_participant(values);
            request.then((res: any) => {
                dispatch({ saving: false });
                if (res.code === Api.C_OK) {
                    message.success(ts("save_success"));
                    dispatch({ dlgType: null, targetRow: {} });
                    doSearch({}, data.pageIndex, data.pageSize);
                } else {
                    message.error(res.msg || "保存失败");
                }
            }).catch(() => {
                dispatch({ saving: false });
                message.error("保存失败");
            });
        });
    };

    const doDelete = () => {
        dispatch({ saving: true });
        Api.delete_risk_participant({ id: data.targetRow.id }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                message.success("删除成功");
                dispatch({ dlgType: null, targetRow: {} });
                doSearch({}, data.pageIndex, data.pageSize);
            } else {
                message.error(res.msg || "删除失败");
            }
        }).catch(() => {
            dispatch({ saving: false });
            message.error("删除失败");
        });
    };

    const columns: any[] = [
        { title: "项目角色", dataIndex: "role", width: 260 },
        { title: "姓名", dataIndex: "name", width: 220 },
        {
            title: ts("action"),
            width: 120,
            render: (_: any, row: any) => (
                <Space size={4}>
                    <Button type="link" size="small" onClick={() => openEdit(row)}>{ts("edit")}</Button>
                    <Button type="link" size="small" danger onClick={() => dispatch({ dlgType: DlgTypes.delete, targetRow: row })}>{ts("delete")}</Button>
                </Space>
            ),
        },
    ];

    return (
        <div className="page div-v">
            <div className="div-h searchbar list-searchbar-align">
                <Form form={queryForm} className="expand" onFinish={doSearch}>
                    <Space>
                        <Form.Item name="keyword">
                            <Input allowClear placeholder="项目角色/姓名" />
                        </Form.Item>
                        <Button icon={<SearchOutlined />} type="primary" htmlType="submit">{ts("fuzzy")}</Button>
                    </Space>
                </Form>
                <Button type="primary" onClick={() => openEdit()}>
                    {ts("add")}
                </Button>
            </div>
            <Table
                className="expand"
                rowKey="_rowKey"
                loading={data.loading}
                columns={columns}
                dataSource={data.rows}
                pagination={{
                    total: data.total,
                    current: data.pageIndex,
                    pageSize: data.pageSize,
                    pageSizeOptions,
                    showSizeChanger: true,
                    onChange: (page, pageSize) => doSearch(queryForm.getFieldsValue(), page, pageSize),
                }}
            />
            <Modal
                title={`${data.editMode === "edit" ? ts("edit") : ts("add")}风险分析参与人员`}
                open={data.dlgType === DlgTypes.edit}
                confirmLoading={data.saving}
                onOk={doSave}
                onCancel={() => dispatch({ dlgType: null })}>
                <Form form={editForm} layout="vertical">
                    <Form.Item name="role" label="项目角色" rules={[{ required: true, message: "请输入项目角色" }]}>
                        <Input allowClear />
                    </Form.Item>
                    <Form.Item name="name" label="姓名" rules={[{ required: true, message: "请输入姓名" }]}>
                        <Input allowClear />
                    </Form.Item>
                </Form>
            </Modal>
            <Modal
                title={ts("confirm_delete")}
                open={data.dlgType === DlgTypes.delete}
                confirmLoading={data.saving}
                onOk={doDelete}
                onCancel={() => dispatch({ dlgType: null })}>
                确认删除该参与人员吗？
            </Modal>
        </div>
    );
};
