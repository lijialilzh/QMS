export const tabColumns = (ts: any) => {
    return [
        {
            title: ts("haz.code"),
            dataIndex: "code",
        },
        {
            title: ts("haz.source"),
            dataIndex: "source",
        },
        {
            title: ts("haz.event"),
            dataIndex: "event",
        },
        {
            title: ts("haz.situation"),
            dataIndex: "situation",
        },
        {
            title: ts("haz.damage"),
            dataIndex: "damage",
        },
        {
            title: ts("haz.init_risk"),
            render: (_value: any, row: any) => {
                return (
                    <div>
                        <div>
                            概率：{row.init_rate}程度：{row.init_degree}
                        </div>
                        <div>危险水平：{row.init_level}</div>
                    </div>
                );
            },
        },
        {
            title: ts("haz.deal"),
            dataIndex: "deal",
        },
        {
            title: ts("haz.rcms"),
            dataIndex: "rcms",
        },
        {
            title: ts("haz.evidence"),
            dataIndex: "evidence",
        },
        {
            title: ts("haz.cur_risk"),
            dataIndex: "cur_rate",
            render: (_value: any, row: any) => {
                return (
                    <div>
                        <div>
                            概率：{row.init_rate}程度：{row.init_degree}
                        </div>
                        <div>危险水平：{row.init_level}</div>
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
        },
    ];
};
