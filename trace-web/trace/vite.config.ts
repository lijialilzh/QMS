import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    console.log("proxy:", env.URL_API);
    return {
        base: "./",
        plugins: [react()],
        resolve: {
            alias: {
                "@": resolve(__dirname, "src"),
            },
        },
        server: {
            proxy: {
                "/trace-api": {
                    target: env.URL_API,
                    changeOrigin: true,
                    secure: false,
                },
                "/data.trace": {
                    target: env.URL_API,
                    changeOrigin: true,
                    secure: false,
                },
            },
        },
        build: {
            target: "esnext",
        },
    };
});
