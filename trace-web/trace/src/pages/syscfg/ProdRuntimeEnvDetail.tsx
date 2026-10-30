import { Button, message, Input, Spin } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiProdRuntimeEnv";
import "./ProdRuntimeEnv.less";
import "../risk_mgmt/RiskMgmtParticipants.less";

const FIELDS = [
    "arch",
    "srv_cpu", "srv_memory", "srv_gpu", "srv_disk", "srv_nic",
    "srv_os", "srv_cuda",
    "cli_cpu", "cli_memory", "cli_resolution", "cli_os", "cli_browser",
    "net_lan", "net_wan",
];

const cloneTables = (tables: any[]) => JSON.parse(JSON.stringify(tables || []));

const cellText = (value: any) => String(value ?? "").trim();

/** 数据行里，与上一行相同的非空单元格纵向合并。表头、空单元格不并。 */
const cellMerge = (cells: any[][], r: number, ci: number) => {
    if (r <= 0) return { skip: false, span: 1 };
    const text = cellText(cells[r]?.[ci]);
    if (!text) return { skip: false, span: 1 };
    if (r > 1 && cellText(cells[r - 1]?.[ci]) === text) return { skip: true, span: 1 };
    let span = 1;
    for (let i = r + 1; i < cells.length; i++) {
        if (cellText(cells[i]?.[ci]) !== text) break;
        span += 1;
    }
    return { skip: false, span };
};

