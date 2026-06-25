import { Card } from "antd";

// 版本命名规则（基础数据，只读规范页）。内容为固定的软件版本命名规范。

const ruleItems: { code: string; title: string; desc: string }[] = [
    {
        code: "X",
        title: "主版本号 X",
        desc: "重构增强类软件更新和重大网络安全更新，比如增加核心功能模块、整体架构发生变化、网络环境改变、数据接口改变、核心算法重大改变。主版本 X 的范围为 1~9。",
    },
    {
        code: "Y",
        title: "次版本号 Y",
        desc: "轻微增强类软件更新和轻微网络安全更新，比如功能模块局部增强、加密方式改变、训练数据增加算法性能未发生显著性改变、数据通信效率优化、操作系统的安全更新。次版本号 Y 的范围为 0~9。",
    },
    {
        code: "Z",
        title: "修订版本号 Z",
        desc: "纠正类软件更新和纠正类网络安全更新，修正软件中缺陷和潜在未知缺陷。修订版本号 Z 的范围为 0~9。",
    },
    {
        code: "B",
        title: "上市后软件升级数字 B",
        desc: "上市后的软件升级迭代次数，0 代表软件第一次发布。上市后软件升级数字 B 的范围为 0~999。",
    },
];

export default () => {
    return (
        <div className="div-v page" style={{ overflow: "auto", padding: 8 }}>
            <Card title="版本命名规则" bordered style={{ maxWidth: 980 }}>
                <div style={{ fontSize: 14, lineHeight: 2, color: "#222" }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>1. 软件版本命名规则为：</div>
                    <div style={{ paddingLeft: 16 }}>发布版本：<b>VX</b></div>
                    <div style={{ paddingLeft: 16, marginBottom: 16 }}>完整版本：<b>VX.Y.Z.B</b></div>

                    <div style={{ fontWeight: 600, marginBottom: 12 }}>软件完整版本及说明：</div>
                    <svg viewBox="0 0 470 290" style={{ width: 470, maxWidth: "100%", marginBottom: 20 }}>
                        <defs>
                            <marker id="vr-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                                <path d="M0,0 L8,3 L0,6 Z" fill="#333" />
                            </marker>
                        </defs>
                        <rect x="10" y="12" width="210" height="44" fill="none" stroke="#333" />
                        <text x="45" y="43" fontSize="20" fontWeight="700" textAnchor="middle">X</text>
                        <text x="68" y="43" fontSize="20" textAnchor="middle">.</text>
                        <text x="95" y="43" fontSize="20" fontWeight="700" textAnchor="middle">Y</text>
                        <text x="118" y="43" fontSize="20" textAnchor="middle">.</text>
                        <text x="145" y="43" fontSize="20" fontWeight="700" textAnchor="middle">Z</text>
                        <text x="168" y="43" fontSize="20" textAnchor="middle">.</text>
                        <text x="195" y="43" fontSize="20" fontWeight="700" textAnchor="middle">B</text>

                        <polyline points="195,56 195,87 300,87" fill="none" stroke="#333" markerEnd="url(#vr-arrow)" />
                        <polyline points="145,56 145,142 300,142" fill="none" stroke="#333" markerEnd="url(#vr-arrow)" />
                        <polyline points="95,56 95,197 300,197" fill="none" stroke="#333" markerEnd="url(#vr-arrow)" />
                        <polyline points="45,56 45,252 300,252" fill="none" stroke="#333" markerEnd="url(#vr-arrow)" />

                        <g fontSize="13" textAnchor="middle">
                            <rect x="302" y="70" width="150" height="34" fill="none" stroke="#333" />
                            <text x="377" y="92">上市后软件升级次数号</text>
                            <rect x="302" y="125" width="150" height="34" fill="none" stroke="#333" />
                            <text x="377" y="147">修订版本号</text>
                            <rect x="302" y="180" width="150" height="34" fill="none" stroke="#333" />
                            <text x="377" y="202">次版本号</text>
                            <rect x="302" y="235" width="150" height="34" fill="none" stroke="#333" />
                            <text x="377" y="257">主版本号</text>
                        </g>
                    </svg>

                    <div style={{ color: "#555", marginBottom: 20 }}>
                        注：V 代表 vision，是版本标识符号，其余每一位字母代表一位数字，X 从 1 开始计数，Y、Z、B 从 0 开始计数。
                    </div>

                    {ruleItems.map((item) => (
                        <div key={item.code} style={{ marginBottom: 14 }}>
                            <span style={{ fontWeight: 600, color: "#1677ff" }}>{item.title}：</span>
                            <span>{item.desc}</span>
                        </div>
                    ))}

                    <div style={{ color: "#555", marginTop: 8 }}>
                        注：版本号中可不含 V（version）。
                    </div>
                </div>
            </Card>
        </div>
    );
};
