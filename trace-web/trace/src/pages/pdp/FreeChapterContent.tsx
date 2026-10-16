/**
 * 自由正文/图/表交错编辑区（添加正文、上传图片、表格由外部 renderTable）。
 */
import { Button, Input, Space, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import {
    buildFreeSegments,
    freeAddBodyBlock,
    freeAddImage,
    freeReplaceImage,
    freeDelImage,
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
};

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

    const mediaBar = !props.readonly ? (
        <Space wrap style={{ margin: "8px 0" }}>
            <Button
                size="small"
                onClick={() => {
                    const next = freeAddBodyBlock(state);
                    props.onPatch({ body: next.body });
                }}>
                添加正文
            </Button>
            <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => uploadImage(file as File)}>
                <Button size="small" icon={<UploadOutlined />}>上传图片</Button>
            </Upload>
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
                            <div key={si} style={{ margin: "8px 0 12px", textAlign: "center" }}>
                                <img src={url} alt="" style={{ maxWidth: "100%", border: "1px solid #eee" }} />
                                {seg.caption ? (
                                    <div style={{ textAlign: "center", fontSize: 13, color: "#444", margin: "4px 0 8px" }}>{seg.caption}</div>
                                ) : null}
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
                    return <div key={si}>{props.renderTable(seg.tableIndex)}</div>;
                })}
                {mediaBar}
                {props.showAddTableSlot}
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
            {(tables || []).map((_: any, ti: number) => (
                <div key={ti}>{props.renderTable(ti)}</div>
            ))}
            {images.length > 0 && (
                <div className="pdp-field">
                    <div className="pdp-label">正文图片</div>
                    {images.map((url: string, imgIndex: number) => (
                        <div key={imgIndex} style={{ marginBottom: 8 }}>
                            <img src={url} alt="" style={{ maxWidth: "100%", border: "1px solid #eee" }} />
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
            {mediaBar}
            {props.showAddTableSlot}
        </>
    );
}