export default ({ prodId, readOnly, onChanged }: { prodId: number; readOnly?: boolean; onChanged?: () => void }) => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        form: {} as any,
        snapshot: {} as any,
        loading: false,
        saving: false,
    });

    const loadEnv = (id: any) => {
        if (!id) return;
        dispatch({ loading: true });
        Api.get_prod_runtime_env({ prod_id: id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const f = res.data || {};
                dispatch({ loading: false, form: { ...f }, snapshot: { ...f } });
            } else {
                dispatch({ loading: false, form: {}, snapshot: {} });
                message.error(res.msg);
            }
        });
    };

    const onChange = (field: string, value: string) => {
        dispatch({ form: { ...data.form, [field]: value } });
    };

    const saveForm = (next: any) => {
        if (readOnly || !prodId) return;
        dispatch({ saving: true, form: next });
        const payload: any = { prod_id: prodId, tables: next.tables || [] };
        FIELDS.forEach((k) => (payload[k] = next[k] ?? ""));
        Api.save_prod_runtime_env(payload).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                dispatch({ snapshot: { ...next } });
                message.success(ts("msg_ok"));
                onChanged?.();
            } else {
                message.error(res.msg);
            }
        });
    };

    const saveField = (field: string) => {
        if (!prodId) return;
        if ((data.form[field] ?? "") === (data.snapshot[field] ?? "")) return;
        saveForm(data.form);
    };

    const saveIfTablesChanged = (tables: any[]) => {
        if (!prodId) return;
        const next = { ...data.form, tables };
        if (JSON.stringify(tables) === JSON.stringify(data.snapshot.tables || [])) return;
        saveForm(next);
    };

    const setTables = (tables: any[], persist: boolean) => {
        const next = { ...data.form, tables };
        dispatch({ form: next });
        if (persist) saveIfTablesChanged(tables);
    };

    const setTitle = (ti: number, title: string) => {
        const tables = cloneTables(data.form.tables || []);
        if (!tables[ti]) return;
        tables[ti].title = title;
        dispatch({ form: { ...data.form, tables } });
    };

    const setCell = (ti: number, r: number, ci: number, val: string) => {
        const tables = cloneTables(data.form.tables || []);
        if (!tables[ti] || !tables[ti].cells || !tables[ti].cells[r]) return;
        const cells = tables[ti].cells;
        const old = cellText(cells[r][ci]);
        let start = r;
        let end = r;
        if (r > 0 && old) {
            while (start > 1 && cellText(cells[start - 1]?.[ci]) === old) start -= 1;
            while (end + 1 < cells.length && cellText(cells[end + 1]?.[ci]) === old) end += 1;
        }
        for (let i = start; i <= end; i++) cells[i][ci] = val;
        dispatch({ form: { ...data.form, tables } });
    };

    const insertRowAfter = (ti: number, r: number) => {
        if (readOnly) return;
        const tables = cloneTables(data.form.tables || []);
        const cells = tables[ti]?.cells || [];
        const cols = cells[0] ? cells[0].length : 1;
        const next = [...cells];
        next.splice(r + 1, 0, new Array(cols).fill(""));
        tables[ti].cells = next;
        setTables(tables, true);
    };

    const insertColAfter = (ti: number, ci: number) => {
        if (readOnly) return;
        const tables = cloneTables(data.form.tables || []);
        const cells = tables[ti]?.cells || [];
        tables[ti].cells = cells.map((row: any[]) => {
            const next = Array.isArray(row) ? [...row] : [];
            next.splice(ci + 1, 0, "");
            return next;
        });
        setTables(tables, true);
    };

    const delCol = (ti: number, ci: number) => {
        if (readOnly) return;
        const tables = cloneTables(data.form.tables || []);
        const cells = tables[ti]?.cells || [];
        const width = Array.isArray(cells[0]) ? cells[0].length : 0;
        if (width <= 1) return;
        tables[ti].cells = cells.map((row: any[]) => (Array.isArray(row) ? row.filter((_: any, i: number) => i !== ci) : row));
        setTables(tables, true);
    };

    const delRow = (ti: number, r: number) => {
        if (readOnly) return;
        const tables = cloneTables(data.form.tables || []);
        const cells = tables[ti]?.cells || [];
        if (cells.length <= 1) return;
        tables[ti].cells = cells.filter((_: any, i: number) => i !== r);
        setTables(tables, true);
    };

    useEffect(() => {
        if (prodId) loadEnv(prodId);
    }, [prodId]);

    const tables: any[] = data.form.tables || [];

    return (
        <div className="risk-part-nested prod-runtime-env">
            {data.saving ? <span className="env-saving">保存中…</span> : null}
            <Spin spinning={data.loading} wrapperClassName="env-scroll">
                <div className="env-body">
                    <h2 className="env-title">运行环境</h2>
                    <div className="env-arch">
                        <Input.TextArea
                            className="env-input env-arch-input"
                            autoSize={{ minRows: 1, maxRows: 4 }}
                            value={data.form.arch ?? ""}
                            readOnly={!!readOnly}
                            onChange={(e) => onChange("arch", e.target.value)}
                            onBlur={() => saveField("arch")}
                            placeholder="例如：软件为B/S架构"
                        />
                    </div>

                    {tables.map((tb: any, ti: number) => {
                        const cells: any[][] = tb.cells || [];
                        return (
                            <div className="env-table-block" key={tb.key || ti}>
                                <div className="env-table-bar">
                                    <Input
                                        className="env-cap-input"
                                        value={tb.title || ""}
                                        readOnly={!!readOnly}
                                        onChange={(e) => setTitle(ti, e.target.value)}
                                        onBlur={() => saveIfTablesChanged(data.form.tables || [])}
                                    />
                                </div>
                                <table className="env-table">
                                    <tbody>
                                        {cells.map((row: any[], r: number) => (
                                            <tr key={r}>
                                                {row.map((cell: any, ci: number) => {
                                                    const merged = cellMerge(cells, r, ci);
                                                    if (merged.skip) return null;
                                                    return (
                                                    <td key={ci} rowSpan={merged.span > 1 ? merged.span : undefined} className={r === 0 ? "lbl" : (merged.span > 1 ? "env-merged" : "")}>
                                                        {r === 0 && !readOnly ? (
                                                            <div className="env-head-cell">
                                                                <Input.TextArea
                                                                    className="env-input"
                                                                    autoSize={{ minRows: 1, maxRows: 8 }}
                                                                    value={cell ?? ""}
                                                                    onChange={(e) => setCell(ti, r, ci, e.target.value)}
                                                                    onBlur={() => saveIfTablesChanged(data.form.tables || [])}
                                                                />
                                                                <span className="risk-part-row-actions">
                                                                    <Button
                                                                        type="text"
                                                                        size="small"
                                                                        className="risk-part-action-btn"
                                                                        icon={<PlusOutlined />}
                                                                        title="在右侧插入列"
                                                                        onClick={() => insertColAfter(ti, ci)}
                                                                    />
                                                                    {row.length > 1 ? (
                                                                        <Button
                                                                            type="text"
                                                                            size="small"
                                                                            danger
                                                                            className="risk-part-action-btn"
                                                                            icon={<DeleteOutlined />}
                                                                            title="删除此列"
                                                                            onClick={() => delCol(ti, ci)}
                                                                        />
                                                                    ) : null}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                        <div className={merged.span > 1 ? "env-merged-box" : undefined}>
                                                        <Input.TextArea
                                                            className="env-input"
                                                            autoSize={{ minRows: 1, maxRows: 8 }}
                                                            value={cell ?? ""}
                                                            readOnly={!!readOnly}
                                                            onChange={(e) => setCell(ti, r, ci, e.target.value)}
                                                            onBlur={() => saveIfTablesChanged(data.form.tables || [])}
                                                        />
                                                        </div>
                                                        )}
                                                    </td>
                                                    );
                                                })}
                                                {readOnly ? null : (
                                                <td className={r === 0 ? "lbl env-row-op" : "env-row-op"}>
                                                    {r === 0 ? (
                                                        <span className="risk-part-row-actions env-row-op-head">
                                                            <span>操作</span>
                                                            <Button
                                                                type="text"
                                                                size="small"
                                                                className="risk-part-action-btn"
                                                                icon={<PlusOutlined />}
                                                                title="在下方插入行"
                                                                onClick={() => insertRowAfter(ti, r)}
                                                            />
                                                        </span>
                                                    ) : (
                                                        <span className="risk-part-row-actions">
                                                            <Button
                                                                type="text"
                                                                size="small"
                                                                className="risk-part-action-btn"
                                                                icon={<PlusOutlined />}
                                                                title="在下方插入行"
                                                                onClick={() => insertRowAfter(ti, r)}
                                                            />
                                                            {cells.length > 1 ? (
                                                                <Button
                                                                    type="text"
                                                                    size="small"
                                                                    danger
                                                                    className="risk-part-action-btn"
                                                                    icon={<DeleteOutlined />}
                                                                    title="删除"
                                                                    onClick={() => delRow(ti, r)}
                                                                />
                                                            ) : null}
                                                        </span>
                                                    )}
                                                </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })}
                </div>
            </Spin>
        </div>
    );
};
