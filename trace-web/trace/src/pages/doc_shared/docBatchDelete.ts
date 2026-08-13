import { Modal, message } from "antd";
import type { TableRowSelection } from "antd/es/table/interface";
import type { Key } from "react";
import { sprintf } from "sprintf-js";
import type { TFunction } from "i18next";

type DeleteDocFn = (params: { id: number | string }) => Promise<{ code: number; msg?: string }>;

type CreateDocBatchDeleteOptions = {
    ts: TFunction;
    dispatch: (action: Record<string, unknown>) => void;
    data: { selectedRowKeys?: Key[]; rows?: any[] };
    deleteFn: DeleteDocFn;
    cOk: number;
    onRefresh: () => void;
    getRowLabel?: (row: any) => string;
};

export function getDocTableRowSelection(
    data: { selectedRowKeys?: Key[] },
    dispatch: (action: Record<string, unknown>) => void,
): TableRowSelection {
    return {
        selectedRowKeys: data.selectedRowKeys || [],
        onChange: (keys) => dispatch({ selectedRowKeys: keys }),
    };
}

export function createDocBatchDelete(options: CreateDocBatchDeleteOptions) {
    const {
        ts,
        dispatch,
        data,
        deleteFn,
        cOk,
        onRefresh,
        getRowLabel,
    } = options;

    return () => {
        const keys = data.selectedRowKeys || [];
        if (keys.length === 0) {
            message.warning(ts("please_select_items"));
            return;
        }
        Modal.confirm({
            title: ts("action"),
            content: sprintf(ts("batch_delete_confirm"), { count: keys.length }),
            onOk: async () => {
                dispatch({ loading: true });
                const idToRow = Object.fromEntries((data.rows || []).map((row: any) => [row.id, row]));
                let successCount = 0;
                const failedIds: Key[] = [];
                for (const id of keys) {
                    try {
                        const res = await deleteFn({ id: id as number | string });
                        if (res.code === cOk) successCount += 1;
                        else failedIds.push(id);
                    } catch {
                        failedIds.push(id);
                    }
                }
                const labelOf = (row: any, id: Key) => {
                    if (getRowLabel) return getRowLabel(row) || String(id);
                    const version = row?.version || row?.full_version || "";
                    const product = row?.product_name || "";
                    return [product, version].filter(Boolean).join(" ") || String(id);
                };
                const failedItems = failedIds.map((id) => labelOf(idToRow[id], id)).join("、");
                dispatch({ loading: false, selectedRowKeys: [] });
                if (failedIds.length === 0) {
                    message.success(ts("batch_delete_success"));
                } else if (successCount > 0) {
                    message.warning(sprintf(ts("batch_delete_partial"), { success: successCount, items: failedItems }));
                } else {
                    message.error(sprintf(ts("batch_delete_all_failed"), { items: failedItems }));
                }
                onRefresh();
            },
        });
    };
}
