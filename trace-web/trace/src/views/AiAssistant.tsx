import "./AiAssistant.less";
import { useEffect, useRef } from "react";
import { Button, Input, Spin, Tooltip } from "antd";
import { CustomerServiceOutlined, CloseOutlined, SendOutlined, RobotOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useData } from "@/common";
import { httpPost, C_OK } from "@/api/http";

type Msg = {
    role: "user" | "ai";
    text: string;
    sources?: { manual: string; section: string }[];
    suggestions?: string[];
};

// 把 AI 回答里的 **加粗** 与换行渲染为 React 节点（仅支持 ** 与 \n，避免引入 markdown 库）
const renderRichText = (text: string) => {
    const lines = String(text || "").split("\n");
    return lines.map((line, li) => {
        const parts: (string | JSX.Element)[] = [];
        let last = 0;
        const re = /\*\*([^*]+)\*\*/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
            if (m.index > last) parts.push(line.slice(last, m.index));
            parts.push(<strong key={`b-${li}-${m.index}`}>{m[1]}</strong>);
            last = m.index + m[0].length;
        }
        if (last < line.length) parts.push(line.slice(last));
        return (
            <span key={li}>
                {parts.length ? parts : line}
                {li < lines.length - 1 ? <br /> : null}
            </span>
        );
    });
};

export default () => {
    const { t: ts } = useTranslation();
    const [data, dispatch] = useData({
        open: false,
        loading: false,
        input: "",
        messages: [] as Msg[],
    });
    const listRef = useRef<HTMLDivElement>(null);

    const samples: string[] = (ts("ai.samples", { returnObjects: true }) as any) || [];

    useEffect(() => {
        if (data.open && (data.messages || []).length === 0) {
            dispatch({ messages: [{ role: "ai", text: ts("ai.welcome") }] });
        }
    }, [data.open]);

    useEffect(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [data.messages, data.loading]);

    const send = (q?: string) => {
        const question = String(q ?? data.input ?? "").trim();
        if (!question || data.loading) return;
        const messages: Msg[] = [...(data.messages || []), { role: "user", text: question }];
        dispatch({ messages, input: "", loading: true });
        httpPost("/trace-api/ai_support/ask", { question }).then((res: any) => {
            if (res.code === C_OK && res.data) {
                dispatch({
                    loading: false,
                    messages: [
                        ...messages,
                        {
                            role: "ai",
                            text: res.data.answer,
                            sources: res.data.sources || [],
                            suggestions: res.data.suggestions || [],
                        },
                    ],
                });
            } else {
                dispatch({
                    loading: false,
                    messages: [...messages, { role: "ai", text: res.msg || ts("ai.error") }],
                });
            }
        });
    };

    return (
        <>
            {!data.open && (
                <Tooltip title={ts("ai.title")} placement="left">
                    <div className="ai-assistant-fab" onClick={() => dispatch({ open: true })}>
                        <CustomerServiceOutlined />
                    </div>
                </Tooltip>
            )}
            {data.open && (
                <div className="ai-assistant-panel">
                    <div className="ai-assistant-header">
                        <span className="ai-assistant-title">
                            <RobotOutlined /> {ts("ai.title")}
                        </span>
                        <CloseOutlined className="ai-assistant-close" onClick={() => dispatch({ open: false })} />
                    </div>
                    <div className="ai-assistant-body" ref={listRef}>
                        {(data.messages || []).map((m: Msg, i: number) => (
                            <div key={i} className={`ai-msg ai-msg-${m.role}`}>
                                <div className="ai-msg-bubble">
                                    {m.role === "ai" ? renderRichText(m.text) : m.text}
                                </div>
                                {m.role === "ai" && (m.suggestions || []).length > 0 && (
                                    <div className="ai-msg-guess">
                                        <div className="ai-msg-guess-tip">{ts("ai.guess")}</div>
                                        {(m.suggestions || []).map((q, qi) => (
                                            <span key={qi} className="ai-sample" onClick={() => send(q)}>
                                                {q}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                        {data.loading && (
                            <div className="ai-msg ai-msg-ai">
                                <div className="ai-msg-bubble">
                                    <Spin size="small" /> {ts("ai.thinking")}
                                </div>
                            </div>
                        )}
                        {(data.messages || []).length <= 1 && samples.length > 0 && (
                            <div className="ai-samples">
                                <div className="ai-samples-tip">{ts("ai.samples_tip")}</div>
                                {samples.map((s, i) => (
                                    <div key={i} className="ai-sample" onClick={() => send(s)}>{s}</div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="ai-assistant-footer">
                        <Input.TextArea
                            value={data.input}
                            autoSize={{ minRows: 1, maxRows: 3 }}
                            placeholder={ts("ai.placeholder")}
                            onChange={(e) => dispatch({ input: e.target.value })}
                            onPressEnter={(e) => {
                                e.preventDefault();
                                send();
                            }}
                        />
                        <Button type="primary" icon={<SendOutlined />} loading={data.loading} onClick={() => send()}>
                            {ts("ai.send")}
                        </Button>
                    </div>
                </div>
            )}
        </>
    );
};
