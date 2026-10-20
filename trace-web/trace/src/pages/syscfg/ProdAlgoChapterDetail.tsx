import { Button, Table, message, Space, Input, Modal, Tooltip, Select } from "antd";
import { ArrowUpOutlined, ArrowDownOutlined, PlusOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { sprintf } from "sprintf-js";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as ApiChapter from "@/api/ApiProdAlgoChapter";
import * as ApiModule from "@/api/ApiProdAlgoModule";
import "../risk_mgmt/RiskMgmtParticipants.less";

const DEFAULT_MODULES = ["肺栓塞分诊", "肺叶分割"];

const normName = (name: any) => String(name ?? "").trim();

const mergeRows = (chapters: any[], modules: any[]) => {
    const used = new Set<number>();
    const chSorted = [...chapters].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
    const rows: any[] = chSorted.map((c) => {
        const name = c.name || "";
        const key = normName(name);
        const mod = key
            ? modules.find((m) => !used.has(m.id) && normName(m.name) === key)
            : undefined;
        if (mod) used.add(mod.id);
        return {
            rowKey: `c-${c.id}`,
            chapterId: c.id,
            moduleId: mod?.id,
            prod_id: c.prod_id,
            name,
            is_nav: !!mod,
            displaySort: c.sort_order || 0,
        };
    });
    modules
        .filter((m) => !used.has(m.id))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id)
        .forEach((m) => {
            rows.push({
                rowKey: `m-${m.id}`,
                chapterId: undefined,
                moduleId: m.id,
                prod_id: m.prod_id,
                name: m.name || "",
                is_nav: true,
                displaySort: m.sort_order || 0,
            });
        });
    rows.sort((a, b) => {
        const ds = (a.displaySort || 0) - (b.displaySort || 0);
        if (ds) return ds;
        if (!!a.chapterId !== !!b.chapterId) return a.chapterId ? -1 : 1;
        return (a.chapterId || a.moduleId || 0) - (b.chapterId || b.moduleId || 0);
    });
    return rows;
};

const persistOrder = (rows: any[]) => {
    const jobs: Promise<any>[] = [];
    rows.forEach((r, i) => {
        const sort_order = i + 1;
        if (r.chapterId) {
            jobs.push(ApiChapter.update_prod_algo_chapter({
                id: r.chapterId, prod_id: r.prod_id, name: r.name, sort_order,
            }));
        }
        if (r.moduleId) {
            jobs.push(ApiModule.update_prod_algo_module({
                id: r.moduleId, prod_id: r.prod_id, name: r.name, sort_order,
            }));
        }
    });
    return Promise.all(jobs);
};

