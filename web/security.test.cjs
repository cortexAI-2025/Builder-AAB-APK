// Real local HTTP checks; Docker is deliberately absent/simulated, no Android build is claimed.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');

test('HTTP console rejects cross-origin/unsafe ZIPs and never serves failed artifacts',async t=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'dual-http-'));t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const bin=path.join(tmp,'bin');await fs.mkdir(bin);
 await fs.writeFile(path.join(bin,'docker'),'#!/bin/sh\nexit 1\n',{mode:0o700});
 const server=spawn(process.execPath,[path.join(__dirname,'server.js')],{env:{...process.env,PORT:String(port),UPLOAD_DIR:path.join(tmp,'uploads'),OUTPUT_DIR:path.join(tmp,'outputs'),PATH:bin+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
 t.after(()=>server.kill('SIGTERM'));
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server did not start')),10000);server.stdout.once('data',()=>{clearTimeout(timeout);resolve()});server.once('exit',()=>reject(Error('Server failed')))});
 const base=`http://127.0.0.1:${port}`;
 assert.equal((await fetch(base+'/api/build',{method:'POST',headers:{Origin:'https://attacker.invalid'}})).status,403);
 const bad=path.join(tmp,'bad.zip');execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("../escape", "bad"); z.close()',bad]);
 const form=new FormData();form.append('zip',new Blob([await fs.readFile(bad)]),'bad.zip');
 assert.equal((await fetch(base+'/api/preview',{method:'POST',body:form})).status,400);
 const zip=path.join(tmp,'valid.zip');execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("app/build.gradle", "plugins {}"); z.close()',zip]);
 const buildForm=new FormData();buildForm.append('zip',new Blob([await fs.readFile(zip)]),'valid.zip');
 const response=await fetch(base+'/api/build',{method:'POST',body:buildForm});assert.equal(response.status,200);const {buildId}=await response.json();
 let status;
 for(let i=0;i<50;i++){ status=await (await fetch(base+'/api/build/'+buildId)).json();if(status.status!=='RUNNING')break;await new Promise(r=>setTimeout(r,20)); }
 assert.equal(status.status,'FAILED');assert.deepEqual(status.apks,[]);assert.deepEqual(status.aabs,[]);
 assert.equal((await fetch(base+`/api/build/${buildId}/download/pipeline.log`)).status,404);
});
