import { Button, Checkbox, Input, Modal, Space, Spin, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useEffect, CSSProperties } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import ReviewRecordTables from "@/pages/doc_fill/ReviewRecordTables";
import * as Api from "@/api/ApiQaDoc";
import * as ApiProduct from "@/api/ApiProduct";
import "../pdp/PdpDocDetail.less";

const clone = (value: any) => JSON.parse(JSON.stringify(value || { sections: [] }));

const PASS_CHECK = "\u2611\ufe0e 通过    \u25a1 存在问题";
const ISSUE_CHECK = "\u25a1 通过    \u2611\ufe0e 存在问题";
const CHECK_MARK = /[☑✓✔■\u2611\u00fe]/;

const reviewChoice = (text: string) => {
    const value = String(text || "");
    const passAt = value.indexOf("通过");
    const issueAt = value.indexOf("存在问题");
    if (passAt < 0 || issueAt < 0) return "pass";
    const beforeIssue = value.slice(passAt + 2, issueAt);
    if (CHECK_MARK.test(beforeIssue) && !CHECK_MARK.test(value.slice(0, passAt))) return "issue";
    return "pass";
};

const wordLayout = (table: any[]) => {
    const rows = (Array.isArray(table) ? table : []).map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []));
    const cols = rows.reduce((max, row) => Math.max(max, row.length), 0);
    rows.forEach((row) => { while (row.length < cols) row.push(""); });
    const skip = rows.map(() => new Array(cols).fill(false));
    const colspan = rows.map(() => new Array(cols).fill(1));
    const rowspan = rows.map(() => new Array(cols).fill(1));
    rows.forEach((row, r) => {
        let c = 0;
        while (c < cols) {
            if (row[c] === "<" || row[c] === "^") { c += 1; continue; }
            let end = c;
            while (end + 1 < cols && row[end + 1] === "<") {
                end += 1;
                skip[r][end] = true;
            }
            colspan[r][c] = end - c + 1;
            c = end + 1;
        }
    });
    for (let c = 0; c < cols; c += 1) {
        let r = 0;
        while (r < rows.length) {
            if (skip[r][c] || rows[r][c] === "^" || rows[r][c] === "<") { r += 1; continue; }
            let end = r;
            while (end + 1 < rows.length && rows[end + 1][c] === "^" && !skip[end + 1][c]) {
                end += 1;
                skip[end][c] = true;
            }
            rowspan[r][c] = end - r + 1;
            r = end + 1;
        }
    }
    return { rows, cols, skip, colspan, rowspan };
};

const checkItems = (text: string) => {
    const raw = String(text || "").trim();
    if (raw === "□" || raw === "☑" || raw === "■") return [{ on: raw !== "□", label: "" }];
    const parts = raw.split(/(?=[□☑■☐])/).map((item) => item.trim()).filter(Boolean);
    if (!parts.length || !parts.every((item) => /^[□☑■☐]/.test(item))) return null;
    return parts.map((item) => ({ on: /^[☑■]/.test(item), label: item.replace(/^[□☑■☐]\s*/, "").trim() }));
};

const checksExclusive = (items: { label: string }[]) => {
    const bare = items.map((item) => item.label.replace(/[　\s].*$/, "").replace(/[，,：:].*$/, ""));
    return bare.every((label) => ["合格", "不合格", "是", "否", "不适用"].includes(label));
};

const MARK = new Set(["<", "^"]);
const HEADER_KEYS = new Set([
    "检验项目|检验标准|检验结果|判定",
    "申请人|申请部门负责人|研发部负责人|质量部负责人|生产部负责人",
    "变更负责人|QA|研发工程师|研发工程师|其他",
    "设计开发阶段|设计开发活动|变更描述（将变更后的行动/文件在此进行记录）",
    "名称|物料编号|批号|数量|处理方法",
    "名称|产品规格|批号|数量|处理方法",
    "产品名称|产品规格|批号|数量|处理方法",
]);
const INFO_LABELS = new Set([
    "产品名称", "型号规格", "完整版本号", "序列号", "生产日期", "请验日期",
    "ECR号", "产品型号", "产品版本", "批准人", "批准时间",
    "检验人员/日期：", "审核人员/日期：", "检验结论", "不良状况记录", "备注",
    "评审时间", "批准时间",
    "结论", "变更负责人/完成日期", "质量部复核/日期", "产品部负责人确认/日期", "管理者代表批准/日期",
    "法规标准", "包装标识", "产品设计", "质量控制",
]);
const accBase: CSSProperties = { border: "1px solid #9aa4b0", padding: "6px 10px", fontSize: 13, verticalAlign: "middle", whiteSpace: "pre-wrap", textAlign: "left", background: "#fff", color: "#333", overflowWrap: "anywhere" };
const accHead: CSSProperties = { ...accBase, background: "#eef2f7", fontWeight: 600, color: "#334", textAlign: "center" };
const accLabel: CSSProperties = { ...accBase, background: "#f5f7fa", color: "#555", fontWeight: 500 };