export default ({ prodId, readOnly, onChanged }: { prodId: number; readOnly?: boolean; onChanged?: () => void }) => {
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
        Promise.all([
            ApiChapter.list_prod_algo_chapter({ prod_id: id || undefined, page_index: 0, page_size: 10000 }),
            ApiModule.list_prod_algo_module({ prod_id: id || undefined, page_index: 0, page_size: 10000 }),
        ]).then(([chRes, moRes]: any[]) => {
            if (chRes.code !== ApiChapter.C_OK) {
                dispatch({ loading: false, rows: [] });
                message.error(chRes.msg);
                return;
            }
            if (moRes.code !== ApiModule.C_OK) {
                dispatch({ loading: false, rows: [] });
                message.error(moRes.msg);
                return;
            }
            const chapters = chRes.data.rows || [];
            const modules = moRes.data.rows || [];
            if (id && allowSeed && !chapters.length && !modules.length && DEFAULT_MODULES.length) {
                const jobs = DEFAULT_MODULES.map((name, i) =>
                    ApiChapter.add_prod_algo_chapter({ prod_id: id, name, sort_order: i + 1 })
                );
                Promise.all(jobs).then(() => {
                    loadModules(id, false);
                    onChanged?.();
                }).catch(() => {
                    dispatch({ loading: false, rows: [] });
                });
                return;
            }
            dispatch({ loading: false, rows: mergeRows(chapters, modules) });
        }).catch(() => {
            dispatch({ loading: false });
            message.error("加载失败");
        });
    };

    const doAdd = (afterRow?: any) => {
        if (readOnly) return;
        if (!prodId) {
            message.warning("请先选择产品");
            return;
        }
        const rows = data.rows || [];
        const idx = afterRow ? rows.findIndex((r: any) => r.rowKey === afterRow.rowKey) : rows.length - 1;
        const insertAt = idx + 1;
        const jobs: Promise<any>[] = [];
        rows.forEach((r: any, i: number) => {
            const sort_order = i < insertAt ? i + 1 : i + 2;
            if (r.chapterId) {
                jobs.push(ApiChapter.update_prod_algo_chapter({
                    id: r.chapterId, prod_id: r.prod_id, name: r.name, sort_order,
                }));
            }
            if (r.moduleId) {
                jobs.push(ApiModule.update_prod_algo_module({
                    id: r.moduleId, prod_id: r.prod_id, name: r.name, sort_order,
                }));
            }
        });
        Promise.all(jobs).then(() => {
            ApiChapter.add_prod_algo_chapter({
                prod_id: prodId,
                name: "",
                sort_order: insertAt + 1,
            }).then((res: any) => {
                if (res.code === ApiChapter.C_OK) {
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
        if (readOnly) return;
        Modal.confirm({
            title: ts("action"),
            content: ts("confirm_delete"),
            onOk: () => {
                const jobs: Promise<any>[] = [];
                if (row.chapterId) jobs.push(ApiChapter.delete_prod_algo_chapters({ id: row.chapterId }));
                if (row.moduleId) jobs.push(ApiModule.delete_prod_algo_modules({ id: row.moduleId }));
                Promise.all(jobs).then((results: any[]) => {
                    const failed = results.find((res) => res.code !== ApiChapter.C_OK);
                    if (!failed) {
                        message.success(results[0]?.msg || ts("save_success"));
                        loadModules(prodId, false);
                        onChanged?.();
                    } else {
                        message.error(failed.msg);
                    }
                }).catch(() => {
                    message.error("删除失败");
                });
            },
        });
    };

    const startEdit = (row: any, field: string) => {
        if (readOnly) return;
        if (data.targetEdit.rowKey === row.rowKey && data.editingField === field) return;
        dispatch({ targetEdit: { ...row }, editingField: field });
    };

    const moveRow = (row: any, dir: "up" | "down") => {
        if (readOnly) return;
        const rows = [...(data.rows || [])];
        const idx = rows.findIndex((r: any) => r.rowKey === row.rowKey);
        if (idx < 0) return;
        const swapIdx = dir === "up" ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= rows.length) return;
        const next = rows.slice();
        const cur = next[idx];
        next[idx] = next[swapIdx];
        next[swapIdx] = cur;
        dispatch({ updating: true });
        persistOrder(next).then((results: any[]) => {
            if (results.every((r: any) => r.code === ApiChapter.C_OK)) {
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
        if (readOnly) return;
        const edit = { ...data.targetEdit };
        if (!edit?.rowKey || data.updating) return;
        if (edit.moduleId && !normName(edit.name)) {
            message.warning("导航模块名称不能为空");
            dispatch({ targetEdit: {}, editingField: null });
            return;
        }
        const jobs: Promise<any>[] = [];
        if (edit.chapterId) {
            jobs.push(ApiChapter.update_prod_algo_chapter({
                id: edit.chapterId, prod_id: edit.prod_id, name: edit.name, sort_order: edit.displaySort,
            }));
        }
        if (edit.moduleId) {
            jobs.push(ApiModule.update_prod_algo_module({
                id: edit.moduleId, prod_id: edit.prod_id, name: edit.name, sort_order: edit.displaySort,
            }));
        }
        if (!jobs.length) {
            dispatch({ targetEdit: {}, editingField: null });
            return;
        }
        dispatch({ updating: true });
        Promise.all(jobs).then((results: any[]) => {
            const failed = results.find((res) => res.code !== ApiChapter.C_OK);
            if (!failed) {
                const rows = (data.rows || []).map((r: any) => (r.rowKey === edit.rowKey ? { ...r, name: edit.name } : r));
                dispatch({ updating: false, targetEdit: {}, editingField: null, rows });
                message.success(results[0]?.msg || ts("msg_ok"));
                loadModules(prodId, false);
            } else {
                dispatch({ updating: false });
                message.error(failed.msg);
            }
        }).catch(() => {
            dispatch({ updating: false });
            message.error("保存失败");
        });
    };

    const setNav = (row: any, yes: boolean) => {
        if (readOnly) return;
        if (data.updating || yes === !!row.is_nav) return;
        if (yes) {
            if (!normName(row.name)) {
                message.warning("请先填写模块名称");
                return;
            }
            const sort_order = (data.rows || []).findIndex((r: any) => r.rowKey === row.rowKey) + 1;
            dispatch({ updating: true });
            ApiModule.add_prod_algo_module({
                prod_id: prodId,
                name: row.name,
                sort_order: sort_order > 0 ? sort_order : 1,
            }).then((res: any) => {
                dispatch({ updating: false });
                if (res.code === ApiModule.C_OK) {
                    message.success(res.msg || ts("save_success"));
                    loadModules(prodId, false);
                } else {
                    message.error(res.msg);
                }
            }).catch(() => {
                dispatch({ updating: false });
                message.error("保存失败");
            });
            return;
        }
        if (!row.moduleId) return;
        dispatch({ updating: true });
        ApiModule.delete_prod_algo_modules({ id: row.moduleId }).then((res: any) => {
            dispatch({ updating: false });
            if (res.code === ApiModule.C_OK) {
                message.success(res.msg || ts("save_success"));
                loadModules(prodId, false);
            } else {
                message.error(res.msg);
            }
        }).catch(() => {
            dispatch({ updating: false });
            message.error("保存失败");
        });
    };

    const isEditing = (row: any, field: string) => data.targetEdit.rowKey === row.rowKey && data.editingField === field;

    const clickToEdit = (row: any, field: string, value: any) => (
        <div style={{ cursor: readOnly ? "default" : "pointer", minHeight: 22 }} title={readOnly ? undefined : "点击编辑"} onClick={() => startEdit(row, field)}>
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
            title: "是否为导航模块",
            dataIndex: "is_nav",
            width: 140,
            render: (_value: any, row: any) => (
                <Select
                    size="small"
                    style={{ width: 88 }}
                    disabled={data.updating || !!readOnly}
                    value={row.is_nav ? "yes" : "no"}
                    options={[{ value: "yes", label: "是" }, { value: "no", label: "否" }]}
                    onChange={(v) => setNav(row, v === "yes")}
                />
            ),
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

    const shownColumns = readOnly ? columns.filter((col: any) => col.title !== ts("action")) : columns;

    useEffect(() => {
        if (prodId) loadModules(prodId, !readOnly);
    }, [prodId]);

    return (
        <div className="risk-part-nested">
            <Table
                size="small"
                columns={shownColumns}
                rowKey={(item: any) => item.rowKey}
                dataSource={data.rows}
                loading={data.loading}
                pagination={false}
                locale={{
                    emptyText: (
                        <div>
                            <div style={{ marginBottom: 8 }}>暂无数据</div>
                            {readOnly ? null : <Button type="link" icon={<PlusOutlined />} onClick={() => doAdd()}>添加一行</Button>}
                        </div>
                    ),
                }}
                footer={() => sprintf(ts("total_items"), { total: (data.rows || []).length })}
            />
        </div>
    );
};
