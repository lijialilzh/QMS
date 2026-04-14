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
        <div className="page div-v">
            <div className="div-h center-v login-header">
                <div className="center logo-div">
                    <img className="logo" src={`assets/img/logo.${i18n.language}.png`}></img>
                </div>
            </div>
            <div className="login-divider"></div>
            <div className="expand div-hr login-bg" style={{background: 'url("assets/img/bg.png") no-repeat', backgroundSize: 'cover'}}>
                <div className="login-dimbox center div-v">
                    <div className="login-title">{ts("html_title")}</div>
                    <Form onFinish={login}>
                        <Form.Item className="login-item" name="name" rules={[{ required: true, message: ts("input_username") }]}>
                            <Input allowClear autoComplete="new-user" prefix={<UserOutlined />} />
                        </Form.Item>
                        <Form.Item className="login-item" name="pwd" rules={[{ required: true, message: ts("input_pwd") }]}>
                            <Input allowClear autoComplete="new-password" prefix={<LockOutlined />} type="password" />
                        </Form.Item>
                        <Form.Item>
                            <Button type="primary" htmlType="submit" className="login-btn">
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
