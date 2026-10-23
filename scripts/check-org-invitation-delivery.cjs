/* eslint-disable @typescript-eslint/no-require-imports -- actual route with isolated DB/provider fixtures */
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

async function main() {
    const state = { result: null, invitations: [], submissions: [], reads: [] };
    global.__invitationDeliveryQa = state;
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error("External network is forbidden in invitation delivery QA"); };
    try {
        const result = await require("esbuild").build({
            entryPoints: [path.resolve(__dirname, "../src/app/api/org/invitations/route.ts")],
            bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
            plugins: [{ name: "isolated-invitation-dependencies", setup(builder) {
                const stubs = {
                    "@/lib/db": `
                        export const organizationInvitations={}, organizations={}, users={}, organizationMembers={}, emailSenderProfiles={};
                        export const db={
                            select:()=>{const rows=global.__invitationDeliveryQa.reads.shift();const q={from:()=>q,innerJoin:()=>q,where:()=>q,limit:()=>q,then:(resolve,reject)=>Promise.resolve(rows).then(resolve,reject)};return q;},
                            insert:()=>({values:(value)=>({returning:async()=>{const row={id:global.__invitationDeliveryQa.invitations.length+1,...value};global.__invitationDeliveryQa.invitations.push(row);return [row];}})})
                        };`,
                    "@/lib/auth-admin": `export const requireAdmin=async()=>({ok:true,user:{orgId:'00000000-0000-4000-8000-000000000001',userId:'00000000-0000-4000-8000-000000000002',name:'가상 관리자'}});`,
                    "@/lib/billing": `export const getResourceCount=async()=>0;export const checkPlanLimit=async()=>({allowed:true});`,
                    "@/lib/nhn-email": `export const getEmailConfig=async()=>({fromEmail:'sender@example.test'});export const getEmailClient=async()=>({sendEachMail:async(input)=>{global.__invitationDeliveryQa.submissions.push(input);return global.__invitationDeliveryQa.result;}});`,
                };
                builder.onResolve({ filter: /^@\/lib\/(db|auth-admin|billing|nhn-email)$/ }, args => ({ path: args.path, namespace: "invitation-fixture" }));
                builder.onLoad({ filter: /.*/, namespace: "invitation-fixture" }, args => ({ contents: stubs[args.path], loader: "js", resolveDir: path.resolve(__dirname, "..") }));
            } }],
        });
        const compiled = new Module(path.join(__dirname, "invitation-route-fixture.cjs"), module);
        compiled.filename = path.join(__dirname, "invitation-route-fixture.cjs");
        compiled.paths = module.paths;
        compiled._compile(result.outputFiles[0].text, compiled.filename);
        const { NextRequest } = require("next/server");
        const { POST } = compiled.exports;
        const rejected = (code) => ({ header: { isSuccessful: false, resultCode: code, resultMessage: "가상 발송 차단" }, data: null });
        const accepted = { header: { isSuccessful: true, resultCode: 0 }, data: { requestId: "fixture-request", results: [{ resultCode: 0 }] } };
        const cases = [
            ["suppressed recipient", rejected(-7101), false],
            ["suppression lookup failure", rejected(-7102), false],
            ["invalid delivery context", rejected(-7103), false],
            ["provider rejected", rejected(400), false],
            ["recipient rejected", { ...accepted, data: { ...accepted.data, results: [{ resultCode: -1 }] } }, false],
            ["missing request ID", { ...accepted, data: { results: [{ resultCode: 0 }] } }, false],
            ["missing recipient result", { ...accepted, data: { requestId: "fixture-request" } }, false],
            ["provider accepted", accepted, true],
        ];
        for (const [label, response, sent] of cases) {
            state.result = response;
            state.reads = [[], [], [{ name: "가상 조직" }], []];
            const before = state.invitations.length;
            const result = await POST(new NextRequest("https://qa.example.test/api/org/invitations", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "member@example.test", role: "member" }),
            }));
            const body = await result.json();
            assert.equal(result.status, 201, label);
            assert.equal(body.success, true, label);
            assert.equal(body.data.emailSent, sent, label);
            assert.equal(state.invitations.length, before + 1, "delivery refusal must preserve the usable invitation");
            assert.equal(body.data.token, state.invitations.at(-1).token, "invitation link remains available");
            assert.equal(state.reads.length, 0);
        }
        assert.equal(state.submissions.length, cases.length);
        console.log(`PASS invitation route: ${cases.length} suppressed/rejected/incomplete/accepted cases · truthful emailSent · invitation preserved · no real DB/network`);
    } finally {
        global.fetch = originalFetch;
        delete global.__invitationDeliveryQa;
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
