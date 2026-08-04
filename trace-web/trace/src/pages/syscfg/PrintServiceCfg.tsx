import { Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as ApiPrint from "@/api/ApiPrintCfg";
import "./PrintServiceCfg.less";

const PROTOCOL_OPTIONS = [
    { value: "tcp9100", label: "TCP/IP 9100" },
    { value: "ipp", label: "IPP 631" },
];

enum DlgType { add = "add", edit = "edit", delete = "delete" }

export default () => {
    const { t: ts } = useTranslation();
    const [form] = Form.useForm();
    const [rows, setRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [dlgType, setDlgType] = useState<DlgType | null>(null);
    const [targetRow, setTargetRow] = useState<any>({});
    const [saving, setSaving] = useState(false);
    const [testingId, setTestingId] = useState<number>(0);

    const load = () => {
        setLoading(true);
        ApiPrint.list_print_cfg({ page_index: 0, page_size: 100 }).then((res: any) => {
            setLoading(false);
            if (res.code === ApiPrint.C_OK) setRows(res.data?.rows || []);
            else message.error(res.msg);
        });
    };

    useEffect(() => { load(); }, []);

    const onAdd = () => {
        form.resetFields();
        form.setFieldsValue({ protocol: "tcp9100", printer_port: 9100, is_default: 0 });
        setTargetRow({});
        setDlgType(DlgType.add);
    };

    const onEdit = (row: any) => {
        form.setFieldsValue(row);
        setTargetRow(row);
        setDlgType(DlgType.edit);
    };

    const onSave = () => {
        form.validateFields().then((values) => {
            setSaving(true);
            const isAdd = dlgType === DlgType.add;
            const params = isAdd ? values : { ...values, id: targetRow.id };
            const api = isAdd ? ApiPrint.add_print_cfg : ApiPrint.update_print_cfg;
            api(params).then((res: any) => {
                setSaving(false);
                if (res.code === ApiPrint.C_OK) {
                    message.success(ts("save_success"));
                    setDlgType(null);
                    // 延迟刷新，确保 Modal 关闭后再加载数据
                    setTimeout(() => load(), 100);
                } else message.error(res.msg);
            });
        });
    };

    const onDelete = () => {
        ApiPrint.delete_print_cfg({ id: targetRow.id }).then((res: any) => {
            if (res.code === ApiPrint.C_OK) {
                message.success(ts("save_success"));
                setDlgType(null);
                setTimeout(() => load(), 100);
            } else message.error(res.msg);
        });
    };

    const onTest = (row: any) => {
        setTestingId(row.id);
        ApiPrint.test_print_conn({ id: row.id }).then((res: any) => {
            setTestingId(0);
            if (res.code === ApiPrint.C_OK) {
                const d = res.data;
                if (d && d.ok) message.success(d.msg);
                else if (d) message.error(d.msg);
                else message.error("测试失败：未返回数据");
            } else {
                message.error(res.msg || "测试失败");
            }
        }).catch((e: any) => {
            setTestingId(0);
            message.error("测试连接请求失败：" + (e?.message || e));
        });
    };

    const columns = [
        {
            title: "打印机IP", dataIndex: "printer_host", width: 160,
            render: (v: string, r: any) => <span>{v}:{r.printer_port}</span>,
        },
        { title: "打印机名称", dataIndex: "printer_name", width: 200 },
        {
            title: "协议", dataIndex: "protocol", width: 120,
            render: (v: string) => v === "tcp9100" ? "TCP/IP 9100" : "IPP 631",
        },
        { title: "备注", dataIndex: "remark" },
        {
            title: "默认", dataIndex: "is_default", width: 80,
            render: (v: number) => v === 1 ? <Tag color="blue">默认</Tag> : <span style={{ color: "#ccc" }}>-</span>,
        },
        {
            title: "操作", width: 200,
            render: (_: any, row: any) => (
                <Space size="small">
                    <Button type="link" size="small" loading={testingId === row.id} onClick={() => onTest(row)}>测试连接</Button>
                    <Button type="link" size="small" onClick={() => onEdit(row)}>编辑</Button>
                    <Button type="link" size="small" danger onClick={() => { setTargetRow(row); setDlgType(DlgType.delete); }}>删除</Button>
                </Space>
            ),
        },
    ];

    return (
        <div className="page div-v print-cfg-page">
            <div className="div-h print-cfg-toolbar">
                <span style={{ fontSize: 18, fontWeight: 700, color: "#1e3a8a" }}>打印服务配置</span>
                <Space style={{ marginLeft: "auto" }}>
                    <Button onClick={load}>刷新</Button>
                    <Button type="primary" onClick={onAdd}>新增打印机</Button>
                </Space>
            </div>
            <div className="print-cfg-body">
                <Table
                    rowKey="id"
                    loading={loading}
                    columns={columns}
                    dataSource={rows}
                    pagination={false}
                    size="small"
                />
            </div>

            <Modal
                title={dlgType === DlgType.add ? "新增打印机" : "编辑打印机"}
                open={dlgType === DlgType.add || dlgType === DlgType.edit}
                confirmLoading={saving}
                onOk={onSave}
                onCancel={() => setDlgType(null)}
                width={560}
                maskClosable={false}
            >
                <Form form={form} layout="vertical">
                    <Form.Item label="打印机IP / 主机名" name="printer_host" rules={[{ required: true, message: "请输入打印机IP或主机名" }]}>
                        <Input placeholder="如 192.168.108.110" />
                    </Form.Item>
                    <Form.Item label="端口" name="printer_port" rules={[{ required: true }]}>
                        <InputNumber min={1} max={65535} style={{ width: "100%" }} placeholder="TCP/IP默认9100，IPP默认631" />
                    </Form.Item>
                    <Form.Item label="协议" name="protocol" rules={[{ required: true }]}>
                        <Select
                            options={PROTOCOL_OPTIONS}
                            onChange={(v) => form.setFieldValue("printer_port", v === "tcp9100" ? 9100 : 631)}
                        />
                    </Form.Item>
                    <Form.Item label="打印机名称" name="printer_name">
                        <Input placeholder="如 Generic_PostScript_Printer" />
                    </Form.Item>
                    <Form.Item label="备注" name="remark">
                        <Input placeholder="如：三楼打印机" />
                    </Form.Item>
                    <Form.Item label="设为默认打印机" name="is_default" valuePropName="checked">
                        <Select options={[{ value: 1, label: "是" }, { value: 0, label: "否" }]} />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title="确认删除"
                open={dlgType === DlgType.delete}
                onOk={onDelete}
                onCancel={() => setDlgType(null)}
                okButtonProps={{ danger: true }}
            >
                <p>确认删除打印机「{targetRow.printer_host}」吗？</p>
            </Modal>
        </div>
    );
};
