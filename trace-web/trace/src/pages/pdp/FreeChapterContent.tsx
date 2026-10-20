/**
 * 自由正文/图/表交错编辑区（添加正文、上传图片、表格由外部 renderTable）。
 */
import { Button, Input, Space, Upload } from "antd";
import { TableOutlined, UploadOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import {
    buildFreeSegments,
    freeAddBodyBlock,
    freeInsertBodyAboveTable,
    freeInsertImageBeforeFirstTable,
    freeInsertTableBeforeFirstTable,
    freeAddImage,
    freeReplaceImage,
    freeDelImage,
    freeMediaCaptionName,
    freeSetMediaCaption,
    reassembleFreeBody,
    shouldUseFreeInterleave,
    type FreeChapterState,
} from "./freeChapterBlocks";

type Props = {
    body: string;
    tables: any[];
    images: any[];
    readonly?: boolean;
    skipInterleave?: boolean;
    bodyDisabled?: boolean;
    bodyLabel?: string;
    onPatch: (patch: Partial<FreeChapterState>) => void;
    renderTable: (ti: number) => ReactNode;
    extraTop?: ReactNode;
    showAddTableSlot?: ReactNode;
    /** 为 false 时不在表前插入，表后按钮保持原样 */
    allowAboveTable?: boolean;
};

export function FreeSideActions(props: {
    label: string;
    onBody: () => void;
    onImageData: (dataUrl: string) => void;
    onTable: () => void;
}) {
    return (
        <Space wrap style={{ margin: "16px 0" }}>
            <Button size="small" onClick={props.onBody}>{props.label}</Button>
            <Upload
                accept="image/*"
                showUploadList={false}
                beforeUpload={(file) => {
                    const reader = new FileReader();
                    reader.onload = () => props.onImageData(String(reader.result || ""));
                    reader.readAsDataURL(file);
                    return false;
                }}>
                <Button size="small" icon={<UploadOutlined />}>上传图片</Button>
            </Upload>
            <Button size="small" icon={<TableOutlined />} onClick={props.onTable}>添加表格</Button>
        </Space>
    );
}

export default function FreeChapterContent(props: Props) {
    const images = Array.isArray(props.images) ? props.images : [];
    const tables = props.tables || [];
    const state: FreeChapterState = { body: String(props.body || ""), tables, images };
    const segments = buildFreeSegments(state.body, tables, images);
    const hasInterleave = shouldUseFreeInterleave(state.body, segments, { skip: !!props.skipInterleave });

    const uploadImage = (file: File, replaceIndex?: number) => {
        if (!file.type.startsWith("image/")) return false;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = String(reader.result || "");
            const next =
                replaceIndex !== undefined && replaceIndex >= 0
                    ? freeReplaceImage(state, replaceIndex, dataUrl)
                    : freeAddImage(state, dataUrl);
            props.onPatch({ images: next.images, body: next.body });
        };
        reader.readAsDataURL(file);
        return false;
    };

    const setMediaCaption = (kind: "image" | "table", index: number, name: string) => {
        const next = freeSetMediaCaption(state, kind, index, name);
        props.onPatch({ body: next.body });
    };

    const captionInput = (kind: "image" | "table", index: number, caption?: string) => {
        if (props.readonly) {
            const text = String(caption || "").trim();
            return text ? (
                <div style={{ textAlign: "center", fontSize: 13, color: "#444", margin: "4px 0 8px" }}>{text}</div>
            ) : null;
        }
        return (
            <Input
                size="small"
                value={freeMediaCaptionName(caption)}
                placeholder={kind === "image" ? "请输入图题" : "请输入表名"}
                style={{ margin: "8px auto", display: "block", textAlign: "center", maxWidth: 420 }}
                onChange={(e) => setMediaCaption(kind, index, e.target.value)}
            />
        );
    };

    const uploadAt = (file: File, where: "above" | "below") => {
        if (!file.type.startsWith("image/")) return false;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = String(reader.result || "");
            const next = where === "above" && tables.length
                ? freeInsertImageBeforeFirstTable(state, dataUrl)
                : freeAddImage(state, dataUrl);
            props.onPatch({ images: next.images, body: next.body });
        };
        reader.readAsDataURL(file);
        return false;
    };

    const actionBar = (where: "above" | "below") => !props.readonly && (where === "below" || props.allowAboveTable !== false) ? (
        <Space wrap style={{ margin: "16px 0" }}>
            <Button
                size="small"
                onClick={() => {
                    const next = where === "above" ? freeInsertBodyAboveTable(state) : freeAddBodyBlock(state);
                    props.onPatch({ body: next.body });
                }}>
                {tables.length > 0 ? (where === "above" ? "上方添加正文" : "下方添加正文") : "添加正文"}
            </Button>
            <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => uploadAt(file as File, where)}>
                <Button size="small" icon={<UploadOutlined />}>上传图片</Button>
            </Upload>
            {where === "above" && tables.length > 0 ? (
                <Button
                    size="small"
                    icon={<TableOutlined />}
                    onClick={() => {
                        const next = freeInsertTableBeforeFirstTable(state);
                        props.onPatch({ tables: next.tables, body: next.body });
                    }}>
                    添加表格
                </Button>
            ) : props.showAddTableSlot}
        </Space>
    ) : null;

    if (hasInterleave) {
        return (
            <>
                {props.extraTop}
                {segments.map((seg, si) => {
                    if (seg.type === "text") {
                        return (
                            <div className="pdp-field" key={si}>
                                <div className="pdp-label">
                                    正文 {segments.slice(0, si + 1).filter((s: any) => s.type === "text").length}
                                </div>
                                <Input.TextArea
                                    autoSize={{ minRows: 3, maxRows: 20 }}
                                    value={seg.text}
                                    disabled={!!props.readonly || !!props.bodyDisabled}
                                    placeholder="本段正文内容，可多行"
                                    onChange={(e) => props.onPatch({ body: reassembleFreeBody(segments, si, e.target.value) })}
                                />
                            </div>
                        );
                    }
                    if (seg.type === "image") {
                        const ii = seg.imageIndex;
                        const url = images[ii];
                        if (!url) return null;
                        return (
                            <div key={si} style={{ margin: "16px 0 12px", textAlign: "center" }}>
                                <img src={url} alt="" style={{ maxWidth: "100%", border: "1px solid #eee" }} />
                                {captionInput("image", ii, seg.caption)}
                                {!props.readonly && (
                                    <Space size={4} style={{ marginTop: 4, display: "flex", justifyContent: "center" }}>
                                        <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => uploadImage(file as File, ii)}>
                                            <Button size="small" icon={<UploadOutlined />}>更换</Button>
                                        </Upload>
                                        <Button
                                            size="small"
                                            danger
                                            onClick={() => {
                                                const next = freeDelImage(state, ii);
                                                props.onPatch({ images: next.images, body: next.body });
                                            }}>
                                            删除
                                        </Button>
                                    </Space>
                                )}
                            </div>
                        );
                    }
                    const tableSeg = segments.find((s: any) => s.type === "table" && s.tableIndex === seg.tableIndex) || seg;
                    const firstTable = segments.findIndex((s: any) => s.type === "table") === si;
                    return (
                        <div key={si} style={{ marginTop: 16 }}>
                            {firstTable ? actionBar("above") : null}
                            {captionInput("table", seg.tableIndex, tableSeg.caption)}
                            {props.renderTable(seg.tableIndex)}
                        </div>
                    );
                })}
                {actionBar("below")}
            </>
        );
    }

    return (
        <>
            {props.extraTop}
            <div className="pdp-field">
                <div className="pdp-label">{props.bodyLabel || "正文"}</div>
                <Input.TextArea
                    autoSize={{ minRows: 3, maxRows: 20 }}
                    value={props.body ?? ""}
                    disabled={!!props.readonly || !!props.bodyDisabled}
                    placeholder="本章节正文内容，可多行"
                    onChange={(e) => props.onPatch({ body: e.target.value })}
                />
            </div>
            {tables.length > 0 ? actionBar("above") : null}
            {(tables || []).map((_: any, ti: number) => {
                const tableSeg = segments.find((s: any) => s.type === "table" && s.tableIndex === ti);
                return (
                    <div key={ti} style={{ marginTop: 16 }}>
                        {captionInput("table", ti, tableSeg?.caption)}
                        {props.renderTable(ti)}
                    </div>
                );
            })}
            {images.length > 0 && (
                <div className="pdp-field">
                    <div className="pdp-label">正文图片</div>
                    {images.map((url: string, imgIndex: number) => (
                        <div key={imgIndex} style={{ marginBottom: 16 }}>
                            <img src={url} alt="" style={{ maxWidth: "100%", border: "1px solid #eee" }} />
                            {captionInput(
                                "image",
                                imgIndex,
                                segments.find((s: any) => s.type === "image" && s.imageIndex === imgIndex)?.caption,
                            )}
                            {!props.readonly && (
                                <Space size={4} style={{ marginTop: 4 }}>
                                    <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => uploadImage(file as File, imgIndex)}>
                                        <Button size="small" icon={<UploadOutlined />}>更换</Button>
                                    </Upload>
                                    <Button
                                        size="small"
                                        danger
                                        onClick={() => {
                                            const next = freeDelImage(state, imgIndex);
                                            props.onPatch({ images: next.images, body: next.body });
                                        }}>
                                        删除
                                    </Button>
                                </Space>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {actionBar("below")}
        </>
    );
}
