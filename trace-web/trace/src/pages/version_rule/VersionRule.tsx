import { Input, Spin, message } from "antd";
import { useEffect } from "react";
import { useData } from "@/common";
import { Root, useSelector } from "@/store";
import * as Api from "@/api/ApiVersionRule";
import "./VersionRule.less";

// 版本命名规则（基础数据，全局单条配置）。文字内容可编辑、失焦自动保存；示意图固定。

const DEFAULT_CONTENT = {
    release_format: "VX",
    full_format: "VX.Y.Z.B",
    note_top: "注：V 代表 vision，是版本标识符号，其余每一位字母代表一位数字，X 从 1 开始计数，Y、Z、B 从 0 开始计数。",
    items: [
        { code: "X", title: "主版本号 X", desc: "" },
        { code: "Y", title: "次版本号 Y", desc: "" },
        { code: "Z", title: "修订版本号 Z", desc: "" },
        { code: "B", title: "上市后软件升级数字 B", desc: "" },
    ],
    note_bottom: "注：版本号中可不含 V（version）。",
};

export default () => {
    const user = useSelector((state: Root) => state.user);
    const canEdit = (user?.role_perms || []).includes("version_rule_edit");

    const [data, dispatch] = useData({
        form: DEFAULT_CONTENT as any,
        snapshot: DEFAULT_CONTENT as any,
        loading: false,
        saving: false,
    });

    const load = () => {
        dispatch({ loading: true });
        Api.get_version_rule().then((res: any) => {
            if (res.code === Api.C_OK) {
                const c = (res.data && res.data.content) || DEFAULT_CONTENT;
                dispatch({ loading: false, form: { ...c }, snapshot: { ...c } });
            } else {
                dispatch({ loading: false });
                message.error(res.msg);
            }
        });
    };

    useEffect(() => {
        load();
    }, []);

    const save = () => {
        if (!canEdit) return;
        if (JSON.stringify(data.form) === JSON.stringify(data.snapshot)) return;
        dispatch({ saving: true });
        Api.save_version_rule({ content: data.form }).then((res: any) => {
            dispatch({ saving: false });
            if (res.code === Api.C_OK) {
                dispatch({ snapshot: { ...data.form } });
            } else {
                message.error(res.msg);
            }
        });
    };

    const setField = (field: string, value: string) => {
        dispatch({ form: { ...data.form, [field]: value } });
    };
    const setItem = (idx: number, key: string, value: string) => {
        const items = (data.form.items || []).map((it: any, i: number) => (i === idx ? { ...it, [key]: value } : it));
        dispatch({ form: { ...data.form, items } });
    };

    return (
        <div className="page div-v version-rule">
            <div className="div-h searchbar list-searchbar-align">
                <span style={{ fontWeight: 600 }}>版本命名规则</span>
                {!canEdit ? <span style={{ marginLeft: 12, color: "#999", fontSize: 12 }}>（只读，无编辑权限）</span> : null}
                {data.saving ? <span className="vr-saving">保存中…</span> : null}
            </div>

            <Spin spinning={data.loading} wrapperClassName="vr-scroll">
                <div className="vr-body">
                    <h2 className="vr-title">版本命名规则</h2>

                    <div className="vr-cap">软件版本命名规则为</div>
                    <div className="vr-line">
                        <span className="vr-line-lbl">发布版本：</span>
                        <Input
                            className="vr-input vr-inline-input"
                            value={data.form.release_format ?? ""}
                            disabled={!canEdit}
                            onChange={(e) => setField("release_format", e.target.value)}
                            onBlur={save}
                        />
                    </div>
                    <div className="vr-line">
                        <span className="vr-line-lbl">完整版本：</span>
                        <Input
                            className="vr-input vr-inline-input"
                            value={data.form.full_format ?? ""}
                            disabled={!canEdit}
                            onChange={(e) => setField("full_format", e.target.value)}
                            onBlur={save}
                        />
                    </div>

                    <div className="vr-cap">软件完整版本及说明</div>
                    <svg viewBox="0 0 470 290" className="vr-svg">
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

                    <Input.TextArea
                        className="vr-input vr-note"
                        autoSize={{ minRows: 1, maxRows: 6 }}
                        value={data.form.note_top ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setField("note_top", e.target.value)}
                        onBlur={save}
                    />

                    {(data.form.items || []).map((item: any, idx: number) => (
                        <div className="vr-item" key={item.code || idx}>
                            <Input
                                className="vr-input vr-item-title"
                                value={item.title ?? ""}
                                disabled={!canEdit}
                                onChange={(e) => setItem(idx, "title", e.target.value)}
                                onBlur={save}
                            />
                            <Input.TextArea
                                className="vr-input"
                                autoSize={{ minRows: 1, maxRows: 8 }}
                                value={item.desc ?? ""}
                                disabled={!canEdit}
                                onChange={(e) => setItem(idx, "desc", e.target.value)}
                                onBlur={save}
                            />
                        </div>
                    ))}

                    <Input.TextArea
                        className="vr-input vr-note"
                        autoSize={{ minRows: 1, maxRows: 6 }}
                        value={data.form.note_bottom ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => setField("note_bottom", e.target.value)}
                        onBlur={save}
                    />
                </div>
            </Spin>
        </div>
    );
};
