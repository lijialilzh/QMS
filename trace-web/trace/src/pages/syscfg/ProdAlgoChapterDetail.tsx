import { Button, Table, message, Space, Input, Modal, Tooltip } from "antd";
import { ArrowUpOutlined, ArrowDownOutlined, PlusOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiProdAlgoChapter";
import "../risk_mgmt/RiskMgmtParticipants.less";

const DEFAULT_MODULES = ["肺栓塞分诊", "肺叶分割"];

export default ({ prodId, onChanged }: { prodId: number; onChanged?: () => void }) => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        rows: [],
        loading: false,
        targetEdit: {},
        editingField: null,
        updating: false,
    });

    const loadModules = (id: any, allowSeed = true) => {
        dispatch({ loading: true });
        Api.list_prod_algo_chapter({ prod_id: id || undefined, page_index: 0, page_size: 10000 }).then((res: any) => {
            if (res.code !== Api.C_OK) {
                dispatch({ loading: false, rows: [] });
                message.error(res.msg);
                return;
            }
            const rows = res.data.rows || [];
            if (id && allowSeed && !rows.length && DEFAULT_MODULES.length) {
                const jobs = DEFAULT_MODULES.map((name, i) =>
                    Api.add_prod_algo_chapter({ prod_id: id, name, sort_order: i + 1 })
                );
                Promise.all(jobs).then(() => {
                    loadModules(id, false);
                    onChanged?.();
                }).catch(() => {
                    dispatch({ loading: false, rows });
                });
                return;
            }
            dispatch({ loading: false, rows });
        });
    };

    const doAdd = (afterRow?: any) => {
        if (!prodId) {
            message.warning("请先选择产品");
            return;
        }
        const rows = data.rows || [];
        const idx = afterRow ? rows.findIndex((r: any) => r.id === afterRow.id) : rows.length - 1;
        const insertAt = idx + 1;
        const shiftJobs = rows.map((r: any, i: number) => {
            const desired = i < insertAt ? i + 1 : i + 2;
            return Api.update_prod_algo_chapter({ id: r.id, prod_id: r.prod_id, name: r.name, sort_order: desired });
        });
        Promise.all(shiftJobs).then(() => {
            Api.add_prod_algo_chapter({
                prod_id: prodId,
                name: "",
                sort_order: insertAt + 1,
            }).then((res: any) => {
                if (res.code === Api.C_OK) {
                    message.success(res.msg || "新增成功");
                    loadModules(prodId, false);
                    onChanged?.();
                } else {
                    message.error(res.msg);
                }
            });
        }).catch(() => {
            message.error("新增失败");
        });
    };

    const doDelete = (row: any) => {
        Modal.confirm({
            title: ts("action"),
            content: ts("confirm_delete"),
            onOk: () => {
                Api.delete_prod_algo_chapters({ id: row.id }).then((res: any) => {
                    if (res.code === Api.C_OK) {
                        message.success(res.msg);
                        loadModules(prodId, false);
                        onChanged?.();
                    } else {
                        message.error(res.msg);
                    }
                });
            },
        });
    };

    const startEdit = (row: any, field: string) => {
        if (data.targetEdit.id === row.id && data.editingField === field) return;
        dispatch({ targetEdit: { ...row }, editingField: field });
    };

    const moveRow = (row: any, dir: "up" | "down") => {
        const rows = data.rows || [];
        const idx = rows.findIndex((r: any) => r.id === row.id);
        if (idx < 0) return;
        const swapIdx = dir === "up" ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= rows.length) return;
        const cur = rows[idx];
        const target = rows[swapIdx];
        const curSort = cur.sort_order || idx + 1;
        const targetSort = target.sort_order || swapIdx + 1;
        dispatch({ updating: true });
        Promise.all([
            Api.update_prod_algo_chapter({ id: cur.id, prod_id: cur.prod_id, name: cur.name, sort_order: targetSort }),
            Api.update_prod_algo_chapter({ id: target.id, prod_id: target.prod_id, name: target.name, sort_order: curSort }),
        ]).then((results: any[]) => {
            if (results.every((r: any) => r.code === Api.C_OK)) {
                dispatch({ updating: false });
                message.success(ts("save_success"));
                loadModules(prodId, false);
            } else {
                dispatch({ updating: false });
                message.error("移动失败");
            }
        }).catch(() => {
            dispatch({ updating: false });
            message.error("移动失败");
        });
    };

    const saveCell = () => {
        const edit = { ...data.targetEdit };
        if (!edit?.id || data.updating) return;
        dispatch({ updating: true });
        Api.update_prod_algo_chapter({ ...edit }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const rows = (data.rows || []).map((r: any) => (r.id === edit.id ? { ...r, ...edit } : r));
                dispatch({ updating: false, targetEdit: {}, editingField: null, rows });
                message.success(res.msg || ts("msg_ok"));
            } else {
                dispatch({ updating: false });
                message.error(res.msg);
            }
        });
    };

    const isEditing = (row: any, field: string) => data.targetEdit.id === row.id && data.editingField === field;

    const clickToEdit = (row: any, field: string, value: any) => (
        <div style={{ cursor: "pointer", minHeight: 22 }} title="点击编辑" onClick={() => startEdit(row, field)}>
            {value !== null && value !== undefined && String(value) !== "" ? value : <span style={{ color: "#d9d9d9" }}>—</span>}
        </div>
    );

    const columns = [
        {
            title: "序号",
            dataIndex: "sort_order",
            width: 80,
            render: (_value: any, _row: any, index: number) => index + 1,
        },
        {
            title: "模块",
            dataIndex: "name",
            render: (value: any, row: any) => {
                if (!isEditing(row, "name")) return clickToEdit(row, "name", value);
                return (
                    <Input
                        autoFocus
                        value={data.targetEdit.name}
                        onChange={(e: any) => dispatch({ targetEdit: { ...data.targetEdit, name: e.target.value } })}
                        onBlur={() => saveCell()}
                        onPressEnter={() => saveCell()}
                    />
                );
            },
        },
        {
            title: ts("action"),
            width: 200,
            render: (_value: any, row: any, index: number) => (
                <Space>
                    <Tooltip title="上移">
                        <Button type="link" size="small" disabled={index === 0 || data.updating} onClick={() => moveRow(row, "up")}>
                            <ArrowUpOutlined />
                        </Button>
                    </Tooltip>
                    <Tooltip title="下移">
                        <Button type="link" size="small" disabled={index === (data.rows || []).length - 1 || data.updating} onClick={() => moveRow(row, "down")}>
                            <ArrowDownOutlined />
                        </Button>
                    </Tooltip>
                    <Tooltip title="在下方插入行">
                        <Button type="link" size="small" onClick={() => doAdd(row)}>
                            <PlusOutlined />
                        </Button>
                    </Tooltip>
                    <Button type="link" danger onClick={() => doDelete(row)}>
                        {ts("delete")}
                    </Button>
                </Space>
            ),
        },
    ];

    useEffect(() => {
        if (prodId) loadModules(prodId, true);
    }, [prodId]);

    return (
        <div className="risk-part-nested">
            <Table
                size="small"
                columns={columns}
                rowKey={(item: any) => item.id}
                dataSource={data.rows}
                loading={data.loading}
                pagination={false}
                locale={{
                    emptyText: (
                        <div>
                            <div style={{ marginBottom: 8 }}>暂无数据</div>
                            <Button type="link" icon={<PlusOutlined />} onClick={() => doAdd()}>添加一行</Button>
                        </div>
                    ),
                }}
                footer={() => sprintf(ts("total_items"), { total: (data.rows || []).length })}
            />
        </div>
    );
};
