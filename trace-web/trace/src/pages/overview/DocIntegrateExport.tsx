import { Button, Empty, Modal, Space, Spin, Tag, Tree, message } from "antd";
import type { DataNode } from "antd/es/tree";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as ApiProduct from "@/api/ApiProduct";
import * as ApiIntegrate from "@/api/ApiDocIntegrate";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "./DocIntegrateExport.less";

const GROUP_TITLES: Record<string, string> = {
    product_files: "产品文件",
    dev_files: "开发文件",
    test_files: "测试文件",
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
    const [data, setData] = useState<any>(null);
    const [checkedKeys, setCheckedKeys] = useState<string[]>([]);

    useEffect(() => {
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) setProducts(res.data?.rows || []);
        });
    }, []);

    const loadDocs = (pid: number) => {
        setProductId(pid);
        setLoading(true);
        setCheckedKeys([]);
        ApiIntegrate.list_integrate_docs({ product_id: pid }).then((res: any) => {
            setLoading(false);
            if (res.code === ApiIntegrate.C_OK) {
                setData(res.data);
            } else {
                setData(null);
                message.error(res.msg);
            }
        });
    };

    // 构建树形数据
    const treeData = useMemo<DataNode[]>(() => {
        if (!data?.groups) return [];
        const groups = data.groups;
        return (["product_files", "dev_files", "test_files"] as const).map((gkey) => {
            const modules = groups[gkey] || [];
            return {
                key: gkey,
                title: <span style={{ fontWeight: 600 }}>{GROUP_TITLES[gkey]}</span>,
                children: modules.map((m: any) => ({
                    key: `${gkey}::${m.module_key}`,
                    title: <span>{m.module_name} <Tag style={{ marginLeft: 6 }}>{m.docs.length}</Tag></span>,
                    children: m.docs.map((d: any) => ({
                        key: `${gkey}::${m.module_key}::${d.id}`,
                        title: (
                            <span>
                                {d.module_name}
                                {d.version ? ` v${d.version}` : ""}
                                {d.file_no ? ` (${d.file_no})` : ""}
                            </span>
                        ),
                        isLeaf: true,
                    })),
                })),
            };
        });
    }, [data]);

    const onCheck = (keys: any) => {
        setCheckedKeys(Array.isArray(keys) ? keys : (keys as any).checked);
    };

    // 选中的叶子节点 → module_key:id 列表
    const selectedDocs = useMemo(() => {
        return checkedKeys.filter((k) => k.split("::").length === 3);
    }, [checkedKeys]);

    // 拼 doc_keys 参数：module_key:id,module_key:id
    const buildDocKeys = () => {
        return selectedDocs.map((k) => {
            const parts = k.split("::");
            return `${parts[1]}:${parts[2]}`;
        }).join(",");
    };

    const doExport = () => {
        if (!productId) { message.warning("请先选择产品"); return; }
        if (selectedDocs.length === 0) { message.warning("请勾选要导出的文档"); return; }
        const docKeys = buildDocKeys();
        setExporting(true);
        setPacking(true);
        setPackInfo({ total: selectedDocs.length, done: 0, current: "" });
        // 用 EventSource 接收 SSE 进度流
        const url = ApiIntegrate.integrate_export_progress_url(productId, docKeys);
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
                    setPackInfo({ total: selectedDocs.length, done: selectedDocs.length, current: "" });
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

    const doPrint = () => {
        if (!productId) { message.warning("请先选择产品"); return; }
        if (selectedDocs.length === 0) { message.warning("请勾选要打印的文档"); return; }
        const docKeys = buildDocKeys();
        setPrinting(true);
        ApiIntegrate.one_click_print_list({ product_id: productId, doc_keys: docKeys }).then((res: any) => {
            setPrinting(false);
            if (res.code === ApiIntegrate.C_OK) {
                const items = res.data?.items || [];
                if (items.length === 0) { message.warning("无可打印文档"); return; }
                message.info(`将打开 ${items.length} 个文档查看页，请在各页面使用浏览器打印（Ctrl+P）`);
                // 逐个打开查看页（新窗口）
                items.forEach((it: any, idx: number) => {
                    setTimeout(() => {
                        window.open(`#/doc_integrate_print/${it.module_key}/${it.doc_id}`, `_blank_${idx}`);
                    }, idx * 200);
                });
            } else {
                message.error(res.msg);
            }
        }).catch(() => setPrinting(false));
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
                    <Button type="primary" loading={exporting} onClick={doExport} disabled={selectedDocs.length === 0}>
                        整合导出（{selectedDocs.length}）
                    </Button>
                    <Button loading={printing} onClick={doPrint} disabled={selectedDocs.length === 0}>
                        一键打印（{selectedDocs.length}）
                    </Button>
                </Space>
            </div>

            <Spin spinning={loading}>
                <div className="doc-integrate-body">
                    {treeData.length === 0 && !loading ? (
                        <Empty description="请选择产品查看文档清单" />
                    ) : (
                        <Tree
                            checkable
                            defaultExpandAll
                            treeData={treeData}
                            onCheck={onCheck}
                            checkedKeys={checkedKeys}
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
        </div>
    );
};
