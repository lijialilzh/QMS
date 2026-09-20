import { Button, message, Space, Input, Spin } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProdRuntimeEnv";
import * as ApiProduct from "@/api/ApiProduct";
import SelectProductEmpty from "@/views/SelectProductEmpty";
import "./ProdRuntimeEnv.less";

const FIELDS = [
    "arch",
    "srv_cpu", "srv_memory", "srv_gpu", "srv_disk", "srv_nic",
    "srv_os", "srv_cuda",
    "cli_cpu", "cli_memory", "cli_resolution", "cli_os", "cli_browser",
    "net_lan", "net_wan",
];

const cloneTables = (tables: any[]) => JSON.parse(JSON.stringify(tables || []));

export default () => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        products: [],
        prodId: null,
        form: {} as any,
        snapshot: {} as any,
        loading: false,
        saving: false,
    });

    const loadProducts = () => {
        ApiProduct.list_product({ page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === ApiProduct.C_OK) dispatch({ products: res.data.rows || [] });
        });
    };

    const loadEnv = (prodId: any) => {
        if (!prodId) {
            dispatch({ form: {}, snapshot: {} });
            return;
        }
        dispatch({ loading: true });
        Api.get_prod_runtime_env({ prod_id: prodId }).then((res: any) => {
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
        if (!data.prodId) return;
        dispatch({ saving: true, form: next });
        const payload: any = { prod_id: data.prodId, tables: next.tables || [] };
        FIELDS.forEach((k) => (payload[k] = next[k] ?? ""));
        Api.save_prod_runtime_env(payload).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                dispatch({ snapshot: { ...next } });
                message.success(ts("msg_ok"));
            } else {
                message.error(res.msg);
            }
        });
    };

    const saveField = (field: string) => {
        if (!data.prodId) return;
        if ((data.form[field] ?? "") === (data.snapshot[field] ?? "")) return;
        saveForm(data.form);
    };

    const saveIfTablesChanged = (tables: any[]) => {
        if (!data.prodId) return;
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
        tables[ti].cells[r][ci] = val;
        dispatch({ form: { ...data.form, tables } });
    };

    const insertRowAfter = (ti: number, r: number) => {
        const tables = cloneTables(data.form.tables || []);
        const cells = tables[ti]?.cells || [];
        const cols = cells[0] ? cells[0].length : 1;
        const next = [...cells];
        next.splice(r + 1, 0, new Array(cols).fill(""));
        tables[ti].cells = next;
        setTables(tables, true);
    };

    const delRow = (ti: number, r: number) => {
        const tables = cloneTables(data.form.tables || []);
        const cells = tables[ti]?.cells || [];
        if (cells.length <= 1) return;
        tables[ti].cells = cells.filter((_: any, i: number) => i !== r);
        setTables(tables, true);
    };

    useEffect(() => {
        loadProducts();
    }, []);

    const tables: any[] = data.form.tables || [];

    return (
        <div className="page div-v prod-runtime-env">
            <div className="div-h searchbar list-searchbar-align">
                <Space>
                    <span>{ts("srs_doc.select_product")}：</span>
                    <div style={{ minWidth: 360 }}>
                        <ProductVersionSelect
                            products={data.products}
                            allowClear
                            value={data.prodId}
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.version")}
                            onChange={(v: any) => {
                                dispatch({ prodId: v ?? null });
                                loadEnv(v ?? null);
                            }}
                        />
                    </div>
                </Space>
                {data.saving ? <span className="env-saving">保存中…</span> : null}
            </div>

            {data.prodId ? (
            <Spin spinning={data.loading} wrapperClassName="env-scroll">
                <div className="env-body">
                    <h2 className="env-title">运行环境</h2>
                    <div className="env-arch">
                        <Input.TextArea
                            className="env-input env-arch-input"
                            autoSize={{ minRows: 1, maxRows: 4 }}
                            value={data.form.arch ?? ""}
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
                                        onChange={(e) => setTitle(ti, e.target.value)}
                                        onBlur={() => saveIfTablesChanged(data.form.tables || [])}
                                    />
                                </div>
                                <table className="env-table">
                                    <tbody>
                                        {cells.map((row: any[], r: number) => (
                                            <tr key={r}>
                                                {row.map((cell: any, ci: number) => (
                                                    <td key={ci} className={r === 0 ? "lbl" : ""}>
                                                        <Input.TextArea
                                                            className="env-input"
                                                            autoSize={{ minRows: 1, maxRows: 8 }}
                                                            value={cell ?? ""}
                                                            onChange={(e) => setCell(ti, r, ci, e.target.value)}
                                                            onBlur={() => saveIfTablesChanged(data.form.tables || [])}
                                                        />
                                                    </td>
                                                ))}
                                                <td className={r === 0 ? "lbl env-row-op" : "env-row-op"}>
                                                    {r === 0 ? (
                                                        "操作"
                                                    ) : (
                                                        <>
                                                            <PlusOutlined title="在下方插入行" onClick={() => insertRowAfter(ti, r)} />
                                                            {cells.length > 1 ? (
                                                                <Button type="link" danger size="small" onClick={() => delRow(ti, r)}>
                                                                    删除
                                                                </Button>
                                                            ) : null}
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })}
                </div>
            </Spin>
            ) : (
                <SelectProductEmpty />
            )}
        </div>
    );
};
