const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),ts=require('typescript');
const file=path.resolve(__dirname,'../domain/realtime-url.ts'),m=new Module(file,module);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,file);
test('API prefix does not become a Socket.IO namespace',()=>{
 const {realtimeUrl}=m.exports;
 assert.equal(realtimeUrl('https://preview.emps-charge.tech/api'),'https://preview.emps-charge.tech/realtime');
 assert.equal(realtimeUrl('https://api.emps-charge.tech'),'https://api.emps-charge.tech/realtime');
 assert.equal(realtimeUrl('http://10.64.0.253:3011'),'http://10.64.0.253:3011/realtime');
});
