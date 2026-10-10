import { Button, Popconfirm, Space } from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { useState } from "react";
import ReviewTable from "@/common/ReviewTable";
import EditableTableGenerator from "@/pages/srs_doc/components/EditableTableGenerator";

const SIGN_MARK = "（签名图）";

const isOtherLabel = (text: string) => text.startsWith("其他参会人员") || text.startsWith("其他参评人员");
const isBannerLabel = (text: string) => ["参评人员签字", "评审时间", "评审结论", "批准人员签字"].some((b) => text.startsWith(b));
const isFullRow = (row: any[]) => (row || []).length > 1
    && String(row?.[0] ?? "").trim() !== ""
    && (row || []).slice(1).every((c: any) => String(c ?? "").trim() === "");

/** 连续相同的类别留空，交给只读表按需求规格说明的规则纵向合并。 */
const reviewDisplayGrid = (tb: any[]) => {
    const rows = (tb || []).map((row: any[]) => [...(row || [])]);
    let prev = "";
    rows.forEach((row) => {
        const t = String(row[0] ?? "").trim();
        if (isBannerLabel(t) || isOtherLabel(t) || isFullRow(row)) {
            prev = "";
            return;
        }
        if (t && t === prev) row[0] = "";
        else if (t) prev = t;
    });
    return rows;
};

const isReviewHeaderRow = (tb: any[]) => {
    const first = (tb?.[0] || []).map((c: any) => String(c ?? "").trim());
    if (!first.length || isBannerLabel(first[0] || "")) return false;
    const filled = first.filter(Boolean);
    return filled.length === first.length && first.every((c: string) => c.length > 0 && c.length < 40);
};

/** 评审记录：只读合并表，点「编辑」弹出与需求规格说明相同的表格编辑。 */
const ReviewRecordTables = ({ tables, readonly, onChange }: {
    tables: any[][];
    readonly?: boolean;
    onChange: (tables: any[][]) => void;
}) => {
    const [reviewEdit, setReviewEdit] = useState<any>(null);
    const openReviewEdit = (ti: number, tb: any[]) => {
        const split = isReviewHeaderRow(tb);
        const body = split ? tb.slice(1) : tb;
        const cols = Math.max(1, ...(tb || []).map((row: any[]) => (row || []).length));
        const signs: Record<string, string> = {};
        const dataRows = body.map((row: any[], ri: number) => Array.from({ length: cols }, (_, ci) => {
            const raw = String(row?.[ci] ?? "");
            if (raw.startsWith("data:image")) {
                signs[`${ri},${ci}`] = raw;
                return SIGN_MARK;
            }
            return raw;
        }));
        const headers = split
            ? (tb[0] || []).map((c: any, i: number) => ({ code: `c${i}`, name: String(c ?? "") }))
            : Array.from({ length: cols }, (_, i) => ({ code: `c${i}`, name: `列${i + 1}` }));
        setReviewEdit({ ti, split, signs, initial: { headers, data: dataRows } });
    };
    const saveReviewEdit = (tableData: any) => {
        if (!reviewEdit) return;
        const { ti, split, signs } = reviewEdit;
        const body = (tableData.data || []).map((row: any[], ri: number) => (row || []).map((c: any, ci: number) => {
            const text = String(c ?? "");
            return text === SIGN_MARK && signs[`${ri},${ci}`] ? signs[`${ri},${ci}`] : text;
        }));
        const grid = split ? [(tableData.headers || []).map((h: any) => h.name || ""), ...body] : body;
        onChange((tables || []).map((tb: any[], i: number) => (i === ti ? grid : tb)));
        setReviewEdit(null);
    };

    return (
        <>
            {(tables || []).map((tb: any[], ti: number) => (
                <div className="pdp-table-block" key={ti}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
                            <ReviewTable grid={reviewDisplayGrid(tb)} headerRows={isReviewHeaderRow(tb) ? 1 : 0} />
                        </div>
                        {!readonly && (
                            <Space size={8} style={{ flexShrink: 0, marginTop: 8 }}>
                                <Button size="small" icon={<EditOutlined />} onClick={() => openReviewEdit(ti, tb)}>编辑</Button>
                                <Popconfirm title="确定删除此表？" okText="确定" cancelText="取消" onConfirm={() => onChange((tables || []).filter((_: any, i: number) => i !== ti))}>
                                    <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                                </Popconfirm>
                            </Space>
                        )}
                    </div>
                </div>
            ))}
            <EditableTableGenerator
                open={!!reviewEdit}
                initialData={reviewEdit?.initial}
                onConfirm={saveReviewEdit}
                onCancel={() => setReviewEdit(null)}
            />
        </>
    );
};

export default ReviewRecordTables;
