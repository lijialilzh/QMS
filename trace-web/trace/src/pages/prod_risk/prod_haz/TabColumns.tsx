import { renderOneLineWithTooltip } from "@/common";

export const tabColumns = (ts: any) => {
    const renderShortText = (value: any) => renderOneLineWithTooltip(value, { emptyText: "", maxChars: 20 });

    return [
        {
            title: ts("haz.code"),
            dataIndex: "code",
            render: renderShortText,
        },
        {
            title: ts("haz.source"),
            dataIndex: "source",
            render: renderShortText,
        },
        {
            title: ts("haz.event"),
            dataIndex: "event",
            render: renderShortText,
        },
        {
            title: ts("haz.situation"),
            dataIndex: "situation",
            render: renderShortText,
        },
        {
            title: ts("haz.damage"),
            dataIndex: "damage",
            render: renderShortText,
        },
        {
            title: ts("haz.init_risk"),
            render: (_value: any, row: any) => {
                return (
                    <div>
                        <div>概率：{row.init_rate}</div>
                        <div>程度：{row.init_degree}</div>
                        <div>危险水平：{row.init_level}</div>
                    </div>
                );
            },
        },
        {
            title: ts("haz.deal"),
            dataIndex: "deal",
            render: renderShortText,
        },
        {
            title: ts("haz.rcms"),
            dataIndex: "rcms",
            render: renderShortText,
        },
        {
            title: ts("haz.evidence"),
            dataIndex: "evidence",
            render: renderShortText,
        },
        {
            title: ts("haz.cur_risk"),
            dataIndex: "cur_rate",
            render: (_value: any, row: any) => {
                return (
                    <div>
                        <div>概率：{row.cur_rate}</div>
                        <div>程度：{row.cur_degree}</div>
                        <div>危险水平：{row.cur_level}</div>
                    </div>
                );
            },
        },
        {
            title: ts("haz.benefit_flag"),
            dataIndex: "benefit_flag",
            render: (_value: any, row: any) => {
                return row.benefit_flag ? ts("yes") : ts("no");
            },
        },
        {
            title: ts("haz.category"),
            dataIndex: "category",
            render: renderShortText,
        },
    ];
};
