import { Tooltip } from "antd";

type OneLineTooltipOpts = {
    emptyText?: string;
    placement?: "top" | "topLeft" | "topRight" | "bottom" | "bottomLeft" | "bottomRight" | "left" | "right";
};

export const renderOneLineWithTooltip = (value: any, opts?: OneLineTooltipOpts) => {
    const emptyText = opts?.emptyText ?? "-";
    const placement = opts?.placement ?? "top";
    const v = value === undefined || value === null || value === "" ? emptyText : value;

    // 空值或 "-" 不显示 tooltip，避免弹层遮挡/抖动
    if (v === "" || v === "-") {
        return <div className="ltxt stxt" style={{ width: "100%" }}>{v}</div>;
    }

    return (
        <Tooltip title={<div className="tip">{v}</div>} placement={placement} getPopupContainer={() => document.body}>
            <div className="ltxt stxt" style={{ width: "100%" }}>
                {v}
            </div>
        </Tooltip>
    );
};

