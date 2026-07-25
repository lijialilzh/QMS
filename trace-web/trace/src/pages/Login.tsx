import "./Login.less";
import { Input, Button, Form, message } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import * as Api from "@/api/ApiUser";
import { actions, useDispatch } from "@/store";

export default () => {
    const dispatchStore = useDispatch();
    const { t: ts, i18n } = useTranslation();
    const navigate = useNavigate();

    const login = (params: any) => {
        Api.login(params).then((res) => {
            dispatchStore(actions.user.clear());
            if (res.code === Api.C_OK) {
                navigate("/", { replace: true });
            } else {
                message.error(res.msg);
            }
        });
    };

    return (
        <div className="page div-h login-wrap">
            {/* 左侧品牌区（信息系统经典布局） */}
            <div className="login-brand">
                <div className="login-brand-logo">
                    <img className="logo" src={`assets/img/logo.${i18n.language}.png`}></img>
                </div>
                <div className="login-brand-content">
                    <div className="login-brand-title">{ts("html_title")}</div>
                    <div className="login-brand-sub">医疗器械软件研发 · 质量管理与追溯系统</div>
                    <ul className="login-brand-points">
                        <li>产品全生命周期质量管理与版本基线管控</li>
                        <li>SRS / SDS 需求与设计全链路双向追溯</li>
                        <li>风险分析与网络安全管理一体化</li>
                        <li>测试用例与现场测试记录完整闭环</li>
                    </ul>
                </div>
                <div className="login-brand-footer">© {new Date().getFullYear()} InferVision</div>
            </div>
            {/* 右侧登录表单区 */}
            <div className="login-form-side">
                <div className="login-form-box">
                    <div className="login-form-title">欢迎登录</div>
                    <div className="login-form-hint">请输入您的账号密码</div>
                    <Form onFinish={login} layout="vertical">
                        <Form.Item className="login-item" label="用户名" name="name" rules={[{ required: true, message: ts("input_username") }]}>
                            <Input allowClear autoComplete="new-user" prefix={<UserOutlined />} size="large" />
                        </Form.Item>
                        <Form.Item className="login-item" label="密码" name="pwd" rules={[{ required: true, message: ts("input_pwd") }]}>
                            <Input allowClear autoComplete="new-password" prefix={<LockOutlined />} type="password" size="large" />
                        </Form.Item>
                        <Form.Item>
                            <Button type="primary" htmlType="submit" className="login-btn" size="large">
                                {ts("login")}
                            </Button>
                        </Form.Item>
                        <div className="div-hr">
                            <a
                                className="login-forget"
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    message.info(ts("how2update_pwd"));
                                }}>
                                {ts("forget_pwd")}
                            </a>
                        </div>
                    </Form>
                </div>
            </div>
        </div>
    );
};
