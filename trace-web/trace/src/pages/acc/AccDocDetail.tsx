import { Button, Input, Space, Spin, Tag, message } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEffect, CSSProperties } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiAccDoc";
import * as ApiProduct from "@/api/ApiProduct";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import "../pdp/PdpDocDetail.less";

const emptyContent = { sections: [], productName: "" };

// 自动获取（只读）章节
const AUTO_REFS = new Set(["acc_info"]);
const isAutoNode = (node: any) => AUTO_REFS.has(node?.ref_type);

const cloneContent = (content: any) => JSON.parse(JSON.stringify(content || emptyContent));

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const { id } = useParams();
    const location = useLocation();
    const readonly = location.pathname.includes("/view/");

    const [data, dispatch] = useData({
        loading: false,
        saving: false,
        exporting: false,
        doc: {} as any,
        sections: [] as any[],
        products: [] as any[],
    });

    const load = () => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_acc_doc({ id }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            const doc = res.data || {};
            const content = doc.content || emptyContent;
            dispatch({ loading: false, doc, sections: content.sections || [] });
        });
    };

    const rebindProduct = (newId: number) => {
        const product = (data.products || []).find((p: any) => p.id === newId) || {};
        dispatch({ loading: true, doc: { ...data.doc, product_id: newId, product_name: product.name, product_full_version: product.full_version } });
        Api.acc_autofill({ product_id: newId }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false });
                message.error(res.msg);
                return;
            }
            dispatch({ loading: false, sections: (res.data && res.data.sections) || [] });
        });
    };

    useEffect(() => {
        load();
    }, [id, location.pathname]);

    useEffect(() => {
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data?.rows || [] });
        });
    }, []);

    // 按章节下标更新
    const updateSection = (si: number, updater: (n: any) => void) => {
        const next = cloneContent({ sections: data.sections });
        const node = next.sections[si];
        if (node) {
            updater(node);
            dispatch({ sections: next.sections });
        }
    };

    const doSave = () => {
        if (!id) return;
        dispatch({ saving: true });
        const content = cloneContent({ sections: data.sections, productName: data.doc.product_name || "" });
        Api.update_acc_doc({ id, content, product_id: data.doc.product_id, version: data.doc.version }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                message.success(ts("save_success"));
                load();
            } else {
                message.error(res.msg);
            }
        });
    };

    const doExport = async () => {
        if (!id) return;
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_acc_doc({ id });
            if (res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_e) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    // 验收内容表：追加/删除明细行（首行为表头，不可删）
    const addRow = (si: number, ti: number) => updateSection(si, (n) => {
        const tb = n.tables[ti] || [];
        const cols = (tb[0] || []).length || 4;
        tb.push(new Array(cols).fill(""));
        n.tables[ti] = tb;
    });
    const delRow = (si: number, ti: number, r: number) => updateSection(si, (n) => {
        n.tables[ti] = (n.tables[ti] || []).filter((_: any, i: number) => i !== r);
    });

    // ---- 单表（6 列栅格）单元格样式，与 Word 原版一致 ----
    const tdBase: CSSProperties = { border: "1px solid #9aa4b0", padding: "6px 10px", fontSize: 13, verticalAlign: "middle", whiteSpace: "pre-wrap", textAlign: "left" };
    const tdHead: CSSProperties = { ...tdBase, background: "#eef2f7", fontWeight: 600, color: "#334", textAlign: "center" };
    const tdLabel: CSSProperties = { ...tdBase, background: "#f5f7fa", color: "#555", fontWeight: 500 };

    // 各行类型对应的 6 列栅格跨度
    const INFO_SPANS = [2, 2, 1, 1];
    const ITEM_SPANS = [1, 2, 2, 1];

    // 按角色定位三段内容
    const infoIdx = (data.sections || []).findIndex((s: any) => isAutoNode(s));
    const itemIdx = (data.sections || []).findIndex((s: any) => !isAutoNode(s) && (s.tables || []).length > 0);
    const concIdx = (data.sections || []).findIndex((s: any) => !isAutoNode(s) && (s.tables || []).length === 0);
    const infoSec = infoIdx >= 0 ? data.sections[infoIdx] : null;
    const itemSec = itemIdx >= 0 ? data.sections[itemIdx] : null;
    const concSec = concIdx >= 0 ? data.sections[concIdx] : null;
    const infoRows: any[][] = (infoSec && infoSec.tables && infoSec.tables[0]) || [];
    const itemRows: any[][] = (itemSec && itemSec.tables && itemSec.tables[0]) || [];

    // 明细行（去掉表头）重复项纵向合并：序号按相同序号合并；验收内容在同序号组内按相同内容合并
    const dataRows: any[][] = itemRows.slice(1);
    type VInfo = { render: boolean; span: number; start: number; end: number };
    const vspan: Record<number, Record<number, VInfo>> = {};
    {
        const eq = (a: any, b: any) => String(a ?? "") === String(b ?? "");
        const put = (idx: number, ci: number, o: VInfo) => { (vspan[idx] || (vspan[idx] = {}))[ci] = o; };
        const n = dataRows.length;
        let i = 0;
        while (i < n) {
            let j = i;
            while (j + 1 < n && eq(dataRows[j + 1][0], dataRows[i][0])) j++;
            put(i, 0, { render: true, span: j - i + 1, start: i, end: j });
            for (let k = i + 1; k <= j; k++) put(k, 0, { render: false, span: 0, start: i, end: j });
            let a = i;
            while (a <= j) {
                let b = a;
                while (b + 1 <= j && eq(dataRows[b + 1][1], dataRows[a][1])) b++;
                put(a, 1, { render: true, span: b - a + 1, start: a, end: b });
                for (let k = a + 1; k <= b; k++) put(k, 1, { render: false, span: 0, start: a, end: b });
                a = b + 1;
            }
            i = j + 1;
        }
    }

    // 编辑明细单元格：序号/验收内容改动联动整个合并组，其余按行
    const setItemCell = (dataIdx: number, ci: number, val: string) => {
        if (itemIdx < 0) return;
        updateSection(itemIdx, (nsec) => {
            const tb = nsec.tables[0] || (nsec.tables[0] = []);
            const info = vspan[dataIdx] && vspan[dataIdx][ci];
            if ((ci === 0 || ci === 1) && info) {
                for (let k = info.start; k <= info.end; k++) {
                    if (!tb[k + 1]) tb[k + 1] = [];
                    tb[k + 1][ci] = val;
                }
            } else {
                if (!tb[dataIdx + 1]) tb[dataIdx + 1] = [];
                tb[dataIdx + 1][ci] = val;
            }
        });
    };

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                <div className="pdp-toolbar-title">
                    产品验收记录
                    {readonly ? (
                        <span className="pdp-meta">
                            {data.doc.product_name ? `　${data.doc.product_name}` : ""}
                            {data.doc.product_full_version ? ` / ${data.doc.product_full_version}` : ""}
                            {data.doc.version ? `　文档版本：${data.doc.version}` : ""}
                        </span>
                    ) : (
                        <span className="pdp-meta" style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 12 }}>
                            <span style={{ width: 340, display: "inline-block" }}>
                                <ProductVersionSelect
                                    products={data.products}
                                    value={data.doc.product_id}
                                    allowClear={false}
                                    namePlaceholder={ts("product.name")}
                                    versionPlaceholder={ts("product.full_version")}
                                    onChange={(v) => v && rebindProduct(v)}
                                />
                            </span>
                            <span style={{ whiteSpace: "nowrap" }}>文档版本：</span>
                            <Input
                                size="small"
                                style={{ width: 110 }}
                                value={data.doc.version || ""}
                                onChange={(e) => dispatch({ doc: { ...data.doc, version: e.target.value } })}
                            />
                        </span>
                    )}
                </div>
                <Space>
                    {!readonly && (
                        <Button type="primary" loading={data.saving} onClick={doSave}>
                            {ts("save")}
                        </Button>
                    )}
                    <Button loading={data.exporting} onClick={doExport}>导出</Button>
                    <Button onClick={() => navigate("/acc_docs")}>{ts("back")}</Button>
                </Space>
            </div>

            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                <div style={{ height: "100%", overflow: "auto" }}>
                    <div style={{ padding: "12px 24px", maxWidth: 980, margin: "0 auto" }}>
                        <div style={{ textAlign: "center", fontSize: 18, fontWeight: 700, margin: "6px 0 10px" }}>
                            产品验收记录
                        </div>
                        <div style={{ margin: "0 0 6px" }}>
                            <Tag color="blue">基本信息自动获取（只读），验收内容/结论可编辑</Tag>
                        </div>

                        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
                            <colgroup>
                                <col style={{ width: "8%" }} />
                                <col style={{ width: "22%" }} />
                                <col style={{ width: "22%" }} />
                                <col style={{ width: "18%" }} />
                                <col style={{ width: "12%" }} />
                                <col style={{ width: "18%" }} />
                            </colgroup>
                            <tbody>
                                {/* 基本信息（自动获取，只读） */}
                                {infoRows.map((row: any[], ri: number) => (
                                    <tr key={`info-${ri}`}>
                                        {(row || []).map((cell: any, ci: number) => (
                                            <td key={ci} colSpan={INFO_SPANS[ci] || 1} style={ci % 2 === 0 ? tdLabel : tdBase}>
                                                {cell ?? ""}
                                            </td>
                                        ))}
                                    </tr>
                                ))}

                                {/* 验收内容：表头 + 明细行（可编辑，重复项纵向合并） */}
                                {itemRows.map((row: any[], ri: number) => {
                                    const isHeader = ri === 0;
                                    const dataIdx = ri - 1;
                                    return (
                                        <tr key={`item-${ri}`} style={{ position: "relative" }}>
                                            {Array.from({ length: 4 }).map((_, ci) => {
                                                const val = (row && row[ci]) ?? "";
                                                const mergeable = !isHeader && (ci === 0 || ci === 1);
                                                const info = mergeable ? (vspan[dataIdx] && vspan[dataIdx][ci]) : undefined;
                                                if (info && !info.render) return null; // 被上方合并单元格覆盖
                                                const cell = (
                                                    isHeader || readonly ? (
                                                        val
                                                    ) : (
                                                        <Input.TextArea
                                                            variant="borderless"
                                                            style={{ padding: 0, textAlign: "left" }}
                                                            autoSize={{ minRows: 1, maxRows: 8 }}
                                                            value={val}
                                                            onChange={(e) => setItemCell(dataIdx, ci, e.target.value)}
                                                        />
                                                    )
                                                );
                                                return (
                                                    <td
                                                        key={ci}
                                                        colSpan={ITEM_SPANS[ci] || 1}
                                                        rowSpan={info ? info.span : 1}
                                                        style={isHeader ? tdHead : tdBase}
                                                    >
                                                        {cell}
                                                        {!readonly && !isHeader && ci === 3 && (
                                                            <DeleteOutlined
                                                                title="删除该行"
                                                                style={{ position: "absolute", right: -20, top: 10, color: "#c0392b", cursor: "pointer" }}
                                                                onClick={() => itemIdx >= 0 && delRow(itemIdx, 0, ri)}
                                                            />
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}

                                {/* 验收结论：整行跨列（可编辑） */}
                                {concSec && (
                                    <tr>
                                        <td colSpan={6} style={{ ...tdBase, color: "#333" }}>
                                            {readonly ? (
                                                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{concSec.text ?? ""}</div>
                                            ) : (
                                                <Input.TextArea
                                                    variant="borderless"
                                                    style={{ padding: 0 }}
                                                    autoSize={{ minRows: 4, maxRows: 20 }}
                                                    value={concSec.text ?? ""}
                                                    onChange={(e) => concIdx >= 0 && updateSection(concIdx, (n) => { n.text = e.target.value; })}
                                                />
                                            )}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>

                        {!readonly && itemIdx >= 0 && (
                            <div style={{ marginTop: 8 }}>
                                <Button size="small" icon={<PlusOutlined />} onClick={() => addRow(itemIdx, 0)}>
                                    添加验收内容行
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </Spin>
        </div>
    );
};
