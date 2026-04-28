type OneLineTooltipOpts = {
    emptyText?: string;
    placement?: "top" | "topLeft" | "topRight" | "bottom" | "bottomLeft" | "bottomRight" | "left" | "right";
};

export const renderOneLineWithTooltip = (value: any, opts?: OneLineTooltipOpts) => {
    const emptyText = opts?.emptyText ?? "-";
    const v = value === undefined || value === null || value === "" ? emptyText : value;

    // 空值或 "-" 不显示原生 title，避免无意义提示
    if (v === "" || v === "-") {
        return <div className="ltxt stxt" style={{ width: "100%" }}>{v}</div>;
    }

    return (
        <div className="ltxt stxt" style={{ width: "100%" }} title={String(v)}>
            {v}
        </div>
    );
};

