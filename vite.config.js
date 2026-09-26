import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { componentIdsOf } from './kernel/server/component-loader.js';
import stripStageOptions from './kernel/build/strip-stage-options.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API = 'http://localhost:3001';

async function loadLessonConfig() {
  const configPath = path.resolve(process.env.LESSON_CONFIG || './lesson.config.js');
  const { default: lessonConfig } = await import(pathToFileURL(configPath).href);
  return { configPath, lessonConfig };
}

// 规格 §4：按 LESSON_CONFIG（默认 ./lesson.config.js，相对 cwd）定位课程配置；
// stagesDir 相对配置文件所在目录解析，得到 STAGES_ROOT，作为 @stages 别名
// v0.5：@components 指向 <项目根>/components（与服务端 componentsRoot 同一目录；vitest 复用本函数）
// v0.8：@primitives 指向 <项目根>/primitives（与服务端 stage-loader 的 primitivesRoot 同一目录）
export async function resolveAliases() {
  const { configPath, lessonConfig } = await loadLessonConfig();
  const STAGES_ROOT = path.resolve(path.dirname(configPath), lessonConfig.stagesDir);
  return {
    '#kernel': path.join(ROOT, 'kernel'),
    '@stages': STAGES_ROOT,
    '@components': path.join(ROOT, 'components'),
    '@primitives': path.join(ROOT, 'primitives'),
  };
}

// K2（v0.6）：已打开组件在 component.config.js 里声明的 static 前缀（开发期由 Express 提供，Vite 代理过去）
// 组件目录不存在的 id 跳过（服务端加载器会报错，这里不重复）
export async function resolveStaticPrefixes({ componentsRoot = path.join(ROOT, 'components') } = {}) {
  const { lessonConfig } = await loadLessonConfig();
  const prefixes = [];
  for (const id of componentIdsOf(lessonConfig)) {
    const cfgFile = path.join(componentsRoot, id, 'component.config.js');
    if (!fs.existsSync(cfgFile)) continue;
    const { default: cfg } = await import(pathToFileURL(cfgFile).href);
    if (cfg && cfg.static && typeof cfg.static === 'object') prefixes.push(...Object.keys(cfg.static));
  }
  return prefixes;
}

export function devProxy(staticPrefixes = []) {
  const proxy = {
    '/api': API,
    '/socket.io': {
      target: API,
      ws: true,
    },
  };
  for (const p of staticPrefixes) proxy[p] = API;
  return proxy;
}

// v0.8：内核构建插件——前端打包去掉 stage.config.js 的 options（有效 options 来自服务端 classroom:state，保密选项不进前端）。
// 插件按本课实际的阶段根目录（aliases['@stages']）匹配；vitest.config.js 复用本函数，测试环境同样生效
export function kernelPlugins(aliases) {
  return [stripStageOptions({ stagesRoot: aliases['@stages'] }), react()];
}

export default defineConfig(async () => {
  const aliases = await resolveAliases();
  return {
    plugins: kernelPlugins(aliases),
    // K3：与 index.html 的兜底检查和代码沙盒规格 §1 的浏览器下限对齐
    build: { target: ['chrome85', 'edge85', 'safari15'] },
    resolve: { alias: aliases },
    server: {
      // host:true 让 vite 监听 0.0.0.0，学生平板可从 LAN IP 访问
      host: true,
      proxy: devProxy(await resolveStaticPrefixes()),
    },
  };
});
