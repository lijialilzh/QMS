import { PlusOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { Button, message, Space, Input, Upload, Modal, Spin, DatePicker, Checkbox } from "antd";
import dayjs from "dayjs";
import { useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import ProductVersionSelect from "@/common/ProductVersionSelect";
import * as Api from "@/api/ApiProjectTimeline";
import * as ApiProduct from "@/api/ApiProduct";
import "./ProjectTimeline.less";
import "../prod_risk/ProdDhfDetail.less";

export default () => {
    const { t: ts } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const prodId = Number(useParams().prodId);
    const readOnly = location.pathname.includes("/view/");
    const [data, dispatch] = useData({
        depts: [],
        rows: [],
        loading: false,
        products: [],
        edit: null as any,
        editVal: "",
        saving: false,
        importing: false,
        selectedIds: [] as any[],
    });

    const loadTimeline = (id: any) => {
        if (!id) return;
        dispatch({ loading: true });
        Api.list_timeline({ prod_id: id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, depts: res.data.depts || [], rows: res.data.rows || [], selectedIds: [] });
            } else {
                dispatch({ loading: false, rows: [] });
                message.error(res.msg);
            }
        });
    };

    const addRow = (row_type: string) => {
        if (readOnly) return;
        if (!prodId) {
            message.warning("请先选择产品");
            return;
        }
        Api.add_timeline_row({ prod_id: prodId, row_type }).then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success("已新增一行");
                loadTimeline(prodId);
            } else message.error(res.msg);
        });
    };

    const insertRowAfter = (row: any) => {
        if (readOnly) return;
        if (!prodId) {
            message.warning("请先选择产品");
            return;
        }
        Api.add_timeline_row({
            prod_id: row.prod_id || prodId,
            row_type: "date",
            sort_order: Number(row.sort_order || 0) + 1,
            year: row.year || "",
            month: row.month || "",
        }).then((res: any) => {
            if (res.code === Api.C_OK) {
                message.success("已插入一行");
                loadTimeline(prodId);
            } else message.error(res.msg);
        });
    };

    const rowOps = (row: any) => (
        <td className="tl-ops">
            {readOnly ? null : <PlusOutlined title="在下方插入行" onClick={() => insertRowAfter(row)} />}
            {readOnly ? null : (
                <Button type="link" danger size="small" onClick={() => deleteRow(row)}>
                    {ts("delete")}
                </Button>
            )}
        </td>
    );

    const deleteRow = (row: any) => {
        Modal.confirm({
            title: "确认删除",
            content: ts("confirm_delete"),
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => {
                return Api.delete_timeline_row({ id: row.id }).then((res: any) => {
                    if (res.code === Api.C_OK) {
                        message.success("已删除");
                        loadTimeline(prodId);
                    } else {
                        message.error(res.msg);
                    }
                });
            },
        });
    };

    const toggleSelect = (id: any, checked: boolean) => {
        const set = new Set(data.selectedIds || []);
        if (checked) set.add(id);
        else set.delete(id);
        dispatch({ selectedIds: Array.from(set) });
    };

    const toggleSelectAll = (checked: boolean) => {
        dispatch({ selectedIds: checked ? (data.rows || []).map((r: any) => r.id) : [] });
    };

    const batchDelete = () => {
        const ids = data.selectedIds || [];
        if (ids.length === 0) return;
        Modal.confirm({
            title: ts("action"),
            content: `确认删除选中的 ${ids.length} 行？`,
            onOk: () => {
                Api.delete_timeline_row({ id: ids.join(",") }).then((res: any) => {
                    if (res.code === Api.C_OK) {
                        message.success(ts("msg_ok"));
                        loadTimeline(prodId);
                    } else {
                        message.error(res.msg);
                    }
                });
            },
        });
    };

    const isEditing = (rowId: any, field: string) => data.edit && data.edit.rowId === rowId && data.edit.field === field;

    const startEdit = (rowId: any, field: string, value: any) => {
        if (readOnly) return;
        dispatch({ edit: { rowId, field }, editVal: value ?? "" });
    };

    const commit = () => {
        const edit = data.edit;
        if (!edit || data.saving) return;
        const row = (data.rows || []).find((r: any) => r.id === edit.rowId);
        if (!row) {
            dispatch({ edit: null });
            return;
        }
        const val = data.editVal;
        dispatch({ saving: true });

        const onDone = (res: any, patch: any) => {
            if (res.code === Api.C_OK) {
                const rows = (data.rows || []).map((r: any) => (r.id === edit.rowId ? { ...r, ...patch } : r));
                dispatch({ saving: false, edit: null, editVal: "", rows });
                message.success("保存成功");
            } else {
                dispatch({ saving: false });
                message.error(res.msg);
            }
        };

        if (edit.field.startsWith("dept:")) {
            const dept = edit.field.slice(5);
            const ids: any[] = edit.groupIds && edit.groupIds.length ? edit.groupIds : [row.id];
            Promise.all(ids.map((id: any) => Api.update_timeline_cell({ row_id: id, dept, output_result: val }))).then(
                (results: any[]) => {
                    if (results.every((r: any) => r.code === Api.C_OK)) {
                        const rows = (data.rows || []).map((r: any) =>
                            ids.includes(r.id) ? { ...r, cells: { ...(r.cells || {}), [dept]: val } } : r
                        );
                        dispatch({ saving: false, edit: null, editVal: "", rows });
                        message.success("保存成功");
                    } else {
                        dispatch({ saving: false });
                        message.error((results.find((r: any) => r.code !== Api.C_OK) || {}).msg);
                    }
                }
            );
        } else {
            const patch: any = { [edit.field === "milestone" ? "milestone_text" : edit.field]: val };
            Api.update_timeline_row({ id: row.id, ...patch }).then((res: any) => onDone(res, patch));
        }
    };

    const onlyDigits = (v: any) => String(v ?? "").replace(/\D/g, "");

    const rowToDayjs = (row: any) => {
        const y = onlyDigits(row.year);
        const m = onlyDigits(row.month);
        const d = onlyDigits(row.day);
        if (!y) return null;
        const pad = (s: string, fallback: string) => (s ? s.padStart(2, "0") : fallback);
        const dt = dayjs(`${y.padStart(4, "0")}-${pad(m, "01")}-${pad(d, "01")}`);
        return dt.isValid() ? dt : null;
    };

    const saveDate = (row: any, d: any) => {
        const patch = d
            ? { year: String(d.year()), month: String(d.month() + 1), day: String(d.date()) }
            : { year: "", month: "", day: "" };
        dispatch({ saving: true });
        Api.update_timeline_row({ id: row.id, ...patch }).then((res: any) => {
            if (res.code === Api.C_OK) {
                const rows = (data.rows || []).map((r: any) => (r.id === row.id ? { ...r, ...patch } : r));
                dispatch({ saving: false, edit: null, rows });
                message.success("保存成功");
            } else {
                dispatch({ saving: false });
                message.error(res.msg);
            }
        });
    };

    const editCell = (rowId: any, field: string, current: any, textarea: boolean) => {
        if (!isEditing(rowId, field)) {
            return (
                <div className="tl-cell" title="点击编辑" onClick={() => startEdit(rowId, field, current)}>
                    {current !== null && current !== undefined && String(current) !== "" ? (
                        String(current)
                            .split("\n")
                            .map((line: string, i: number) => <div key={i}>{line}</div>)
                    ) : (
                        <span style={{ color: "#d9d9d9" }}>—</span>
                    )}
                </div>
            );
        }
        const common = {
            autoFocus: true,
            value: data.editVal,
            onChange: (e: any) => dispatch({ editVal: e.target.value }),
            onBlur: commit,
        };
        return textarea ? (
            <Input.TextArea {...common} autoSize={{ minRows: 1, maxRows: 8 }} onPressEnter={undefined} />
        ) : (
            <Input {...common} onPressEnter={commit} />
        );
    };

    // 部门「输出结果」单元格：合并组内编辑会写回整组（保持合并）
    const deptCell = (rowId: any, dept: string, current: any, groupIds: any[]) => {
        const field = `dept:${dept}`;
        if (!isEditing(rowId, field)) {
            return (
                <div
                    className="tl-cell"
                    title="点击编辑"
                    onClick={() => {
                        if (readOnly) return;
                        dispatch({ edit: { rowId, field, groupIds }, editVal: current ?? "" });
                    }}>
                    {current !== null && current !== undefined && String(current) !== "" ? (
                        String(current)
                            .split("\n")
                            .map((line: string, i: number) => <div key={i}>{line}</div>)
                    ) : (
                        <span style={{ color: "#d9d9d9" }}>—</span>
                    )}
                </div>
            );
        }
        return (
            <Input.TextArea
                autoFocus
                value={data.editVal}
                onChange={(e: any) => dispatch({ editVal: e.target.value })}
                onBlur={commit}
                autoSize={{ minRows: 1, maxRows: 8 }}
            />
        );
    };

    const doImport = (file: any) => {
        if (readOnly || !prodId) {
            message.warning("请先选择产品");
            return false;
        }
        Modal.confirm({
            title: "导入时间线",
            content: "导入将覆盖当前产品已有的时间线数据，确认导入？",
            onOk: () => {
                dispatch({ importing: true });
                Api.import_timeline({ prod_id: prodId, replace: true, file: { fileList: [file] } }).then(
                    (res: any) => {
                        dispatch({ importing: false });
                        if (res.code === Api.C_OK) {
                            message.success(`导入成功，共 ${res.data?.imported ?? 0} 行`);
                            loadTimeline(prodId);
                        } else {
                            message.error(res.msg);
                        }
                    }
                );
            },
        });
        return false;
    };

    useEffect(() => {
        if (!prodId) {
            message.error("无效的产品 ID");
            navigate("/project_timeline");
            return;
        }
        ApiProduct.list_product({ page_index: 0, page_size: 10000 }).then((res: any) => {
            const products = res.code === ApiProduct.C_OK ? (res.data.rows || []) : [];
            dispatch({ products });
        });
        loadTimeline(prodId);
    }, [prodId]);

    const depts: string[] = data.depts || [];
    const totalCols = 1 + 3 + depts.length + 1;
    const selectedIds: any[] = data.selectedIds || [];
    const allChecked = (data.rows || []).length > 0 && selectedIds.length === (data.rows || []).length;
    const indeterminate = selectedIds.length > 0 && !allChecked;

    const isDateRow = (a: any) => a && a.row_type !== "year" && a.row_type !== "milestone";
    const rowsArr: any[] = data.rows || [];

    // 各部门「输出结果」连续相同且非空的纵向合并（空值不合并、可单独编辑）
    const deptMeta: Record<string, Record<number, { show: boolean; span: number; groupIds: any[] }>> = {};
    depts.forEach((dept) => {
        const map: Record<number, { show: boolean; span: number; groupIds: any[] }> = {};
        let i = 0;
        while (i < rowsArr.length) {
            const r = rowsArr[i];
            if (!isDateRow(r)) {
                i += 1;
                continue;
            }
            const val = (r.cells || {})[dept] || "";
            if (!val) {
                map[r.id] = { show: true, span: 1, groupIds: [r.id] };
                i += 1;
                continue;
            }
            const ids = [r.id];
            let j = i;
            while (
                j + 1 < rowsArr.length &&
                isDateRow(rowsArr[j + 1]) &&
                Number(rowsArr[j + 1].prod_id) === Number(r.prod_id) &&
                ((rowsArr[j + 1].cells || {})[dept] || "") === val
            ) {
                j += 1;
                ids.push(rowsArr[j].id);
            }
            map[r.id] = { show: true, span: ids.length, groupIds: ids };
            for (let k = i + 1; k <= j; k++) map[rowsArr[k].id] = { show: false, span: 0, groupIds: ids };
            i = j + 1;
        }
        deptMeta[dept] = map;
    });

    const mode = readOnly ? "view" : "edit";

    return (
        <div className="page div-v project-timeline prod-dhf-detail-page">
            <div className="div-h searchbar list-searchbar-align prod-dhf-detail-toolbar">
                <Space align="center" className="prod-dhf-detail-header-left">
                    <div className="prod-dhf-product-select">
                        <ProductVersionSelect
                            products={data.products}
                            value={prodId}
                            allowClear={false}
                            deferChangeUntilVersionSelect
                            namePlaceholder={ts("product.name")}
                            versionPlaceholder={ts("product.full_version")}
                            onChange={(v: any) => {
                                if (!v || Number(v) === prodId) return;
                                navigate(`/project_timeline/${mode}/${v}`);
                            }}
                        />
                    </div>
                    <span className="prod-dhf-detail-title">{readOnly ? "查看" : "编辑"}项目时间逻辑线</span>
                    <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/project_timeline")}>
                        返回列表
                    </Button>
                </Space>
                <div className="div-h hspace">
                    {!readOnly && (
                        <>
                            <Upload showUploadList={false} accept=".xlsx" beforeUpload={doImport}>
                                <Button type="primary" loading={data.importing}>导入模板</Button>
                            </Upload>
                            <Button danger disabled={selectedIds.length === 0} onClick={batchDelete}>
                                批量删除{selectedIds.length > 0 ? `（${selectedIds.length}）` : ""}
                            </Button>
                        </>
                    )}
                    <Button onClick={() => Api.export_timeline({ prod_id: prodId })}>
                        {ts("export")}
                    </Button>
                </div>
            </div>

            <Spin spinning={data.loading}>
                <div className="tl-table-wrap">
                    <table className="tl-table">
                        <colgroup>
                            <col style={{ width: 40 }} />
                            <col style={{ width: 70 }} />
                            <col style={{ width: 64 }} />
                            <col style={{ width: 56 }} />
                            {depts.map((d) => (
                                <col key={d} style={{ width: 150 }} />
                            ))}
                            <col style={{ width: 92 }} />
                        </colgroup>
                        <thead>
                            <tr>
                                <th style={{ width: 42 }}>
                                    <Checkbox
                                        checked={allChecked}
                                        indeterminate={indeterminate}
                                        disabled={(data.rows || []).length === 0}
                                        onChange={(e) => toggleSelectAll(e.target.checked)}
                                    />
                                </th>
                                <th>年</th>
                                <th>月</th>
                                <th>日</th>
                                {depts.map((d) => (
                                    <th key={d}>{d}</th>
                                ))}
                                <th style={{ width: 92 }}>{ts("action")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(data.rows || []).length === 0 && (
                                <tr>
                                    <td colSpan={totalCols - 1} style={{ textAlign: "center", color: "#999" }}>
                                        暂无数据
                                    </td>
                                    <td className="tl-ops">
                                            {readOnly ? null : (
                                                <PlusOutlined title="新增行" onClick={() => addRow("date")} />
                                            )}
                                    </td>
                                </tr>
                            )}
                            {(data.rows || []).map((row: any) => {
                                if (row.row_type === "year" || row.row_type === "milestone") {
                                    return (
                                        <tr key={row.id} className={`tl-row-${row.row_type}`}>
                                            <td className="tl-check">
                                                <Checkbox
                                                    checked={selectedIds.includes(row.id)}
                                                    onChange={(e) => toggleSelect(row.id, e.target.checked)}
                                                />
                                            </td>
                                            <td colSpan={3 + depts.length}>{editCell(row.id, "milestone", row.milestone_text, false)}</td>
                                            {rowOps(row)}
                                        </tr>
                                    );
                                }
                                return (
                                    <tr key={row.id}>
                                        <td className="tl-check">
                                            <Checkbox
                                                checked={selectedIds.includes(row.id)}
                                                onChange={(e) => toggleSelect(row.id, e.target.checked)}
                                                />
                                            </td>
                                        <td className="tl-date-cell" onClick={() => startEdit(row.id, "date", null)}>
                                            {row.year ? String(row.year) : <span style={{ color: "#d9d9d9" }}>—</span>}
                                        </td>
                                        <td className="tl-date-cell" onClick={() => startEdit(row.id, "date", null)}>
                                            {row.month ? String(row.month) : <span style={{ color: "#d9d9d9" }}>—</span>}
                                        </td>
                                        {isEditing(row.id, "date") ? (
                                            <td className="tl-date-edit">
                                                <div className="tl-date-pop">
                                                    <DatePicker
                                                        autoFocus
                                                        open
                                                        allowClear
                                                        style={{ width: "100%" }}
                                                        placeholder="选择日期"
                                                        value={rowToDayjs(row)}
                                                        onChange={(d: any) => saveDate(row, d)}
                                                        onOpenChange={(o: boolean) => {
                                                            if (!o) dispatch({ edit: null });
                                                        }}
                                                    />
                                                </div>
                                            </td>
                                        ) : (
                                            <td className="tl-date-cell" onClick={() => startEdit(row.id, "date", null)}>
                                                {row.day ? String(row.day) : <span style={{ color: "#d9d9d9" }}>—</span>}
                                            </td>
                                        )}
                                        {depts.map((d) => {
                                            const dm = deptMeta[d]?.[row.id];
                                            if (dm && !dm.show) return null;
                                            return (
                                                <td key={d} rowSpan={dm?.span || 1} className={dm && dm.span > 1 ? "tl-dept-merge" : ""}>
                                                    {deptCell(row.id, d, (row.cells || {})[d], dm?.groupIds || [row.id])}
                                                </td>
                                            );
                                        })}
                                        {rowOps(row)}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Spin>
        </div>
    );
};
