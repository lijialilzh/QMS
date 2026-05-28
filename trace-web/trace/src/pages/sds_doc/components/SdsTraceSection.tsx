import { Button } from "antd";
import type { CSSProperties } from "react";

export interface SdsTraceTreeNode {
    ref_type?: string;
    title?: string;
    // 放宽 table 类型以兼容 SDS TreeStructure 中更宽的 TableData 类型，
    // 这里只有 trace_synced 字段会被本组件读取。
    table?: ({ trace_synced?: boolean } & Record<string, any>) | null;
}

/** 判断是否为 SDS 文档「2.4 设计与需求追溯表」节点（图2） */
export function isSdsTraceSectionNode(node: Pick<SdsTraceTreeNode, "ref_type" | "title">): boolean {
    return node.ref_type === "sds_traces" || /设计与需求追溯/.test(String(node.title || ""));
}

/** 判断追溯表是否已通过「获取 SRS 追溯」同步 */
export function isSdsTraceSynced(traceSynced?: boolean, table?: SdsTraceTreeNode["table"]): boolean {
    return !!traceSynced || !!table?.trace_synced;
}

export interface SdsTraceSectionActionsProps {
    node: SdsTraceTreeNode;
    readOnly?: boolean;
    traceSynced?: boolean;
    onFetchSrsTrace?: () => void;
    onOpenTraceList?: () => void;
    compactStyle?: CSSProperties;
    ts: (key: string) => string;
}

/** SDS 图2 追溯区操作按钮：获取 SRS 追溯 / 打开需求追溯表 */
export function SdsTraceSectionActions({
    node,
    readOnly,
    traceSynced,
    onFetchSrsTrace,
    onOpenTraceList,
    compactStyle,
    ts,
}: SdsTraceSectionActionsProps) {
    if (!isSdsTraceSectionNode(node)) {
        return null;
    }
    const synced = isSdsTraceSynced(traceSynced, node.table);
    if (!readOnly && onFetchSrsTrace && !synced) {
        return (
            <Button
                type="primary"
                size="small"
                className="node-srsreq-btn"
                onClick={onFetchSrsTrace}
                style={compactStyle}
            >
                获取SRS追溯
            </Button>
        );
    }
    if (onOpenTraceList && synced) {
        return (
            <Button
                type="primary"
                size="small"
                className="node-srsreq-btn"
                onClick={onOpenTraceList}
                style={compactStyle}
            >
                {ts("menu.sds_traces") || "需求追溯表"}
            </Button>
        );
    }
    return null;
}
