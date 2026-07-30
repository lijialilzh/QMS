import { Button, Collapse, Empty, Modal, Radio, Space, Spin, Table, Tag, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiIntegrate from "@/api/ApiDocIntegrate";
import * as ApiPrint from "@/api/ApiPrintCfg";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "./DocIntegrateExport.less";

const GROUP_ORDER = ["product_files", "dev_files", "test_files"] as const;
const GROUP_TITLES: Record<string, string> = {
    product_files: "产品文件",
    dev_files: "开发文件",
    test_files: "测试文件",
};
const GROUP_COLORS: Record<string, string> = {
    product_files: "blue",
    dev_files: "green",
    test_files: "orange",
};

export default () => {
    const { t: ts } = useTranslation();
    const [products, setProducts] = useState<any[]>([]);
    const [productId, setProductId] = useState<number | undefined>();
    const [loading, setLoading] = useState(false);
    const [printing, setPrinting] = useState(false);
    const [data, setData] = useState<any>(null);
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
    const [printPack, setPrintPack] = useState(false);
    const [printInfo, setPrintInfo] = useState({ total: 0, done: 0, current: "", ok: 0, fail: 0 });
    const cancelRef = useRef(false);
    const [activeGroups, setActiveGroups] = useState<string[]>([]);
    const [withSign, setWithSign] = useState<boolean>(true);

    useEffect(() => {
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) {
                const rows = res.data?.rows || [];
                setProducts(rows);
                // 自动选中第一个产品并加载文档
                if (rows.length > 0) loadDocs(rows[0].id);
            }
        });
    }, []);

    const loadDocs = (pid: number) => {
        setProductId(pid);
        setLoading(true);
        setSelectedRowKeys([]);
        ApiIntegrate.list_integrate_docs({ product_id: pid }).then((res: any) => {
            setLoading(false);
            if (res.code === ApiIntegrate.C_OK) setData(res.data);
            else { setData(null); message.error(res.msg); }
        });
    };

    // 按分组整理表格行
    const groupedRows = useMemo(() => {
        const map: Record<string, any[]> = { product_files: [], dev_files: [], test_files: [] };
        if (!data?.groups) return map;
        for (const gkey of GROUP_ORDER) {
            for (const m of (data.groups[gkey] || [])) {
                for (const d of m.docs) {
                    map[gkey].push({
                        key: `${gkey}::${m.module_key}::${d.id}`,
                        group: GROUP_TITLES[gkey],
                        module_name: m.module_name,
                        file_no: d.file_no || "",
                        version: d.version || "",
                        module_key: m.module_key,
                        doc_id: d.id,
                    });
                }
            }
        }
        return map;
    }, [data]);

    const totalCount = GROUP_ORDER.reduce((sum, g) => sum + groupedRows[g].length, 0);

    // 全选/取消某个分组的所有文档
    const toggleGroupAll = (gkey: string, checked: boolean) => {
        const groupKeys = groupedRows[gkey].map((r) => r.key);
        if (checked) {
            setSelectedRowKeys((prev) => Array.from(new Set([...prev, ...groupKeys])));
        } else {
            setSelectedRowKeys((prev) => prev.filter((k) => !groupKeys.includes(k)));
        }
    };

    // 核心打印：传入要打印的 key 数组
    const printByKeys = async (keys: string[]) => {
        if (!productId) { message.warning("请先选择产品"); return; }
        if (keys.length === 0) { message.warning("请勾选要打印的文档"); return; }
        setPrinting(true);
        setPrintPack(true);
        cancelRef.current = false;
        setPrintInfo({ total: keys.length, done: 0, current: "准备打印...", ok: 0, fail: 0 });
        let okCount = 0, failCount = 0;
        const printedNames: string[] = [];
        for (let i = 0; i < keys.length; i++) {
            if (cancelRef.current) break;
            const k = keys[i];
            const parts = k.split("::");
            const moduleKey = parts[1];
            const docId = parts[2];
            const row = Object.values(groupedRows).flat().find((r: any) => r.key === k);
            const displayName = row ? `${row.module_name}${row.version ? " v" + row.version : ""}` : moduleKey;
            setPrintInfo({ total: keys.length, done: i, current: displayName, ok: okCount, fail: failCount });
            try {
                const res: any = await ApiPrint.ipp_print_doc({ module_key: moduleKey, doc_id: Number(docId), with_sign: withSign });
                if (res.code === ApiPrint.C_OK) { okCount++; printedNames.push(displayName); }
                else failCount++;
            } catch { failCount++; }
        }
        const cancelled = cancelRef.current;
        setPrintInfo({ total: keys.length, done: cancelled ? okCount + failCount : keys.length, current: "", ok: okCount, fail: failCount });
        setPrinting(false);
        ApiIntegrate.add_print_record({
            product_id: productId || 0,
            product_name: data?.product_name || "",
            full_version: data?.full_version || "",
            doc_count: keys.length,
            success_count: okCount,
            fail_count: failCount,
            printer_name: "",
            doc_names: printedNames.join(", "),
            operator: "",
        }).then((res: any) => {
            if (res.code !== ApiIntegrate.C_OK) console.warn("写入打印记录失败", res.msg);
        }).catch((e: any) => console.warn("写入打印记录异常", e));
        setTimeout(() => {
            setPrintPack(false);
            message.success(`已发送 ${okCount} 份文档到打印机${failCount > 0 ? `, ${failCount} 份失败` : ""}`);
        }, 1500);
    };

    const doPrint = () => printByKeys(selectedRowKeys);
    // 单条打印
    const doPrintOne = (key: string) => printByKeys([key]);

    return (
        <div className="page div-v doc-integrate">
            <div className="div-h doc-integrate-toolbar">
                <div className="doc-integrate-title">
                    <span style={{ fontSize: 18, fontWeight: 700, color: "#1e3a8a" }}>一键打印</span>
                    <span style={{ marginLeft: 16, width: 360, display: "inline-block" }}>
                        <ProductVersionSelect
                            products={products}
                            value={productId}
                            allowClear={false}
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.full_version")}
                            onChange={(v) => v && loadDocs(v)}
                        />
                    </span>
                    {data?.product_name && (
                        <span style={{ marginLeft: 12, color: "#6b7280" }}>{data.product_name} / {data.full_version}</span>
                    )}
                </div>
                <Space>
                    <Radio.Group value={withSign} onChange={(e) => setWithSign(e.target.value)} size="small">
                        <Radio.Button value={true}>带签名</Radio.Button>
                        <Radio.Button value={false}>不带签名</Radio.Button>
                    </Radio.Group>
                    <Button type="primary" loading={printing} onClick={doPrint} disabled={selectedRowKeys.length === 0}>
                        一键打印（{selectedRowKeys.length}）
                    </Button>
                </Space>
            </div>

            <Spin spinning={loading}>
                <div className="doc-integrate-body">
                    {totalCount === 0 && !loading ? (
                        <Empty description="请选择产品查看文档清单" />
                    ) : (
                        <Collapse
                            activeKey={activeGroups}
                            onChange={(keys: any) => setActiveGroups(keys as string[])}
                            className="doc-group-collapse"
                            items={GROUP_ORDER.map((gkey) => {
                                const rows = groupedRows[gkey];
                                const groupSelected = rows.filter((r) => selectedRowKeys.includes(r.key));
                                const allChecked = rows.length > 0 && groupSelected.length === rows.length;
                                return {
                                    key: gkey,
                                    label: (
                                        <div className="doc-group-header">
                                            <Tag color={GROUP_COLORS[gkey]} style={{ marginRight: 8 }}>
                                                {GROUP_TITLES[gkey]}
                                            </Tag>
                                            <span className="doc-group-count">
                                                共 {rows.length} 份，已选 {groupSelected.length} 份
                                            </span>
                                            <a
                                                className="doc-group-selectall"
                                                onClick={(e) => { e.stopPropagation(); toggleGroupAll(gkey, !allChecked); }}
                                            >
                                                {allChecked ? "取消全选" : "全选"}
                                            </a>
                                        </div>
                                    ),
                                    children: rows.length === 0 ? (
                                        <Empty description={`暂无${GROUP_TITLES[gkey]}`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                                    ) : (
                                        <Table
                                            rowKey="key"
                                            columns={[
                                                { title: "文件名称", dataIndex: "module_name", width: 200 },
                                                { title: "文件编号", dataIndex: "file_no", width: 200, render: (v: string) => v ? <span style={{ fontSize: 12, color: "#6b7280" }}>{v}</span> : "-" },
                                                { title: "文档版本", dataIndex: "version", width: 100, render: (v: string) => v || "-" },
                                                {
                                                    title: "操作", key: "action", width: 90, fixed: "right" as const,
                                                    render: (_: any, record: any) => (
                                                        <Button type="link" size="small" loading={printing} onClick={() => doPrintOne(record.key)}>
                                                            打印
                                                        </Button>
                                                    ),
                                                },
                                            ]}
                                            dataSource={rows}
                                            pagination={false}
                                            size="small"
                                            rowSelection={{
                                                selectedRowKeys,
                                                onChange: (keys: any) => setSelectedRowKeys(keys as string[]),
                                            }}
                                        />
                                    ),
                                };
                            })}
                        />
                    )}
                </div>
            </Spin>

            <Modal open={printPack} centered closable={false} maskClosable={false} footer={null} width={480} zIndex={9999}>
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <Spin size="large" />
                    <div style={{ marginTop: 16, fontSize: 16, fontWeight: 600, color: "#1e3a8a" }}>
                        {printInfo.done < printInfo.total && !cancelRef.current ? `正在打印第 ${printInfo.done + 1} / ${printInfo.total} 个文档` : cancelRef.current ? "已取消打印" : "打印任务完成"}
                    </div>
                    {printInfo.done < printInfo.total && printInfo.current && !cancelRef.current && (
                        <div style={{ marginTop: 8, fontSize: 14, color: "#3b82f6" }}>{printInfo.current}</div>
                    )}
                    <div style={{ marginTop: 16, padding: "0 20px" }}>
                        <div style={{ background: "#e5e7eb", borderRadius: 8, height: 8, overflow: "hidden" }}>
                            <div style={{ background: "linear-gradient(to right, #3b82f6, #60a5fa)", height: "100%", width: `${printInfo.total > 0 ? (printInfo.done / printInfo.total) * 100 : 0}%`, transition: "width 0.3s" }} />
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, color: "#9ca3af" }}>
                            {printInfo.done} / {printInfo.total} 已发送（成功 {printInfo.ok}，失败 {printInfo.fail}）
                        </div>
                    </div>
                    {printInfo.done < printInfo.total && !cancelRef.current && (
                        <Button danger style={{ marginTop: 16 }} onClick={() => { cancelRef.current = true; }}>
                            取消打印
                        </Button>
                    )}
                    {(printInfo.done >= printInfo.total || cancelRef.current) && (
                        <Button type="primary" style={{ marginTop: 16 }} onClick={() => setPrintPack(false)}>
                            关闭
                        </Button>
                    )}
                </div>
            </Modal>
        </div>
    );
};
