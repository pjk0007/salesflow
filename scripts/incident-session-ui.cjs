/* eslint-disable @typescript-eslint/no-require-imports -- isolated local UI QA harness */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');

async function main() {
    const bundle = await esbuild.build({
        absWorkingDir: root, bundle: true, write: false, platform: 'browser', jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"development"' },
        stdin: { resolveDir: root, loader: 'tsx', contents: `
            import React from 'react';
            import {createRoot} from 'react-dom/client';
            import {SessionProvider} from './src/contexts/SessionContext';
            import WorkspaceLayout from './src/components/layouts/WorkspaceLayout';
            createRoot(document.getElementById('app')!).render(
                <SessionProvider><WorkspaceLayout><h2>상담 화면 복구 완료</h2><p>가상 고객만 사용하는 격리 검수입니다.</p></WorkspaceLayout></SessionProvider>
            );
        ` },
        plugins: [{ name: 'local-fixture-shell', setup(build) {
            build.onResolve({filter: /^next\/navigation$/}, () => ({path: 'navigation', namespace: 'fixture'}));
            build.onResolve({filter: /dashboard-shell$/}, () => ({path: 'shell', namespace: 'fixture'}));
            build.onLoad({filter: /.*/, namespace: 'fixture'}, ({path: name}) => ({
                loader: 'jsx', contents: name === 'navigation'
                    ? `const router={push(url){document.getElementById('navigation').textContent='이동: '+url}}; export function useRouter(){return router}`
                    : `export function DashboardShell({children}) {return children}`,
            }));
        } }],
    });
    fs.mkdirSync(path.join(root,'.testenv'), {recursive:true});
    const counters = new Map();
    const server = http.createServer((req,res) => {
        const url = new URL(req.url,'http://127.0.0.1:3119');
        if (url.pathname === '/bundle.js') { res.setHeader('content-type','text/javascript'); return res.end(bundle.outputFiles[0].contents); }
        if (url.pathname === '/api/auth/me') {
            const scenario = new URL(req.headers.referer || 'http://127.0.0.1:3119/server-error').pathname;
            const count = (counters.get(scenario)||0)+1; counters.set(scenario,count);
            if (count === 1 && scenario === '/unauthorized') { res.writeHead(401); return res.end(); }
            if (count === 1 && scenario === '/server-error') { res.writeHead(503); return res.end('temporary'); }
            if (count === 1 && ['/slow','/body-stall'].includes(scenario)) {
                if (scenario === '/body-stall') { res.setHeader('content-type','application/json'); res.write('{'); }
                const timer=setTimeout(()=>res.end(),30000); res.on('close',()=>clearTimeout(timer)); return;
            }
            res.setHeader('content-type','application/json');
            return res.end(JSON.stringify({success:true,user:{userId:'qa-user',orgId:'qa-org',name:'가상 상담 담당자',email:'qa@fixture.invalid',role:'admin',onboardingCompleted:true}}));
        }
        counters.set(url.pathname,0);
        res.setHeader('content-type','text/html; charset=utf-8');
        res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>샌드비 세션 장애 복구 검수</title>
        <style>body{font:20px system-ui;padding:48px;background:#f7f8fc;color:#18243b}main{background:white;border:1px solid #d5dcea;border-radius:16px;padding:36px}button{padding:12px 24px;cursor:pointer}header{margin-bottom:24px}#navigation{color:#a30}</style>
        <header>격리 검수 · 실제 SessionProvider / WorkspaceLayout · 시나리오 ${url.pathname}</header>
        <main id="app"></main><p id="navigation"></p><script src="/bundle.js"></script></html>`);
    });
    server.listen(3119,'127.0.0.1',()=>console.log('Local session QA: http://127.0.0.1:3119/server-error (also /slow, /body-stall, /unauthorized)'));
}
void main().catch((error)=>{console.error(error);process.exitCode=1});
