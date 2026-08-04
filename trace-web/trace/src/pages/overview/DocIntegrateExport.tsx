import { Button, Collapse, Empty, Modal, Radio, Space, Spin, Table, Tag, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiIntegrate from "@/api/ApiDocIntegrate";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as ApiPrint from "@/api/ApiPrintCfg";
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
    const [exporting, setExporting] = useState(false);
    const [printing, setPrinting] = useState(false);
    const [packing, setPacking] = useState(false);
    const [packInfo, setPackInfo] = useState({ total: 0, done: 0, current: "" });
    const [printPack, setPrintPack] = useState(false);
    const [printInfo, setPrintInfo] = useState({ total: 0, done: 0, current: "", ok: 0, fail: 0 });
    const [data, setData] = useState<any>(null);
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
    const [activeGroups, setActiveGroups] = useState<string[]>([]);
    const [withSign, setWithSign] = useState<boolean>(true);

    useEffect(() => {
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) {
                const rows = res.data?.rows || [];
                setProducts(rows);
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
        const map: Record<string, any[]> = {};
        if (!data?.groups) return map;
        for (const gkey of Object.keys(data.groups)) {
            const modules = data.groups[gkey] || [];
            map[gkey] = [];
            for (const m of modules) {
                for (const d of m.docs) {
                    map[gkey].push({
                        key: `${gkey}::${m.module_key}::${d.id}`,
                        group: GROUP_TITLES[gkey] || gkey,
                        module_name: m.module_name,
                        file_no: d.file_no || "",
                        version: d.version || "",
                        module_key: m.module_key,
                        doc_id: d.id,
                        change_log: d.change_log || "",
                        create_time: d.create_time || "",
                    });
                }
            }
        }
        return map;
    }, [data]);

    const totalCount = Object.keys(groupedRows).reduce((sum, g) => sum + groupedRows[g].length, 0);

    // 全选/取消某个分组的所有文档
    const toggleGroupAll = (gkey: string, checked: boolean) => {
        const groupKeys = groupedRows[gkey].map((r) => r.key);
        if (checked) {
            setSelectedRowKeys((prev) => Array.from(new Set([...prev, ...groupKeys])));
        } else {
            setSelectedRowKeys((prev) => prev.filter((k) => !groupKeys.includes(k)));
        }
    };

    const selectedCount = selectedRowKeys.length;

    // 核心导出：传入要导出的 key 数组（key 格式：gkey::module_key::doc_id）
    const exportByKeys = (keys: string[]) => {
        if (!productId) { message.warning("请先选择产品"); return; }
        if (keys.length === 0) { message.warning("请勾选要导出的文档"); return; }
        const docKeys = keys.map((k) => {
            const parts = k.split("::");
            return `${parts[1]}:${parts[2]}`;
        }).join(",");
        setExporting(true);
        setPacking(true);
        setPackInfo({ total: keys.length, done: 0, current: "" });
        // 用 EventSource 接收 SSE 进度流
        const url = ApiIntegrate.integrate_export_progress_url(productId, docKeys, withSign);
        const es = new EventSource(url);
        es.onmessage = (ev) => {
            try {
                const d = JSON.parse(ev.data);
                if (d.type === "start") {
                    setPackInfo({ total: d.total, done: 0, current: "" });
                } else if (d.type === "progress") {
                    setPackInfo({ total: d.total, done: d.idx, current: d.name + (d.status === "ok" ? "" : `（${d.status === "skip" ? "跳过" : "失败"}）`) });
                } else if (d.type === "done") {
                    es.close();
                    setPackInfo({ total: keys.length, done: keys.length, current: "" });
                    // 用 token 下载 zip
                    const dlUrl = ApiIntegrate.integrate_download_url(d.token);
                    const a = document.createElement("a");
                    a.href = dlUrl;
                    a.download = d.filename || "";
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    // 短暂显示完成状态后关闭弹窗
                    setTimeout(() => {
                        setPacking(false);
                        const failMsg = d.failed > 0 ? `，${d.failed} 份失败` : "";
                        message.success(`已导出 ${d.success} 份文档${failMsg}`);
                    }, 800);
                    setExporting(false);
                }
            } catch (e) { /* ignore parse error */ }
        };
        es.onerror = () => {
            es.close();
            setPacking(false);
            setExporting(false);
            message.error("导出失败，请重试");
        };
    };

    const doExport = () => exportByKeys(selectedRowKeys);

    // 单条导出：直接下载 docx（不打包 zip）
    const doExportOne = (key: string) => {
        if (!productId) { message.warning("请先选择产品"); return; }
        const parts = key.split("::");
        const moduleKey = parts[1];
        const docId = Number(parts[2]);
        const url = ApiIntegrate.export_single_doc_url(moduleKey, docId, withSign);
        const a = document.createElement("a");
        a.href = url;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        message.success("正在下载文档...");
    };

    const doPrint = async () => {
        if (!productId) { message.warning("请先选择产品"); return; }
        if (selectedRowKeys.length === 0) { message.warning("请勾选要打印的文档"); return; }
        setPrinting(true);
        setPrintPack(true);
        setPrintInfo({ total: selectedRowKeys.length, done: 0, current: "准备打印...", ok: 0, fail: 0 });
        let okCount = 0, failCount = 0;
        // 逐个调 IPP 打印接口
        for (let i = 0; i < selectedRowKeys.length; i++) {
            const k = selectedRowKeys[i];
            const parts = k.split("::");
            const moduleKey = parts[1];
            const docId = parts[2];
            // 从树数据里找文档中文名
            let displayName = moduleKey;
            if (data?.groups) {
                for (const gkey of Object.keys(data.groups)) {
                    const modules = data.groups[gkey] || [];
                    for (const m of modules) {
                        if (m.module_key === moduleKey) {
                            const doc = m.docs.find((d: any) => String(d.id) === docId);
                            displayName = doc ? `${m.module_name}${doc.version ? " v" + doc.version : ""}` : m.module_name;
                        }
                    }
                }
            }
            setPrintInfo({ total: selectedRowKeys.length, done: i, current: displayName, ok: okCount, fail: failCount });
            try {
                const res: any = await ApiPrint.ipp_print_doc({ module_key: moduleKey, doc_id: Number(docId), with_sign: withSign });
                if (res.code === ApiPrint.C_OK) okCount++;
                else failCount++;
            } catch {
                failCount++;
            }
        }
        setPrintInfo({ total: selectedRowKeys.length, done: selectedRowKeys.length, current: "", ok: okCount, fail: failCount });
        setPrinting(false);
        setTimeout(() => {
            setPrintPack(false);
            const msg = failCount > 0 ? `，${failCount} 份失败` : "";
            message.success(`已发送 ${okCount} 份文档到打印机${msg}`);
        }, 1500);
    };

    return (
        <div className="page div-v doc-integrate">
            <div className="div-h doc-integrate-toolbar">
                <div className="doc-integrate-title">
                    <span style={{ fontSize: 18, fontWeight: 700, color: "#1e3a8a" }}>整合导出</span>
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
                        <span style={{ marginLeft: 12, color: "#6b7280" }}>
                            {data.product_name} / {data.full_version}
                        </span>
                    )}
                </div>
                <Space>
                    <Radio.Group value={withSign} onChange={(e) => setWithSign(e.target.value)} size="small">
                        <Radio.Button value={true}>带签名</Radio.Button>
                        <Radio.Button value={false}>不带签名</Radio.Button>
                    </Radio.Group>
                    <Button type="primary" loading={exporting} onClick={doExport} disabled={selectedCount === 0}>
                        整合导出（{selectedCount}）
                    </Button>
                    <Button loading={printing} onClick={doPrint} disabled={selectedCount === 0}>
                        一键打印（{selectedCount}）
                    </Button>
                </Space>
            </div>

            <Spin spinning={loading}>
                <div className="doc-integrate-body">
                    {!productId && !loading ? (
                        <Empty description="请选择对应产品导出操作" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 80 }} />
                    ) : totalCount === 0 && !loading ? (
                        <Empty description="该产品暂无文档" />
                    ) : (
                        <Collapse
                            activeKey={activeGroups}
                            onChange={(keys: any) => setActiveGroups(keys as string[])}
                            className="doc-group-collapse"
                            items={Object.keys(groupedRows).map((gkey) => {
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
                                                { title: "变更说明", dataIndex: "change_log", ellipsis: true },
                                                { title: "创建时间", dataIndex: "create_time", width: 180, render: (v: string) => v ? v.slice(0, 19) : "-" },
                                                {
                                                    title: "操作", key: "action", width: 90, fixed: "right" as const,
                                                    render: (_: any, record: any) => (
                                                        <Button type="link" size="small" loading={exporting} onClick={() => doExportOne(record.key)}>
                                                            导出
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

            {/* 打包进度弹窗：点击导出后立即显示，让用户知道正在处理 */}
            <Modal
                open={packing}
                centered
                closable={false}
                maskClosable={false}
                footer={null}
                width={480}
                zIndex={9999}
            >
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <Spin size="large" />
                    <div style={{ marginTop: 16, fontSize: 16, fontWeight: 600, color: "#1e3a8a" }}>
                        {packInfo.done < packInfo.total ? `正在加载第 ${packInfo.done + 1} / ${packInfo.total} 个文档` : "打包完成，正在下载..."}
                    </div>
                    {packInfo.done < packInfo.total && packInfo.current && (
                        <div style={{ marginTop: 8, fontSize: 14, color: "#3b82f6" }}>
                            {packInfo.current}
                        </div>
                    )}
                    {/* 进度条 */}
                    <div style={{ marginTop: 16, padding: "0 20px" }}>
                        <div style={{ background: "#e5e7eb", borderRadius: 8, height: 8, overflow: "hidden" }}>
                            <div style={{
                                background: "linear-gradient(to right, #3b82f6, #60a5fa)",
                                height: "100%",
                                width: `${packInfo.total > 0 ? (packInfo.done / packInfo.total) * 100 : 0}%`,
                                transition: "width 0.3s",
                            }} />
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, color: "#9ca3af" }}>
                            {packInfo.done} / {packInfo.total} 已完成
                        </div>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 12, color: "#9ca3af" }}>
                        {packInfo.done < packInfo.total
                            ? "正在逐个生成 Word 文档并打包，请稍候"
                            : "请查看浏览器下载栏"}
                    </div>
                </div>
            </Modal>

            {/* 打印进度弹窗：逐个发送到IPP打印机 */}
            <Modal
                open={printPack}
                centered
                closable={false}
                maskClosable={false}
                footer={null}
                width={480}
                zIndex={9999}
            >
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <Spin size="large" />
                    <div style={{ marginTop: 16, fontSize: 16, fontWeight: 600, color: "#1e3a8a" }}>
                        {printInfo.done < printInfo.total ? `正在打印第 ${printInfo.done + 1} / ${printInfo.total} 个文档` : "打印任务完成"}
                    </div>
                    {printInfo.done < printInfo.total && printInfo.current && (
                        <div style={{ marginTop: 8, fontSize: 14, color: "#3b82f6" }}>{printInfo.current}</div>
                    )}
                    <div style={{ marginTop: 16, padding: "0 20px" }}>
                        <div style={{ background: "#e5e7eb", borderRadius: 8, height: 8, overflow: "hidden" }}>
                            <div style={{
                                background: "linear-gradient(to right, #3b82f6, #60a5fa)",
                                height: "100%",
                                width: `${printInfo.total > 0 ? (printInfo.done / printInfo.total) * 100 : 0}%`,
                                transition: "width 0.3s",
                            }} />
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, color: "#9ca3af" }}>
                            {printInfo.done} / {printInfo.total} 已发送（成功 {printInfo.ok}，失败 {printInfo.fail}）
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
};
