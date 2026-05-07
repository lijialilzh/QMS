type OneLineTooltipOpts = {
    emptyText?: string;
    placement?: "top" | "topLeft" | "topRight" | "bottom" | "bottomLeft" | "bottomRight" | "left" | "right";
    maxChars?: number;
};

export const renderOneLineWithTooltip = (value: any, opts?: OneLineTooltipOpts) => {
    const emptyText = opts?.emptyText ?? "-";
    const v = value === undefined || value === null || value === "" ? emptyText : value;

    // 空值或 "-" 不显示原生 title，避免无意义提示
    if (v === "" || v === "-") {
        return <div className="ltxt stxt" style={{ width: "100%" }}>{v}</div>;
    }

    const text = String(v);
    const displayText = opts?.maxChars && text.length > opts.maxChars
        ? `${text.slice(0, opts.maxChars)}...`
        : text;

    return (
        <div className="ltxt stxt" style={{ width: "100%" }} title={String(v)}>
            {displayText}
        </div>
    );
};

