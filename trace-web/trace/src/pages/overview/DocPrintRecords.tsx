import { Button, Space, Table, Tag, Tooltip, message } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as ApiIntegrate from "@/api/ApiDocIntegrate";
import "./DocRecords.less";

export default () => {
    const { t: ts } = useTranslation();
    const [rows, setRows] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const load = () => {
        setLoading(true);
        ApiIntegrate.list_print_records({ page_index: 0, page_size: 100 }).then((res: any) => {
            setLoading(false);
            if (res.code === ApiIntegrate.C_OK) setRows(res.data?.rows || []);
            else message.error(res.msg);
        });
    };

    useEffect(() => { load(); }, []);

    const columns = [
        { title: "产品名称", dataIndex: "product_name", width: 160 },
        { title: "完整版本", dataIndex: "full_version", width: 120 },
        { title: "文档数量", dataIndex: "doc_count", width: 100 },
        { title: "成功", dataIndex: "success_count", width: 80, render: (v: number) => <Tag color="green">{v}</Tag> },
        { title: "失败", dataIndex: "fail_count", width: 80, render: (v: number) => v > 0 ? <Tag color="red">{v}</Tag> : <span style={{ color: "#ccc" }}>0</span> },
        {
            title: "打印文件", dataIndex: "doc_names", ellipsis: true,
            render: (v: string) => v ? (
                <Tooltip title={v}>
                    <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "inline-block", maxWidth: 300 }}>{v}</span>
                </Tooltip>
            ) : <span style={{ color: "#ccc" }}>-</span>,
        },
        { title: "打印机", dataIndex: "printer_name", width: 160 },
        { title: "操作人", dataIndex: "operator", width: 100 },
        { title: "打印时间", dataIndex: "create_time" },
    ];

    return (
        <div className="page div-v doc-records-page">
            <div className="div-h doc-records-toolbar">
                <span style={{ fontSize: 18, fontWeight: 700, color: "#1e3a8a" }}>打印记录</span>
                <Space style={{ marginLeft: "auto" }}>
                    <Button onClick={load}>刷新</Button>
                </Space>
            </div>
            <div className="doc-records-body">
                <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} pagination={false} size="small" />
            </div>
        </div>
    );
};