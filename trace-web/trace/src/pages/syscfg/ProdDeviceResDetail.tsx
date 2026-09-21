import { Button, message, Input, Spin } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiProdDeviceRes";
import * as ApiMember from "@/api/ApiProjectMember";
import "./ProdRuntimeEnv.less";
import "../risk_mgmt/RiskMgmtParticipants.less";

const NAME_QTY_USES = new Set(["操作系统", "开发语言", "数据库", "开发工具", "测试工具", "配置管理工具"]);
const STAFF_QTY_USES: Record<string, string[]> = {
    "开发设备": ["开发"],
    "测试设备": ["测试"],
    "生产设备": ["生产"],
    "检验设备": ["检验", "QA"],
};
const countNames = (name: any) =>
    String(name ?? "").split(/[,，、]+/).map((s) => s.trim()).filter(Boolean).length;
const countStaff = (members: any[], kws: string[]) =>
    (members || []).filter((m: any) => {
        if (!String(m.name || "").trim()) return false;
        const role = String(m.role || "");
        return kws.some((kw) => role.toLowerCase().includes(kw.toLowerCase()));
    }).length;
const withAutoQty = (items: any[], members: any[]) =>
    (items || []).map((it: any) => {
        const use = String(it?.use || "").trim();
        let qty = it.qty;
        if (NAME_QTY_USES.has(use)) {
            const n = countNames(it.name);
            qty = n ? String(n) : "";
        } else if (STAFF_QTY_USES[use]) {
            qty = String(countStaff(members, STAFF_QTY_USES[use]));
        }
        return String(it.qty ?? "") === String(qty) ? it : { ...it, qty };
    });

export default ({ prodId, onChanged }: { prodId: number; onChanged?: () => void }) => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        items: [] as any[],
        snapshot: "" as string,
        members: [] as any[],
        loading: false,
        saving: false,
    });

    const loadData = (id: any) => {
        if (!id) return;
        dispatch({ loading: true });
        Promise.all([
            Api.get_prod_device_res({ prod_id: id }),
            ApiMember.list_project_member({ prod_id: id, page_index: 0, page_size: 1000 }).catch(() => null),
        ]).then(([res, mb]: any[]) => {
            if (res.code === Api.C_OK) {
                const raw = (res.data && res.data.items) || [];
                const members = mb && mb.code === Api.C_OK ? ((mb.data && mb.data.rows) || []) : [];
                const items = withAutoQty(raw, members);
                const snapshot = JSON.stringify(raw);
                dispatch({ loading: false, items, snapshot, members });
                if (JSON.stringify(items) !== snapshot) {
                    Api.save_prod_device_res({ prod_id: id, items }).then((sv: any) => {
                        if (sv.code === Api.C_OK) {
                            dispatch({ snapshot: JSON.stringify(items) });
                            onChanged?.();
                        }
                    });
                }
            } else {
                dispatch({ loading: false, items: [], snapshot: "" });
                message.error(res.msg);
            }
        });
    };

    const onChange = (idx: number, field: string, value: string) => {
        const items = data.items.map((it: any, i: number) => {
            if (i !== idx) return it;
            const next = { ...it, [field]: value };
            const use = String((field === "use" ? value : it.use) || "").trim();
            if (NAME_QTY_USES.has(use) && (field === "name" || field === "use")) {
                const n = countNames(field === "name" ? value : it.name);
                next.qty = n ? String(n) : "";
            } else if (STAFF_QTY_USES[use] && field === "use") {
                next.qty = String(countStaff(data.members, STAFF_QTY_USES[use]));
            }
            return next;
        });
        dispatch({ items });
    };

    const persistItems = (items: any[]) => {
        if (!prodId) {
            dispatch({ items });
            return;
        }
        dispatch({ saving: true, items });
        Api.save_prod_device_res({ prod_id: prodId, items }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                dispatch({ snapshot: JSON.stringify(items) });
                message.success(ts("msg_ok"));
                onChanged?.();
            } else {
                message.error(res.msg);
            }
        });
    };

    const saveAll = () => {
        if (!prodId) return;
        const cur = JSON.stringify(data.items);
        if (cur === data.snapshot) return;
        persistItems(data.items);
    };

    const insertRowAfter = (idx: number) => {
        const items = [...data.items];
        items.splice(idx + 1, 0, { use: "", name: "", qty: "" });
        persistItems(items);
    };

    const delRow = (idx: number) => {
        if (data.items.length <= 1) return;
        persistItems(data.items.filter((_: any, i: number) => i !== idx));
    };

    useEffect(() => {
        if (prodId) loadData(prodId);
    }, [prodId]);

    const cell = (idx: number, field: string, single?: boolean) => {
        const use = String(data.items[idx]?.use || "").trim();
        const autoQty = field === "qty" && (NAME_QTY_USES.has(use) || !!STAFF_QTY_USES[use]);
        return (
        <Input.TextArea
            className="env-input"
            autoSize={{ minRows: 1, maxRows: 6 }}
            value={data.items[idx]?.[field] ?? ""}
            disabled={!prodId || autoQty}
            style={single ? { textAlign: "center" } : undefined}
            onChange={(e) => onChange(idx, field, e.target.value)}
            onBlur={saveAll}
        />
        );
    };

    return (
        <div className="risk-part-nested prod-runtime-env">
            {data.saving ? <span className="env-saving">保存中…</span> : null}
            <Spin spinning={data.loading} wrapperClassName="env-scroll">
                <div className="env-body">
                    <h2 className="env-title">设备资源</h2>
                    <table className="env-table env-table-device">
                        <colgroup>
                            <col style={{ width: 160 }} />
                            <col />
                            <col style={{ width: 88 }} />
                            <col style={{ width: 116 }} />
                        </colgroup>
                        <thead>
                            <tr>
                                <th>设备及用途</th>
                                <th>设备名称</th>
                                <th>数量</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.items.map((it: any, idx: number) => (
                                <tr key={idx}>
                                    <td className="lbl">{cell(idx, "use")}</td>
                                    <td>{cell(idx, "name")}</td>
                                    <td>{cell(idx, "qty", true)}</td>
                                    <td className="env-row-op">
                                        <PlusOutlined title="在下方插入行" onClick={() => insertRowAfter(idx)} />
                                        {data.items.length > 1 ? (
                                            <Button type="link" danger size="small" onClick={() => delRow(idx)}>
                                                删除
                                            </Button>
                                        ) : null}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Spin>
        </div>
    );
};