const cellRole = (row: string[], cIndex: number, rowspan: number) => {
    const text = String(row[cIndex] || "");
    const visible = row.filter((cell) => cell && !MARK.has(cell));
    if (HEADER_KEYS.has(visible.join("|"))) return "head";
    const onlyMerge = row.every((cell, index) => index === cIndex || MARK.has(cell));
    if (visible.length === 1 && text === visible[0]) {
        if (text.includes("□") || text.includes("☑")) return "base";
        if (onlyMerge && text.length <= 24 && !text.includes("：") && !text.includes(":")) return "head";
        if (onlyMerge) return "label";
    }
    if (rowspan > 1 && text && !text.includes("□") && !text.includes("☑")) return "label";
    if (INFO_LABELS.has(text.trim())) return "label";
    const shown = row.filter((cell) => !MARK.has(cell));
    if (cIndex === 0 && shown.length === 2 && /[□☑]/.test(shown[1] || "") && text && !text.startsWith("□") && !text.startsWith("☑")) return "label";
    return "base";
};

const FORM_TITLES: Record<string, string> = {
    output_review: "设计开发输出评审",
    inspect_record: "成品检验记录",
    change_close: "变更评估及关闭表",
};

export default () => {
    const { t: ts } = useTranslation();
    const { kind = "", id = "" } = useParams();
    const navigate = useNavigate();
    const readonly = useLocation().pathname.includes("/view/");
    const [data, dispatch] = useData({
        doc: null as any,
        content: { sections: [] as any[] },
        products: [] as any[],
        activeIndex: 0,
        loading: true,
        saving: false,
        exporting: false,
    });

    useEffect(() => {
        dispatch({ loading: true, activeIndex: 0 });
        Api.get_qa_doc({ id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, doc: res.data, content: res.data.content || { sections: [] } });
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        }).catch(() => dispatch({ loading: false }));
        ApiProduct.list_product({ page_size: 10000 }).then((res: any) => {
            if (res.code === Api.C_OK) dispatch({ products: res.data.rows || [] });
        });
    }, [id]);

    const sections = data.content.sections || [];
    const activeIndex = Math.min(data.activeIndex || 0, Math.max(sections.length - 1, 0));
    const active = sections[activeIndex];

    const patchSection = (index: number, patch: any) => {
        const content = clone(data.content);
        content.sections[index] = { ...content.sections[index], ...patch };
        dispatch({ content });
    };

    const setCell = (tIndex: number, rIndex: number, cIndex: number, value: string, sIndex = activeIndex) => {
        const content = clone(data.content);
        content.sections[sIndex].tables[tIndex][rIndex][cIndex] = value;
        dispatch({ content });
    };

    const insertRowAfter = (tIndex: number, rIndex: number, sIndex = activeIndex) => {
        const content = clone(data.content);
        const table = content.sections[sIndex].tables[tIndex];
        const width = Math.max(...table.map((row: any[]) => row.length), 1);
        table.splice(rIndex + 1, 0, Array.from({ length: width }, () => ""));
        dispatch({ content });
    };

    const delRow = (tIndex: number, rIndex: number, sIndex = activeIndex) => {
        const content = clone(data.content);
        const table = content.sections[sIndex].tables[tIndex];
        if (table.length <= 1) return;
        table.splice(rIndex, 1);
        dispatch({ content });
    };

    const save = () => {
        dispatch({ saving: true });
        Api.update_qa_doc({
            id: data.doc.id,
            version: data.doc.version,
            change_log: data.doc.change_log,
            content: data.content,
        }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) message.success("已保存");
            else message.error(res.msg);
        }).catch(() => dispatch({ saving: false }));
    };

    const doExport = async () => {
        dispatch({ exporting: true });
        try {
            const res: any = await Api.export_qa_doc({ id: data.doc.id });
            if (res && res.code && res.code !== Api.C_OK) message.error(res.msg || "导出失败");
        } catch (_err) {
            message.error("导出失败");
        } finally {
            dispatch({ exporting: false });
        }
    };

    const rebindProduct = (newId: number) => {
        if (!data.doc || !newId || newId === data.doc.product_id) return;
        Modal.confirm({
            title: "切换产品",
            content: "切换产品和版本将重新获取自动填充内容，未保存的修改会丢失，是否继续？",
            okText: "切换",
            cancelText: "取消",
            onOk: () => Api.rebind_qa_doc({ id: data.doc.id, product_id: newId }).then((res: any) => {
                if (res.code !== Api.C_OK) {
                    message.error(res.msg);
                    return;
                }
                dispatch({ doc: res.data, content: res.data.content || { sections: [] }, activeIndex: 0 });
            }),
        });
    };

    const runtimeLocked = kind === "inspect_spec" && String(active?.title || "").includes("检验条件");
    const clauseTable = (tIndex: number) => kind === "inspect_spec" && String(active?.title || "").includes("软件技术要求") && tIndex === 1;
    const autoLabel = new Set(["产品名称", "完整版本", "发布版本", "产品版本", "文件名称", "说明书发布日期"]);
    const sectionTitle = String(active?.title || "");
    const cellLocked = (row: string[], cIndex: number, table: string[][], tIndex: number, rIndex: number, title = sectionTitle) => {
        if (readonly || runtimeLocked) return true;
        if (clauseTable(tIndex)) {
            const head = String(table?.[0]?.[cIndex] || "");
            if (cIndex === 0 || head.includes("判定标准") || head.includes("检验方法")) return true;
        }
        if (kind === "inspect_spec" && title === "成品检验规程") {
            const label = String(row?.[0] || "").trim();
            if ((label === "编制人" || label === "审核人" || label === "批准人") && (cIndex === 1 || cIndex === 3)) return true;
            if (label === "生效日期" && cIndex === 1) return true;
        }
        if (kind === "inspect_spec" && title === "文件修订记录" && rIndex > 0 && (cIndex === 0 || cIndex === 3 || cIndex === 4)) return true;
        if (kind !== "inspect_spec" && kind !== "inspect_record") return false;
        return cIndex > 0 && autoLabel.has(String(row?.[0] || "").trim());
    };
    const reviewPage = kind === "output_review";
    const formPage = Boolean(FORM_TITLES[kind]) && !reviewPage;
    const doc = data.doc;
    if (!doc) {
        return <div className="div-v page pdp-detail"><Spin spinning={data.loading} /></div>;
    }

    return (
        <div className="div-v page pdp-detail">
            <div className="div-h pdp-toolbar">
                {(!(formPage || reviewPage) || !readonly) && <div className="pdp-toolbar-title">
                    选择产品
                    <span className="pdp-meta" style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 12 }}>
                        <span style={{ width: 340, display: "inline-block" }}>
                            <ProductVersionSelect
                                products={data.products}
                                value={doc.product_id}
                                disabled={readonly}
                                allowClear={false}
                                namePlaceholder={ts("product.name")}
                                versionPlaceholder={ts("product.full_version")}
                                onChange={(value) => value && rebindProduct(value)}
                            />
                        </span>
                        <span style={{ whiteSpace: "nowrap" }}>文档版本：</span>
                        <Input
                            size="small"
                            style={{ width: 110 }}
                            disabled={readonly}
                            value={doc.version || ""}
                            onChange={(e) => dispatch({ doc: { ...doc, version: e.target.value } })}
                        />
                    </span>
                </div>}
                <Space>
                    {!readonly && (
                        <Button type="primary" loading={data.saving} onClick={save}>{ts("save")}</Button>
                    )}
                    <Button loading={data.exporting} onClick={doExport}>导出</Button>
                    <Button onClick={() => navigate(`/qa_docs/${kind}`)}>{ts("back")}</Button>
                </Space>
            </div>
            <Spin spinning={data.loading} wrapperClassName="pdp-scroll">
                {reviewPage ? (
                    <div style={{ height: "100%", overflow: "auto" }}>
                        <div style={{ padding: "12px 24px", maxWidth: 1100, margin: "0 auto" }}>
                            <div style={{ textAlign: "center", fontSize: 18, fontWeight: 700, margin: "6px 0 14px" }}>
                                {FORM_TITLES[kind]}
                            </div>
                            <ReviewRecordTables
                                tables={(sections[0] && sections[0].tables) || []}
                                readonly={readonly}
                                onChange={(tables) => patchSection(0, { tables })}
                                renderCell={(tableIndex, rowIndex, colIndex, value) => {
                                    if (tableIndex !== 0 || colIndex !== 2 || rowIndex === 0) return null;
                                    if (!String(value).includes("通过") || !String(value).includes("存在问题")) return null;
                                    const choice = reviewChoice(value);
                                    const pick = (next: string) => {
                                        const tables = clone((sections[0] && sections[0].tables) || []);
                                        if (!tables[tableIndex] || !tables[tableIndex][rowIndex]) return;
                                        tables[tableIndex][rowIndex][colIndex] = next;
                                        patchSection(0, { tables });
                                    };
                                    return (
                                        <Space size={16}>
                                            <Checkbox disabled={readonly} checked={choice === "pass"} onChange={(e) => e.target.checked && pick(PASS_CHECK)}>通过</Checkbox>
                                            <Checkbox disabled={readonly} checked={choice === "issue"} onChange={(e) => e.target.checked && pick(ISSUE_CHECK)}>存在问题</Checkbox>
                                        </Space>
                                    );
                                }}
                            />
                        </div>
                    </div>
                ) : formPage ? (
                    <div style={{ height: "100%", overflow: "auto" }}>
                        <div style={{ padding: "12px 24px", maxWidth: 1200, margin: "0 auto" }}>
                            <div style={{ textAlign: "center", fontSize: 18, fontWeight: 700, margin: "6px 0 14px" }}>
                                {FORM_TITLES[kind]}
                            </div>
                            {sections.map((section: any, sIndex: number) => (
                                <div key={sIndex} style={{ marginBottom: 18 }}>
                                    {sections.length > 1 && (
                                        <div style={{ fontWeight: 600, margin: "10px 0 6px" }}>{section.title || "(未命名)"}</div>
                                    )}
                                    {String(section.body || "").trim() !== "" && (
                                        <Input.TextArea
                                            autoSize={{ minRows: 2, maxRows: 12 }}
                                            style={{ marginBottom: 8 }}
                                            value={section.body || ""}
                                            disabled={readonly}
                                            onChange={(e) => patchSection(sIndex, { body: e.target.value })}
                                        />
                                    )}
                                    {(section.tables || []).map((table: string[][], tIndex: number) => {
                                        const layout = wordLayout(table);
                                        const writeChecks = (rIndex: number, cIndex: number, items: { on: boolean; label: string }[], source: string) => {
                                            const joiner = String(source).includes("\n") ? "\n" : "　";
                                            const next = items.map((item) => `${item.on ? "☑" : "□"}${item.label ? " " + item.label : ""}`).join(joiner);
                                            setCell(tIndex, rIndex, cIndex, next, sIndex);
                                        };
                                        const inspectCols = kind === "inspect_record" && layout.cols === 4;
                                        return (
                                        <div key={tIndex} style={{ marginTop: tIndex === 0 ? 0 : -1 }}>
                                            <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: inspectCols ? "fixed" : "auto" }}>
                                                {inspectCols && (
                                                    <colgroup>
                                                        <col style={{ width: "14%" }} />
                                                        <col style={{ width: "48%" }} />
                                                        <col style={{ width: "18%" }} />
                                                        <col style={{ width: "20%" }} />
                                                    </colgroup>
                                                )}
                                                <tbody>
                                                    {layout.rows.map((row, rIndex) => (
                                                        <tr key={rIndex}>
                                                            {row.map((cell, cIndex) => {
                                                                if (layout.skip[rIndex][cIndex] || cell === "<" || cell === "^") return null;
                                                                const items = checkItems(cell);
                                                                const role = cellRole(row, cIndex, layout.rowspan[rIndex][cIndex]);
                                                                const autoLocked = readonly
                                                                    || (row[0] === "ECR号" && cIndex === 1)
                                                                    || (row[0] === "产品名称" && cIndex === 1)
                                                                    || (row[0] === "完整版本号" && cIndex === 1)
                                                                    || (row[0] === "生产日期" && cIndex === 1)
                                                                    || String(row[0] || "").startsWith("检验依据")
                                                                    || (row[0] === "软件技术要求" && cIndex === 1)
                                                                    || (row[0] === "版本号识别" && cIndex === 1)
                                                                    || (row[0] === "备注" && cIndex === 1)
                                                                    || (String(row[0] || "").startsWith("检验人员") && cIndex === 1);
                                                                const plain = role === "head" || (role === "label" && (INFO_LABELS.has(cell.trim()) || autoLocked));
                                                                return (
                                                                    <td key={cIndex} colSpan={layout.colspan[rIndex][cIndex]} rowSpan={layout.rowspan[rIndex][cIndex]} style={role === "head" ? accHead : role === "label" ? accLabel : accBase}>
                                                                        {items ? (
                                                                            <Space size={12} wrap>
                                                                                {items.map((item, index) => (
                                                                                    <Checkbox
                                                                                        key={index}
                                                                                        disabled={autoLocked}
                                                                                        checked={item.on}
                                                                                        onChange={(e) => {
                                                                                            const next = items.map((current, currentIndex) => {
                                                                                                if (currentIndex === index) return { ...current, on: e.target.checked };
                                                                                                if (e.target.checked && checksExclusive(items)) return { ...current, on: false };
                                                                                                return current;
                                                                                            });
                                                                                            writeChecks(rIndex, cIndex, next, cell);
                                                                                        }}
                                                                                    >{item.label}</Checkbox>
                                                                                ))}
                                                                            </Space>
                                                                        ) : plain ? (
                                                                            cell
                                                                        ) : (
                                                                            <Input.TextArea
                                                                                variant="borderless"
                                                                                autoSize={{ minRows: 1, maxRows: 8 }}
                                                                                style={{ padding: 0, textAlign: "left", color: "#333" }}
                                                                                value={cell}
                                                                                disabled={autoLocked}
                                                                                onChange={(e) => setCell(tIndex, rIndex, cIndex, e.target.value, sIndex)}
                                                                            />
                                                                        )}
                                                                    </td>
                                                                );
                                                            })}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                <div className="pdp-layout">
                    <div className="pdp-nav">
                        <div className="pdp-nav-head">目录</div>
                        {sections.map((section: any, index: number) => (
                            <div key={index}>
                                <div
                                    className={`pdp-nav-item${index === activeIndex ? " active" : ""}`}
                                    style={{ paddingLeft: 8 }}
                                    onClick={() => dispatch({ activeIndex: index })}>
                                    <span className="pdp-nav-title" title={section.title || ""}>{section.title || "(未命名)"}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="pdp-editor">
                        {!active ? (
                            <div className="pdp-empty">请选择左侧章节</div>
                        ) : (
                            <>
                                <div className="pdp-field">
                                    <div className="pdp-label">章节标题</div>
                                    <Input
                                        value={active.title || ""}
                                        disabled={readonly}
                                        onChange={(e) => patchSection(activeIndex, { title: e.target.value })}
                                    />
                                </div>
                                <div className="pdp-field">
                                    <div className="pdp-label">正文</div>
                                    <Input.TextArea
                                        autoSize={{ minRows: 3, maxRows: 20 }}
                                        value={active.body || ""}
                                        disabled={readonly}
                                        placeholder="本段正文内容，可多行"
                                        onChange={(e) => patchSection(activeIndex, { body: e.target.value })}
                                    />
                                </div>
                                {(active.tables || []).map((table: string[][], tIndex: number) => (
                                    <div className="pdp-table-block" key={tIndex}>
                                        <div className="pdp-table-bar">
                                            <span className="pdp-label">表格 {tIndex + 1}</span>
                                        </div>
                                        <table className="pdp-grid">
                                            <tbody>
                                                {(Array.isArray(table) ? table : []).map((row, rIndex) => (
                                                    <tr key={rIndex}>
                                                        {(Array.isArray(row) ? row : []).map((cell, cIndex) => {
                                                            const head = String(table[0]?.[cIndex] || "");
                                                            const mergeCol = clauseTable(tIndex) && rIndex > 0 && (head.includes("判定标准") || head.includes("检验方法"));
                                                            const value = String(cell ?? "");
                                                            if (mergeCol && rIndex > 1 && value !== "" && value === String(table[rIndex - 1]?.[cIndex] ?? "")) {
                                                                return null;
                                                            }
                                                            let span = 1;
                                                            if (mergeCol && value) {
                                                                for (let next = rIndex + 1; next < table.length; next += 1) {
                                                                    if (String(table[next]?.[cIndex] ?? "") !== value) break;
                                                                    span += 1;
                                                                }
                                                            }
                                                            return (
                                                            <td key={cIndex} className={rIndex === 0 ? "head" : ""} rowSpan={span > 1 ? span : undefined}>
                                                                <Input.TextArea
                                                                    className="pdp-cell"
                                                                    autoSize={{ minRows: 1, maxRows: 8 }}
                                                                    value={cell ?? ""}
                                                                    disabled={cellLocked(row, cIndex, table, tIndex, rIndex)}
                                                                    onChange={(e) => setCell(tIndex, rIndex, cIndex, e.target.value)}
                                                                />
                                                            </td>
                                                            );
                                                        })}
                                                        {!readonly && !runtimeLocked && !clauseTable(tIndex) && (
                                                            <td className="pdp-row-op">
                                                                <PlusOutlined title="在下方插入行" onClick={() => insertRowAfter(tIndex, rIndex)} />
                                                                {table.length > 1 && (
                                                                    <Button type="link" danger size="small" onClick={() => delRow(tIndex, rIndex)}>删除</Button>
                                                                )}
                                                            </td>
                                                        )}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </div>
                )}
            </Spin>
        </div>
    );
};
