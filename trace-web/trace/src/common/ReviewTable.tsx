import React from "react";

// 「评审记录」章节的只读合并表格：与后端导出的合并规则一致。
// - 整行标记行（参评人员签字 / 评审时间 / 评审结论 / 批准人员签字）横向合并跨满整行。
// - 首列非空单元格纵向合并其后的空单元格（类别列）。
const BANNERS = ["参评人员签字", "评审时间", "评审结论", "批准人员签字"];
const isBanner = (t: any) => BANNERS.some((b) => String(t ?? "").startsWith(b));

export const ReviewTable: React.FC<{ grid: any[]; headerRows?: number }> = ({ grid, headerRows = 1 }) => {
    const rows: string[][] = (Array.isArray(grid) ? grid : []).map((r) =>
        Array.isArray(r) ? r.map((c) => String(c ?? "")) : [],
    );
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    if (cols <= 0) return null;

    // 计算首列纵向合并：非空且非标记的单元格向下合并其后的空单元格
    const rowspan0 = new Array(rows.length).fill(1);
    const skip0 = new Array(rows.length).fill(false);
    for (let r = 0; r < rows.length; r++) {
        const t = rows[r][0] || "";
        if (t.trim() && !isBanner(t)) {
            let r2 = r;
            while (r2 + 1 < rows.length && !((rows[r2 + 1][0] || "").trim())) {
                r2 += 1;
                skip0[r2] = true;
            }
            rowspan0[r] = r2 - r + 1;
        }
    }

    return (
        <table className="pdp-grid review-grid">
            <tbody>
                {rows.map((row, r) => {
                    const head = r < headerRows;
                    if (isBanner(row[0])) {
                        // 评审结论为长段落，保持左对齐；其余标记行（参评人员签字/评审时间/批准人员签字）居中
                        const isConclusion = String(row[0] ?? "").startsWith("评审结论");
                        return (
                            <tr key={r}>
                                <td className={head ? "head" : ""} colSpan={cols}
                                    style={{
                                        whiteSpace: "pre-wrap",
                                        padding: "6px 8px",
                                        textAlign: isConclusion ? "left" : "center",
                                        fontWeight: isConclusion ? undefined : 600,
                                    }}>
                                    {row[0]}
                                </td>
                            </tr>
                        );
                    }
                    return (
                        <tr key={r}>
                            {Array.from({ length: cols }).map((_, ci) => {
                                if (ci === 0) {
                                    if (skip0[r]) return null;
                                    return (
                                        <td key={ci} rowSpan={rowspan0[r]} className={head ? "head" : ""}
                                            style={{ whiteSpace: "pre-wrap", verticalAlign: "middle", textAlign: "center", padding: "6px 8px" }}>
                                            {row[0] || ""}
                                        </td>
                                    );
                                }
                                const val = row[ci] ?? "";
                                const isSign = typeof val === "string" && val.startsWith("data:image");
                                return (
                                    <td key={ci} className={head ? "head" : ""}
                                        style={{ whiteSpace: "pre-wrap", padding: "6px 8px", textAlign: isSign ? "center" : undefined, verticalAlign: "middle" }}>
                                        {isSign
                                            ? <img src={val} alt="签字" style={{ height: 36, width: "auto", maxWidth: "100%", objectFit: "contain", display: "inline-block" }} />
                                            : val}
                                    </td>
                                );
                            })}
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
};

export default ReviewTable;
