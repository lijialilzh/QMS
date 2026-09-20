import { Input, Button, Table, message, Space, Tooltip, Popconfirm } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import * as Api from "@/api/ApiRiskMgmtDoc";
import "./RiskMgmtParticipants.less";

const pageSizeOptions = [20, 50, 100];

type EditField = "role" | "name";

const rowKeyOf = (row: any) => row?.id ?? row?._localId;

export default ({ prodId, onChanged }: { prodId: number; onChanged?: () => void }) => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        total: 0,
        pageIndex: 1,
        pageSize: pageSizeOptions[0],
        rows: [],
        loading: false,
        editingCell: null as { id: any; field: EditField } | null,
        editingValue: "",
        savingCellKey: "",
    });

    const doSearch = (pageIndex: any, pageSize: any) => {
        if (!prodId) return;
        dispatch({ loading: true });
        Api.list_risk_participant({ product_id: prodId, page_index: 0, page_size: 1000 }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false, pageIndex, pageSize, total: res.data.total, rows: res.data.rows });
            } else {
                dispatch({ loading: false, pageIndex, pageSize, total: 0, rows: [] });
                message.error(res.msg);
            }
        }).catch(() => {
            dispatch({ loading: false });
            message.error("加载失败");
        });
    };

    const handleStartEdit = (row: any, field: EditField) => {
        if (data.editingCell?.id === rowKeyOf(row) && data.editingCell?.field === field) return;
        dispatch({
            editingCell: { id: rowKeyOf(row), field },
            editingValue: row[field] || "",
        });
    };

    const isCellEditing = (row: any, field: EditField) => (
        data.editingCell?.id === rowKeyOf(row) && data.editingCell?.field === field
    );

    const patchRow = (row: any, nextRole: string, nextName: string) => (
        (data.rows || []).map((item: any) => (
            rowKeyOf(item) === rowKeyOf(row) ? { ...item, role: nextRole, name: nextName } : item
        ))
    );

    const handleSaveCell = async (row: any, field: EditField) => {
        if (!isCellEditing(row, field)) return;
        const cellKey = `${rowKeyOf(row)}-${field}`;
        if (data.savingCellKey === cellKey) return;

        const nextValue = String(data.editingValue || "").trim();
        const currentValue = String(row[field] || "").trim();
        const nextRole = field === "role" ? nextValue : String(row.role || "").trim();
        const nextName = field === "name" ? nextValue : String(row.name || "").trim();

        if (row.isNew) {
            if (nextValue === currentValue) {
                dispatch({ editingCell: null, editingValue: "" });
                return;
            }
            const rows = patchRow(row, nextRole, nextName);
            if (!nextRole || !nextName) {
                if (nextValue) {
                    const nextField: EditField = nextRole ? "name" : "role";
                    dispatch({
                        rows,
                        editingCell: { id: rowKeyOf(row), field: nextField },
                        editingValue: nextField === "role" ? nextRole : nextName,
                    });
                } else {
                    dispatch({ rows, editingCell: null, editingValue: "" });
                }
                return;
            }
            dispatch({ savingCellKey: cellKey, rows });
            try {
                const res: any = await Api.add_risk_participant({
                    product_id: prodId,
                    role: nextRole,
                    name: nextName,
                });
                if (res.code === Api.C_OK) {
                    const listRes: any = await Api.list_risk_participant({
                        product_id: prodId,
                        page_index: 0,
                        page_size: 1000,
                    });
                    const created = (listRes?.data?.rows || []).find((item: any) => (
                        item.role === nextRole && item.name === nextName
                    ));
                    const savedRows = rows.map((item: any) => (
                        rowKeyOf(item) === rowKeyOf(row) ? { ...(created || item), isNew: false } : item
                    ));
                    dispatch({ rows: savedRows, editingCell: null, editingValue: "", savingCellKey: "" });
                    message.success(res.msg || ts("save_success"));
                    onChanged?.();
                } else {
                    dispatch({ savingCellKey: "" });
                    message.error(res.msg || "保存失败");
                }
            } catch (_err) {
                dispatch({ savingCellKey: "" });
                message.error("保存失败");
            }
            return;
        }

        if (nextValue === currentValue) {
            dispatch({ editingCell: null, editingValue: "" });
            return;
        }
        if (!nextValue) {
            message.warning(field === "role" ? "请输入项目角色" : "请输入姓名");
            return;
        }

        dispatch({ savingCellKey: cellKey });
        try {
            const res: any = await Api.update_risk_participant({
                id: row.id,
                product_id: prodId,
                role: nextRole,
                name: nextName,
            });
            if (res.code === Api.C_OK) {
                dispatch({ rows: patchRow(row, nextRole, nextName), editingCell: null, editingValue: "", savingCellKey: "" });
                message.success(res.msg || ts("save_success"));
            } else {
                dispatch({ savingCellKey: "" });
                message.error(res.msg || "保存失败");
            }
        } catch (_err) {
            dispatch({ savingCellKey: "" });
            message.error("保存失败");
        }
    };

    const renderEditableCell = (field: EditField, value: string, row: any) => {
        const displayValue = value || (row.isNew ? "点击填写" : "-");
        const isEditing = isCellEditing(row, field);
        const isSaving = data.savingCellKey === `${rowKeyOf(row)}-${field}`;
        if (!isEditing) {
            return (
                <span
                    className="risk-part-cell-text"
                    onClick={() => handleStartEdit(row, field)}>
                    {displayValue}
                </span>
            );
        }
        return (
            <div className="risk-part-inline-cell is-editing">
                <Input
                    size="small"
                    autoFocus
                    disabled={isSaving}
                    className="risk-part-inline-cell-input"
                    value={data.editingValue}
                    onChange={(e) => dispatch({ editingValue: e.target.value })}
                    onBlur={() => handleSaveCell(row, field)}
                    onPressEnter={(e) => {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                    }}
                />
            </div>
        );
    };

    const addNewRow = (afterRow: any) => {
        const rows = [...(data.rows || [])];
        const pendingIdx = rows.findIndex((item: any) => item.isNew);
        const afterIdx = rows.findIndex((item: any) => rowKeyOf(item) === rowKeyOf(afterRow));
        const insertAt = afterIdx >= 0 ? afterIdx + 1 : rows.length;

        if (pendingIdx >= 0) {
            const pending = rows[pendingIdx];
            if (pendingIdx === afterIdx) {
                dispatch({
                    editingCell: { id: rowKeyOf(pending), field: "role" },
                    editingValue: pending.role || "",
                });
                return;
            }
            rows.splice(pendingIdx, 1);
            const nextAfterIdx = rows.findIndex((item: any) => rowKeyOf(item) === rowKeyOf(afterRow));
            rows.splice(nextAfterIdx >= 0 ? nextAfterIdx + 1 : rows.length, 0, pending);
            dispatch({
                rows,
                editingCell: { id: rowKeyOf(pending), field: "role" },
                editingValue: pending.role || "",
            });
            return;
        }

        const localId = `new-${Date.now()}`;
        const newRow = { _localId: localId, isNew: true, role: "", name: "" };
        rows.splice(insertAt, 0, newRow);
        dispatch({
            rows,
            editingCell: { id: localId, field: "role" },
            editingValue: "",
        });
    };

    const doDeleteRow = (row: any) => {
        if (row.isNew) {
            dispatch({
                rows: (data.rows || []).filter((item: any) => rowKeyOf(item) !== rowKeyOf(row)),
                editingCell: null,
                editingValue: "",
            });
            return;
        }
        dispatch({ loading: true });
        Api.delete_risk_participant({ id: row.id }).then((res: any) => {
            if (res.code === Api.C_OK) {
                dispatch({ loading: false });
                message.success(res.msg || "删除成功");
                doSearch(data.pageIndex, data.pageSize);
                onChanged?.();
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        }).catch(() => {
            dispatch({ loading: false });
            message.error("删除失败");
        });
    };

    useEffect(() => {
        dispatch({
            editingCell: null,
            editingValue: "",
            pageIndex: 1,
        });
        doSearch(1, data.pageSize);
    }, [prodId]);

    const renderRowActions = (_row: any) => (
        <Space size={0} className="risk-part-row-actions">
            <Tooltip title={ts("add")}>
                <Button
                    type="text"
                    size="small"
                    className="risk-part-action-btn"
                    icon={<PlusOutlined />}
                    onClick={() => addNewRow(_row)}
                />
            </Tooltip>
            {_row.isNew ? (
                <Button
                    type="text"
                    size="small"
                    danger
                    className="risk-part-action-btn"
                    icon={<DeleteOutlined />}
                    title={ts("delete")}
                    onClick={() => doDeleteRow(_row)}
                />
            ) : (
                <Popconfirm title={ts("confirm_delete")} onConfirm={() => doDeleteRow(_row)}>
                    <Button
                        type="text"
                        size="small"
                        danger
                        className="risk-part-action-btn"
                        icon={<DeleteOutlined />}
                        title={ts("delete")}
                    />
                </Popconfirm>
            )}
        </Space>
    );

    const columns = [
        {
            title: "项目角色",
            dataIndex: "role",
            width: "40%",
            ellipsis: true,
            render: (value: string, row: any) => renderEditableCell("role", value, row),
        },
        {
            title: "姓名",
            dataIndex: "name",
            ellipsis: true,
            render: (value: string, row: any) => renderEditableCell("name", value, row),
        },
        {
            title: ts("action"),
            width: 96,
            align: "center" as const,
            className: "risk-part-action-col",
            onCell: () => ({ className: "risk-part-action-col" }),
            render: (_value: any, row: any) => renderRowActions(row),
        },
    ];

    return (
        <div className="risk-part-nested" style={{ height: "auto", overflow: "visible" }}>
            <Table
                className="risk-part-detail-table"
                tableLayout="fixed"
                size="small"
                pagination={false}
                columns={columns}
                rowKey={(item: any) => rowKeyOf(item)}
                dataSource={data.rows}
                loading={data.loading}
            />
        </div>
    );
};
